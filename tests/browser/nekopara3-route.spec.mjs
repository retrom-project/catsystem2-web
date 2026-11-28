// SPDX-License-Identifier: MPL-2.0
// Private route acceptance through the ordinary NativeWorld.
import { test, expect } from './native-performance.mjs';
import { writeFile } from 'node:fs/promises';
import { launch, button, noError } from './game-helpers.mjs';
import {
  frameClock,
  guardNormalOriginalCPU,
  step,
  until,
  progressAcceptance,
  fullAcceptanceMode,
} from './native-game-input.mjs';
import { captureTerminalState } from './terminal-evidence.mjs';

const mainRouteTitle =
  'main route reaches every chapter, decodes both movies and returns to the native title';
const opening = 'nekopara3op.mp4',
  ending = 'nekopara3ed.mp4',
  movieReadySeconds = 0.25,
  eligibleCheckpoint = process.env.CATSYSTEM2_ROUTE_ED_CHECKPOINT;

test.afterEach(async ({ page }, info) => {
  if (info.title !== mainRouteTitle || !fullAcceptanceMode()) return;
  await captureTerminalState(page, info);
  if (info.status === 'passed') {
    const qualification = await committedEndingQualification(page);
    await info.attach('ending-qualification.json', {
      body: JSON.stringify({ global550: qualification }),
      contentType: 'application/json',
    });
    expect(qualification).toBe(1);
  }
});

test(mainRouteTitle, async ({ page }, info) => {
  await progressAcceptance(page, info, 'route', () => runRoute(page, info));
});

test.describe('eligible Route ending', () => {
  test.skip(!eligibleCheckpoint, 'Requires an earned .76 Route checkpoint before the eligible ED');
  test('the earned ending responds to its authored stop key', async ({ page }, info) => {
    await checkEligibleEnding(page, info);
  });
});

async function committedEndingQualification(page) {
  return page.evaluate(async () => {
    const { NativeFileStorage } = await import('/src/native/storage.mjs'),
      { NativeGlobalFile } = await import('/src/native/persistence.mjs'),
      storage = new NativeFileStorage({}, window.catSystem2.identity);
    await storage.open();
    try {
      const saved = await storage.readSaved('savegen.dat');
      if (!saved) return null;
      const file = await NativeGlobalFile.fromFile(saved),
        bank = file.records.find(({ id, bytes }) => id === 1024 && bytes.length === 2048)?.bytes;
      return bank
        ? new DataView(bank.buffer, bank.byteOffset, bank.byteLength).getUint32(
            (550 - 512) * 4,
            true,
          )
        : null;
    } finally {
      storage.close();
    }
  });
}

async function installRouteObservation(page) {
  // Observe the positions passed by the actual CST caller. Explicit readers
  // can keep their own cursor at 0/0 while the caller advances through a scene.
  await page.evaluate(async () => {
    const { NativeSceneData, NativeSceneReader } = await import('/src/native/scene-data.mjs'),
      trace = {
        scenes: new Set(),
        messages: new Set(),
        readers: new WeakMap(),
        lastMessage: null,
        movies: new Map(),
      },
      load = NativeSceneData.prototype.load,
      text = NativeSceneReader.prototype.text;
    window.routeTrace = trace;
    NativeSceneData.prototype.load = async function (name, ...args) {
      const result = await load.call(this, name, ...args);
      if (result) {
        const scene = String(name)
          .split(/[\\/]/)
          .at(-1)
          .replace(/\.cst$/i, '');
        trace.scenes.add(scene);
        trace.readers.set(this.reader, scene);
      }
      return result;
    };
    NativeSceneReader.prototype.text = function (block, line, ...args) {
      const result = text.call(this, block, line, ...args);
      const b = (block | 0) < 0 ? this.block : block | 0,
        l = (line | 0) < 0 ? this.line : line | 0;
      if (result && this.type(b, l) === 0x20) {
        const scene = trace.readers.get(this);
        trace.messages.add(`${scene}:${b}:${l}`);
        trace.lastMessage = { scene, block: b, line: l };
      }
      return result;
    };
  });
}

