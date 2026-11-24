// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCSMachine, floatBits, readKCS } from '../src/kcs.mjs';
import { identity } from '../src/motion/matrix.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { screenEffectRawMessage } from '../src/native/screen-effect.mjs';
import { makeWorld } from './fixtures/fes-effect-model-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const matrixAddress = 208;
const canary = 0x963f2ba1;

async function worldCall(world, id, args, prepare = () => {}) {
  const program = kcsProgram([
    [37, canary],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const task = { ...world.main, io: null };
  const machine = (task.machine = new KCSMachine(await readKCS(program), {
    native: (number, supplied, caller) =>
      world.runtime.scheduler.native(task, number, supplied, caller),
  }));
  prepare(machine);
  const floor = machine.sp;
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.pop(), canary);
  return machine;
}

test('fixed 2.6.1.23 screen-effect GCALLs initialize the original matrix and rectangle packet owners', async () => {
  for (const [raw, canonical] of [
    [342, 377],
    [343, 378],
    [344, 379],
    [345, 380],
    [346, 381],
  ]) {
    assert.equal(screenEffectRawMessage(profile, canonical), raw);
    assert.equal(mapABIMessage(profile, 'screen', 'canonical', raw), canonical);
  }
  assert.throws(() => screenEffectRawMessage(profile, 382), /Unreviewed ABI message/);
  const world = await makeWorld(profile);
  try {
    const { screen, fields } = world.configuration;
    Object.assign(screen, { width: 16, height: 16, currentWidth: 24, currentHeight: 12 });
    const create = async (kind) => {
      const globalID = await world.objects.create({ kind, parent: world.main.id });
      return {
        target: world.nativeTaskID(globalID),
        owner: world.screenEffects.tasks.get(globalID),
      };
    };
    const matrix = await create(35),
      rectangle = await create(36);
    assert.ok(matrix.owner.state.capability);
    assert.ok(rectangle.owner.state.capability);
    const words = identity().map(floatBits);
    words[7] = 0x7f801234;
    const parameters = [
      0xff812345,
      ...[18.5, 3.125].map(floatBits),
      0xf1807033,
      ...[9, 800].map(floatBits),
    ];
    const m = await worldCall(
      world,
      521,
      [matrix.target, matrixAddress, ...parameters],
      (machine) => {
        machine.store(matrixAddress - 4, canary);
        words.forEach((word, index) => machine.store(matrixAddress + index * 4, word));
        machine.store(matrixAddress + 64, canary);
      },
    );
    assert.deepEqual(matrix.owner.state.params, [...words, 0xffc12345, ...parameters.slice(1)]);
    assert.equal(m.load(matrixAddress - 4), canary);
    assert.equal(m.load(matrixAddress + 28), 0x7f801234);
    assert.equal(m.load(matrixAddress + 64), canary);
    assert.deepEqual([matrix.owner.state.minimum, matrix.owner.state.maximum], [9, 800]);
    matrix.owner.state.firstFrame = false;
    await worldCall(world, 522, [matrix.target, 17]);
    assert.equal(matrix.owner.state.active, 17);
    assert.equal(matrix.owner.state.firstFrame, true);
    await worldCall(world, 522, [matrix.target, 0]);
    assert.equal(matrix.owner.state.active, 0);
    await worldCall(world, 521, [0, 0xffffffff, ...parameters]);
    await assert.rejects(
      worldCall(world, 521, [matrix.target, 0xffffffff, ...parameters]),
      /KCS memory ffffffff/,
    );
    await assert.rejects(worldCall(world, 522, [matrix.target]), /expects 2 arguments/);
    const rectangleWords = [...[4, 8, 10, 12, 2, 1.5, 28, 300].map(floatBits), 0xf0403020];
    await worldCall(world, 523, [rectangle.target, ...rectangleWords]);
    const geometry = rectangle.owner.state.geometry;
    assert.deepEqual(rectangle.owner.state.params, rectangleWords);
    assert.deepEqual([rectangle.owner.state.minimum, rectangle.owner.state.maximum], [28, 300]);
    assert.deepEqual(
      geometry[0].vertices.map(({ x, y, color }) => [x, y, color]),
      [
        [5.5, 5.5, 0xf0403020],
        [20.5, 5.5, 0xf0403020],
        [5.5, 14.5, 0xf0403020],
        [20.5, 14.5, 0xf0403020],
      ],
    );
    await worldCall(world, 524, [rectangle.target, 29]);
    assert.equal(rectangle.owner.state.active, 29);
    await worldCall(world, 523, [
      rectangle.target,
      ...rectangleWords.map((word, index) => (index === 6 ? floatBits(128) : word)),
    ]);
    assert.equal(rectangle.owner.state.minimum, 128);
    assert.equal(rectangle.owner.state.geometry, geometry);
    fields.general.renderTargetCount = 0;
    const disabled = await create(35);
    const prior = disabled.owner.state.params.slice();
    assert.equal(disabled.owner.state.capability, false);
    await worldCall(world, 522, [disabled.target, 99]);
    assert.equal(disabled.owner.state.active, 0);
    assert.deepEqual(disabled.owner.state.params, prior);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 mosaic and break starts preserve stopped receiver clocks', async () => {
  const world = await makeWorld(profile);
  try {
    for (const [kind, id, canonical, raw] of [
      [50, 855, 518, 449],
      [51, 857, 520, 451],
      [52, 861, 522, 453],
    ]) {
      assert.equal(screenEffectRawMessage(profile, canonical), raw);
      assert.equal(mapABIMessage(profile, 'screen', 'canonical', raw), canonical);
      const objectID = await world.objects.create({ kind, parent: world.main.id }),
        target = world.nativeTaskID(objectID),
        task = world.screenEffects.tasks.get(objectID),
        { state, record } = task,
        status = () => world.sendNativeEngine(target, world.main.id, 377);
      assert.equal(state.capability, true);
      Object.assign(state, { duration: 24, start: 2, end: 19, lastElapsed: 15, lastKey: 27 });
      Object.assign(record, { effectiveFrame: 3, pausedFrames: 12 });

      await worldCall(world, id, [0, 0x80000001]);
      assert.equal(await status(), 0);
      await worldCall(world, id, [target, 0x80000001]);
      assert.equal(await status(), 0x80000001);
      assert.deepEqual([state.start, state.end, state.lastElapsed], [0xfffffff7, 15, 0]);

      Object.assign(state, { lastElapsed: 11, lastKey: 19 });
      record.effectiveFrame = 40;
      await worldCall(world, id, [target, 0]);
      assert.equal(await status(), 0);
      assert.deepEqual([state.start, state.end, state.lastElapsed], [0xfffffff7, 15, 11]);
      if (kind !== 52) assert.equal(state.lastKey, 0xffffffff);

      state.capability = false;
      const before = structuredClone(state);
      await worldCall(world, id, [target, 17]);
      assert.deepEqual(state, before);
      await assert.rejects(worldCall(world, id, [target]), /expects 2 arguments/);
      state.capability = true;
      await world.objects.release(objectID);
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});
