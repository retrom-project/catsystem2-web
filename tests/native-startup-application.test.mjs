// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { releaseNativeConfigurationEvent } from '../src/native/engine-configuration-event.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import {
  initializeNativeApplicationWindow,
  releaseNativeApplicationWindow,
} from '../src/native/engine-startup-application.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import { initializeNativeStartupMenu } from '../src/native/engine-startup-menu.mjs';
import {
  createNativeStartupWindow,
  initializeNativeWindowOwner,
} from '../src/native/engine-startup-window.mjs';
import { initializeNativeWindowClass } from '../src/native/engine-window-class.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    `${profile} WinMain owns the registered application hook, configuration event and IME`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        open = () =>
          NativeEngineProcess.open({
            profile,
            bytes,
            bootstrapOwner: {},
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            readFile: async () => null,
          }),
        first = await open(),
        p = first.process,
        block = NATIVE_STARTUP_BLOCKS[profile],
        setOpen = (engine, context, value) =>
          engine.call(engine.kernel.resolve({ dll: 'IMM32.dll', name: 'ImmSetOpenStatus' }), [
            context,
            value,
          ]),
        sendMenu = (engine, selector) =>
          engine.call(engine.kernel.windowViews.windows.get(1).procedure, [1, 0x46c, 0, selector]);
      let fresh;
      try {
        await initializeNativeWindowClass(first);
        await initializeNativeStartupMenu(first);
        await initializeNativeWindowOwner(first);
        await createNativeStartupWindow(first);
        await initializeNativeApplicationWindow(first);
        const ime = p.load(block + 40),
          context = p.load(ime + 4),
          event = p.load(block + 88);
        assert.equal(first.refs.applicationWindowHook, 1);
        assert.deepEqual(
          Array.from({ length: 6 }, (_, index) => p.load(ime + 4 * index)),
          [1, context, 0, 0, 0, 1],
        );
        assert.deepEqual(first.kernel.ime.borrowed, new Map([[1, 1]]));
        assert.equal(first.kernel.events.events.get(event).event, 'CoreSystem2ConfigEvent');
        assert.equal(first.kernel.events.wait([event], false, 0), 0x102);
        first.kernel.events.signal(event, true);
        assert.equal(await setOpen(first, context, 1), 1);

        fresh = await open();
        fresh.restore(first.snapshot());
        assert.equal(fresh.process.load(block + 40), ime);
        assert.equal(fresh.kernel.events.wait([event], false, 0), 0);
        assert.equal(fresh.kernel.events.wait([event], false, 0), 0x102);
        assert.equal(fresh.kernel.ime.open, true);
        await sendMenu(fresh, 0xffffffff);
        assert.equal(fresh.kernel.messageQueue.pending, false);
        await sendMenu(fresh, 12);
        assert.deepEqual(
          fresh.kernel.messageQueue.entries.map(({ handle, message, wParam, lParam }) => [
            handle,
            message,
            wParam,
            lParam,
          ]),
          [[1, 0x111, 40021, 0]],
        );
        assert.equal(first.kernel.messageQueue.pending, false);
        await releaseNativeApplicationWindow(fresh);
        assert.equal(fresh.refs.applicationWindowHook, undefined);
        assert.equal(fresh.process.load(block + 40), 0);
        assert.equal(fresh.process.allocations.has(ime), false);
        assert.equal(fresh.kernel.ime.open, false);
        assert.equal(fresh.kernel.ime.borrowed.size, 0);
        await sendMenu(fresh, 12);
        assert.equal(fresh.kernel.messageQueue.entries.length, 1);
        await releaseNativeConfigurationEvent(fresh);
        assert.equal(fresh.process.load(block + 88), 0);
        assert.equal(fresh.kernel.events.namedEvents.size, 0);
        assert.equal(first.kernel.events.wait([event], false, 0), 0);
        assert.equal(first.kernel.ime.open, true);
      } finally {
        await fresh?.close();
        await first.close();
      }
    },
  );
}
