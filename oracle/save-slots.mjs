// SPDX-License-Identifier: MPL-2.0
// FES save commands consume the global-file object prepared by the system KCS.
// Original handlers and file helpers execute in the shared engine process.
export const NATIVE_FES_SAVE_HANDLERS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    saveexist: 0x77b810,
    datasave: 0x77bac0,
    savedelete: 0x77f0b0,
    saveexchg: 0x77f180,
    savecopy: 0x77f2a0,
    newsave: 0x77f4c0,
    saveapend_str: 0x77fad0,
    saveget_str: 0x77fc50,
    sortsave: 0x782060,
    sortsave2: 0x782320,
    saveget_date: 0x7858e0,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    saveexist: 0x615080,
    datasave: 0x615330,
    savedelete: 0x618380,
    saveexchg: 0x618450,
    savecopy: 0x618570,
    newsave: 0x618790,
    saveapend_str: 0x618d90,
    saveget_str: 0x618f10,
    sortsave: 0x61b220,
    sortsave2: 0x61b4c0,
    saveget_date: 0x61e960,
  }),
});
export const NATIVE_FES_SAVE_COMMANDS = Object.freeze(
  Object.keys(NATIVE_FES_SAVE_HANDLERS['nekopara-vol3-engine-2.6.1.76']),
);

export class NativeSaveSlots {
  constructor(world) {
    this.world = world;
    this.handlers = NATIVE_FES_SAVE_HANDLERS[world.profile];
    if (!this.handlers) throw new Error('Native save slots require a reviewed engine profile');
  }
  supports(command) {
    return Object.hasOwn(this.handlers, command);
  }
  async command(instance, command, source) {
    if (!this.supports(command)) throw new Error(`Unknown native FES save command ${command}`);
    const world = this.world,
      record = world.objects.objects.get(instance.runtimeID);
    if (!record || record.kind !== 34)
      throw new Error('Native FES save command requires its live interpreter task');
    if (typeof record.context.contextName !== 'string')
      throw new Error('Native FES save command requires its initialized context directory');
    const runtime = await world.getNativeFeature('fes-objects'),
      buffers = await world.getNativeFeature('data-buffers'),
      p = runtime.process,
      projections = new Map();
    const project = (handle) => {
      if (!handle) return 0;
      if (projections.has(handle)) return projections.get(handle).pointer;
      const file = world.runtime.handles.get(handle, 'global-file'),
        payload = file.payload(),
        data = buffers.allocateData(payload.length),
        inner = p.allocate(16),
        pointer = p.allocate(4);
      p.write(data, payload);
      [data, file.capacity, payload.length, file.tag].forEach((value, i) =>
        p.store(inner + i * 4, value),
      );
      p.store(pointer, inner);
      projections.set(handle, { pointer, inner, data });
      return pointer;
    };
    try {
      return await runtime.commonCommand(instance, this.handlers[command], source, {
        contextName: record.context.contextName,
        evaluate: (text, tokenIndex) => {
          const value = instance.value(text) >>> 0;
          // Slot number and file object are independent numeric expressions.
          // Only datasave's second argument denotes a CSS object pointer.
          return command === 'datasave' && tokenIndex === 2 ? project(value) : value;
        },
        setStringBytes: (index, bytes) => {
          const handle = record.context.stringBank;
          if (handle) world.runtime.handles.get(handle, 'string-bank').setBytes(index, bytes);
        },
      });
    } finally {
      for (const { pointer, inner, data } of projections.values()) {
        buffers.releaseData(data);
        p.free(inner);
        p.free(pointer);
      }
    }
  }
}
