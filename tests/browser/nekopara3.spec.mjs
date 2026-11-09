// SPDX-License-Identifier: MPL-2.0
// Current NativeWorld UI acceptance using the mounted frozen game.
import { test, expect } from '@playwright/test';
import { clickGame, button, noError, launch, pad, nativeWait, gameplay } from './game-helpers.mjs';
import { step, until } from './native-game-input.mjs';

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed())
    console.log('failure state', await gameplay(page));
});
test('native title, gamepad, story, touch, save, settings, backlog and new-instance recovery', async ({
  page,
}) => {
  // This exercises the original World, including software-GPU E-mote and CSS
  // saves. Frame bounds below remain functional limits; the old three-minute
  // wall budget belonged to the retired ScenePlayer implementation.
  test.setTimeout(60 * 60_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.testPad = {
      connected: true,
      mapping: 'standard',
      axes: [0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad] });
  });
  // The native default disables joystick input. The retired ScenePlayer did
  // not honor that setting, so a fake pad alone no longer enables this path.
  await launch(page, { preferences: '<KEY><enable_joypad>1</enable_joypad></KEY>' });
  expect(await page.evaluate(() => window.catSystem2.world.configuration.keys.enableJoypad)).toBe(
    1,
  );
  await pad(page, 13);
  await pad(page, 0);
  await until(page, 'meswnd#WAIT', 900);
  await nativeWait(page, () => {
    const e = window.catSystem2,
      task = [...e.world.runtime.scheduler.tasks.values()].find((t) => t.name === 'sscript');
    return task && e.world.runtime.stringBank(task, false)?.get(1000);
  });
  expect((await gameplay(page)).text.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.catSystem2.audio.context.state)).toBe('running');
  for (let i = 0; i < 240; i++) {
    const ready = await page.evaluate(() =>
      [...window.catSystem2.nativeFES.values()].some((player) => {
        const object = player.root?.byKey.get('btn');
        return (
          player.stack.some((label) => label.startsWith('touch#')) &&
          object?.enable &&
          player.root.placement(object).shown
        );
      }),
    );
    if (ready) break;
    await page.click('#next');
    await step(page, 6);
  }
  expect((await gameplay(page)).models).toBeGreaterThan(0);
  await button(page, 'btn', true);
  await until(page, 'touch#WAIT_TOUCH', 240);
  await clickGame(page, 640, 240);
  await nativeWait(page, () => /touch/i.test(window.catSystem2.audio.voiceInfo().file || ''));
  await page.keyboard.press('Escape');
  await until(page, 'meswnd#WAIT', 240);

  await page.click('#settings');
  await until(page, 'config#WAIT', 240);
  await button(page, 'tab[0]');
  await button(page, 'system_langage[1]');
  await until(page, 'config#SYSTEM_LANG_WAIT', 240);
  await button(page, 'system_main[2]');
  await until(page, 'config#WAIT', 240);
  expect((await gameplay(page)).language.main).toBe(2);
  await button(page, 'system_langage[1]');
  await until(page, 'config#SYSTEM_LANG_WAIT', 240);
  await button(page, 'system_main[0]');
  await until(page, 'config#WAIT', 240);
  expect((await gameplay(page)).language.main).toBe(0);
  await button(page, 'system_langage[1]');
  await until(page, 'config#SYSTEM_LANG_WAIT', 240);
  await button(page, 'system_main[2]');
  await until(page, 'config#WAIT', 240);
  await button(page, 'system_langage[0]');
  await until(page, 'config#SYSTEM_LANG_WAIT', 240);
  await button(page, 'system_ui[2]');
  await until(page, 'config#WAIT', 240);
  expect((await gameplay(page)).language).toMatchObject({ main: 2, ui: 2 });
  await page.keyboard.press('Escape');
  await until(page, 'meswnd#WAIT', 240);
  await noError(page);

  const before = (await gameplay(page)).saves;
  await page.click('#quick-save');
  await nativeWait(
    page,
    (before) =>
      [...window.catSystem2.nativeStorage.store.records.keys()].some(
        (name) => /save\d+\.dat$/i.test(name) && !before.includes(name),
      ),
    before,
  );
  const saved = await gameplay(page);
  expect(saved.saves.length).toBeGreaterThan(before.length);
  await page.click('#backlog');
  await until(page, 'hist_b#WAIT', 240);
  await button(page, 'ret[0]');
  await until(page, 'confirm#WAIT', 240);
  await button(page, 'btn[0]');
  await until(page, 'meswnd#WAIT', 900);
  await noError(page);

  await page.reload();
  await page.click('#start');
  await page.waitForFunction(
    () => window.catSystem2?.mode === 'running' || !document.getElementById('error').hidden,
    undefined,
    { timeout: 180_000, polling: 100 },
  );
  await until(page, 'title#WAIT', 900);
  expect((await gameplay(page)).source).toBe(saved.source);
  expect((await gameplay(page)).saves).toEqual(saved.saves);
  await page.click('#quick-load');
  await until(page, 'meswnd#WAIT', 900);
  expect((await gameplay(page)).text).toBe(saved.text);
  expect((await gameplay(page)).language).toMatchObject({ main: 2, ui: 2 });
  const restored = await gameplay(page);
  for (let i = 0; i < 20; i++) {
    if ((await gameplay(page)).text !== restored.text) break;
    await page.click('#next');
    await step(page, 6);
  }
  expect((await gameplay(page)).text).not.toBe(restored.text);

  await button(page, 'btn[4]');
  await until(page, 'saveload#WAIT', 240);
  await button(page, 'btdata[0]');
  await nativeWait(page, () =>
    [...window.catSystem2.nativeStorage.store.records.keys()].some((name) =>
      /save0000\.dat$/i.test(name),
    ),
  );
  const ordinary = await gameplay(page);
  await page.keyboard.press('Escape');
  await until(page, 'meswnd#WAIT', 240);
  for (let i = 0; i < 8; i++) {
    await page.click('#next');
    await step(page, 6);
  }
  await button(page, 'btn[5]');
  await until(page, 'saveload#WAIT', 240);
  await button(page, 'btdata[0]');
  await nativeWait(page, () =>
    window.catSystem2.status().stack.some((label) => /^confirm2?#WAIT$/.test(label)),
  );
  await button(page, 'btn[0]');
  await until(page, 'meswnd#WAIT', 900);
  expect((await gameplay(page)).text).toBe(ordinary.text);
  const frame = (await gameplay(page)).frame;
  await step(page, 6);
  expect((await gameplay(page)).frame).toBeGreaterThan(frame + 3);
  await noError(page);
  expect(errors).toEqual([]);
});
