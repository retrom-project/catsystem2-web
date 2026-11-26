// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-reader-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  test(`${build.version} implicit missing-record consumption is guarded while an unmapped destination returns zero first`, async () => {
    const world = await modernParticleMessageWorld(build.profile, {
      'startup.xml': new TextEncoder().encode(build.xml),
      'loose-scene/fixture.cst': Buffer.from(build.input.file, 'base64'),
    });
    const caller = world.main;
    async function call(id, args) {
      const machine = (caller.machine = new KCSMachine(
        await readKCS(kcsProgram([[43, id, args.length * 4], [59]])),
        {
          native: (number, words, vm) => world.runtime.scheduler.native(caller, number, words, vm),
        },
        world.runtime.scheduler.shared,
      ));
      machine.writeString('fixture', 64);
      machine.bytes(512, 64).fill(0xa5);
      args.forEach((word, index) => machine.store(4100 + index * 4, word));
      machine.sp = 4100 + args.length * 4;
      caller.status = 'ready';
      caller.io = null;
      caller.waiting = null;
      await world.runtime.scheduler.execute(caller);
      return machine;
    }
    try {
      await call(219, []);
      await call(220, [64]);
      assert.equal((await call(222, [0x40000000, 99, 99])).load(4100), 0);
      await assert.rejects(call(222, [512, 99, 99]), /no readable record/);
      assert.deepEqual(caller.machine.bytes(512, 64), new Uint8Array(64).fill(0xa5));
    } finally {
      await world.close({ flushFiles: false });
    }
  });
for (const build of golden.builds)
  for (const [label, rows, cases] of [
    ['reader/history', build.rows, build.cases],
    ['message-count marker', build.markerRows, build.markerCases],
  ])
    test(`${build.version} ${label}: typed owner full Main frames match own mounted CST and independent cold`, async () => {
      const files = {
        'startup.xml': new TextEncoder().encode(build.xml),
        'loose-scene/fixture.cst': Buffer.from(build.input.file, 'base64'),
        'loose-scene/markers.cst': Buffer.from(build.input.file, 'base64'),
      };
      let world = await modernParticleMessageWorld(build.profile, files),
        caller = world.main,
        scene;
      const pointers = new Map(),
        normalize = (input) => {
          const bytes = new Uint8Array(input),
            view = new DataView(bytes.buffer);
          for (let at = 4100; at < 4150; at += 4) {
            const word = view.getUint32(at, true);
            if (pointers.has(word)) view.setUint32(at, pointers.get(word), true);
          }
          return bytes;
        };
      const assertReader = (data, expected) => {
        if (expected.blockCount !== undefined)
          assert.equal(data.reader.blockCount, expected.blockCount);
        if (expected.body !== undefined)
          assert.deepEqual(
            data.reader.body?.bytes ?? null,
            expected.body === null ? null : new Uint8Array(Buffer.from(expected.body, 'base64')),
          );
        assert.equal(data.reader.filename, expected.filename);
        assert.equal(data.reader.fileValue, expected.fileValue);
        if (expected.body != null) {
          assert.equal(data.reader.block, expected.block);
          assert.equal(data.reader.line, expected.line);
        }
      };
      try {
        for (const row of rows) {
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
            `Main${row.id} full local`,
          );
          for (const key of ['pc', 'sp', 'fp'])
            assert.equal(machine[key], row[key], `Main${row.id} ${key}`);
          const sample = cases.find(
              (c) => c.id === row.id && c.local === row.local && c.beforeLocal === row.beforeLocal,
            ),
            expected = sample?.ownerState ?? sample?.readerState;
          if (sample)
            assertReader(
              row.id >= 220 && row.id <= 235
                ? world.runtime.sceneData(caller)
                : world.runtime.handles.get(scene, 'scene-data'),
              expected,
            );
          if (
            sample?.label === 'CP932-text' ||
            sample?.label === 'count-before-marker-type-query'
          ) {
            const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
            await world.restore(state);
            caller = world.main;
            assertReader(world.runtime.handles.get(scene, 'scene-data'), expected);
            if (sample.label === 'CP932-text')
              assert.deepEqual(caller.machine.bytes(512, 6), encodeCP932('次の行'));
          }
        }
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close({ flushFiles: false });
      }
    });
