// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-effect-consumers-golden.json', import.meta.url)),
);
const files = { 'effects.kcs': Uint8Array.from(Buffer.from(golden.program, 'base64')) };
for (const own of golden.versions)
  for (const cold of [false, true]) {
    test(`${own.version} typed effect init/start/query and empty capture resources ${cold ? 'fresh cold' : 'normal'}`, async (t) => {
      const initial = await dataWorld(own.profile, files);
      t.after(() => initial.close({ flushFiles: false }));
      initial.graphics.view.configure({
        clientWidth: 64,
        clientHeight: 64,
        drawingRectangle: [0, 0, 64, 64],
      });
      initial.graphics.createLogicalDevice();
      let world = initial,
        task = await world.spawnScript('effects.kcs', {
          parent: world.main.id,
          initialExecute: false,
        });
      world.runtime.variableBank(task).initialize(2048);
      const controls = [];
      const observe = (w) => {
        const dispatch = w.runtime.scheduler.dispatch;
        w.runtime.scheduler.dispatch = async (table, id, args, machine, caller, ...rest) => {
          const reply = await dispatch(table, id, args, machine, caller, ...rest);
          if (caller === task) controls.push({ id, control: reply.control });
          return reply;
        };
      };
      observe(world);
      for (const expected of own.rows) {
        controls.length = 0;
        task.machine.idle();
        await world.runtime.scheduler.execute(task);
        assert.deepEqual(controls, expected.controls, expected.label + ' original controls');
        assert.deepEqual(
          Array.from({ length: 28 }, (_, i) => task.machine.load(512 + i * 4)),
          expected.outputs,
          expected.label + ' original active queries',
        );
        if (expected.index < 3) {
          const id = world.resolveTaskID(task.machine.load(68), task.id),
            effect = world.screenEffects.tasks.get(id);
          assert.equal(effect.record.kind, 35 + expected.index);
          assert.equal(effect.state.active, 1);
          assert.equal(effect.state.capability, true);
          assert.equal(effect.state.initialized, true);
        }
        for (const id of world.screenEffects.rendering.captures) {
          const surface = world.stageRenderer.surfaces.get(id);
          assert.deepEqual([surface.width, surface.height], [64, 64]);
        }
        if (cold && expected.index === 1) {
          const saved = structuredClone(world.snapshot()),
            id = task.id,
            fresh = await dataWorld(own.profile, files, { initialize: false });
          t.after(() => fresh.close({ flushFiles: false }));
          await fresh.restore(saved);
          await world.close({ flushFiles: false });
          world = fresh;
          task = world.runtime.scheduler.tasks.get(id);
          observe(world);
          assert.deepEqual(
            Array.from({ length: 28 }, (_, i) => task.machine.load(512 + i * 4)),
            expected.outputs,
          );
        }
        if (expected.index + 1 < own.rows.length) {
          const reply = await world.runtime.native(
            'main',
            69,
            [world.nativeTaskID(task.id), 1536, 0, 0],
            task.machine,
            task,
          );
          assert.equal(reply.control, 1);
        }
      }
      assert.equal(task.machine.halted, true);
      for (const effect of [...world.screenEffects.tasks.values()]) {
        assert.equal(effect.record.destroyRequested, true);
        await world.objects.release(effect.record.id);
      }
      assert.equal(world.screenEffects.tasks.size, 0);
      await world.screenEffects.close();
      assert.equal(world.screenEffects.rendering.captures.length, 0);
    });
  }
