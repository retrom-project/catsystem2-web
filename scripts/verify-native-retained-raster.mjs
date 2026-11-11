// SPDX-License-Identifier: MPL-2.0
// Run the mounted original renderer independently of NativeDrawTask. Only the
// Windows rectangle API and final CPU-bitmap upload are host boundaries.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGraphicsPlatform } from '../oracle/graphics-consumer-projection.mjs';
import { NativeGraphics } from '../src/native/graphics.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeBitmap } from '../src/native/image.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { floatBits } from '../src/kcs.mjs';
import { retainedRasterCases, RETAINED_RASTER_SIZE } from '../tests/fixtures/retained-raster.mjs';

const profiles = [
    [
      '--game',
      'nekopara-vol3-engine-2.6.1.76',
      {
        construct: 0x742a10,
        destroy: 0x742cf0,
        bitmap: 0x742e20,
        draw: 0x7439b0,
        clip: 0x7441f0,
        layer: 0x744340,
        affineTable: 0xb6f048,
      },
    ],
    [
      '--sdk',
      'sdk-4.01-engine-2.6.1.74',
      {
        construct: 0x5e3720,
        destroy: 0x5e39e0,
        bitmap: 0x5e3b10,
        draw: 0x5e45e0,
        clip: 0x5e4e20,
        layer: 0x5e4f70,
        affineTable: 0xc73b68,
      },
    ],
  ],
  golden = {
    profiles: [],
    size: RETAINED_RASTER_SIZE,
    affineTableSha256: '021182038e39289b423f6cf925c953c5a63bfda97b4ca17d277835c72c2c92f8',
    cases: [],
  };
for (const [flag, profile, abi] of profiles) {
  const index = process.argv.indexOf(flag);
  if (index < 0) continue;
  const engine = await NativeEngineProcess.open({
      profile,
      bytes: new Uint8Array(await readFile(process.argv[index + 1])),
    }),
    p = engine.process,
    [width, height] = RETAINED_RASTER_SIZE,
    world = {
      profile,
      game: { width, height },
      runtime: { handles: new NativeHandles() },
      configuration: new NativeConfiguration({ profile }),
    };
  world.graphics = new NativeGraphics(world);
  const platform = new NativeGraphicsPlatform(engine, world);
  for (const [name, definition] of nativeRectangleDefinitions(p))
    engine.registerWindows('USER32.dll', name, definition);
  try {
    assert.equal(
      createHash('sha256')
        .update(p.read(abi.affineTable, 32769 * 4))
        .digest('hex'),
      golden.affineTableSha256,
      profile + ' original affine table',
    );
    for (const [number, probe] of retainedRasterCases().entries()) {
      const manager = p.allocate(60, true),
        scratch = p.allocate(40, true),
        image = new NativeBitmap(world.graphics.images, probe.source),
        item = probe.item;
      let constructed = false;
      try {
        await engine.call(abi.construct, [width, height, 4, 0], manager);
        constructed = true;
        const nativeBitmap = p.load(p.load(manager + 8));
        p.store(manager + 16, 0);
        p.store(manager + 20, 0);
        p.store(manager + 40, probe.clear);
        await platform.writeLogicalBitmap(
          nativeBitmap,
          new NativeBitmap(world.graphics.images, {
            width,
            height,
            bpp: 4,
            canvasWidth: width,
            canvasHeight: height,
            offsetX: 0,
            offsetY: 0,
            baseX: 0,
            baseY: 0,
            clip: [0, 0, width, height],
            attributes: [],
            rgba: new Uint8ClampedArray(width * height * 4).fill(19),
            source: null,
          }),
        );
        [...item.position, ...item.base, ...item.scale].forEach((v, i) =>
          p.store(scratch + i * 4, floatBits(v)),
        );
        item.clip.forEach((v, i) => p.store(scratch + 24 + i * 4, v));
        await platform.withBitmap(image, (bitmap) =>
          engine.call(
            abi.bitmap,
            [
              item.key,
              bitmap,
              scratch,
              scratch + 8,
              floatBits(item.rotation),
              scratch + 16,
              item.alpha,
              1,
              item.mode,
            ],
            manager,
          ),
        );
        await engine.call(abi.clip, [item.key, scratch + 24], manager);
        await engine.call(abi.layer, [item.key, item.layer], manager);
        const dirty = p.load(p.load(manager + 12));
        probe.area.forEach((v, i) => p.store(dirty + 16 + i * 4, v));
        await engine.call(abi.draw, [1, 1, 0], manager);
        const result = {
          name: probe.name,
          cpu: Buffer.from(await platform.logicalBitmap(nativeBitmap).pixels()).toString('base64'),
          vram: Buffer.from(
            await world.graphics.images.get(world.graphics.vramHandle).pixels(),
          ).toString('base64'),
        };
        if (!golden.profiles.length) golden.cases.push(result);
        else assert.deepEqual(result, golden.cases[number], `${profile}:${probe.name}`);
      } finally {
        if (constructed) await engine.call(abi.destroy, [], manager);
        p.free(manager);
        p.free(scratch);
      }
    }
    golden.profiles.push(profile);
    console.log(`${profile}: ${retainedRasterCases().length} original retained CPU/VRAM probes`);
  } finally {
    await engine.close();
  }
}
if (!golden.profiles.length) throw new Error('Supply --game EXE and/or --sdk EXE');
const fixture = new URL('../tests/fixtures/native-retained-raster-golden.json', import.meta.url);
if (process.argv.includes('--write-fixture')) {
  assert.equal(golden.profiles.length, 2, 'A public golden requires both original profiles');
  await writeFile(fixture, JSON.stringify(golden, null, 2) + '\n');
} else {
  const expected = JSON.parse(await readFile(fixture));
  assert.equal(golden.affineTableSha256, expected.affineTableSha256);
  assert.deepEqual(golden.cases, expected.cases);
}
