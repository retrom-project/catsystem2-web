// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeResourceCache, nativeResourceCache } from '../src/native/resource-cache.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
const next = () => new Promise((resolve) => setImmediate(resolve));

test('preload retains list order, separate lifetime/sort age and loaded bytes through requeue and aging', async () => {
  const calls = [],
    cache = new NativeResourceCache({
      read: async (name) => {
        calls.push(name);
        return name === 'missing' ? null : Uint8Array.of(calls.length, 2, 3);
      },
    });
  try {
    await cache.queue('A', 4);
    await cache.queue('b', 2);
    await cache.queue('C', 2);
    await cache.queue('a', 8, 99);
    assert.equal(await cache.peek('a'), null);
    assert.equal(calls.length, 0);
    assert.deepEqual(
      cache.entries.map((r) => [r.filename, r.lifetime, r.priority, r.type]),
      [
        ['A', 8, 4, 3],
        ['b', 2, 2, 3],
        ['C', 2, 2, 3],
      ],
    );
    await cache.start();
    await cache.settle();
    assert.deepEqual(calls, ['b', 'C', 'A']);
    const bytes = await cache.read('a');
    bytes[0] = 255;
    assert.equal((await cache.read('A'))[0], 3);
    assert.equal(calls.length, 3);
    const peeked = await cache.peek('a');
    peeked[0] = 255;
    assert.equal((await cache.peek('A'))[0], 3);
    cache.enabled = 0;
    assert.equal(await cache.peek('A'), null);
    cache.enabled = 1;
    await cache.queue('a', 0);
    await cache.age();
    assert.deepEqual(
      cache.entries.map((r) => [r.filename, r.lifetime, r.priority]),
      [
        ['b', 1, 1],
        ['C', 1, 1],
      ],
    );
    assert.equal(cache.progress, 0x7ffffffe);
    assert.equal(cache.complete(0x7fffffff), 0);
    await cache.queue('missing', 2);
    await cache.start();
    await cache.settle();
    assert.equal(cache.entries.find((r) => r.filename === 'missing').loaded, 1);
    assert.equal(cache.entries.find((r) => r.filename === 'missing').bytes, null);
    assert.equal(await cache.peek('missing'), null);
    assert.equal(calls.length, 4);
    assert.equal(cache.complete(0x7fffffff), 1);
    await cache.read('missing');
    assert.deepEqual(calls, ['b', 'C', 'A', 'missing', 'missing']);
  } finally {
    await cache.close();
  }
});

test('preload reports group progress while actual I/O is pending and serializes cache mutations with it', async () => {
  const requests = [],
    waiting = [],
    cache = new NativeResourceCache({
      read: (name) => {
        requests.push(name);
        return new Promise((resolve) => waiting.push(resolve));
      },
    });
  let mutation;
  try {
    await cache.queue('first', 2);
    await cache.queue('second', 5);
    await cache.start();
    await next();
    assert.deepEqual(requests, ['first']);
    assert.equal(cache.complete(2), 0);
    assert.throws(() => cache.snapshot(), /settle/);
    waiting.shift()(Uint8Array.of(1));
    await next();
    assert.deepEqual(requests, ['first', 'second']);
    assert.equal(cache.progress, 2);
    assert.equal(cache.complete(2), 1);
    assert.equal(cache.complete(3), 0);
    let cleared = false;
    mutation = cache.clear().then(() => {
      cleared = true;
    });
    await next();
    assert.equal(cleared, false);
    waiting.shift()(Uint8Array.of(2));
    await mutation;
    await cache.settle();
    assert.equal(cache.entries.length, 0);
    assert.equal(cache.progress, 0x7fffffff);
  } finally {
    for (const resolve of waiting) resolve(null);
    await mutation;
    await cache.close();
  }
});

test('preload cache checkpoints preserve immutable content and avoid repeated I/O in a fresh owner', async () => {
  const cache = new NativeResourceCache({ read: async () => Uint8Array.of(7, 8) }),
    restored = new NativeResourceCache({
      read: async () => {
        throw new Error('unexpected file read');
      },
    });
  try {
    await cache.queue('authored', 2);
    await cache.start();
    await cache.settle();
    restored.restore(structuredClone(cache.snapshot()));
    await cache.age();
    assert.equal(restored.entries[0].lifetime, 2);
    assert.deepEqual(await restored.read('AUTHORED'), Uint8Array.of(7, 8));
    await restored.age();
    assert.deepEqual(restored.snapshot(), cache.snapshot());
  } finally {
    await cache.close();
    await restored.close();
  }
});

test('disabled preload retains its zero constructor state while file reads continue normally', async () => {
  const calls = [],
    cache = new NativeResourceCache({
      enabled: 0,
      read: async (name) => {
        calls.push(name);
        return Uint8Array.of(9);
      },
    });
  try {
    await cache.queue('a', -1);
    await cache.start();
    await cache.age();
    await cache.clear();
    assert.deepEqual(cache.snapshot(), { enabled: 0, entries: [], progress: 0 });
    assert.equal(cache.complete(0x7fffffff), 1);
    assert.deepEqual(await cache.read('a'), Uint8Array.of(9));
    assert.deepEqual(calls, ['a']);
  } finally {
    await cache.close();
  }
});

test('all five KCS preload wrappers execute the cache and keep their control and category contracts', async () => {
  const m = new KCSMachine(
      await readKCS(
        kcsProgram(
          [[59]],
          [
            [64, 'authored'],
            [96, 'image'],
          ],
        ),
      ),
    ),
    calls = [],
    cache = new NativeResourceCache({
      read: async (name) => {
        calls.push(name);
        return Uint8Array.of(1);
      },
    }),
    services = {
      resourceCache: cache,
      format: (at) => m.string(at),
      resourceFilename: (name, category) => (category === 'image' ? `image.int/${name}.hg3` : null),
    },
    call = (id, args = []) => nativeResourceCache(id, args, m, services);
  try {
    assert.equal((await call(0x1b2)).control, 2);
    assert.equal((await call(0x1b3, [64, 96, 2])).control, 2);
    assert.equal(cache.entries[0].filename, 'image.int/authored.hg3');
    assert.equal((await call(0x1b4)).control, 2);
    await cache.settle();
    assert.deepEqual(calls, ['image.int/authored.hg3']);
    assert.deepEqual(call(0x1b5, [2]), { control: 1, value: 1 });
    assert.equal((await call(0x1b6)).control, 2);
    assert.equal(cache.entries[0].lifetime, 1);
    m.writeString('', 96);
    await call(0x1b3, [64, 96, 1]);
    assert.equal(cache.entries.at(-1).filename, '');
  } finally {
    await cache.close();
  }
});
