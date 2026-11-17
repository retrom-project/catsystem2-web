// SPDX-License-Identifier: MPL-2.0
// Explicit remaining Windows/GDI consumer view. World owns JS text writers;
// this view owns only the already-mounted engine's Windows handle checkpoint.
import { NativeTextWindows } from './text-windows.mjs';

export class NativeTextConsumerView {
  constructor(engine, core) {
    if (!core?.writers || core.profile !== engine.profile)
      throw new TypeError('Text consumer view requires the owning World text runtime');
    this.engine = engine;
    this.core = core;
    this.windows = engine.textWindows ??= new NativeTextWindows(engine.process, {
      glyphs: core.glyphs,
      kernel: engine.kernel,
    });
    // Only this explicit legacy boundary supplies process-backed byte inputs.
    // Ordinary text creation and drawing never request or attach the engine.
    core.originalStringBytes = this.stringBytes = (address) => engine.process.stringBytes(address);
    core.originalInput = this.inputBytes = async (bytes, fn) => {
      const p = engine.process,
        at = p.allocate(bytes.length, true);
      try {
        p.write(at, bytes);
        return await fn(at);
      } finally {
        p.free(at);
      }
    };
    for (const [name, definition] of this.windows.definitions)
      engine.registerWindows(
        /^(?:SetRect|CopyRect|IsRect|EqualRect|IntersectRect|UnionRect|OffsetRect|InflateRect|GetDC|ReleaseDC|FillRect)/.test(
          name,
        )
          ? 'USER32.dll'
          : /^lstr/.test(name)
            ? 'KERNEL32.dll'
            : 'GDI32.dll',
        name,
        definition,
      );
    const view = new Proxy(this, {
      get(target, key, receiver) {
        if (key in target) return Reflect.get(target, key, receiver);
        const value = core[key];
        return typeof value === 'function' ? value.bind(core) : value;
      },
      set(target, key, value, receiver) {
        if (key in target) return Reflect.set(target, key, value, receiver);
        core[key] = value;
        return true;
      },
    });
    engine.registerFeature('text', view);
    return view;
  }
  snapshot() {
    return { windows: this.windows.snapshot() };
  }
  restore(state) {
    this.windows.restore(state.windows);
  }
  close() {
    if (this.core.originalStringBytes === this.stringBytes) delete this.core.originalStringBytes;
    if (this.core.originalInput === this.inputBytes) delete this.core.originalInput;
  }
}
