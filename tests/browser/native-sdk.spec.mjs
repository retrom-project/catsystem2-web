// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import {
  frameClock,
  state,
  step,
  until,
  clickNativeButton,
  pixels,
  startupWindow,
} from './native-game-input.mjs';

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
  expect(await startupWindow(page)).toEqual({
    handle: 1,
    client: [800, 600],
    nativeTitle: true,
    inputOwner: true,
    acceleratorCount: 4,
  });
}

async function restoreFresh(page) {
  expect(
    await page.evaluate(async () => {
      const engine = window.catSystem2,
        old = engine.world;
      await engine.restore(await engine.snapshot());
      await engine.render();
      return engine.world !== old && engine.world.nativeEngine.refs.nativeOwner;
    }),
  ).toBe(true);
}

async function freshAtSameFrame(page) {
  const before = await state(page),
    image = await pixels(page),
    nativeWindow = await startupWindow(page);
  expect(image.colors).toBeGreaterThan(32);
  await restoreFresh(page);
  expect(await state(page)).toEqual(before);
  expect(await pixels(page)).toEqual(image);
  expect(await startupWindow(page)).toEqual(nativeWindow);
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
  const exported = page.waitForEvent('download');
  await page.click('#export');
  await step(page, 0);
  expect(await (await exported).failure()).toBeNull();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('#export')).toBeFocused();
  await clickNativeButton(page, 'fr1[1]');
  await until(page, 'select#EXIT', 36);
  expect(
    await page.evaluate(() => ({
      scroll: window.scrollY,
      pressed: window.catSystem2.activeFES().nativeInput.state.pressed,
      selected: window.catSystem2.activeFES().root.local(30),
    })),
  ).toEqual({ scroll: 0, pressed: 'fr1[1]', selected: 1 });
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

async function followSDKDialogue(page, label, attempts) {
  let current;
  for (let i = 0; i < attempts; i++) {
    current = await state(page);
    if (current.stack.includes(label)) return;
    if (
      i % 2 === 0 &&
      current.stack.includes('meswnd_b#WAIT') &&
      !current.stack.some((entry) => entry.startsWith('select#'))
    )
      await advanceSDKDialogue(page);
    else await step(page, 6);
  }
  expect(current.stack, `Original SDK route at frame ${current.frame}`).toContain(label);
}

const galleryCells = (page) =>
  page.evaluate(() => {
    const player = window.catSystem2.activeFES();
    return {
      category: player.root.local(130),
      cells: player
        .candidates()
        .filter(({ o }) => o.baseName === 'btn_thumb')
        .map(({ o }) => ({ key: o.key, registered: player.root.local(200 + o.index) })),
    };
  });

const musicGallery = (page) =>
  page.evaluate(() => {
    const engine = window.catSystem2,
      root = engine.activeFES().root,
      channel = [...engine.audio.channels.values()].find(
        ({ file }) => file === 'bgm.int/bgm01.ogg',
      );
    return {
      selected: root.local(200),
      running: root.local(300),
      playing: Boolean(channel?.playing && channel.source && channel.buffer),
    };
  });

const replay = (page) =>
  page.evaluate(() => {
    const engine = window.catSystem2,
      runtime = engine.world.runtime,
      script = [...runtime.scheduler.tasks.values()].find(({ name }) => name === 'sscript');
    return {
      mode: engine.globals[512],
      scenario: engine.strings[200],
      dialogue: script ? runtime.stringBank(script, false)?.get(1000) : undefined,
    };
  });

