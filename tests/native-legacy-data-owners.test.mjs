// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-legacy-data-owners.json', import.meta.url)),
);
for (const [version, profile] of Object.entries(fixture.profiles))
  for (const [group, golden] of Object.entries(profile.groups)) {
    const cases = golden.cases,
      names = [...new Set(cases.filter((r) => r.save).map((r) => r.save))],
      at = (name) => 2304 + names.indexOf(name) * 4;
    const marker = 0x6b2d914e,
      files = {
        'data-owner.kcs': kcsProgram([
          [37, marker],
          ...cases.flatMap((r) => [
            ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
            [43, r.id, r.args.length * 4],
            ...(r.control === 1 ? [[38, r.save ? at(r.save) : 2400]] : []),
            [37, 3968],
            [43, 71, 4],
            [38, 2404],
          ]),
          [59],
        ]),
      };
    const make = (initialize) => dataWorld(profile.profile, files, { initialize });
    async function close(w) {
      for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
      await w.close({ flushFiles: false });
    }
    async function step(w, t, r) {
      const native = w.runtime.native;
      w.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        assert.equal(id, r.id);
        m.bytes(256, 16).set(Uint8Array.from({ length: 16 }, (_, i) => i + 1));
        for (const { at, bytes } of r.outputs) m.bytes(at, bytes.length).fill(0xa5);
        if (r.seed) r.seed.forEach((v, i) => m.store(512 + i * 4, v));
        if (r.other) r.other.forEach((v, i) => m.store(768 + i * 4, v));
        const before = m.memory.slice(0, 2048),
          reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]),
          changed = [];
        for (let i = 0; i < 2048; i++)
          if (before[i] !== m.memory[i]) changed.push([i, m.memory[i]]);
        assert.equal(reply.control, r.control, 'original control');
        if (!r.save || r.size === 0)
          assert.equal(reply.value ?? null, r.result, 'published result');
        assert.deepEqual(changed, r.changed, 'all original caller data writes');
        for (const { at, bytes } of r.outputs)
          assert.deepEqual([...m.bytes(at, bytes.length)], bytes);
        for (const state of r.state) {
          const pointer = r.save === state.name ? reply.value : m.load(at(state.name));
          if (state.size === 0)
            assert.equal(
              m.blocks.filter((b) => b.length === 0).length,
              1,
              'zero-sized owned node retained',
            );
          else if (state.bytes)
            assert.deepEqual(
              [...m.bytes(pointer, state.size)],
              state.bytes,
              'owned mapped span bytes',
            );
          else if (state.width !== undefined) {
            const bitmap = w.graphics.images.get(pointer);
            assert.equal(bitmap.width, state.width);
            assert.equal(bitmap.height, state.height);
          }
        }
        if (r.id === 237) {
          assert.deepEqual(
            r.discardedPhysicalScratch.map((x) => [x.after, x.control]),
            [[1, 2]],
            'original writes only discardable physical scratch',
          );
          assert.equal(Object.hasOwn(reply, 'value'), false, 'control2 publishes no scratch value');
        }
        return reply;
      };
      try {
        if (t.machine.waiting?.kind === 'message')
          await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
        else await w.runtime.scheduler.execute(t);
      } finally {
        w.runtime.native = native;
      }
      assert.equal(t.machine.load(t.machine.floor), marker);
      assert.equal(t.machine.sp, t.machine.floor + 4);
    }
    test(`SDK${version} ${group} own defined data/owner GCALLs and independent current cold`, async () => {
      const w = await make(true);
      try {
        const task = await w.spawnScript('data-owner.kcs', {
          parent: w.main.id,
          initialExecute: false,
        });
        let cold = 0;
        for (let i = 0; i < cases.length; i++) {
          await step(w, task, cases[i]);
          if (i % 4 === 0 && i + 1 < cases.length && cold < 8) {
            const fresh = await make(false);
            try {
              await fresh.restore(
                await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
              );
              await step(fresh, fresh.runtime.scheduler.tasks.get(task.id), cases[i + 1]);
              cold++;
            } finally {
              await close(fresh);
            }
          }
        }
        assert.equal(cold, Math.min(8, Math.ceil((cases.length - 1) / 4)));
      } finally {
        await close(w);
      }
    });
  }
