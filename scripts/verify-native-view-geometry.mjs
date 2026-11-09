// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeViewGeometry, NATIVE_VIEW_GEOMETRY_CONTRACTS } from '../oracle/view-geometry.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { floatBits, KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-view-geometry.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('View geometry oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  view = p.allocate(280, true),
  manager = p.allocate(544, true),
  view3D = p.allocate(200, true),
  m = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024)),
  platform = { refs: { view, manager, view3D }, ensureRenderer: async () => platform.refs },
  world = {
    objects: { machine: () => null },
    getNativeFeature: async (name) => {
      assert.equal(name, 'graphics-platform');
      return platform;
    },
  },
  feature = new NativeViewGeometry(engine, world),
  settings = engine.refs.settings,
  rawNear = [0, 0x80000000, 0x3f800000, 0x447a0000, 0x7f800000, 0xff800000, 0x7fc01234, 0xffffffff];
let operations = 0,
  comparisons = 0,
  positionCalls = 0;
const compare = (a, b, label) => {
    assert.deepEqual(a, b, label);
    comparisons++;
  },
  domains = () => [m.memory, m.shared, ...m.blocks],
  vm = () => domains().map((b) => b.slice()),
  f32 = Math.fround,
  cvtt = (value) => (value >= -0x80000000 && value < 0x80000000 ? Math.trunc(value) : -0x80000000),
  storeU16 = (address, value) => p.write(address, Uint8Array.of(value, value >>> 8));

async function positions(spec, addresses) {
  const cases = [
    { offset: [5.75, -3.25], scale: 2, ratios: [1, 1], bottom: 480 },
    {
      offset: [-19.875, 0.5],
      scale: 1.25,
      ratios: [0.625, 1.375],
      shift: [-17, 8],
      bottom: 0x7fffffff,
    },
    {
      disabled: true,
      offset: [-5.125, -9.5],
      scale: -2.75,
      ratios: [2, -0.5],
      bottom: -123,
    },
    {
      missingView3D: true,
      offset: [32768.9375, -2147483648],
      scale: 0.5,
      ratios: [0.75, -2],
      shift: [0x7fffffff, -0x80000000],
    },
    { missingManager: true, offset: [3, -7], scale: 2, ratios: [0.5, 2], shift: [-4, 12] },
    { offset: [Infinity, NaN], scale: 0, ratios: [-0, 1], bottom: 0x7fffffff },
    { offset: [-2147483648, 2147483648], scale: Infinity, ratios: [Infinity, NaN] },
  ];
  for (const [index, input] of cases.entries()) {
    const {
        offset,
        scale,
        ratios,
        shift = [0, 0],
        bottom = -100,
        disabled = false,
        missingView3D = false,
        missingManager = false,
      } = input,
      active = !disabled && !missingView3D && !missingManager,
      [dx, dy] = missingManager ? [0, 0] : offset.map(f32),
      inverse = missingManager ? 1 : f32(1 / f32(scale)),
      fullHeight = [600, 0, 65535][index % 3],
      virtualHeight = [432, 65535, 0][index % 3],
      currentHeight = 531 + index;
    p.store(view, Number(disabled));
    p.store(view + 4, missingView3D ? 0 : view3D);
    p.store(view + 8, missingManager ? 0 : manager);
    p.store(view + 68, floatBits(ratios[0]));
    p.store(view + 72, floatBits(ratios[1]));
    p.store(manager + 228, floatBits(offset[0]));
    p.store(manager + 232, floatBits(offset[1]));
    p.store(manager + 484, floatBits(scale));
    p.store(manager + 512, bottom);
    shift.forEach((value, axis) => p.store(settings + (sdk ? 0xb8f4 : 0xc35c) + axis * 4, value));
    storeU16(settings + 0x20c, virtualHeight);
    storeU16(settings + (sdk ? 0xca56 : 0xf11e), fullHeight);
    storeU16(settings + (sdk ? 0xca5a : 0xf122), currentHeight);
    for (const mode of spec.id === 0x2e3 ? [0] : [0, 1, 2, 3, 0x80000000, 0xffffffff]) {
      p.store(settings + (sdk ? 0xcdf4 : 0xf7c8), mode);
      const originalView = p.read(view, 280),
        originalManager = p.read(manager, 544),
        originalSettings = p.read(settings, 0x10000);
      for (const [x, y] of addresses) {
        domains().forEach((domain, i) => domain.fill([0xa5, 0x5a, 0x3c][i]));
        const before = vm(),
          border = spec.id === 0x2e3;
        if (border) {
          m.store(y, 0);
          m.store(x, 0);
          if (active) {
            m.store(x, cvtt(dx));
            m.store(y, cvtt(dy));
          }
          m.store(x, m.load(x) * 2);
          m.store(y, m.load(y) * 2);
        } else {
          m.store(x, 0);
          if (mode === 0) m.store(y, active ? bottom + cvtt(dy) : currentHeight);
          if (mode === 1) m.store(y, fullHeight);
          if (mode === 2) m.store(y, virtualHeight);
        }
        if (border || mode < 2)
          for (const [axis, at] of [x, y].entries()) {
            const shifted = f32(f32(m.load(at) | 0) - [dx, dy][axis]),
              device = cvtt(f32(shifted * inverse)),
              virtual = f32(f32((device - shift[axis]) | 0) * f32(ratios[axis]));
            m.store(at, cvtt(virtual));
          }
        const expected = vm(),
          label = `main${spec.id.toString(16)} case ${index}/${mode} output ${x}/${y}`;
        domains().forEach((domain, i) => domain.set(before[i]));
        compare(await feature.apply(spec.id, [x, y], m, { id: 17 }), { control: 2 }, label);
        compare(vm(), expected, label + ' complete VM');
        compare(p.read(view, 280), originalView, label + ' unchanged view');
        compare(p.read(manager, 544), originalManager, label + ' unchanged manager');
        compare(p.read(settings, 0x10000), originalSettings, label + ' unchanged settings');
        operations++;
        positionCalls++;
      }
    }
  }
  p.store(view, 0);
  p.store(view + 4, view3D);
  p.store(view + 8, manager);
}

