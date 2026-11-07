// SPDX-License-Identifier: MPL-2.0
// Private, slow compatibility test. Uses normal title/input paths and real rendering/audio.
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { launch, button, noError } from './game-helpers.mjs';

test('main route reaches every chapter, decodes both movies and returns to the native title', async ({
  page,
}, info) => {
  test.setTimeout(20 * 60 * 1000);
  const errors = [],
    chapters = new Set(),
    scenes = new Set(),
    movies = new Set(),
    unsupported = new Set(),
    warnings = new Set();
  let messages = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  await launch(page);
  await button(page, 'btn1[0]');
  await page.waitForFunction(() => globalThis.catSystem2.story?.currentMessage);
  await page.keyboard.down('Control');
  const deadline = Date.now() + 18 * 60 * 1000;
  while (Date.now() < deadline) {
    await noError(page);
    const state = await page.evaluate(() => {
      const e = globalThis.catSystem2;
      return {
        mode: e.mode,
        scene: e.story?.stack.at(-1)?.name,
        messages: e.story?.sequence || 0,
        movie: e.video && !e.video.paused && !e.video.ended,
        src: e.video.currentSrc,
        unsupported: e.status().unsupported,
        warnings: [...e.audio.warnings],
      };
    });
    for (const item of state.unsupported) unsupported.add(item);
    for (const item of state.warnings) warnings.add(item);
    messages = Math.max(messages, state.messages);
    if (state.scene && !scenes.has(state.scene)) {
      scenes.add(state.scene);
      if (/^\d{2}$/.test(state.scene)) chapters.add(state.scene);
      console.log('chapter progress', state.scene, state.messages);
    }
    if (state.movie) {
      await page.waitForFunction(
        () =>
          globalThis.catSystem2.video.currentTime > 0.25 &&
          globalThis.catSystem2.video.readyState >= 2,
      );
      movies.add(state.src.split('/').pop());
      await page.keyboard.press('Escape');
    }
    if (state.mode === 'title') break;
    await page.waitForTimeout(1000);
  }
  await page.keyboard.up('Control');
  await noError(page);
  await page.waitForFunction(() => globalThis.catSystem2.status().stack.includes('title#WAIT'));
  expect([...chapters].sort()).toEqual(
    Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, '0')),
  );
  expect([...movies].sort()).toEqual(['nekopara3ed.mp4', 'nekopara3op.mp4']);
  expect(messages).toBeGreaterThan(5000);
  expect([...unsupported].sort()).toEqual(['wai mpl', 'wati mpl']);
  expect(errors).toEqual([]);
  const evidence = {
    sourceIdentity: await page.evaluate(() => globalThis.catSystem2.identity),
    chapters: [...chapters],
    scenes: [...scenes],
    messages,
    movies: [...movies],
    unsupported: [...unsupported],
    warnings: [...warnings],
    scope:
      'Normal browser UI; Ctrl skip and Escape movie skip after decoding. No native pixel or timing equivalence claim.',
  };
  await writeFile(info.outputPath('route.json'), JSON.stringify(evidence, null, 2));
});
