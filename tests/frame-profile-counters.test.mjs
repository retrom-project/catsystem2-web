// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeFrames } from './browser/native-performance.mjs';

test('profile counters sum array and typed-array bytes and restore host methods after sampling', async () => {
  const previous = globalThis.window;
  const host = {
    allocations: new Map([[0, 16]]),
    regions: [{ kind: 'heap', address: 0 }],
    heap: 16,
    heapLimit: 512,
    freeBlocks: [],
    cpu: { emu_start() {}, mem_protect() {} },
    uc: { ccall() {} },
    map() {},
    unmap() {},
    invalidateExecutable() {},
    read() {},
    write() {},
  };
  const originalWrite = host.write;
  const world = {
    frame: 121,
    nativeEngine: { process: host, options: {}, kernel: {}, features: new Map() },
    runtime: { handles: { records: new Map() } },
    graphics: {},
    async tick() {
      this.frame++;
    },
  };
  const events = [];
  globalThis.window = {
    catSystem2: { world, status: () => ({ stack: [] }), async snapshot() {} },
    async captureNativeProfile(event, evidence) {
      events.push({ event, evidence });
    },
    async nativeGameFrame() {
      host.write(0, [1, 2, 3]);
      host.write(0, new Uint8Array(5));
      host.read(0, 7);
      host.cpu.emu_start();
      host.uc.ccall();
      await world.tick();
    },
  };
  try {
    observeFrames();
    await window.nativeGameFrame();
    const totals = window.nativePerformance.totals;
    assert.equal(totals.writeBytes, 8);
    assert.equal(totals.readBytes, 7);
    assert.equal(totals.emuStart, 1);
    assert.equal(totals.wasmCalls, 1);
    assert.equal(totals.ticks, 1);
    assert.ok(totals.tickMS > 0);
    assert.equal(events[0].evidence.before.counters.ticks, 0);
    assert.equal(events[1].evidence.after.counters.ticks, 1);
    assert.equal(events[1].evidence.after.counters.tickMS, totals.tickMS);
    assert.equal(host.write, originalWrite);
    assert.deepEqual(
      events.map(({ event }) => event),
      ['start', 'stop'],
    );
    assert.equal(events[1].evidence.after.liveBytes, 16);
    await window.nativeGameFrame();
    assert.equal(totals.writeBytes, 8);
    assert.equal(totals.ticks, 2);
    assert.ok(totals.tickMS >= events[1].evidence.after.counters.tickMS);
  } finally {
    globalThis.window = previous;
  }
});

test('ordinary profiling observes Core and World without a process owner', async () => {
  const previous = globalThis.window;
  const calls = [];
  const world = {
    frame: 121,
    objects: { objects: new Map([[7, {}]]) },
    runtime: {
      scheduler: { tasks: new Map([[7, {}]]) },
      handles: {
        records: new Map([[1, { type: 'bitmap-data', value: { rgba: new Uint8Array(12) } }]]),
      },
    },
    graphics: { graphs: new Map(), tasks: new Map() },
    async tick() {
      calls.push('tick');
      this.frame++;
    },
  };
  const engine = {
    world,
    status: () => ({ stack: ['title#WAIT'] }),
    async step() {
      calls.push('step');
      await world.tick();
    },
    render() {
      calls.push('render');
      return 23;
    },
    async snapshot() {
      return { frame: world.frame };
    },
  };
  globalThis.window = {
    catSystem2: engine,
    async captureNativeProfile() {},
    async nativeGameFrame() {
      await engine.step();
      return engine.render();
    },
  };
  try {
    observeFrames();
    assert.equal(await window.nativeGameFrame(), 23);
    const evidence = window.nativePerformance.snapshot();
    assert.deepEqual(calls, ['step', 'tick', 'render']);
    assert.equal(evidence.ownerMode, 'ordinary-js');
    assert.equal(evidence.timings.step.lifetime.calls, 1);
    assert.equal(evidence.timings.render.lifetime.calls, 1);
    assert.equal(evidence.timings.tick.lifetime.calls, 1);
    assert.equal(evidence.jsHeap, null);
    assert.equal(evidence.resources.objects, 1);
    assert.equal(evidence.resources.handles['bitmap-data'], 1);
    assert.deepEqual(evidence.resources.bitmapPixels, { knownBytes: 12, unavailable: 0 });
    assert.equal(Object.hasOwn(evidence, 'liveBytes'), false);
    assert.equal(Object.hasOwn(evidence.counters, 'emuStart'), false);
  } finally {
    globalThis.window = previous;
  }
});

