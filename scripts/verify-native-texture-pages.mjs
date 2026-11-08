// SPDX-License-Identifier: MPL-2.0
// Original main21D/21E and texture-manager allocation/release execute fully.
// D3D texture creation/destruction is an explicit resource boundary; manager
// page selection, area traversal, preservation and reallocation are original.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { nodeGame } from './node-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeTexturePages, negotiateNativeTextureLayout } from '../src/native/texture-layout.mjs';

const [root, profile, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-texture-pages.mjs FIXED_DIRECTORY PROFILE IGNORED_REPORT',
  );
const game = await nodeGame(root),
  sdk = profile.startsWith('sdk-'),
  configuration = new NativeConfiguration({ profile }),
  engine = await NativeEngineProcess.open({ game, profile, configuration }),
  p = engine.process,
  host = p.allocate(128, true),
  wrapper = p.allocate(24, true),
  view = p.allocate(16, true),
  manager = p.allocate(32, true),
  table = p.allocate(256, true),
  parameters = p.allocate(16, true),
  outputWord = p.allocate(4, true),
  textures = new Map(),
  main = NATIVE_PROFILES[profile].tables.main.va;
let seed = 0x5df0391a,
  passed = 0,
  created = 0,
  released = 0;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
  compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  };
p.store(host + 116, wrapper);
p.store(wrapper + 4, 1);
p.store(wrapper + 8, view);
p.store(view + 8, manager);
engine.patch(
  sdk ? 0x5560f0 : 0x67f4a0,
  'oracle D3D page allocation',
  3,
  ([width, height, bpp]) => {
    const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
    textures.set(pointer, { width, height, bpp });
    created++;
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  sdk ? 0x556070 : 0x67f420,
  'oracle D3D page destruction',
  0,
  () => {
    const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
    assert.ok(textures.delete(pointer));
    released++;
    return 0;
  },
  { calleePops: true },
);
engine.registerWindows('USER32.dll', 'SetRectEmpty', {
  count: 1,
  fn: ([at]) => {
    p.zero(at, 16);
    return 1;
  },
});
engine.registerWindows('USER32.dll', 'IntersectRect', {
  count: 3,
  fn: ([out, a, b]) => {
    const values = [
      Math.max(p.load(a) | 0, p.load(b) | 0),
      Math.max(p.load(a + 4) | 0, p.load(b + 4) | 0),
      Math.min(p.load(a + 8) | 0, p.load(b + 8) | 0),
      Math.min(p.load(a + 12) | 0, p.load(b + 12) | 0),
    ];
    if (values[0] >= values[2] || values[1] >= values[3]) {
      p.zero(out, 16);
      return 0;
    }
    values.forEach((value, i) => p.store(out + i * 4, value));
    return 1;
  },
});
const invoke = async (id, words = []) => {
  words.forEach((word, i) => p.store(parameters + i * 4, word));
  compare(
    await engine.call(p.load(main + id * 4), [0, host, parameters, outputWord]),
    2,
    `main${id.toString(16)} control`,
  );
};
try {
  for (let trial = 0; trial < 100; trial++) {
    const texture = configuration.fields.texture,
      columns = 1 + (next() % 8),
      rows = 1 + (next() % 8);
    texture.size.set([2 ** (1 + (next() % 4)), 2 ** (1 + (next() % 4))]);
    texture.grid.set([columns, rows]);
    texture.bppY.set([next() % (rows + 1), next() % (rows + 1)]);
    texture.bpp = trial % 2 ? 16 : 32;
    for (const area of texture.areas) {
      if (next() % 3 === 0) area.fill(0xffffffff);
      else {
        const x = next() % columns,
          y = next() % rows;
        area.set([x, y, 1 + (next() % (columns - x)), 1 + (next() % (rows - y))]);
      }
    }
    const pages = new NativeTexturePages(negotiateNativeTextureLayout(texture));
    p.zero(manager, 32);
    p.zero(table, 256);
    [texture.size[0], texture.size[1], columns, rows, texture.bpp, table, columns * rows].forEach(
      (word, i) => p.store(manager + i * 4, word),
    );
    const state = () =>
      Array.from({ length: columns * rows }, (_, index) => {
        const pointer = p.load(table + index * 4);
        return pointer ? textures.get(pointer) : null;
      });
    const expected = () =>
      Array.from({ length: columns * rows }, (_, index) => {
        const page = pages.pages.get(index);
        return page ? { width: page.frame.width, height: page.frame.height, bpp: page.bpp } : null;
      });
    const count = created;
    await invoke(0x21e);
    compare(state(), expected(), `initial pages/${trial}`);
    compare(created - count, pages.pages.size, 'overlapping areas allocate once');
    for (let step = 0; step < 4; step++) {
      const before = state(),
        originalPointers = p.read(table, columns * rows * 4),
        frames = new Map([...pages.pages].map(([index, page]) => [index, page.frame])),
        rectangle = [
          (next() % (columns * texture.size[0] + 3)) - 2,
          (next() % (rows * texture.size[1] + 3)) - 2,
          step === 3 ? -1 : next() % (columns * texture.size[0] + 3),
          next() % (rows * texture.size[1] + 3),
        ];
      await invoke(0x21d, rectangle);
      pages.releaseRectangle(...rectangle);
      compare(state(), expected(), `released pages/${trial}/${step}`);
      const kept = state(),
        allocated = created;
      await invoke(0x21e);
      pages.allocateMissing(texture);
      compare(state(), expected(), `reallocated pages/${trial}/${step}`);
      compare(
        created - allocated,
        before.filter((page, index) => page && !kept[index]).length,
        'recreates only missing configured pages',
      );
      const pointerView = new DataView(
        originalPointers.buffer,
        originalPointers.byteOffset,
        originalPointers.byteLength,
      );
      for (let index = 0; index < kept.length; index++)
        if (kept[index]) {
          assert.equal(p.load(table + index * 4), pointerView.getUint32(index * 4, true));
          assert.equal(pages.frame(index), frames.get(index));
        }
      passed++;
    }
    await invoke(0x21d, [0, 0, columns * texture.size[0], rows * texture.size[1]]);
    compare(textures.size, 0, 'all page resources released');
    pages.close();
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: engine.identity,
        passed,
        created,
        released,
        scope:
          'Original main21D/21E plus full texture-manager allocation/release. D3D page allocation/destruction supplied; original area traversal, depth choice, missing-page recreation and identity preservation execute unchanged.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original texture page manager differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
