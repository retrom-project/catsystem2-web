// SPDX-License-Identifier: MPL-2.0
import { expect } from '@playwright/test';
import { frameClock, until, clickNativeButton, step } from './native-game-input.mjs';
export async function clickGame(page, x, y) {
  await page.locator('#screen').scrollIntoViewIfNeeded();
  const rect = await page.locator('#screen').boundingBox();
  await page.mouse.move(rect.x + (x * rect.width) / 1280, rect.y + (y * rect.height) / 720);
  await step(page, 2);
  await page.mouse.down();
  await step(page, 2);
  await page.mouse.up();
  await step(page, 2);
}
export async function button(page, name, extra = false) {
  if (await page.evaluate(() => Boolean(window.catSystem2?.world))) {
    if (!extra) return clickNativeButton(page, name);
    const point = await page.evaluate((key) => {
      const e = window.catSystem2,
        player = [...e.nativeFES.values()].find((p) =>
          p.stack.some((label) => label.startsWith('touch#')),
        ),
        object = player?.root.byKey.get(key),
        region = object && e.world.inputFor(player.root.runtimeID)?.get(object.nativeInputTaskID);
      if (!region) throw new Error('Missing native touch input ' + key);
      const [l, t, r, b] = region.bounds;
      return [(l + r) / 2, (t + b) / 2];
    }, name);
    return clickGame(page, ...point);
  }
  await page.waitForFunction(
    ({ name, extra }) => {
      const e = window.catSystem2,
        p = extra ? e?.extraFES : e?.activeFES();
      const s = p?.instances.toReversed().find((s) => s.byKey.has(name));
      const o = s?.byKey.get(name);
      return o?.enable && s.placement(o).shown;
    },
    { name, extra },
  );
  const rect = await page.evaluate(
    ({ name, extra }) => {
      const e = globalThis.catSystem2,
        p = extra ? e.extraFES : e.activeFES();
      const s = p.instances.toReversed().find((s) => s.byKey.has(name));
      if (!s) throw new Error(`Missing test button ${name}`);
      return s.rect(s.byKey.get(name));
    },
    { name, extra },
  );
  await clickGame(page, rect.x + rect.w / 2, rect.y + rect.h / 2);
}
export async function noError(page) {
  await expect(page.locator('#error')).toBeHidden();
}
export async function launch(page, { preferences = '' } = {}) {
  await frameClock(page);
  await page.goto('/');
  if (preferences)
    await page.evaluate(async (xml) => {
      const { NativeFileStorage } = await import('/src/native/storage.mjs'),
        { identity } = await (await fetch('/game.json')).json(),
        storage = new NativeFileStorage({}, identity);
      await storage.open();
      try {
        if (!(await storage.write('setup.xml', new TextEncoder().encode(xml))))
          throw new Error('Could not save the native input preferences fixture');
      } finally {
        storage.close();
      }
    }, `<?xml version="1.0" encoding="UTF-8"?><document>${preferences}</document>`);
  await page.click('#start');
  await page.waitForFunction(
    () => window.catSystem2?.mode === 'running' || !document.getElementById('error').hidden,
    undefined,
    { polling: 100, timeout: 180_000 },
  );
  await noError(page);
  await until(page, 'langselect#WAIT', 900);
  await noError(page);
  await button(page, 'decide');
  await until(page, 'title#WAIT', 240);
}
export async function pad(page, index) {
  await page.evaluate((i) => {
    window.testPad.buttons[i] = { pressed: true, value: 1 };
  }, index);
  await step(page, 6);
  await page.evaluate((i) => {
    window.testPad.buttons[i] = { pressed: false, value: 0 };
  }, index);
  await step(page, 4);
}

export async function nativeWait(page, predicate, argument, maxFrames = 240) {
  const start = await page.evaluate(() => window.catSystem2.world.frame);
  let frame = start;
  while (frame - start < maxFrames) {
    if (await page.evaluate(predicate, argument)) return;
    frame = (await step(page, 6)).frame;
  }
  expect(
    await page.evaluate(predicate, argument),
    JSON.stringify(await page.evaluate(() => window.catSystem2.status())),
  ).toBeTruthy();
}
export const gameplay = (page) =>
  page.evaluate(() => {
    const e = window.catSystem2,
      { world } = e,
      runtime = world.runtime,
      script = [...runtime.scheduler.tasks.values()].find((task) => task.name === 'sscript'),
      data = script && runtime.sceneData(script),
      message = [...world.objects.objects.values()].find((record) => record.name === 'meswnd'),
      body = message?.implementation.player?.root.byKey.get('str'),
      writer = world.objects.objects.get(body?.nativeTaskID)?.implementation;
    return {
      frame: world.frame,
      frameMetrics: window.nativeFrameMetrics,
      touchButtons: [...e.nativeFES.values()]
        .filter((player) => player.stack.some((label) => label.startsWith('touch#')))
        .map((player) => {
          const object = player.root?.byKey.get('btn'),
            region = object && world.inputFor(player.root.runtimeID)?.get(object.nativeInputTaskID);
          return {
            stack: player.stack.slice(),
            key: object?.key,
            type: object?.nativeType,
            enable: object?.enable,
            shown: object ? player.root.placement(object).shown : null,
            inputTask: object?.nativeInputTaskID,
            bounds: region?.bounds,
            inputEnabled: region?.enabled,
          };
        }),
      source: e.identity,
      text: writer?.text?.source ?? '',
      scene: data?.reader.filename,
      block: data?.reader.block,
      line: data?.reader.line,
      stack: e.status().stack,
      language: { ...world.configuration.language },
      touch: e.status().stack.includes('touch#WAIT_TOUCH'),
      // Native M2 renders through the World's D3D compositor. The separate
      // ScenePlayer EmoteGL cache stays empty on this path.
      nativeActors: [...(world.nativeEngine.features.get('m2')?.tasks.values() ?? [])].filter(
        (task) =>
          task.pointer && task.state.shown && task.graph && task.graph.renderEnabled !== false,
      ).length,
      saves: [...e.nativeStorage.store.records.keys()]
        .filter((name) => /save\d+\.dat$/i.test(name))
        .sort(),
    };
  });
