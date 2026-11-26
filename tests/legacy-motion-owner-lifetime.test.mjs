// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/legacy-motion-owner-lifetime-golden.json', import.meta.url)),
);
for (const build of golden.builds) {
  test(`${build.version} own Main294 manager survives actual Script destruction and another caller matches all original Main frames`, async () => {
    const world = await modernParticleMessageWorld(build.profile, {
      'frame.kcs': kcsProgram([[59]]),
    });
    let creator = await world.spawnScript('frame.kcs'),
      borrower = await world.spawnScript('frame.kcs'),
      handle;
    const normalize = (input) => {
      const bytes = new Uint8Array(input),
        view = new DataView(bytes.buffer);
      if (handle)
        for (let at = 4100; at < 4120; at += 4)
          if (view.getUint32(at, true) === build.manager) view.setUint32(at, handle, true);
      return bytes;
    };
    try {
      for (const row of build.rows) {
        const task = row.id === 294 ? creator : borrower;
        if (row.id === 311) {
          await world.objects.release(creator.id);
          assert(!world.objects.objects.has(creator.id));
          assert(
            world.runtime.handles.records.has(handle),
            'Native manager must survive its creator',
          );
          creator = null;
        }
        const machine = (task.machine = new KCSMachine(
          await readKCS(
            kcsProgram([
              [43, row.id, row.args.length * 4],
              ...Array.from({ length: 22 }, () => [59]),
            ]),
          ),
          { native: (id, args, m) => world.runtime.scheduler.native(task, id, args, m) },
          world.runtime.scheduler.shared,
        ));
        machine.memory.set(normalize(Buffer.from(row.beforeLocal, 'base64')));
        machine.store(4096, 0xa1caa17e);
        row.args.forEach((word, i) =>
          machine.store(4100 + i * 4, word === build.manager ? handle : word),
        );
        machine.sp = 4100 + row.args.length * 4;
        task.status = 'ready';
        task.io = null;
        await world.runtime.scheduler.execute(task);
        if (row.id === 294) handle = machine.load(4100);
        assert.deepEqual(
          machine.memory,
          normalize(Buffer.from(row.local, 'base64')),
          `Main${row.id} complete local`,
        );
        for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row[key]);
        if (row.id === 308)
          assert.equal(
            (await world.runtime.services.motion.get(handle)).speedWord,
            build.rawSpeedAfterBorrow,
          );
      }
      assert(!world.runtime.handles.records.has(handle));
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.version} creator-absent independent cold rebinds the manager and explicit delete/World close release it`, async () => {
    const files = {
      'frame.kcs': kcsProgram([[59]]),
      'create.kcs': kcsProgram([[43, 294, 0], [38, [0x13, 64]], [59]]),
    };
    let world = await modernParticleMessageWorld(build.profile, files),
      handle;
    try {
      const creator = await world.spawnScript('create.kcs');
      await world.runtime.scheduler.execute(creator);
      handle = creator.machine.load(64);
      const before = (await world.runtime.services.motion.get(handle)).snapshot();
      await world.objects.release(creator.id);
      assert(world.runtime.handles.records.has(handle));
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      await world.restore(state);
      assert(!world.objects.objects.has(creator.id));
      assert.deepEqual((await world.runtime.services.motion.get(handle)).snapshot(), before);
      const borrower = await world.spawnScript('frame.kcs'),
        machine = (borrower.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, 311, 4], [59]])),
          { native: (id, args, m) => world.runtime.scheduler.native(borrower, id, args, m) },
          world.runtime.scheduler.shared,
        ));
      machine.store(4100, handle);
      machine.sp = 4104;
      borrower.status = 'ready';
      borrower.io = null;
      await world.runtime.scheduler.execute(borrower);
      assert.equal(machine.load(4100), 0);
      const remove = (borrower.machine = new KCSMachine(
        await readKCS(kcsProgram([[43, 295, 4], [59]])),
        { native: (id, args, m) => world.runtime.scheduler.native(borrower, id, args, m) },
        world.runtime.scheduler.shared,
      ));
      remove.store(4100, handle);
      remove.sp = 4104;
      borrower.status = 'ready';
      borrower.io = null;
      await world.runtime.scheduler.execute(borrower);
      assert(!world.runtime.handles.records.has(handle));
      world.runtime.services.motion.create(borrower.id);
      await world.close({ flushFiles: false });
      assert.equal(world.runtime.handles.records.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
