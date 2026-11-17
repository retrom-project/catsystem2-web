// SPDX-License-Identifier: MPL-2.0
// Opt-in observations of production methods. Explicit original owners keep CPU counters.
import { test as base, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { arch, cpus, platform, release, totalmem } from 'node:os';

export function observeFrames({ sampleLimit = 256 } = {}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 4096)
    throw new RangeError('Invalid performance sample limit');
  const now = () => (window.performance ?? performance).now();
  let frameFunction;
  const existingFrameFunction = window.nativeGameFrame,
    engines = new WeakSet(),
    worlds = new WeakSet(),
    renderers = new WeakSet(),
    listeners = new Set(),
    captured = new Set(),
    samples = [],
    slowTicks = [],
    observerErrors = [],
    totals = { ticks: 0, tickMS: 0, snapshots: 0, snapshotMS: 0 };
  const timing = () => ({ calls: 0, totalMS: 0, maxMS: 0, samples: [] }),
    timings = {
      step: timing(),
      render: timing(),
      present: timing(),
      tick: timing(),
      snapshot: timing(),
    };
  const summary = (entry) => {
    const sorted = [...entry.samples].sort((a, b) => a - b),
      count = sorted.length;
    return {
      lifetime: {
        calls: entry.calls,
        totalMS: entry.totalMS,
        meanMS: entry.calls ? entry.totalMS / entry.calls : null,
        maxMS: entry.calls ? entry.maxMS : null,
      },
      window: {
        count,
        meanMS: count ? sorted.reduce((sum, n) => sum + n, 0) / count : null,
        p95MS: count ? sorted[Math.ceil(count * 0.95) - 1] : null,
        maxMS: count ? sorted.at(-1) : null,
      },
    };
  };
  const jsHeap = () => {
    try {
      const value = window.performance?.memory;
      if (!value) return null;
      const fields = ['usedJSHeapSize', 'totalJSHeapSize', 'jsHeapSizeLimit'];
      if (!fields.every((key) => Number.isFinite(value[key]) && value[key] >= 0)) return null;
      return Object.fromEntries(fields.map((key) => [key, value[key]]));
    } catch {
      return null;
    }
  };
  const sizes = (object) =>
    Object.fromEntries(
      Object.entries(object ?? {})
        .filter(([, value]) => value instanceof Map || value instanceof Set || Array.isArray(value))
        .map(([key, value]) => [key, value.size ?? value.length]),
    );
  const resources = (engine, world) => {
    const records = world?.runtime?.handles?.records,
      handles = {},
      bitmapPixels = { knownBytes: 0, unavailable: 0 },
      bitmapBuffers = new Set();
    if (records)
      for (const { type, value } of records.values()) {
        handles[type] = (handles[type] ?? 0) + 1;
        if (type === 'bitmap-data') {
          if (ArrayBuffer.isView(value.rgba)) {
            bitmapPixels.knownBytes += value.rgba.byteLength;
            bitmapBuffers.add(value.rgba.buffer);
          } else bitmapPixels.unavailable++;
        }
      }
    return {
      objects: world?.objects?.objects?.size ?? null,
      tasks: world?.runtime?.scheduler?.tasks?.size ?? null,
      handles: records ? handles : null,
      bitmapPixels: records ? bitmapPixels : null,
      bitmapBackingBuffers: records
        ? {
            count: bitmapBuffers.size,
            bytes: [...bitmapBuffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
          }
        : null,
      graphs: world?.graphics?.graphs?.size ?? null,
      audioChannels: engine?.audio?.channels?.size ?? null,
      movies: world?.movies?.sessions?.size ?? null,
    };
  };
  const snapshot = () => {
    const engine = window.catSystem2,
      world = engine?.world,
      native = world?.nativeEngine,
      process = native?.process,
      result = {
        frame: world?.frame,
        stack: engine?.status?.().stack ?? [],
        ownerMode: process
          ? 'explicit-original'
          : world?.nativeEngineLoading
            ? 'explicit-original-pending'
            : 'ordinary-js',
        timings: Object.fromEntries(
          Object.entries(timings).map(([key, entry]) => [key, summary(entry)]),
        ),
        counters: { ...totals },
        conditions: { ...conditions, renderer: engine?.renderer?.constructor?.name ?? null },
        observerErrors: [...observerErrors],
        jsHeap: jsHeap(),
        resources: resources(engine, world),
        maps: {
          engine: sizes(engine),
          world: sizes(world),
          runtime: sizes(world?.runtime),
          graphics: sizes(world?.graphics),
        },
        diagnostics: engine?.nativeDiagnostics?.length ?? 0,
        logs: engine?.nativeLog?.length ?? 0,
      };
    if (!process) return result;
    let liveBytes = 0;
    for (const bytes of process.allocations.values()) liveBytes += bytes;
    const heap = process.regions.find((region) => region.kind === 'heap');
    return {
      ...result,
      liveBytes,
      allocationCount: process.allocations.size,
      heapExtent: heap ? process.heap - heap.address : null,
      capacity: heap ? process.heapLimit - heap.address : null,
      freeBlocks: process.freeBlocks.length,
      largestFreeBlock: Math.max(0, ...process.freeBlocks.map((block) => block.size)),
      original: {
        trace: Boolean(native.options.trace),
        singleStep: process.singleStep,
        maps: {
          process: sizes(process),
          kernel: sizes(native.kernel),
          features: Object.fromEntries(
            [...native.features].map(([name, value]) => [name, sizes(value)]),
          ),
        },
      },
    };
  };
  const recordTiming = (name, started, failed) => {
    const settledMS = now(),
      ms = settledMS - started;
    if (!Number.isFinite(ms) || ms < 0) return;
    const entry = timings[name];
    entry.calls++;
    entry.totalMS += ms;
    entry.maxMS = Math.max(entry.maxMS, ms);
    entry.samples.push(ms);
    if (entry.samples.length > sampleLimit) entry.samples.shift();
    for (const listener of listeners)
      try {
        listener({ method: name, startedMS: started, settledMS, durationMS: ms, failed });
      } catch (error) {
        observerErrors.push(String(error));
        if (observerErrors.length > 10) observerErrors.shift();
      }
    if (name === 'snapshot') {
      totals.snapshots++;
      totals.snapshotMS += ms;
    }
    if (name !== 'tick') return;
    totals.ticks++;
    totals.tickMS += ms;
    const engine = window.catSystem2,
      frame = engine?.world?.frame;
    if (slowTicks.length < 10 || ms > slowTicks.at(-1).ms) {
      slowTicks.push({ frame, ms, stack: engine?.status?.().stack ?? [] });
      slowTicks.sort((a, b) => b.ms - a.ms);
      slowTicks.length = Math.min(10, slowTicks.length);
    }
    if ([577, 1061].includes(frame) || frame % 120 === 1) {
      samples.push(snapshot());
      if (samples.length > 40) samples.shift();
    }
  };
  const instrument = (owner, method, name, before) => {
    const original = owner[method];
    if (typeof original !== 'function') return;
    owner[method] = function (...args) {
      before?.();
      const started = now();
      let result;
      const finish = (failed) => {
        try {
          recordTiming(name, started, failed);
        } catch (error) {
          observerErrors.push(String(error));
          if (observerErrors.length > 10) observerErrors.shift();
        }
      };
      try {
        result = original.apply(this, args);
      } catch (error) {
        finish(true);
        throw error;
      }
      if (result && typeof result.then === 'function')
        result.then(
          () => finish(false),
          () => finish(true),
        );
      else finish(false);
      return result;
    };
  };
  const attachWorld = (world) => {
    if (!world || worlds.has(world)) return;
    worlds.add(world);
    instrument(world, 'tick', 'tick');
  };
  const attach = (engine = window.catSystem2) => {
    if (!engine) return false;
    if (!engines.has(engine)) {
      engines.add(engine);
      instrument(engine, 'step', 'step', () => attachWorld(engine.world));
      instrument(engine, 'render', 'render', () => attachWorld(engine.world));
      instrument(engine, 'snapshot', 'snapshot');
    }
    if (engine.renderer && !renderers.has(engine.renderer)) {
      renderers.add(engine.renderer);
      instrument(engine.renderer, 'present', 'present');
    }
    attachWorld(engine.world);
    return true;
  };
  const countCalls = (world) => {
    const process = world?.nativeEngine?.process;
    if (!process) return;
    for (const key of [
      'emuStart',
      'emuMS',
      'wasmCalls',
      'maps',
      'unmaps',
      'protects',
      'invalidations',
      'reads',
      'readBytes',
      'writes',
      'writeBytes',
    ])
      totals[key] ??= 0;
    const restorations = [];
    const count = (owner, method, key, bytesKey, timedKey) => {
      const original = owner[method];
      owner[method] = function (...args) {
        totals[key]++;
        if (bytesKey) totals[bytesKey] += typeof args[1] === 'number' ? args[1] : args[1].length;
        const started = timedKey && now();
        try {
          return original.apply(this, args);
        } finally {
          if (timedKey) totals[timedKey] += now() - started;
        }
      };
      restorations.push(() => {
        owner[method] = original;
      });
    };
    count(process.cpu, 'emu_start', 'emuStart', null, 'emuMS');
    count(process, 'map', 'maps');
    count(process, 'unmap', 'unmaps');
    count(process.cpu, 'mem_protect', 'protects');
    count(process, 'invalidateExecutable', 'invalidations');
    count(process, 'read', 'reads', 'readBytes');
    count(process, 'write', 'writes', 'writeBytes');
    count(process.uc, 'ccall', 'wasmCalls');
    return () => restorations.reverse().forEach((restore) => restore());
  };
  const conditions = {
    clock: 'performance.now',
    sampleLimit,
    percentile: 'nearest-rank over the last settled calls per method, including failures',
    driver:
      'nativeGameFrame uses the existing controlled clock; attach() also observes ordinary RAF',
    userAgent: window.navigator?.userAgent ?? null,
    deviceMemoryGiB: window.navigator?.deviceMemory ?? null,
    note: 'Method timings and controlled frame batches are not a 60 fps result; JS heap excludes GPU/audio/worker memory.',
  };
  window.nativePerformance = {
    totals,
    samples,
    slowTicks,
    snapshot,
    attach,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Invalid performance listener');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    observerErrors,
    conditions,
  };
  Object.defineProperty(window, 'nativeGameFrame', {
    configurable: true,
    get: () => frameFunction,
    set(original) {
      frameFunction = async function (count) {
        const engine = window.catSystem2;
        attach(engine);
        const world = engine?.world,
          frame = world?.frame ?? 0,
          stack = engine?.status?.().stack ?? [];
        let phase;
        if (frame >= 121 && frame < 200) phase = 'logo';
        if (stack.includes('title#WAIT')) phase = 'title';
        if (frame < 577 && frame + count >= 577) phase = 'model-change';
        if (frame >= 601 && frame < 610) phase = 'dialogue-early';
        if (frame >= 961 && frame < 970) phase = 'dialogue-late';
        if (frame < 1061 && frame + count >= 1061) phase = 'model-late';
        if (phase && captured.has(phase)) phase = null;
        let restoreCounters,
          failure,
          captureStarted,
          result,
          failed = false;
        try {
          if (phase) {
            captured.add(phase);
            restoreCounters = countCalls(world);
            const before = snapshot();
            if (phase === 'title') {
              samples.push({ ...before, label: 'title' });
              if (samples.length > 40) samples.shift();
            }
            await window.captureNativeProfile('start', { phase, before });
            captureStarted = true;
          }
          result = await original.call(this, count);
        } catch (error) {
          failure = error;
          failed = true;
        } finally {
          restoreCounters?.();
          if (captureStarted) {
            try {
              await window.captureNativeProfile('stop', { phase, after: snapshot() });
            } catch (error) {
              if (!failed) {
                failure = error;
                failed = true;
              }
              observerErrors.push(String(error));
              if (observerErrors.length > 10) observerErrors.shift();
            }
          }
        }
        if (failed) throw failure;
        return result;
      };
    },
  });
  if (existingFrameFunction) window.nativeGameFrame = existingFrameFunction;
}

// Install before application scripts. This observer schedules its own callbacks;
// it never replaces RAF, advances the guest, or calls render/present itself.
export function observeRealRAF({ sampleLimit = 4096 } = {}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 2 || sampleLimit > 16384)
    throw new RangeError('Invalid RAF sample limit');
  const observations = window.nativePerformance,
    request = window.requestAnimationFrame,
    cancel = window.cancelAnimationFrame,
    now = () => window.performance.now(),
    document = window.document,
    results = new Map(),
    scenes = new Set(['logo', 'title', 'dialogue', 'm2', 'dense-effects', 'owned-control']);
  if (!observations || typeof request !== 'function' || typeof cancel !== 'function')
    throw new Error('Real RAF observation requires the method observer and browser RAF');
  let active;
  const metric = () => ({ count: 0, totalMS: 0, maxMS: 0, aboveFrameBudget: 0, samples: [] });
  const add = (entry, ms) => {
    entry.count++;
    entry.totalMS += ms;
    entry.maxMS = Math.max(entry.maxMS, ms);
    if (ms > 1000 / 60) entry.aboveFrameBudget++;
    entry.samples.push(ms);
    if (entry.samples.length > sampleLimit) entry.samples.shift();
  };
  const describe = (entry) => {
    const sorted = [...entry.samples].sort((a, b) => a - b);
    return {
      count: entry.count,
      meanMS: entry.count ? entry.totalMS / entry.count : null,
      maxMS: entry.count ? entry.maxMS : null,
      aboveFrameBudget: { budgetMS: 1000 / 60, count: entry.aboveFrameBudget },
      recent: {
        count: sorted.length,
        p95MS: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
        population: 'last completed observations, bounded by sampleLimit',
      },
    };
  };
  const facts = (value, depth = 0, budget = { remaining: 128 }) => {
    if (depth > 4 || --budget.remaining < 0) throw new Error('Scene evidence is too large');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^[a-z0-9_.:#/-]{1,80}$/i.test(value)) return value;
    if (Array.isArray(value) && value.length <= 64)
      return value.map((v) => facts(v, depth + 1, budget));
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      const entries = Object.entries(value);
      if (entries.length > 64) throw new Error('Scene evidence has too many fields');
      return Object.fromEntries(
        entries.map(([key, v]) => {
          if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(key))
            throw new Error('Invalid scene evidence field');
          return [key, facts(v, depth + 1, budget)];
        }),
      );
    }
    throw new Error('Scene evidence must contain bounded numeric facts and identifiers');
  };
  const conditions = () => {
    const engine = window.catSystem2,
      gl = engine?.stageRenderer?.gpu?.gl;
    let graphics = null;
    if (gl)
      try {
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        graphics = {
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
          unmaskedVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
          unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
        };
      } catch {
        graphics = { unavailable: true };
      }
    return {
      visibility: document?.visibilityState ?? null,
      focused: document?.hasFocus?.() ?? null,
      viewport: { width: window.innerWidth ?? null, height: window.innerHeight ?? null },
      devicePixelRatio: window.devicePixelRatio ?? null,
      renderer: engine?.renderer?.constructor?.name ?? null,
      graphics,
      userAgent: window.navigator?.userAgent ?? null,
      hardwareConcurrency: window.navigator?.hardwareConcurrency ?? null,
      deviceMemoryGiB: window.navigator?.deviceMemory ?? null,
      crossOriginIsolated: window.crossOriginIsolated ?? null,
      timeOrigin: window.performance.timeOrigin ?? null,
    };
  };
  const overridden = () =>
    window.requestAnimationFrame !== request ||
    window.cancelAnimationFrame !== cancel ||
    typeof window.nativeGameFrame === 'function';
  const start = ({ scene, criteria, probe, durationMS = 5000 }) => {
    if (!scenes.has(scene)) throw new Error('Unknown RAF scene');
    if (active || results.has(scene)) throw new Error('RAF scene already sampled or active');
    if (!Number.isFinite(durationMS) || durationMS < 1 || durationMS > 60000)
      throw new RangeError('Invalid RAF sample duration');
    if (typeof criteria !== 'string' || !criteria.length || criteria.length > 160)
      throw new Error('A concrete scene arrival criterion is required');
    if (typeof probe !== 'function') throw new Error('A read-only scene arrival probe is required');
    if (overridden()) throw new Error('Controlled or replaced RAF cannot be sampled as real RAF');
    if (document?.visibilityState !== 'visible') throw new Error('RAF scene is not visible');
    const beforeProbe = probe();
    if (beforeProbe?.arrived !== true) throw new Error('Requested RAF scene has not arrived');
    const arrival = facts(beforeProbe.facts);
    if (
      !arrival ||
      Array.isArray(arrival) ||
      typeof arrival !== 'object' ||
      !Object.keys(arrival).length
    )
      throw new Error('Scene arrival requires actual observed facts');
    const engine = window.catSystem2,
      world = engine?.world,
      renderer = engine?.renderer;
    if (!engine || !world) throw new Error('RAF scene has no ordinary Core/World owner');
    observations.attach(engine);
    const before = observations.snapshot(),
      environment = conditions(),
      startedMS = now(),
      methods = Object.fromEntries(
        ['step', 'render', 'present', 'tick', 'snapshot'].map((n) => [n, metric()]),
      ),
      failures = Object.fromEntries(Object.keys(methods).map((n) => [n, 0])),
      intervals = { raf: metric(), render: metric(), present: metric() },
      last = {},
      boundaries = { excludedCallsStartedBeforeWindow: 0 },
      frame = { callbacks: 0, firstTimestampMS: null, lastTimestampMS: null },
      hidden = { observed: false };
    let timer,
      callback,
      resolveResult,
      observerMS = 0,
      latestProbe = arrival;
    const result = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const visibility = () => {
      if (document?.visibilityState !== 'visible') hidden.observed = true;
    };
    const finish = (completion) => {
      if (active?.finish !== finish) return;
      const stoppedMS = now();
      unsubscribe();
      window.clearTimeout(timer);
      if (callback !== undefined) cancel.call(window, callback);
      document?.removeEventListener?.('visibilitychange', visibility);
      active = null;
      const after = observations.snapshot(),
        finalConditions = conditions(),
        frameDelta =
          Number.isSafeInteger(before.frame) &&
          Number.isSafeInteger(after.frame) &&
          after.frame >= before.frame
            ? after.frame - before.frame
            : null,
        stableOwner = window.catSystem2 === engine && engine.world === world,
        stableRenderer = engine.renderer === renderer,
        stableRAF = !overridden(),
        elapsedMS = stoppedMS - startedMS,
        rafSpanMS = frame.callbacks > 1 ? frame.lastTimestampMS - frame.firstTimestampMS : null,
        stableViewport =
          environment.viewport.width === finalConditions.viewport.width &&
          environment.viewport.height === finalConditions.viewport.height &&
          environment.devicePixelRatio === finalConditions.devicePixelRatio,
        valid =
          completion === 'complete' &&
          stableOwner &&
          stableRenderer &&
          stableRAF &&
          stableViewport &&
          !hidden.observed &&
          finalConditions.visibility === 'visible' &&
          frame.callbacks > 1 &&
          frameDelta > 0 &&
          methods.render.count > 0 &&
          Object.values(failures).every((n) => n === 0);
      const record = {
        scene,
        criteria,
        arrival,
        finalSceneFacts: latestProbe,
        completion,
        validCapture: valid,
        targetFPSAssessment: null,
        startedMS,
        stoppedMS,
        elapsedMS,
        requestedDurationMS: durationMS,
        sampleLimit,
        worldFrames: { before: before.frame ?? null, after: after.frame ?? null },
        runtimeAdvance: {
          worldFrameDelta: frameDelta,
          didAdvance: frameDelta > 0,
          successfulStepCalls: methods.step.count - failures.step,
          successfulTickCalls: methods.tick.count - failures.tick,
          guestFramesPerSecond:
            elapsedMS > 0 && frameDelta !== null ? (frameDelta * 1000) / elapsedMS : null,
        },
        raf: {
          ...frame,
          callbacksPerSecond: rafSpanMS > 0 ? ((frame.callbacks - 1) * 1000) / rafSpanMS : null,
        },
        completedPerSecond: {
          render:
            elapsedMS > 0 ? ((methods.render.count - failures.render) * 1000) / elapsedMS : null,
          present:
            elapsedMS > 0 && typeof renderer?.present === 'function'
              ? ((methods.present.count - failures.present) * 1000) / elapsedMS
              : null,
        },
        intervals: Object.fromEntries(Object.entries(intervals).map(([n, v]) => [n, describe(v)])),
        methodTimings: Object.fromEntries(
          Object.entries(methods).map(([n, v]) => [n, describe(v)]),
        ),
        methodFailures: failures,
        boundaries,
        observerMS,
        conditions: {
          before: environment,
          after: finalConditions,
          stableOwner,
          stableRenderer,
          stableRAF,
          stableViewport,
          hiddenDuringWindow: hidden.observed,
        },
        memory: {
          before: before.jsHeap,
          after: after.jsHeap,
          scope: 'browser JS heap when exposed; GPU/audio/worker total memory is unavailable',
        },
        resources: {
          before: before.resources,
          after: after.resources,
          scope:
            'live counts, sum of referenced RGBA view lengths, and unique referenced backing-buffer lengths (including unused bytes); not GPU/audio/worker or total memory',
        },
        presentation: {
          methodAvailable: typeof renderer?.present === 'function',
          observed: 'completion of the existing renderer.present method',
          physicalDisplayTimestamps: null,
          note: 'RAF callbacks, render completion and Canvas present calls do not prove physical scanout or 60fps.',
        },
      };
      results.set(scene, record);
      resolveResult(record);
      const sinkFailure = () => {
        observations.observerErrors.push('RAF evidence sink failed');
        if (observations.observerErrors.length > 10) observations.observerErrors.shift();
      };
      if (typeof window.captureNativeRAF === 'function')
        try {
          Promise.resolve(window.captureNativeRAF(record)).catch(sinkFailure);
        } catch {
          sinkFailure();
        }
    };
    const unsubscribe = observations.subscribe((event) => {
      if (event.startedMS < startedMS) {
        boundaries.excludedCallsStartedBeforeWindow++;
        return;
      }
      if (!methods[event.method]) return;
      add(methods[event.method], event.durationMS);
      if (event.failed) {
        failures[event.method]++;
        return;
      }
      if (event.method === 'render' || event.method === 'present') {
        if (last[event.method] !== undefined)
          add(intervals[event.method], event.settledMS - last[event.method]);
        last[event.method] = event.settledMS;
      }
    });
    const observe = (timestamp) => {
      const started = now();
      if (active?.finish !== finish) return;
      if (overridden()) return finish('RAF-replaced');
      if (window.catSystem2 !== engine || engine.world !== world) return finish('owner-changed');
      visibility();
      try {
        const current = probe();
        if (current?.arrived !== true) return finish('scene-left');
        latestProbe = facts(current.facts);
      } catch {
        return finish('scene-probe-failed');
      }
      if (
        !Number.isFinite(timestamp) ||
        (frame.lastTimestampMS !== null && timestamp <= frame.lastTimestampMS)
      )
        return finish('nonmonotonic-RAF');
      frame.callbacks++;
      frame.firstTimestampMS ??= timestamp;
      if (frame.lastTimestampMS !== null) add(intervals.raf, timestamp - frame.lastTimestampMS);
      frame.lastTimestampMS = timestamp;
      observerMS += now() - started;
      if (now() - startedMS >= durationMS) return finish('complete');
      callback = request.call(window, observe);
    };
    active = { finish };
    document?.addEventListener?.('visibilitychange', visibility);
    timer = window.setTimeout(() => finish('complete'), durationMS);
    callback = request.call(window, observe);
    return result;
  };
  const baseline = ({ durationMS = 1000 } = {}) => {
    if (active || results.has('raf-baseline'))
      throw new Error('RAF baseline already sampled or active');
    if (!Number.isFinite(durationMS) || durationMS < 1 || durationMS > 60000)
      throw new RangeError('Invalid RAF baseline duration');
    if (overridden() || document?.visibilityState !== 'visible')
      throw new Error('RAF baseline requires a visible, unchanged native clock');
    const engine = window.catSystem2,
      world = engine?.world,
      renderer = engine?.renderer;
    if (engine) observations.attach(engine);
    const before = observations.snapshot(),
      environment = conditions(),
      startedMS = now(),
      intervals = metric();
    let callbacks = 0,
      firstTimestampMS = null,
      lastTimestampMS = null,
      methodCalls = 0,
      hidden = false,
      timer,
      callback,
      resolveResult;
    const pending = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const visibility = () => {
      if (document?.visibilityState !== 'visible') hidden = true;
    };
    const finish = (completion) => {
      if (active?.finish !== finish) return;
      const stoppedMS = now();
      unsubscribe();
      window.clearTimeout(timer);
      if (callback !== undefined) cancel.call(window, callback);
      document?.removeEventListener?.('visibilitychange', visibility);
      active = null;
      const after = observations.snapshot(),
        afterConditions = conditions(),
        stableOwner =
          window.catSystem2 === engine && engine?.world === world && engine?.renderer === renderer,
        sameFrame = before.frame === after.frame,
        stableViewport =
          environment.viewport.width === afterConditions.viewport.width &&
          environment.viewport.height === afterConditions.viewport.height &&
          environment.devicePixelRatio === afterConditions.devicePixelRatio,
        valid =
          completion === 'complete' &&
          !overridden() &&
          stableOwner &&
          stableViewport &&
          !hidden &&
          afterConditions.visibility === 'visible' &&
          methodCalls === 0 &&
          sameFrame &&
          callbacks > 1,
        span = callbacks > 1 ? lastTimestampMS - firstTimestampMS : null;
      const record = {
        scene: 'raf-baseline',
        scope: 'environment idle RAF baseline; not a target scene or 60fps result',
        validBaseline: valid,
        validCapture: false,
        targetFPSAssessment: null,
        completion,
        requestedDurationMS: durationMS,
        startedMS,
        stoppedMS,
        elapsedMS: stoppedMS - startedMS,
        raf: {
          callbacks,
          firstTimestampMS,
          lastTimestampMS,
          callbacksPerSecond: span > 0 ? ((callbacks - 1) * 1000) / span : null,
        },
        intervals: describe(intervals),
        sampleLimit,
        runtime: { mounted: Boolean(engine), observedMethodCalls: methodCalls, sameFrame },
        conditions: {
          before: environment,
          after: afterConditions,
          stableOwner,
          stableViewport,
          hiddenDuringWindow: hidden,
        },
        note: 'Use the same page/browser/renderer configuration as target windows; unavailable pre-mount renderer information stays null.',
      };
      results.set('raf-baseline', record);
      resolveResult(record);
      if (typeof window.captureNativeRAF === 'function')
        try {
          Promise.resolve(window.captureNativeRAF(record)).catch(() => {
            observations.observerErrors.push('RAF baseline evidence sink failed');
            if (observations.observerErrors.length > 10) observations.observerErrors.shift();
          });
        } catch {
          observations.observerErrors.push('RAF baseline evidence sink failed');
          if (observations.observerErrors.length > 10) observations.observerErrors.shift();
        }
    };
    const unsubscribe = observations.subscribe(() => {
      methodCalls++;
    });
    const observe = (timestamp) => {
      if (active?.finish !== finish) return;
      visibility();
      if (overridden()) return finish('RAF-replaced');
      if (!Number.isFinite(timestamp) || (lastTimestampMS !== null && timestamp <= lastTimestampMS))
        return finish('nonmonotonic-RAF');
      callbacks++;
      firstTimestampMS ??= timestamp;
      if (lastTimestampMS !== null) add(intervals, timestamp - lastTimestampMS);
      lastTimestampMS = timestamp;
      if (now() - startedMS >= durationMS) return finish('complete');
      callback = request.call(window, observe);
    };
    active = { finish };
    document?.addEventListener?.('visibilitychange', visibility);
    timer = window.setTimeout(() => finish('complete'), durationMS);
    callback = request.call(window, observe);
    return pending;
  };
  window.nativeRAF = {
    start,
    baseline,
    stop: () => active?.finish('stopped'),
    snapshot: () => [...results.values()],
    scope: 'read-only real RAF scenes; arrival predicates belong to the actual scene driver',
  };
}

