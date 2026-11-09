// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { encodeCP932, formatNativeAt } from '../src/kcs.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeSceneData, nativeSceneData } from '../src/native/scene-data.mjs';
import { decodeNativeSceneHistory } from '../src/native/scene-history.mjs';
import { sceneCheckpointFixture } from '../tests/fixtures/scene-checkpoint-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-scene-path.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Scene path oracle requires a frozen engine image');
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
  argv = p.allocate(12),
  out = p.allocate(4),
  raw = Uint8Array.of(0x81, 0x30, 0xff, 0x51),
  original = async (id, args, direct) => {
    if (direct) return fixture.original(id, args);
    const bridge = new NativeKCSMemory(p, machine);
    try {
      args.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      const control = await engine.call(p.load(NATIVE_PROFILES[profile].tables.main.va + id * 4), [
        bridge.pointer,
        caller,
        argv,
        out,
      ]);
      return { control, value: p.load(out) };
    } finally {
      bridge.close();
    }
  },
  pathPayload = (data) =>
    decodeNativeSceneHistory(data).map(({ nameBytes, ...record }) => ({
      ...record,
      name: nameBytes.slice(0, nameBytes.indexOf(0)),
    })),
  writes = [
    ['main.CST', 5],
    ['MAIN.cst', 0xffffffff],
    ['main.cst', 0x80000000],
    ['main', 4],
    ['root.ソ', 8],
    ['root.ソ.cst', 7],
    ['root', 6],
    ['folder.dot/child', 12],
    [raw, 21],
    [Uint8Array.of(0x81, 0x30, 0xff, 0x71), 11],
    [Uint8Array.of(0x81, 0x30, 0xfe, 0x51), 31],
    [Uint8Array.from([...raw, ...encodeCP932('.CST')]), 41],
    ['%s[G512]', 13],
    ['x'.repeat(31), 18],
    ['', 51],
    ['.cst', 61],
  ];
data.history = history;

let reads = 0,
  appends = 0;
try {
  p.store(caller + 172, nativeHistory);
  for (const region of [0, machine.fp, 0x80000000, machine.memory.length])
    for (const direct of [true, false]) {
      history.path = [];
      history.seen = [];
      history.markSeen(raw, 0xabcdef01);
      await fixture.syncHistory();
      machine.writeStringBytes(raw, 512);
      const read = async (index, overlap = false) => {
        const id = direct ? 0x14d : 0xe4,
          name = region + 576,
          args = [index, name, overlap ? name + 1 : name + 48],
          memory = machine.bytes(name - 4, 64),
          label = `main ${id.toString(16)} path read ${index} at ${region.toString(16)}`;
        memory.fill(0xa5);
        const expected = await original(id, args, direct),
          after = memory.slice();
        memory.fill(0xa5);
        assert.deepEqual(
          nativeSceneData(id, direct ? [handle, ...args] : args, machine, services),
          expected,
          label,
        );
        assert.deepEqual(memory, after, label + ' output and canaries');
        reads++;
      };
      await read(0);
      const at = region + 128;
      for (const [name, value] of writes) {
        const id = direct ? 0x149 : 0xe0,
          args = [at, value],
          label = `main ${id.toString(16)} path append ${appends} at ${region.toString(16)}`;
        machine.writeStringBytes(typeof name === 'string' ? encodeCP932(name) : name, at);
        assert.deepEqual(
          nativeSceneData(id, direct ? [handle, ...args] : args, machine, services),
          await original(id, args, direct),
          label,
        );
        const { seen, path } = await fixture.readHistory();
        // The original leaves bytes after the name terminator undefined.
        assert.deepEqual(pathPayload(history.encode('path', true)), pathPayload(path), label);
        assert.deepEqual(seen, history.encode('seen', true), label + ' unchanged seen records');
        appends++;
      }
      for (const index of [0, 1, 2, 6, 8, history.path.length - 1, history.path.length, 0xffffffff])
        await read(index);
      await read(6, true);
    }
  p.store(pair + 4, 0);
  p.store(caller + 172, 0);
  for (const [id, direct, args] of [
    [0x149, true, [0x7fffffff, 1]],
    [0xe0, false, [0x7fffffff, 1]],
    [0x14d, true, [0, 0x7fffffff, 0x7fffffff]],
    [0xe4, false, [0, 0x7fffffff, 0x7fffffff]],
  ])
    assert.deepEqual(
      nativeSceneData(id, direct ? [0, ...args] : args, machine, { ...services, sceneData: null }),
      await original(id, args, direct),
    );
  appends += 2;
  reads += 2;
  await writeFile(output, JSON.stringify({ profile, sha256, appends, reads }, null, 2) + '\n');
  console.log(`Original scene path: ${appends} appends and ${reads} reads`);
} finally {
  p.free(out);
  p.free(argv);
  await engine.close();
}
