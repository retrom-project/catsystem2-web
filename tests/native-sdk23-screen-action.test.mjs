// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { makeWorld } from './fixtures/fes-effect-model-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { screenEffectRawMessage } from '../src/native/screen-effect.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-screen-action.json', import.meta.url)),
  ),
  marker = 0x23532f00;
const program = kcsProgram(
  [
    [37, marker],
    [43, 76, 0],
    [38, 44],
    ...golden.rows.flatMap((r) =>
      r.frame !== null
        ? [[43, 65, 0]]
        : [
            ...r.args.map((v) => [37, v]),
            [43, r.id, r.args.length * 4],
            ...(r.resultAddress === null ? [] : [[38, r.resultAddress]]),
            [43, 65, 0],
          ],
    ),
    [37, 240],
    [43, 71, 4],
    [59],
  ],
  [[256, 'Normal Wipe frame']],
);
async function world(initialize = true) {
  const w = await makeWorld(golden.profile, initialize);
  const read = w.game.read.bind(w.game),
    require = w.game.require.bind(w.game);
  w.game.read = (name) => (name === 'normal-action.kcs' ? Promise.resolve(program) : read(name));
  w.game.require = (name) =>
    name === 'normal-action.kcs' ? Promise.resolve(program) : require(name);
  return w;
}
async function step(w, task, row) {
  if (row.frame !== null) {
    // This is the existing native Task frame entry, using the same declared
    // ordinary frame argument as the original parent update. No Task fields are set.
    w.frame = row.frame;
    w.runtime.scheduler.frame = row.frame;
    await w.objects.tick(row.frame);
  } else await w.runtime.scheduler.execute(task);
}
function state(w, task) {
  const id = w.resolveTaskID(task.machine.load(36), task.id),
    record = w.objects.objects.get(id),
    owner = record?.kind === 39 ? record.implementation : null;
  return owner && { owner, state: structuredClone(owner.state) };
}
function compare(w, task, row) {
  const current = state(w, task);
  if (!row.after) return;
  assert(current);
  assert.equal(current.state.active, row.after.active, row.label + ' activity');
  assert.equal(current.state.duration, row.after.duration, row.label + ' duration');
  if (row.after.start !== undefined) {
    assert.equal(current.state.start, row.after.start);
    assert.equal(current.state.end, row.after.end);
  }
  if (row.after.current !== undefined)
    assert.equal(current.owner.record.effectiveFrame, row.after.current);
}
test('SDK23 Main532 leaves real VM/Wipe state and resources unchanged after the normal Base frame update', async (t) => {
  const w = await world();
  t.after(() => w.close({ flushFiles: false }));
  const task = await w.spawnScript('normal-action.kcs', {
      parent: w.main.id,
      initialExecute: false,
    }),
    floor = task.machine.sp;
  for (const [index, row] of golden.rows.entries()) {
    const before = row.id === 532 ? state(w, task) : null;
    await step(w, task, row);
    assert.equal(task.machine.load(floor), marker);
    assert.equal(task.machine.sp, floor + 4);
    compare(w, task, row);
    if (row.id === 532) {
      assert.deepEqual(state(w, task).state, before.state);
      const fresh = await world(false);
      try {
        await fresh.restore(structuredClone(w.snapshot()));
        const copy = fresh.runtime.scheduler.tasks.get(task.id);
        compare(fresh, copy, row);
        for (let next = index + 1; next < golden.rows.length; next++) {
          await step(fresh, copy, golden.rows[next]);
          assert.equal(copy.machine.load(floor), marker);
          compare(fresh, copy, golden.rows[next]);
        }
        assert.equal(
          fresh.screenEffects.tasks.has(fresh.resolveTaskID(copy.machine.load(36), copy.id)),
          false,
        );
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  assert.equal(w.screenEffects.tasks.has(w.resolveTaskID(task.machine.load(36), task.id)), false);
});
test('the zero/Base shapes route normally while other receivers and raw namespaces remain protected', async (t) => {
  const w = await world();
  t.after(() => w.close({ flushFiles: false }));
  const bytes = kcsProgram(
    [
      [37, marker],
      [43, 76, 0],
      [38, 44],
      ...[0, [0x13, 44], 256].map((v) => [37, v]),
      [43, 66, 12],
      [38, 32],
      [37, 0],
      [43, 532, 4],
      [37, [0x13, 32]],
      [43, 532, 4],
      [43, 65, 0],
      [59],
    ],
    [[256, 'Base action']],
  );
  const read = w.game.read.bind(w.game);
  w.game.read = (name) => (name === 'base-action.kcs' ? Promise.resolve(bytes) : read(name));
  const task = await w.spawnScript('base-action.kcs', { parent: w.main.id, initialExecute: false }),
    floor = task.machine.sp;
  await w.runtime.scheduler.execute(task);
  assert.equal(task.machine.load(floor), marker);
  assert.equal(task.machine.sp, floor + 4);
  assert.equal(screenEffectRawMessage(golden.profile, 389, 39), 354);
  assert.equal(screenEffectRawMessage(golden.profile, 389, 0), 354);
  assert.throws(() => screenEffectRawMessage(golden.profile, 389), /Unreviewed ABI message/);
  assert.throws(() => screenEffectRawMessage(golden.profile, 389, 16), /Unreviewed ABI message/);
  const target = await w.objects.create({ kind: 15, parent: w.main.id });
  await assert.rejects(
    w.runtime.native('main', 532, [w.nativeTaskID(target)], task.machine, task),
    /receiver kind/,
  );
});
