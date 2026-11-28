// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-bitmap-draw-golden.json', import.meta.url)),
);
const code = Uint8Array.from(Buffer.from(golden.program, 'base64'));
const files = {
  'bitmapdraw.kcs': code,
  ...Object.fromEntries(
    Object.entries(golden.files).map(([name, bytes]) => [
      name,
      Uint8Array.from(Buffer.from(bytes, 'base64')),
    ]),
  ),
};
async function compare(world, task, expected) {
  const m = task.machine,
    label = expected.label;
  assert.deepEqual(
    Array.from({ length: 28 }, (_, i) => m.load(512 + i * 4)),
    expected.outputs,
    label + ' mapped outputs',
  );
  for (const { slot, bitmap: e } of expected.bitmaps) {
    const bitmap = world.graphics.images.get(m.load(slot)),
      state = bitmap.state;
    assert.deepEqual(
      [bitmap.width, bitmap.height, state.bpp],
      [e.width, e.height, e.bpp],
      label + ' geometry',
    );
    const metadata = Object.fromEntries(Object.keys(e.metadata).map((k) => [k, state[k] ?? 0]));
    assert.deepEqual(metadata, e.metadata, label + ' metadata');
    assert.deepEqual(
      Buffer.from(await bitmap.pixels()).toString('base64'),
      e.rgba,
      label + ' all CPU pixels',
    );
  }
  if (expected.sourceRecords) {
    for (let i = 0; i < expected.sourceRecords.length; i++) {
      const actual = m.load(768 + i * 4),
        value = expected.sourceRecords[i];
      if (i % 18 === 1 && expected.sourceRecords[i - 1] && value) {
        assert.equal(
          world.runtime.handles.records.get(actual)?.type,
          expected.sourceRecords[i - 1] === 1 ? 'bitmap' : 'render-source',
          label + ' typed array source',
        );
      } else assert.equal(actual, value, label + ' source array word ' + i);
    }
    assert.deepEqual(
      Array.from({ length: 10 }, (_, i) => m.load(928 + i * 4)),
      expected.sourceMetadata,
      label + ' source metadata',
    );
  }
}
for (const own of golden.versions) {
  for (const coldAfter of [null, 1, 3, 6, 8]) {
    test(`${own.version} ordinary bitmap/Draw consumers ${coldAfter === null ? 'normal' : 'fresh cold after phase ' + coldAfter}`, async (t) => {
      const initial = await dataWorld(own.profile, files);
      t.after(() => initial.close({ flushFiles: false }));
      initial.graphics.createLogicalDevice();
      let world = initial,
        task = await world.spawnScript('bitmapdraw.kcs', {
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
      for (let phase = 0; phase < own.rows.length; phase++) {
        controls.length = 0;
        task.machine.idle();
        await world.runtime.scheduler.execute(task);
        assert.deepEqual(
          controls,
          own.calls.filter((r) => r.phase === phase).map(({ id, control }) => ({ id, control })),
          own.rows[phase].label + ' exact GCALL controls',
        );
        await compare(world, task, own.rows[phase]);
        if (phase === coldAfter) {
          const snapshot = structuredClone(world.snapshot()),
            id = task.id;
          const fresh = await dataWorld(
            own.profile,
            phase === 8 ? { 'bitmapdraw.kcs': code } : files,
            { initialize: false },
          );
          t.after(() => fresh.close({ flushFiles: false }));
          await fresh.restore(snapshot);
          await compare(fresh, fresh.runtime.scheduler.tasks.get(id), own.rows[phase]);
          await world.close({ flushFiles: false });
          world = fresh;
          task = world.runtime.scheduler.tasks.get(id);
          observe(world);
        }
      }
      assert.equal(task.machine.halted, true);
      const draw = world.objects.objects.get(world.resolveTaskID(task.machine.load(64), task.id));
      assert.equal(draw.destroyRequested, true);
      await world.objects.release(draw.id);
      assert.equal(world.graphics.drawTasks.has(draw.id), false);
      assert.equal(world.retainedDraw.items.size, 0);
    });
  }
}

for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
]) {
  test(`${profile} separated dirty updates preserve the middle translucent consumer through cold`, async (t) => {
    // Main65's suspend shape is not qualified for63. Use the already accepted
    // four-word Script message/wait boundary for this cross-build consumer.
    const files = {
      'dirty.kcs': kcsProgram(
        golden.dirtyRegionControl.phases
          .flatMap((phase) => [
            ...phase.calls.flatMap((c) => [
              ...c.args.map((a) => [37, a]),
              [43, c.id, c.args.length * 4],
              ...(c.out === null ? [] : [[38, c.out]]),
            ]),
            [37, 1536],
            [43, 71, 4],
            [38, 1528],
          ])
          .concat([[59]]),
        [[1088, 'dirty rectangle ownership']],
      ),
    };
    const world = await dataWorld(profile, files);
    t.after(() => world.close({ flushFiles: false }));
    world.graphics.createLogicalDevice();
    const task = await world.spawnScript('dirty.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    world.runtime.variableBank(task).initialize(2048);
    await world.runtime.scheduler.execute(task);
    const snapshot = structuredClone(world.snapshot()),
      fresh = await dataWorld(profile, files, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(snapshot);
    for (const w of [world, fresh]) {
      const script = w.runtime.scheduler.tasks.get(task.id),
        bitmap = w.graphics.images.get(script.machine.load(80));
      const before = await bitmap.pixels();
      if (golden.versions.some((v) => v.profile === profile))
        assert.equal(Buffer.from(before).toString('base64'), golden.dirtyRegionControl.rgba[0]);
      await w.runtime.native(
        'main',
        69,
        [w.nativeTaskID(script.id), 1536, 0, 0],
        script.machine,
        script,
      );
      const after = await bitmap.pixels();
      assert.deepEqual([...after.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4)], [49, 117, 155, 128]);
      if (golden.versions.some((v) => v.profile === profile))
        assert.equal(Buffer.from(after).toString('base64'), golden.dirtyRegionControl.rgba[1]);
    }
  });
}
