// SPDX-License-Identifier: MPL-2.0
// Complete original seven wrappers, decoders, image references and auto lists.
// View cache/device state and mounted files are authored fixture boundaries.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_BITMAP_FACTORY_CONTRACTS } from '../src/native/bitmap-factory.mjs';
import { bitmapFactoryFixture } from '../tests/fixtures/bitmap-factory-fixture.mjs';
import { contentAllocations } from '../tests/fixtures/content-databases-fixture.mjs';
import { installNativeRasterKernels } from '../src/native/raster-kernel.mjs';
const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-bitmap-factories.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Bitmap factory oracle requires a frozen engine');
const raw = await bitmapFactoryFixture(bytes, profile),
  f = await bitmapFactoryFixture(bytes, profile),
  p = raw.process,
  q = f.process,
  a = raw.machine,
  b = f.machine,
  index = Number(profile.startsWith('sdk-')),
  specs = new Map(NATIVE_BITMAP_FACTORY_CONTRACTS.map((spec) => [spec.id, spec])),
  owners = new Map(),
  covered = new Map(),
  rawContext = await raw.factories.context(1),
  context = await f.factories.context(1);
installNativeRasterKernels(f.engine);
let calls = 0,
  comparisons = 0,
  fill = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
check(context, rawContext, 'same actual list and Script-prefix addresses');
for (const fixture of [raw, f]) {
  const allocate = fixture.process.allocate.bind(fixture.process);
  fixture.process.allocate = (size, zero = false) => {
    const at = allocate(size, zero);
    if (size && !zero) fixture.process.write(at, new Uint8Array(size).fill(fill));
    return at;
  };
}
for (const spec of specs.values())
  assert.equal(p.load(NATIVE_PROFILES[profile].tables.main.va + spec.id * 4), spec.handlers[index]);
