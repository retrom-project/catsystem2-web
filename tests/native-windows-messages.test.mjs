// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineWindows } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

async function desktop() {
  let clock = 49;
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, { now: () => clock }),
    queue = kernel.messageQueue,
    api = (name) => kernel.resolve({ dll: 'USER32.dll', name }),
    call = (name, ...args) => p.call(api(name), args),
    name = p.allocate(32, true),
    info = p.allocate(48, true),
    packet = p.allocate(32),
    seen = [],
    proc = p.trap('authored message receiver', 4, ([handle, message, w, l]) => {
      if (message >= 0x400) seen.push([handle, message, w, l]);
      if (message === 0x81) return 1;
      return (w ^ l) >>> 0;
    });
  queue.readPosition = () => [19, 31];
  kernel.writeString(name, 'QueueProbe', true);
  p.store(info, 48);
  p.store(info + 8, proc);
  p.store(info + 20, 0x400000);
  p.store(info + 40, name);
  const atom = call('RegisterClassExW', info),
    create = (style, parent = 0) =>
      p.callAsync(api('CreateWindowExW'), [
        0,
        atom,
        name,
        style,
        0,
        0,
        40,
        30,
        parent,
        0,
        0x400000,
        0,
      ]),
    root = await create(0),
    child = await create(0x40000000, root),
    popup = await create(0x80000000, root);
  assert(root && child && popup);
  const words = () => Array.from({ length: 8 }, (_, i) => p.load(packet + i * 4)),
    prepare = () => p.write(packet, new Uint8Array(32).fill(0xa5)),
    peek = (handle = 0, min = 0, max = 0, remove = 0, suffix = 'W') => {
      prepare();
      return call('PeekMessage' + suffix, packet, handle, min, max, remove);
    },
    get = (handle = 0, min = 0, max = 0) => {
      prepare();
      return p.callAsync(api('GetMessageW'), [packet, handle, min, max]);
    },
    dispatch = () => p.callAsync(api('DispatchMessageW'), [packet]);
  return {
    p,
    kernel,
    queue,
    call,
    root,
    child,
    popup,
    seen,
    words,
    peek,
    get,
    dispatch,
    packet,
    setTime: (time) => {
      clock = time;
    },
  };
}

