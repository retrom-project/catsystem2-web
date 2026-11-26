// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-cursor-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  test(`${build.version} own rotating history cursor Main frames preserve real reader/file state and cold`, async () => {
    const files = {
      'startup.xml': new TextEncoder().encode(build.xml),
      'loose-scene/a.cst': Buffer.from(build.input.a, 'base64'),
      'loose-scene/b.cst': Buffer.from(build.input.b, 'base64'),
    };
    let world = await modernParticleMessageWorld(build.profile, files),
      caller = world.main;
    const pointers = new Map(),
      cursors = new Map();
    const normalize = (input) => {
      const bytes = new Uint8Array(input),
        v = new DataView(bytes.buffer);
      for (let at = 4100; at < 4150; at += 4) {
        const word = v.getUint32(at, true);
        if (pointers.has(word)) v.setUint32(at, pointers.get(word), true);
      }
      return bytes;
    };
    const verify = (sample) => {
      for (const [name, expected] of Object.entries(sample.cursors)) {
        const cursor = world.runtime.handles.get(cursors.get(name), 'history-cursor');
        assert.equal(cursor.capacity, expected.capacity, sample.label + ' capacity');
        assert.equal(cursor.lastPath, expected.lastPath, sample.label + ' lastPath');
        const rows = Array.from({ length: cursor.capacity }, (_, i) => {
          const row = cursor.row(i);
          return {
            path: row.path,
            block: row.block,
            lastBlock: row.lastBlock,
            valid: row.valid,
            filename: row.reader.filename,
            fileValue: row.reader.fileValue,
            body: row.reader.body ? Buffer.from(row.reader.body.bytes).toString('base64') : null,
          };
        });
        assert.deepEqual(rows, expected.rows, sample.label + ' complete defined rows/readers');
      }
    };
    try {
      for (let i = 0; i < build.rows.length; i++) {
        const row = build.rows[i],
          sample = build.cases[i];
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
              const value = world.runtime.scheduler.native(caller, id, args, vm);
              return value && typeof value.then === 'function'
                ? value.then((result) => (reply = result))
                : (reply = value);
            },
          },
          world.runtime.scheduler.shared,
        ));
        machine.memory.set(normalize(Buffer.from(row.beforeLocal, 'base64')));
        machine.store(4096, 0xa17a29c5);
        row.args.forEach((word, n) => machine.store(4100 + n * 4, pointers.get(word) ?? word));
        machine.sp = 4100 + row.declaredCount * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        if ([323, 379].includes(row.id)) {
          const handle = machine.load(4100);
          pointers.set(row.result, handle);
          if (row.id === 379)
            cursors.set(
              row.args[1] === 3
                ? 'three'
                : row.args[1] === 1
                  ? 'one'
                  : row.args[1] === 5
                    ? 'five'
                    : 'zero',
              handle,
            );
        }
        assert.equal(reply.control, row.control, sample.label + ' control');
        assert.deepEqual(
          machine.memory,
          normalize(Buffer.from(row.local, 'base64')),
          sample.label + ' full Main memory',
        );
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], sample.label + ' ' + key);
        verify(sample);
        if (
          ['text-after-back', 'one-position-after-back', 'fifth-slot-position'].includes(
            sample.label,
          )
        ) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
          await world.restore(state);
          caller = world.main;
          verify(sample);
        }
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const build of golden.builds)
  test(`${build.version} Script Main225 clears a nonempty owned seen list through complete Main frames`, async () => {
    const world = await modernParticleMessageWorld(build.profile),
      caller = world.main;
    try {
      for (const row of build.clearSeenOriginal.rows) {
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
              return result && typeof result.then === 'function'
                ? result.then((value) => (reply = value))
                : (reply = result);
            },
          },
          world.runtime.scheduler.shared,
        ));
        machine.memory.set(Buffer.from(row.beforeLocal, 'base64'));
        machine.store(4096, 0xa17a29c5);
        row.args.forEach((word, i) => machine.store(4100 + i * 4, word));
        machine.sp = 4100 + row.declaredCount * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        assert.equal(reply.control, row.control);
        assert.deepEqual(machine.memory, new Uint8Array(Buffer.from(row.local, 'base64')));
        for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row[key]);
      }
      assert.deepEqual(world.runtime.sceneData(caller).history.seen, []);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
