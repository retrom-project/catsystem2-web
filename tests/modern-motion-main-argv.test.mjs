// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-motion-main-argv-golden.json', import.meta.url)),
);
for (const build of golden.builds) {
  for (const [label, rows] of [
    ['main/cold', build.rows],
    ['CSS tails/working alias', build.extraTailRows],
  ]) {
    test(`${build.version} ${label}: real fixed Motion wrappers consume mapped short argv/unaligned/aliased pointers and ignore unused tails`, async () => {
      const files = {
        'startup.xml': new TextEncoder().encode(build.xml),
        'loose/owned.kcs': Buffer.from(build.program, 'base64'),
      };
      let world = await modernParticleMessageWorld(build.profile, files),
        caller = world.main;
      const pointers = new Map(),
        normalize = (input) => {
          const bytes = new Uint8Array(input),
            view = new DataView(bytes.buffer);
          for (let at = 4100; at < 4170; at += 4) {
            const word = view.getUint32(at, true);
            if (pointers.has(word)) view.setUint32(at, pointers.get(word), true);
          }
          return bytes;
        };
      try {
        for (const row of rows) {
          let reply;
          const machine = (caller.machine = new KCSMachine(
            await readKCS(
              kcsProgram([
                [43, row.id, row.declaredCount * 4],
                ...Array.from({ length: 22 }, () => [59]),
              ]),
            ),
            {
              native: (id, args, vm) => {
                const result = world.runtime.scheduler.native(caller, id, args, vm);
                if (result && typeof result.then === 'function')
                  return result.then((value) => (reply = value));
                return (reply = result);
              },
            },
            world.runtime.scheduler.shared,
          ));
          machine.memory.set(normalize(Buffer.from(row.beforeLocal, 'base64')));
          machine.store(4096, 0xa17a29c5);
          row.args.forEach((word, index) =>
            machine.store(4100 + index * 4, pointers.get(word) ?? word),
          );
          machine.sp = 4100 + row.declaredCount * 4;
          caller.status = 'ready';
          caller.io = null;
          caller.waiting = null;
          await world.runtime.scheduler.execute(caller);
          if ([294, 238, 315, 388].includes(row.id)) pointers.set(row.result, machine.load(4100));
          assert.equal(reply.control, row.control, row.label + ' control');
          assert.deepEqual(
            machine.memory,
            normalize(Buffer.from(row.local, 'base64')),
            row.label + ' full local',
          );
          for (const key of ['pc', 'sp', 'fp'])
            assert.equal(machine[key], row[key], row.label + ' ' + key);
          if (row.id === 316) {
            const before = world.snapshot(),
              state = await deserializeCheckpoint(await serializeCheckpoint(before));
            await world.close({ flushFiles: false });
            world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
            await world.restore(state);
            caller = world.main;
            assert.deepEqual(world.snapshot().motionSources, before.motionSources);
            for (const [id, record] of world.runtime.handles.records)
              if (record.type === 'motion-manager') {
                const restored = await world.runtime.services.motion.get(id),
                  saved = before.runtime.handles.records.find(([handle]) => handle === id)[1].value
                    .state;
                assert.deepEqual(restored.snapshot(), saved);
              }
          }
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    });
  }
  test(`${build.version} a fixed CSS argv word outside mapped VM memory remains diagnosed without allocating a result owner`, async () => {
    const world = await modernParticleMessageWorld(build.profile),
      caller = world.main;
    try {
      const machine = (caller.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, 387, 0], [59]])),
          { native: (id, args, vm) => world.runtime.scheduler.native(caller, id, args, vm) },
          world.runtime.scheduler.shared,
        )),
        handles = world.runtime.handles.records.size;
      machine.sp = machine.memory.length;
      caller.status = 'ready';
      caller.io = null;
      caller.waiting = null;
      await assert.rejects(world.runtime.scheduler.execute(caller), /KCS memory 2000\+4/);
      assert.equal(world.runtime.handles.records.size, handles);
      const file = new NativeGlobalFile();
      file.write(7, Uint8Array.of(8, 0, 0, 0, 0, 0, 0, 0));
      const fileID = world.runtime.handles.add('global-file', file),
        manager = world.runtime.services.motion.create(caller.id),
        restore = (caller.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, 388, 0], [59]])),
          { native: (id, args, vm) => world.runtime.scheduler.native(caller, id, args, vm) },
          world.runtime.scheduler.shared,
        )),
        before = world.runtime.handles.records.size;
      restore.sp = restore.memory.length - 12;
      [fileID, 7, manager].forEach((word, index) => restore.store(restore.sp + index * 4, word));
      caller.status = 'ready';
      caller.io = null;
      caller.waiting = null;
      await assert.rejects(world.runtime.scheduler.execute(caller), /KCS memory 2000\+4/);
      assert.equal(
        world.runtime.handles.records.size,
        before,
        'unmapped consumed frame does not leak a checkpoint handle',
      );
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