test('virtual Win32 retrieval preserves posted order, window filters and the x86 MSG bytes', async () => {
  const { p, kernel, queue, call, root, child, popup, seen, words, peek, get, dispatch, setTime } =
    await desktop();
  const untouched = Array(8).fill(0xa5a5a5a5),
    check = (handle, message, w, l, time = 49) =>
      assert.deepEqual(words(), [handle, message, w, l, time, 19, 31, 0xa5a5a5a5]);
  try {
    assert.equal(peek(), 0);
    assert.deepEqual(words(), untouched);
    assert.equal(call('PostMessageA', root, 0x4201, 101, 201), 1);
    assert.equal(call('PostMessageW', child, 0x4202, 102, 202), 1);
    assert.equal(call('PostMessageW', popup, 0x4203, 103, 203), 1);
    assert.equal(call('PostMessageA', 0, 0x4204, 104, 204), 1);
    assert.equal(call('PostThreadMessageW', 1, 0x4205, 105, 205), 1);
    assert.deepEqual(seen, []);
    setTime(70);
    assert.equal(peek(root, 0x4202, 0x4203, 0, 'A'), 1);
    check(child, 0x4202, 102, 202);
    assert.equal(call('GetMessageTime'), 49);
    assert.equal(call('GetMessagePos'), 0x1f0013);
    assert.equal(peek(root, 0x4202, 0x4203, 1), 1);
    check(child, 0x4202, 102, 202);
    assert.equal(await dispatch(), 102 ^ 202);
    assert.deepEqual(seen, [[child, 0x4202, 102, 202]]);
    assert.equal(peek(root, 0x4202, 0x4203, 1), 0);
    assert.deepEqual(words(), untouched);
    assert.equal(await get(0xffffffff, 0x4204, 0x4205), 1);
    check(0, 0x4204, 104, 204);
    assert.equal(await dispatch(), 0);
    assert.equal(await get(), 1);
    check(root, 0x4201, 101, 201);
    assert.equal(await get(), 1);
    check(popup, 0x4203, 103, 203);
    assert.equal(await get(), 1);
    check(0, 0x4205, 105, 205);
    assert.equal(call('PostMessageW', root, 0xc, 0, 0), 0);
    assert.equal(kernel.lastError, 1159);
    assert.equal(call('PostMessageW', root, 0x4a, 0, 0), 0);
    assert.equal(kernel.lastError, 1159);
    assert.equal(call('PostMessageW', 99, 0x4201, 0, 0), 0);
    assert.equal(kernel.lastError, 1400);
    assert.equal(await get(99), 0xffffffff);
    assert.deepEqual(words(), untouched);
    assert.equal(call('PostThreadMessageA', 99, 0x4201, 0, 0), 0);
    assert.equal(kernel.lastError, 1444);

    call('PostQuitMessage', 17);
    call('PostQuitMessage', -29);
    call('PostMessageW', root, 0x4207, 1, 2);
    call('PostMessageW', child, 0x4208, 3, 4);
    assert.equal(peek(root, 0x4300, 0x430f), 1);
    check(0, 0x12, 0xffffffe3, 0, 70);
    assert.equal(await get(), 1);
    check(root, 0x4207, 1, 2, 70);
    assert.equal(await get(), 1);
    check(child, 0x4208, 3, 4, 70);
    assert.equal(await get(0, 0x4300, 0x430f), 0);
    check(0, 0x12, 0xffffffe3, 0, 70);
    assert.equal(queue.pending, false);

    call('PostMessageW', child, 0x4209, 7, 8);
    assert.equal(peek(child), 1);
    const saved = kernel.snapshot(),
      fresh = await desktop();
    try {
      fresh.kernel.restore(saved);
      assert.equal(fresh.peek(child, 0, 0, 1), 1);
      assert.deepEqual(fresh.words(), words());
      assert.equal(fresh.queue.pending, false);
      assert.equal(queue.pending, true);
    } finally {
      fresh.p.close();
    }
    assert.equal(
      await p.callAsync(kernel.resolve({ dll: 'USER32.dll', name: 'DestroyWindow' }), [child]),
      1,
    );
    assert.equal(await dispatch(), 0);
    assert.equal(kernel.lastError, 1400);
    assert.equal(peek(), 0);
  } finally {
    queue.cancelWaits();
    p.close();
  }
});

test('GetMessage waits for its matching post and can be cancelled at process exit', async () => {
  const { p, kernel, queue, root, words, get, peek } = await desktop();
  try {
    const receiving = get(root, 0x4205, 0x4205);
    assert.equal(queue.waiters.size, 1);
    queue.post(root, 0x4204, 7, 8);
    assert.equal(queue.waiters.size, 1);
    assert.throws(() => kernel.snapshot(), /pending native GetMessage/);
    queue.post(root, 0x4205, 9, 10);
    assert.equal(await receiving, 1);
    assert.deepEqual(words().slice(0, 4), [root, 0x4205, 9, 10]);
    assert.equal(peek(0, 0, 0, 1), 1);
    assert.deepEqual(words().slice(0, 4), [root, 0x4204, 7, 8]);
    const cancelling = get();
    assert.equal(queue.waiters.size, 1);
    queue.cancelWaits();
    assert.equal(await cancelling, 0xffffffff);
    assert.equal(kernel.lastError, 995);
  } finally {
    queue.cancelWaits();
    p.close();
  }
});

