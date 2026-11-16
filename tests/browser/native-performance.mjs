// SPDX-License-Identifier: MPL-2.0
// Opt-in observations of production methods. Explicit original owners keep CPU counters.
import { test as base, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function observeFrames({ sampleLimit = 256 } = {}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 4096)
    throw new RangeError('Invalid performance sample limit');
  const now = () => (window.performance ?? performance).now();
  let frameFunction;
  const existingFrameFunction = window.nativeGameFrame,
    engines = new WeakSet(),
    worlds = new WeakSet(),
    captured = new Set(),
    samples = [],
    slowTicks = [],
    observerErrors = [],
    totals = { ticks: 0, tickMS: 0, snapshots: 0, snapshotMS: 0 };
  const timing = () => ({ calls: 0, totalMS: 0, maxMS: 0, samples: [] }),
    timings = { step: timing(), render: timing(), tick: timing(), snapshot: timing() };
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
      bitmapPixels = { knownBytes: 0, unavailable: 0 };
    if (records)
      for (const { type, value } of records.values()) {
        handles[type] = (handles[type] ?? 0) + 1;
        if (type === 'bitmap-data') {
          if (ArrayBuffer.isView(value.rgba)) bitmapPixels.knownBytes += value.rgba.byteLength;
          else bitmapPixels.unavailable++;
        }
      }
    return {
      objects: world?.objects?.objects?.size ?? null,
      tasks: world?.runtime?.scheduler?.tasks?.size ?? null,
      handles: records ? handles : null,
      bitmapPixels: records ? bitmapPixels : null,
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
  const recordTiming = (name, started) => {
    const ms = now() - started;
    if (!Number.isFinite(ms) || ms < 0) return;
    const entry = timings[name];
    entry.calls++;
    entry.totalMS += ms;
    entry.maxMS = Math.max(entry.maxMS, ms);
    entry.samples.push(ms);
    if (entry.samples.length > sampleLimit) entry.samples.shift();
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
      const finish = () => {
        try {
          recordTiming(name, started);
        } catch (error) {
          observerErrors.push(String(error));
          if (observerErrors.length > 10) observerErrors.shift();
        }
      };
      try {
        result = original.apply(this, args);
      } catch (error) {
        finish();
        throw error;
      }
      if (result && typeof result.then === 'function') result.then(finish, finish);
      else finish();
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

export const test = base.extend({
  page: async ({ page }, use, info) => {
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
