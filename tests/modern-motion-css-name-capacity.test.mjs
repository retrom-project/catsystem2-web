// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(
    new URL('./fixtures/modern-motion-css-name-capacity-golden.json', import.meta.url),
  ),
);
const inputFiles = (build) =>
  Object.fromEntries(
    build.cases.map((c) => ['loose/' + c.name, Buffer.from(build.program, 'base64')]),
  );
for (const build of golden.builds) {
  test(`${build.version} complete Main frames and the last legal filename unit match original CSS with no unknown name padding`, async () => {
    const world = await modernParticleMessageWorld(build.profile, inputFiles(build)),
      caller = world.main,
      pointers = new Map();
    world.game.nativeSearch.register('mot', 'loose');
    const normalize = (input) => {
      const bytes = new Uint8Array(input),
        view = new DataView(bytes.buffer);
      for (let at = 4100; at < 4140; at += 4) {
        const value = view.getUint32(at, true);
        if (pointers.has(value)) view.setUint32(at, pointers.get(value), true);
      }
      return bytes;
    };
    let captures = 0;
    try {
      for (const row of build.rows) {
        const m = (caller.machine = new KCSMachine(
          await readKCS(
            kcsProgram([
              [43, row.id, row.args.length * 4],
              ...Array.from({ length: 22 }, () => [59]),
            ]),
          ),
          {
            native: (id, args, machine) =>
              world.runtime.scheduler.native(caller, id, args, machine),
          },
          world.runtime.scheduler.shared,
        ));
        m.memory.set(normalize(Buffer.from(row.beforeLocal, 'base64')));
        m.store(4096, 0xa17a29c5);
        row.args.forEach((value, i) => m.store(4100 + i * 4, pointers.get(value) ?? value));
        m.sp = 4100 + row.args.length * 4;
        caller.status = 'ready';
        caller.io = null;
        await world.runtime.scheduler.execute(caller);
        if ([294, 315].includes(row.id)) pointers.set(row.result, m.load(4100));
        assert.deepEqual(
          m.memory,
          normalize(Buffer.from(row.local, 'base64')),
          `Main${row.id} complete locals`,
        );
        for (const key of ['pc', 'sp', 'fp']) assert.equal(m[key], row[key]);
        if (row.id === 315)
          assert.deepEqual(
            world.runtime.handles.get(m.load(4100), 'motion-checkpoint').bytes,
            new Uint8Array(Buffer.from(build.cases[captures++].envelope, 'base64')),
          );
      }
      assert.equal(captures, 3);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.version} original full-width CSS names pass actual file load/388 and remain exact after independent cold`, async () => {
    for (const input of build.cases) {
      const container = new NativeGlobalFile();
      container.write(7, Buffer.from(input.envelope, 'base64'));
      const fileBytes = await container.file(),
        files = inputFiles(build);
      let world = await modernParticleMessageWorld(build.profile, files),
        caller = world.main;
      const bindStorage = () => {
        world.game.nativeSearch.register('mot', 'loose');
        world.storage.read = async (name) => (name === 'names.css' ? fileBytes : null);
      };
      bindStorage();
      async function call(id, args) {
        const m = (caller.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, id, args.length * 4], [59]])),
          {
            native: (number, words, machine) =>
              world.runtime.scheduler.native(caller, number, words, machine),
          },
          world.runtime.scheduler.shared,
        ));
        m.writeString('names.css', 64);
        args.forEach((word, i) => m.store(4100 + i * 4, word));
        m.sp = 4100 + args.length * 4;
        caller.status = 'ready';
        caller.io = null;
        await world.runtime.scheduler.execute(caller);
        return m.load(4100);
      }
      try {
        const file = await call(247, [64]),
          manager = await call(294, []),
          copied = await call(388, [file, 7, manager, 0]);
        assert(file && manager && copied);
        assert.deepEqual(
          world.runtime.handles.get(copied, 'motion-checkpoint').bytes,
          new Uint8Array(Buffer.from(input.envelope, 'base64')),
        );
        await call(317, [copied]);
        await call(246, [file]);
        const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
        bindStorage();
        await world.restore(state);
        caller = world.main;
        const capture = await call(315, [manager, 0]);
        assert.deepEqual(
          world.runtime.handles.get(capture, 'motion-checkpoint').bytes,
          new Uint8Array(Buffer.from(input.envelope, 'base64')),
        );
        await call(317, [capture]);
        await call(295, [manager]);
      } finally {
        await world.close({ flushFiles: false });
      }
    }
  });
}
