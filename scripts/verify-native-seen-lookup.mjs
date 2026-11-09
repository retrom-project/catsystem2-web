// SPDX-License-Identifier: MPL-2.0
// Compare both original seen queries through their real VM and history layouts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { encodeCP932, formatNativeAt } from '../src/kcs.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeSceneData, nativeSceneData } from '../src/native/scene-data.mjs';
import { sceneCheckpointFixture } from '../tests/fixtures/scene-checkpoint-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-seen-lookup.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Scene query oracle requires a frozen engine image');

const fixture = await sceneCheckpointFixture(bytes, profile),
  { engine, p, caller, nativeHistory, pair, history, machine } = fixture,
  data = new NativeSceneData(),
  handles = new NativeHandles(),
  handle = handles.add('scene-data', data),
  services = {
    handles,
    sceneData: data,
    formatBytes: formatNativeAt,
    format: (at, m) => m.string(at),
  },
  argv = p.allocate(4),
  out = p.allocate(4),
  raw = Uint8Array.of(0x81, 0x30, 0xff, 0x51),
  bytesFor = (value) => (typeof value === 'string' ? encodeCP932(value) : value),
  originalImplicit = async (at) => {
    const bridge = new NativeKCSMemory(p, machine);
    try {
      p.store(argv, at);
      p.store(out, 0xcccccccc);
      const control = await engine.call(
        p.load(NATIVE_PROFILES[profile].tables.main.va + 0xe3 * 4),
        [bridge.pointer, caller, argv, out],
      );
      return { control, value: p.load(out) };
    } finally {
      bridge.close();
    }
  };
data.history = history;

const cases = [
  [[['source', 0xffffffff]], 'SOURCE', false],
  [[['source', 51]], 'SOURCE.CST', false],
  [
    [
      ['source', 51],
      ['source.cst', 17],
    ],
    'source.cst',
    false,
  ],
  [[['', 71]], 'absent', false],
  [[['', 71]], '', false],
  [
    [
      ['root', 3],
      ['root.ソ', 7],
    ],
    'root.ソ',
    false,
  ],
  [[['root.ソ', 7]], 'root.ソ.cst', false],
  [[['folder.dot/child', 9]], 'folder.dot/child', false],
  [[['seed', 8]], raw, true],
  [[['seed', 8]], Uint8Array.from([...raw, ...encodeCP932('.CST')]), true],
  [[['seed', 8]], Uint8Array.of(0x81, 0x30, 0xfe, 0x51), true],
  [[['seed', 8]], '%s[G512]', true],
];
let calls = 0;
try {
  p.store(caller + 172, nativeHistory);
  for (const region of [0, machine.fp, 0x80000000, machine.memory.length])
    for (const [index, [seed, query, addRaw]] of cases.entries()) {
      history.seen = [];
      history.path = [];
      for (const [name, value] of seed) history.markSeen(name, value);
      if (addRaw) history.aliasSeen('seed', raw);
      await fixture.syncHistory();
      machine.writeStringBytes(raw, 512);
      const at = region + 128;
      machine.writeStringBytes(bytesFor(query), at);
      for (const [id, args, reference] of [
        [0x14c, [handle, at], () => fixture.original(0x14c, [at])],
        [0xe3, [at], () => originalImplicit(at)],
      ]) {
        assert.deepEqual(
          nativeSceneData(id, args, machine, services),
          await reference(),
          `main ${id.toString(16)} query ${index} at ${region.toString(16)}`,
        );
        calls++;
      }
    }
  p.store(pair + 4, 0);
  p.store(caller + 172, 0);
  assert.deepEqual(
    nativeSceneData(0x14c, [0, 0x7fffffff], machine, services),
    await fixture.original(0x14c, [0x7fffffff]),
  );
  assert.deepEqual(
    nativeSceneData(0xe3, [0x7fffffff], machine, { ...services, sceneData: null }),
    await originalImplicit(0x7fffffff),
  );
  calls += 2;
  await writeFile(output, JSON.stringify({ profile, sha256, calls }, null, 2) + '\n');
  console.log(`Original seen queries: ${calls} calls`);
} finally {
  p.free(out);
  p.free(argv);
  await engine.close();
}
