// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSceneWorker,
  canPrepareSceneWorker,
  prepareSceneWorkerPool,
  acquireOwnedSceneWorker,
  canPrepareOwnedSceneWorker,
  ownedSceneWorkerLease,
} from '../src/native/scene-workers.mjs';

function fakeWorkers(t, { holdReady = false, failImage = false } = {}) {
  const prior = globalThis.Worker,
    spawned = [];
  globalThis.Worker = class {
    constructor(url) {
      this.name = url.pathname.split('/').at(-1);
      this.requests = [];
      this.terminated = 0;
      spawned.push(this);
    }
    postMessage(data) {
      this.requests.push(data);
      if (data === 'pending' || (data === 'ready' && holdReady)) return;
      queueMicrotask(() => {
        if (data === 'ready' && failImage && this.name === 'hg3-prepare-worker.mjs')
          this.onerror?.({ preventDefault() {} });
        else this.onmessage?.({ data });
      });
    }
    terminate() {
      this.terminated++;
    }
  };
  t.after(() => {
    if (prior === undefined) delete globalThis.Worker;
    else globalThis.Worker = prior;
  });
  return spawned;
}

test('prepared workers answer two successive leases and terminate a canceled in-flight slot', async (t) => {
  const spawned = fakeWorkers(t),
    launch = new AbortController(),
    sceneWorkers = await prepareSceneWorkerPool(launch.signal),
    world = { prepareSceneWorkers: false, sceneWorkers };
  assert.deepEqual(
    spawned.map(({ requests }) => requests),
    [['ready'], ['ready']],
  );
  for (const kind of ['model', 'image']) {
    const first = acquireSceneWorker(world, kind);
    assert.equal(acquireSceneWorker(world, kind), null);
    assert.equal(await first.send('first', []), 'first');
    first.release();
    const second = acquireSceneWorker(world, kind);
    first.release();
    assert.equal(await second.send('second', []), 'second');
    second.release();
  }
  assert.equal(spawned.length, 2);

  const abandoned = new AbortController(),
    leased = acquireSceneWorker(world, 'model'),
    pending = leased.send('pending', [], abandoned.signal);
  abandoned.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  leased.release();
  assert.equal(canPrepareSceneWorker(world, 'model'), false);
  assert.equal(acquireSceneWorker(world, 'model'), null);
  assert.equal(canPrepareSceneWorker(world, 'image'), true);

  const image = acquireSceneWorker(world, 'image'),
    stopped = image.send('pending', []);
  launch.abort();
  await assert.rejects(stopped, { name: 'AbortError' });
  sceneWorkers.close();
  image.release();
  assert.deepEqual(
    spawned.map(({ terminated }) => terminated),
    [1, 1],
  );
});

test('aborting startup retires both workers before dependency readiness', async (t) => {
  const spawned = fakeWorkers(t, { holdReady: true }),
    launch = new AbortController(),
    waiting = prepareSceneWorkerPool(launch.signal);
  assert.equal(spawned.length, 2);
  launch.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.deepEqual(
    spawned.map(({ terminated }) => terminated),
    [1, 1],
  );
});

test('a worker that cannot initialize leaves its decoder on the ordinary path', async (t) => {
  const spawned = fakeWorkers(t, { failImage: true }),
    sceneWorkers = await prepareSceneWorkerPool(),
    world = { prepareSceneWorkers: false, sceneWorkers };
  assert.equal(acquireSceneWorker(world, 'image'), null);
  assert.equal(canPrepareSceneWorker(world, 'model'), true);
  assert.equal(spawned.length, 2);
  sceneWorkers.close();
  assert.deepEqual(
    spawned.map(({ terminated }) => terminated),
    [1, 1],
  );
});

test('owned preparation rejects Node fake channels, borrowed replies and replaced lease fields', async (t) => {
  const spawned = fakeWorkers(t),
    borrowed = Uint8Array.of(17),
    unknown = {};
  let callbacks = 0;
  for (const key of ['enabled', 'acquire'])
    Object.defineProperty(unknown, key, {
      get() {
        callbacks++;
        return () => ({ send: () => ({ expanded: borrowed }) });
      },
    });
  const world = { prepareSceneWorkers: true, sceneWorkers: unknown };
  assert.equal(canPrepareOwnedSceneWorker(world, 'model'), false);
  assert.equal(acquireOwnedSceneWorker(world, 'model'), null);
  await Promise.resolve();
  borrowed[0] = 173;
  assert.equal(callbacks, 0);
  assert.equal(spawned.length, 0);

  const pool = await prepareSceneWorkerPool(),
    lease = acquireSceneWorker({ sceneWorkers: pool }, 'model');
  try {
    Object.defineProperty(lease, 'send', {
      get() {
        callbacks++;
        throw new Error('Replaced lease port');
      },
    });
    assert.equal(ownedSceneWorkerLease(lease), null);
    assert.equal(callbacks, 0);
    assert.equal(canPrepareOwnedSceneWorker({ sceneWorkers: pool }, 'model'), false);
  } finally {
    pool.close();
  }
  assert(spawned.every(({ terminated }) => terminated === 1));
});
