// SPDX-License-Identifier: MPL-2.0
// Executes complete main 16C/170/1AF/177 wrappers and their original image
// parsers/decoders. Only VM pointer translation, formatting and mounted-file
// access are supplied by the host. All images below are authored probe data.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeDataBuffers, nativeDataBuffer } from '../src/native/data-buffer.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { encodeHG2, HG2 } from '../src/formats/hg2.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, output] = process.argv.slice(2);
if (!filename || !output)
  throw new Error('Usage: node scripts/verify-native-image-data.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Image-data oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ profile, bytes, trace: true }),
  p = engine.process,
  handles = new NativeHandles(),
  buffers = new NativeDataBuffers(engine, { handles }),
  table = sdk ? 0xb3c900 : 0xa2dd38,
  caller = p.allocate(160, true),
  list = p.allocate(8, true),
  head = p.allocate(12, true),
  parameters = p.allocate(12, true),
  result = p.allocate(4, true),
  destination = p.allocate(64, true),
  functions = sdk
    ? {
        format: 0x8a6510,
        pointer: 0x8a6910,
        path: 0x4b0830,
        open: 0x4b1410,
        size: 0x4b1390,
        read: 0x4b1c80,
        close: 0x4b0a30,
        diagnostic: 0x4a82f0,
        font: 0x567f90,
      }
    : {
        format: 0x876ea0,
        pointer: 0x8772a0,
        path: 0x5d39e0,
        open: 0x5d47c0,
        size: 0x5d46e0,
        read: 0x5d50d0,
        close: 0x5d3d60,
        diagnostic: 0x5cac90,
        font: 0x6918d0,
      },
  results = [];
let current;
const checks = (label, actual, expected) => {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, actual, expected, equal });
  if (!equal) console.error(JSON.stringify(results.at(-1)));
};
engine.patch(
  functions.pointer,
  'image-data VM address boundary',
  1,
  ([address]) => (address === 0xffffffff ? 0 : destination + address),
  { calleePops: true },
);
engine.patch(
  functions.format,
  'image-data KCS format boundary',
  2,
  ([, out]) => {
    p.write(out, encodeCP932(`${current.name}\0`));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  functions.path,
  'image-data resource category boundary',
  3,
  ([out, name, category]) => {
    if (p.string(category) !== 'image') throw new Error('Image-data category changed');
    const text = p.stringBytes(name);
    p.write(out, text);
    p.zero(out + text.length, 1);
    return out;
  },
  { calleePops: true },
);
engine.patch(
  functions.open,
  'image-data file open boundary',
  2,
  ([name, flags]) => {
    if (flags !== 3 || p.string(name, !sdk) !== current.name)
      throw new Error('Image-data filename or open flags changed');
    return current.source ? 17 : 0;
  },
  { calleePops: true },
);
engine.patch(functions.size, 'image-data file size boundary', 1, () => current.source.length, {
  calleePops: true,
});
engine.patch(
  functions.read,
  'image-data file read boundary',
  3,
  ([handle, out, count]) => {
    if (handle !== 17) throw new Error('Unknown image-data file handle');
    const source = current.source.subarray(0, count);
    p.write(out, source);
    return source.length;
  },
  { calleePops: true },
);
engine.patch(functions.close, 'image-data file close boundary', 1, () => 0, { calleePops: true });
engine.patch(functions.diagnostic, 'image-data diagnostic boundary', 0, () => 0);
buffers.read = async () => current.source;

function bitmapState(wrapper) {
  if (!wrapper) return null;
  const bitmap = p.load(wrapper),
    words = Array.from({ length: 13 }, (_, i) => p.load(bitmap + 4 + i * 4)),
    width = words[0],
    height = words[1],
    stride = words[4],
    bpp = words[5],
    data = words[2],
    rgba = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const row = p.read(data + (height - 1 - y) * stride + x * bpp, bpp);
      rgba.push(row[2], row[1], row[0], bpp === 4 ? row[3] : 255);
    }
  words[2] = Number(Boolean(data));
  return { words, rgba };
}

