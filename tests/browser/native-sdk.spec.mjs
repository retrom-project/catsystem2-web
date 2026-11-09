// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { frameClock, state, step, until, clickNativeButton, pixels } from './native-game-input.mjs';

const sourceIdentity = 'fe2025130e0f8f7e776eb96b3df004f3f46e65e7fefbe3b6a7cdd5e239a2f217';
const profile = 'sdk-4.01-engine-2.6.1.74';

async function writeSetup(page, logLimit) {
  await page.evaluate(
    async ({ profile, sourceIdentity, logLimit }) => {
      const [{ NativeConfiguration }, { NativeFileStorage }, { serializeNativePreferences }] =
          await Promise.all([
            import('/src/native/config.mjs'),
            import('/src/native/storage.mjs'),
            import('/src/native/preferences.mjs'),
          ]),
        configuration = new NativeConfiguration({ profile }),
        mounted = window.catSystem2?.nativeStorage,
        storage = mounted ?? new NativeFileStorage({}, sourceIdentity);
      new DataView(configuration.blocks[1].buffer).setUint32(9 * 4, logLimit, true);
      configuration.setField('general.disableMovie', 1);
      if (!mounted) await storage.open();
      try {
        if (!(await storage.write('setup.xml', serializeNativePreferences(configuration))))
          throw new Error('Could not save the SDK setup fixture');
      } finally {
        if (!mounted) storage.close();
      }
    },
    { profile, sourceIdentity, logLimit },
  );
}

async function startSDK(page) {
  const response = await page.request.get('/game.json');
  expect(response.ok(), 'Mount the frozen SDK system directory on CAT2_SDK_URL').toBe(true);
  expect((await response.json()).identity).toBe(sourceIdentity);
  await frameClock(page);
  await page.goto('/');
  await writeSetup(page, 647);
  await page.click('#start');
  await page.waitForFunction(
    () => window.catSystem2?.mode === 'running' || !document.getElementById('error').hidden,
    undefined,
    { polling: 100, timeout: 180_000 },
  );
  expect(await state(page)).toMatchObject({ error: '', profile, source: sourceIdentity });
}

async function freshAtSameFrame(page) {
  const before = await state(page),
    image = await pixels(page);
  expect(image.colors).toBeGreaterThan(32);
  expect(
    await page.evaluate(async () => {
      const engine = window.catSystem2,
        old = engine.world;
      await engine.restore(await engine.snapshot());
      await engine.render();
      return engine.world !== old && engine.world.nativeEngine.refs.nativeOwner;
    }),
  ).toBe(true);
  expect(await state(page)).toEqual(before);
  expect(await pixels(page)).toEqual(image);
  return image;
}

async function waitForButton(page, key) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      await page.evaluate(
        (key) =>
          window.catSystem2
            .activeFES()
            ?.candidates()
            .some(({ o }) => o.key === key),
        key,
      )
    )
      return;
    await step(page, 6);
  }
  throw new Error(`Original SDK button did not become active: ${key}`);
}

test('official SDK starts with saved setup and restores the title and tutorial choice', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startSDK(page);
  expect(
    await page.evaluate(() => {
      const { nativeEngine: engine, configuration } = window.catSystem2.world,
        { owner, settings, defaultSettings, nativeOwner } = engine.refs;
      return {
        nativeOwner,
        distinctSettings: owner < settings && settings < defaultSettings,
        nativeFontEnumeration: engine.kernel.calls.get('gdi32.dll!EnumFontFamiliesA'),
        executableResources: engine.kernel.calls.get('kernel32.dll!FreeResource'),
        com: engine.kernel.comDepth,
        nativeRandom: Boolean(engine.refs.randomOwner),
        nativeLocalTime: engine.kernel.calls.get('kernel32.dll!GetLocalTime'),
        logLimit: new DataView(configuration.blocks[1].buffer).getUint32(9 * 4, true),
      };
    }),
  ).toEqual({
    nativeOwner: true,
    distinctSettings: true,
    nativeFontEnumeration: 2,
    executableResources: 3,
    com: 1,
    nativeRandom: true,
    nativeLocalTime: 2,
    logLimit: 647,
  });
  await until(page, 'title#WAIT', 360);
  await writeSetup(page, 389);
  const title = await freshAtSameFrame(page);
  expect(
    await page.evaluate(() =>
      new DataView(window.catSystem2.world.configuration.blocks[1].buffer).getUint32(9 * 4, true),
    ),
  ).toBe(647);
  await waitForButton(page, 'btn1[2]');
  await clickNativeButton(page, 'btn1[2]');
  await waitForButton(page, 'btn2[1]');
  await clickNativeButton(page, 'btn2[1]');
  for (let attempt = 0; attempt < 120; attempt++) {
    const { stack } = await state(page);
    if (stack.includes('select#WAIT')) break;
    if (stack.includes('meswnd_b#WAIT') && !stack.some((label) => label.startsWith('select#'))) {
      const canvas = await page.locator('#screen').boundingBox();
      await page.mouse.move(canvas.x + canvas.width * 0.48, canvas.y + canvas.height * 0.61);
      await step(page, 1);
      await page.mouse.down();
      await step(page, 2);
      await page.mouse.up();
    }
    await step(page, 6);
  }
  expect((await state(page)).stack).toContain('select#WAIT');
  const choice = await freshAtSameFrame(page);
  expect(choice.sha256).not.toBe(title.sha256);
  expect(
    await page.evaluate(() =>
      window.catSystem2
        .activeFES()
        .candidates()
        .map(({ o }) => o.key),
    ),
  ).toEqual(['fr1[0]', 'fr1[1]', 'fr1[2]', 'fr1[3]']);
  await clickNativeButton(page, 'fr1[0]');
  await until(page, 'select#EXIT', 36);
  expect(errors).toEqual([]);
});

