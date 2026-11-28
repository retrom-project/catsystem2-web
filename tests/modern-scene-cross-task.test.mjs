// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-cross-task-golden.json', import.meta.url)),
);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const prefix = (bytes) => bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0));
const historyState = (history) =>
  Object.fromEntries(
    ['seen', 'path'].map((side) => [
      side,
      history[side].map((entry) => ({
        nameBytes: b64(prefix(entry.nameBytes ?? encodeCP932(entry.scene))),
        value: entry.value,
        strings: entry.strings?.length
          ? entry.strings.map(([key, value]) => [key, b64(prefix(value))])
          : null,
      })),
    ]),
  );
for (const build of golden.builds) {
  test(`${build.version} raw Script Scene query stays in its own receiver namespace`, async () => {
    const world = await modernParticleMessageWorld(build.profile, {
        'init-scene.kcs': kcsProgram([[43, 219, 0], [59]]),
      }),
      sender = world.main;
    try {
      const source = await world.objects.create({ kind: 12, nativeID: 73, parent: world.root }),
        target = world.objects.objects.get(source),
        raw = build.queries[0].raw;
      for (const method of ['sendNativeEngine', 'sendEngine']) {
        const values = new Map([
            [512, 0x13579bdf],
            [516, 0x2468ace0],
          ]),
          reply = await world[method](
            ...(method === 'sendNativeEngine' ? [73, sender.id, raw] : [source, sender.id, 175]),
            512,
            516,
            { payload: { store: (at, value) => values.set(at, value) } },
          );
        assert.equal(reply, NATIVE_UNWRITTEN_WORD);
        assert.deepEqual(
          [...values],
          [
            [512, 0],
            [516, 0],
          ],
        );
      }
      await target.implementation.loadScript('init-scene.kcs');
      await world.runtime.scheduler.execute(world.runtime.scheduler.tasks.get(source));
      const values = new Map([
        [512, 0x13579bdf],
        [516, 0x2468ace0],
      ]);
      await assert.rejects(
        world.sendNativeEngine(73, sender.id, raw, 512, 516, {
          payload: { store: (at, value) => values.set(at, value) },
        }),
        /Physical CST reader\/history pointers/,
      );
      await assert.rejects(
        world.sendEngine(source, sender.id, 175, 512, 516, {
          payload: { store: (at, value) => values.set(at, value) },
        }),
        /Physical CST reader\/history pointers/,
      );
      assert.deepEqual(
        [...values],
        [
          [512, 0x13579bdf],
          [516, 0x2468ace0],
        ],
      );
      assert.deepEqual(target.scriptMessages, []);
      if (build.version === '74') {
        assert.equal(mapABIMessage(build.profile, 'taskQueries', 'canonical', 175, 12), 173);
        assert.equal(mapABIMessage(build.profile, 'taskQueries', 'raw', 173, 12), 175);
        assert.equal(mapABIMessage(build.profile, 'taskQueries', 'raw', 173, 13), 173);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.version} typed Script histories copy and expand across Task owners, without source interpreters, through cold`, async () => {
    let world = await modernParticleMessageWorld(build.profile);
    const actors = {};
    const restoreActors = () => {
      for (const [name, a] of Object.entries(build.actors))
        actors[name] = [...world.objects.objects.values()].find(
          (record) => record.nativeID === a.nativeID,
        );
    };
    try {
      for (const [name, a] of Object.entries(build.actors)) {
        if (name === 'primary') {
          actors[name] = world.objects.objects.get(world.main.id);
          assert.equal(actors[name].nativeID, a.nativeID);
        } else {
          const id = await world.objects.create({
            kind: 12,
            nativeID: a.nativeID,
            parent: world.root,
          });
          actors[name] = world.objects.objects.get(id);
        }
      }
      const verify = (sample) => {
        for (const [name, expected] of Object.entries(sample.history)) {
          const data = world.runtime.sceneData(actors[name]);
          assert.deepEqual(
            data ? historyState(data.history) : null,
            expected,
            `${sample.label} ${name}`,
          );
        }
      };
      for (let i = 0; i < build.rows.length; i++) {
        const row = build.rows[i],
          sample = build.cases[i],
          record = actors[sample.actor];
        let reply;
        await record.implementation.loadScript('main.kcs');
        const caller = world.runtime.scheduler.tasks.get(record.id);
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
        assert.equal(reply.control, row.control, `${sample.label} control`);
        assert.deepEqual(
          machine.memory,
          new Uint8Array(Buffer.from(row.local, 'base64')),
          `${sample.label} full local`,
        );
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], `${sample.label} ${key}`);
        if (sample.actor !== 'primary') {
          await record.implementation.loadScript('absent.kcs', { nativeLoad: true });
          assert.equal(world.runtime.scheduler.tasks.has(record.id), false);
        }
        verify(sample);
        if (
          ['copied-first-string', 'copy-not-live-alias', 'repopulated-get'].includes(sample.label)
        ) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, {}, { initialize: false });
          await world.restore(state);
          restoreActors();
          verify(sample);
          for (const name of ['source', 'empty'])
            assert.equal(world.runtime.scheduler.tasks.has(actors[name].id), false);
        }
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
