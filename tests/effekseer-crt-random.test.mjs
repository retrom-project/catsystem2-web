// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { LogicalThreadCRT } from '../src/effekseer/crt-random.mjs';

test('default logical thread reproduces the first ten unsigned MSVC CRT draws', () => {
  const random = new LogicalThreadCRT();
  assert.deepEqual(
    Array.from({ length: 10 }, () => random.nextInt()),
    [41, 18467, 6334, 26500, 19169, 15724, 11478, 29358, 26962, 24464],
  );
  assert.equal(random.calls, 10);
});
test('uint32 overflow agrees with an independent BigInt recurrence', () => {
  for (const seed of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
    const random = new LogicalThreadCRT(seed);
    let state = BigInt(seed);
    for (let i = 0; i < 4096; i++) {
      state = (214013n * state + 2531011n) & 0xffffffffn;
      assert.equal(random.nextInt(), Number((state >> 16n) & 0x7fffn));
      assert.equal(random.state, Number(state));
    }
  }
});
test('separate manager owners consume the same logical thread stream in call order', () => {
  const thread = new LogicalThreadCRT(),
    a = { random: thread },
    b = { random: thread };
  assert.equal(a.random.nextInt(), 41);
  assert.equal(b.random.nextInt(), 18467);
  assert.equal(a.random.nextInt(), 6334);
  a.random.seed(1);
  assert.equal(b.random.nextInt(), 41);
  assert.equal(thread.calls, 4);
  assert.equal(thread.seedCalls, 1);
});
test('fresh restore copies current thread state without drawing or seeding', () => {
  const before = new LogicalThreadCRT(0xffffffff);
  for (let i = 0; i < 17; i++) before.nextInt();
  before.seed(0x80000000);
  for (let i = 0; i < 23; i++) before.nextInt();
  const checkpoint = structuredClone(before.snapshot()),
    after = new LogicalThreadCRT();
  after.restore(checkpoint);
  assert.deepEqual(after.snapshot(), checkpoint);
  for (let i = 0; i < 100; i++) assert.equal(after.nextInt(), before.nextInt());
});
test('invalid seeds/checkpoints do not partially change a live thread', () => {
  const random = new LogicalThreadCRT();
  random.nextInt();
  const original = random.snapshot();
  for (const invalid of [-1, 0x100000000, 1.5, NaN, Infinity])
    assert.throws(() => random.seed(invalid), /Invalid CRT/);
  assert.throws(() => random.restore({ state: 3, calls: -1, seedCalls: 0 }), /Invalid CRT/);
  assert.throws(() => random.restore({ state: 3, calls: 0, seedCalls: 0.5 }), /Invalid CRT/);
  assert.deepEqual(random.snapshot(), original);
});
