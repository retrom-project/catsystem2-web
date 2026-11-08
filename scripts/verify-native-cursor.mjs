// SPDX-License-Identifier: MPL-2.0
// Original cursor view, visibility and D3D bitmap upload. Device COM calls and
// image-file loading are explicit boundaries; no platform entry point is run.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeCursor } from '../src/native/cursor.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-cursor.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  digest = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === digest)?.[0];
if (!profile) throw new Error('Cursor oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk-'),
  abi = sdk
    ? {
        viewImage: 0x54e2e0,
        softwareImage: 0x5589b0,
        hardwareImage: 0x556e30,
        d3dImage: 0x5488a0,
        bitmapCtor: 0x561f40,
        bitmapConfigure: 0x562970,
        bitmapDtor: 0x563a90,
        visible: 0x54e890,
        hotspot: 108,
      }
    : {
        viewImage: 0x6771f0,
        softwareImage: 0x681e20,
        hardwareImage: 0x680210,
        d3dImage: 0x671a50,
        bitmapCtor: 0x68b3e0,
        bitmapConfigure: 0x68be00,
        bitmapDtor: 0x68cf20,
        visible: 0x677730,
        hotspot: 140,
      },
  engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  view = p.allocate(1024, true),
  name = p.allocate(520, true),
  device = p.allocate(4, true),
  table = p.allocate(200, true),
  surface = p.allocate(4, true),
  surfaceTable = p.allocate(100, true),
  upload = p.allocate(4096, true),
  renderer = p.allocate(1600, true);
let passed = 0,
  requested = [],
  creations = 0,
  releases = 0,
  deviceFailure = 0,
  propertiesFailure = 0;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  text = (address) => (address ? p.string(address, !sdk) : null),
  setName = (value) => {
    const bytes = sdk
      ? encodeCP932(value + '\0')
      : Uint8Array.from(
          [...value, '\0'].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >>> 8]),
        );
    p.zero(name, 520);
    p.write(name, bytes);
  };
for (const [address, backend] of [
  [abi.softwareImage, 'software'],
  [abi.hardwareImage, 'direct3d'],
])
  engine.patch(
    address,
    `cursor ${backend} image resource boundary`,
    3,
    ([file, x, y]) => {
      requested.push([backend, text(file), x | 0, y | 0]);
      return 1;
    },
    { calleePops: true },
  );
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
engine.registerWindows('USER32.dll', 'IntersectRect', {
  count: 3,
  fn: ([out, a, b]) => {
    const rect = [
      Math.max(p.load(a) | 0, p.load(b) | 0),
      Math.max(p.load(a + 4) | 0, p.load(b + 4) | 0),
      Math.min(p.load(a + 8) | 0, p.load(b + 8) | 0),
      Math.min(p.load(a + 12) | 0, p.load(b + 12) | 0),
    ];
    if (rect[0] >= rect[2] || rect[1] >= rect[3]) {
      p.zero(out, 16);
      return 0;
    }
    rect.forEach((value, i) => p.store(out + i * 4, value));
    return 1;
  },
});
p.store(device, table);
p.store(surface, surfaceTable);
p.store(renderer + 308, device);
const method = (vft, offset, name, count, callback) =>
  p.store(vft + offset, p.trap(name, count, callback));
