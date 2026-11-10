// SPDX-License-Identifier: MPL-2.0
import { expect } from '@playwright/test';
import { ProgressBudget, FrameBudgetReached } from './progress-budget.mjs';
const progress = new WeakMap();
const budgets = new WeakMap();

export async function progressAcceptance(page, info, name, run) {
  const budget = new ProgressBudget(process.env.CATSYSTEM2_FULL_ACCEPTANCE ? null : name);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  budgets.set(page, budget);
  // Every frame batch has the remaining three-minute no-progress deadline.
  // Long guest ticks are bounded even when the browser event loop cannot yield.
  info.setTimeout(0);
  try {
    await run();
  } catch (error) {
    await info.attach('progress.json', {
      body: JSON.stringify(budget.last, null, 2),
      contentType: 'application/json',
    });
    if (!(error instanceof FrameBudgetReached)) {
      await page.context().close();
      throw error;
    }
    expect(budget.last.unsupported).toEqual([]);
    expect(errors).toEqual([]);
    info.annotations.push({ type: 'progress-gate', description: JSON.stringify(budget.point) });
    console.log('accepted progress gate', error.evidence);
  } finally {
    budgets.delete(page);
  }
}

export async function frameClock(page) {
  await page.addInitScript(
    ({ measure }) => {
      const queue = new Map();
      let sequence = 0,
        time;
      // Drive the app's own RAF loop. Native task ticks, input, audio and
      // rendering all still run in their production order.
      window.requestAnimationFrame = (callback) => {
        time ??= performance.now();
        queue.set(++sequence, callback);
        return sequence;
      };
      window.cancelAnimationFrame = (id) => queue.delete(id);
      let measuredEngine, measuredWorld, tracedRuntime;
      window.nativeRecentCalls = [];
      const metric = () => ({ calls: 0, totalMS: 0, maxMS: 0 });
      const stats = { callbacks: 0, frame: 0, step: metric(), render: metric(), tick: metric() };
      const instrument = (owner, name, entry) => {
        const original = owner[name];
        owner[name] = async function (...args) {
          const started = performance.now();
          try {
            return await original.apply(this, args);
          } finally {
            const elapsed = performance.now() - started;
            entry.calls++;
            entry.totalMS += elapsed;
            entry.maxMS = Math.max(entry.maxMS, elapsed);
          }
        };
      };
      if (measure) window.nativeFrameMetrics = stats;
      window.nativeGameFrame = async (count) => {
        const engine = window.catSystem2;
        if (engine?.world?.runtime && engine.world.runtime !== tracedRuntime) {
          const runtime = engine.world.runtime,
            native = runtime.native;
          runtime.native = function (table, id, args, machine, task, ...rest) {
            window.nativeRecentCalls.push({ table, id, script: task.name, pc: machine.pc });
            if (window.nativeRecentCalls.length > 16) window.nativeRecentCalls.shift();
            return native.call(this, table, id, args, machine, task, ...rest);
          };
          tracedRuntime = runtime;
        }
        if (measure && engine && engine !== measuredEngine) {
          instrument(engine, 'step', stats.step);
          instrument(engine, 'render', stats.render);
          measuredEngine = engine;
        }
        if (measure && engine?.world && engine.world !== measuredWorld) {
          instrument(engine.world, 'tick', stats.tick);
          measuredWorld = engine.world;
        }
        const entry = queue.entries().next().value;
        if (!entry) throw new Error('The game is not scheduling browser frames');
        const [id, callback] = entry;
        queue.delete(id);
        time += (count * 1000) / 60;
        await callback(time);
        if (measure) {
          stats.callbacks++;
          stats.frame = window.catSystem2?.world?.frame ?? 0;
        }
      };
    },
    { measure: Boolean(process.env.CATSYSTEM2_FRAME_METRICS) },
  );
}

export const state = (page) =>
  page.evaluate(() => {
    const e = window.catSystem2,
      scenes = [...(e?.world?.runtime.handles.records ?? [])]
        .filter(([, record]) => record.type === 'scene-data')
        .map(([handle, { value }]) => ({
          handle,
          scene: value.reader.filename,
          block: value.reader.block,
          line: value.reader.line,
        })),
      text = [...(e?.world?.objects.objects.values() ?? [])]
        .filter((record) => record.implementation.text)
        .map((record) => {
          const text = record.implementation.text;
          return { id: record.id, source: text.source, elapsed: text.elapsed, active: text.active };
        }),
      tasks = [...(e?.world?.runtime.scheduler.tasks.values() ?? [])].map((task) => {
        const reader = e.world.runtime.sceneData(task)?.reader;
        return {
          name: task.name,
          pc: task.machine.pc,
          scene: reader?.filename,
          block: reader?.block,
          line: reader?.line,
        };
      });
    return {
      frame: e?.world?.frame,
      profile: e?.nativeProfile,
      source: e?.identity,
      stack: e?.status().stack,
      unsupported: e?.status().unsupported,
      error: document.getElementById('error').textContent,
      messages: window.routeTrace?.messages.size,
      position: { stack: e?.status().stack, tasks, scenes, text },
      recentNative: window.nativeRecentCalls,
      heap: window.nativePerformance?.snapshot(),
    };
  });

