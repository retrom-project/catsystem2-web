// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { floatBits } from '../src/kcs.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-motion-owner-lifetime-golden.json', import.meta.url)),
  ),
  files = {
    'creator.kcs': kcsProgram([[43, 294, 0], [38, [0x13, 64]], [37, 240], [43, 71, 4], [59]]),
    'borrower.kcs': kcsProgram([[37, [0x13, 80]], [43, 311, 4], [38, [0x13, 64]], [59]]),
    'delete.kcs': kcsProgram([[37, [0x13, 80]], [43, 295, 4], [59]]),
  };
async function invoke(world, name, handle) {
  const task = await world.spawnScript(name);
  task.machine.store(80, handle);
  try {
    await world.runtime.scheduler.execute(task);
    return { value: task.machine.load(64), sp: task.machine.sp, floor: task.machine.floor };
  } finally {
    await world.objects.release(task.id);
  }
}
for (const build of golden.builds)
  test(`${build.version} explicit MOT managers outlive their creator and cold restore without that Task`, async () => {
    const world = await modernParticleMessageWorld(build.profile, files);
    let fresh;
    try {
      const creator = await world.spawnScript('creator.kcs');
      await world.runtime.scheduler.execute(creator);
      const handle = creator.machine.load(64),
        manager = await world.runtime.services.motion.get(handle);
      assert.deepEqual(manager.base, new Uint8Array(Buffer.from(build.base, 'base64')));
      const retained = manager.snapshot();
      assert.equal(manager.nextHandle, build.nextHandle);
      assert.equal(floatBits(manager.speed), build.speedWord);
      assert.equal(manager.flags, build.flags);
      assert.equal((await invoke(world, 'borrower.kcs', handle)).value, build.otherScriptQuery);
      await world.objects.release(creator.id);
      assert.equal(world.objects.objects.has(creator.id), false);
      assert.equal(world.runtime.scheduler.tasks.has(creator.id), false);
      assert.equal((await invoke(world, 'borrower.kcs', handle)).value, build.otherScriptQuery);
      assert.deepEqual(manager.snapshot(), retained);
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      await fresh.restore(state);
      assert.equal(fresh.objects.objects.has(creator.id), false);
      assert.equal(fresh.runtime.scheduler.tasks.has(creator.id), false);
      assert.equal((await invoke(fresh, 'borrower.kcs', handle)).value, build.otherScriptQuery);
      assert.deepEqual(
        (await fresh.runtime.services.motion.get(handle)).snapshot(),
        manager.snapshot(),
      );
      const deleted = await invoke(fresh, 'delete.kcs', handle);
      assert.equal(deleted.sp, deleted.floor);
      await assert.rejects(
        invoke(fresh, 'borrower.kcs', handle),
        /Invalid or released native motion-manager/,
      );
      const survivor = await fresh.spawnScript('creator.kcs');
      await fresh.runtime.scheduler.execute(survivor);
      const survivorHandle = survivor.machine.load(64);
      await fresh.objects.release(survivor.id);
      assert(fresh.runtime.handles.records.has(survivorHandle));
      await fresh.close({ flushFiles: false });
      assert.equal(fresh.runtime.handles.records.size, 0);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
      assert.equal(world.runtime.handles.records.size, 0);
    }
  });
