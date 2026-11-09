// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeTextWindows } from './text-windows.mjs';
import { NativeDataBuffers } from './data-buffer.mjs';
import { NativeFESTextLayout } from './fes-text-layout.mjs';

export const NATIVE_TEXT_CORES = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': {
    cp932: {
      size: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.cp932.size,
      construct: 0x696c20,
      destroy: 0x696d70,
      configure: 0x697690,
      append: 0x696ed0,
      clear: 0x696ef0,
      mark: 0x696eb0,
      draw: 0x6970a0,
      remaining: 0x6975e0,
      parse: 0x6932a0,
      speed: 0x6978e0,
      shift: 0x697940,
      profile: 0x693050,
      position: 0x6975d0,
      lines: 0x694880,
      defaultPacket: 0x6353d0,
      defaultAt: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.cp932.defaultAt,
      configSize: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.cp932.configSize,
    },
    nv: {
      size: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.nv.size,
      construct: 0x69d740,
      destroy: 0x69d930,
      configure: 0x69e3a0,
      append: 0x69dff0,
      secondary: 0x69df30,
      clear: 0x69e0d0,
      mark: 0x69df10,
      draw: 0x69e200,
      remaining: 0x69e320,
      parse: 0x6932a0,
      speed: 0x69e800,
      position: 0x69e2d0,
      defaultPacket: 0x636fd0,
      configSize: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.nv.configSize,
      packetSize: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.nv.packetSize,
      bitmapAt: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.nv.bitmapAt,
      dirtyAt: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.nv.dirtyAt,
      section: 0x69dcf0,
      redraw: 0x69e720,
      reflow: 0x69e790,
      erase: 0x69e1c0,
    },
    utf8: {
      size: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.utf8.size,
      construct: 0x69c4e0,
      destroy: 0x69c5f0,
      configure: 0x69ce50,
      append: 0x69c750,
      clear: 0x69c770,
      mark: 0x69c730,
      draw: 0x69c830,
      remaining: 0x69cda0,
      parse: 0x698b80,
      speed: 0x6978e0,
      shift: 0x69d1f0,
      profile: 0x698960,
      position: 0x69cd80,
      lines: 0x69a260,
      defaultPacket: 0x636190,
      defaultAt: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.utf8.defaultAt,
      configSize: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.textCores.utf8.configSize,
    },
  },
  'sdk-4.01-engine-2.6.1.74': {
    nv: {
      size: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.nv.size,
      construct: 0x56eeb0,
      destroy: 0x56f0a0,
      configure: 0x56fab0,
      append: 0x56f710,
      secondary: 0x56f650,
      clear: 0x56f7f0,
      mark: 0x56f630,
      draw: 0x56f920,
      remaining: 0x56fa30,
      parse: 0x569d90,
      speed: 0x56fea0,
      position: 0x56f9f0,
      defaultPacket: 0x50d400,
      configSize: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.nv.configSize,
      packetSize: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.nv.packetSize,
      bitmapAt: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.nv.bitmapAt,
      dirtyAt: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.nv.dirtyAt,
      section: 0x56f460,
      redraw: 0x56fdc0,
      reflow: 0x56fe30,
      erase: 0x56f8e0,
    },
    cp932: {
      size: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.cp932.size,
      construct: 0x56db50,
      destroy: 0x56dc90,
      configure: 0x56e620,
      append: 0x56ddf0,
      clear: 0x56de10,
      mark: 0x56ddd0,
      draw: 0x56e010,
      remaining: 0x56e570,
      parse: 0x569d90,
      speed: 0x56e8d0,
      shift: 0x56e930,
      position: 0x56e560,
      profile: 0x569ad0,
      lines: 0x56b400,
      defaultPacket: 0x50c650,
      defaultAt: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.cp932.defaultAt,
      configSize: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.textCores.cp932.configSize,
    },
  },
});
const user32 = new Set(
  'SetRectEmpty SetRect CopyRect IsRectEmpty EqualRect IntersectRect UnionRect OffsetRect InflateRect GetDC ReleaseDC FillRect'.split(
    ' ',
  ),
);
const kernel32 = new Set(
  ['A', 'W'].flatMap((suffix) => [
    `lstrcpy${suffix}`,
    `lstrlen${suffix}`,
    `lstrcmp${suffix}`,
    `lstrcmpi${suffix}`,
  ]),
);
const utf16 = (text) => {
  const bytes = new Uint8Array((text.length + 1) * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return bytes;
};

export class NativeTextRuntime {
  constructor(engine, options = {}) {
    if (!NATIVE_TEXT_CORES[engine.profile])
      throw new Error('Native text requires a recovered engine image');
    Object.assign(this, { engine, process: engine.process });
    this.buffers = engine.features.get('data-buffers') || new NativeDataBuffers(engine);
    this.windows =
      engine.textWindows ??
      new NativeTextWindows(engine.process, { ...options, kernel: engine.kernel });
    for (const [name, definition] of this.windows.definitions)
      engine.registerWindows(
        user32.has(name) ? 'USER32.dll' : kernel32.has(name) ? 'KERNEL32.dll' : 'GDI32.dll',
        name,
        definition,
      );
    this.writers = new Map();
    engine.registerFeature('text', this);
  }
  call(address, args = [], pointer) {
    return this.hostCalls
      ? this.engine.callFromHost(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  async fromHost(callback) {
    this.hostCalls = (this.hostCalls || 0) + 1;
    try {
      return await callback();
    } finally {
      this.hostCalls--;
    }
  }
  bindings(mode) {
    const bindings = NATIVE_TEXT_CORES[this.engine.profile][mode];
    if (!bindings)
      throw new Error(`Native text mode ${mode} is unavailable in ${this.engine.profile}`);
    return bindings;
  }
  async create(mode, config = null) {
    const bindings = this.bindings(mode),
      pointer = this.process.allocate(bindings.size, true),
      writer = new (mode === 'nv' ? NativeNVTextWriter : NativeTextWriter)(this, {
        pointer,
        mode,
        config: null,
      });
    this.writers.set(pointer, writer);
    try {
      await this.call(bindings.construct, [0, 4], pointer);
      if (config) await writer.configure(config);
      return writer;
    } catch (error) {
      this.writers.delete(pointer);
      this.process.free(pointer);
      throw error;
    }
  }
  async fesLayout(type) {
    const profile = this.engine.profile,
      constructor = profile.startsWith('sdk-')
        ? type === 21
          ? 0x5ee900
          : null
        : type === 21
          ? 0x74e540
          : type === 37
            ? 0x752eb0
            : null;
    if (!constructor)
      throw new Error(`Native FES text object ${type} is unavailable in ${profile}`);
    const p = this.process,
      pointer = p.allocate(0x800, true);
    const cache = profile.startsWith('sdk-') ? 0xc967ec : 0xb91e54,
      initializeCache = profile.startsWith('sdk-') ? 0x622ad0 : 0x78a9d0;
    // The FES base owns a MOT manager. Its destructor also visits this shared
    // cache, normally constructed by a C++ static initializer. Invoke that
    // exact list constructor without running the executable startup table.
    if (!p.load(cache)) p.store(cache, await this.call(initializeCache, [0, 0], cache));
    let constructed = false;
    try {
      await this.call(constructor, [0], pointer);
      constructed = true;
      const layout = new NativeFESTextLayout({ profile, type }),
        abi = layout.abi;
      // Keep the font record and public layout fields. C++ container and
      // motion-manager pointers remain owned by the temporary native object.
      layout.bytes.set(p.read(pointer + 764, abi.configBytes), 764);
      for (const index of [
        44,
        45,
        ...Array.from({ length: 4 }, (_, i) => abi.flags - 1 + i),
        ...Array.from({ length: 3 }, (_, i) => abi.colors + i),
      ])
        layout.word(index, p.load(pointer + index * 4));
      return layout;
    } finally {
      if (constructed) await this.call(p.load(p.load(pointer)), [1], pointer);
      else p.free(pointer);
    }
  }
  get(pointer) {
    const writer = this.writers.get(pointer >>> 0);
    if (!writer) throw new Error(`Native text writer ${pointer} is not active`);
    return writer;
  }
  async defaultPacket(mode) {
    const bindings = this.bindings(mode),
      size = bindings.packetSize ?? bindings.configSize + 16,
      pointer = this.process.allocate(size, true);
    try {
      await this.call(bindings.defaultPacket, [pointer]);
      return this.process.read(pointer, size);
    } finally {
      this.process.free(pointer);
    }
  }
  async resourceMessage(writer, operation, w, l) {
    if (
      ![9, 10, 13, 19].includes(operation) ||
      (writer.mode === 'nv' && ![9, 10].includes(operation))
    )
      throw new Error(
        `Native text resource operation ${operation} is not a pure resource boundary`,
      );
    const sdk = this.engine.profile.startsWith('sdk-');
    if (!nativeABI(this.engine.profile).text.resourceMessages.clearCategory && operation === 19)
      throw new Error('SDK text task has no category-clear message');
    const handler =
        writer.mode === 'nv'
          ? sdk
            ? 0x50cce0
            : 0x6369b0
          : sdk
            ? 0x50be90
            : writer.mode === 'utf8'
              ? 0x6359f0
              : 0x634d00,
      first =
        nativeABI(this.engine.profile).text.resourceMessages.first[writer.mode] ??
        nativeABI(this.engine.profile).text.resourceMessages.first.cp932,
      message = first + operation + Number(writer.mode === 'nv'),
      p = this.process,
      task = p.allocate(0x600, true),
      result = p.allocate(4, true);
    try {
      // These four original branches only read the writer field before
      // calling its image-font or category resource routines. They never
      // construct or dispatch a graphics task.
      p.store(task + 684, writer.pointer);
      await this.call(handler, [0, message, w >>> 0, l >>> 0, 0, result], task);
      return p.load(result);
    } finally {
      p.free(result);
      p.free(task);
    }
  }
  snapshot() {
    return {
      windows: this.windows.snapshot(),
      writers: [...this.writers.values()].map((writer) => writer.snapshot()),
    };
  }
  restore(state) {
    this.windows.restore(state.windows);
    this.writers = new Map(
      state.writers.map((saved) => [
        saved.pointer,
        new (saved.mode === 'nv' ? NativeNVTextWriter : NativeTextWriter)(this, saved),
      ]),
    );
  }
  async close() {
    for (const writer of [...this.writers.values()]) await writer.close();
  }
}

export class NativeTextWriter {
  constructor(runtime, state) {
    Object.assign(this, { runtime, ...structuredClone(state) });
  }
  get process() {
    return this.runtime.process;
  }
  get bindings() {
    return this.runtime.bindings(this.mode);
  }
  enginePointer() {
    return this.process.load(this.pointer + 8);
  }
  defaultConfig() {
    return this.process.read(
      this.enginePointer() + this.bindings.defaultAt,
      this.bindings.configSize,
    );
  }
  async configure(config) {
    if (!(config instanceof Uint8Array) || config.length !== this.bindings.configSize)
      throw new Error(
        `Native text ${this.mode} configuration requires ${this.bindings.configSize} bytes`,
      );
    const at = this.process.allocate(config.length, true);
    try {
      this.process.write(at, config);
      await this.runtime.call(this.bindings.configure, [at, 4], this.pointer);
      this.config = this.process.read(at, config.length);
      return this.config.slice();
    } finally {
      this.process.free(at);
    }
  }
  async input(bytes, callback) {
    const at = this.process.allocate(bytes.length, true);
    try {
      this.process.write(at, bytes);
      return await callback(at);
    } finally {
      this.process.free(at);
    }
  }
  append(text) {
    const bytes = this.mode === 'utf8' ? utf16(String(text)) : encodeCP932(`${text}\0`);
    return this.input(bytes, (at) => this.runtime.call(this.bindings.append, [at], this.pointer));
  }
  appendSource(text) {
    if (this.mode !== 'utf8') return this.append(text);
    return this.input(utf16(String(text)), async (at) => {
      const translated = await this.runtime.call(0x5abe00, [at]);
      return this.runtime.call(this.bindings.append, [translated], this.pointer);
    });
  }
  async appendEncoded(bytes) {
    const source = new Uint8Array(bytes.length + 1);
    source.set(bytes);
    if (this.mode !== 'utf8') {
      await this.input(source, (at) => this.runtime.call(this.bindings.append, [at], this.pointer));
      return '';
    }
    if (bytes.length >= 8192)
      throw new RangeError('Native STRING8 input exceeds its original conversion buffer');
    const out = this.process.allocate(8192, true);
    try {
      return await this.input(source, async (at) => {
        await this.runtime.call(0x6a5660, [at, out]);
        const text = this.process.string(out, true);
        const translated = await this.runtime.call(0x5abe00, [out]);
        await this.runtime.call(this.bindings.append, [translated], this.pointer);
        return text;
      });
    } finally {
      this.process.free(out);
    }
  }
  async parse() {
    await this.runtime.call(this.bindings.parse, [], this.enginePointer());
  }
  clear() {
    return this.runtime.call(this.bindings.clear, [], this.pointer);
  }
  mark() {
    return this.runtime.call(this.bindings.mark, [], this.pointer);
  }
  async draw(frame, pageLimit = -1) {
    return Boolean(
      await this.runtime.call(this.bindings.draw, [frame >>> 0, pageLimit >>> 0], this.pointer),
    );
  }
  async remaining(pageLimit = -1) {
    return (await this.runtime.call(this.bindings.remaining, [pageLimit >>> 0], this.pointer)) | 0;
  }
  speed(value) {
    return this.runtime.call(this.bindings.speed, [value >>> 0], this.pointer);
  }
  lineCount() {
    return this.runtime.call(this.bindings.lines, [], this.enginePointer());
  }
  shift(value) {
    return this.runtime.call(this.bindings.shift, [value >>> 0], this.pointer);
  }
  resourceMessage(operation, w, l) {
    return this.runtime.resourceMessage(this, operation, w, l);
  }
  async userFont(bytes) {
    const buffers = this.runtime.buffers,
      block = buffers.createPointer(bytes);
    let assigned = false;
    try {
      await this.resourceMessage(9, 0, block);
      // The original font resource takes the existing reference and frees it
      // when replaced or destroyed, including all decoded image selectors.
      assigned = true;
    } finally {
      if (!assigned) {
        buffers.releasePointer(block);
      }
    }
  }
  profile(category, text) {
    const bytes =
      this.mode === 'utf8' ? new TextEncoder().encode(`${text}\0`) : encodeCP932(`${text}\0`);
    return this.input(bytes, (at) =>
      this.runtime.call(this.bindings.profile, [category >>> 0, at], this.enginePointer()),
    );
  }
  async endPosition() {
    const at = this.process.allocate(8, true);
    try {
      await this.runtime.call(this.bindings.position, [at, at + 4], this.pointer);
      return [this.process.load(at) | 0, this.process.load(at + 4) | 0];
    } finally {
      this.process.free(at);
    }
  }
  records() {
    const engine = this.enginePointer(),
      start = this.process.load(engine),
      end = this.process.load(engine + 4),
      size = end - start;
    if (size < 0 || size % 88 || size > 88 * 1000000)
      throw new Error('Native text glyph vector is invalid');
    return this.process.read(start, size);
  }
  dirty() {
    const pointer = this.process.load(this.pointer + (this.bindings.dirtyAt ?? 12));
    return pointer
      ? Array.from({ length: 4 }, (_, i) => this.process.load(pointer + 16 + i * 4) | 0)
      : [0, 0, 0, 0];
  }
  clearDirty() {
    const pointer = this.process.load(this.pointer + (this.bindings.dirtyAt ?? 12));
    if (pointer) this.process.zero(pointer + 16, 16);
  }
  frame() {
    const p = this.process,
      bitmap = p.load(this.pointer + (this.bindings.bitmapAt ?? 4));
    if (!bitmap) throw new Error('Native text writer has no configured bitmap');
    const width = p.load(bitmap + 4),
      height = p.load(bitmap + 8),
      data = p.load(bitmap + 12),
      stride = p.load(bitmap + 20),
      bpp = p.load(bitmap + 24);
    if (bpp !== 4 || !width || !height || width * height > 64 * 1024 * 1024 || stride < width * 4)
      throw new Error('Native text bitmap layout is invalid');
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      // The texture uploader consumes data + y * stride directly. The
      // bitmap's separate 68CD70 logical-pixel accessor reverses this axis.
      const row = p.read(data + y * stride, width * 4);
      for (let x = 0; x < width; x++) {
        const at = x * 4,
          out = (y * width + x) * 4;
        rgba[out] = row[at + 2];
        rgba[out + 1] = row[at + 1];
        rgba[out + 2] = row[at];
        rgba[out + 3] = row[at + 3];
      }
    }
    return { width, height, rgba };
  }
  snapshot() {
    return structuredClone({ pointer: this.pointer, mode: this.mode, config: this.config });
  }
  async close() {
    if (!this.runtime.writers.has(this.pointer)) return;
    await this.runtime.call(this.bindings.destroy, [], this.pointer);
    this.process.free(this.pointer);
    this.runtime.writers.delete(this.pointer);
  }
}

// NV text retains separate original parser objects for each main/sub-text
// section. Its source strings are CP932 even though font faces are UTF-16.
export class NativeNVTextWriter extends NativeTextWriter {
  sections(secondary = false) {
    const p = this.process,
      vector = p.load(this.pointer + (secondary ? 4 : 0)),
      start = p.load(vector),
      end = p.load(vector + 4);
    if (end < start || (end - start) % 12 || end - start > 12 * 1000000)
      throw new Error('Native NV section vector is invalid');
    return Array.from({ length: (end - start) / 12 }, (_, i) => ({
      x: p.load(start + i * 12) | 0,
      y: p.load(start + i * 12 + 4) | 0,
      parser: p.load(start + i * 12 + 8),
    }));
  }
  enginePointer() {
    return this.sections().at(-1)?.parser ?? 0;
  }
  defaultConfig() {
    if (!this.config) throw new Error('NV text has no configured source record');
    return this.config.slice();
  }
  async parse() {
    for (const secondary of [false, true])
      for (const section of this.sections(secondary))
        await this.runtime.call(this.bindings.parse, [], section.parser);
  }
  section() {
    return this.runtime.call(this.bindings.section, [], this.pointer);
  }
  appendSecondary(text) {
    return this.input(encodeCP932(`${text}\0`), (at) =>
      this.runtime.call(this.bindings.secondary, [at], this.pointer),
    );
  }
  remaining() {
    return this.runtime.call(this.bindings.remaining, [], this.pointer).then((value) => value | 0);
  }
  redraw() {
    return this.runtime.call(this.bindings.redraw, [], this.pointer);
  }
  reflow() {
    return this.runtime.call(this.bindings.reflow, [], this.pointer);
  }
  erase() {
    return this.runtime.call(this.bindings.erase, [], this.pointer);
  }
  records() {
    const arrays = [];
    for (const secondary of [false, true])
      for (const { parser } of this.sections(secondary)) {
        const p = this.process,
          start = p.load(parser),
          end = p.load(parser + 4),
          size = end - start;
        if (size < 0 || size % 88 || size > 88 * 1000000)
          throw new Error('Native NV glyph vector is invalid');
        arrays.push(p.read(start, size));
      }
    const result = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0));
    let offset = 0;
    for (const bytes of arrays) {
      result.set(bytes, offset);
      offset += bytes.length;
    }
    return result;
  }
}