export async function step(page, count = 1) {
  const budget = budgets.get(page);
  let timer;
  try {
    const operation = page.evaluate((count) => window.nativeGameFrame(count), count);
    if (budget)
      await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Native acceptance wall stall ${JSON.stringify(budget.last)}`)),
            budget.remainingWallMS(),
          );
        }),
      ]);
    else await operation;
  } finally {
    clearTimeout(timer);
  }
  const result = await state(page);
  expect(result.error, JSON.stringify(result)).toBe('');
  budget?.observe(result);
  if (process.env.CATSYSTEM2_FRAME_METRICS) {
    const bucket = Math.floor((result.frame ?? 0) / 120);
    if (progress.get(page) !== bucket) {
      progress.set(page, bucket);
      console.log(
        'native frame progress',
        await page.evaluate(() => window.nativeFrameMetrics),
        result.stack,
      );
    }
  }
  return result;
}

export async function until(page, label, maxFrames) {
  let result = await state(page);
  const limit = result.frame + maxFrames;
  while (!result.stack?.includes(label) && result.frame < limit) result = await step(page, 6);
  expect(result.stack, JSON.stringify(result)).toContain(label);
  expect(result.unsupported).toEqual([]);
  return result;
}

export async function hoverNativeButton(page, name) {
  const point = await page.evaluate((key) => {
    const e = window.catSystem2,
      player = e.activeFES(),
      object = player?.root.byKey.get(key),
      region = object && e.world.inputFor(player.root.runtimeID)?.get(object.nativeInputTaskID);
    if (!region) throw new Error(`No native input region for ${key}`);
    const canvas = document.getElementById('screen').getBoundingClientRect(),
      [left, top, right, bottom] = region.bounds;
    return {
      x: canvas.x + ((left + right) * canvas.width) / (2 * e.game.width),
      y: canvas.y + ((top + bottom) * canvas.height) / (2 * e.game.height),
    };
  }, name);
  await page.mouse.move(point.x, point.y);
  await step(page, 2);
}

export async function clickNativeButton(page, name) {
  await hoverNativeButton(page, name);
  await page.mouse.down();
  await step(page, 2);
  await page.mouse.up();
  await step(page, 2);
  await page.mouse.move(1, 1);
}

export async function pixels(page) {
  return page.evaluate(async () => {
    const { canvas, context } = window.catSystem2.renderer,
      { data } = context.getImageData(0, 0, canvas.width, canvas.height),
      colors = new Set();
    for (let i = 0; i < data.length; i += 1024)
      colors.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return { colors: colors.size, sha256: hash.toHex() };
  });
}

export function startupWindow(page) {
  return page.evaluate(() => {
    const { world } = window.catSystem2,
      { process: p, kernel, refs, features } = world.nativeEngine,
      handle = world.window.handle,
      view = kernel.windowViews.windows.get(handle),
      owner = view?.userData,
      input = refs.inputDevice,
      sdk = world.profile.startsWith('sdk-'),
      startup = sdk ? 0xcb2440 : 0xbafa80,
      sound = p.load(startup + 12),
      backend = sound && p.load(sound + 108),
      workerID = backend && kernel.threadHandles.handles.get(p.load(backend + 12))?.id,
      worker = kernel.threadHandles.threads.get(workerID),
      graphics = refs.applicationGraphics,
      renderView = p.load(startup + 20),
      renderWorker = kernel.threadHandles.threads.get(
        kernel.threadHandles.handles.get(graphics?.handle)?.id,
      ),
      top = world.objects.objects.get(world.root),
      bindings = features.get('task-memory')?.refs.entries;
    return {
      handle,
      client: view?.client.slice(2),
      nativeTitle: Boolean(view?.title && view.title === document.title),
      inputOwner: Boolean(owner && input?.pointer && p.load(owner + 8) === input.pointer),
      acceleratorCount: owner && kernel.accelerators.tables.get(p.load(owner + 12))?.rows.length,
      applicationHook: refs.applicationWindowHook === handle,
      displayOwner: p.allocations.get(p.load(startup + 8)) === 36,
      graphicsOwner: Boolean(
        graphics &&
          p.load(startup + 4) === graphics.task &&
          renderView &&
          p.load(graphics.top + 104) === renderView &&
          features.get('renderer')?.view === renderView,
      ),
      graphicsWorker: renderWorker?.wait?.kind === 'sleep' && kernel.timerPeriods.has(1),
      graphicsTasks: Boolean(
        top &&
          bindings?.get(top.id)?.pointer === graphics?.top &&
          bindings?.get(top.implementation.input)?.pointer === graphics?.input &&
          bindings?.get(top.implementation.sound)?.pointer === graphics?.sound,
      ),
      soundBankCount: backend
        ? Array.from({ length: sdk ? 32 : 64 }, (_, index) =>
            p.load(backend + 28 + index * 4),
          ).filter((address) => p.allocations.has(address)).length
        : 0,
      soundWorker: worker?.wait?.kind === 'objects',
    };
  });
}
