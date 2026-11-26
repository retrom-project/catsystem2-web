// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-motion-wide-css-golden.json', import.meta.url)),
);

test('76 original UTF16 CSS filename outside CP932 loads and executes via real Main wrappers and independent cold', async () => {
  const files = { ['loose/' + golden.filename]: Buffer.from(golden.program, 'base64') };
  let world = await modernParticleMessageWorld(golden.profile, files),
    caller = world.main,
    manager;
  const pointers = new Map(),
    bind = () => {
      world.game.nativeSearch.register('mot', 'loose');
      world.storage.read = async (name) =>
        name === 'motion.css' ? new Uint8Array(Buffer.from(golden.css, 'base64')) : null;
    };
  bind();
  assert.notEqual(
    new TextDecoder('shift_jis').decode(encodeCP932(golden.filename)),
    golden.filename,
  );
  const normalize = (input) => {
    const bytes = new Uint8Array(input),
      view = new DataView(bytes.buffer);
    for (let at = 4100; at < 4140; at += 4) {
      const value = view.getUint32(at, true);
      if (pointers.has(value)) view.setUint32(at, pointers.get(value), true);
    }
    return bytes;
  };
  try {
    for (const row of golden.rows) {
      const m = (caller.machine = new KCSMachine(
        await readKCS(
          kcsProgram([
            [43, row.id, row.args.length * 4],
            ...Array.from({ length: 22 }, () => [59]),
          ]),
        ),
        {
          native: (id, args, machine) => world.runtime.scheduler.native(caller, id, args, machine),
        },
        world.runtime.scheduler.shared,
      ));
      m.memory.set(normalize(Buffer.from(row.beforeLocal, 'base64')));
      m.store(4096, 0xa17a29c5);
      row.args.forEach((word, i) => m.store(4100 + i * 4, pointers.get(word) ?? word));
      m.sp = 4100 + row.args.length * 4;
      caller.status = 'ready';
      caller.io = null;
      await world.runtime.scheduler.execute(caller);
      if ([247, 294, 388].includes(row.id)) pointers.set(row.result, m.load(4100));
      if (row.id === 294) manager = m.load(4100);
      assert.deepEqual(
        m.memory,
        normalize(Buffer.from(row.local, 'base64')),
        `Main${row.id} complete local`,
      );
      for (const key of ['pc', 'sp', 'fp']) assert.equal(m[key], row[key]);
      if (row.id === 388)
        assert.deepEqual(
          world.runtime.handles.get(m.load(4100), 'motion-checkpoint').bytes,
          new Uint8Array(Buffer.from(golden.copy, 'base64')),
        );
      if (row.id === 307) {
        const record = [...(await world.runtime.services.motion.get(manager)).records.values()][0];
        assert.equal(record.instance.script.recordName, golden.filename);
        assert.equal(record.instance.machine.load(0x8000009c), golden.loaded.register);
        assert.equal(record.instance.machine.pc, golden.loaded.pc);
        assert.equal(record.instance.machine.sp, golden.loaded.sp);
        const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        world = await modernParticleMessageWorld(golden.profile, files, { initialize: false });
        bind();
        await world.restore(state);
        caller = world.main;
        const restored = [
          ...(await world.runtime.services.motion.get(manager)).records.values(),
        ][0];
        assert.equal(restored.instance.script.recordName, golden.filename);
        assert.equal(restored.instance.machine.load(0x8000009c), golden.loaded.register);
        assert.equal(restored.instance.script.nameBytes, null);
      }
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});
