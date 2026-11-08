// SPDX-License-Identifier: MPL-2.0
// Execute original bitmap clipping, page routing and row copying. Only the
// D3D device/texture COM methods and Windows rectangle functions are hosts.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import {
  BITMAP_UPLOAD_LAYOUT,
  bitmapUploadCases,
  bitmapUploadSource,
} from '../tests/fixtures/bitmap-upload.mjs';

const golden = { profiles: [], layout: BITMAP_UPLOAD_LAYOUT, cases: [] };
for (const [flag, profile, abi] of [
  [
    '--game',
    'nekopara-vol3-engine-2.6.1.76',
    {
      copy: 0x677690,
      global: 0xb90778,
      construct: 0x68b3e0,
      configure: 0x68be00,
      release: 0x68cf20,
    },
  ],
  [
    '--sdk',
    'sdk-4.01-engine-2.6.1.74',
    {
      copy: 0x54e790,
      global: 0xc95180,
      construct: 0x561f40,
      configure: 0x562970,
      release: 0x563a90,
    },
  ],
]) {
  const at = process.argv.indexOf(flag);
  if (at < 0) continue;
  const engine = await NativeEngineProcess.open({
      profile,
      bytes: new Uint8Array(await readFile(process.argv[at + 1])),
    }),
    p = engine.process,
    [width, height] = BITMAP_UPLOAD_LAYOUT.size,
    [columns, rows] = BITMAP_UPLOAD_LAYOUT.grid,
    pitch = width * 4 + 8,
    renderer = p.allocate(0x800, true),
    device = p.allocate(4, true),
    deviceVft = p.allocate(64, true),
    textureVft = p.allocate(128, true),
    pageArray = p.allocate(columns * rows * 4, true),
    dirty = p.allocate(columns * rows * 4, true),
    manager = p.allocate(32, true),
    holder = p.allocate(64, true),
    view = p.allocate(12, true),
    bitmap = p.allocate(92, true),
    textures = new Map();
  const events = [];
  for (const [name, definition] of nativeRectangleDefinitions(p))
    engine.registerWindows('USER32.dll', name, definition);
  p.store(device, deviceVft);
  p.store(
    deviceVft + 12,
    p.trap('authored TestCooperativeLevel', 1, ([self]) => {
      assert.equal(self, device);
      return 0;
    }),
  );
  p.store(
    textureVft + 76,
    p.trap('authored LockRect', 5, ([self, level, locked, rectangle, flags]) => {
      const texture = textures.get(self);
      assert.ok(texture);
      assert.equal(level, 0);
      const r = rectangle
        ? Array.from({ length: 4 }, (_, i) => p.load(rectangle + i * 4) | 0)
        : [0, 0, width, height];
      events.push({ method: 'LockRect', page: texture.index, rectangle: r, flags });
      p.store(locked, pitch);
      p.store(locked + 4, texture.pixels + r[1] * pitch + r[0] * 4);
      return 0;
    }),
  );
  p.store(
    textureVft + 80,
    p.trap('authored UnlockRect', 2, ([self, level]) => {
      assert.equal(level, 0);
      events.push({ method: 'UnlockRect', page: textures.get(self).index });
      return 0;
    }),
  );
  p.store(
    textureVft + 84,
    p.trap('authored AddDirtyRect', 2, ([self, rectangle]) => {
      events.push({
        method: 'AddDirtyRect',
        page: textures.get(self).index,
        rectangle: Array.from({ length: 4 }, (_, i) => p.load(rectangle + i * 4) | 0),
      });
      return 0;
    }),
  );
  p.store(renderer + 308, device);
  p.store(abi.global, renderer);
  for (let index = 0; index < columns * rows; index++) {
    const textureCOM = p.allocate(4, true),
      record = p.allocate(32, true),
      wrapper = p.allocate(24, true),
      pixels = p.allocate(pitch * height, true);
    p.store(textureCOM, textureVft);
    p.store(record + 20, textureCOM);
    [record, width, height, 4].forEach((v, i) => p.store(wrapper + i * 4, v));
    p.store(pageArray + index * 4, wrapper);
    textures.set(textureCOM, { index, pixels });
  }
  [width, height, columns, rows, 0, pageArray, columns * rows, dirty].forEach((v, i) =>
    p.store(manager + i * 4, v),
  );
  p.store(view + 8, manager);
  p.store(holder + 4, 1);
  p.store(holder + 8, view);
  p.store(holder + 52, 1);
  try {
    await engine.call(abi.construct, [], bitmap);
    assert.equal(await engine.call(abi.configure, [5, 4, 4], bitmap), 1);
    p.write(p.load(bitmap + 12), bitmapUploadSource());
    for (const probe of bitmapUploadCases()) {
      events.length = 0;
      p.zero(dirty, columns * rows * 4);
      for (const texture of textures.values())
        p.write(texture.pixels, new Uint8Array(pitch * height).fill(0xa5));
      const [ox, oy] = probe.origin || [0, 0];
      p.store(bitmap + 36, ox);
      p.store(bitmap + 40, oy);
      const result = await engine.call(
          abi.copy,
          [bitmap, ...probe.source, ...probe.destination],
          holder,
        ),
        pages = [...textures.values()].map((texture) =>
          Buffer.from(p.read(texture.pixels, pitch * height)).toString('base64'),
        ),
        entry = {
          name: probe.name,
          result,
          pitch,
          pages,
          events: structuredClone(events),
          dirty: Array.from({ length: columns * rows }, (_, i) => p.load(dirty + i * 4)),
        };
      if (golden.profiles.length)
        assert.deepEqual(
          entry,
          golden.cases.find((value) => value.name === probe.name),
          `${profile}/${probe.name}`,
        );
      else golden.cases.push(entry);
    }
    await engine.call(abi.release, [], bitmap);
    golden.profiles.push({ profile, sha256: engine.identity });
    console.log(
      `${profile}: ${bitmapUploadCases().length} complete original bitmap-to-D3D uploads`,
    );
  } finally {
    await engine.close();
  }
}
if (process.argv.includes('--write-fixture')) {
  assert.equal(golden.profiles.length, 2);
  await writeFile(
    new URL('../tests/fixtures/native-d3d-bitmap-upload-golden.json', import.meta.url),
    JSON.stringify(golden, null, 2) + '\n',
  );
}
