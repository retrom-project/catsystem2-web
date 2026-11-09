// SPDX-License-Identifier: MPL-2.0
// The original Texture Renderer negotiates decoded RGB32 and uploads samples
// to its own D3D texture. The browser supplies the uncompressed samples.
const LAYOUT = {
  'nekopara-vol3-engine-2.6.1.76': {
    table: 0x8d57e4,
    check: 0x686d90,
    configure: 0x687050,
    sample: 0x686e40,
  },
  'sdk-4.01-engine-2.6.1.74': {
    table: 0x99a490,
    check: 0x55d980,
    configure: 0x55dc60,
    sample: 0x55da30,
  },
};
const VIDEO = [0x73646976, 0x00100000, 0xaa000080, 0x719b3800];
const RGB32 = [0xe436eb7e, 0x11ce524f, 0x2000539f, 0x70a70baf];
const VIDEO_INFO = [0x05589f80, 0x11cec356, 0xaa0001bf, 0x5a595500];
const E_FAIL = 0x80004005;
const FAILED = (status) => (status | 0) < 0;

export function writeMoviePixels(process, frame, address, pitch, bottomUp = false) {
  const { width, height, rgba } = frame,
    row = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < row.length; x += 4) {
      const at = y * row.length + x;
      row[x] = rgba[at + 2];
      row[x + 1] = rgba[at + 1];
      row[x + 2] = rgba[at];
      row[x + 3] = 255;
    }
    process.write(address + (bottomUp ? height - y - 1 : y) * pitch, row);
  }
}

export class NativeTextureMovieRenderer {
  constructor(engine) {
    Object.assign(this, { engine, process: engine.process, layout: LAYOUT[engine.profile] });
    if (!this.layout) throw new Error('Native movie Texture Renderer profile is unavailable');
    const p = this.process;
    this.table = p.allocate(48, true);
    p.store(
      this.table + 12,
      p.trap('decoded movie sample GetPointer', 2, ([sample, out]) => {
        if (!out) return 0x80004003;
        p.store(out, p.load(sample + 4));
        return 0;
      }),
    );
    p.store(
      this.table + 44,
      p.trap('decoded movie sample GetActualDataLength', 1, ([sample]) => p.load(sample + 8)),
    );
    engine.registerFeature('texture-movie-renderer', this);
  }
  matches(filter) {
    const pointer = filter - 12,
      p = this.process;
    return p.allocations.get(pointer) === 0x1a8 && p.load(pointer) === this.layout.table;
  }
  call(address, args, pointer) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  async configure(filter, { width, height }) {
    const p = this.process,
      type = p.allocate(160, true),
      info = type + 72;
    try {
      for (const [at, guid] of [
        [type, VIDEO],
        [type + 16, RGB32],
        [type + 44, VIDEO_INFO],
      ])
        guid.forEach((word, index) => p.store(at + index * 4, word));
      p.store(type + 32, 1);
      p.store(type + 40, width * height * 4);
      p.store(type + 64, 88);
      p.store(type + 68, info);
      for (const rect of [info, info + 16]) {
        p.store(rect + 8, width);
        p.store(rect + 12, height);
      }
      [40, width, height, 0x00200001, 0, width * height * 4].forEach((word, i) =>
        p.store(info + 48 + i * 4, word),
      );
      const checked = await this.call(this.layout.check, [type]);
      if (FAILED(checked)) return checked;
      const pointer = filter - 12,
        status = await this.call(this.layout.configure, [type], pointer);
      return !FAILED(status) && !p.load(pointer + 388) ? E_FAIL : status;
    } finally {
      p.free(type);
    }
  }
  async present(filter, frame) {
    const p = this.process,
      pointer = filter - 12,
      pitch = frame.width * 4,
      length = pitch * frame.height;
    if (p.load(pointer + 352) !== frame.width || p.load(pointer + 356) !== frame.height)
      throw new Error('Decoded movie frame differs from the native media type');
    const sample = p.allocate(length + 12),
      data = sample + 12;
    try {
      [this.table, data, length].forEach((word, i) => p.store(sample + i * 4, word));
      writeMoviePixels(p, frame, data, pitch, true);
      const result = await this.call(this.layout.sample, [sample], pointer);
      return result ? E_FAIL : 0;
    } finally {
      p.free(sample);
    }
  }
  snapshot() {
    return { table: this.table };
  }
  restore(state) {
    const p = this.process;
    if (
      p.allocations.get(state.table) !== 48 ||
      p.traps.get(p.load(state.table + 12))?.name !== 'decoded movie sample GetPointer' ||
      p.traps.get(p.load(state.table + 44))?.name !== 'decoded movie sample GetActualDataLength'
    )
      throw new Error('Invalid native movie sample interface checkpoint');
    this.table = state.table;
  }
  close() {
    this.process.free(this.table);
  }
}
