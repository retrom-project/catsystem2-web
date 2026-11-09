// SPDX-License-Identifier: MPL-2.0
// Private route acceptance. Observe the current NativeWorld, never ScenePlayer.
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { launch, button, noError } from './game-helpers.mjs';
import { step, until } from './native-game-input.mjs';

test('main route reaches every chapter, decodes both movies and returns to the native title', async ({
  page,
}, info) => {
  test.setTimeout(20 * 60_000);
  const started = Date.now(),
    reportedScenes = new Set();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await launch(page);
  // Read-only observations around the real CST reader. Return values, source
  // bytes and script execution are unchanged; repeated localized reads of one
  // line count as one message, including when Ctrl advances several per frame.
  await page.evaluate(async () => {
    const { NativeSceneData, NativeSceneReader } = await import('/src/native/scene-data.mjs'),
      trace = { scenes: new Set(), messages: new Set(), readers: new WeakMap() },
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
      if (result && this.type(b, l) === 0x20)
        trace.messages.add(`${trace.readers.get(this)}:${b}:${l}`);
      return result;
    };
  });
  await button(page, 'btn1[0]');
  await until(page, 'meswnd#WAIT', 900);
  await page.keyboard.down('Control');
  const movies = new Set(),
    unsupported = new Set(),
    warnings = new Set(),
    deadline = started + 18 * 60_000;
  let state;
  while (Date.now() < deadline) {
    await noError(page);
    state = await page.evaluate(() => {
      const e = window.catSystem2;
      return {
        stack: e.status().stack,
        scenes: [...window.routeTrace.scenes],
        messages: window.routeTrace.messages.size,
        movies: [
          ...new Set([
            ...document.querySelectorAll('video'),
            ...Array.from(e.world.movies.sessions.values(), (session) => session.video).filter(
              Boolean,
            ),
          ]),
        ].flatMap((video) =>
          !video.paused && !video.ended
            ? [{ src: video.currentSrc, time: video.currentTime, ready: video.readyState }]
            : [],
        ),
        unsupported: e.status().unsupported,
        warnings: [...e.audio.warnings],
        frame: e.world.frame,
      };
    });
    for (const scene of state.scenes)
      if (!reportedScenes.has(scene)) {
        reportedScenes.add(scene);
        console.log('chapter progress', scene, state.messages, state.frame);
      }
    for (const item of state.unsupported) unsupported.add(item);
    for (const item of state.warnings) warnings.add(item);
    for (const movie of state.movies)
      if (movie.time > 0.25 && movie.ready >= 2) {
        movies.add(movie.src.split('/').pop());
        await page.keyboard.press('Escape');
      }
    if (state.stack.includes('title#WAIT')) break;
    await step(page, 6);
  }
  await page.keyboard.up('Control');
  await noError(page);
  const evidence = {
    sourceIdentity: await page.evaluate(() => window.catSystem2.identity),
    ...state,
    movies: [...movies],
    unsupported: [...unsupported],
    warnings: [...warnings],
    scope:
      'NativeWorld CST reader observations and actual Ctrl/Escape input, frames, rendering and browser movie decoding. No ScenePlayer state or pixel/timing equivalence claim.',
  };
  await writeFile(info.outputPath('route.json'), JSON.stringify(evidence, null, 2));
  expect(state.stack, JSON.stringify(evidence)).toContain('title#WAIT');
  expect(state.scenes.filter((name) => /^\d{2}$/.test(name)).sort()).toEqual(
    Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, '0')),
  );
  expect([...movies].sort()).toEqual(['nekopara3ed.mp4', 'nekopara3op.mp4']);
  expect(state.messages).toBeGreaterThan(5000);
  expect([...unsupported]).toEqual([]);
  expect(errors).toEqual([]);
});
