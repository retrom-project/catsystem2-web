// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-localized-golden.json', import.meta.url)),
);
test('76 actual language prefixes/CSTL and four localized Main wrappers retain complete bytes and independent cold', async () => {
  const files = {
    'startup.xml': new TextEncoder().encode(golden.xml),
    'loose-scene/local.cst': Buffer.from(golden.input.cst, 'base64'),
    'loose-scene/local.cstl': Buffer.from(golden.input.cstl, 'base64'),
    ...Object.fromEntries(
      Object.entries(golden.input.variants).flatMap(([name, bytes]) => [
        ['loose-scene/' + name + '.cst', Buffer.from(golden.input.cst, 'base64')],
        ['loose-scene/' + name + '.cstl', Buffer.from(bytes, 'base64')],
      ]),
    ),
  };
  let world = await modernParticleMessageWorld(golden.profile, files, {
      sceneLanguages: golden.languages,
    }),
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
  try {
    for (let i = 0; i < golden.rows.length; i++) {
      const row = golden.rows[i],
        label = golden.labels[i];
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
      if (row.id === 323) {
        scene = machine.load(4100);
        pointers.set(row.result, scene);
      }
      assert.equal(reply.control, row.control, label + ' control');
      assert.deepEqual(
        machine.memory,
        normalize(Buffer.from(row.local, 'base64')),
        label + ' full Main memory',
      );
      for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row[key], label + ' ' + key);
      if (
        [
          'localized-first-message-cn',
          'unknown-language-UTF8-fallback',
          'implicit-localized-first-message',
          'extra-registered-en-message',
          'empty-registered-en-message',
        ].includes(label)
      ) {
        const data =
            row.id === 1035
              ? world.runtime.sceneData(caller)
              : world.runtime.handles.get(scene, 'scene-data'),
          expected = data.snapshot(),
          memory = machine.memory.slice();
        assert.deepEqual(data.reader.languages, golden.languages);
        for (const prefix of Object.keys(data.reader.translations))
          assert(golden.languages.includes(prefix));
        const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        world = await modernParticleMessageWorld(golden.profile, files, {
          initialize: false,
          sceneLanguages: golden.languages,
        });
        await world.restore(state);
        caller = world.main;
        assert.deepEqual(
          (row.id === 1035
            ? world.runtime.sceneData(caller)
            : world.runtime.handles.get(scene, 'scene-data')
          ).snapshot(),
          expected,
        );
        assert.deepEqual(caller.machine.memory, memory);
      }
    }
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close({ flushFiles: false });
  }
});
