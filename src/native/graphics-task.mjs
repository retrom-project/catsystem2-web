// SPDX-License-Identifier: MPL-2.0
// The mounted SimplePlane/BasePlane packet receiver owns task state. Host
// clients marshal packets; original graph/model methods retain their ABI.
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
  [50, 12],
  [51, 12],
  [52, 12],
  [53, 12],
  [55, 12],
  [56, 12],
  [57, 64],
  [58, 64],
  [66, 12],
  [67, 12],
  [72, 64],
  [80, 128],
  [89, 24],
  [100, 16],
]);

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
      copy = (address, size, output = false) => {
        if (!memory) throw new Error(`Original plane message ${message} requires sender memory`);
        const bytes =
            typeof memory.bytes === 'function'
              ? memory.bytes(address, size)
              : memory.read(address, size),
          pointer = allocate(bytes);
        if (output)
          copies.push(() => {
            const bytes = p.read(pointer, size);
            if (typeof memory.write === 'function') memory.write(address, bytes);
            else memory.bytes(address, size).set(bytes);
          });
        return pointer;
      };
    if (!context.nativePointer) {
      if (INPUT_BYTES.has(message)) l = copy(l, INPUT_BYTES.get(message));
      else if ([61, 62].includes(message)) l = copy(l, 12, true);
      else if (message === 75 || message === 76) {
        const size = message === 75 ? 4 : 12;
        w = copy(w, size, true);
        l = copy(l, size, true);
      } else if ([87, 88].includes(message)) l = copy(l, 4, true);
      else if (message === 83) {
        if (w > 0x100000) throw new RangeError('Original plane mesh exceeds its record capacity');
        l = copy(l, w * 80);
      } else if ([69, 70, 79].includes(message) && (message !== 79 || w)) {
        if (!memory) throw new Error('Original plane resource requires source bytes');
        const bytes = [];
        for (let i = 0; i < 1024 * 1024; i++) {
          const byte = (memory.bytes ? memory.bytes(l + i, 1) : memory.read(l + i, 1))[0];
          bytes.push(byte);
          if (!byte) break;
          if (i === 1024 * 1024 - 1)
            throw new RangeError('Original plane resource name exceeds its source bounds');
        }
        l = allocate(Uint8Array.from(bytes));
      } else if ([43, 44, 97].includes(message))
        throw new Error(`Original plane message ${message} requires its native resource packet`);
    }
    if (message === 2 && context.nativeNewTask !== undefined)
      l = await this.taskMemory.pointer(context.nativeNewTask);
    const packet = p.allocate(24, true),
      out = context.nativeResult || p.allocate(4, true);
    allocations.push(packet);
    if (!context.nativeResult) allocations.push(out);
    [
      record.nativeID ?? record.id,
      sender,
      this.engine.profile.startsWith('sdk-') && message >= 39 ? message - 2 : message,
      w,
      l,
      context.flags ?? 0,
    ].forEach((word, i) => p.store(packet + i * 4, word));
    const writes = p.watchWrites(out, 4);
    try {
      if (p.asyncEnabled) await this.taskMemory.push();
      const unhandled = await this.invoke(
        p.load(p.load(this.task.pointer) + 24),
        [packet, out],
        context,
      );
      context.nativeUnhandled = Boolean(unhandled);
      for (const write of copies) write();
      return writes.written ? p.load(out) : NATIVE_UNWRITTEN_WORD;
    } finally {
      writes.close();
      for (const pointer of allocations) p.free(pointer);
    }
  }
  async frame(frame, drawing = false) {
    const p = this.process,
      output = p.allocate(4, true);
    try {
      await this.invoke(
        p.load(p.load(this.task.pointer) + (drawing ? 12 : 8)),
        drawing ? [frame >>> 0] : [frame >>> 0, output],
      );
    } finally {
      p.free(output);
    }
  }
  close() {
    this.platform.originalTasks.delete(this.task.record.id);
  }
}
