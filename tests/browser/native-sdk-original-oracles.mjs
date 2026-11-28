// SPDX-License-Identifier: MPL-2.0
// Physical original-owner oracles only. No normal test imports or executes these.
// Their startup entry/CPU budget remains pending explicit Root authorization.
import { expect } from '@playwright/test';
import { startupWindow } from './native-game-input.mjs';

async function requireOriginalOwner(page) {
  expect(
    await page.evaluate(() => Boolean(window.catSystem2?.world?.nativeEngine?.refs.nativeOwner)),
    'This oracle requires a genuinely initialized original SDK owner',
  ).toBe(true);
}

export async function assertOriginalSDKStartupWindow(page) {
  await requireOriginalOwner(page);
  expect(await startupWindow(page)).toEqual({
    handle: 1,
    client: [800, 600],
    nativeTitle: true,
    inputOwner: true,
    acceleratorCount: 4,
    applicationHook: true,
    displayOwner: true,
    graphicsOwner: true,
    graphicsWorker: false,
    graphicsTasks: true,
    soundBankCount: 32,
    soundWorker: true,
  });
}

export async function assertOriginalSDKAcceleratorQueue(page) {
  await requireOriginalOwner(page);
  expect(
    await page.evaluate(() => window.catSystem2.world.nativeEngine.kernel.messageQueue.last),
  ).toMatchObject({ message: 0x104, wParam: 13, keyboard: { modifiers: 16 } });
}

export async function assertOriginalSDKInitialEnvironment(page) {
  await requireOriginalOwner(page);
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
    com: 2, // WinMain and the original CsSound owner both initialize the application apartment.
    nativeRandom: true,
    nativeLocalTime: 2,
    logLimit: 647,
  });
}

export async function restoreOriginalSDKFresh(page) {
  await requireOriginalOwner(page);
  expect(
    await page.evaluate(async () => {
      const engine = window.catSystem2,
        old = engine.world;
      await engine.restore(await engine.snapshot());
      await engine.render();
      return (
        engine.world !== old &&
        engine.world.nativeEngine.refs.nativeOwner &&
        old.nativeEngine.closed &&
        !old.nativeEngine.refs.applicationGraphics
      );
    }),
  ).toBe(true);
}

// Preserve the original physical lifecycle observer for an explicit original owner.
export async function originalSDKJavaScriptState(page) {
  await requireOriginalOwner(page);
  return page.evaluate(() => {
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
      graph = plane && world.graphics.attachment(plane.nativeID),
      channel = [...audio.channels.values()].find(({ file }) => file === 'bgm.int/bgm01.ogg');
    return {
      frame: world.frame,
      task: task?.id ?? null,
      loaded: pointer ? engine.process.load(pointer + 140) : 0,
      running: pointer ? engine.process.load(pointer + 144) : 0,
      plane: plane?.id ?? null,
      position: graph?.pos ?? null,
      shown: graph?.display ?? false,
      playing: Boolean(channel?.playing && channel.source && channel.buffer),
      returned: Boolean(sceneText?.includes('シーンに戻りました')),
    };
  });
}