method(table, 12, 'cursor device cooperative status', 1, () => deviceFailure);
method(
  table,
  144,
  'cursor create system-memory surface',
  7,
  ([self, w, h, format, pool, out, shared]) => {
    assert.deepEqual([self, w, h, format, pool, shared], [device, 32, 32, 21, 3, 0]);
    creations++;
    p.store(out, surface);
    return 0;
  },
);
method(surfaceTable, 8, 'cursor release surface', 1, () => {
  releases++;
  return 0;
});
method(surfaceTable, 52, 'cursor lock surface', 4, ([self, out, rect, flags]) => {
  assert.deepEqual([self, rect, flags], [surface, 0, 0]);
  p.store(out, 128);
  p.store(out + 4, upload);
  return 0;
});
method(surfaceTable, 56, 'cursor unlock surface', 1, () => 0);
method(table, 40, 'cursor SetCursorProperties', 4, ([self, x, y, data]) => {
  requested.push(['properties', self, x, y, data]);
  return propertiesFailure;
});
method(table, 48, 'cursor ShowCursor', 2, ([self, visible]) => {
  requested.push(['visible', self, visible]);
  return 0;
});
try {
  for (const backend of ['software', 'direct3d']) {
    p.zero(view, 1024);
    const cursor = new NativeCursor(
      { world: { host: {} }, images: { load: async () => 0 } },
      { backend },
    );
    for (let i = 0; i < 48; i++) {
      const allowed = [0, 1, 0xffffffff][i % 3],
        value = i % 4 ? `image_${i}` : '画像',
        x = (i * 17) | 0,
        y = (-i * 13) | 0;
      p.store(view, backend === 'software' ? 1 : 0);
      p.store(view + 4, backend === 'direct3d' ? 1 : 0);
      p.store(view + 52, allowed);
      cursor.state.allowed = allowed;
      setName(value);
      requested = [];
      const before = [
        p.string(view + 76, !sdk),
        p.load(view + abi.hotspot),
        p.load(view + abi.hotspot + 4),
      ];
      compare(
        await engine.call(abi.viewImage, [i % 7 ? name : 0, x, y], view),
        0,
        'view image output',
      );
      const expectedName = i % 7 ? value : '',
        expected = allowed ? [expectedName, x >>> 0, y >>> 0] : before;
      compare(
        [p.string(view + 76, !sdk), p.load(view + abi.hotspot), p.load(view + abi.hotspot + 4)],
        expected,
        'view image state',
      );
      compare(
        requested,
        allowed ? [[backend, i % 7 ? value : null, x, y]] : [],
        'backend invocation gate',
      );
      await cursor.setImage(i % 7 ? value : null, x, y);
      compare(
        [cursor.state.filename, ...cursor.state.requestedHotspot.map((v) => v >>> 0)],
        expected,
        'browser view request state',
      );
    }
  }
  // Real bitmap ctor/configure/copy/upload execute. Only COM surface/device
  // operations above are supplied; row order and payload are original bytes.
  for (const [w, h, bpp] of [
    [32, 32, 4],
    [31, 32, 4],
    [32, 33, 4],
    [32, 32, 3],
  ]) {
    const bitmap = p.allocate(92, true);
    await engine.call(abi.bitmapCtor, [], bitmap);
    await engine.call(abi.bitmapConfigure, [w, h, bpp], bitmap);
    const size = p.load(bitmap + 16),
      data = p.load(bitmap + 12),
      source = Uint8Array.from(
        { length: size },
        (_, i) => (i * 43 + Math.floor(i / 128) * 19) & 255,
      );
    p.write(data, source);
    for (const disabled of [0, 1])
      for (const cooperative of [0, 1]) {
        p.store(renderer + 1492, disabled);
        deviceFailure = cooperative;
        requested = [];
        const before = creations;
        const result = await engine.call(abi.d3dImage, [bitmap, 7, 11], renderer),
          accepted = !disabled && !cooperative && w === 32 && h === 32 && bpp === 4;
        compare(result, Number(accepted), 'D3D cursor acceptance');
        compare(creations - before, Number(accepted), 'D3D surface allocation gate');
        if (accepted) {
          compare(p.read(upload, 4096), source, 'D3D cursor original raw rows');
          compare(
            [p.load(renderer + 1484), p.load(renderer + 1488), p.load(renderer + 1476)],
            [7, 11, 1],
            'D3D cursor hotspot and active flag',
          );
          const backup = p.load(renderer + 1480),
            next = source.map((value) => value ^ 0xff);
          compare(p.read(p.load(backup + 12), 4096), source, 'D3D first backup pixels');
          p.write(data, next);
          compare(
            await engine.call(abi.d3dImage, [bitmap, 13, 17], renderer),
            1,
            'D3D replacement succeeds',
          );
          compare(p.read(upload, 4096), next, 'D3D replacement uploads new pixels');
          compare(p.load(renderer + 1480), backup, 'D3D replacement retains first backup identity');
          compare(
            p.read(p.load(backup + 12), 4096),
            source,
            'D3D replacement retains first backup pixels',
          );
          compare(
            await engine.call(abi.d3dImage, [0, 3, 5], renderer),
            0,
            'D3D null bitmap clears',
          );
          compare(p.load(renderer + 1476), 0, 'D3D null bitmap clears active flag');
          compare(p.load(renderer + 1480), backup, 'D3D null bitmap retains backup');
        }
      }
    await engine.call(abi.bitmapDtor, [], bitmap);
    compare(p.allocations.has(bitmap), false, 'bitmap release destroys its own allocation');
  }
  const backup = p.load(renderer + 1480);
  if (backup) await engine.call(abi.bitmapDtor, [], backup);
  compare(creations, releases, 'all temporary D3D surfaces released');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: digest,
        passed,
        scope:
          'Original cursor view filename/hotspot/backend gates and full D3D bitmap upload with actual ctor/copy/converter. D3D COM and image resource loading supplied; no complete file-to-cursor or Windows screen-pixel claim.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original cursor differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
