// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeInput } from '../src/native/input.mjs';

test('input regions route by native priority, rectangle edges and captured release', async () => {
  const messages = [],
    input = new NativeInput({
      dispatch: async (...words) => {
        messages.push(words);
        return 0;
      },
    });
  input.register({ owner: 4, bounds: [0, 0, 100, 100], priority: 5, mask: 2 });
  input.register({ owner: 9, bounds: [10, 10, 20, 20], priority: 10, mask: 2 });
  input.pointer(15, 15);
  await input.route(0, true, 2);
  assert.deepEqual(messages.pop(), [9, 4, 0, 1]);
  input.pointer(99, 99);
  await input.route(0, false, 2);
  assert.deepEqual(messages.pop(), [9, 4, 0, 0]);
  input.pointer(20, 15);
  await input.route(0, true, 2);
  assert.deepEqual(messages.pop(), [4, 4, 0, 1]);
});

test('empty rectangles accept key routing but hover requires a nonempty hit area', async () => {
  const messages = [],
    input = new NativeInput({
      dispatch: async (...words) => {
        messages.push(words);
        return 0;
      },
    });
  input.register({ owner: 1, bounds: [0, 0, 0, 0], priority: 100 });
  input.register({ owner: 2, bounds: [10, 10, 20, 20], priority: 10 });
  input.pointer(15, 15);
  await input.hover();
  assert.deepEqual(messages, [[2, 7, 15, 15]]);
  input.pointer(30, 30);
  await input.hover();
  assert.deepEqual(messages.at(-1), [2, 8, 30, 30]);
  await input.route(4, true, 1);
  assert.deepEqual(messages.at(-1), [1, 4, 4, 1]);
});

test('input alpha masks use native low-bit ordering and survive restore with key capture', async () => {
  const input = new NativeInput({ dispatch: async () => 0 });
  const region = input.register({ owner: 4, bounds: [0, 0, 9, 1] });
  region.alpha = { width: 9, height: 1, bytes: Uint8Array.of(1, 1) };
  input.pointer(8, 0);
  assert.equal(input.hit(region), true);
  await input.route(0, true, 2);
  const next = new NativeInput({ dispatch: async () => 0 });
  next.restore(structuredClone(input.snapshot()));
  assert.equal(next.captures[0], 4);
  assert.equal(next.hit(next.get(4)), true);
  next.pointer(7, 0);
  assert.equal(next.hit(next.get(4)), false);
});

test('signed priorities keep stable list order and reprioritizing appends duplicate owners', () => {
  const input = new NativeInput();
  input.register({ owner: 9, priority: 0xffffffff });
  input.register({ owner: 2, priority: 10 });
  input.register({ owner: 3, priority: 10 });
  input.register({ owner: 2, priority: 10 });
  assert.deepEqual(
    input.ordered().map((r) => r.owner),
    [2, 3, 2, 9],
  );
  input.priority(2, 10);
  assert.deepEqual(
    input.ordered().map((r) => r.owner),
    [3, 2, 2, 9],
  );
  input.unregister(2);
  assert.deepEqual(
    input.ordered().map((r) => r.owner),
    [3, 2, 9],
  );
});

test('native repeat inspects one record and routed uninitialized replies remain explicit', async () => {
  const calls = [],
    input = new NativeInput({
      dispatch: async (owner) => {
        calls.push(owner);
        return { routed: true, result: 1 };
      },
    });
  input.register({ owner: 2, priority: 10 });
  input.register({ owner: 3, priority: 9 });
  await input.route(4, true, 1, true);
  assert.deepEqual(calls, [2]);
  calls.length = 0;
  input.get(2).enabled = 0;
  await input.route(4, true, 1, true);
  assert.deepEqual(calls, []);
  const { NATIVE_UNWRITTEN_WORD } = await import('../src/native/engine-message.mjs');
  input.get(2).enabled = 1;
  input.dispatch = async () => ({ routed: false, result: NATIVE_UNWRITTEN_WORD });
  assert.equal(await input.route(4, true, 1), false);
  input.dispatch = async () => ({ routed: true, result: NATIVE_UNWRITTEN_WORD });
  await assert.rejects(input.route(4, true, 1), /initialized|word/i);
});

test('hover alpha masks replace the rectangle test and message queries preserve unwritten output', async () => {
  const calls = [],
    input = new NativeInput({
      dispatch: async (...words) => {
        calls.push(words);
        return 0;
      },
    }),
    record = input.register({ owner: 4, bounds: [0, 0, 1, 1] });
  record.alpha = { width: 3, height: 1, bytes: Uint8Array.of(4) };
  input.pointer(2, 0);
  await input.hover();
  assert.deepEqual(calls, [[4, 7, 2, 0]]);
  const { NATIVE_UNWRITTEN_WORD } = await import('../src/native/engine-message.mjs');
  assert.equal(await input.message(133, 99), NATIVE_UNWRITTEN_WORD);
  input.changed = false;
  await input.message(129, 99, 0);
  assert.equal(input.changed, true);
});

test('text cancellation preserves original CP932 bytes, while confirmation and checkpoint settle', async () => {
  const { NativeInputPacket } = await import('../src/native/input.mjs'),
    packet = new NativeInputPacket(64);
  packet.bytes(4, 3).set(Uint8Array.of(0x81, 0x20, 0));
  let settle;
  const input = new NativeInput({
    textInput: () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  });
  await input.message(139, 0, 4, { payload: packet });
  assert.equal(await input.message(140), 0);
  assert.throws(() => input.snapshot(), /settle/);
  settle(null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await input.message(140), 2);
  await input.message(141, 0, 12, { payload: packet });
  assert.deepEqual([...packet.bytes(12, 3)], [0x81, 0x20, 0]);
  const restored = new NativeInput();
  restored.restore(input.snapshot());
  await restored.message(141, 0, 20, { payload: packet });
  assert.deepEqual([...packet.bytes(20, 3)], [0x81, 0x20, 0]);
});

test('explicit cursor changes retain native words independently from auto-hide visibility', async () => {
  const input = new NativeInput({ cursor: (value) => value });
  await input.message(149, 0, 0xffffffff);
  assert.equal(input.cursorEnabled, 0xffffffff);
  assert.equal(input.cursorVisible, true);
  await input.message(142, 1, 120);
  assert.equal(input.cursorHideFrames, 120);
  assert.equal(input.cursorEnabled, 0xffffffff);
});
