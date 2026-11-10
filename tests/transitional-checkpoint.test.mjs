// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { CHECKPOINT_LIMIT } from '../src/checkpoint.mjs';
import { transitionalExe } from '../web/transitional-entry.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

test('mixed snapshots budget guest state separately from the JS-owned graph', async () => {
  // Size accounting reads byteLength. The large zero buffer stays untouched.
  const bytes = new ArrayBuffer(CHECKPOINT_LIMIT + 4096),
    guest = { bytes },
    engine = Object.assign(Object.create(CatSystem2.prototype), {
      nativeProfile: 'nekopara-vol3-engine-2.6.1.76',
      identity: 'authored',
      transitionalExe,
      world: {
        resourceCache: { async settle() {} },
        movies: { async settle() {} },
        snapshot: () => ({ nativeEngine: guest, data: new Uint8Array(8) }),
      },
      audio: { snapshot: () => ({}) },
      emote: { snapshot: () => ({}) },
    });
  assert.equal(engine.checkpointLimit, 768 * 1024 * 1024);
  const snapshot = await engine.snapshot();
  assert.ok(engine.checkpointSize(snapshot) > CHECKPOINT_LIMIT);
  snapshot.world.data = bytes;
  assert.throws(() => engine.checkpointSize(snapshot), /Checkpoint exceeds 268435456/);
  engine.transitionalExe = null;
  assert.equal(engine.checkpointLimit, CHECKPOINT_LIMIT);
  await assert.rejects(engine.snapshot(), /Checkpoint exceeds/);
  engine.transitionalExe = transitionalExe;
  engine.nativeProfile = 'sdk-4.01-engine-2.6.1.74';
  assert.equal(engine.checkpointLimit, CHECKPOINT_LIMIT);
  await assert.rejects(engine.snapshot(), /Checkpoint exceeds/);
});

test('PE restore decodes an authored heap span above 256 MiB within its mapped bound', () => {
  const address = 0x20000000,
    size = 512 * 1024 * 1024,
    length = 256 * 1024 * 1024 + 4096,
    writes = [],
    process = Object.assign(Object.create(PE32Process.prototype), {
      heap: address + length,
      heapLimit: address + size,
      regions: [{ address, size, kind: 'heap' }],
      executionBoundaries: new Map(),
      traps: new Map(),
      write: (at, bytes) => writes.push([at, bytes.length]),
      writeRegisters() {},
      cpu: { mem_protect() {} },
    }),
    state = {
      heap: address + length,
      heapLimit: address + size,
      nextTrap: 0,
      executionBoundaries: [],
      traps: [],
      memoryPermissions: [],
      registers: {},
      allocations: [],
      freeBlocks: [],
      regions: [{ address, size, kind: 'heap', bytes: { length, blocks: [] } }],
    };
  process.restore(state);
  assert.deepEqual(writes, [[address, length]]);
  state.regions[0].bytes.length = size + 1;
  assert.throws(() => process.restore(state), /snapshot mapping/);
});
