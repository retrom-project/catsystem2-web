// SPDX-License-Identifier: MPL-2.0
// Instruction semantics recovered from the fixed 2.6.1.76 interpreter.
// See docs/kcs-vm.md for addresses, the native oracle, and validation scope.
import { encodeCP932 } from './strings.mjs';
import { nativeDebugSymbol, nativeDebugValue } from './debug.mjs';
const single = new Set([
  8, 12, 22, 23, 24, 25, 26, 37, 38, 39, 40, 41, 46, 47, 49, 50, 54, 55, 56, 57, 61, 66, 68,
]);
const empty = new Set([0, 45, 51, 58, 59, 60]);
const view = new DataView(new ArrayBuffer(4));
let nextMemoryID = 1;
export const NATIVE_RESULT_SENTINEL = 0xcccccccc;
export function floatBits(value) {
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}
export function bitsFloat(value) {
  view.setUint32(0, value, true);
  return view.getFloat32(0, true);
}
export function nativeReply(control, value, wait) {
  if (!Number.isInteger(control) || control < 0 || control > 5)
    throw new Error(`Invalid KCS native control ${control}`);
  if ([1, 3].includes(control) && !Number.isInteger(value))
    throw new Error('A KCS result native must supply a 32-bit result');
  if (![1, 3].includes(control) && value !== undefined)
    throw new Error('A void KCS native cannot supply a result');
  return {
    control,
    ...(value === undefined ? {} : { value: value >>> 0 }),
    ...(wait ? { wait } : {}),
  };
}
function arithmetic(op, a, b, left, right) {
  const floating = op >= 15 ? Boolean(left & 4) : Boolean((left | right) & 4);
  const signed = Boolean((left | right) & 0x20);
  const x = floating ? bitsFloat(a) : signed ? a | 0 : a >>> 0;
  const y = floating ? bitsFloat(b) : signed ? b | 0 : b >>> 0;
  if (floating && op <= 4) {
    if (Number.isNaN(x))
      return (a | 0x00400000) /* exe-address-check: non-address - IEEE quiet NaN bit */ >>> 0;
    if (Number.isNaN(y))
      return (b | 0x00400000) /* exe-address-check: non-address - IEEE quiet NaN bit */ >>> 0;
  }
  let value;
  switch (op) {
    case 1:
      value = x + y;
      break;
    case 2:
      value = x - y;
      break;
    case 3:
      value = floating ? x * y : Math.imul(a, b);
      break;
    case 4:
      if (!floating && signed && (a | 0) === -2147483648 && (b | 0) === -1)
        throw new Error('KCS integer division overflow');
      value = y ? x / y : 0;
      break;
    case 5:
      return (b ? (signed ? (a | 0) % (b | 0) : (a >>> 0) % (b >>> 0)) : 0) >>> 0;
    case 6:
      return (a & b) >>> 0;
    case 7:
      return (a | b) >>> 0;
    case 9:
      return (a ^ b) >>> 0;
    case 10:
      return (a << (b & 31)) >>> 0;
    // The standalone right-shift handler always uses SHR, including signed operands.
    case 11:
      return a >>> (b & 31);
    case 13:
      return Number(Boolean(a) && Boolean(b));
    case 14:
      return Number(Boolean(a) || Boolean(b));
    case 15:
      return Number(x > y);
    case 16:
      return Number(x < y);
    case 17:
      return Number(x >= y);
    case 18:
      return Number(x <= y);
    case 19:
      return Number(x === y);
    case 20:
      return Number(x !== y);
    default:
      throw new Error(`Invalid KCS arithmetic ${op}`);
  }
  return floating ? (Number.isNaN(value) ? 0xffc00000 : floatBits(value)) : Math.trunc(value) >>> 0;
}

