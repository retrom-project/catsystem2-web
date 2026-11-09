// SPDX-License-Identifier: MPL-2.0
// Uses the prepared, frozen game mounted on the private development server.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const sourceIdentity = '8d0be9228af81fa38872e7e2474f4bd0b9a33b4ef0fb8558cb60d9b45c7c8533';
const profile = 'nekopara-vol3-engine-2.6.1.76';

async function frameClock(page) {
  await page.addInitScript(() => {
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
    window.nativeGameFrame = async (count) => {
      const entry = queue.entries().next().value;
      if (!entry) throw new Error('The game is not scheduling browser frames');
      const [id, callback] = entry;
      queue.delete(id);
      time += (count * 1000) / 60;
      await callback(time);
    };
  });
}

const state = (page) =>
  page.evaluate(() => {
    const e = window.catSystem2;
    return {
      frame: e?.world?.frame,
      profile: e?.nativeProfile,
      source: e?.identity,
      stack: e?.status().stack,
      unsupported: e?.status().unsupported,
      error: document.getElementById('error').textContent,
    };
  });

async function step(page, count = 1) {
  await page.evaluate((count) => window.nativeGameFrame(count), count);
  const result = await state(page);
  expect(result.error, JSON.stringify(result)).toBe('');
  return result;
}

async function until(page, label, maxFrames) {
  let result = await state(page);
  const limit = result.frame + maxFrames;
  while (!result.stack?.includes(label) && result.frame < limit) result = await step(page, 6);
  expect(result.stack, JSON.stringify(result)).toContain(label);
  expect(result.unsupported).toEqual([]);
  return result;
}

async function clickNativeButton(page, name) {
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
  await page.mouse.down();
  await step(page, 2);
  await page.mouse.up();
  await step(page, 2);
  await page.mouse.move(1, 1);
}

async function pixels(page) {
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

async function waitForLine(page, line, { drawn = true } = {}) {
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
    await step(page, 6);
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

test('cold native language, title and opening dialogue continue in a fresh World', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
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

  const canvas = await page.locator('#screen').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.65);
  await step(page, 2);
  await page.mouse.down();
  await step(page, 2);
  await page.mouse.up();
  await step(page, 2);
  await waitForLine(page, 'Will you be dining in today?', { drawn: false });
  expect((await state(page)).unsupported).toEqual([]);
  expect(errors).toEqual([]);
});
