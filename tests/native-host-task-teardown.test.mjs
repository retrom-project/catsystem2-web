// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const pointer = (at) => [0x13, at],
  call = (id, argv, out) => [
    ...argv.map((word) => [37, word]),
    [43, id, argv.length * 4],
    ...(out === undefined ? [] : [[38, out]]),
  ],
  program = kcsProgram(
    [
      ...call(66, [1, pointer(64), 128], 48),
      ...call(66, [25, pointer(48), 128], 52),
      ...call(66, [18, pointer(48), 128], 56),
      ...call(67, [pointer(52)]),
      ...call(67, [pointer(56)]),
      ...call(71, [3968], 72),
      [59],
    ],
    [[128, 'Teardown owner']],
  );

async function close(world) {
  for (const task of world.runtime.scheduler.tasks.values())
    world.runtime.scheduler.cancel(task.id, false);
  await world.close({ flushFiles: false });
}

for (const profile of ['rebellions-jp-engine-2.6.1.63', 'bokutomo-engine-2.6.1.67']) {
  const make = (initialize = true) =>
    dataWorld(profile, { 'host-teardown.kcs': program }, { initialize });
  async function pending() {
    const world = await make();
    try {
      const task = await world.spawnScript('host-teardown.kcs', {
          parent: world.main.id,
          initialExecute: false,
        }),
        floor = task.machine.sp;
      task.machine.store(64, world.nativeTaskID(task.id));
      await world.runtime.scheduler.execute(task);
      assert.equal(task.machine.sp, floor);
      const ids = Object.fromEntries(
        [
          ['top', 48],
          ['hydro', 52],
          ['raster', 56],
        ].map(([name, at]) => [name, world.resolveTaskID(task.machine.load(at), task.id)]),
      );
      const hydro = world.objects.objects.get(ids.hydro);
      assert.equal(hydro.kind, 25);
      assert.equal(hydro.destroyRequested, true);
      assert.equal(Boolean(hydro.hostDestroyRequested), false);
      await world.objects.tick(10);
      assert.equal(world.objects.objects.has(ids.hydro), true);
      assert.equal(world.objects.objects.has(ids.raster), false, 'normal Raster retirement');
      return { world, task, ids };
    } catch (error) {
      await close(world);
      throw error;
    }
  }
  test(
    profile + ' explicit host destroy upgrades a native request once, warm and cold',
    async () => {
      const { world, task, ids } = await pending(),
        fresh = await make(false);
      try {
        await fresh.restore(
          await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
        );
        for (const current of [world, fresh]) {
          const notify = current.objects.notify;
          let notifications = 0;
          current.objects.notify = function (id, ...args) {
            if (id === ids.hydro) notifications++;
            return Reflect.apply(notify, this, [id, ...args]);
          };
          try {
            assert.equal(await current.objects.destroy(ids.hydro, task.id), true);
            assert.equal(current.objects.objects.get(ids.hydro).hostDestroyRequested, true);
            assert.equal(await current.objects.destroy(ids.hydro, task.id), false);
            assert.equal(notifications, 0, 'upgrade does not resend the native request');
            if (current === world) {
              const upgraded = await make(false);
              try {
                await upgraded.restore(
                  await deserializeCheckpoint(await serializeCheckpoint(current.snapshot())),
                );
                assert.equal(upgraded.objects.objects.get(ids.hydro).hostDestroyRequested, true);
                assert.equal(await upgraded.objects.destroy(ids.hydro, task.id), false);
                await upgraded.objects.tick(11);
                assert.equal(upgraded.objects.objects.has(ids.hydro), false);
              } finally {
                await close(upgraded);
              }
            }
            await current.objects.tick(11);
            assert.equal(current.objects.objects.has(ids.hydro), false);
            assert.equal(await current.objects.destroy(ids.hydro, task.id), false);
          } finally {
            current.objects.notify = notify;
          }
          const caller = current.runtime.scheduler.tasks.get(task.id),
            created = await current.runtime.native(
              'main',
              66,
              [25, caller.machine.load(48), 128],
              caller.machine,
              caller,
            ),
            id = current.resolveTaskID(created.value, caller.id);
          assert.equal(
            await current.objects.destroy(id, caller.id),
            true,
            'fresh host positive control',
          );
          assert.equal(current.objects.objects.get(id).hostDestroyRequested, true);
          assert.equal(await current.objects.destroy(id, caller.id), false);
          await current.objects.tick(12);
          assert.equal(current.objects.objects.has(id), false);
        }
      } finally {
        await close(fresh);
        await close(world);
      }
    },
  );
  test(profile + ' parent and World teardown release a pending native-only Hydro', async () => {
    for (const mode of ['parent', 'world']) {
      const { world, task, ids } = await pending();
      try {
        if (mode === 'parent') {
          assert.equal(await world.objects.destroy(ids.top, task.id), true);
          assert.equal(await world.objects.destroy(ids.top, task.id), false);
          await world.objects.tick(11);
          assert.equal(world.objects.objects.has(ids.top), false);
          assert.equal(world.objects.objects.has(ids.hydro), false);
        } else {
          await close(world);
          assert.equal(world.objects.objects.size, 0);
        }
      } finally {
        await close(world);
      }
    }
  });
}