test('official SDK registers and opens CG, music and scene replay from its own tutorial', async ({
  page,
}) => {
  test.setTimeout(90 * 60_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const press = async (key) => {
    await waitForButton(page, key);
    await clickNativeButton(page, key);
  };
  await test.step('Unlock Extra and register CG and replay in the original tutorial', async () => {
    await startSDK(page);
    await until(page, 'title#WAIT', 360);
    await press('btn1[2]');
    await press('btn2[1]');
    await followSDKDialogue(page, 'select#WAIT', 140);
    // Extra submenu, unlock, CG registration, replay registration, then exit.
    for (const index of [0, 0, 1, 2]) {
      await press(`fr1[${index}]`);
      await until(page, 'select#EXIT', 36);
      await followSDKDialogue(page, 'select#WAIT', 420);
    }
    expect(await page.evaluate(() => window.catSystem2.globals[760])).toBe(1);
    await press('fr1[3]');
    await followSDKDialogue(page, 'title#WAIT', 120);
    await press('btn1[3]');
    await until(page, 'title#WAIT', 90);
    await press('btn3[0]');
  });

  await test.step('Open a registered CG and restore the same image', async () => {
    await until(page, 'cgmode#SEL_WAIT', 150);
    let thumbnail;
    for (const category of [2, 1, 0]) {
      if ((await galleryCells(page)).category !== category) {
        await press(`btn_ch[${category}]`);
        await until(page, 'cgmode#SEL_WAIT', 150);
      }
      thumbnail = (await galleryCells(page)).cells.find(({ registered }) => registered > 0)?.key;
      if (thumbnail) break;
    }
    expect(thumbnail, 'A tutorial CG must be available in the gallery').toBeTruthy();
    const list = await pixels(page);
    await press(thumbnail);
    await until(page, 'cgview#WAIT', 150);
    const picture = () =>
        page.evaluate(() => {
          const object = window.catSystem2.activeFES().root.byKey.get('img_cg');
          return object?.nativeImageHandle ? object.nativeImageMetrics : null;
        }),
      loaded = await picture();
    expect(loaded, 'The original gallery IMAGE must hold a decoded CG').not.toBeNull();
    expect(loaded.width).toBeGreaterThan(0);
    expect(loaded.height).toBeGreaterThan(0);
    expect((await freshAtSameFrame(page)).sha256).not.toBe(list.sha256);
    expect(await picture()).toEqual(loaded);
    const canvas = await page.locator('#screen').boundingBox();
    await page.mouse.move(canvas.x + canvas.width * 0.25, canvas.y + canvas.height * 0.4);
    await step(page);
    await page.mouse.down({ button: 'right' });
    await step(page, 2);
    await page.mouse.up({ button: 'right' });
    await step(page, 2);
    await until(page, 'cgmode#SEL_WAIT', 150);
  });

  await test.step('Play, restore and stop a gallery track', async () => {
    await press('btn_sys[2]');
    await until(page, 'musicmode#SEL_WAIT', 150);
    await press('btn_track[1]');
    for (let i = 0; i < 4; i++) await step(page, 6);
    const playing = { selected: 1, running: 1, playing: true };
    expect(await musicGallery(page)).toEqual(playing);
    await restoreFresh(page);
    expect(await musicGallery(page)).toEqual(playing);
    await press('btn_ctrl[1]');
    await step(page, 6);
    await step(page, 6);
    expect(await musicGallery(page)).toEqual({ selected: 1, running: 0, playing: false });
  });

  await test.step('Play a registered scene, restore it and return through end_of_kaisou', async () => {
    await press('btn_sys[1]');
    await until(page, 'scenemode#SEL_WAIT', 150);
    expect(
      await page.evaluate(() => [900, 901, 902].map((id) => window.catSystem2.globals[id])),
    ).toEqual([1, 1, 1]);
    const { cells } = await galleryCells(page);
    expect(cells[0]).toMatchObject({ key: 'btn_thumb[0]', registered: 1 });
    const list = await pixels(page);
    await press(cells[0].key);
    await until(page, 'flow#SCENEPLAY_WAIT', 150);
    let scene;
    for (let i = 0; i < 100; i++) {
      scene = await replay(page);
      if (scene.dialogue && (await state(page)).stack.includes('meswnd_b#WAIT')) break;
      await step(page, 6);
    }
    expect(scene).toMatchObject({ mode: -2, scenario: 'rc_000', dialogue: expect.any(String) });
    expect(scene.dialogue).toContain('end_of_kaisou');
    expect((await freshAtSameFrame(page)).sha256).not.toBe(list.sha256);
    expect(await replay(page)).toEqual(scene);
    await followSDKDialogue(page, 'scenemode#SEL_WAIT', 220);
    expect((await state(page)).stack).not.toContain('flow#SCENEPLAY_WAIT');
    expect((await state(page)).unsupported).toEqual([]);
  });
  expect(errors).toEqual([]);
});
