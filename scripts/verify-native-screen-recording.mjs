// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import {
  NativeScreenCapture as OriginalScreenCapture,
  NATIVE_SCREEN_CAPTURE_LAYOUTS,
  NATIVE_SCREEN_CAPTURE_CONTRACTS,
} from '../oracle/screen-capture-original.mjs';
import { NativeScreenCapture } from '../src/native/screen-capture.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { KCSMachine, readKCS, formatNativeAt, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-screen-recording.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Recording oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  view = p.allocate(288, true),
  host = p.allocate(120, true),
  argv = p.allocate(12, true),
  out = p.allocate(12, true),
  platform = { refs: { view }, ensureRenderer: async () => platform.refs },
  world = {
    profile,
    runtime: { services: { formatBytes: formatNativeAt } },
    objects: { machine: () => null },
    getNativeFeature: async (name) => {
      assert.equal(name, 'graphics-platform');
      return platform;
    },
  },
  original = new OriginalScreenCapture(engine, world),
  feature = new NativeScreenCapture(world),
  layout = NATIVE_SCREEN_CAPTURE_LAYOUTS[profile],
  m = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024)),
  words = [0, 1, 2, 0xffffffff, 0x80000000, 0x7fffffff, 0x12345678],
  prefixes = ['', 'capture', 'f_%08x[G2048]', '猫\\frame', 'x'.repeat(31), '猫'.repeat(31)];
if (sdk) prefixes.push('x'.repeat(63));
m.allocate(1024);
p.store(host + 116, view);
let comparisons = 0,
  operations = 0;
const compare = (a, b, label) => {
    assert.deepEqual(a, b, label);
    comparisons++;
  },
  vm = () => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
try {
  for (const spec of NATIVE_SCREEN_CAPTURE_CONTRACTS)
    compare(
      p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + spec.id * 4),
      spec.handlers[Number(sdk)],
      'original handler table',
    );
  for (const flag of words)
    for (const counter of words)
      for (const name of prefixes)
        for (const address of [128, 0x80000080, m.memory.length + 128]) {
          for (const domain of [m.memory, m.shared, ...m.blocks]) domain.fill(0xa5);
          const raw = encodeCP932(name);
          m.bytes(address, raw.length + 1).set([...raw, 0]);
          m.store(2048, counter);
          p.write(view, new Uint8Array(288).fill(0xa5));
          const expected = p.read(view, 288),
            v = new DataView(expected.buffer),
            formatted = formatNativeAt(address, m),
            utf16 = new TextDecoder('shift_jis').decode(formatted),
            text = sdk
              ? Uint8Array.from([...formatted, 0])
              : new Uint8Array(
                  Uint16Array.from([...(utf16 + '\0')], (c) => c.charCodeAt(0)).buffer,
                ),
            before = vm();
          v.setUint32(layout.recording, flag, true);
          v.setUint32(layout.counter, counter, true);
          expected.set(text, layout.prefix);
          compare(
            await feature.apply(0x1b9, [flag, address, counter], m, { id: 17 }),
            { control: 2 },
            'complete original recording setter',
          );
          compare(
            feature.snapshot(),
            { recording: flag >>> 0, counter: counter >>> 0, prefix: utf16 },
            'JS recording fields',
          );
          compare(
            await original.apply(0x1b9, [flag, address, counter], m, { id: 17 }),
            { control: 2 },
            'existing oracle setter',
          );
          compare(
            p.read(view, 288),
            expected,
            'whole view and trailing canaries including exact A/W prefix write',
          );
          compare(vm(), before, 'all VM regions remain unchanged');
          operations++;
          for (const [id, value] of [
            [0x235, flag],
            [0x236, counter],
          ]) {
            const bridge = new NativeKCSMemory(p, m);
            p.write(out, new Uint8Array(12).fill(0xa5));
            let control;
            try {
              control = await engine.call(
                p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4),
                [bridge.pointer, host, argv, out + 4],
                undefined,
                { task: 17 },
              );
            } finally {
              bridge.close();
            }
            compare(
              { control, value: p.load(out + 4) },
              { control: 1, value },
              'complete original getter',
            );
            compare(
              await feature.apply(id, [], m, { id: 17 }),
              { control, value },
              'shared real-view getter projection',
            );
            compare(
              [...p.read(out, 4), ...p.read(out + 8, 4)],
              new Array(8).fill(0xa5),
              'getter result canaries',
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
          'Complete original main1B9 formatter/setter and main235/236 getters. Raw nonboolean recording flags/counters, signed extrema, original profile-specific ANSI64/WCHAR32 prefix, empty/Japanese/maximum strings, VM indexed formatting and data/shared/extended source memory, complete view fields and canaries, unchanged whole VM state. Actual framebuffer screenshot, BMP recording, frame-counter increments, ownership and fresh GPU restoration are independently tested in Chromium.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original screen recording ${comparisons}/${comparisons} (${operations} calls)`);
} finally {
  await engine.close();
}
