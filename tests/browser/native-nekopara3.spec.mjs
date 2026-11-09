// SPDX-License-Identifier: MPL-2.0
// Uses the prepared, frozen game mounted on the private development server.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { frameClock, state, step, until, clickNativeButton, pixels } from './native-game-input.mjs';

const sourceIdentity = '8d0be9228af81fa38872e7e2474f4bd0b9a33b4ef0fb8558cb60d9b45c7c8533';
const profile = 'nekopara-vol3-engine-2.6.1.76';
const firstSceneParticle = 'ptclpi\\em_note.ppi';

async function startGame(page) {
  const response = await page.request.get('/game.json');
  expect(response.ok(), 'Mount the frozen private game on CAT2_GAME_URL').toBe(true);
  expect((await response.json()).identity).toBe(sourceIdentity);
  await frameClock(page);
  await page.goto('/');
  await page.click('#start');
  await page.waitForFunction(
    () => window.catSystem2?.mode === 'running' || !document.getElementById('error').hidden,
    undefined,
    { polling: 100, timeout: 180_000 },
  );
  expect(await state(page)).toMatchObject({ error: '', profile, source: sourceIdentity });
}

async function sceneParticle(page, draw = false) {
  return page.evaluate(
    async ({ program, draw }) => {
      const engine = window.catSystem2,
        { world } = engine,
        bank = [...world.particles.host.banks.values()].find(
          (bank) =>
            bank.family === 'plugin' &&
            bank.program === program &&
            bank.started &&
            bank.instance?.active &&
            !bank.externalDraw,
        );
      if (!bank) return null;
      const particle = {
        program: bank.program,
        texture: bank.texture,
        attachment: bank.attachPlane,
        count: bank.count,
        counter: bank.clockValue,
      };
      if (!draw) return particle;
      const { canvas, context } = engine.renderer,
        rgba = () => context.getImageData(0, 0, canvas.width, canvas.height).data;
      await engine.render();
      const visible = rgba(),
        externalDraw = bank.externalDraw;
      let hidden;
      try {
        bank.externalDraw = true;
        await engine.render();
        hidden = rgba();
      } finally {
        bank.externalDraw = externalDraw;
        await engine.render();
      }
      let pixels = 0;
      for (let i = 0; i < visible.length; i += 4)
        if (
          visible[i] !== hidden[i] ||
          visible[i + 1] !== hidden[i + 1] ||
          visible[i + 2] !== hidden[i + 2] ||
          visible[i + 3] !== hidden[i + 3]
        )
          pixels++;
      return {
        ...particle,
        frame: world.frame,
        pixels,
        sha256: new Uint8Array(await crypto.subtle.digest('SHA-256', visible)).toHex(),
      };
    },
    { program: firstSceneParticle, draw },
  );
}

async function moveToDialogue(page) {
  const canvas = await page.locator('#screen').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.65);
}

async function advanceDialogue(page) {
  await page.mouse.down();
  await step(page, 2);
  await page.mouse.up();
  await step(page, 4);
}

async function waitForLine(page, line, { drawn = true, advance = false } = {}) {
  for (let i = 0; i < 100; i++) {
    const ready = await page.evaluate(
      ({ line, drawn }) => {
        const { world } = window.catSystem2,
          record = [...world.objects.objects.values()].find((task) => task.name === 'meswnd'),
          object = record?.implementation.player?.root.byKey.get('str'),
          task = world.objects.objects.get(object?.nativeTaskID)?.implementation;
        return (
          task?.text.source.includes(line) && (!drawn || (task.state.shown && !task.text.active))
        );
      },
      { line, drawn },
    );
    if (ready) return;
    if (advance) await advanceDialogue(page);
    else await step(page, 6);
  }
  throw new Error(`Native writer did not reach the expected dialogue: ${line}`);
}

async function openingPixels(page) {
  return page.evaluate(async () => {
    const e = window.catSystem2,
      { world } = e,
      { graphics } = world,
      record = [...world.objects.objects.values()].find((task) => task.name === 'meswnd'),
      { player, surface } = record.implementation,
      body = player.root.byKey.get('str'),
      background = player.root.byKey.get('bg'),
      task = world.objects.objects.get(body.nativeTaskID).implementation,
      draw = graphics.drawTasks.get(surface),
      entry = draw.entry((record.nativeID | (background.nativeRenderID << 16)) >>> 0),
      { canvas, context } = e.renderer,
      { width, height } = canvas;
    await e.render();
    const frame = context.getImageData(0, 0, width, height).data,
      sha256 = new Uint8Array(await crypto.subtle.digest('SHA-256', frame)).toHex(),
      enabled = task.graph.renderEnabled;
    // The same frame rendered without its writer graph identifies pixels
    // contributed by the native text, independently of the story background.
    let glyphPixels = 0;
    try {
      task.graph.renderEnabled = false;
      await e.render();
      const hidden = context.getImageData(0, 0, width, height).data;
      for (let i = 0; i < frame.length; i += 4)
        if (
          frame[i] !== hidden[i] ||
          frame[i + 1] !== hidden[i + 1] ||
          frame[i + 2] !== hidden[i + 2]
        )
          glyphPixels++;
    } finally {
      if (enabled === undefined) delete task.graph.renderEnabled;
      else task.graph.renderEnabled = enabled;
      await e.render();
    }
    return { width, height, sha256, glyphPixels, backgroundClip: [...entry.clip] };
  });
}

