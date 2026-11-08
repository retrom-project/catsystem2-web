// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import {
  NativeViewGeometry,
  NATIVE_VIEW_GEOMETRY_CONTRACTS,
} from '../src/native/view-geometry.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-view-geometry.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('View geometry oracle requires a frozen engine');
const engine = await NativeEngineProcess.open({ bytes, profile }),
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
  rawNear = [0, 0x80000000, 0x3f800000, 0x447a0000, 0x7f800000, 0xff800000, 0x7fc01234, 0xffffffff];
let operations = 0,
  comparisons = 0;
const compare = (a, b, label) => {
    assert.deepEqual(a, b, label);
    comparisons++;
  },
  vm = () => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
m.allocate(1024);
try {
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
      p.load(NATIVE_PROFILES[profile].tables.main.va + 4 * spec.id),
      spec.handlers[Number(profile.startsWith('sdk-'))],
      'frozen original table handler',
    );
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
        scope:
          'Complete original main8/C/313 wrappers and original view/rectangle helpers; authored view+manager records are the device boundary. Exact whole VM domains and complete native records, valid VM zero, data/shared/extended outputs, aliased destinations and sequential writes, signed rectangle overflow, raw camera f32 bits including signed zero/NaNs/infinities. Full device/view initialization and host projection are tested through World separately.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original view geometry ${comparisons}/${comparisons} (${operations} calls)`);
} finally {
  await engine.close();
}
