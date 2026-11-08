// SPDX-License-Identifier: MPL-2.0
// Execute the mounted engine's bitmap-to-texture transfer and CPU copy loop.
// Only the preallocated page's D3D lock/unlock and page-allocation boundary are
// host callbacks. No executable bytes or game resources are stored here.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeTextWindows } from '../src/native/text-windows.mjs';
import { NativeGraphics } from '../src/native/graphics.mjs';
import { NativeGraphicsPlatform } from '../src/native/graphics-process.mjs';
import { NativeHandles } from '../src/native/handles.mjs';

const profiles = [
  [
    '--game',
    'nekopara-vol3-engine-2.6.1.76',
    {
      upload: 0x6805f0,
      ensure: 0x680d30,
      lock: 0x67f590,
      unlock: 0x67f610,
      construct: 0x68b3e0,
      configure: 0x68be00,
      release: 0x68cf20,
    },
  ],
  [
    '--sdk',
    'sdk-4.01-engine-2.6.1.74',
    {
      upload: 0x557210,
      ensure: 0x557900,
      lock: 0x5561e0,
      unlock: 0x556260,
      construct: 0x561f40,
      configure: 0x562970,
      release: 0x563a90,
    },
  ],
];
let total = 0;
const originalProfiles = [],
  goldenCases = [],
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let goldenSource, goldenFrame;
for (const [flag, profile, abi] of profiles) {
  const arg = process.argv.indexOf(flag);
  if (arg < 0) continue;
  const engine = await NativeEngineProcess.open({
      profile,
      bytes: new Uint8Array(await readFile(process.argv[arg + 1])),
    }),
    p = engine.process,
    pageWidth = 64,
    pageHeight = 64,
    world = {
      profile,
      game: { width: pageWidth, height: pageHeight },
      runtime: { handles: new NativeHandles() },
    },
    windows = new NativeTextWindows(p, { kernel: engine.kernel }),
    source = p.allocate(92, true),
    manager = p.allocate(64, true),
    texture = p.allocate(16, true),
    pages = p.allocate(4, true),
    target = p.allocate(pageWidth * pageHeight * 4, true);
  let constructed = false,
    count = 0;
  try {
    world.configuration = {
      fields: {
        texture: {
          size: Uint32Array.of(pageWidth, pageHeight),
          grid: Uint32Array.of(1, 1),
          bppY: Uint32Array.of(0, 1),
          bpp: 32,
          areas: Array.from({ length: 8 }, (_, i) =>
            Uint32Array.from(i ? [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff] : [0, 0, 1, 1]),
          ),
        },
      },
    };
    for (const name of ['SetRectEmpty', 'IntersectRect', 'OffsetRect', 'IsRectEmpty'])
      engine.registerWindows('USER32.dll', name, windows.definitions.get(name));
    world.graphics = new NativeGraphics(world);
    const platform = new NativeGraphicsPlatform(engine, world);
    engine.patch(abi.ensure, 'authored preallocated texture page', 1, () => 1, {
      calleePops: true,
    });
    engine.patch(
      abi.lock,
      'authored D3D texture lock',
      1,
      ([rect]) => {
        const x = p.load(rect) | 0,
          y = p.load(rect + 4) | 0;
        p.store(rect + 20, pageWidth * 4);
        p.store(rect + 24, target + (y * pageWidth + x) * 4);
        return 1;
      },
      { calleePops: true },
    );
    engine.patch(abi.unlock, 'authored D3D texture unlock', 0, () => 1, { calleePops: true });
    [pageWidth, pageHeight, 1, 1, 0, pages, 1].forEach((value, i) =>
      p.store(manager + i * 4, value),
    );
    [1, pageWidth, pageHeight, 4].forEach((value, i) => p.store(texture + i * 4, value));
    p.store(pages, texture);
    await engine.call(abi.construct, [], source);
    constructed = true;
    await engine.call(abi.configure, [8, 7, 4], source);
    const pixels = new Uint8Array(8 * 7 * 4);
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 8; x++)
        pixels.set([3 + x * 7, 11 + y * 13, 23 + x + y, 31 + x * 5 + y * 9], (y * 8 + x) * 4);
    p.write(p.load(source + 12), pixels);
    goldenSource = [...pixels];
    for (const [ox, oy] of [
      [0, 0],
      [2, 3],
      [-2, -1],
    ]) {
      p.store(source + 36, ox);
      p.store(source + 40, oy);
      for (const [sx, sy, width, height] of [
        [0, 0, 8, 7],
        [1, 2, 3, 2],
        [-3, -4, 9, 10],
        [20, 20, 2, 2],
        [0, 0, 0, 2],
        [0, 0, 2, -1],
      ])
        for (const [dx, dy] of [
          [0, 0],
          [11, 13],
          [-3, -2],
        ]) {
          p.zero(target, pageWidth * pageHeight * 4);
          const result = await engine.call(
              abi.upload,
              [dx, dy, source, sx, sy, width, height, 0],
              manager,
            ),
            raw = p.read(target, pageWidth * pageHeight * 4),
            expected = new Uint8ClampedArray(raw.length);
          for (let i = 0; i < raw.length; i += 4)
            expected.set([raw[i + 2], raw[i + 1], raw[i], raw[i + 3]], i);
          await world.graphics.fill(0, 0, pageWidth, pageHeight, 0);
          const actualResult = await platform.copyBitmap(source, sx, sy, width, height, dx, dy),
            actual = await world.graphics.images.get(world.graphics.vramHandle).pixels(),
            label = `${profile}: ${[ox, oy, sx, sy, width, height, dx, dy]}`;
          assert.equal(actualResult, result, `${label} return word`);
          assert.deepEqual(actual, expected, `${label} native texture RGBA`);
          const golden = {
            offset: [ox, oy],
            source: [sx, sy, width, height],
            destination: [dx, dy],
            result,
            sha256: hash(expected),
          };
          if (!originalProfiles.length) goldenCases.push(golden);
          else
            assert.deepEqual(golden, goldenCases[count], `${label} cross-profile original output`);
          if (!count) {
            const frame = new Uint8Array(8 * 7 * 4);
            for (let y = 0; y < 7; y++)
              frame.set(expected.subarray(y * pageWidth * 4, (y * pageWidth + 8) * 4), y * 8 * 4);
            goldenFrame = [...frame];
          }
          count++;
        }
    }
    console.log(`${profile}: ${count} original bitmap-to-texture transfers agree`);
    total += count;
    originalProfiles.push(profile);
  } finally {
    if (constructed) await engine.call(abi.release, [], source);
    else p.free(source);
    for (const pointer of [manager, texture, pages, target]) p.free(pointer);
    await engine.close();
  }
}
if (!total)
  throw new Error(
    'Usage: node scripts/verify-native-graphics-platform.mjs --game /mounted/engine.exe --sdk /mounted/cs2_open.exe',
  );
console.log(`${total} original bitmap transfers agree`);
if (process.argv.includes('--write-fixture')) {
  if (originalProfiles.length !== profiles.length)
    throw new Error('The public upload fixture requires both independent engine profiles');
  await writeFile(
    new URL('../tests/fixtures/native-bitmap-upload-golden.json', import.meta.url),
    JSON.stringify(
      {
        profiles: originalProfiles,
        size: [8, 7],
        viewport: [64, 64],
        bgra: goldenSource,
        rgba: goldenFrame,
        cases: goldenCases,
      },
      null,
      2,
    ) + '\n',
  );
}