test('cold native language, title and opening dialogue continue through the original HG3 load', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page);
  const language = await until(page, 'langselect#WAIT', 900);
  const image = await pixels(page);
  expect(image.colors).toBeGreaterThan(32);

  const exportFile = page.waitForEvent('download', { timeout: 180_000 });
  await page.click('#export');
  await step(page, 0);
  const buffer = await readFile(await (await exportFile).path());
  expect(buffer.byteLength).toBeGreaterThan(1024);

  await clickNativeButton(page, 'decide');
  await until(page, 'title#WAIT', 240);
  const title = await pixels(page);
  expect(title.colors).toBeGreaterThan(32);
  expect(title.sha256).not.toBe(image.sha256);
  await page.evaluate(() => {
    window.preImportWorld = new WeakRef(window.catSystem2.world);
  });
  await page.locator('#save-file').setInputFiles({
    name: 'language.cs2save',
    mimeType: 'application/octet-stream',
    buffer,
  });
  const restored = await step(page, 0);
  expect(restored).toMatchObject({ frame: language.frame, stack: language.stack });
  expect(await page.evaluate(() => window.catSystem2.world !== window.preImportWorld.deref())).toBe(
    true,
  );
  expect(await pixels(page)).toEqual(image);
  await clickNativeButton(page, 'decide');
  await until(page, 'title#WAIT', 240);

  await clickNativeButton(page, 'btn1[0]');
  await until(page, 'meswnd#WAIT', 900);
  await waitForLine(page, 'Welcome to La Soleil!');
  const opening = await openingPixels(page);
  expect(opening).toMatchObject({
    width: 1280,
    height: 720,
    backgroundClip: [0, 0, 1280, 260],
  });
  expect(opening.glyphPixels).toBeGreaterThan(1000);
  const openingFrame = await state(page),
    openingFile = page.waitForEvent('download', { timeout: 180_000 });
  await page.click('#export');
  await step(page, 0);
  await page.evaluate(() => {
    window.preImportWorld = new WeakRef(window.catSystem2.world);
  });
  await page.locator('#save-file').setInputFiles(await (await openingFile).path());
  expect(await step(page, 0)).toMatchObject({
    frame: openingFrame.frame,
    stack: openingFrame.stack,
  });
  expect(await page.evaluate(() => window.catSystem2.world !== window.preImportWorld.deref())).toBe(
    true,
  );
  expect(await openingPixels(page)).toEqual(opening);

  const imageLoads = () =>
      page.evaluate(() => window.catSystem2.world.runtime.calls.get('main:710') ?? 0),
    beforeLoads = await imageLoads();
  await moveToDialogue(page);
  await step(page, 2);
  await page.mouse.down();
  await step(page, 2);
  await page.mouse.up();
  await step(page, 2);
  await waitForLine(page, 'Will you be dining in today?', { drawn: false });
  await waitForLine(page, 'If you like first flush', { drawn: false, advance: true });
  expect(await imageLoads()).toBeGreaterThan(beforeLoads);
  expect((await state(page)).unsupported).toEqual([]);
  expect(errors).toEqual([]);
});

test('original scene particle changes the rendered frame and continues after a fresh World', async ({
  page,
}) => {
  // Native E-mote is CPU intensive under headless Chromium's software GPU.
  test.setTimeout(60 * 60_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page);
  await until(page, 'langselect#WAIT', 900);
  await clickNativeButton(page, 'decide');
  await until(page, 'title#WAIT', 240);
  await clickNativeButton(page, 'btn1[0]');
  await until(page, 'meswnd#WAIT', 900);
  await moveToDialogue(page);
  let visible;
  for (let i = 0; i < 170; i++) {
    await advanceDialogue(page);
    if (!(await sceneParticle(page))) continue;
    visible = await sceneParticle(page, true);
    if (visible?.pixels > 0) break;
  }
  expect(visible, 'First PPI in the original scene must become visible').toMatchObject({
    program: firstSceneParticle,
    texture: 'image.lst/tex_em04.hg3',
    count: 3,
  });
  expect(visible.pixels).toBeGreaterThan(0);
  expect(visible.attachment).toBeGreaterThan(0);
  expect(
    await page.evaluate(async () => {
      const engine = window.catSystem2,
        previous = engine.world;
      await engine.restore(await engine.snapshot());
      await engine.render();
      return engine.world !== previous;
    }),
  ).toBe(true);
  expect(await sceneParticle(page, true)).toEqual(visible);
  await step(page, 3);
  const continued = await sceneParticle(page);
  expect(continued).toMatchObject({ attachment: visible.attachment, count: visible.count });
  expect(continued.counter).toBeGreaterThan(visible.counter);
  expect((await state(page)).unsupported).toEqual([]);
  expect(errors).toEqual([]);
});
