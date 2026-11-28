// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { KCSMachine, readKCS, floatBits } from '../src/kcs.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-motion-main-state-golden.json', import.meta.url)),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = { 'frame.kcs': kcsProgram(Array.from({ length: 33 }, () => [59])) };
for (const build of golden.builds)
  test(`${build.version} real Main Motion state frames retain raw banks, aliases and empty/null controls`, async () => {
    let world = await modernParticleMessageWorld(build.profile, files),
      caller = await world.spawnScript('frame.kcs'),
      handle,
      lastMemory = new Uint8Array(8192);
    const normalized = (bytes) => {
      const result = Buffer.from(bytes);
      if (handle)
        for (let at = 0; at < result.length; at += 4)
          if (result.readUInt32LE(at) === handle)
            result.writeUInt32LE(golden.canonicalManagerWord, at);
      return hash(result);
    };
    try {
      for (const row of build.rows) {
        const args = row.args.map((word) => (word === 'manager' ? handle : word)),
          program = await readKCS(
            kcsProgram([
              [43, row.id, row.declaredCount * 4],
              ...Array.from({ length: 22 }, () => [59]),
            ]),
          ),
          machine = (caller.machine = new KCSMachine(
            program,
            { native: (id, words, m) => world.runtime.scheduler.native(caller, id, words, m) },
            world.runtime.scheduler.shared,
          ));
        machine.memory.set(lastMemory);
        for (const write of row.writes)
          machine
            .bytes(write.address, Buffer.from(write.bytes, 'base64').length)
            .set(Buffer.from(write.bytes, 'base64'));
        assert.equal(normalized(machine.memory), row.beforeLocalSha256, row.label + ' before');
        machine.store(4096, 0xa17a29c5);
        args.forEach((word, index) => machine.store(4100 + index * 4, word));
        machine.sp = 4100 + row.declaredCount * 4;
        caller.status = 'ready';
        caller.waiting = null;
        caller.io = null;
        await world.runtime.scheduler.execute(caller);
        if (row.id === 294) handle = machine.load(4100);
        assert.equal(normalized(machine.memory), row.localSha256, row.label + ' after');
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], row.label + ' ' + key);
        if (row.state) {
          const manager = await world.runtime.services.motion.get(handle);
          assert.deepEqual(
            manager.base,
            new Uint8Array(Buffer.from(row.state.base, 'base64')),
            row.label + ' base',
          );
          if (row.state.working !== null)
            assert.deepEqual(
              manager.working,
              new Uint8Array(Buffer.from(row.state.working, 'base64')),
              row.label + ' working',
            );
          assert.equal(floatBits(manager.speed), row.state.speed);
          assert.equal(manager.flags, row.state.flags);
          assert.equal(manager.nextHandle, row.state.nextHandle);
          assert.equal(Number(manager.lastProcessed), row.state.lastProcessed);
        }
        lastMemory = machine.memory.slice();
        if (row.label === 'commit-working-overlap' || row.label === 'set-flags') {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
          await world.restore(state);
          caller = world.runtime.scheduler.tasks.get(caller.id);
          assert(caller);
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const build of golden.builds)
  test(`${build.version} Main308 raw speed words retain NaNs and negative zero through independent cold restores`, async () => {
    const inputs = {
      'create.kcs': kcsProgram([[43, 294, 0], [38, [0x13, 64]], [59]]),
      'speed.kcs': kcsProgram([[37, [0x13, 80]], [37, [0x13, 84]], [43, 308, 8], [59]]),
    };
    let world = await modernParticleMessageWorld(build.profile, inputs);
    try {
      const creator = await world.spawnScript('create.kcs');
      await world.runtime.scheduler.execute(creator);
      const handle = creator.machine.load(64);
      await world.objects.release(creator.id);
      for (const row of build.speedWords.rows) {
        const task = await world.spawnScript('speed.kcs');
        task.machine.store(80, handle);
        task.machine.store(84, row.word);
        await world.runtime.scheduler.execute(task);
        assert.equal(task.machine.sp, task.machine.floor);
        assert.equal(row.control, 2);
        assert.equal((await world.runtime.services.motion.get(handle)).speedWord, row.stored);
        await world.objects.release(task.id);
        const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        world = await modernParticleMessageWorld(build.profile, inputs, { initialize: false });
        await world.restore(state);
        assert.equal((await world.runtime.services.motion.get(handle)).speedWord, row.stored);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
