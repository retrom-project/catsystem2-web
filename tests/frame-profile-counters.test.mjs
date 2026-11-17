// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  observeFrames,
  observeRealRAF,
  performanceMachineConditions,
} from './browser/native-performance.mjs';

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

function realRAFControl() {
  let time = 0,
    sequence = 0;
  const callbacks = new Map(),
    timers = new Map(),
    calls = [],
    events = new Map();
  const window = {
    performance: { now: () => time },
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      addEventListener: (name, callback) => events.set(name, callback),
      removeEventListener: (name) => events.delete(name),
    },
    innerWidth: 640,
    innerHeight: 480,
    devicePixelRatio: 1,
    requestAnimationFrame(callback) {
      assert.equal(this, window);
      callbacks.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame(id) {
      assert.equal(this, window);
      callbacks.delete(id);
    },
    setTimeout(callback) {
      timers.set(++sequence, callback);
      return sequence;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const engine = {
    world: {
      frame: 0,
      objects: { objects: new Map() },
      runtime: { handles: { records: new Map() } },
      tick() {
        time++;
        this.frame++;
        calls.push('tick');
      },
    },
    renderer: {
      present() {
        calls.push('present');
        time++;
        return 23;
      },
    },
    step() {
      calls.push('step');
      return this.world.tick();
    },
    render() {
      calls.push('render');
      time++;
      return this.renderer.present();
    },
  };
  window.catSystem2 = engine;
  return {
    window,
    engine,
    callbacks,
    timers,
    calls,
    events,
    frame(timestamp) {
      time = timestamp;
      const [id, callback] = callbacks.entries().next().value;
      callbacks.delete(id);
      callback(timestamp);
    },
    at(timestamp) {
      time = timestamp;
    },
    probe: () => ({ arrived: true, facts: { ownerID: 7, visibleGraphs: 2 } }),
  };
}

test('real RAF scenes retain native scheduling and count actual render and present completions', async () => {
  const previous = globalThis.window,
    control = realRAFControl();
  globalThis.window = control.window;
  try {
    const nativeRAF = window.requestAnimationFrame,
      cancel = window.cancelAnimationFrame;
    observeFrames({ sampleLimit: 2 });
    observeRealRAF({ sampleLimit: 2 });
    const sampling = window.nativeRAF.start({
      scene: 'owned-control',
      criteria: 'live owned scene has visible graphs',
      probe: control.probe,
      durationMS: 60,
    });
    for (const timestamp of [16, 32, 48, 64]) {
      control.at(timestamp - 3);
      control.engine.step();
      assert.equal(control.engine.render(), 23);
      control.frame(timestamp);
    }
    const report = await sampling;
    assert.equal(report.validCapture, true);
    assert.equal(window.requestAnimationFrame, nativeRAF);
    assert.equal(window.cancelAnimationFrame, cancel);
    assert.equal(report.raf.callbacks, 4);
    assert.equal(report.raf.callbacksPerSecond, 62.5);
    assert.equal(report.intervals.raf.count, 3);
    assert.equal(report.intervals.raf.meanMS, 16);
    assert.equal(report.intervals.raf.recent.count, 2);
    assert.equal(report.intervals.raf.recent.p95MS, 16);
    assert.equal(report.methodTimings.render.count, 4);
    assert.equal(report.methodTimings.present.count, 4);
    assert.equal(report.methodTimings.render.meanMS, 2);
    assert.equal(report.methodTimings.present.meanMS, 1);
    assert.deepEqual(
      control.calls,
      Array.from({ length: 4 }, () => ['step', 'tick', 'render', 'present']).flat(),
    );
    assert.deepEqual(report.worldFrames, { before: 0, after: 4 });
    assert.equal(report.memory.before, null);
    assert.equal(report.presentation.physicalDisplayTimestamps, null);
    assert.equal(report.targetFPSAssessment, null);
    assert.equal(control.callbacks.size, 0);
    assert.equal(control.timers.size, 0);
    assert.equal(control.events.size, 0);
    assert.ok(performanceMachineConditions().physicalMemoryBytes > 0);
  } finally {
    globalThis.window = previous;
  }
});

test('real RAF scenes reject fabricated arrival and controlled clocks and stop at a real scene change', async () => {
  const previous = globalThis.window,
    control = realRAFControl();
  globalThis.window = control.window;
  try {
    observeFrames();
    observeRealRAF();
    const request = {
      scene: 'title',
      criteria: 'actual title owner remains visible',
      probe: control.probe,
      durationMS: 100,
    };
    assert.throws(
      () => window.nativeRAF.start({ ...request, probe: () => ({ arrived: false }) }),
      /has not arrived/,
    );
    assert.throws(
      () => window.nativeRAF.start({ ...request, probe: () => ({ arrived: true, facts: {} }) }),
      /actual observed facts/,
    );
    window.nativeGameFrame = () => {};
    assert.throws(() => window.nativeRAF.start(request), /Controlled or replaced/);
    window.nativeGameFrame = undefined;
    // observeFrames deliberately retains a callable controlled-clock wrapper;
    // restore its empty install state before sampling a separate real driver.
    Object.defineProperty(window, 'nativeGameFrame', { configurable: true, value: undefined });
    let arrived = true;
    const sampling = window.nativeRAF.start({
      ...request,
      probe: () => ({ arrived, facts: { ownerID: 7 } }),
    });
    control.frame(16);
    arrived = false;
    control.frame(32);
    const report = await sampling;
    assert.equal(report.completion, 'scene-left');
    assert.equal(report.validCapture, false);
    assert.equal(report.raf.callbacks, 1);
    assert.equal(report.raf.callbacksPerSecond, null);
    assert.equal(control.calls.length, 0);
    assert.equal(control.callbacks.size, 0);
  } finally {
    globalThis.window = previous;
  }
});

test('the RAF deadline checks for a scene change after the last callback', async () => {
  const previous = globalThis.window,
    control = realRAFControl();
  globalThis.window = control.window;
  try {
    observeFrames();
    observeRealRAF();
    let arrived = true;
    const sampling = window.nativeRAF.start({
      scene: 'title',
      criteria: 'actual title owner remains visible',
      probe: () => ({ arrived, facts: { ownerID: 7 } }),
      durationMS: 40,
    });
    for (const timestamp of [16, 32]) {
      control.at(timestamp - 3);
      control.engine.step();
      control.engine.render();
      control.frame(timestamp);
    }
    arrived = false;
    control.at(40);
    control.timers.values().next().value();
    const report = await sampling;
    assert.equal(report.runtimeAdvance.worldFrameDelta, 2);
    assert.equal(report.methodTimings.render.count, 2);
    assert.equal(report.completion, 'scene-left');
    assert.equal(report.validCapture, false);
  } finally {
    globalThis.window = previous;
  }
});

test('RAF observation preserves renderer Promise and failure identity and records hidden windows as invalid', async () => {
  const previous = globalThis.window,
    control = realRAFControl(),
    failure = new Error('same render failure');
  let resolve;
  const pending = new Promise((complete) => {
    resolve = complete;
  });
  control.engine.renderer.present = function (argument) {
    assert.equal(argument, 19);
    return pending;
  };
  globalThis.window = control.window;
  try {
    observeFrames();
    observeRealRAF();
    const sampling = window.nativeRAF.start({
      scene: 'owned-control',
      criteria: 'actual owned scene',
      probe: control.probe,
      durationMS: 100,
    });
    assert.equal(control.engine.renderer.present(19), pending);
    control.at(3);
    resolve(23);
    assert.equal(await pending, 23);
    // A fresh renderer supplies the original synchronous failure here.
    control.engine.renderer = {
      present() {
        throw failure;
      },
    };
    window.nativePerformance.attach();
    assert.throws(
      () => control.engine.renderer.present(),
      (error) => error === failure,
    );
    window.document.visibilityState = 'hidden';
    control.events.get('visibilitychange')();
    window.document.visibilityState = 'visible';
    control.frame(16);
    control.frame(100);
    const report = await sampling;
    assert.equal(report.methodTimings.present.count, 2);
    assert.equal(report.methodFailures.present, 1);
    assert.equal(report.conditions.hiddenDuringWindow, true);
    assert.equal(report.validCapture, false);
    assert.equal(report.conditions.stableRAF, true);
  } finally {
    globalThis.window = previous;
  }
});

test('resource memory separates aliased RGBA views from unique backing storage', () => {
  const previous = globalThis.window,
    control = realRAFControl(),
    buffer = new ArrayBuffer(32);
  control.engine.world.runtime.handles.records = new Map([
    [1, { type: 'bitmap-data', value: { rgba: new Uint8Array(buffer, 4, 8) } }],
    [2, { type: 'bitmap-data', value: { rgba: new Uint8Array(buffer, 8, 8) } }],
    [3, { type: 'bitmap-data', value: { rgba: new Uint8Array(4) } }],
    [4, { type: 'bitmap-data', value: {} }],
  ]);
  globalThis.window = control.window;
  try {
    observeFrames();
    const report = window.nativePerformance.snapshot();
    assert.deepEqual(report.resources.bitmapPixels, { knownBytes: 20, unavailable: 1 });
    assert.deepEqual(report.resources.bitmapBackingBuffers, { count: 2, bytes: 36 });
    assert.equal(report.jsHeap, null);
    assert.equal(control.calls.length, 0);
  } finally {
    globalThis.window = previous;
  }
});

test('RAF heartbeats alone do not qualify as a running and rendering scene', async () => {
  const previous = globalThis.window,
    control = realRAFControl();
  globalThis.window = control.window;
  try {
    observeFrames();
    observeRealRAF();
    const sampling = window.nativeRAF.start({
      scene: 'owned-control',
      criteria: 'owned scene owner exists',
      probe: control.probe,
      durationMS: 32,
    });
    control.frame(16);
    control.frame(32);
    const report = await sampling;
    assert.equal(report.raf.callbacks, 2);
    assert.equal(report.runtimeAdvance.worldFrameDelta, 0);
    assert.equal(report.runtimeAdvance.didAdvance, false);
    assert.equal(report.methodTimings.render.count, 0);
    assert.equal(report.methodTimings.present.count, 0);
    assert.equal(report.validCapture, false);
    assert.equal(report.targetFPSAssessment, null);
    assert.equal(control.calls.length, 0);
  } finally {
    globalThis.window = previous;
  }
});

test('native RAF environment baseline remains separate and rejects runtime work during idle sampling', async () => {
  const previous = globalThis.window;
  try {
    for (const mode of ['unmounted', 'idle-mounted', 'active-mounted']) {
      const control = realRAFControl();
      globalThis.window = control.window;
      if (mode === 'unmounted') delete window.catSystem2;
      const nativeRAF = window.requestAnimationFrame;
      observeFrames();
      observeRealRAF();
      const sampling = window.nativeRAF.baseline({ durationMS: 32 });
      if (mode === 'active-mounted') {
        control.engine.step();
        control.engine.render();
      }
      control.frame(16);
      control.frame(32);
      const report = await sampling;
      assert.equal(report.scene, 'raf-baseline');
      assert.equal(report.validCapture, false);
      assert.equal(report.validBaseline, mode !== 'active-mounted');
      assert.equal(report.runtime.mounted, mode !== 'unmounted');
      assert.equal(report.runtime.observedMethodCalls > 0, mode === 'active-mounted');
      assert.equal(report.targetFPSAssessment, null);
      assert.equal(report.raf.callbacks, 2);
      assert.equal(window.requestAnimationFrame, nativeRAF);
      assert.equal(control.callbacks.size, 0);
      assert.equal(control.timers.size, 0);
      assert.equal(control.calls.length, mode === 'active-mounted' ? 4 : 0);
    }
  } finally {
    globalThis.window = previous;
  }
});