export class KCSMachine {
  bindAllocator(binding) {
    if (
      typeof binding?.allocated !== 'function' ||
      typeof binding?.released !== 'function' ||
      (binding.blockForAddress !== undefined && typeof binding.blockForAddress !== 'function')
    )
      throw new TypeError('KCS allocation binding requires allocation and release callbacks');
    this.allocatorBinding = binding;
  }
  get memory() {
    const bytes = this.memoryBinding ? this.memoryBinding.bytes() : this.memoryStorage;
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('KCS memory backing must provide bytes');
    return bytes;
  }
  set memory(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('KCS memory backing must be bytes');
    this.memoryBinding = null;
    this.memoryStorage = bytes;
  }
  bindMemory(binding) {
    if (typeof binding?.bytes !== 'function' || !(binding.bytes() instanceof Uint8Array))
      throw new TypeError('KCS memory binding requires a byte-view provider');
    if (binding.bytes().length !== this.script.data.length + this.script.stackSize)
      throw new RangeError('KCS memory binding has a different size');
    this.memoryBinding = binding;
    this.memoryStorage = null;
  }
  get data() {
    return this.memory.subarray(0, this.script.data.length);
  }
  get stack() {
    return this.memory.subarray(this.script.data.length);
  }
  get blockIDs() {
    return this.blockStorage.map((block) => block.id);
  }
  get blocks() {
    return this.blockStorage.map((_, index) => this.blockBytes(index));
  }
  blockBytes(index) {
    const block = this.blockStorage[index];
    if (!block) throw new RangeError('KCS allocation identity is unavailable');
    const bytes = block.binding ? block.binding.bytes() : block.storage;
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('KCS allocation backing must provide bytes');
    return bytes;
  }
  blockIndex(id) {
    return this.blockStorage.findIndex((block) => block.id === id);
  }
  bindBlock(index, binding) {
    if (typeof binding?.bytes !== 'function' || !(binding.bytes() instanceof Uint8Array))
      throw new TypeError('KCS allocation binding requires a byte-view provider');
    if (binding.bytes().length !== this.blockBytes(index).length)
      throw new RangeError('KCS allocation binding has a different size');
    this.blockStorage[index].binding = binding;
    this.blockStorage[index].storage = null;
  }
  get shared() {
    const bytes = this.sharedBinding ? this.sharedBinding.bytes() : this.sharedStorage;
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('KCS shared backing must provide a byte view');
    return bytes;
  }
  set shared(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('KCS shared backing must be bytes');
    this.sharedBinding = null;
    this.sharedStorage = bytes;
  }
  bindShared(binding) {
    if (typeof binding?.bytes !== 'function' || !(binding.bytes() instanceof Uint8Array))
      throw new TypeError('KCS external shared backing requires a byte-view provider');
    this.sharedBinding = binding;
    this.sharedStorage = null;
  }
  constructor(script, host, shared = new Uint8Array(1024 * 1024)) {
    this.script = script;
    this.host = host;
    this.memoryID = nextMemoryID++;
    this.memory = new Uint8Array(script.data.length + script.stackSize);
    this.memory.set(script.data);
    this.shared = shared;
    this.blockStorage = [];
    this.nextBlockID = 1;
    this.steps = 0;
    this.start();
  }
  start(entry = 0) {
    if (!Number.isInteger(entry) || entry < 0 || entry >= this.script.codeSize)
      throw new Error(`KCS invalid entry ${entry}`);
    this.pc = entry;
    this.sp = this.floor = this.fp = this.data.length;
    this.depth = 0;
    this.switchValue = 0;
    this.halted = false;
    this.suspended = false;
    this.waiting = null;
    this.debug = {
      file: '',
      line: 0,
      sourceInitialized: false,
      functions: [],
      locals: [],
      scopes: [0],
    };
    this.executionMode = 1;
    this.debugBreakPC = 0xffffffff;
    this.debugHook = 0;
  }
  instruction(at = this.pc) {
    const b = this.script.body;
    if (!Number.isInteger(at) || at < 0 || at >= this.script.codeSize)
      throw new Error(`KCS instruction address ${at}`);
    const op = b.u8(at);
    if (op >= 69 || op === 63 || op === 64) throw new Error(`KCS unknown opcode ${op} at ${at}`);
    const count = empty.has(op) ? 0 : single.has(op) ? 1 : op === 53 ? 3 : 2;
    if (at + 1 + count * 5 > this.script.codeSize)
      throw new Error(`KCS instruction exceeds code at ${at}`);
    const args = Array.from({ length: count }, (_, i) => {
      const p = at + 1 + i * 5,
        mode = b.u8(p);
      return {
        mode,
        value: b.u32(p + 1),
        width: mode & 0x80 ? 4 : (mode & 15) === 1 ? 1 : (mode & 15) === 2 ? 2 : 4,
        float: Boolean(mode & 4),
        signed: Boolean(mode & 0x20),
      };
    });
    return { op, args, size: 1 + count * 5 };
  }
  region(address, count = 1) {
    if (
      !Number.isInteger(address) ||
      address < 0 ||
      address > 0xffffffff ||
      !Number.isInteger(count) ||
      count < 0
    )
      throw new Error('KCS invalid memory range');
    let buffer, at;
    if (address >= 0x80000000) {
      buffer = this.shared;
      at = address - 0x80000000;
    } else if (address < this.memory.length || (count === 0 && address === this.memory.length)) {
      buffer = this.memory;
      at = address;
    } else {
      let base = this.memory.length;
      for (const block of this.blocks) {
        if (address < base + block.length) {
          buffer = block;
          at = address - base;
          break;
        }
        base += block.length;
      }
    }
    if (!buffer || at < 0 || at + count > buffer.length)
      throw new Error(`KCS memory ${address.toString(16)}+${count} at pc ${this.pc.toString(16)}`);
    return [buffer, at];
  }
  bytes(address, count) {
    const [buffer, at] = this.region(address, count);
    return buffer.subarray(at, at + count);
  }
  nativeArgument(index) {
    if (!Number.isSafeInteger(index) || index < 0 || this.nativeArgumentBase === undefined)
      throw new Error('KCS native argument is unavailable');
    // GCALL removes the declared argument bytes, but the original handlers
    // can still read subsequent words in that same mapped stack region.
    return this.load(this.nativeArgumentBase + index * 4);
  }
  load(address, width = 4, signed = false) {
    const [buffer, at] = this.region(address >>> 0, width);
    const b = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (width === 1) return (signed ? b.getInt8(at) : b.getUint8(at)) >>> 0;
    if (width === 2) return (signed ? b.getInt16(at, true) : b.getUint16(at, true)) >>> 0;
    if (width !== 4) throw new Error(`KCS invalid load width ${width}`);
    return b.getUint32(at, true);
  }
  store(address, value, width = 4) {
    const [buffer, at] = this.region(address >>> 0, width);
    const b = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (width === 1) b.setUint8(at, value);
    else if (width === 2) b.setUint16(at, value, true);
    else if (width === 4) b.setUint32(at, value, true);
    else throw new Error(`KCS invalid store width ${width}`);
  }
  allocate(size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024)
      throw new Error(`KCS invalid allocation ${size}`);
    const address = this.memory.length + this.blocks.reduce((n, block) => n + block.length, 0);
    if (address + size >= 0x80000000) throw new Error('KCS allocation exceeds address space');
    const id = this.nextBlockID++;
    this.blockStorage.push({
      id,
      storage: new Uint8Array(size),
      binding: null,
    });
    if (this.allocatorBinding) {
      const value = this.allocatorBinding.allocated(id);
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
        throw new TypeError('KCS allocation binding returned an invalid virtual address');
      return value >>> 0;
    }
    return size ? address : 0xffffffff;
  }
  free(address) {
    let index = -1;
    if (this.allocatorBinding?.blockForAddress) {
      const id = this.allocatorBinding.blockForAddress(address >>> 0);
      if (id !== null && id !== undefined) index = this.blockIndex(id);
    } else {
      let bytes, offset;
      try {
        [bytes, offset] = this.region(address >>> 0, 1);
      } catch {
        return false;
      }
      index = this.blocks.findIndex(
        (block) =>
          block.length &&
          block.buffer === bytes.buffer &&
          block.byteOffset === bytes.byteOffset + offset,
      );
    }
    if (index < 0) return false;
    const id = this.blockStorage[index].id;
    this.blockStorage.splice(index, 1);
    this.allocatorBinding?.released(id);
    return true;
  }
  push(value) {
    if (this.sp + 4 > this.memory.length) throw new Error(`KCS stack overflow at ${this.pc}`);
    this.store(this.sp, value);
    this.sp += 4;
  }
  pop() {
    if (this.sp < 4) throw new Error(`KCS stack underflow at ${this.pc}`);
    this.sp -= 4;
    return this.load(this.sp);
  }
  raw(operand) {
    return operand.mode & 0x40 ? this.pop() : operand.value;
  }
  read(operand) {
    const value = this.raw(operand);
    return operand.mode & 0x10
      ? this.load(value, operand.width, operand.signed && !(operand.mode & 0x80))
      : value;
  }
  string(address) {
    const bytes = [];
    for (let i = 0; i < 1024 * 1024; i++) {
      const byte = this.load((address + i) >>> 0, 1);
      if (!byte) return new TextDecoder('shift_jis').decode(new Uint8Array(bytes));
      bytes.push(byte);
    }
    throw new Error('KCS unterminated string');
  }
  writeStringBytes(bytes, address) {
    this.bytes(address, bytes.length + 1).set(bytes);
    this.store(address + bytes.length, 0, 1);
  }
  writeString(text, address) {
    this.writeStringBytes(encodeCP932(text), address);
  }
  copyString(destination, source) {
    for (let i = 0; i < 1024 * 1024; i++) {
      const byte = this.load(source + i, 1);
      this.store(destination + i, byte, 1);
      if (!byte) return;
    }
    throw new Error('KCS unterminated string');
  }
  completeNative(reply, instructionPC, next, count, call) {
    if (!reply || typeof reply !== 'object' || typeof reply.then === 'function')
      throw new Error(`KCS native ${call.id.toString(16)} must return an explicit control reply`);
    const checked = nativeReply(reply.control, reply.value, reply.wait);
    if (checked.control === 1 || checked.control === 3) {
      if (checked.value === NATIVE_RESULT_SENTINEL)
        this.host?.diagnostic?.({ type: 'native-result-sentinel', id: call.id, pc: instructionPC });
      this.push(checked.value);
    }
    if (checked.control === 5) {
      this.sp += count;
      next = instructionPC;
    }
    if ([0, 3, 4, 5].includes(checked.control)) this.suspended = true;
    this.waiting = checked.wait ? { ...checked.wait, native: call.id } : null;
    return next;
  }
  waitMessage(address) {
    this.bytes(address, 16);
    return nativeReply(4, undefined, { kind: 'message', address });
  }
  receiveMessage(words) {
    if (this.waiting?.kind !== 'message') return false;
    if (
      !Array.isArray(words) ||
      words.length !== 4 ||
      words.some((word) => !Number.isInteger(word))
    )
      throw new Error('KCS task messages require four integer words');
    const address = this.waiting.address;
    words.forEach((word, i) => this.store(address + i * 4, word));
    this.push(1);
    this.resume();
    return true;
  }
  idle() {
    if (this.waiting?.kind === 'message') this.push(0);
    this.resume();
  }
  step() {
    if (this.halted || this.waiting) return;
    const instructionPC = this.pc,
      { op, args: o, size } = this.instruction();
    if (op === 59) {
      this.halted = true;
      return;
    }
    let next = this.pc + size;
    this.steps++;
    const read = (i) => this.read(o[i]);
    if (op > 0 && op <= 20 && ![8, 12].includes(op)) {
      const a = read(0),
        b = read(1);
      this.push(arithmetic(op, a, b, o[0].mode, o[1].mode));
    } else if (op === 8) this.push(~read(0));
    else if (op === 12) this.push(Number(!read(0)));
    else if (op === 26) {
      const value = read(0);
      this.push(o[0].float ? floatBits(-bitsFloat(value)) : -value);
    } else if (op === 21 || (op >= 27 && op <= 36)) {
      const address = this.raw(o[0]),
        b = read(1);
      let value = b;
      if (op !== 21) {
        const a = this.load(address);
        const alias = { 27: 5, 28: 6, 29: 3, 30: 1, 31: 2, 32: 4, 33: 10, 34: 11, 35: 9, 36: 7 }[
          op
        ];
        if (op === 34)
          value = (o[0].mode | o[1].mode) & 0x20 ? (a | 0) >> (b & 31) : a >>> (b & 31);
        // The original unsigned /= handler stores the DIV remainder (EDX).
        else if (op === 32 && !((o[0].mode | o[1].mode) & 0x24))
          value = b ? (a >>> 0) % (b >>> 0) : 0;
        else if (op === 32 && (o[0].mode | o[1].mode) & 4 && bitsFloat(b) === 0) value = b;
        else if (op === 29 || op === 30) value = arithmetic(alias, b, a, o[1].mode, o[0].mode);
        else value = arithmetic(alias, a, b, o[0].mode, o[1].mode);
      }
      this.store(address, value, o[0].width);
      this.push(op === 21 && o[0].width < 4 ? this.load(address, o[0].width) : value);
    } else if (op >= 22 && op <= 25) {
      const address = this.raw(o[0]),
        old = this.load(address);
      if (op >= 24) this.push(old);
      const delta = op === 22 || op === 24 ? 1 : -1;
      if ([1, 2, 3, 4].includes(o[0].mode & 15)) {
        const width = (o[0].mode & 15) === 1 ? 1 : (o[0].mode & 15) === 2 ? 2 : 4;
        const previous = this.load(address, width);
        this.store(
          address,
          o[0].float ? floatBits(bitsFloat(old) + delta) : previous + delta,
          width,
        );
      }
      if (op <= 23) this.push(this.load(address));
    } else if (op === 37) {
      // PUSH copies four raw bytes; POP-without-dereference is already on the stack.
      if (!(o[0].mode & 0x40) || o[0].mode & 0x10) {
        const address = this.raw(o[0]);
        this.push(o[0].mode & 0x10 ? this.load(address) : address);
      }
    } else if (op === 38) {
      const address = this.raw(o[0]),
        value = this.pop();
      if ([1, 2, 3, 4].includes(o[0].mode & 15))
        this.store(address, value, (o[0].mode & 15) === 1 ? 1 : (o[0].mode & 15) === 2 ? 2 : 4);
    } else if (op === 39 || op === 40) {
      const address = read(0),
        condition = this.pop();
      if ((condition === 0) === (op === 39)) next = address;
      this.sp = this.floor;
    } else if (op === 41) {
      next = read(0);
      this.sp = this.floor;
    } else if (op === 42) {
      const address = read(0),
        count = read(1),
        frame = this.sp - count;
      if (count % 4 || count > this.sp) throw new Error('KCS bad call frame');
      this.debug.scopes.push(this.debug.locals.length);
      if (this.executionMode === 3) {
        this.executionMode = 1;
        this.debugBreakPC = next;
      }
      this.push(next);
      this.push(this.fp);
      this.push(this.floor);
      this.fp = frame;
      this.floor = this.sp;
      this.depth++;
      next = address;
    } else if (op === 43) {
      const id = read(0),
        count = read(1);
      if (count % 4 || count > this.sp) throw new Error('KCS invalid native arguments');
      this.sp -= count;
      this.nativeArgumentBase = this.sp;
      const args = Array.from({ length: count / 4 }, (_, i) => this.load(this.sp + i * 4));
      if (!this.host?.native) throw new Error(`KCS native host absent for ${id.toString(16)}`);
      const reply = this.host.native(id, args, this);
      next = this.completeNative(reply, instructionPC, next, count, { id, args });
    } else if (op === 44) {
      const size = read(0),
        count = read(1);
      if (size > this.sp || this.fp + count + 12 > this.memory.length)
        throw new Error('KCS invalid return frame');
      const result = this.bytes(this.sp - size, size).slice();
      this.sp = this.fp + count + 12;
      this.floor = this.pop();
      this.fp = this.pop();
      next = this.pop();
      if (count > this.sp) throw new Error('KCS invalid return arguments');
      this.sp -= count;
      this.bytes(this.sp, size).set(result);
      this.sp += size;
      this.depth = Math.max(0, this.depth - 1);
      this.debug.functions.pop();
      this.debug.scopes.pop();
    } else if (op === 45) this.pop();
    else if (op === 46) this.push(this.raw(o[0]));
    else if (op === 47) this.push(this.load(this.raw(o[0])));
    else if (op === 48) {
      const address = this.raw(o[0]),
        count = read(1);
      if (count > this.sp) throw new Error('KCS invalid stack copy');
      this.bytes(address, count).set(this.bytes(this.sp - count, count).slice());
    } else if (op === 49 || op === 50) {
      const count = read(0),
        floor = this.floor + (op === 49 ? count : -count);
      if (floor < 0 || floor >= this.memory.length) throw new Error('KCS stack overflow/underflow');
      this.floor = this.sp = floor;
    } else if (op === 51) this.switchValue = this.pop();
    else if (op === 52) {
      const value = read(0),
        address = read(1);
      if (this.switchValue === value) next = address;
    } else if (op === 53) {
      const a = read(0),
        b = read(1),
        address = read(2);
      if (this.switchValue >= Math.min(a, b) && this.switchValue <= Math.max(a, b)) next = address;
    } else if (op === 54 || op === 55)
      this.push(floatBits(op === 54 ? read(0) >>> 0 : read(0) | 0));
    else if (op === 56 || op === 57) {
      const value = bitsFloat(read(0));
      this.push(
        op === 56
          ? Number.isFinite(value) && value >= -(2 ** 63) && value < 2 ** 63
            ? Math.trunc(value) >>> 0
            : 0
          : Number.isFinite(value) && value >= -2147483648 && value < 2147483648
            ? Math.trunc(value) >>> 0
            : 0x80000000,
      );
    } else if (op === 58) {
      const value = this.pop();
      this.push(value);
      this.push(value);
    } else if (op === 60) this.sp = this.floor;
    else if (op === 61) this.push(this.fp + read(0));
    else if (op === 62) {
      const raw = this.raw(o[0]),
        a = o[0].mode & 0x10 ? this.load(raw) : raw,
        b = read(1);
      this.push(a + b);
    } else if (op === 65) {
      this.debug.line = read(0);
      this.debug.file = this.string(read(1));
      this.debug.sourceInitialized = true;
    } else if (op === 66) {
      if (this.debug.functions.length >= 256) throw new Error('KCS debug function stack overflow');
      this.debug.functions.push(read(0));
    } else if (op === 67) {
      const first = read(0),
        count = read(1);
      for (let i = 0; i < count; i++) this.debug.locals.push(first + i);
    } else if (op === 68) {
      const count = read(0);
      if (count > this.debug.locals.length) throw new Error('KCS debug scope underflow');
      this.debug.locals.length -= count;
    }
    this.pc = next >>> 0;
  }
  resume() {
    this.waiting = null;
    this.suspended = false;
  }
  setExecutionMode(mode) {
    this.executionMode = mode >>> 0;
    this.debugBreakPC = 0xffffffff;
  }
  debugSymbol(index, global, destination) {
    return nativeDebugSymbol(this, index, global, destination);
  }
  debugValue(descriptor) {
    return nativeDebugValue(this, descriptor, { relative: true });
  }
  run(
    options = 5000000 /* exe-address-check: non-address - instruction budget */,
    stop = () => false,
  ) {
    const {
      budget = 5000000 /* exe-address-check: non-address - instruction budget */,
      yieldOnBudget = false,
    } = typeof options === 'number' ? { budget: options } : options;
    if (!Number.isSafeInteger(budget) || budget < 1)
      throw new Error('KCS invalid instruction budget');
    this.suspended = false;
    let executed = 0;
    while (!this.halted && !this.waiting && !this.suspended && !stop()) {
      if (this.pc === this.script.codeSize) {
        this.halted = true;
        break;
      }
      if (executed >= budget) {
        if (yieldOnBudget) return { status: 'budget', executed };
        throw new Error(`KCS instruction budget at ${this.pc.toString(16)}`);
      }
      try {
        this.step();
      } catch (error) {
        error.kcs = {
          script: this.script.name || null,
          pc: this.pc,
          ...structuredClone(this.debug),
        };
        throw error;
      }
      executed++;
    }
    return {
      status: this.halted
        ? 'halted'
        : this.waiting
          ? 'waiting'
          : this.suspended
            ? 'yielded'
            : 'stopped',
      executed,
    };
  }
  snapshot() {
    return {
      memory: this.memory.slice(),
      memoryID: this.memoryID,
      blocks: this.blocks.map((block) => block.slice()),
      blockIDs: this.blockIDs,
      nextBlockID: this.nextBlockID,
      pc: this.pc,
      sp: this.sp,
      floor: this.floor,
      fp: this.fp,
      depth: this.depth,
      switchValue: this.switchValue,
      halted: this.halted,
      suspended: this.suspended,
      waiting: structuredClone(this.waiting),
      steps: this.steps,
      debug: structuredClone(this.debug),
      executionMode: this.executionMode,
      debugBreakPC: this.debugBreakPC,
      debugHook: this.debugHook,
    };
  }
  restore(state) {
    if (!(state.memory instanceof Uint8Array) || state.memory.length !== this.memory.length)
      throw new Error('KCS checkpoint memory does not match script');
    for (const key of ['sp', 'floor', 'fp'])
      if (!Number.isInteger(state[key]) || state[key] < 0 || state[key] > this.memory.length)
        throw new Error(`KCS invalid checkpoint ${key}`);
    if (!Number.isInteger(state.pc) || state.pc < 0 || state.pc > this.script.codeSize)
      throw new Error('KCS invalid checkpoint PC');
    this.allocatorBinding = null;
    this.memory.set(state.memory);
    if (
      !Number.isSafeInteger(state.memoryID) ||
      state.memoryID < 1 ||
      !Number.isSafeInteger(state.nextBlockID) ||
      state.nextBlockID < 1 ||
      !Array.isArray(state.blockIDs) ||
      state.blockIDs.length !== state.blocks.length ||
      new Set(state.blockIDs).size !== state.blockIDs.length ||
      state.blockIDs.some((id) => !Number.isSafeInteger(id) || id < 1 || id >= state.nextBlockID)
    )
      throw new Error('KCS checkpoint allocation identities are invalid');
    this.memoryID = state.memoryID;
    nextMemoryID = Math.max(nextMemoryID, this.memoryID + 1);
    this.nextBlockID = state.nextBlockID;
    this.blockStorage = state.blocks.map((bytes, index) => ({
      id: state.blockIDs[index],
      storage: new Uint8Array(bytes),
      binding: null,
    }));
    for (const key of [
      'pc',
      'sp',
      'floor',
      'fp',
      'depth',
      'switchValue',
      'halted',
      'suspended',
      'steps',
      'executionMode',
      'debugBreakPC',
      'debugHook',
    ])
      this[key] = state[key];
    this.waiting = structuredClone(state.waiting);
    this.debug = structuredClone(state.debug);
  }
}
