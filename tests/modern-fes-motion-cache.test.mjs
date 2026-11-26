// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-fes-motion-cache-golden.json', import.meta.url)),
  ),
  fes = new TextEncoder().encode('#DEFINE\n#START\nnext WAIT\n#WAIT\n');

async function fixture(build, { initialize = true, revision = 0 } = {}) {
  const programs = build.programs.map((bytes) => new Uint8Array(Buffer.from(bytes, 'base64'))),
    files = {
      'startup.xml': new TextEncoder().encode(
        build.xml.replace(
          '</INT>',
          '<int02><int>fes</int><ext>fes</ext><dir>screen</dir><name>fes</name></int02></INT>',
        ),
      ),
      'loose/mutable.kcs': programs[0],
      'screen/cache.fes': fes,
    },
    world = await modernParticleMessageWorld(build.profile, files, { initialize });
  let current = revision;
  world.storage.read = async (path) => (path === 'loose/mutable.kcs' ? programs[current] : null);
  return {
    world,
    files,
    setRevision: (value) => {
      current = value;
    },
  };
}
async function call(world, id, args, before = null, pointers = new Map()) {
  const caller = world.main,
    machine = (caller.machine = new KCSMachine(
      await readKCS(
        kcsProgram([[43, id, args.length * 4], ...Array.from({ length: 22 }, () => [59])]),
      ),
      { native: (number, words, vm) => world.runtime.scheduler.native(caller, number, words, vm) },
      world.runtime.scheduler.shared,
    ));
  if (before) machine.memory.set(normalize(before, pointers));
  else machine.writeString('mutable', 64);
  machine.store(4096, 0xa17a29c5);
  args.forEach((word, index) => machine.store(4100 + index * 4, pointers.get(word) ?? word));
  machine.sp = 4100 + args.length * 4;
  caller.status = 'ready';
  caller.io = null;
  caller.waiting = null;
  await world.runtime.scheduler.execute(caller);
  return machine;
}
function normalize(input, pointers) {
  const bytes = new Uint8Array(input),
    view = new DataView(bytes.buffer);
  for (let at = 4100; at < 4140; at += 4) {
    const word = view.getUint32(at, true);
    if (pointers.has(word)) view.setUint32(at, pointers.get(word), true);
  }
  return bytes;
}
const registers = (manager) =>
  [...manager.records.values()].map(({ instance }) => instance.machine.load(0x8000009c));

for (const build of golden.builds) {
  test(`${build.version} real Main frames retain loaded actors while empty FES BASE/CPLANE deletion invalidates the mounted source cache`, async () => {
    const { world, setRevision } = await fixture(build),
      { instance } = await loadDefaultFES(world, 'cache'),
      pointers = new Map();
    let object,
      phase = 0,
      adds = 0,
      updates = 0;
    try {
      for (const row of build.rows) {
        if (row.id === 304 && ++adds === 2) setRevision(1);
        if (row.id === 304 && [2, 4].includes(adds)) {
          const expected = build.objects[phase],
            type = expected.kind === 0 ? 'BASE' : 'CPLANE';
          [object] = instance.collection.create(type, 'empty', 1, { scalar: true, enqueue: false });
          assert.equal(
            instance.runtime.targetFor(object, false),
            undefined,
            'empty FES object has no lazily allocated JS target',
          );
          assert.equal(world.motionLibrary.scripts.size, expected.cacheAfterConstructor);
        }
        const machine = await call(
          world,
          row.id,
          row.args,
          Buffer.from(row.beforeLocal, 'base64'),
          pointers,
        );
        if (row.id === 294) pointers.set(row.result, machine.load(4100));
        assert.deepEqual(
          machine.memory,
          normalize(Buffer.from(row.local, 'base64'), pointers),
          `Main${row.id} complete local`,
        );
        for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row[key]);
        if (row.id === 307) {
          const manager = await world.runtime.services.motion.get(
              pointers.get(build.rows[0].result),
            ),
            expected = build.objects[phase];
          assert.deepEqual(
            registers(manager),
            (updates % 2 === 0 ? expected.beforeDelete : expected.afterDelete).map(
              (member) => member.register,
            ),
          );
          if (updates++ % 2 === 0) {
            await instance.collection.remove(object);
            assert.equal(world.motionLibrary.scripts.size, expected.cacheAfterDestructor);
          } else {
            phase++;
            setRevision(2);
          }
        }
      }
      assert.equal(phase, 2);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

  test(`${build.version} FES object/task teardown after independent cold restore preserves actors and invalidates only the current cache`, async () => {
    let current = await fixture(build),
      world = current.world,
      fresh;
    try {
      const { id, instance } = await loadDefaultFES(world, 'cache'),
        [object] = instance.collection.create('BASE', 'empty', 1, { scalar: true, enqueue: false }),
        managerID = (await call(world, 294, [])).load(4100);
      await call(world, 304, [managerID, 64, 0xffffffff, 0, 0xffffffff, 0, 0]);
      await call(world, 307, [managerID, 1, 0]);
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await assert.rejects(world.restore(state), /fresh, idle world/);
      assert.equal(
        world.motionLibrary.scripts.size,
        1,
        'rejected nonfresh restore leaves the source cache intact',
      );
      fresh = await fixture(build, { initialize: false, revision: 1 });
      await fresh.world.restore(state);
      await world.close({ flushFiles: false });
      world = fresh.world;
      current = fresh;
      fresh = null;
      const restored = world.objects.objects.get(id).implementation.player.root,
        restoredObject = restored.collection.lookup('empty', 0),
        manager = await world.runtime.services.motion.get(managerID);
      assert.equal(restoredObject.handle, object.handle);
      assert.equal(world.motionLibrary.scripts.size, 1);
      await call(world, 304, [managerID, 64, 0xffffffff, 0, 0xffffffff, 0, 0]);
      await call(world, 307, [managerID, 2, 0]);
      assert.deepEqual(registers(manager), [1, 1]);
      await restored.collection.remove(restoredObject);
      assert.equal(world.motionLibrary.scripts.size, 0);
      await call(world, 304, [managerID, 64, 0xffffffff, 0, 0xffffffff, 0, 0]);
      await call(world, 307, [managerID, 3, 0]);
      assert.deepEqual(registers(manager), [1, 1, 2]);
      restored.runtime.topObject();
      current.setRevision(2);
      await world.objects.release(id);
      assert.equal(
        world.motionLibrary.scripts.size,
        0,
        'top-only FES manager destruction invalidates source cache',
      );
      await call(world, 304, [managerID, 64, 0xffffffff, 0, 0xffffffff, 0, 0]);
      await call(world, 307, [managerID, 4, 0]);
      assert.deepEqual(registers(manager), [1, 1, 2, 3]);
      await call(world, 295, [managerID]);
    } finally {
      await fresh?.world.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
}
