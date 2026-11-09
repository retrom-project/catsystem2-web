// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_BITMAP_OPERATION_CONTRACTS } from '../src/native/bitmap-operations.mjs';
import { bitmapMemoryFixture } from '../tests/fixtures/bitmap-memory-fixture.mjs';
import { contentAllocations } from '../tests/fixtures/content-databases-fixture.mjs';
import { installNativeRasterKernels } from '../src/native/raster-kernel.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-bitmap-operations.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (k) => NATIVE_ENGINE_IMAGES[k].sha256 === sha256,
  );
if (!profile) throw new Error('Bitmap oracle requires a frozen engine');
const raw = await bitmapMemoryFixture(bytes, profile, { uploadBoundary: true }),
  f = await bitmapMemoryFixture(bytes, profile, { uploadBoundary: true }),
  p = raw.process,
  a = raw.machine,
  b = f.machine,
  index = Number(profile.startsWith('sdk-')),
  covered = new Map();
installNativeRasterKernels(f.engine);
for (const spec of NATIVE_BITMAP_OPERATION_CONTRACTS.filter((item) => item.handlers[index]))
  assert.equal(
    p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + spec.id * 4),
    spec.handlers[index],
    `frozen native table slot ${spec.id.toString(16)}`,
  );
let comparisons = 0,
  calls = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const h = raw.images.create(4, 3, 1),
  fh = f.images.create(4, 3, 1),
  s = raw.images.create(4, 3, 2),
  fs = f.images.create(4, 3, 2);