export function performanceMachineConditions() {
  const processors = cpus();
  return {
    platform: platform(),
    release: release(),
    architecture: arch(),
    logicalCPUs: processors.length,
    cpuModels: [...new Set(processors.map((cpu) => cpu.model))],
    physicalMemoryBytes: totalmem(),
    node: process.version,
  };
}

export const test = base.extend({
  page: async ({ page }, use, info) => {
    if (process.env.CATSYSTEM2_RAF_PROFILE) {
      if (process.env.CATSYSTEM2_TICK_PROFILE)
        throw new Error('Real RAF sampling and controlled CPU profiling require separate runs');
      const directory = resolve(process.env.CATSYSTEM2_RAF_PROFILE),
        prefix = info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 72),
        writes = [],
        sinkErrors = [];
      await mkdir(directory, { recursive: true });
      await page.exposeFunction('captureNativeRAF', (record) => {
        if (
          ![
            'logo',
            'title',
            'dialogue',
            'm2',
            'dense-effects',
            'owned-control',
            'raf-baseline',
          ].includes(record.scene)
        )
          throw new Error('Unknown RAF report scene');
        const writing = writeFile(
          resolve(directory, `${prefix}-${record.scene}.json`),
          JSON.stringify({ ...record, captureSession: info.testId }, null, 2),
        );
        writes.push(
          writing.catch(() => {
            sinkErrors.push('RAF evidence write failed');
          }),
        );
        return writing;
      });
      await page.addInitScript({
        content: `(${observeFrames.toString()})();\n(${observeRealRAF.toString()})();`,
      });
      let observationError;
      try {
        await use(page);
      } finally {
        let evidence = { pageClosed: page.isClosed(), scenes: null };
        if (!page.isClosed())
          evidence = await page.evaluate(() => {
            window.nativeRAF?.stop();
            return {
              pageClosed: false,
              scenes: window.nativeRAF?.snapshot() ?? null,
              observerErrors: window.nativePerformance?.observerErrors ?? null,
            };
          });
        await Promise.all(writes);
        evidence.sinkErrors = sinkErrors;
        evidence.capture = {
          session: info.testId,
          machine: performanceMachineConditions(),
          browserVersion: page.context().browser()?.version() ?? null,
          browserName: info.project.use.browserName ?? 'chromium',
          headless: info.project.use.headless ?? true,
          viewport: info.project.use.viewport ?? null,
          browserArguments: info.project.use.launchOptions?.args ?? [],
          CDPProfiler: false,
          targetFPSAssessment: null,
        };
        await writeFile(
          resolve(directory, `${prefix}-raf.json`),
          JSON.stringify(evidence, null, 2),
        );
        if (
          info.status === info.expectedStatus &&
          (evidence.observerErrors?.length || sinkErrors.length)
        )
          observationError = new Error('Real RAF observation failed; see bounded observer errors');
      }
      if (observationError) throw observationError;
      return;
    }
    if (!process.env.CATSYSTEM2_TICK_PROFILE) return use(page);
    const directory = resolve(process.env.CATSYSTEM2_TICK_PROFILE);
    await mkdir(directory, { recursive: true });
    const prefix = info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 72);
    const session = await page.context().newCDPSession(page);
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 5000 });
    let before;
    await page.exposeFunction('captureNativeProfile', async (event, detail) => {
      if (event === 'start') {
        before = detail;
        await session.send('Profiler.start');
      } else {
        const { profile } = await session.send('Profiler.stop');
        await writeFile(
          resolve(directory, `${prefix}-${detail.phase}.json`),
          JSON.stringify({ ...before, ...detail, profile }),
        );
        console.log('profile captured', detail.phase, detail.after.frame);
      }
    });
    await page.addInitScript(observeFrames);
    let observationError;
    try {
      await use(page);
    } finally {
      if (!page.isClosed()) {
        const evidence = await page.evaluate(() => ({
          current: window.nativePerformance?.snapshot(),
          samples: window.nativePerformance?.samples,
          slowTicks: window.nativePerformance?.slowTicks,
          frameMetrics: window.nativeFrameMetrics,
        }));
        evidence.capture = {
          browserName: info.project.use.browserName ?? 'chromium',
          headless: info.project.use.headless ?? true,
          viewport: info.project.use.viewport ?? null,
          browserArguments: info.project.use.launchOptions?.args ?? [],
          profilerSamplingIntervalUS: 5000,
        };
        await writeFile(
          resolve(directory, `${prefix}-metrics.json`),
          JSON.stringify(evidence, null, 2),
        );
        if (info.status === info.expectedStatus && evidence.current?.observerErrors.length)
          observationError = new Error(
            `Performance observation failed: ${evidence.current.observerErrors.join('; ')}`,
          );
      }
      if (!page.isClosed()) await session.detach();
    }
    if (observationError) throw observationError;
  },
});
export { expect };
