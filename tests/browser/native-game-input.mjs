// SPDX-License-Identifier: MPL-2.0
import { expect } from '@playwright/test';

export async function frameClock(page) {
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

export const state = (page) =>
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

export async function step(page, count = 1) {
  await page.evaluate((count) => window.nativeGameFrame(count), count);
  const result = await state(page);
  expect(result.error, JSON.stringify(result)).toBe('');
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

export async function clickNativeButton(page, name) {
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
      { process: p, kernel, refs } = world.nativeEngine,
      handle = world.window.handle,
      view = kernel.windowViews.windows.get(handle),
      owner = view?.userData,
      input = refs.inputDevice;
    return {
      handle,
      client: view?.client.slice(2),
      nativeTitle: Boolean(view?.title && view.title === document.title),
      inputOwner: Boolean(owner && input?.pointer && p.load(owner + 8) === input.pointer),
      acceleratorCount: owner && kernel.accelerators.tables.get(p.load(owner + 12))?.rows.length,
    };
  });
}
