// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const f = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk63-aux-motion.json', import.meta.url)),
  ),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
for (const coldAt of [null, 3, 4, 6, 7, 8])
  test(`SDK63 actual generic17/41 MOT consumer${coldAt === null ? ' normal lifecycle' : ' cold after ' + coldAt}`, async () => {
    const open = (initialize) =>
      dataWorld(f.profile, { 'aux-finite.kcs': bytes(f.motion) }, { initialize });
    let w = await open(true),
      task = w.main;
    for (const [at, v] of f.init) task.machine.store(at, v);
    const check = async (row) => {
      const m = task.machine;
      if (row.output) assert.deepEqual(new Uint8Array(m.bytes(1536, 144)), bytes(row.output));
      if (row.id === 295) {
        assert.equal(w.runtime.handles.records.has(m.load(64)), false);
        return;
      }
      const manager = await w.runtime.services.motion.get(m.load(64));
      if (row.working) assert.deepEqual(new Uint8Array(manager.readBank(true)), bytes(row.working));
      assert.equal(manager.records.size, row.records.length);
      for (const r of row.records) {
        const a = manager.records.get(r.handle);
        assert(a);
        if (r.results) {
          assert.deepEqual(
            [64, 68, 72, 76].map((at) => a.instance.machine.load(at)),
            r.results,
          );
          assert.equal(a.instance.machine.pc, r.pc);
        }
      }
    };
    try {
      for (let i = 0; i < f.calls.length; i++) {
        const r = f.calls[i],
          reply = await w.runtime.native(
            'main',
            r.id,
            r.args.map((x) => (Array.isArray(x) ? task.machine.load(x[1]) : x)),
            task.machine,
            task,
          );
        assert.equal(reply.control, f.rows[i].control);
        if (r.out !== undefined) task.machine.store(r.out, reply.value);
        await check(f.rows[i]);
        if (i === coldAt) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
          await w.close({ flushFiles: false });
          w = await open(false);
          await w.restore(state);
          task = w.main;
          await check(f.rows[i]);
        }
      }
      assert.equal(w.nativeEngine, undefined);
    } finally {
      await w.close({ flushFiles: false });
    }
  });