async function watchMovie(page, info, movie, key, qualification) {
  const start = await page.evaluate(
    ({ handle, src, readySeconds }) => {
      const { world } = window.catSystem2,
        session = world.movies.sessions.get(handle),
        video = session?.video,
        record = session?.record;
      if (
        !record?.running ||
        video?.currentSrc !== src ||
        video.paused ||
        video.ended ||
        video.readyState < 2 ||
        video.currentTime <= readySeconds
      )
        return null;
      const task = world.runtime.scheduler.tasks.get(record.owner),
        bank = world.runtime.handles.records.get(task?.context?.variableBank);
      const proof = {
        handle,
        owner: record.owner,
        script: task?.name,
        qualification: bank?.type === 'variable-bank' ? bank.value.get(550) : null,
        name: src.split('/').pop(),
        frame: world.frame,
        time: video.currentTime,
        nativePosition: Number(session.position()) / 10000000,
        duration: video.duration,
        ready: video.readyState,
        decoded: video.videoWidth > 0 && video.videoHeight > 0,
        messagesAtInput: window.routeTrace.messages.size,
      };
      const observation = { world, session, record, proof, ended: false, trustedEnd: false };
      video.addEventListener(
        'ended',
        (event) => {
          observation.ended = true;
          observation.trustedEnd = event.isTrusted;
        },
        { once: true },
      );
      window.routeTrace.movies.set(handle, observation);
      return proof;
    },
    { ...movie, readySeconds: movieReadySeconds },
  );
  await info.attach(key ? 'movie-skip-input.json' : 'movie-natural-start.json', {
    body: JSON.stringify({ observed: movie, start, key }),
    contentType: 'application/json',
  });
  expect(start, 'The original scenario must own a decoded and still-running movie').toMatchObject({
    decoded: true,
    script: 'sscript',
    ...(qualification === undefined ? {} : { qualification }),
  });
  if (key) await page.keyboard.press(key);
}

function observeRoute(page) {
  return page.evaluate(() => {
    const e = window.catSystem2,
      w = e.world,
      trace = window.routeTrace,
      sessions = w.movies.sessions;
    return {
      frame: w.frame,
      frameMetrics: window.nativeFrameMetrics,
      stack: e.status().stack,
      scenes: [...trace.scenes],
      messages: trace.messages.size,
      reader: trace.lastMessage,
      titleQualification:
        e.activeFES()?.root?.name === 'title' ? e.activeFES().root.global(550) : null,
      movies: [...sessions].flatMap(([handle, { record, video }]) =>
        record?.running && video && !video.paused && !video.ended
          ? [{ handle, src: video.currentSrc, time: video.currentTime, ready: video.readyState }]
          : [],
      ),
      nativeMovieOpen: Boolean(sessions.size || w.movies.renderGate),
      movieStops: [...trace.movies.values()].flatMap((observation) => {
        const { world, session, record, proof, ended, trustedEnd } = observation,
          current = sessions.get(proof.handle),
          retainedOwner =
            world === w && session.record === record && (!current || current === session);
        if (retainedOwner && record.running) return [];
        return [
          {
            ...proof,
            observedFrame: w.frame,
            retainedOwner,
            running: record.running,
            paused: session.video.paused,
            naturalEnd: ended || session.video.ended,
            trustedEnd,
            stoppedAt: Number(record.position) / 10000000,
            released: !sessions.has(proof.handle) && !w.runtime.handles.records.has(proof.handle),
          },
        ];
      }),
      unsupported: e.status().unsupported,
      warnings: [...e.audio.warnings],
    };
  });
}

async function assertMovieCompleted(info, stop, key) {
  await info.attach(key ? 'movie-skip-output.json' : 'movie-natural-end.json', {
    body: JSON.stringify({ ...stop, key }),
    contentType: 'application/json',
  });
  expect(stop).toMatchObject({
    retainedOwner: true,
    running: false,
    paused: true,
    naturalEnd: !key,
  });
  if (key) {
    expect(stop.stoppedAt).toBeGreaterThanOrEqual(stop.nativePosition);
    expect(stop.stoppedAt).toBeLessThan(stop.duration - movieReadySeconds);
  } else {
    expect(stop.trustedEnd).toBe(true);
    expect(stop.stoppedAt).toBeCloseTo(stop.duration, 4);
  }
}

