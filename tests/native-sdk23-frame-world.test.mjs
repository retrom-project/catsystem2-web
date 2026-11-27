// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  program = kcsProgram([[43, 5, 0], [38, 4], [43, 65, 0], [43, 5, 0], [38, 8], [43, 65, 0], [59]]);

async function make(now, initialize = true) {
  return dataWorld(profile, { 'case.kcs': program }, { frameSource: { now }, initialize });
}
async function dispatch(world) {
  const result = await world.resumeHostFrameWait(world.beginHostFrameWait());
  if (result) world.completeHostFrame();
  return result;
}

test('observed SDK23 World advances six Frame units with one Script update and one raw step', async () => {
  let timer = 0;
  const world = await make(() => timer);
  try {
    const record = world.objects.objects.get(world.main.id),
      machine = world.main.machine;
    assert.equal(world.frame, 0);
    assert.equal(record.scriptUpdateAccumulator, 0);
    timer = 17;
    assert.equal(await dispatch(world), true);
    assert.equal(machine.load(4), 1);
    assert.equal(record.scriptEnabled, 1);
    assert.equal(record.scriptUpdateAccumulator, 0);
    timer = 100;
    assert.equal(await dispatch(world), true);
    assert.equal(world.frame, 6);
    assert.equal(world.clock.now(), 100);
    assert.equal(machine.load(8), 6);
    assert.equal(record.scriptUpdateAccumulator, 1);
    assert.equal(record.scriptEnabled, 1);
    timer = 117;
    await dispatch(world);
    assert.equal(record.scriptUpdateAccumulator, 2);
    assert.equal(record.scriptEnabled, 0);
    timer = 134;
    await dispatch(world);
    assert.equal(record.scriptUpdateAccumulator, 2);
  } finally {
    await world.close();
  }
});

test('same-bucket waits do not update or consume the caller, and presentation settles the packet', async () => {
  let timer = 0;
  const world = await make(() => timer);
  try {
    const pc = world.main.machine.pc;
    timer = 8;
    assert.equal(await dispatch(world), false);
    assert.equal(world.frame, 0);
    assert.equal(world.main.machine.pc, pc);
    timer = 17;
    assert.equal(await world.resumeHostFrameWait(world.beginHostFrameWait()), true);
    assert.throws(() => world.snapshot(), /pacing presentation/);
    assert.throws(() => world.beginHostFrameWait(), /single active/);
    await assert.rejects(world.tick(), /observed pacing dispatch/);
    world.completeHostFrame();
    assert(world.snapshot().framePacer);
    assert.equal(nativeABI(profile).tables.main.entries[442].status, 'recovered');
    assert.equal(nativeABI(profile).tables.main.entries[443].status, 'recovered');
  } finally {
    await world.close();
  }
});

test('independent World cold preserves VM continuation, accumulator and the saved timer phase', async () => {
  let timer = 0,
    otherTimer = 1000;
  const first = await make(() => timer),
    second = await make(() => otherTimer, false);
  try {
    timer = 17;
    await dispatch(first);
    timer = 25;
    const saved = await deserializeCheckpoint(await serializeCheckpoint(first.snapshot()));
    await second.restore(saved);
    const a = first.objects.objects.get(first.main.id),
      b = second.objects.objects.get(second.main.id);
    assert.notEqual(first.main.machine.memory.buffer, second.main.machine.memory.buffer);
    timer = 34;
    otherTimer = 1009;
    await dispatch(first);
    await dispatch(second);
    assert.equal(second.main.machine.load(8), first.main.machine.load(8));
    assert.equal(b.scriptUpdateAccumulator, a.scriptUpdateAccumulator);
    assert.deepEqual(second.framePacer.snapshot(), first.framePacer.snapshot());
    assert.equal(second.clock.now(), first.clock.now());
  } finally {
    await second.close();
    await first.close();
  }
});

test('Base pause, VM mode0 and reenabled completed Scripts retain distinct update behavior', async () => {
  let timer = 0;
  const world = await make(() => timer);
  try {
    timer = 17;
    await dispatch(world);
    const record = world.objects.objects.get(world.main.id),
      pc = world.main.machine.pc,
      enable = (mode) =>
        world.sendEngine(record.id, record.id, 161, world.nativeTaskID(record.id), mode);
    await enable(0);
    await world.sendEngine(record.id, record.id, 29, 0, 1);
    timer = 100;
    await dispatch(world);
    // Base draw writes the current Frame after paused logic has held its input.
    assert.equal(record.effectiveFrame, 6);
    assert.equal(record.pausedFrames, 5);
    assert.equal(world.main.machine.pc, pc);
    assert.equal(record.scriptUpdateAccumulator, 1);
    assert.equal(record.scriptEnabled, 1);
    await world.sendEngine(record.id, record.id, 29, 0, 0);
    await enable(1);
    timer = 117;
    await dispatch(world);
    assert.equal(world.main.machine.load(8), 2);
    timer = 134;
    await dispatch(world);
    assert.equal(record.scriptEnabled, 0);
    const completed = record.scriptUpdateAccumulator;
    await enable(0);
    timer = 151;
    await dispatch(world);
    assert.equal(record.scriptEnabled, 1);
    assert.equal(record.scriptUpdateAccumulator, (completed + 1) >>> 0);
  } finally {
    await world.close();
  }
});

test('captured rate and SCREEN/no_skip survive later configuration changes', async () => {
  let timer = 0;
  const world = await make(() => timer, false);
  try {
    world.configuration.setField('screen.fps', 30);
    world.configuration.setField('screen.noSkip', 1);
    await world.initialize('case.kcs');
    timer = 100;
    await dispatch(world);
    assert.equal(world.frame, 3);
    assert.equal(world.main.machine.load(4), 3);
    world.configuration.setField('screen.fps', 60);
    world.configuration.setField('screen.noSkip', 0);
    timer = 134;
    await dispatch(world);
    assert.equal(world.framePacer.rate, 30);
    assert.equal(world.framePacer.noSkip, true);
    assert.equal(world.frame, 5);
    assert.equal(world.clock.now(), 134);
  } finally {
    await world.close();
  }
});

test('other SDKs retain their default driver and do not inherit the observed-frame contract', async () => {
  const world = await dataWorld(
    'nekopara-vol3-engine-2.6.1.76',
    {},
    { frameSource: { now: () => 1000 } },
  );
  try {
    assert.equal(world.framePacer, null);
    assert.equal(world.beginHostFrameWait(), null);
    const frame = world.frame;
    await world.tick();
    assert.equal(world.frame, frame + 1);
  } finally {
    await world.close();
  }
});

test('closing a World releases its pending host wait without a synthetic dispatch', async () => {
  let timer = 0;
  const world = await make(() => timer),
    wait = world.beginHostFrameWait(),
    pacer = world.framePacer;
  await world.close();
  timer = 17;
  assert.equal(pacer.waiting, false);
  await assert.rejects(world.resumeHostFrameWait(wait), /actual wait return/);
  assert.equal(world.objects.objects.size, 0);
});
