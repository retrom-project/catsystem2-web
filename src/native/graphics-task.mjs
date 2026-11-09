// SPDX-License-Identifier: MPL-2.0
// The mounted SimplePlane/BasePlane packet receiver owns task state. Host
// clients marshal packets; original graph/model methods retain their ABI.
import { mapABIMessage } from './abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';

export function conditionalNativeGraphicsBoundary(engine, address, name, count, accepts, callback) {
  const p = engine.process,
    boundary = { trap: p.trap(name, count, callback) };
  boundary.detach = p.beforeInstruction(address, name, () => {
    const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
      args = Array.from({ length: count }, (_, i) => p.load(sp + 4 + i * 4));
    if (accepts(args)) p.cpu.reg_write_i32(p.uc.X86_REG_EIP, boundary.trap);
  });
  return boundary;
}

const INPUT_BYTES = new Map([
  [41, 32],
  [42, 32],
  [46, 40],
  [49, 12],
  [51, 12],
  [53, 12],
  [55, 12],
  [56, 12],
  [57, 64],
  [58, 64],
  [66, 12],
  [67, 12],
  [72, 48],
  [80, 128],
  [89, 24],
  [100, 16],
]);

export class NativeGraphicsPacket {
  constructor(words = []) {
    this.data = new Uint8Array(Math.max(64, words.length * 4));
    this.view = new DataView(this.data.buffer);
    words.forEach((word, i) => this.store(i * 4, word));
  }
  load(address) {
    return this.view.getUint32(address, true);
  }
  store(address, word) {
    this.view.setUint32(address, word, true);
  }
  bytes(address, size) {
    if (address < 0 || address + size > this.data.length)
      throw new RangeError('Native graphics packet bounds');
    return this.data.subarray(address, address + size);
  }
}

export class NativePlaneReceiver {
  constructor(task) {
    Object.assign(this, {
      task,
      world: task.world,
      platform: task.nativePlatform,
      taskMemory: task.taskMemory,
      engine: task.world.nativeEngine,
    });
    if (!task.nativeLayout || !task.pointer || ![2, 6].includes(task.record.kind))
      throw new Error('Original plane receiver requires its actual derived task');
    this.process = this.engine.process;
    this.platform.enableOriginalTask(task);
  }
  invoke(address, args, context = {}) {
    const options = this.taskMemory.messageOptions(this.task.record, context);
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, this.task.pointer, options)
      : this.engine.call(address, args, this.task.pointer, options);
  }
  async message([sender, message, w, l], context = {}) {
    const p = this.process,
      record = this.task.record,
      memory =
        context.payload ||
        context.machine ||
        this.world.objects.machine(context.nativeSenderWorldID ?? sender),
      allocations = [],
      copies = [],
      allocate = (bytes) => {
        const pointer = p.allocate(bytes.length, true);
        allocations.push(pointer);
        p.write(pointer, bytes);
        return pointer;
      },
      read = (address, size) => {
        if (!memory) throw new Error(`Original plane message ${message} requires sender memory`);
        const bytes = memory.bytes ? memory.bytes(address, size) : memory.read(address, size);
        if (bytes.length !== size) throw new RangeError(`Original plane message ${message} bounds`);
        return bytes;
      },
      copy = (address, size, output = false) => {
        const pointer = allocate(read(address, size));
        if (output)
          copies.push(() => {
            const bytes = p.read(pointer, size);
            if (typeof memory.write === 'function') memory.write(address, bytes);
            else memory.bytes(address, size).set(bytes);
          });
        return pointer;
      },
      name = (address, prefix) => {
        const bytes = prefix ? [...read(address, prefix)] : [];
        for (let i = 0; i < 256; i++) {
          const byte = read(address + prefix + i, 1)[0];
          bytes.push(byte);
          if (!byte) return allocate(Uint8Array.from(bytes));
        }
        throw new RangeError('Original plane resource name exceeds its 256-byte buffer');
      };
    let writes;
    try {
      if (record.kind === 2 && (message === 43 || message === 44)) {
        await this.world.getNativeFeature('directshow');
        if (message === 44) await this.world.getNativeFeature('texture-movie-renderer');
      }
      if (!context.nativePointer) {
        if (message === 16)
          l = copy(l, await this.world.engineMessages.dumpSize(record, context), true);
        else if (message === 6) {
          w = copy(w, 8);
          l = copy(l, 8);
        } else if (INPUT_BYTES.has(message)) l = copy(l, INPUT_BYTES.get(message));
        else if ([50, 52].includes(message) && w) l = copy(l, 12);
        else if ([61, 62].includes(message)) l = copy(l, 12, true);
        else if (message === 75 || message === 76) {
          const size = message === 75 ? 4 : 12;
          w = copy(w, size, true);
          l = copy(l, size, true);
        } else if ([87, 88].includes(message)) l = copy(l, 4, true);
        else if (message === 83) {
          if (w > 0x100000) throw new RangeError('Original plane mesh exceeds its record capacity');
          l = copy(l, w * 80);
        } else if ([43, 44, 69, 70].includes(message)) l = name(l, message < 69 ? 12 : 0);
        else if (message === 79 && w) l = copy(l, 52);
        else if (message === 97 && l)
          l = await this.engine.features.get('bitmap-memory').wrapper(l);
      }
      if (message === 2 && (context.nativeNewTask !== undefined || !context.nativePointer))
        l = await this.taskMemory.pointer(context.nativeNewTask ?? l);
      const packet = p.allocate(24, true);
      allocations.push(packet);
      const out = context.nativeResult || p.allocate(4, true);
      if (!context.nativeResult) allocations.push(out);
      [
        record.nativeID ?? record.id,
        sender,
        mapABIMessage(this.engine.profile, 'base', 'raw', message),
        w,
        l,
        context.flags ?? 0,
      ].forEach((word, i) => p.store(packet + i * 4, word));
      writes = p.watchWrites(out, 4);
      if (p.asyncEnabled) await this.taskMemory.push();
      try {
        const unhandled = await this.invoke(
          p.load(p.load(this.task.pointer) + 24),
          [packet, out],
          context,
        );
        context.nativeUnhandled = Boolean(unhandled);
      } catch (cause) {
        if (record.kind === 2 && [43, 44].includes(message))
          throw new Error(`Original plane movie message ${message}: ${cause.message}`, { cause });
        throw cause;
      }
      for (const write of copies) write();
      return writes.written ? p.load(out) : NATIVE_UNWRITTEN_WORD;
    } finally {
      writes?.close();
      for (const pointer of allocations) p.free(pointer);
    }
  }
  beforeChildren() {
    // BasePlane clears the input return word before BaseTask walks children.
    this.process.store(this.task.pointer + 120, 0);
  }
  async drawTick(frame) {
    const p = this.process,
      pointer = this.task.pointer;
    if (this.task.record.kind === 2 && p.load(pointer + 320) && p.load(pointer + 260))
      await this.invoke(p.load(p.load(pointer) + 12), [frame >>> 0]);
  }
  close() {
    this.platform.originalTasks.delete(this.task.record.id);
  }
}
