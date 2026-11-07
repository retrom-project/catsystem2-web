// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit KCScript / KCSMachine (OWCramer).
import { Binary, inflate, boundedCount } from './binary.mjs';

const one = new Set([
  8, 12, 22, 23, 24, 25, 26, 37, 39, 40, 41, 46, 47, 49, 50, 54, 55, 56, 57, 61,
]);
const zero = new Set([51, 59, 60]);
export async function readKCS(bytes) {
  const b = new Binary(bytes, 'KCS');
  if (!b.magic('KCS\0') || b.u32(4) !== 2 || b.u32(12) !== 52)
    throw new Error('Unsupported KCS header');
  const codeSize = boundedCount(b.u32(16), 64 * 1024 * 1024, 'KCS code'),
    count = boundedCount(b.u32(24), 1000000, 'KCS strings');
  const body = new Binary(
    await inflate(b.range(52, bytes.length - 52), codeSize + b.u32(28)),
    'KCS body',
  );
  const data = new Uint8Array(boundedCount(b.u32(32), 64 * 1024 * 1024, 'KCS data')),
    strings = new Map();
  for (let i = 0; i < count; i++) {
    const at = codeSize + body.u32(codeSize + i * 8),
      dest = body.u32(codeSize + i * 8 + 4);
    const end = body.bytes.indexOf(0, at);
    if (end < at || dest + end - at >= data.length) throw new Error('KCS invalid string');
    data.set(body.range(at, end - at), dest);
    strings.set(dest, body.str(at));
  }
  return {
    body,
    codeSize,
    data,
    strings,
    stackSize: boundedCount(b.u32(36), 16 * 1024 * 1024, 'KCS stack'),
  };
}

const floatBuffer = new DataView(new ArrayBuffer(4));
const float = (v) => {
  floatBuffer.setUint32(0, v, true);
  return floatBuffer.getFloat32(0, true);
};
const bits = (v) => {
  floatBuffer.setFloat32(0, v, true);
  return floatBuffer.getUint32(0, true);
};
const aliases = { 27: 5, 28: 6, 29: 4, 30: 1, 31: 2, 32: 3, 33: 9, 34: 10, 35: 11, 36: 7 };

function apply(op, a, b, isFloat) {
  op = aliases[op] || op;
  const x = isFloat ? float(a) : a | 0,
    y = isFloat ? float(b) : b | 0;
  let v;
  switch (op) {
    case 1:
      v = x + y;
      break;
    case 2:
      v = x - y;
      break;
    case 3:
      v = isFloat ? x * y : Math.imul(x, y);
      break;
    case 4:
      v = y ? x / y : 0;
      break;
    case 5:
      return (y ? x % y : 0) >>> 0;
    case 6:
      return (a & b) >>> 0;
    case 7:
      return (a | b) >>> 0;
    case 9:
      return (a ^ b) >>> 0;
    case 10:
      return (a << (b & 31)) >>> 0;
    case 11:
      return (x >> (b & 31)) >>> 0;
    case 13:
      return Number(!!x && !!y);
    case 14:
      return Number(!!x || !!y);
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
      throw new Error(`Invalid arithmetic opcode ${op}`);
  }
  return isFloat ? bits(v) : v >>> 0;
}

