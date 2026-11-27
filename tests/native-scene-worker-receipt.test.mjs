// SPDX-License-Identifier: MPL-2.0
// An initial JS factory is deliberately not evidence of a native Worker.
// This isolated file tests receipt ownership independently of that identity.
import test from 'node:test';
import assert from 'node:assert/strict';

const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker'),
  states = new WeakMap(),
  workers = [];
let reply,
  pending = false;
class InitialFactory extends EventTarget {
  constructor() {
    super();
    states.set(this, {});
    workers.push(this);
    this.terminations = 0;
  }
  postMessage(data) {
    if (pending && data !== 'ready') return;
    const value = data === 'ready' ? 'ready' : reply;
    queueMicrotask(() =>
      states.get(this).onmessage?.(new MessageEvent('message', { data: value })),
    );
  }
  terminate() {
    this.terminations++;
  }
}
for (const key of ['onmessage', 'onerror', 'onmessageerror'])
  Object.defineProperty(InitialFactory.prototype, key, {
    configurable: true,
    get() {
      return states.get(this)[key];
    },
    set(value) {
      states.get(this)[key] = value;
    },
  });
Object.defineProperty(globalThis, 'Worker', {
  configurable: true,
  writable: true,
  value: InitialFactory,
});
const module = await import('../src/native/scene-workers.mjs');
const world = () => ({ sceneWorkers: null, prepareSceneWorkers: true });
const request = (length = 4) => ({ bytes: Uint8Array.of(1), length });
const result = () => ({ expanded: Uint8Array.of(17, 18, 19, 20), atlas: null });

test('initial-factory receipt has independent pixels, metadata and subsequent leases', async (t) => {
  t.after(() => {
    if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker);
    else delete globalThis.Worker;
  });
  await t.test('expanded and atlas copies survive held input mutations across await', async () => {
    reply = result();
    reply.atlas = {
      name: 'tex',
      resource: 0,
      storedWidth: 1,
      storedHeight: 1,
      texture: { width: 1, height: 1, rgba: Uint8Array.of(1, 2, 3, 4) },
    };
    const held = reply,
      lease = module.acquireOwnedSceneWorker(world(), 'model');
    assert(lease);
    const received = await lease.send(request(), []);
    lease.release();
    assert.notEqual(received, held);
    assert.notEqual(received.expanded.buffer, held.expanded.buffer);
    assert.notEqual(received.atlas.texture.rgba.buffer, held.atlas.texture.rgba.buffer);
    await Promise.resolve();
    held.expanded.fill(99);
    held.atlas.texture.rgba.fill(99);
    held.atlas.name = 'changed';
    held.atlas.texture.width = 900;
    assert.deepEqual([...received.expanded], [17, 18, 19, 20]);
    assert.deepEqual([...received.atlas.texture.rgba], [1, 2, 3, 4]);
    assert.equal(received.atlas.name, 'tex');
    assert.equal(received.atlas.texture.width, 1);
    received.expanded.fill(77);
    assert.equal(held.expanded[0], 99);
    assert.equal(workers.at(-1).terminations, 1);
  });
  await t.test(
    'opaque, shared, resized, partial and over-budget shapes fall back without getters',
    async () => {
      let getters = 0;
      for (const value of [
        {
          get expanded() {
            getters++;
            throw Error('unknown getter');
          },
        },
        { expanded: new Proxy(Uint8Array.of(1, 2, 3, 4), {}), atlas: null },
        { expanded: new Uint8Array(new SharedArrayBuffer(4)), atlas: null },
        { expanded: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })), atlas: null },
        { expanded: new Uint8Array(8).subarray(0, 4), atlas: null },
        { expanded: Uint8Array.of(1, 2), atlas: null },
      ]) {
        reply = value;
        const lease = module.acquireOwnedSceneWorker(world(), 'model');
        assert.equal(await lease.send(request(), []), null);
        lease.release();
      }
      reply = result();
      reply.atlas = {
        name: 'x',
        resource: 0,
        storedWidth: 1,
        storedHeight: 1,
        texture: { width: 1, height: 1, rgba: reply.expanded },
      };
      let lease = module.acquireOwnedSceneWorker(world(), 'model');
      assert.equal(await lease.send(request(), []), null, 'atlas cannot alias expanded');
      lease.release();
      reply = result();
      lease = module.acquireOwnedSceneWorker(world(), 'model');
      assert.equal(await lease.send(request(72 * 1024 * 1024 + 1), []), null);
      lease.release();
      assert.equal(getters, 0);
    },
  );
  await t.test(
    'ordinary service output stays ordinary; private-pool reuse and cancellation stay bounded',
    async () => {
      reply = result();
      const pool = await module.prepareSceneWorkerPool(),
        w = { sceneWorkers: pool };
      const ordinary = module.acquireSceneWorker(w, 'model');
      assert.equal(
        await ordinary.send('ordinary', []),
        reply,
        'ordinary helper is not a receipt API',
      );
      ordinary.release();
      const first = module.acquireOwnedSceneWorker(w, 'model');
      assert.deepEqual([...(await first.send(request(), [])).expanded], [17, 18, 19, 20]);
      first.release();
      const second = module.acquireOwnedSceneWorker(w, 'model');
      assert.equal(first.send(request(), []), null);
      first.release();
      assert(await second.send(request(), []), 'old release cannot stop the new lease');
      second.release();
      const third = module.acquireOwnedSceneWorker(w, 'model'),
        cancel = new AbortController();
      pending = true;
      const waiting = third.send(request(), [], cancel.signal);
      cancel.abort();
      await assert.rejects(waiting, { name: 'AbortError' });
      third.release();
      pending = false;
      assert.equal(module.acquireOwnedSceneWorker(w, 'model'), null);
      pool.close();
    },
  );
  await t.test(
    'foreign pools and later constructor, worker and lease replacements remain rejected',
    async () => {
      let calls = 0;
      const foreign = {
        get acquire() {
          calls++;
          throw Error('foreign');
        },
      };
      assert.equal(module.acquireOwnedSceneWorker({ sceneWorkers: foreign }, 'model'), null);
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        get() {
          calls++;
          return InitialFactory;
        },
      });
      assert.equal(module.canPrepareOwnedSceneWorker(world(), 'model'), false);
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        writable: true,
        value: InitialFactory,
      });
      reply = result();
      let pool = await module.prepareSceneWorkerPool(),
        w = { sceneWorkers: pool };
      const ordinary = module.acquireSceneWorker(w, 'model');
      Object.defineProperty(ordinary, 'send', {
        get() {
          calls++;
          throw Error('replaced');
        },
      });
      assert.equal(module.ownedSceneWorkerLease(ordinary), null);
      pool.close();
      pool = await module.prepareSceneWorkerPool();
      w = { sceneWorkers: pool };
      const modelWorker = workers.at(-2);
      Object.defineProperty(modelWorker, 'postMessage', {
        get() {
          calls++;
          throw Error('replaced');
        },
      });
      assert.equal(module.acquireOwnedSceneWorker(w, 'model'), null);
      pool.close();
      assert.equal(calls, 0);
    },
  );
});
