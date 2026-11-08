// SPDX-License-Identifier: MPL-2.0
// Execute the fixed HG2 reader/writer. Allocation, byte copy, zlib and CRT/OS
// services are supplied by this harness; no HG transform is substituted.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { Binary } from '../src/binary.mjs';
import { HG2, encodeHG2 } from '../src/formats/hg2.mjs';
import { packHGPixels } from '../src/formats/hg-codec.mjs';
import { openImage } from '../src/formats/hg3.mjs';
import { unpackKCLZ } from '../src/formats/raster.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

const [exe, output] = process.argv.slice(2);
if (!exe || !output)
  throw new Error('Usage: node scripts/verify-native-hg2.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(exe)),
  sha256 = createHash('sha256').update(bytes).digest('hex');
const addresses = {
  ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0: {
    constructor: 0x6a0410,
    encode: 0x6a0de0,
    decode: 0x6a0750,
    fullEncode: 0x690510,
    setRectEmpty: 0x8c6400,
    isRectEmpty: 0x8c6530,
    allocate: 0x6a49d0,
    heapFree: 0x6a4b00,
    new: 0x79ea57,
    free: 0x6f81d0,
    copy: [0x6a7210, 0x79d9c0, 0x79f2a0],
    zero: 0x6a7e60,
    inflate: 0x82c550,
    deflate: 0x82c3c0,
    diagnostic: 0x5cac90,
    security: 0x7a04bd,
    bmp: 0x69ef90,
    kcf: 0x6a01a0,
    kclz: 0x836c50,
    psd: 0x69f340,
  },
  '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f': {
    constructor: 0x571890,
    encode: 0x572260,
    decode: 0x571bd0,
    fullEncode: 0x566d40,
    setRectEmpty: 0x98e3ac,
    isRectEmpty: 0x98e45c,
    allocate: 0x575ce0,
    heapFree: 0x575e10,
    new: 0x4a7bc0,
    free: 0x4a7c70,
    copy: [0x576df0],
    zero: 0x5775c0,
    inflate: 0x869e70,
    deflate: 0x869ce0,
    diagnostic: 0x4a82f0,
    security: 0x636414,
    bmp: 0x570410,
    kcf: 0x571620,
    kclz: 0x8764e0,
    psd: 0x5707c0,
    arrayNew: 0x4a7efa,
    arrayFree: 0x664230,
  },
}[sha256];
if (!addresses) throw new Error('HG2 oracle requires a fixed executable');
const b = new Binary(bytes),
  pe = b.u32(60),
  optional = pe + 24,
  image = new Uint8Array(b.u32(optional + 56));
image.set(b.range(0, b.u32(optional + 60)));
for (let n = 0; n < b.u16(pe + 6); n++) {
  const at = optional + b.u16(pe + 20) + n * 40;
  image.set(b.range(b.u32(at + 20), b.u32(at + 16)), b.u32(at + 12));
}
const u = await loadUnicorn(),
  p = new PE32Process(u);
p.map(0x400000, image.length);
p.write(0x400000, image);
p.store(
  addresses.setRectEmpty,
  p.trap('SetRectEmpty', 1, ([at]) => {
    p.zero(at, 16);
    return 1;
  }),
);
p.store(
  addresses.isRectEmpty,
  p.trap('IsRectEmpty', 1, ([at]) =>
    Number(
      (p.load(at) | 0) >= (p.load(at + 8) | 0) || (p.load(at + 4) | 0) >= (p.load(at + 12) | 0),
    ),
  ),
);
const redirect = (at, count, callback) => {
  const target = p.trap(`external@${at.toString(16)}`, 0, () => {
      const sp = p.cpu.reg_read_i32(u.X86_REG_ESP) >>> 0;
      return callback(Array.from({ length: count }, (_, i) => p.load(sp + 4 + i * 4)));
    }),
    code = new Uint8Array(5);
  code[0] = 0xe9;
  new DataView(code.buffer).setUint32(1, target - at - 5, true);
  p.write(at, code);
};
redirect(addresses.allocate, 2, ([, size]) => p.allocate(size, true));
for (const at of [addresses.new, addresses.arrayNew].filter(Boolean))
  redirect(at, 1, ([size]) => p.allocate(size, true));
for (const at of [addresses.heapFree, addresses.free, addresses.arrayFree].filter(Boolean))
  redirect(at, 1, ([address]) => p.free(address));
for (const at of addresses.copy)
  redirect(at, 3, ([d, s, n]) => {
    p.write(d, p.read(s, n));
    return d;
  });
redirect(addresses.zero, 2, ([d, n]) => {
  p.zero(d, n);
  return d;
});
redirect(addresses.inflate, 4, ([d, capacity, s, n]) => {
  const result = inflateSync(p.read(s, n));
  assert.ok(result.length <= capacity);
  p.write(d, result);
  return result.length;
});
redirect(addresses.deflate, 4, ([d, capacity, s, n]) => {
  const result = deflateSync(p.read(s, n));
  assert.ok(result.length <= capacity);
  p.write(d, result);
  return result.length;
});
redirect(addresses.diagnostic, 0, () => {
  throw new Error('Original HG2 codec reported an error');
});
p.write(addresses.security, new Uint8Array([0xc3]));
const put = (data) => {
  const at = p.allocate(data.length, true);
  p.write(at, data);
  return at;
};
const context = () => {
  const at = p.allocate(0x1178, true);
  p.call(addresses.constructor, [], at);
  return at;
};
const words = (at, values) => values.forEach(([offset, value]) => p.store(at + offset, value));
function bgra(rgba, width, height, pixelSize = 4) {
  const raw = new Uint8Array(width * height * pixelSize);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4,
        d = ((height - y - 1) * width + x) * pixelSize;
      raw[d] = rgba[s + 2];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s];
      if (pixelSize === 4) raw[d + 3] = rgba[s + 3];
    }
  return raw;
}
function rgbaFromNative(at) {
  const width = p.load(at + 4),
    height = p.load(at + 8),
    pixelSize = p.load(at + 24),
    stride = p.load(at + 20),
    raw = p.read(p.load(at + 12), stride * height),
    result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (height - y - 1) * stride + x * pixelSize,
        d = (y * width + x) * 4;
      result[d] = raw[s + 2];
      result[d + 1] = raw[s + 1];
      result[d + 2] = raw[s];
      result[d + 3] = pixelSize === 4 ? raw[s + 3] : 255;
    }
  return result;
}
let passed = 0;
const groups = {};
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
try {
  for (let n = 0; n < 40; n++) {
    const width = 1 + (n % 13),
      height = 1 + (n % 7),
      bpp = n % 2 ? 3 : 4,
      rgba = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
        i % 4 === 3 && bpp === 3 ? 255 : (i * 93 + n * 41) & 255,
      ),
      frame = { width, height, rgba, bpp },
      native = context(),
      raw = bgra(rgba, width, height, bpp);
    words(native, [
      [4, width],
      [8, height],
      [12, put(raw)],
      [16, raw.length],
      [20, width * bpp],
      [24, bpp],
      [28, width],
      [32, height],
      [48, -3],
      [52, 7],
    ]);
    const out = p.allocate(102400, true),
      length = p.call(addresses.encode, [out, 102400, n], native),
      encoded = p.read(out, length),
      image = new HG2(encoded),
      decoded = await image.decode(image.frame(n));
    compare(decoded.rgba, rgba, `original-writer/${width}/${height}/${bpp}`);
    compare(
      [decoded.canvasWidth, decoded.canvasHeight, decoded.baseX, decoded.baseY],
      [width, height, -3, 7],
      'writer-metadata',
    );
    const jsBytes = await encodeHG2(frame, {
        crop: false,
        clearTransparent: false,
        id: n,
        baseX: -3,
        baseY: 7,
      }),
      destination = context();
    assert.equal(p.call(addresses.decode, [put(jsBytes), jsBytes.length, n], destination), 1);
    compare(rgbaFromNative(destination), rgba, `original-reader/${width}/${height}/${bpp}`);
    compare(jsBytes, encoded, `writer-bytes/${width}/${height}/${bpp}`);
  }
  // Older versions, packed low-depth channels, and nonzero frame IDs are
  // authored format inputs, then decoded by the shipped reader itself.
  for (const version of [0x10, 0x20, 0x25])
    for (const pixelSize of [3, 4])
      for (let depth = 0; depth < 8; depth++) {
        const width = 5,
          height = 3,
          max = depth ? (1 << depth) - 1 : 255,
          raw = Uint8Array.from(
            { length: width * height * pixelSize },
            (_, i) => (i * 23 + 7) & max,
          ),
          { data, control } = packHGPixels(raw, width, height, pixelSize),
          packed = deflateSync(data),
          packedControl = deflateSync(control),
          header = version === 0x10 ? 48 : version === 0x20 ? 80 : 88,
          file = new Uint8Array(header + packed.length + packedControl.length),
          view = new DataView(file.buffer);
        file.set([72, 71, 45, 50]);
        for (const [offset, value] of [
          [4, 12],
          [8, version],
          [12, width],
          [16, height],
          [32, packed.length],
          [36, data.length],
          [40, packedControl.length],
          [44, control.length],
        ])
          view.setUint32(offset, value, true);
        view.setUint16(20, pixelSize * 8, true);
        view.setUint16(22, depth, true);
        if (version > 0x10)
          for (const [offset, value] of [
            [48, header - 48],
            [52, 19],
            [56, width + 3],
            [60, height + 5],
            [64, 2],
            [68, 4],
            [72, 1],
          ])
            view.setUint32(offset, value, true);
        file.set(packed, header);
        file.set(packedControl, header + packed.length);
        const native = context(),
          image = new HG2(file);
        assert.equal(
          p.call(addresses.decode, [put(file), file.length, version === 0x10 ? 0 : 19], native),
          1,
        );
        compare(
          (await image.decode(image.frames[0])).rgba,
          rgbaFromNative(native),
          `version-depth/${version}/${pixelSize}/${depth}`,
        );
      }
  for (let n = 0; n < 16; n++) {
    const width = n === 0 ? 1 : 3 + n,
      height = n === 0 ? 1 : 5,
      rgba = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 39 + 71) & 255);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (n < 2 || !x || !y || x === width - 1 || y === height - 1)
          rgba[(y * width + x) * 4 + 3] = 0;
    const native = context(),
      raw = bgra(rgba, width, height),
      wrapper = p.allocate(8, true),
      stream = p.allocate(20, true);
    words(native, [
      [4, width],
      [8, height],
      [12, put(raw)],
      [16, raw.length],
      [20, width * 4],
      [24, 4],
      [28, width],
      [32, height],
    ]);
    p.store(wrapper, native);
    p.store(stream + 12, 1);
    const length = p.call(addresses.fullEncode, [stream, 4], wrapper),
      original = p.read(p.load(stream), length),
      expected = await encodeHG2({ width, height, rgba });
    const nativeImage = new HG2(original),
      jsImage = new HG2(expected),
      a = await nativeImage.decode(nativeImage.frames[0]),
      c = await jsImage.decode(jsImage.frames[0]);
    compare(
      [a.width, a.height, a.offsetX, a.offsetY, a.canvasWidth, a.canvasHeight, ...a.rgba],
      [c.width, c.height, c.offsetX, c.offsetY, c.canvasWidth, c.canvasHeight, ...c.rgba],
      `full-save-path/crop/${n}`,
    );
  }
  groups.hg2 = passed;
  function kclz(raw, mode = 0, period = raw.length) {
    const flags = [],
      data = [],
      lengthBits = 3 + mode,
      maxLength = (1 << lengthBits) + 2;
    let at = 0,
      tokens = 0;
    while (at < raw.length) {
      const index = tokens >> 3,
        bit = tokens++ & 7;
      flags[index] ??= 0;
      if (at >= period && raw.length - at >= 3) {
        const length = Math.min(maxLength, raw.length - at),
          code = ((period - 1) << lengthBits) | (length - 3);
        flags[index] |= 1 << bit;
        data.push(code & 255, code >>> 8);
        at += length;
      } else data.push(raw[at++]);
    }
    const out = new Uint8Array(28 + flags.length + data.length),
      view = new DataView(out.buffer);
    out.set([75, 67, 76, 90]);
    for (const [offset, value] of [
      [4, mode],
      [8, raw.length],
      [20, 28],
      [24, 28 + flags.length],
    ])
      view.setUint32(offset, value, true);
    out.set(flags, 28);
    out.set(data, 28 + flags.length);
    return out;
  }
  for (let n = 0; n < 200; n++)
    for (let mode = 0; mode < 5; mode++) {
      const length = 8 + (n % 41),
        period = 1 + (n % 8),
        raw = Uint8Array.from({ length }, (_, i) => ((i % period) * 37 + n * 17) & 255),
        file = kclz(raw, mode, period),
        out = p.allocate(raw.length, true),
        at = put(file);
      compare(p.call(addresses.kclz, [at, file.length, out, 0, 0]), raw.length, 'kclz-length');
      compare(unpackKCLZ(file), p.read(out, raw.length), `kclz-mode/${mode}/${n}`);
    }
  groups.kclz = passed - groups.hg2;
  for (let n = 0; n < 20; n++)
    for (const pixelSize of [3, 4]) {
      const width = 1 + (n % 8),
        height = 1 + (n % 4),
        stride = (width * pixelSize + 3) & ~3,
        raw = Uint8Array.from({ length: stride * height }, (_, i) => (i * 39 + n * 17) & 255);
      for (const format of ['bmp', 'kcf']) {
        const file =
            format === 'bmp'
              ? new Uint8Array(54 + raw.length)
              : new Uint8Array(12 + kclz(raw).length),
          v = new DataView(file.buffer);
        if (format === 'bmp') {
          file.set([66, 77]);
          v.setUint32(10, 54, true);
          v.setUint32(14, 40, true);
          v.setUint32(18, width, true);
          v.setUint32(22, height, true);
          v.setUint16(26, 1, true);
          v.setUint16(28, pixelSize * 8, true);
          file.set(raw, 54);
        } else {
          file.set([75, 67, 70, 0]);
          for (const [offset, value] of [
            [4, width],
            [6, height],
            [8, stride],
            [10, pixelSize],
          ])
            v.setUint16(offset, value, true);
          file.set(kclz(raw), 12);
        }
        const image = await openImage(file),
          native = p.allocate(0x84, true),
          stream = p.allocate(8, true);
        p.call(addresses[format], [], native);
        p.store(stream, put(file));
        p.store(stream + 4, file.length);
        compare(p.call(p.load(p.load(native) + 4), [stream, 0], native), 1, `${format}-load`);
        compare(
          (await image.decode(image.frame())).rgba,
          rgbaFromNative(native),
          `${format}-pixels/${width}/${height}/${pixelSize}`,
        );
      }
    }
  groups.bmpKcf = passed - groups.hg2 - groups.kclz;
  for (let trial = 0; trial < 40; trial++)
    for (const compression of [0, 1])
      for (const channels of [3, 4]) {
        const width = trial === 37 ? 3 : 1 + (trial % 13),
          height = 1 + (trial % 5),
          rows = [],
          rowLengths = [],
          expected = new Uint8ClampedArray(width * height * 4),
          color = Uint8Array.from({ length: trial % 4 }, (_, i) => i + 32),
          resources = Uint8Array.from({ length: trial % 7 }, (_, i) => i + 64),
          layers = trial % 2 ? Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0, 0, 0) : new Uint8Array();
        for (let channel = 0; channel < channels; channel++)
          for (let y = 0; y < height; y++) {
            const row = Uint8Array.from({ length: width }, (_, x) =>
              trial % 3 && trial !== 37
                ? (channel * 81 + y * 29 + x * 17 + trial) & 255
                : (channel * 81 + y * 29 + trial) & 255,
            );
            if (channel < 3)
              for (let x = 0; x < width; x++) expected[(y * width + x) * 4 + channel] = row[x];
            const bytes =
              compression === 1
                ? trial === 37
                  ? Uint8Array.of(0x80, row[0])
                  : trial % 3 || width === 1
                    ? Uint8Array.from([width - 1, ...row])
                    : Uint8Array.of(257 - width, row[0])
                : row;
            rows.push(bytes);
            rowLengths.push(bytes.length);
          }
        for (let i = 0; i < width * height; i++) expected[i * 4 + 3] = 255;
        const file = new Uint8Array(
            40 +
              color.length +
              resources.length +
              layers.length +
              (compression === 1 ? channels * height * 2 : 0) +
              rows.reduce((n, row) => n + row.length, 0),
          ),
          view = new DataView(file.buffer);
        file.set([56, 66, 80, 83]);
        view.setUint16(4, trial === 32 ? 99 : 1);
        view.setUint16(12, channels);
        view.setUint32(14, height + (trial === 35 ? 0x10000 : 0));
        view.setUint32(18, width + (trial === 35 ? 0x10000 : 0));
        view.setUint16(22, trial === 33 ? 16 : 8);
        view.setUint16(24, trial === 34 ? 8 : 3);
        let at = 26;
        for (const section of [color, resources, layers]) {
          view.setUint32(at, section.length);
          file.set(section, at + 4);
          at += section.length + 4;
        }
        view.setUint16(at, trial === 36 && compression === 0 ? 2 : compression);
        at += 2;
        if (compression === 1) {
          for (const length of rowLengths) {
            view.setUint16(at, trial === 38 ? 0xbeef : length);
            at += 2;
          }
        }
        for (const row of rows) {
          file.set(row, at);
          at += row.length;
        }
        const native = p.allocate(0x84, true),
          stream = p.allocate(8, true);
        p.call(addresses.psd, [], native);
        p.store(stream, put(file));
        p.store(stream + 4, file.length);
        compare(
          p.call(p.load(p.load(native) + 4), [stream, 0], native),
          1,
          `psd-load/${trial}/${compression}/${channels}`,
        );
        const original = rgbaFromNative(native),
          image = await openImage(file),
          frame = await image.decode(image.frame());
        compare(original, expected, `psd-original-pixels/${trial}/${compression}/${channels}`);
        compare(frame.rgba, original, `psd-composite/${trial}/${compression}/${channels}`);
      }
  groups.psd = passed - groups.hg2 - groups.kclz - groups.bmpKcf;
  await writeFile(
    output,
    JSON.stringify(
      {
        sha256,
        passed,
        groups,
        scope:
          'Original HG2 reader/writer, BMP/KCF/PSD composite readers and KCLZ decompressor; allocation, zlib and byte-copy services supplied; writer padding initialized to zero by harness',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native HG2 differential passed ${passed}/${passed}`);
} finally {
  p.close();
}
