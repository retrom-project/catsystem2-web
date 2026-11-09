// SPDX-License-Identifier: MPL-2.0
// Complete native blank-image create/clone/query/release paths and task-owned list.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeImages, nativeImage } from '../src/native/image.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-image-create.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Image creation oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  table = NATIVE_EXE_PROFILES[profile].tables.main.va,
  task = p.allocate(200, true),
  list = p.allocate(8, true),
  head = p.allocate(12, true),
  argv = p.allocate(32, true),
  result = p.allocate(4, true),
  memory = p.allocate(64, true),
  handles = new NativeHandles(),
  world = { runtime: { handles }, images: {}, graphics: {} },
  images = new NativeImages(world),
  out = new Map(),
  machine = { store: (at, value) => out.set(at, value) };
world.graphics.images = images;
p.store(head, head);
p.store(head + 4, head);
p.store(list, head);
p.store(task + 152, list);
engine.registerWindows('USER32.dll', 'SetRectEmpty', {
  count: 1,
  fn: ([out]) => {
    p.zero(out, 16);
    return 1;
  },
});
engine.registerWindows('USER32.dll', 'IsRectEmpty', {
  count: 1,
  fn: ([at]) =>
    Number(
      (p.load(at) | 0) >= (p.load(at + 8) | 0) || (p.load(at + 4) | 0) >= (p.load(at + 12) | 0),
    ),
});
engine.patch(
  profile.startsWith('sdk') ? 0x8a6910 : 0x8772a0,
  'authored blank image VM boundary',
  1,
  ([at]) => memory + at,
  { calleePops: true },
);
let passed = 0;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  call = async (id, args) => {
    args.forEach((word, i) => p.store(argv + i * 4, word));
    p.store(result, 0xcafebabe);
    const control = await engine.call(p.load(table + id * 4), [0, task, argv, result]);
    return control === 2 ? { control } : { control, value: p.load(result) };
  },
  model = (id, args) => nativeImage(id, args, machine, { id: 73 }, world),
  originalState = (wrapper) => {
    const inner = p.load(wrapper);
    return {
      width: p.load(inner + 4),
      height: p.load(inner + 8),
      bpp: p.load(inner + 24),
      canvasWidth: p.load(inner + 28),
      canvasHeight: p.load(inner + 32),
      offsetX: p.load(inner + 36) | 0,
      offsetY: p.load(inner + 40) | 0,
      baseX: p.load(inner + 48) | 0,
      baseY: p.load(inner + 52) | 0,
      clip: Array.from({ length: 4 }, (_, i) => p.load(inner + 56 + i * 4) | 0),
    };
  },
  modelState = (handle) =>
    Object.fromEntries(
      Object.keys(originalStateFields).map((key) => [key, images.get(handle).state[key]]),
    ),
  originalStateFields = {
    width: 0,
    height: 0,
    bpp: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    offsetX: 0,
    offsetY: 0,
    baseX: 0,
    baseY: 0,
    clip: 0,
  };
try {
  for (let trial = 0; trial < 12; trial++)
    for (const [width, height] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [0, 9],
      [9, 0],
      [1, 1],
      [2, 3],
      [7, 9],
      [32, 17],
    ]) {
      const a = await call(0x70, [width, height]),
        b = await model(0x70, [width, height]);
      compare(a.control, b.control, 'create control');
      compare(Boolean(a.value), Boolean(b.value), 'create result');
      compare(originalState(a.value), modelState(b.value), 'raw and canvas geometry');
      compare(
        p.read(p.load(p.load(a.value) + 12), width * height * 4),
        new Uint8Array(await images.get(b.value).pixels()),
        'transparent pixels including empty allocation',
      );
      compare(p.load(list + 4), 1, 'original automatic image registration');
      compare(
        await call(0x77, [a.value, 0, 4]),
        await model(0x77, [b.value, 0, 4]),
        'query control',
      );
      compare([p.load(memory), p.load(memory + 4)], [out.get(0), out.get(4)], 'query output');
      const inner = p.load(a.value),
        state = images.get(b.value).state,
        metadata = {
          canvasWidth: trial % 3 ? 17 : 0,
          canvasHeight: trial % 4 ? 19 : 0,
          offsetX: -7,
          offsetY: 11,
          baseX: 13,
          baseY: -17,
          clip: [1, 2, 3, 4],
        };
      for (const [key, offset] of [
        ['canvasWidth', 28],
        ['canvasHeight', 32],
        ['offsetX', 36],
        ['offsetY', 40],
        ['baseX', 48],
        ['baseY', 52],
      ])
        p.store(inner + offset, metadata[key]);
      metadata.clip.forEach((word, i) => p.store(inner + 56 + i * 4, word));
      Object.assign(state, metadata);
      const aCopy = await call(0x76, [a.value]),
        bCopy = await model(0x76, [b.value]);
      compare(aCopy.control, bCopy.control, 'clone control');
      compare(originalState(aCopy.value), modelState(bCopy.value), 'clone geometry');
      compare(p.load(list + 4), 2, 'original cloned image registration');
      compare(await call(0x72, [a.value]), await model(0x72, [b.value]), 'release source');
      compare(p.load(list + 4), 1, 'release unregisters source');
      compare(originalState(aCopy.value), modelState(bCopy.value), 'clone survives source release');
      compare(await call(0x72, [aCopy.value]), await model(0x72, [bCopy.value]), 'release clone');
      compare(p.load(list + 4), 0, 'release unregisters clone');
    }
  compare(await call(0x72, [0]), await model(0x72, [0]), 'null release');
  compare(await call(0x76, [0]), await model(0x76, [0]), 'null clone');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Complete original main70/76/77/72 create/clone/query/release, original bitmap constructors and allocator plus original task automatic image list. Full logical/raw geometry, zero-dimension allocations, pixel bytes and release order. KCS pointer translation and rectangle OS helpers are supplied. Resizing invalid/empty source canvas and draw acceptance are separate.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original blank image differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
