// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-motion-filename-alias-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  test(`${build.version} Main CSS and independent cold preserve the native filename alias`, async () => {
    const files = { 'loose/ⅰ.kcs': Buffer.from(build.program, 'base64') };
    let world = await modernParticleMessageWorld(build.profile, files),
      caller = world.main;
    const pointers = new Map();
    // The only native process addresses in these frames are the manager and
    // capture handles in their retained argument/result cells.
    const normalize = (input) => {
      const bytes = new Uint8Array(input),
        view = new DataView(bytes.buffer);
      for (let at = 4100; at < 4140; at += 4) {
        const value = view.getUint32(at, true);
        if (pointers.has(value)) view.setUint32(at, pointers.get(value), true);
      }
      return bytes;
    };
    async function call(row) {
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
      m.pc = 0;
      m.sp = 4100 + row.args.length * 4;
      caller.status = 'ready';
      caller.io = null;
      await world.runtime.scheduler.execute(caller);
      const result = [294, 315].includes(row.id) ? m.load(4100) : row.result;
      if ([294, 315].includes(row.id)) pointers.set(row.result, result);
      assert.deepEqual(
        m.memory,
        normalize(Buffer.from(row.local, 'base64')),
        `Main${row.id} locals`,
      );
      for (const key of ['pc', 'sp', 'fp']) assert.equal(m[key], row[key], `Main${row.id} ${key}`);
      return result;
    }
    try {
      // The original mounts the mot namespace onto loose without an archive.
      world.game.nativeSearch.register('mot', 'loose');
      assert.notDeepEqual(
        Buffer.from(encodeCP932('ⅰ')),
        Buffer.from(build.name, 'base64').subarray(0, 2),
      );
      const managerID = await call(build.rows[0]);
      await call(build.rows[1]);
      const captureID = await call(build.rows[2]);
      const compare = (bytes) => {
        const actual = bytes.slice(),
          expected = Buffer.from(build.envelope, 'base64');
        const step = build.version === '76' ? 2 : 1,
          width = step * 32;
        let end = 12;
        while (expected[end] || (step === 2 && expected[end + 1])) end += step;
        // strcpy writes through NUL, without initializing the native padding.
        actual.fill(0, end + step, 12 + width);
        expected.fill(0, end + step, 12 + width);
        assert.deepEqual(actual, new Uint8Array(expected));
      };
      compare(world.runtime.handles.get(captureID, 'motion-checkpoint').bytes);
      const snapshot = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      world.game.nativeSearch.register('mot', 'loose');
      await world.restore(snapshot);
      caller = world.main;
      const manager = await world.runtime.services.motion.get(managerID);
      compare(world.runtime.services.motion.capture(managerID, 0));
      // Native CSS reload must pass the raw narrow record name to the loader.
      const bytes = world.runtime.handles.get(captureID, 'motion-checkpoint').bytes;
      manager.clear();
      await world.runtime.services.motion.restoreRecords(managerID, bytes, 0);
      compare(world.runtime.services.motion.capture(managerID, 0));
      await call(build.rows[3]);
      await call(build.rows[4]);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