export class KCSMachine {
  constructor(script, host, shared = new Uint8Array(1024 * 1024)) {
    this.script = script;
    this.host = host;
    this.data = script.data.slice();
    this.stack = new Uint8Array(Math.max(script.stackSize, 1024 * 1024));
    this.shared = shared;
    this.pc = 0;
    this.sp = 0;
    this.fp = 0;
    this.depth = 0;
    this.steps = 0;
    this.halted = false;
  }
  instruction(at = this.pc) {
    const b = this.script.body,
      op = b.u8(at);
    if (!op || op > 62 || [38, 45, 48, 58].includes(op))
      throw new Error(`KCS unknown opcode ${op} at ${at}`);
    const count = zero.has(op) ? 0 : one.has(op) ? 1 : op === 53 ? 3 : 2;
    if (at + 1 + count * 5 > this.script.codeSize)
      throw new Error(`KCS instruction exceeds code at ${at}`);
    const args = Array.from({ length: count }, (_, i) => {
      const p = at + 1 + i * 5,
        mode = b.u8(p);
      return {
        mode,
        value: b.u32(p + 1),
        width: mode & 128 ? 4 : (mode & 15) === 1 ? 1 : (mode & 15) === 2 ? 2 : 4,
        float: !(mode & 128) && (mode & 15) === 4,
      };
    });
    return { op, args, size: 1 + count * 5 };
  }
  region(address, count) {
    address >>>= 0;
    const [buffer, at] =
      address >= 0x80000000
        ? [this.shared, address - 0x80000000]
        : address >= 0x40000000
          ? [this.stack, address - 0x40000000]
          : [this.data, address];
    if (at + count > buffer.length || count < 0)
      throw new Error(`KCS memory ${address.toString(16)}+${count} at pc ${this.pc.toString(16)}`);
    return [new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength), at];
  }
  load(address, width = 4) {
    const [b, at] = this.region(address, width);
    return (
      (width === 1 ? b.getInt8(at) : width === 2 ? b.getInt16(at, true) : b.getUint32(at, true)) >>>
      0
    );
  }
  store(address, value, width = 4) {
    const [b, at] = this.region(address, width);
    if (width === 1) b.setUint8(at, value);
    else if (width === 2) b.setUint16(at, value, true);
    else b.setUint32(at, value, true);
  }
  push(v) {
    this.store(0x40000000 + this.sp, v);
    this.sp += 4;
  }
  pop() {
    if (this.sp < 4) throw new Error(`KCS stack underflow at ${this.pc}`);
    this.sp -= 4;
    return this.load(0x40000000 + this.sp);
  }
  read(o) {
    const v = o.mode & 64 ? this.pop() : o.value;
    return o.mode & 16 ? this.load(v, o.width) : v;
  }
  address(o) {
    if (!(o.mode & 16)) throw new Error('KCS expected address operand');
    return o.mode & 64 ? this.pop() : o.value;
  }
  string(address) {
    const bytes = [];
    for (let i = 0; i < 65536; i++) {
      const v = this.load(address + i, 1) & 255;
      if (!v) return new TextDecoder('shift_jis').decode(new Uint8Array(bytes));
      bytes.push(v);
    }
    throw new Error('KCS unterminated string');
  }
  writeString(text, address) {
    const bytes = encodeCP932(text);
    for (let i = 0; i <= bytes.length; i++) this.store(address + i, bytes[i] || 0, 1);
  }
  copyString(dest, source) {
    for (let i = 0; i < 65536; i++) {
      const b = this.load(source + i, 1);
      this.store(dest + i, b, 1);
      if (!(b & 255)) return;
    }
    throw new Error('KCS unterminated string');
  }
  step() {
    const { op, args: o, size } = this.instruction();
    let next = this.pc + size;
    this.steps++;
    const read = (i) => this.read(o[i]),
      push = (v) => this.push(v);
    if (op <= 20 && ![8, 12].includes(op))
      push(apply(op, read(0), read(1), o[0].float || o[1].float));
    else if (op === 8) push(~read(0));
    else if (op === 12) {
      const v = read(0);
      push(Number((o[0].float ? float(v) : v) === 0));
    } else if (op === 26) {
      const v = read(0);
      push(o[0].float ? bits(-float(v)) : -v);
    } else if (op === 21 || (op >= 27 && op <= 36)) {
      const at = this.address(o[0]);
      let v = read(1);
      if (op === 21 && o[0].float !== o[1].float && !(o[0].mode & 128) && !(o[1].mode & 128))
        v = o[0].float ? bits(v | 0) : float(v) >>> 0;
      if (op !== 21) v = apply(op, this.load(at, o[0].width), v, o[0].float || o[1].float);
      this.store(at, v, o[0].width);
      push(v);
    } else if (op >= 22 && op <= 25) {
      const at = this.address(o[0]),
        old = this.load(at, o[0].width),
        delta = op === 22 || op === 24 ? 1 : -1;
      const value = o[0].float ? bits(float(old) + delta) : old + delta;
      this.store(at, value, o[0].width);
      push(op <= 23 ? value : old);
    } else if ([37, 46, 47].includes(op)) push(read(0));
    else if (op === 39 || op === 40) {
      const at = read(0),
        value = this.pop();
      if ((value === 0) === (op === 39)) next = at;
    } else if (op === 41) next = read(0);
    else if (op === 42) {
      const at = read(0),
        count = read(1),
        frame = this.sp - count;
      if (frame < 0 || count % 4) throw new Error('KCS bad call frame');
      push(next);
      push(this.fp);
      push(this.depth);
      this.fp = frame;
      this.depth++;
      next = at;
    } else if (op === 43) {
      const id = read(0),
        count = read(1);
      if (count % 4 || count > this.sp) throw new Error('KCS invalid native arguments');
      const args = Array.from({ length: count / 4 }, () => this.pop()).reverse();
      push(this.host.native(id, args, this));
    } else if (op === 44) {
      const result = read(0) ? this.pop() : 0;
      if (!this.depth) {
        this.halted = true;
        return;
      }
      const header = this.fp + read(1);
      next = this.load(0x40000000 + header);
      const frame = this.load(0x40000000 + header + 4);
      this.depth = this.load(0x40000000 + header + 8);
      this.sp = this.fp;
      this.fp = frame;
      push(result);
    } else if (op === 49) {
      const n = read(0);
      if (this.sp + n > this.stack.length) throw new Error('KCS stack overflow');
      this.stack.fill(0, this.sp, this.sp + n);
      this.sp += n;
    } else if (op === 50) {
      const n = read(0);
      if (n > this.sp) throw new Error('KCS stack underflow');
      this.sp -= n;
    } else if (op === 51) {
      const value = this.pop();
      let at = next,
        target;
      while (at < this.script.codeSize) {
        const c = this.instruction(at);
        if (![52, 53].includes(c.op)) break;
        if (
          target === undefined &&
          (c.op === 52
            ? c.args[0].value === value
            : (value | 0) >= (c.args[0].value | 0) && (value | 0) <= (c.args[1].value | 0))
        )
          target = c.args.at(-1).value;
        at += c.size;
      }
      next = target ?? at;
    } else if (op === 54) push(bits(read(0)));
    else if (op === 55) push(bits(read(0) | 0));
    else if (op === 56 || op === 57) {
      const v = float(read(0));
      push(
        Number.isFinite(v) && (op === 56 ? v >= 0 && v < 4294967296 : Math.abs(v) < 2147483648)
          ? v
          : 0,
      );
    } else if (op === 59) this.halted = true;
    else if (op === 60) this.pop();
    else if (op === 61) push(0x40000000 + this.fp + read(0));
    else if (op === 62) push(read(0) + read(1));
    else if (![52, 53].includes(op)) throw new Error(`KCS unimplemented opcode ${op}`);
    this.pc = next;
  }
  run(limit = 5000000, stop = () => false) {
    let n = 0;
    while (!this.halted && !stop()) {
      if (++n > limit) throw new Error(`KCS instruction budget at ${this.pc.toString(16)}`);
      this.step();
    }
  }
}

