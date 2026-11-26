// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-motion-cache-golden.json', import.meta.url)),
  ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const build of golden.builds) {
  test(`${build.version} real Main GCALLs share source code until manager deletion while retaining existing actors`, async () => {
    const programs = build.programs.map((b) => new Uint8Array(Buffer.from(b, 'base64'))),
      world = await modernParticleMessageWorld(build.profile, {
        'startup.xml': new TextEncoder().encode(build.xml),
        'loose/mutable.kcs': programs[0],
      });
    let revision = 0,
      reads = 0,
      addCount = 0,
      updateCount = 0,
      previous = new Uint8Array(8192);
    // This is the current World storage, assigned after constructing its library.
    // The immutable mounted file remains the original source as a decoy.
    world.storage.read = async (path) =>
      path === 'loose/mutable.kcs' ? (reads++, programs[revision]) : null;
    world.runtime.handles.next = 0x10000;
    try {
      const caller = world.main;
      for (const row of build.rows) {
        if (row.id === 304 && addCount++ === 1) revision = 1;
        const program = await readKCS(
            kcsProgram([
              [43, row.id, row.args.length * 4],
              ...Array.from({ length: 22 }, () => [59]),
            ]),
          ),
          machine = (caller.machine = new KCSMachine(
            program,
            {
              native: (id, args, m) => world.runtime.scheduler.native(caller, id, args, m),
            },
            world.runtime.scheduler.shared,
          ));
        machine.memory.set(previous);
        for (const write of row.writes)
          machine.writeBytes(write.address, Buffer.from(write.bytes, 'base64'));
        assert.equal(hash(machine.memory), row.beforeLocalSha256);
        machine.store(4096, 0xa17a29c5);
        row.args.forEach((word, i) => machine.store(4100 + i * 4, word));
        machine.sp = 4100 + row.args.length * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row[key]);
        assert.equal(hash(machine.memory), row.localSha256, `Main${row.id} full local`);
        if (row.id === 307) {
          const expected = build.cases[updateCount++],
            manager = await world.runtime.services.motion.get(row.args[0]);
          assert.deepEqual(
            [...manager.records.values()].map(({ handle, instance }) => ({
              handle,
              register: instance.machine.load(0x8000009c),
            })),
            expected.state,
          );
          // Original FileServer uses size and data reads for each source load.
          assert.equal(reads * 2, expected.readCount);
        }
        previous = machine.memory.slice();
      }
      assert.equal(world.runtime.services.motion.library.scripts.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.version} an explicitly supplied MOT reader retains authority when bound to a World`, async () => {
    const program = kcsProgram([[59]]),
      world = await modernParticleMessageWorld(build.profile),
      reads = [];
    try {
      const explicit = new MotionLibrary(world.game, {
          profile: build.profile,
          read: async (name) => (reads.push(name), program),
        }),
        bound = explicit.withResources(world.game, () => {
          throw new Error('Default reader replaced explicit provider');
        });
      const script = await bound.load('Mixed.KCS');
      assert.equal(script.name, 'Mixed.KCS');
      assert.deepEqual(reads, ['Mixed.KCS']);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