test('TranslateMessage posts character messages after the already queued messages', async () => {
  const { p, kernel, queue, call, root, packet, words, peek, get } = await desktop();
  let modifiers = 4;
  kernel.accelerators.readModifiers = () => modifiers;
  try {
    queue.post(root, 0x100, 0x4e, 0x00310002);
    queue.post(root, 0x4220, 17, 4);
    assert.equal(await get(), 1);
    const original = words();
    assert.equal(call('TranslateMessage', packet), 1);
    assert.deepEqual(words(), original);
    assert.equal(await get(), 1);
    assert.deepEqual(words().slice(0, 4), [root, 0x4220, 17, 4]);
    assert.equal(call('TranslateMessage', packet), 0);
    assert.equal(await get(), 1);
    assert.deepEqual(words().slice(0, 4), [root, 0x102, 0x4e, 0x00310002]);

    for (const [message, key, data, flags, character] of [
      [0x101, 0x4e, 0xc0310001, 4, null],
      [0x105, 0x41, 0xe01e0001, 16, null],
      [0x100, 0x70, 0x003b0001, 0, null],
      [0x100, 0x41, 0x001e0001, 0, 0x61],
      [0x104, 0x41, 0x201e0001, 16, 0x61],
      [0x100, 0x41, 0x001e0001, 8, 1],
      [0x100, 0x32, 0x00030001, 12, 0],
      [0x100, 0xbd, 0x000c0001, 4, 0x5f],
    ]) {
      modifiers = flags;
      queue.post(root, message, key, data);
      assert.equal(await get(), 1);
      assert.equal(call('TranslateMessage', packet), 1);
      assert.equal(peek(0, 0, 0, 1), Number(character !== null));
      if (character !== null)
        assert.deepEqual(words().slice(0, 4), [root, message + 2, character, data]);
    }
  } finally {
    queue.cancelWaits();
    p.close();
  }
});

test('message waits share event priority and preserve unread queue categories', async () => {
  const { p, kernel, queue, call, root, peek } = await desktop(),
    event = kernel.events.create(0, 0),
    handles = p.allocate(4),
    timeout = 0x102,
    wait = (mask = 0x4ff, all = 0) => call('MsgWaitForMultipleObjects', 1, handles, all, 0, mask);
  p.store(handles, event);
  try {
    assert.equal(wait(), timeout);
    queue.post(root, 0x4201, 0, 0);
    assert.equal(wait(1), timeout);
    kernel.events.signal(event, true);
    assert.equal(wait(), 0);
    assert.equal(wait(), 1);
    assert.equal(wait(), 1);
    assert.equal(peek(root, 0x4202, 0x420f), 0);
    assert.equal(wait(8), timeout);
    assert.equal(wait(0x100), 1);
    assert.equal(peek(), 1);
    assert.equal(wait(), timeout);
    assert.equal(peek(0, 0, 0, 1), 1);

    kernel.events.signal(event, true);
    assert.equal(wait(0x4ff, 1), timeout);
    queue.post(root, 0x4202, 0, 0);
    assert.equal(wait(0x4ff, 1), 0);
    assert.equal(kernel.events.wait([event], false, 0), timeout);
    assert.equal(call('MsgWaitForMultipleObjects', 0, 0, 0, 0, 0x4ff), 0);
    assert.equal(call('GetQueueStatus', 0x108), 0x1080108);
    assert.equal(wait(), timeout);
    assert.equal(call('GetQueueStatus', 0x108), 0x1080000);
    assert.equal(peek(0, 0, 0, 1), 1);
    call('PostQuitMessage', 5);
    assert.equal(wait(1), timeout);
    assert.equal(wait(8), 1);
    assert.equal(peek(0, 0, 0, 1), 1);

    const start = () =>
      p.callAsync(kernel.resolve({ dll: 'USER32.dll', name: 'MsgWaitForMultipleObjects' }), [
        1,
        handles,
        0,
        0xffffffff,
        0x1cff,
      ]);
    const posting = start();
    queue.post(root, 0x4203, 0, 0);
    assert.equal(await posting, 1);
    assert.equal(peek(0, 0, 0, 1), 1);
    const signaling = start();
    kernel.events.signal(event, true);
    assert.equal(await signaling, 0);
    const closing = start();
    assert.equal(queue.cancelWaits(), true);
    assert.equal(await closing, 0xffffffff);
  } finally {
    queue.cancelWaits();
    p.close();
  }
});
