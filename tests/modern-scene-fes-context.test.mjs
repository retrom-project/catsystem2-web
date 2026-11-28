// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-fes-context-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  test(`${build.version} FES receiver has no Script Scene context and preserves destination history through cold`, async () => {
    let world = await modernParticleMessageWorld(build.profile),
      caller = world.main;
    const fesID = await world.objects.create({
      kind: 34,
      nativeID: build.fes.nativeID,
      parent: world.root,
    });
    assert.deepEqual(build.fes.bases, [
      '.?AVkcTaskFEScript@@',
      '.?AVkcTaskBase@@',
      '.?AVkcClassBase@@',
    ]);
    const verifyReceiver = async () => {
      const record = world.objects.objects.get(fesID);
      assert.equal(record.context.sceneData, undefined);
      for (const method of ['sendNativeEngine', 'sendEngine']) {
        const values = new Map([
          [512, 0x13579bdf],
          [516, 0x2468ace0],
        ]);
        const reply = await world[method](
          ...(method === 'sendNativeEngine'
            ? [build.fes.nativeID, caller.id, build.queries[0].raw]
            : [fesID, caller.id, 175]),
          512,
          516,
          { payload: { store: (at, value) => values.set(at, value) } },
        );
        assert.equal(reply, NATIVE_UNWRITTEN_WORD);
        assert.deepEqual(
          [...values],
          [
            [512, 0x13579bdf],
            [516, 0x2468ace0],
          ],
        );
      }
    };
    try {
      await verifyReceiver();
      for (let i = 0; i < build.rows.length; i++) {
        const row = build.rows[i],
          label = build.cases[i].label;
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
        machine.memory.set(Buffer.from(row.beforeLocal, 'base64'));
        machine.store(4096, 0xa17a29c5);
        row.args.forEach((word, n) => machine.store(4100 + n * 4, word));
        machine.sp = 4100 + row.declaredCount * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        assert.equal(reply.control, row.control, label + ' control');
        assert.deepEqual(
          machine.memory,
          new Uint8Array(Buffer.from(row.local, 'base64')),
          label + ' full Main memory',
        );
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], label + ' ' + key);
        if (['primary-retained-value', 'primary-self-expand-control'].includes(label)) {
          const snapshot = world.snapshot(),
            state = await deserializeCheckpoint(await serializeCheckpoint(snapshot));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, {}, { initialize: false });
          await world.restore(state);
          caller = world.main;
          assert.deepEqual(world.snapshot(), snapshot, label + ' cold state');
          await verifyReceiver();
        }
      }
      await verifyReceiver();
    } finally {
      await world.close({ flushFiles: false });
    }
  });