check(fh, h, 'same host destination');
check(fs, s, 'same host source');
const pointers = new Map();
for (const handle of [h, s]) {
  const pa = await raw.memory.wrapper(handle),
    pb = await f.memory.wrapper(handle);
  check(pb, pa, 'same original wrapper pointer');
  pointers.set(handle, pa);
}
const alphaPercentages = [
  0, 1, 37, 50, 75, 99, 100, 101, 150, 255, 1000, 0x01010101, 0x80000000, 0xffffffff,
];
const block = a.allocate(1024);
check(b.allocate(1024), block, 'same extended VM base');
const reset = (bpp = 4) => {
  for (const fixture of [raw, f]) {
    for (const handle of [h, s]) {
      const ptr = fixture.process.load(pointers.get(handle));
      let data = fixture.process.load(ptr + 12);
      if (!(fixture.process.allocations.get(data - 4) >= 52)) {
        if (data) fixture.buffers.releaseData(data);
        data = fixture.buffers.allocateData(48);
        fixture.process.store(ptr + 12, data);
      }
      fixture.process.write(
        data,
        Uint8Array.from({ length: 48 }, (_, i) => (i * 37 + handle * 17) & 255),
      );
      for (const [o, v] of [
        [4, 4],
        [8, 3],
        [16, bpp === 2 ? 24 : 48],
        [20, bpp === 2 ? 8 : bpp === 3 ? 12 : 16],
        [24, bpp],
        [28, 4],
        [32, 3],
        [36, -1],
        [40, 1],
        [44, 0],
        [48, 3],
        [52, -2],
        [56, 0],
        [60, 0],
        [64, 4],
        [68, 3],
        [76, 0],
        [84, 0],
      ])
        fixture.process.store(ptr + o, v);
    }
    fixture.machine.memory.fill(0xa5);
    fixture.machine.shared.fill(0x5a);
    for (const v of fixture.machine.blocks) v.fill(0x3c);
  }
};
function rotationSource(width, height, bpp) {
  const stride = ((width * bpp + 3) & ~3) + 4,
    bytes = Uint8Array.from({ length: stride * height }, (_, i) => (i * 23 + 17) & 255);
  for (const fixture of [raw, f]) {
    const p = fixture.process,
      bitmap = p.load(pointers.get(h)),
      storage = fixture.buffers.allocateData(bytes.length);
    fixture.buffers.releaseData(p.load(bitmap + 12));
    p.write(storage, bytes);
    for (const [offset, value] of [
      [4, width],
      [8, height],
      [12, storage],
      [16, bytes.length],
      [20, stride],
      [28, width + 3],
      [32, height + 4],
    ])
      p.store(bitmap + offset, value);
  }
}
async function run(spec, args) {
  const words = [...args];
  while (!words.length) words.push(a.nativeArgument(0));
  let count = spec.words;
  if (spec.id === 0x16f) {
    while (words.length < 6) words.push(a.nativeArgument(words.length));
    if (!words[5]) count = 6;
  } else if (!words[0] && spec.id !== 0x16a && spec.id !== 0x16b) count = 1;
  while (words.length < count) words.push(a.nativeArgument(words.length));
  if (spec.id !== 0x16f || words[5]) {
    words[0] = words[0] ? pointers.get(words[0]) : 0;
    if (spec.id === 0x16f) words[5] = words[5] ? pointers.get(words[5]) : 0;
  }
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(4),
    host = spec.id === 0x16f && !words[0] && words[5] ? p.allocate(120, true) : 0;
  let control, value;
  try {
    words.forEach((v, i) => p.store(argv + i * 4, v));
    p.store(out, 0xcccccccc);
    if (host) p.store(host + 116, raw.view);
    control = await raw.engine.call(spec.handlers[index], [bridge.pointer, host, argv, out]);
    value = p.load(out);
  } finally {
    bridge.close();
    if (host) p.free(host);
    p.free(out);
    p.free(argv);
  }
  const reply = await f.operations.apply(spec.id, args, b, { id: 1 });
  calls++;
  covered.set(spec.id, (covered.get(spec.id) ?? 0) + 1);
  check(reply.control, control, 'control/' + spec.id.toString(16));
  if (control === 1) check(reply.value, value, 'result word');
  check(b.memory, a.memory, 'whole VM memory');
  check(b.shared, a.shared, 'shared bytes');
  check(b.blocks, a.blocks, 'extended allocations');
  check(f.uploads, raw.uploads, 'VRAM call boundary');
  check(
    contentAllocations(f.process),
    contentAllocations(p),
    'all live original bitmap/heap bytes',
  );
  return reply;
}
try {
  for (const spec of NATIVE_BITMAP_OPERATION_CONTRACTS.filter((item) => item.handlers[index])) {
    reset();
    await run(
      spec,
      spec.id === 0x16f
        ? [0x41414141, 0, 0, 0, 0, 0]
        : [0x16a, 0x16b].includes(spec.id)
          ? [0, 512, 516]
          : [0],
    );
    for (const bpp of [2, 3, 4])
      for (let n = 0; n < 24; n++) {
        reset(bpp);
        let args;
        switch (spec.id) {
          case 0x16f: {
            const rects = [
              [0, 0, 4, 3],
              [1, 1, 2, 1],
              [-1, 0, 3, 2],
              [0, -1, 2, 3],
              [3, 2, 4, 3],
              [0, 0, 0, 1],
            ];
            const dst = rects[n % rects.length],
              src = rects[(n + 1) % rects.length];
            args = [n % 4 === 0 ? 0 : h, ...dst, n % 5 === 0 ? h : s, ...src];
            break;
          }
          case 0x7a:
          case 0x2c1:
            args = [h, [0, 2, 4, 8, 6, 4][n % 6], [0, 2, 3, 6, 6, 3][n % 6]];
            break;
          case 0x171:
            args = [h, [0, 0xff112233, 0x80123456, 0xffffffff][n % 4]];
            break;
          case 0x172:
          case 0x402:
            args = [h, [-3, -1, 0, 1, 3, 4][n % 6], [-2, -1, 0, 1, 2, 4][(n * 5) % 6]];
            break;
          case 0x16a:
          case 0x16b: {
            for (const fixture of [raw, f]) {
              const ptr = fixture.process.load(pointers.get(h)),
                offset = spec.id === 0x16a ? 28 : 36;
              fixture.process.store(ptr + offset, [0, 1, 17, 0x80000000][n % 4]);
              fixture.process.store(ptr + offset + 4, [0, 23, -7, 0xffffffff][n % 4]);
            }
            const at = [512, a.data.length + 64, 0x80000040, block + 64][n % 4];
            args = [h, at, at + [0, 1, 4, -1][n % 4]];
            break;
          }
          case 0x173: {
            const at = [512, a.data.length + 64, 0x80000040, block + 64][n % 4];
            args = [h, at, at + (n % 5 === 0 ? 0 : 4)];
            break;
          }
          case 0x174:
          case 0x175:
          case 0x176:
            args = [
              h,
              [0, 1, -1, 0x80000000, 0xffffffff, 17][n % 6],
              [0, 2, -2, 0xffffffff][n % 4],
            ];
            break;
          case 0x178:
            args = [h, [0, 1, 2, 3, 4, 0xffffffff][n % 6]];
            break;
          case 0x179:
            args = [h];
            break;
          case 0x17a:
            args = [h, [0, 1, 50, 100, 200, 0xffffffff][n % 6]];
            break;
          case 0x1d4: {
            const [width, height] = (
              bpp === 2
                ? [
                    [6, 4],
                    [4, 1],
                  ]
                : bpp === 3
                  ? [
                      [4, 4],
                      [1, 4],
                    ]
                  : [
                      [4, 3],
                      [3, 5],
                    ]
            )[n % 2];
            rotationSource(width, height, bpp);
            args = [h, [0, 90, 180, 270, -90, 360, 89, 271][(n + (n >> 3)) % 8]];
            break;
          }
          case 0x22e:
            args = [h, [0, 1, 2, 0xffffffff][n % 4]];
            break;
          case 0x234:
            args = [h, [0, 1, 0xff123456, 0x80123456, 0xffffffff][n % 5]];
            break;
          case 0x281:
            args = [h, alphaPercentages[n % alphaPercentages.length]];
            break;
        }
        await run(spec, args);
      }
    if (spec.id === 0x281)
      for (const percentage of alphaPercentages) {
        reset(4);
        const width = 256,
          stride = width * 4 + 12,
          height = 2,
          data = new Uint8Array(stride * height).fill(0x6d);
        for (let row = 0; row < height; row++)
          for (let x = 0; x < width; x++)
            data.set([x, x ^ 0x9c, (37 * x) & 255, row ? 255 - x : x], row * stride + x * 4);
        for (const fixture of [raw, f]) {
          const process = fixture.process,
            bitmap = process.load(pointers.get(h)),
            storage = fixture.buffers.allocateData(data.length);
          fixture.buffers.releaseData(process.load(bitmap + 12));
          process.write(storage, data);
          for (const [offset, value] of [
            [4, width],
            [8, height],
            [12, storage],
            [16, data.length],
            [20, stride],
            [76, 1],
          ])
            process.store(bitmap + offset, value);
        }
        await run(spec, [h, percentage]);
        const bitmap = p.load(pointers.get(h)),
          expected = data.slice();
        for (let row = 0; row < height; row++)
          for (let x = 0; x < width; x++) {
            const at = row * stride + x * 4 + 3;
            expected[at] = Math.min(255, Math.floor((Math.imul(data[at], percentage) >>> 0) / 100));
          }
        check(
          p.read(p.load(bitmap + 12), data.length),
          expected,
          'native alpha LUT and padded rows',
        );
        check(p.load(bitmap + 76), 1, 'native alpha scaler preserves the mask word');
      }
    reset();
    a.nativeArgumentBase = b.nativeArgumentBase = 7000;
    for (const m of [a, b])
      [h, 512, 516, 4, 3, s, 0, 0, 4, 3].forEach((v, i) => m.store(7000 + i * 4, v));
    await run(spec, []);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        covered: Object.fromEntries([...covered].map(([id, n]) => [id.toString(16), n])),
        scope:
          'All profile-available original wrapper slots (including identical 7A/2C1 resize aliases), canvas/offset queries, every alpha index with padded rows, valid right-angle rotations and the game-only 402 pixel getter, with persistent bitmap aliases, native BPP2/3/4 arithmetic, clipping/overlap, raw metadata, four VM domains, NULL/CCCC/adjacent-word behavior and all allocation bytes. VRAM upload is explicit boundary; arithmetic/dispatch is original except separately verified exact raster scanline kernels.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Bitmap operations passed ${calls} calls/${comparisons} comparisons`);
} finally {
  await f.engine.close();
  await raw.engine.close();
}