let cp932;
export function encodeCP932(text) {
  if ([...text].every((c) => c.charCodeAt(0) < 128)) return new TextEncoder().encode(text);
  if (!cp932) {
    cp932 = new Map();
    const decoder = new TextDecoder('shift_jis', { fatal: true });
    for (let a = 0; a < 256; a++) {
      try {
        cp932.set(decoder.decode(new Uint8Array([a])), [a]);
      } catch {
        /* invalid lead */
      }
    }
    for (let a = 0x81; a <= 0xfc; a++)
      if (a <= 0x9f || a >= 0xe0)
        for (let b = 0x40; b <= 0xfc; b++) {
          try {
            const char = decoder.decode(new Uint8Array([a, b]));
            if (!cp932.has(char)) cp932.set(char, [a, b]);
          } catch {
            /* invalid trail */
          }
        }
  }
  return new Uint8Array([...text].flatMap((c) => cp932.get(c) || [63]));
}

export class BootHost {
  constructor(globals = {}, strings = {}) {
    this.globals = globals;
    this.strings = strings;
    this.calls = new Map();
    this.unimplemented = new Map();
    this.stopped = null;
    this.stopAt = new Set();
  }
  native(id, args, m) {
    this.calls.set(id, (this.calls.get(id) || 0) + 1);
    if (this.stopAt.has(id)) this.stopped = { id, args, text: m.string(args[1] || 0) };
    switch (id) {
      case 0x0d:
        m.copyString(args[0], args[1]);
        break;
      case 0x0e:
        m.writeString(formatNative(m.string(args[1]), m), args[0]);
        break;
      case 0xd2:
        return this.globals[args[0] | 0] || 0;
      case 0xd3:
        this.globals[args[0] | 0] = args[1] | 0;
        break;
      case 0x114:
        this.strings[args[0]] = m.string(args[1]);
        break;
      case 0x115:
        m.writeString(this.strings[args[0]] || '', args[1]);
        break;
      case 0x116: {
        const s = m.string(args[0]);
        m.writeString(
          s.replace(/\$str(\d+)/g, (_, n) => this.strings[n] || ''),
          args[0],
        );
        break;
      }
      case 0x146:
        return 0xffffffff;
      default:
        if (!this.stopAt.has(id)) this.unimplemented.set(id, (this.unimplemented.get(id) || 0) + 1);
        break; // Boot-only initialization calls remain explicit in the native call inventory.
    }
    return 0;
  }
}
export function formatNative(text, m) {
  return text
    .replace(/%([0-9.-]*)([dsxX])\[([LG])(\d+)\]/g, (_, width, type, region, offset) => {
      const at = Number(offset) + (region === 'L' ? 0x40000000 + m.fp : 0);
      let value =
        type === 's'
          ? m.string(at)
          : type === 'd'
            ? String(m.load(at) | 0)
            : m.load(at).toString(16);
      if (type === 'X') value = value.toUpperCase();
      return value.padStart(Number(width) || 0, width.startsWith('0') ? '0' : ' ');
    })
    .replaceAll('%%', '%');
}