async function runRoute(page, info) {
  const reportedScenes = new Set(),
    watched = new Set(),
    completed = new Map(),
    resumed = new Set(),
    unsupported = new Set(),
    warnings = new Set(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await launch(page, { preferences: '<MESSAGE><skip_full>1</skip_full></MESSAGE>' });
  expect(
    await page.evaluate(() =>
      new DataView(window.catSystem2.world.configuration.blocks[1].buffer).getUint32(8 * 4, true),
    ),
  ).toBe(1);
  await installRouteObservation(page);
  await button(page, 'btn1[0]');
  await until(page, 'meswnd#WAIT', 900);
  await page.keyboard.down('Control');
  let state;
  while (true) {
    await noError(page);
    state = await observeRoute(page);
    for (const scene of state.scenes)
      if (!reportedScenes.has(scene)) {
        reportedScenes.add(scene);
        console.log('chapter progress', scene, state.messages, state.frame);
      }
    for (const item of state.unsupported) unsupported.add(item);
    for (const item of state.warnings) warnings.add(item);
    for (const stop of state.movieStops) {
      if (!completed.has(stop.name)) {
        await assertMovieCompleted(info, stop, stop.name === opening ? 'Enter' : null);
        completed.set(stop.name, stop);
      }
      if (stop.released && !state.nativeMovieOpen && state.messages > stop.messagesAtInput)
        resumed.add(stop.name);
    }
    for (const movie of state.movies) {
      if (movie.time <= movieReadySeconds || movie.ready < 2 || watched.has(movie.handle)) continue;
      const name = movie.src.split('/').pop();
      expect([opening, ending]).toContain(name);
      // OP uses its default confirmation mask. On a fresh Route the ED's
      // authored #550 expression is zero, so wait for the decoder to finish.
      await watchMovie(
        page,
        info,
        movie,
        name === opening ? 'Enter' : null,
        name === ending ? 0 : undefined,
      );
      watched.add(movie.handle);
    }
    if (state.stack.includes('title#WAIT')) break;
    await step(page, 6);
  }
  await page.keyboard.up('Control');
  await noError(page);
  const evidence = {
    sourceIdentity: await page.evaluate(() => window.catSystem2.identity),
    ...state,
    movies: [...completed.keys()],
    movieSkips: [completed.get(opening)].filter(Boolean),
    naturalEnding: completed.get(ending),
    movieStoryResumed: [...resumed],
    unsupported: [...unsupported],
    warnings: [...warnings],
  };
  await writeFile(info.outputPath('route.json'), JSON.stringify(evidence, null, 2));
  expect(state.stack, JSON.stringify(evidence)).toContain('title#WAIT');
  expect(state.titleQualification).toBe(1);
  expect(state.nativeMovieOpen).toBe(false);
  expect(state.scenes.filter((name) => /^\d{2}$/.test(name)).sort()).toEqual(
    Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, '0')),
  );
  expect([...completed.keys()].sort()).toEqual([ending, opening]);
  expect([...resumed].sort()).toEqual([ending, opening]);
  expect(state.messages).toBeGreaterThan(5000);
  expect([...unsupported]).toEqual([]);
  expect([...warnings]).toEqual([]);
  expect(errors).toEqual([]);
}

async function checkEligibleEnding(page, info) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await frameClock(page);
  await page.goto('/');
  await guardNormalOriginalCPU(page);
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await page.waitForFunction(
    () => window.catSystem2?.mode === 'running' || !document.getElementById('error').hidden,
    undefined,
    { polling: 100, timeout: 45000 },
  );
  await noError(page);
  await step(page);
  const previous = await page.evaluateHandle(() => window.catSystem2.world);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#import').click(),
  ]);
  await chooser.setFiles(eligibleCheckpoint);
  await page.evaluate(() => window.nativeGameFrame(0));
  await noError(page);
  try {
    expect(
      await page.evaluate((old) => old.closed && window.catSystem2.world !== old, previous),
    ).toBe(true);
  } finally {
    await previous.dispose();
  }
  await installRouteObservation(page);
  const start = await page.evaluate(() => {
    const { world } = window.catSystem2,
      script = [...world.runtime.scheduler.tasks.values()].find(({ name }) => name === 'sscript'),
      bank = world.runtime.handles.records.get(script?.context?.variableBank);
    return {
      qualification: bank?.type === 'variable-bank' ? bank.value.get(550) : null,
      movieCount: world.movies.sessions.size,
      originalStory: Boolean(script) && window.catSystem2.status().stack.includes('meswnd#WAIT'),
    };
  });
  expect(start, 'Use an unmodified, already-qualified checkpoint before the original ED').toEqual({
    qualification: 1,
    movieCount: 0,
    originalStory: true,
  });

  let observed = false,
    stopped = false,
    complete = false;
  await page.keyboard.down('Control');
  for (let requested = 0; requested <= 510; requested += 6) {
    const state = await observeRoute(page),
      watched = state.movieStops.find(({ name }) => name === ending);
    if (watched && !stopped) {
      await assertMovieCompleted(info, watched, 'Escape');
      stopped = true;
    }
    if (stopped && watched?.released && !state.nativeMovieOpen && state.scenes.includes('14')) {
      expect(state.unsupported).toEqual([]);
      expect(state.warnings).toEqual([]);
      complete = true;
      break;
    }
    if (!observed) {
      const movie = state.movies.find(
        ({ src, time, ready }) =>
          src.split('/').pop() === ending && time > movieReadySeconds && ready >= 2,
      );
      if (movie) {
        await page.keyboard.up('Control');
        // After the original story writes #550=1, logical key 1 uses Escape.
        await watchMovie(page, info, movie, 'Escape', 1);
        observed = true;
      }
    }
    if (requested < 510) await step(page, 6);
  }
  await page.keyboard.up('Control');
  await noError(page);
  expect(stopped, 'The qualified ED must actively stop using its authored key').toBe(true);
  expect(complete, 'The released original ED must let the story enter chapter 14').toBe(true);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(async () => {
      const core = window.catSystem2;
      await core.dispose();
      return core.world.closed && core.audio.context.state === 'closed';
    }),
  ).toBe(true);
}