for (let index = 0; index < 24; index++) {
  const width = 3 + (index % 5),
    height = 2 + (index % 4),
    bpp = index % 2 ? 3 : 4,
    rgba = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? (bpp === 3 ? 255 : 37 + ((i * 17 + index) % 219)) : (i * 43 + index * 19) & 255,
    ),
    source = await encodeHG2(
      { width, height, rgba, bpp },
      { crop: false, clearTransparent: false, id: index, baseX: -index, baseY: index + 3 },
    );
  current = { name: 'authored_日本語', source };
  const pointer = buffers.createPointer(source),
    handle = buffers.handle(pointer),
    image = new HG2(source),
    frame = await image.decode(image.frame(index));
  for (const selector of [index, index + 100]) {
    p.store(caller + 152, list);
    p.store(list, head);
    p.store(list + 4, 0);
    p.store(head, head);
    p.store(head + 4, head);
    [pointer, selector].forEach((value, i) => p.store(parameters + i * 4, value));
    p.store(result, 0xa5a55a5a);
    const control = await engine.call(p.load(table + 0x16c * 4), [0, caller, parameters, result]),
      nativePointer = p.load(result),
      nativeBitmap = bitmapState(nativePointer),
      owner = 99;
    let imported;
    const reply = await nativeDataBuffer(
      0x16c,
      [handle, selector],
      {},
      {
        dataBuffers: () => buffers,
        owner,
        importNativeBitmap: async (at, caller, options) => {
          imported = { caller, options, bitmap: bitmapState(at) };
          await buffers.releaseBitmapPointer(at);
          return 725;
        },
      },
    );
    checks(
      `decode-wrapper-${index}-${selector}`,
      {
        control,
        found: Number(Boolean(nativePointer)),
        bitmap: nativeBitmap,
        listed: p.load(list + 4),
      },
      {
        control: reply.control,
        found: Number(Boolean(reply.value)),
        bitmap: imported?.bitmap ?? null,
        listed: reply.value ? 1 : 0,
      },
    );
    if (nativePointer) {
      checks(`decode-pixels-${index}`, nativeBitmap.rgba, [...frame.rgba]);
      checks(
        `decode-import-${index}`,
        { owner: imported.caller, options: imported.options, bpp: imported.bitmap.words[5] },
        { owner, options: { rowOrder: 'bottom-up' }, bpp: 4 },
      );
      await buffers.releaseBitmapPointer(nativePointer);
      p.free(p.load(head));
    }
  }
  for (const id of [0x170, 0x1af, 0x177])
    for (const valid of [false, true])
      for (const address of id === 0x177 && valid ? [0, 4] : [0, 4, 0xffffffff]) {
        const metadataArgs =
            id === 0x170
              ? [valid ? pointer : 0, index, address]
              : id === 0x1af
                ? [valid ? pointer : 0, address]
                : [1, address],
          modelArgs =
            id === 0x170
              ? [valid ? handle : 0, index, address]
              : id === 0x1af
                ? [valid ? handle : 0, address]
                : [1, address];
        const savedSource = current.source;
        if (id === 0x177 && !valid) current.source = null;
        p.write(destination, new Uint8Array(64).fill(0xa5));
        metadataArgs.forEach((value, i) => p.store(parameters + i * 4, value));
        const control = await engine.call(p.load(table + id * 4), [0, caller, parameters, result]),
          native = { control, value: p.load(result), payload: [...p.read(destination, 64)] },
          modelMemory = new Uint8Array(64).fill(0xa5),
          machine = {
            bytes: (at, size) => {
              if (at === 0xffffffff) throw new RangeError('Unmapped VM destination');
              return modelMemory.subarray(at, at + size);
            },
          },
          reply = await nativeDataBuffer(id, modelArgs, machine, {
            dataBuffers: () => buffers,
            format: () => current.name,
          });
        checks(`metadata-${index}-${id.toString(16)}-${valid}-${address}`, native, {
          ...reply,
          payload: [...modelMemory],
        });
        current.source = savedSource;
      }
  checks(`buffer-retained-${index}`, [p.load(pointer + 12), p.load(p.load(pointer) - 4)], [1, 1]);
  buffers.release(handle);
}

// The original font setter consumes one reference without retaining the new
// buffer. Shared FES callers explicitly increment before sending this message.
for (const references of [1, 2, 3, 0xffffffff])
  for (const replacement of [false, true]) {
    const old = buffers.createPointer(Uint8Array.of(1, 2, 3)),
      next = replacement ? buffers.createPointer(Uint8Array.of(4, 5, 6)) : 0,
      object = p.allocate(24, true);
    p.store(old + 12, references);
    p.store(object + 20, old);
    const value = await engine.call(functions.font, [next], object);
    checks(
      `font-reference-transfer-${references}-${replacement}`,
      {
        value,
        oldAlive: p.allocations.has(old),
        oldReferences: p.load(old + 12),
        newStored: Number(p.load(object + 20) === next),
        newReferences: next ? p.load(next + 12) : null,
      },
      {
        value: 1,
        oldAlive: ((references - 1) | 0) > 0,
        oldReferences: (references - 1) >>> 0,
        newStored: 1,
        newReferences: next ? 1 : null,
      },
    );
    if (p.allocations.has(old)) {
      p.store(old + 12, 1);
      buffers.releasePointer(old);
    }
    if (next) buffers.releasePointer(next);
    p.free(object);
  }
const report = {
  profile,
  sha256,
  boundaries: [
    'KCS formatter',
    'VM pointer translation',
    'image-category mounted files',
    'CRT/Windows/zlib services',
  ],
  total: results.length,
  passed: results.filter((row) => row.equal).length,
  results,
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ profile, total: report.total, passed: report.passed }));
await engine.close();
if (report.passed !== report.total) process.exitCode = 1;
