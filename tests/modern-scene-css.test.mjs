// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-css-golden.json', import.meta.url)),
);
for (const build of golden.builds) {
  test(`${build.version} Scene CSS direct/Script histories retain all imported padding through file owners and cold`, async () => {
    let world = await modernParticleMessageWorld(build.profile),
      caller = world.main,
      scene;
    const saved = new Map(),
      pointers = new Map();
    function storage() {
      world.storage.read = async (name) => saved.get(name)?.slice() ?? null;
      world.storage.write = async (name, bytes) => {
        saved.set(name, bytes.slice());
        return true;
      };
    }
    storage();
    function normalize(input) {
      const bytes = new Uint8Array(input),
        view = new DataView(bytes.buffer);
      for (let at = 4100; at < 4150; at += 4) {
        const word = view.getUint32(at, true);
        if (pointers.has(word)) view.setUint32(at, pointers.get(word), true);
      }
      return bytes;
    }
    async function assertHistory() {
      const data = world.runtime.handles.get(scene, 'scene-data');
      for (const side of ['seen', 'path'])
        assert.deepEqual(
          data.history.encode(side, true),
          new Uint8Array(Buffer.from(build.input[side], 'base64')),
        );
    }
    try {
      for (let i = 0; i < build.rows.length; i++) {
        const row = build.rows[i],
          label = build.labels[i];
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
        if ([238, 323, 247].includes(row.id)) {
          pointers.set(row.result, machine.load(4100));
          if (row.id === 323) scene = machine.load(4100);
        }
        assert.equal(reply.control, row.control, label + ' control');
        assert.deepEqual(
          machine.memory,
          normalize(Buffer.from(row.local, 'base64')),
          label + ' full local',
        );
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], label + ' ' + key);
        if (['direct-import-path', 'reload-direct-path'].includes(label)) {
          await assertHistory();
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, {}, { initialize: false });
          storage();
          await world.restore(state);
          caller = world.main;
          await assertHistory();
        }
        if (label === 'save-native-CSS') {
          const actual = await NativeGlobalFile.fromFile(saved.get('save0071.dat')),
            original = await NativeGlobalFile.fromFile(
              Buffer.from(build.files['save0071.dat'], 'base64'),
            );
          assert.equal(actual.tag, original.tag);
          assert.deepEqual(actual.payload(), original.payload());
          assert.deepEqual(
            saved.get('save0071.dat'),
            new Uint8Array(Buffer.from(build.files['save0071.dat'], 'base64')),
          );
        }
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.version} fresh GAME_SAVE-only load reconstructs the complete imported Scene bytes`, async () => {
    const storage = new NativeFileStorage(
        { lookup: () => null, read: async () => null },
        'modern-scene-css-' + build.version,
      ),
      file = Buffer.from(build.files['save0071.dat'], 'base64');
    await storage.prepareGameSave([
      {
        path: 'save0071.dat',
        bytes: file,
        createdMs: 1700000000000,
        accessedMs: 1700000001000,
        modifiedMs: 1700000002000,
        attributes: 0x80,
      },
    ]);
    const world = await modernParticleMessageWorld(build.profile);
    world.storage = storage;
    world.runtime.services.persistence = storage;
    try {
      const caller = world.main;
      async function run(id, args, text) {
        const machine = (caller.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, id, args.length * 4], [59]])),
          { native: (id, args, vm) => world.runtime.scheduler.native(caller, id, args, vm) },
          world.runtime.scheduler.shared,
        ));
        if (text) machine.writeString(text, 64);
        args.forEach((word, n) => machine.store(4100 + n * 4, word));
        machine.sp = 4100 + args.length * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        return machine.load(4100);
      }
      const scene = await run(323, []),
        loaded = await run(247, [64], 'save0071.dat');
      assert(loaded);
      assert.equal(await run(386, [loaded, 201, scene, 0]), 1);
      assert.equal(await run(386, [loaded, 202, scene, 1]), 1);
      const data = world.runtime.handles.get(scene, 'scene-data');
      for (const side of ['seen', 'path'])
        assert.deepEqual(
          data.history.encode(side, true),
          new Uint8Array(Buffer.from(build.input[side], 'base64')),
        );
      const current = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      assert(current.runtime);
      assert.deepEqual(await storage.read('save0071.dat'), new Uint8Array(file));
      await run(246, [loaded]);
      await run(324, [scene]);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
