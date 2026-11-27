// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeFramePacer } from '../src/native/frame-pacer.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const observe = (pacer, timer, options) => pacer.observe(pacer.beginWait(), timer, options);

test('actual wait returns retain Q32 carry and publish the delayed step after dispatch', () => {
  const pacer = new NativeFramePacer({ rate: 60, tickCount: 0 });
  for (const sample of [1, 2, 3, 4, 5]) assert.equal(observe(pacer, sample), null);
  const first = observe(pacer, 17);
  assert.deepEqual(first, { frameWord: 1, rawStep: 0, iteration: 1 });
  assert.equal(pacer.pendingStep, 0);
  assert.throws(() => pacer.beginWait(), /single active/);
  assert.throws(() => pacer.snapshot(), /settled dispatch/);
  pacer.complete(first);
  for (const sample of [18, 19, 20]) assert.equal(observe(pacer, sample), null);
  const second = observe(pacer, 34);
  assert.deepEqual(second, { frameWord: 2, rawStep: 2, iteration: 2 });
  pacer.complete(second);
  const third = observe(pacer, 100);
  assert.deepEqual(third, { frameWord: 6, rawStep: 2, iteration: 3 });
  pacer.complete(third);
  assert.equal(pacer.pendingStep, 1);
  assert.equal(pacer.waitCount, 0n);
});

test('ordinary Frame can jump while SCREEN/no_skip uses its captured-rate mode', () => {
  for (const [rate, expected] of [
    [30, [6, 3]],
    [60, [6, 2]],
  ]) {
    const elapsed = new NativeFramePacer({ rate, tickCount: 0 }),
      fixed = new NativeFramePacer({ rate, noSkip: true, tickCount: 0 }),
      a = observe(elapsed, 100),
      b = observe(fixed, 100);
    assert.deepEqual([a.frameWord, b.frameWord], expected);
    assert.equal(a.rawStep, 0);
    assert.equal(b.rawStep, 0);
    elapsed.complete(a);
    fixed.complete(b);
  }
});

test('a timestamp endpoint cannot substitute for the actual number of wait returns', () => {
  const one = new NativeFramePacer({ rate: 60, tickCount: 0 }),
    many = new NativeFramePacer({ rate: 60, tickCount: 0 });
  for (const timer of [1, 2, 3, 4, 5]) observe(many, timer);
  const a = observe(one, 17),
    b = observe(many, 17);
  assert.equal(a.frameWord, b.frameWord);
  one.complete(a);
  many.complete(b);
  assert.deepEqual([one.pendingStep, many.pendingStep], [1, 2]);
});

test('native pause still samples waits, whereas host suspension cancels its external lease', () => {
  const pacer = new NativeFramePacer({ rate: 60, tickCount: 0 });
  const first = observe(pacer, 17);
  pacer.complete(first);
  for (const timer of [18, 19, 20, 21]) observe(pacer, timer, { paused: true });
  const paused = observe(pacer, 34, { paused: true });
  assert.equal(paused.frameWord, 1);
  assert.equal(paused.rawStep, 1);
  pacer.complete(paused);
  const abandoned = pacer.beginWait();
  pacer.suspend();
  assert.throws(() => pacer.observe(abandoned, 51), /actual wait return/);
  pacer.resume(1000);
  const next = observe(pacer, 1017);
  assert.equal(next.frameWord, 2);
  assert.equal(next.rawStep, 2);
  pacer.complete(next);
});

test('portable cold retains timer phase, carry and independent instance ownership', async () => {
  let actual = 0;
  const firstClock = new NativeSystemClock({ now: () => actual }),
    first = new NativeFramePacer({ rate: 60, tickCount: firstClock.tickCount() });
  for (const timer of [1, 2, 3, 4, 5, 17]) {
    actual = timer;
    const packet = observe(first, firstClock.tickCount());
    if (packet) first.complete(packet);
  }
  actual = 25;
  const state = await deserializeCheckpoint(
    await serializeCheckpoint({ clock: firstClock.snapshot(), pacer: first.snapshot() }),
  );
  let otherActual = 1000;
  const otherClock = new NativeSystemClock({ now: () => otherActual });
  otherClock.restore(state.clock);
  const other = NativeFramePacer.restore(state.pacer);
  otherActual += 9;
  actual += 9;
  const a = observe(first, firstClock.tickCount()),
    b = observe(other, otherClock.tickCount());
  assert.deepEqual(a, b);
  assert.throws(() => other.complete(a), /pending dispatch/);
  first.complete(a);
  other.complete(b);
  assert.deepEqual(first.snapshot(), other.snapshot());
  const fresh = new NativeFramePacer({ rate: 60, tickCount: otherClock.tickCount() });
  assert.equal(observe(fresh, 51).rawStep, 0);
});