m.allocate(1024);
try {
  // The only platform operation in 2E4 clears its temporary RECT.
  // Both coordinate transforms and the settings branches execute original code.
  engine.registerWindows(
    'USER32.dll',
    'SetRectEmpty',
    nativeRectangleDefinitions(p).get('SetRectEmpty'),
  );
  p.store(view + 4, view3D);
  p.store(view + 8, manager);
  const addresses = [
    [0, 4, 8, 12],
    [128, 132, 136, 140],
    [0x80000080, 0x80000084, 0x80000088, 0x8000008c],
    [m.memory.length + 128, m.memory.length + 132, m.memory.length + 136, m.memory.length + 140],
    [128, 128, 128, 128],
    [128, 0x80000080, m.memory.length + 128, 128],
  ];
  for (const spec of NATIVE_VIEW_GEOMETRY_CONTRACTS) {
    compare(
      p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 4 * spec.id),
      spec.handlers[Number(sdk)],
      'frozen original table handler',
    );
    if (spec.id === 0x2e3 || spec.id === 0x2e4) {
      await positions(spec, [...addresses, [128, 130], [130, 128]]);
      continue;
    }
    for (const [width, height] of [
      [0, 0],
      [640, 480],
      [800, 600],
      [65535, 1],
    ])
      for (const rect of [
        [0, 0, width, height],
        [-17, 9, 300, 250],
        [0x7fffffff, 0x80000000, 0x80000000, 0x7fffffff],
      ])
        for (const out of addresses)
          for (const near of rawNear) {
            for (const domain of [m.memory, m.shared, ...m.blocks]) domain.fill(0xa5);
            p.store(view + 24, width);
            p.store(view + 28, height);
            rect.forEach((word, i) => p.store(manager + 500 + 4 * i, word));
            p.store(manager + 224, 0x447a0000);
            const args = spec.id === 12 ? [near] : out.slice(0, spec.words),
              before = vm(),
              originalView = p.read(view, 280),
              expectedManager = p.read(manager, 544),
              expectedWords =
                spec.id === 8
                  ? [width, height]
                  : [rect[0], rect[1], (rect[2] - rect[0]) >>> 0, (rect[3] - rect[1]) >>> 0];
            if (spec.id === 12) new DataView(expectedManager.buffer).setUint32(224, near, true);
            else args.forEach((address, i) => m.store(address, expectedWords[i]));
            const expected = vm();
            [m.memory, m.shared, ...m.blocks].forEach((domain, i) => domain.set(before[i]));
            compare(
              await feature.apply(spec.id, args, m, { id: 17 }),
              { control: 2 },
              'complete original wrapper control',
            );
            compare(
              vm(),
              expected,
              'complete VM domains, alias order, widths and rectangle overflow',
            );
            compare(p.read(view, 280), originalView, 'the complete native view is unchanged');
            compare(
              p.read(manager, 544),
              expectedManager,
              'only the original camera word may change',
            );
            operations++;
          }
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        operations,
        comparisons,
        positionCalls,
        scope:
          'Complete original main8/C/2E3/2E4/313 wrappers and view helpers. Authored view/manager/settings are the device boundary; USER32 SetRectEmpty clears one scratch rectangle. Whole VM domains and native records, valid VM zero, data/shared/extended outputs, exact and partial alias order, every fullscreen position branch, missing view/manager paths, signed rectangle overflow, and native f32 conversions including signed zero/NaN/infinity. Initialized view and restoration are tested through World separately.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original view geometry ${comparisons}/${comparisons} (${operations} calls)`);
} finally {
  await engine.close();
}
