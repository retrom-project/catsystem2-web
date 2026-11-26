// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { serializeStringBank } from '../src/native/persistence.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-strings-golden.json', import.meta.url)),
);
const bytes64 = (bytes) => Buffer.from(bytes).toString('base64');
const prefix = (bytes) => bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0));
function historyState(history) {
  return Object.fromEntries(
    ['seen', 'path'].map((side) => [
      side,
      history[side].map((entry) => ({
        nameBytes: bytes64(prefix(entry.nameBytes ?? encodeCP932(entry.scene))),
        value: entry.value,
        strings: entry.strings?.length
          ? entry.strings.map(([key, value]) => [key, bytes64(prefix(value))])
          : null,
      })),
    ]),
  );
}
for (const build of golden.builds)
  test(`${build.version} Scene history strings: real Main frames, live bank ownership and independent cold`, async () => {
    let world = await modernParticleMessageWorld(build.profile),
      caller = world.main,
      scene;
    const pointers = new Map();
    const normalize = (input) => {
      const bytes = new Uint8Array(input),
        view = new DataView(bytes.buffer);
      for (let at = 4100; at < 4150; at += 4) {
        const word = view.getUint32(at, true);
        if (pointers.has(word)) view.setUint32(at, pointers.get(word), true);
      }
      return bytes;
    };
    const verifyState = (sample) => {
      const data = sample.label.startsWith('task-')
        ? world.runtime.sceneData(caller)
        : world.runtime.handles.get(scene, 'scene-data');
      assert.deepEqual(historyState(data.history), sample.history, sample.label);
      const bank = world.runtime.stringBank(caller, false);
      assert.equal(Boolean(bank), sample.bankExists, `${sample.label} bank lifetime`);
      assert.deepEqual(
        serializeStringBank(bank),
        new Uint8Array(Buffer.from(sample.bankBytes, 'base64')),
        `${sample.label} bank bytes`,
      );
      assert.equal(
        world.objects.objects.get(caller.id).scriptStringDirty,
        sample.bankDirty,
        `${sample.label} caller dirty`,
      );
    };
    try {
      for (let rowIndex = 0; rowIndex < build.rows.length; rowIndex++) {
        const row = build.rows[rowIndex];
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
        row.args.forEach((word, i) => machine.store(4100 + i * 4, pointers.get(word) ?? word));
        machine.sp = 4100 + row.declaredCount * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        if (row.id === 323) {
          scene = machine.load(4100);
          pointers.set(row.result, scene);
        }
        assert.equal(reply.control, row.control, `Main${row.id} control`);
        assert.deepEqual(
          machine.memory,
          normalize(Buffer.from(row.local, 'base64')),
          `Main${row.id} full local at row ${rowIndex}`,
        );
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], `Main${row.id} ${key}`);
        const sample = build.cases.find((sample) => sample.rowIndex === rowIndex);
        if (!sample) continue;
        verifyState(sample);
        if (
          ['get-byte-boundary-split', 'history-not-live-alias', 'task-get-captured'].includes(
            sample.label,
          )
        ) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, {}, { initialize: false });
          await world.restore(state);
          caller = world.main;
          verifyState(sample);
          assert.deepEqual(caller.machine.memory, normalize(Buffer.from(row.local, 'base64')));
        }
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
