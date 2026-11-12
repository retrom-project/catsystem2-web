// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { LogicalCRTThreads } from '../src/effekseer/crt-threads.mjs';

test('unknown caller thread has no inferred global stream or implicit seed', () => {
  const threads = new LogicalCRTThreads();
  assert.throws(() => threads.forThread(), /explicit logical CRT thread ID/);
  assert.throws(() => threads.forThread('frame'), /Unregistered/);
  assert.deepEqual(threads.snapshot(), { threads: [] });
});
test('explicit logical thread creation initializes its own PTD state once', () => {
  const threads = new LogicalCRTThreads(),
    frame = threads.create('frame'),
    external = threads.create('external');
  assert.equal(frame.nextInt(), 41);
  assert.equal(frame.nextInt(), 18467);
  assert.equal(external.nextInt(), 41);
  assert.equal(threads.forThread('frame'), frame);
  assert.throws(() => threads.create('frame'), /already exists/);
  threads.remove('frame');
  assert.equal(threads.create('frame').nextInt(), 41);
});
test('caller-selected Play and Update contexts share only the matching logical thread', () => {
  const threads = new LogicalCRTThreads();
  threads.create('task-frame');
  threads.create('forced-fes-caller');
  const sampleFor = (id) => threads.forThread(id).nextInt();
  assert.equal(sampleFor('forced-fes-caller'), 41);
  assert.equal(sampleFor('task-frame'), 41);
  assert.equal(sampleFor('task-frame'), 18467);
  assert.equal(sampleFor('forced-fes-caller'), 18467);
  assert.equal(sampleFor('task-frame'), 6334);
  assert.equal(threads.forThread('task-frame').calls, 3);
  assert.equal(threads.forThread('forced-fes-caller').calls, 2);
});
test('fresh restore preserves every live thread and explicit reseed without consuming draws', () => {
  const before = new LogicalCRTThreads();
  before.create('z-frame').nextInt();
  const force = before.create('a-force');
  force.seed(0xffffffff);
  force.nextInt();
  const saved = structuredClone(before.snapshot()),
    after = new LogicalCRTThreads();
  after.restore(saved);
  assert.deepEqual(after.snapshot(), saved);
  assert.deepEqual(
    saved.threads.map(({ id }) => id),
    ['a-force', 'z-frame'],
  );
  for (const id of ['a-force', 'z-frame'])
    for (let i = 0; i < 100; i++)
      assert.equal(after.forThread(id).nextInt(), before.forThread(id).nextInt());
  assert.throws(() => after.restore(saved), /fresh owner/);
});
test('invalid multi-thread restore is atomic and never invents a fallback stream', () => {
  const threads = new LogicalCRTThreads(),
    good = { id: 'frame', state: 1, calls: 0, seedCalls: 0 };
  for (const items of [
    [good, good],
    [good, { id: 'other', state: -1, calls: 0, seedCalls: 0 }],
    [good, { ...good, id: '' }],
  ]) {
    assert.throws(() => threads.restore({ threads: items }));
    assert.deepEqual(threads.snapshot(), { threads: [] });
  }
});
test('closed thread owner cannot recreate or restore implicit random state', () => {
  const threads = new LogicalCRTThreads();
  threads.create('frame');
  threads.close();
  threads.close();
  assert.throws(() => threads.forThread('frame'), /closed/);
  assert.throws(() => threads.create('frame'), /closed/);
  assert.throws(() => threads.restore({ threads: [] }), /closed/);
});