test('performance delegates preserve this, the original Promise and thrown or rejected errors', async () => {
  const previous = globalThis.window;
  let elapsed = 0,
    complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const syncError = new Error('same synchronous failure'),
    asyncError = new Error('same asynchronous failure'),
    calls = [];
  const engine = {
    world: { frame: 0, async tick() {} },
    step(value) {
      calls.push([this, value]);
      return pending;
    },
    render() {
      throw syncError;
    },
    snapshot() {
      return Promise.reject(asyncError);
    },
  };
  globalThis.window = { catSystem2: engine, performance: { now: () => elapsed } };
  try {
    observeFrames();
    assert.equal(window.nativePerformance.attach(), true);
    const delegated = engine.step(7);
    assert.equal(delegated, pending);
    assert.deepEqual(calls, [[engine, 7]]);
    assert.equal(window.nativePerformance.snapshot().timings.step.lifetime.calls, 0);
    elapsed = 8;
    complete(91);
    assert.equal(await delegated, 91);
    assert.throws(
      () => engine.render(),
      (error) => error === syncError,
    );
    await assert.rejects(engine.snapshot(), (error) => error === asyncError);
    const timings = window.nativePerformance.snapshot().timings;
    assert.equal(timings.step.lifetime.calls, 1);
    assert.equal(timings.step.lifetime.totalMS, 8);
    assert.equal(timings.render.lifetime.calls, 1);
    assert.equal(timings.snapshot.lifetime.calls, 1);
  } finally {
    globalThis.window = previous;
  }
});

test('performance summaries bound the recent population and distinguish current World resources', () => {
  const previous = globalThis.window;
  let elapsed = 0;
  const durations = [1, 2, 3, 4, 100, 6],
    engine = {
      world: { frame: 0, objects: { objects: new Map([[1, {}]]) }, tick() {} },
      render() {
        elapsed += durations.shift();
        return 17;
      },
    };
  globalThis.window = {
    catSystem2: engine,
    performance: {
      now: () => elapsed,
      memory: { usedJSHeapSize: 2048, totalJSHeapSize: 4096, jsHeapSizeLimit: 8192 },
    },
  };
  try {
    observeFrames({ sampleLimit: 4 });
    window.nativePerformance.attach();
    for (let i = 0; i < 6; i++) assert.equal(engine.render(), 17);
    const evidence = window.nativePerformance.snapshot();
    assert.deepEqual(evidence.timings.render.window, {
      count: 4,
      meanMS: 28.25,
      p95MS: 100,
      maxMS: 100,
    });
    assert.deepEqual(evidence.timings.render.lifetime, {
      calls: 6,
      totalMS: 116,
      meanMS: 116 / 6,
      maxMS: 100,
    });
    assert.deepEqual(evidence.jsHeap, {
      usedJSHeapSize: 2048,
      totalJSHeapSize: 4096,
      jsHeapSizeLimit: 8192,
    });
    assert.equal(evidence.conditions.sampleLimit, 4);
    engine.world = {
      frame: 40,
      objects: {
        objects: new Map([
          [2, {}],
          [3, {}],
        ]),
      },
      tick() {},
    };
    window.nativePerformance.attach();
    assert.equal(window.nativePerformance.snapshot().resources.objects, 2);
    assert.equal(window.nativePerformance.snapshot().frame, 40);
    assert.equal(window.nativePerformance.snapshot().timings.render.lifetime.calls, 6);
  } finally {
    globalThis.window = previous;
  }
});

test('profile envelope retains the frame failure when stopping a capture also fails', async () => {
  const previous = globalThis.window,
    frameError = new Error('original frame error'),
    captureError = new Error('capture stop error');
  let calls = 0;
  globalThis.window = {
    catSystem2: { world: { frame: 121 }, status: () => ({ stack: [] }) },
    nativeGameFrame() {
      calls++;
      throw frameError;
    },
    async captureNativeProfile(event) {
      if (event === 'stop') throw captureError;
    },
  };
  try {
    observeFrames();
    await assert.rejects(window.nativeGameFrame(), (error) => error === frameError);
    assert.equal(calls, 1);
    assert.deepEqual(window.nativePerformance.snapshot().observerErrors, [
      'Error: capture stop error',
    ]);
  } finally {
    globalThis.window = previous;
  }
});
