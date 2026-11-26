// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-motion-main-records-golden.json', import.meta.url)),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const build of golden.builds)
  test(`${build.version} nonempty Main MOT callers preserve formatted resources, raw registers, timing and independent cold state`, async () => {
    const files = {
      'startup.xml': new TextEncoder().encode(build.xml),
      'frame.kcs': kcsProgram(Array.from({ length: 33 }, () => [59])),
      'loose/clock-7.kcs': new Uint8Array(Buffer.from(build.inputs.clock, 'base64')),
      'loose/exit.kcs': new Uint8Array(Buffer.from(build.inputs.exit, 'base64')),
      'loose/active.kcs': new Uint8Array(Buffer.from(build.inputs.rawActive, 'base64')),
    };
    let world = await modernParticleMessageWorld(build.profile, files),
      caller = await world.spawnScript('frame.kcs'),
      manager,
      last = new Uint8Array(8192);
    // Main member IDs have their own namespace. This valid typed-handle range
    // keeps pointer normalization distinct from member1/2/3 in the full frame.
    world.runtime.handles.next = golden.canonicalManager;
    async function cold() {
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      await world.restore(state);
      caller = world.runtime.scheduler.tasks.get(caller.id);
    }
    try {
      for (const row of build.rows) {
        const args = row.args.map((w) => (w === 'manager' ? manager : w)),
          program = await readKCS(
            kcsProgram([
              [43, row.id, row.declaredCount * 4],
              ...Array.from({ length: 22 }, () => [59]),
            ]),
          ),
          m = (caller.machine = new KCSMachine(
            program,
            {
              native: (id, words, machine) =>
                world.runtime.scheduler.native(caller, id, words, machine),
            },
            world.runtime.scheduler.shared,
          ));
        m.memory.set(last);
        for (const write of row.writes)
          m.writeBytes(write.address, Buffer.from(write.bytes, 'base64'));
        assert.equal(hash(m.memory), row.beforeLocalSha256, row.label + ' before');
        m.store(4096, 0xa17a29c5);
        args.forEach((word, i) => m.store(4100 + i * 4, word));
        m.sp = 4100 + row.declaredCount * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        if (row.id === 294) {
          manager = m.load(4100);
          assert.equal(manager, golden.canonicalManager);
        }
        assert.equal(hash(m.memory), row.localSha256, row.label + ' local');
        for (const key of ['pc', 'sp', 'fp']) assert.equal(m[key], row[key], row.label + ' ' + key);
        if (row.state) {
          const current = await world.runtime.services.motion.get(manager),
            state = row.state;
          assert.deepEqual(current.base, new Uint8Array(Buffer.from(state.base, 'base64')));
          if (state.working !== null)
            assert.deepEqual(
              current.readBank(true),
              new Uint8Array(Buffer.from(state.working, 'base64')),
            );
          for (const key of ['nextHandle', 'speedWord', 'flags'])
            assert.equal(current[key], state[key], row.label + ' ' + key);
          assert.equal(current.records.size, state.records.length);
          for (const expected of state.records) {
            const record = current.records.get(expected.handle),
              instance = record.instance,
              shared = instance.shared.slice();
            assert.equal(record.group, expected.group);
            assert.equal(record.startTick, expected.start);
            assert.equal(instance.script.recordName, expected.filename);
            if (!expected.objectInitialized) {
              shared.fill(0, 0, 144);
              assert.throws(() => instance.machine.load(0x80000000), /uninitialized memory/);
            }
            if (!expected.ran) {
              shared.fill(0, 144, 148);
              assert.throws(() => instance.frame, /uninitialized memory/);
            }
            assert.equal(
              hash(shared),
              expected.sharedSha256,
              row.label + ' shared ' + expected.handle,
            );
            assert.equal(
              hash(instance.machine.memory),
              expected.vm.localSha256,
              row.label + ' MOT local ' + expected.handle,
            );
            for (const key of ['pc', 'sp', 'fp'])
              assert.equal(instance.machine[key], expected.vm[key], row.label + ' MOT ' + key);
          }
        }
        last = m.memory.slice();
        if (
          [
            'add-delayed',
            'deferred-first-update',
            'start-first-update',
            'replace-registers',
            'query-formatted-resource',
          ].includes(row.label)
        )
          await cold();
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const build of golden.builds)
  test(`${build.version} Main514 preserves narrow or wide basic filenames and true positive resource queries`, async () => {
    const source = build.filenameShapes,
      world = await modernParticleMessageWorld(build.profile, {
        'startup.xml': new TextEncoder().encode(source.xml),
        'loose/ソ.kcs': new Uint8Array(Buffer.from(source.program, 'base64')),
        'loose/clock-7.kcs': new Uint8Array(Buffer.from(source.program, 'base64')),
      });
    try {
      const task = world.main,
        m = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, task),
        handle = (await call(294, [])).value;
      for (const row of source.added) {
        m.writeString(row.name, 64);
        assert.equal(
          (await call(304, [handle, 64, 0xffffffff, 0, 0xffffffff, 0, 7])).value,
          row.result,
        );
      }
      const manager = await world.runtime.services.motion.get(handle);
      for (const row of source.names)
        assert.equal(manager.records.get(row.handle).instance.script.recordName, row.filename);
      for (const row of source.queries) {
        m.writeString(row.name, 64);
        assert.deepEqual(await call(514, [handle, 64]), {
          control: row.control,
          value: row.result,
        });
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

test('67 Main514 category field is archive rather than the independent loose directory', async () => {
  const { dataWorld } = await import('./fixtures/data-world.mjs');
  const world = await dataWorld('bokutomo-engine-2.6.1.67', { 'owned.kcs': kcsProgram([[59]]) });
  try {
    const task = world.main,
      m = task.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, task),
      handle = (await call(294, [])).value;
    m.writeString('owned', 64);
    assert.equal((await call(304, [handle, 64, 0xffffffff, 0, 0xffffffff, 0, 7])).value, 1);
    // The own514 GCALL fixture varies Src+0x964. The real XML reader names
    // that exact field archive; directory is Src+0x98c and is independent.
    for (const [archive, directory, value] of [
      ['', 'loose', 1],
      ['motion', '', 0],
    ]) {
      world.runtime.services.motion.library.game.nativeResources = {
        entries: [{ name: 'mot', archive, directory, extension: 'kcs' }],
      };
      assert.deepEqual(await call(514, [handle, 64]), { control: 1, value });
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});
