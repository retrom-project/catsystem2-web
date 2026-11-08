// SPDX-License-Identifier: MPL-2.0
// One MT state per original integer/real stream, shared by JS and PE callers.
export const NATIVE_RANDOM_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    integer: { seed: 0x5c2180, draw: 0x5c21d0, words: 0xbc9020, index: 0xb64358 },
    real: { seed: 0x5c1ff0, draw: 0x5c2040, words: 0xbc8660, index: 0xb64354 },
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    integer: { seed: 0x49e7c0, draw: 0x49e810, words: 0xcc8390, index: 0xc68d28 },
    real: { seed: 0x49e630, draw: 0x49e680, words: 0xcc79d0, index: 0xc68c24 },
  }),
});
export class NativeRandomMemory {
  constructor(engine, random) {
    if (!random?.integer?.bindState || !random?.real?.bindState)
      throw new Error('Native random memory requires both canonical MT streams');
    if (engine.features.has('random-memory'))
      throw new Error('Native random streams already have a process owner');
    this.engine = engine;
    this.random = random;
    this.layout = NATIVE_RANDOM_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error('Native random memory requires a reviewed engine profile');
    this.bindings = new Map();
    const p = engine.process;
    try {
      for (const name of ['integer', 'real']) {
        const stream = random[name],
          state = stream.snapshot(),
          layout = this.layout[name];
        if (stream.stateBinding)
          throw new Error('Canonical native random stream already belongs to another process');
        const binding = {
          words: () => {
            const bytes = p.view(layout.words, 624 * 4);
            return new Uint32Array(bytes.buffer, bytes.byteOffset, 624);
          },
          getIndex: () => {
            const bytes = p.view(layout.index, 4);
            return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
          },
          setIndex: (value) => {
            const bytes = p.view(layout.index, 4);
            new DataView(bytes.buffer, bytes.byteOffset, 4).setUint32(0, value >>> 0, true);
          },
        };
        binding.words().set(state.words);
        binding.setIndex(state.index);
        stream.bindState(binding);
        this.bindings.set(name, binding);
      }
    } catch (error) {
      for (const [name, binding] of this.bindings) random[name].unbindState(binding);
      throw error;
    }
    engine.registerFeature('random-memory', this);
  }
  snapshot() {
    return {};
  }
  restore() {
    for (const [name, binding] of this.bindings) {
      if (this.random[name].stateBinding !== binding)
        throw new Error('Canonical native random stream lost its process owner');
      const index = binding.getIndex();
      if (index > 625) throw new Error('Native random checkpoint index is invalid');
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const [name, binding] of this.bindings) this.random[name].unbindState(binding);
    this.bindings.clear();
  }
}