const block = a.allocate(1024);
check(b.allocate(1024), block, 'same extended block');
async function run(id, args) {
  const spec = specs.get(id),
    words = [...args];
  while (!words.length) words.push(a.nativeArgument(0));
  const handle = words[0];
  let count = spec.words;
  if ([0x72, 0x76, 0x79].includes(id) && !words[0]) count = 1;
  if (id === 0x75 && !words[0]) count = 5;
  while (words.length < count) words.push(a.nativeArgument(words.length));
  if (![0x6f, 0x70].includes(id) && words[0]) words[0] = owners.get(words[0]);
  const bridge = id === 0x72 && words[0] ? null : new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    words.forEach((word, i) => p.store(argv + i * 4, word));
    p.store(out, 0xcccccccc);
    if (id === 0x6f || (id === 0x75 && !words[0])) p.store(rawContext + 116, raw.view);
    control = await raw.engine.call(spec.handlers[index], [
      bridge?.pointer ?? 0,
      rawContext,
      argv,
      out,
    ]);
    value = p.load(out);
  } finally {
    bridge?.close();
    p.free(out);
    p.free(argv);
  }
  const reply = await f.factories.apply(id, args, b, { id: 1 });
  calls++;
  covered.set(id, (covered.get(id) ?? 0) + 1);
  check(reply.control, control, 'original control');
  if ([0x6f, 0x70, 0x76].includes(id)) {
    check(Boolean(reply.value), Boolean(value), 'original producer success');
    if (value) {
      check(await f.memory.wrapper(reply.value), value, 'original wrapper identity');
      owners.set(reply.value, value);
    }
  } else if (id === 0x72 && handle) owners.delete(handle);
  check(b.memory, a.memory, 'complete VM data/stack');
  check(b.shared, a.shared, 'complete shared bytes');
  check(b.blocks, a.blocks, 'complete extended blocks');
  check(f.clears, raw.clears, 'screen view coordinates/ECX');
  check(
    contentAllocations(q),
    contentAllocations(p),
    'all allocated wrapper/bitmap/list/heap bytes',
  );
  return reply;
}
const resetVM = () => {
  for (const m of [a, b]) {
    m.memory.fill(0xa5);
    m.shared.fill(0x5a);
    m.blocks[0].fill(0x3c);
    m.fp = 128;
    m.store(128, 1536);
    m.store(132, 0);
    m.writeString('probe.hg2', 1536);
  }
};
try {
  for (const heapFill of [0, 0xa7]) {
    fill = heapFill;
    for (const [width, height] of [
      [0, 0],
      [0, 3],
      [3, 0],
      [1, 1],
      [3, 2],
      [4, 3],
      [7, 9],
    ]) {
      resetVM();
      const h = (await run(0x70, [width, height])).value;
      if (width && height) {
        for (const bpp of [2, 3, 4]) {
          const stride = (width * bpp + 3) & ~3;
          for (const process of [p, q]) {
            const at = process.load(owners.get(h)),
              data = process.load(at + 12);
            for (const [offset, word] of [
              [16, stride * height],
              [20, stride],
              [24, bpp],
              [28, width + 2],
              [32, height + 3],
              [36, -1],
              [40, 2],
              [48, 3],
              [52, -4],
              [56, 0],
              [60, 0],
              [64, width],
              [68, height],
              [76, 0],
            ])
              process.store(at + offset, word);
            process.write(
              data,
              Uint8Array.from({ length: stride * height }, (_, i) => (i * 37 + 19) & 255),
            );
          }
          for (const [x, y, w, h2, color] of [
            [0, 0, 1, 1, 0xff123456],
            [-1, -1, 3, 2, 0x80123456],
            [width - 1, 0, 2, height, 0],
            [0, 0, 0, 1, 0xffffffff],
          ])
            await run(0x75, [h, x, y, w, h2, color]);
          for (const tones of [
            [100, 100, 100],
            [0, 50, 200],
            [-1, 101, 128],
            [0x80000000, 0xffffffff, 100],
          ])
            await run(0x79, [h, ...tones]);
        }
      }
      const clone = (await run(0x76, [h])).value;
      for (const at of [512, a.data.length + 64, 0x80000040, block + 64])
        await run(0x77, [clone, at, at + 4]);
      await run(0x72, [h]);
      await run(0x72, [clone]);
    }
    for (const name of [
      '',
      'probe.hg2',
      'attr.hg3',
      'missing.hg2',
      'broken.hg2',
      'empty.hg2',
      'probe.hg2 second.hg2',
      'missing.hg2 probe.hg2',
      'probe.hg2:0',
      'probe.hg2:999',
      '%s',
      '(:probe.hg2)',
    ]) {
      resetVM();
      for (const m of [a, b]) m.writeString(name, 256);
      const result = await run(0x6f, [256]);
      if (result.value) {
        const clone = (await run(0x76, [result.value])).value;
        await run(0x77, [clone, 768, 772]);
        await run(0x72, [result.value]);
        await run(0x72, [clone]);
      }
    }
    resetVM();
    await run(0x75, [0, -1, 2, 3, 4]);
    for (const id of [0x72, 0x76, 0x79]) await run(id, [0]);
    await run(0x77, [0, 512, 516]);
    resetVM();
    for (const m of [a, b]) {
      m.nativeArgumentBase = 3000;
      m.store(3000, 2);
      m.store(3004, 2);
    }
    const adjacent = (await run(0x70, [])).value;
    for (const m of [a, b]) {
      [adjacent, 0, 0, 1, 1, 0xff123456].forEach((v, i) => m.store(3000 + i * 4, v));
    }
    await run(0x75, [adjacent]);
    for (const m of [a, b]) [adjacent, 50, 100, 200].forEach((v, i) => m.store(3000 + i * 4, v));
    await run(0x79, [adjacent]);
    for (const m of [a, b]) [adjacent, 512, 516].forEach((v, i) => m.store(3000 + i * 4, v));
    await run(0x77, [adjacent]);
    const cloned = (await run(0x76, [])).value;
    await run(0x72, []);
    await run(0x72, [cloned]);
    for (const m of [a, b]) {
      m.writeString('probe.hg2', 256);
      m.store(3000, 256);
    }
    const loaded = (await run(0x6f, [])).value;
    await run(0x72, [loaded]);
  }
  check(owners.size, 0, 'all logical resources released');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        covered: [...covered].map(([id, count]) => ({ id, count })),
        scope:
          'All seven complete original wrappers, real decoders and automatic image list; exact full live heap/VM bytes under two authored allocator fill patterns. Reference scanlines are unmodified; adapter raster acceleration is enabled. Mounted IFile, empty view cache and GPU clear are supplied boundaries; real World/GPU acceptance is separate.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ profile, calls, comparisons, errors: 0 }));
} finally {
  await f.engine.close();
  await raw.engine.close();
}
