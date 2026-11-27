// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-legacy-cp932-runtime.json', import.meta.url)),
);
for (const [version, profile] of Object.entries(golden.profiles)) {
  for (const [group, fixture] of Object.entries(profile.groups)) {
    const calls = fixture.cases,
      names = [...new Set(calls.filter((r) => r.save).map((r) => r.save))],
      handleAt = (name) => 2304 + 4 * names.indexOf(name),
      marker = 0x763a1e59,
      program = kcsProgram([
        [37, marker],
        ...calls.flatMap((r) => [
          ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, handleAt(a)] : a]),
          [43, r.id, r.args.length * 4],
          ...(r.control === 1 ? [[38, r.save ? handleAt(r.save) : 2360]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2364],
        ]),
        [59],
      ]),
      files = { 'cp932-runtime.kcs': program };
    const make = (initialize) => dataWorld(profile.profile, files, { initialize });
    async function close(world) {
      for (const task of world.runtime.scheduler.tasks.values())
        world.runtime.scheduler.cancel(task.id, false);
      await world.close({ flushFiles: false });
    }
    function observe(world, task, row) {
      const original = world.runtime.native;
      world.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(original, this, [table, id, args, m, owner, ...rest]);
        assert.equal(id, row.id);
        for (const [at, text] of [
          [512, row.text],
          [768, row.other],
        ])
          if (text !== undefined) m.writeStringBytes(encodeCP932(text), at);
        m.store(128, -41);
        for (const { at, bytes } of row.outputs) m.bytes(at, bytes.length).fill(0xa5);
        const before = m.memory.slice(0, 4096),
          reply = await Reflect.apply(original, this, [table, id, args, m, owner, ...rest]),
          changed = [];
        for (let at = 0; at < 4096; at++)
          if (m.memory[at] !== before[at]) changed.push([at, m.memory[at]]);
        assert.equal(reply.control, row.control, group + ' Main' + id + ' control');
        if (!row.save)
          assert.equal(reply.value ?? null, row.result, group + ' Main' + id + ' result');
        assert.deepEqual(changed, row.changed, group + ' Main' + id + ' all guest writes');
        for (const { at, bytes } of row.outputs)
          assert.deepEqual([...m.bytes(at, bytes.length)], bytes);
        for (const state of row.state)
          if (state.bytes) {
            const handle = row.save === state.name ? reply.value : m.load(handleAt(state.name));
            assert.deepEqual(
              [...world.runtime.handles.get(handle, 'name-pairs')],
              state.bytes,
              'owned name-pair bytes',
            );
          }
        if (row.close)
          assert.equal(world.runtime.handles.records.has(args[0]), false, 'normal release');
        return reply;
      };
      return () => {
        world.runtime.native = original;
      };
    }
    async function step(world, task, row) {
      const restore = observe(world, task, row);
      try {
        if (task.machine.waiting?.kind === 'message')
          await world.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
        else await world.runtime.scheduler.execute(task);
      } finally {
        restore();
      }
      assert.equal(task.machine.load(task.machine.floor), marker, 'caller stack sentinel');
      assert.equal(task.machine.sp, task.machine.floor + 4, 'GCALL stack restoration');
    }
    test(`SDK${version} ${group} own ordinary CP932 GCALLs and independent current cold continuations`, async () => {
      const world = await make(true);
      try {
        const task = await world.spawnScript('cp932-runtime.kcs', {
          parent: world.main.id,
          initialExecute: false,
        });
        let cold = 0;
        for (let index = 0; index < calls.length; index++) {
          await step(world, task, calls[index]);
          if (index % 4 === 0 && index + 1 < calls.length && cold < 8) {
            const fresh = await make(false);
            try {
              await fresh.restore(
                await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
              );
              const restored = fresh.runtime.scheduler.tasks.get(task.id);
              assert(restored, 'actual Script restored');
              await step(fresh, restored, calls[index + 1]);
              cold++;
            } finally {
              await close(fresh);
            }
          }
        }
        assert.equal(cold, Math.min(8, Math.ceil((calls.length - 1) / 4)));
      } finally {
        await close(world);
      }
    });
  }
}