async function advanceSDKDialogue(page) {
  const canvas = await page.locator('#screen').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.48, canvas.y + canvas.height * 0.9);
  await step(page);
  await page.mouse.down();
  await step(page, 2);
  await page.mouse.up();
  await step(page, 6);
}

const sdkJavaScriptState = (page) =>
  page.evaluate(() => {
    const { world, audio } = window.catSystem2,
      engine = world.nativeEngine,
      tasks = world.objects.objects,
      task = [...tasks.values()].find((record) => record.kind === 55),
      plane = [...tasks.values()].find((record) => record.parent === task?.id && record.kind === 2),
      pointer = task?.implementation.pointer,
      source = [...world.runtime.scheduler.tasks.values()].find(
        (record) => record.name === 'sscript',
      ),
      sceneText = source && world.runtime.stringBank(source, false)?.get(1000),
      graph = plane && engine.features.get('graphics-platform').attachment(plane.nativeID),
      channel = [...audio.channels.values()].find(({ file }) => file === 'bgm.int/bgm01.ogg');
    return {
      frame: world.frame,
      loaded: pointer ? engine.process.load(pointer + 140) : 0,
      running: pointer ? engine.process.load(pointer + 144) : 0,
      plane: plane?.id ?? null,
      position: graph?.pos ?? null,
      shown: graph?.display ?? false,
      playing: Boolean(channel?.playing && channel.source && channel.buffer),
      returned: Boolean(sceneText?.includes('シーンに戻りました')),
    };
  });

test('official SDK JavaScript tutorial draws its moving plane and resumes original sound and motion', async ({
  page,
}) => {
  await startSDK(page);
  await until(page, 'title#WAIT', 360);
  await waitForButton(page, 'btn1[2]');
  await clickNativeButton(page, 'btn1[2]');
  await waitForButton(page, 'btn2[2]');
  await clickNativeButton(page, 'btn2[2]');
  for (let i = 0; i < 100; i++) {
    const { stack } = await state(page);
    if (stack.includes('select#WAIT')) break;
    if (stack.includes('meswnd_b#WAIT') && !stack.some((label) => label.startsWith('select#')))
      await advanceSDKDialogue(page);
    else await step(page, 6);
  }
  expect((await state(page)).stack).toContain('select#WAIT');
  await freshAtSameFrame(page);
  await clickNativeButton(page, 'fr1[0]');
  await until(page, 'select#EXIT', 36);

  let start;
  for (let i = 0; i < 120; i++) {
    start = await sdkJavaScriptState(page);
    if (start.running && start.playing) break;
    const { stack } = await state(page);
    if (stack.includes('meswnd_b#WAIT') && !stack.some((label) => label.startsWith('select#')))
      await advanceSDKDialogue(page);
    else await step(page, 6);
  }
  expect(start).toMatchObject({ loaded: 1, running: 1, playing: true, shown: true });
  expect(start.position).toHaveLength(3);
  const firstImage = await pixels(page);
  for (let i = 0; i < 12; i++) await step(page, 6);
  const moving = await sdkJavaScriptState(page),
    movingImage = await freshAtSameFrame(page);
  expect(moving).toMatchObject({ plane: start.plane, running: 1, playing: true, shown: true });
  expect(moving.position[0]).toBeGreaterThan(start.position[0]);
  expect(movingImage.sha256).not.toBe(firstImage.sha256);
  expect(await sdkJavaScriptState(page)).toEqual(moving);

  let end = moving;
  while (end.running && end.frame < start.frame + 330) {
    await step(page, 6);
    end = await sdkJavaScriptState(page);
  }
  expect(end).toMatchObject({ loaded: 1, running: 0, returned: true, shown: false });
  expect(end.frame - start.frame).toBeGreaterThan(275);
  for (let i = 0; i < 4; i++) await step(page, 6);
  expect(await sdkJavaScriptState(page)).toMatchObject({ playing: false, returned: true });
});
