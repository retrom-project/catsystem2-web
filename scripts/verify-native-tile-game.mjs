// SPDX-License-Identifier: MPL-2.0
// The native table oracle and JS model execute independently. Compare native
// controls/results, complete VM writes, event words and opaque handle ownership.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { NativeTileGame, nativeTileGameCodec } from '../src/native/tile-game.mjs';
import { NATIVE_TILE_GAME_ABI, NATIVE_TILE_GAME_LAYOUTS } from '../oracle/tile-game.mjs';
import {
  prepareTileGame,
  tileGameQueryArguments,
  tileGameEventReply,
  TILE_GAME_COMMAND_CASES,
} from '../tests/fixtures/tile-game-fixture.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-tile-game.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (p) => NATIVE_ENGINE_IMAGES[p].sha256 === sha256,
  );
if (!profile) throw new Error('Tile-rules oracle requires a frozen engine');
const original = await NativeEngineProcess.open({ profile, bytes, now: () => 12345, trace: true }),
  handles = new NativeHandles(),
  world = { profile, runtime: { handles }, objects: { machine: () => null } },
  adapter = new NativeTileGame(world),
  layout = NATIVE_TILE_GAME_LAYOUTS[profile],
  program = await readKCS(kcsProgram([[59]])),
  a = new KCSMachine(program, {}, new Uint8Array(1024)),
  b = new KCSMachine(program, {}, new Uint8Array(1024)),
  p = original.process,
  table = NATIVE_EXE_PROFILES[profile].tables.main.va,
  contexts = new Map(),
  operations = [],
  events = new Map(),
  covered = new Set();
handles.registerType('tile-game', nativeTileGameCodec);
let comparisons = 0,
  calls = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
async function raw(id, args) {
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(args.length * 4),
    out = p.allocate(4);
  try {
    args.forEach((value, i) => p.store(argv + i * 4, value));
    p.store(out, 0xcccccccc);
    const control = await original.call(p.load(table + id * 4), [bridge.pointer, 0, argv, out]);
    return { control, value: p.load(out) };
  } finally {
    try {
      bridge.close();
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
}
async function invoke(id, values, handle = 0) {
  calls++;
  covered.add(id);
  const create = id === 0x1d6,
    pointer = contexts.get(handle) ?? 0,
    rawArgs = create ? [] : [pointer, ...values],
    modelArgs = create ? [] : [handle, ...values],
    result = await raw(id, rawArgs),
    reply = await adapter.apply(id, modelArgs, b, { id: 1 });
  check(reply.control, result.control, `control ${id.toString(16)}`);
  if (create) {
    handle = reply.value;
    contexts.set(handle, result.value);
    check(Boolean(handle), Boolean(result.value), 'context allocated');
  } else if (result.control === 1)
    check(
      reply.value,
      result.value,
      `word ${id.toString(16)} call ${calls} event ${adapter.model.get('event')} next ${adapter.model.get('next')}`,
    );
  else check(result.value, 0xcccccccc, 'void output remains unwritten');
  check(a.memory, b.memory, `contiguous VM ${id.toString(16)}`);
  check(a.shared, b.shared, `shared VM ${id.toString(16)}`);
  check(a.blocks, b.blocks, `extended VM ${id.toString(16)}`);
  if (id === 0x1d7) contexts.delete(handle);
  operations.push({ id, values, handle, control: result.control, value: reply.value });
  return create ? handle : reply.value;
}
try {
  await original.call(layout.initialize);

  const initial = Uint8Array.from({ length: a.memory.length }, (_, i) => (i * 31 + 17) & 255);
  a.memory.set(initial);
  b.memory.set(initial);
  const blockA = a.allocate(4096),
    blockB = b.allocate(4096);
  check(blockA, blockB, 'authored extension base');
  for (const abi of NATIVE_TILE_GAME_ABI)
    if (abi.id !== 0x1d6) {
      const values = Array(abi.argumentWords - 1).fill(0xffffffff);
      await invoke(abi.id, values);
    }
  const handle = await invoke(0x1d6, []),
    peer = await invoke(0x1d6, []);
  await invoke(0x1d9, [], handle);
  for (const player of [0, 1, 3])
    for (const index of [0, 1, 7, 0xffffffff]) {
      for (const abi of NATIVE_TILE_GAME_ABI) {
        if (abi.id === 0x1d9) continue;
        const values = tileGameQueryArguments(abi.id, player, index, 2048);
        if (values) await invoke(abi.id, values, handle);
      }
    }
  for (const [id, ...values] of TILE_GAME_COMMAND_CASES) await invoke(id, values, handle);
  for (const players of [4, 2]) {
    prepareTileGame(a, players);
    const options = prepareTileGame(b, players);
    await invoke(0x1d8, options, handle);
    check(await invoke(0x1db, [], peer), players, 'independent contexts share the global model');
    for (let i = 0; i < (process.env.CATSYSTEM2_EXTENDED ? 1600 : 360); i++) {
      const event = await invoke(0x1d9, [], handle);
      const size = await invoke(0x1e1, [], handle);
      for (let j = 0; j < size; j++) await invoke(0x1e0, [j], handle);
      events.set(event, (events.get(event) ?? 0) + 1);
      if (i % 47 === 0) {
        for (const abi of NATIVE_TILE_GAME_ABI) {
          if (abi.id === 0x1d9) continue;
          const values = tileGameQueryArguments(abi.id, i % players, i % 4, 0x80000040);
          if (values) await invoke(abi.id, values, handle);
        }
        await invoke(0x1e2, [0x030105, blockA, blockA + 4, blockA + 8], handle);
      }
      if (i % 127 === 0) {
        await invoke(0x1f5, [], handle);
        check(await invoke(0x1d9, [], handle), event, 'cached event replay');
      }
      const response = tileGameEventReply(event);
      if (response) await invoke(response[0], response.slice(1), handle);
      if (event === 20060) break;
    }
  }
  await invoke(0x1d7, [], handle);
  await invoke(0x1d7, [], peer);
  check(covered.size, 44, 'all family wrappers executed');
  await original.call(layout.destroy);

  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    nativeIDs: [...covered].sort((x, y) => x - y),
    events: [...events],
    operations,
    boundaries: [
      'authored KCS memory and argument records',
      'reviewed CRT allocator and Win32 services',
      'opaque browser handles',
    ],
    executed: [
      'independent original native table and JS-owned model',
      'all 44 complete main wrappers',
      'original rule model and event driver',
      'JS-owned vectors, event driver, rules, AI and independent tile MT stream',
    ],
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({ profile, calls, comparisons, wrappers: covered.size, events: events.size }),
  );
} finally {
  await original.close();
}
