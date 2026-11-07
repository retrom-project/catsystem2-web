// SPDX-License-Identifier: MPL-2.0
// Private compatibility test. Supply the prepared game through the local development server.
import { test, expect } from '@playwright/test';
import { clickGame, button, noError, launch, pad } from './game-helpers.mjs';
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    console.log(
      'failure state',
      await page.evaluate(() => {
        const e = globalThis.catSystem2,
          p = e?.activeFES();
        return {
          error: document.getElementById('error').textContent,
          state: e?.status(),
          settings: e?.settings,
          stack: p?.stack,
          locals: p?.root?.locals,
          candidates: p?.candidates().map(({ o, rect }) => ({ name: o.key, rect })),
          unsupported: p ? [...p.unsupportedCommands] : [],
        };
      }),
    );
    await page.screenshot({
      path: '.local/evidence/failed-game-case.jpg',
      type: 'jpeg',
      quality: 95,
    });
  }
});
test('native title, gamepad, story, touch, save, settings, backlog and new-instance recovery', async ({
  page,
}) => {
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
  await launch(page);
  await pad(page, 13);
  await pad(page, 0);
  await page.waitForFunction(() => window.catSystem2?.story?.currentMessage);
  expect(await page.evaluate(() => globalThis.catSystem2.vmEvidence.length)).toBe(2);
  expect(await page.evaluate(() => globalThis.catSystem2.audio.context.state)).toBe('running');
  await noError(page);
  for (let i = 0; i < 240; i++) {
    const ready = await page.evaluate(
      () =>
        globalThis.catSystem2.story?.waiting?.kind === 'input' &&
        Object.values(globalThis.catSystem2.story.stage.actors).some((c) => c.model && c.touch),
    );
    if (ready) break;
    await page.click('#next');
    await page.waitForTimeout(65);
  }
  await page.waitForFunction(
    () =>
      globalThis.catSystem2.story?.waiting?.kind === 'input' &&
      Object.values(globalThis.catSystem2.story.stage.actors).some((c) => c.model && c.touch),
  );
  await noError(page);
  expect(await page.evaluate(() => globalThis.catSystem2.emote.gpu.models.size)).toBeGreaterThan(0);
  await button(page, 'btn', true);
  await page.waitForFunction(() => globalThis.catSystem2.touchEnabled);
  await page.waitForFunction(() =>
    globalThis.catSystem2.extraFES.stack.includes('touch#WAIT_TOUCH'),
  );
  await clickGame(page, 640, 240);
  await page.waitForFunction(() =>
    /touch/i.test(globalThis.catSystem2.audio.voiceInfo().file || ''),
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !globalThis.catSystem2.touchEnabled);
  await page.click('#settings');
  await page.waitForFunction(() => globalThis.catSystem2.modal?.name === 'config');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal?.player.stack.includes('config#WAIT'),
  );
  await button(page, 'tab[0]');
  await button(page, 'system_langage[1]');
  console.log('main language chooser opened');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal.player.stack.includes('config#SYSTEM_LANG_WAIT'),
  );
  await button(page, 'system_main[2]');
  console.log('main language selected');
  await page.waitForFunction(
    () =>
      globalThis.catSystem2.settings.lang_text_main === 2 &&
      globalThis.catSystem2.modal.player.stack.includes('config#WAIT'),
  );
  await button(page, 'system_langage[1]');
  await button(page, 'system_main[0]');
  await page.waitForFunction(() => globalThis.catSystem2.story.language === 'jp');
  expect(
    await page.evaluate(async () => {
      const { cleanText } = await import('/src/scene.mjs');
      const message = globalThis.catSystem2.story.currentMessage;
      return (
        message.text === cleanText(message.original) && message.speaker === message.originalSpeaker
      );
    }),
  ).toBe(true);
  await button(page, 'system_langage[1]');
  await button(page, 'system_main[2]');
  await page.waitForFunction(() => globalThis.catSystem2.story.language === 'cn');
  await button(page, 'system_langage[0]');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal.player.stack.includes('config#SYSTEM_LANG_WAIT'),
  );
  await button(page, 'system_ui[2]');
  console.log('UI language selected');
  await page.waitForFunction(
    () =>
      globalThis.catSystem2.settings.lang_ui === 2 &&
      globalThis.catSystem2.modal.player.stack.includes('config#WAIT'),
  );
  await noError(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !globalThis.catSystem2.modal);
  await page.click('#quick-save');
  await page.waitForFunction(() => globalThis.catSystem2.saves.records.size > 0);
  const saved = await page.evaluate(() => {
    const e = globalThis.catSystem2,
      slot = e.saves.newest(e.quickSaveStart, 12),
      data = e.saves.get(slot).data;
    return { slot, message: data.scene.currentMessage, identity: data.sourceIdentity };
  });
  await page.click('#backlog');
  await page.waitForFunction(() => globalThis.catSystem2.modal?.name === 'hist_b');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal?.player.stack.includes('hist_b#WAIT'),
  );
  await noError(page);
  const rollbackTarget = await page.evaluate(() => {
    const e = globalThis.catSystem2;
    return e.story.log[e.modal.player.root.byKey.get('log').top];
  });
  await page.screenshot({
    path: '.local/evidence/accepted-backlog.jpg',
    type: 'jpeg',
    quality: 95,
  });
  await button(page, 'ret[0]');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal?.player.stack.includes('confirm#WAIT'),
  );
  await button(page, 'btn[0]');
  await page.waitForFunction(() => !globalThis.catSystem2.modal);
  await page.waitForFunction(
    (message) =>
      globalThis.catSystem2.story?.currentMessage?.scene === message.scene &&
      globalThis.catSystem2.story.currentMessage.index === message.index &&
      !!globalThis.catSystem2.windowFES?.root,
    rollbackTarget,
  );
  await page.reload();
  await page.click('#start');
  await page.waitForFunction(() => window.catSystem2?.mode === 'title');
  await page.click('#quick-load');
  await page.waitForFunction(
    (message) =>
      globalThis.catSystem2.story?.currentMessage?.scene === message.scene &&
      globalThis.catSystem2.story.currentMessage.index === message.index,
    saved.message,
  );
  expect(await page.evaluate(() => globalThis.catSystem2.identity)).toBe(saved.identity);
  await noError(page);
  for (let i = 0; i < 16; i++) {
    if (
      await page.evaluate(
        (index) => globalThis.catSystem2.story.currentMessage.index !== index,
        saved.message.index,
      )
    )
      break;
    await page.click('#next');
    await page.waitForTimeout(100);
  }
  expect(await page.evaluate(() => globalThis.catSystem2.story.currentMessage.index)).not.toBe(
    saved.message.index,
  );
  await button(page, 'btn[4]');
  console.log('save panel opened');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal?.player.stack.includes('saveload#WAIT'),
  );
  await button(page, 'btdata[0]');
  await page.waitForFunction(() => globalThis.catSystem2.saves.records.has(0));
  const nativeSaved = await page.evaluate(
    () => globalThis.catSystem2.saves.get(0).data.scene.currentMessage,
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !globalThis.catSystem2.modal);
  for (let i = 0; i < 8; i++) {
    await page.click('#next');
    await page.waitForTimeout(80);
  }
  await button(page, 'btn[5]');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal?.player.stack.includes('saveload#WAIT'),
  );
  await button(page, 'btdata[0]');
  await page.waitForFunction(() =>
    globalThis.catSystem2.modal?.player.stack.some((label) => /^confirm2?#WAIT$/.test(label)),
  );
  await button(page, 'btn[0]');
  await page.waitForFunction(
    (message) =>
      !globalThis.catSystem2.modal &&
      globalThis.catSystem2.story?.currentMessage?.index === message.index &&
      globalThis.catSystem2.story.currentMessage.scene === message.scene &&
      !!globalThis.catSystem2.windowFES?.root,
    nativeSaved,
  );
  expect(await page.evaluate(() => globalThis.catSystem2.story.language)).toBe('cn');
  const restoredFrame = await page.evaluate(() => globalThis.catSystem2.frame);
  await page.waitForFunction(
    (frame) =>
      globalThis.catSystem2.frame > frame + 3 &&
      globalThis.catSystem2.status().stack.includes('meswnd#WAIT'),
    restoredFrame,
  );
  for (let i = 0; i < 20; i++) {
    if (
      await page.evaluate(
        (index) => globalThis.catSystem2.story.currentMessage.index !== index,
        nativeSaved.index,
      )
    )
      break;
    await page.click('#next');
    await page.waitForTimeout(100);
  }
  expect(await page.evaluate(() => globalThis.catSystem2.story.currentMessage.index)).not.toBe(
    nativeSaved.index,
  );
  await noError(page);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: '.local/evidence/accepted-new-instance.jpg',
    type: 'jpeg',
    quality: 95,
  });
});
