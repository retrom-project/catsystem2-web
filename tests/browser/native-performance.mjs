// SPDX-License-Identifier: MPL-2.0
// Opt-in, read-only host observations. The original EXE receives no new hooks.
import { test as base, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function observeFrames() {
  let frameFunction, currentWorld;
  const existingFrameFunction = window.nativeGameFrame;
  const captured = new Set();
  const totals = {
    emuStart: 0,
    emuMS: 0,
    wasmCalls: 0,
    maps: 0,
    unmaps: 0,
    protects: 0,
    invalidations: 0,
    reads: 0,
    readBytes: 0,
    writes: 0,
    writeBytes: 0,
    snapshots: 0,
    snapshotMS: 0,
  };
  const samples = [],
    slowTicks = [];
  const sizes = (object) =>
    Object.fromEntries(
      Object.entries(object ?? {})
        .filter(([, value]) => value instanceof Map || value instanceof Set || Array.isArray(value))
        .map(([key, value]) => [key, value.size ?? value.length]),
    );
  const snapshot = () => {
    const engine = window.catSystem2,
      world = engine?.world,
      native = world?.nativeEngine,
      process = native?.process;
    if (!process) return { frame: world?.frame };
    let liveBytes = 0;
    for (const bytes of process.allocations.values()) liveBytes += bytes;
    const heap = process.regions.find((region) => region.kind === 'heap');
    return {
      frame: world.frame,
      stack: engine.status().stack,
      liveBytes,
      allocationCount: process.allocations.size,
      heapExtent: process.heap - heap.address,
      capacity: process.heapLimit - heap.address,
      freeBlocks: process.freeBlocks.length,
      largestFreeBlock: Math.max(0, ...process.freeBlocks.map((block) => block.size)),
      maps: {
        engine: sizes(engine),
        world: sizes(world),
        runtime: sizes(world.runtime),
        graphics: sizes(world.graphics),
        process: sizes(process),
        kernel: sizes(native.kernel),
        features: Object.fromEntries(
          [...native.features].map(([name, value]) => [name, sizes(value)]),
        ),
      },
      handles: Object.fromEntries(
        [...world.runtime.handles.records.values()].reduce(
          (counts, record) => counts.set(record.type, (counts.get(record.type) ?? 0) + 1),
          new Map(),
        ),
      ),
      diagnostics: engine.nativeDiagnostics?.length ?? 0,
      logs: engine.nativeLog?.length ?? 0,
      trace: Boolean(native.options.trace),
      singleStep: process.singleStep,
      counters: { ...totals },
    };
  };
  const countCalls = (world) => {
    const restorations = [];
    const count = (owner, method, key, bytesKey, timedKey) => {
      const original = owner[method];
      owner[method] = function (...args) {
        totals[key]++;
        if (bytesKey) totals[bytesKey] += typeof args[1] === 'number' ? args[1] : args[1].length;
        const started = timedKey && performance.now();
        try {
          return original.apply(this, args);
        } finally {
          if (timedKey) totals[timedKey] += performance.now() - started;
        }
      };
      restorations.push(() => {
        owner[method] = original;
      });
    };
    const process = world.nativeEngine.process;
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
  const attach = (world) => {
    const tick = world.tick;
    world.tick = async function (...args) {
      const started = performance.now();
      try {
        return await tick.apply(this, args);
      } finally {
        const ms = performance.now() - started,
          frame = this.frame;
        if (slowTicks.length < 10 || ms > slowTicks.at(-1).ms) {
          slowTicks.push({ frame, ms, stack: window.catSystem2.status().stack });
          slowTicks.sort((a, b) => b.ms - a.ms);
          slowTicks.length = Math.min(10, slowTicks.length);
        }
        if ([577, 1061].includes(frame) || frame % 120 === 1) {
          samples.push(snapshot());
          if (samples.length > 40) samples.shift();
        }
      }
    };
    const engine = window.catSystem2,
      takeSnapshot = engine.snapshot;
    engine.snapshot = async function (...args) {
      const started = performance.now();
      totals.snapshots++;
      try {
        return await takeSnapshot.apply(this, args);
      } finally {
        totals.snapshotMS += performance.now() - started;
      }
    };
  };
  window.nativePerformance = { totals, samples, slowTicks, snapshot };
  Object.defineProperty(window, 'nativeGameFrame', {
    configurable: true,
    get: () => frameFunction,
    set(original) {
      frameFunction = async (count) => {
        const world = window.catSystem2?.world;
        if (world?.nativeEngine && world !== currentWorld) {
          attach(world);
          currentWorld = world;
        }
        const frame = world?.frame ?? 0,
          stack = window.catSystem2?.status().stack ?? [];
        let phase;
        if (frame >= 121 && frame < 200) phase = 'logo';
        if (stack.includes('title#WAIT')) phase = 'title';
        if (frame < 577 && frame + count >= 577) phase = 'model-change';
        if (frame >= 601 && frame < 610) phase = 'dialogue-early';
        if (frame >= 961 && frame < 970) phase = 'dialogue-late';
        if (frame < 1061 && frame + count >= 1061) phase = 'model-late';
        if (phase && captured.has(phase)) phase = null;
        let restoreCounters;
        if (phase) {
          captured.add(phase);
          restoreCounters = countCalls(world);
          const before = snapshot();
          if (phase === 'title') samples.push({ ...before, label: 'title' });
          await window.captureNativeProfile('start', { phase, before });
        }
        try {
          return await original(count);
        } finally {
          restoreCounters?.();
          if (phase) await window.captureNativeProfile('stop', { phase, after: snapshot() });
        }
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
        await writeFile(
          resolve(directory, `${prefix}-metrics.json`),
          JSON.stringify(evidence, null, 2),
        );
      }
      if (!page.isClosed()) await session.detach();
    }
  },
});
export { expect };
