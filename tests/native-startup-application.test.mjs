// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { releaseNativeConfigurationEvent } from '../src/native/engine-configuration-event.mjs';
import { initializeNativeDesktop } from '../src/native/engine-desktop.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import {
  initializeNativeApplicationServices,
  initializeNativeApplicationWindow,
  NATIVE_APPLICATION_SERVICES_MESSAGE,
  releaseNativeApplicationWindow,
} from '../src/native/engine-startup-application.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import { initializeNativeStartupMenu } from '../src/native/engine-startup-menu.mjs';
import {
  createNativeStartupWindow,
  initializeNativeWindowOwner,
} from '../src/native/engine-startup-window.mjs';
import { initializeNativeWindowClass } from '../src/native/engine-window-class.mjs';
import { runNativeWindowPump } from '../src/native/engine-window-pump.mjs';
import { installNativeDirectSound } from '../src/native/windows-directsound.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    `${profile} WinMain owns the registered callback, IME, display and audio startup`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        open = async () => {
          const engine = await NativeEngineProcess.open({
            profile,
            bytes,
            bootstrapOwner: { displaySize: () => [1391, 703] },
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            readFile: async () => null,
          });
          installNativeDirectSound(engine, () => true);
          return engine;
        },
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
      const completeDisplay = async (engine, width, height) => {
        const process = engine.process,
          messages = [];
        assert.equal(process.load(block + 8), 0);
        assert.deepEqual(
          engine.kernel.messageQueue.entries.map(({ handle, message, wParam, lParam }) => [
            handle,
            message,
            wParam,
            lParam,
          ]),
          [[1, 0x40b, 0, 0]],
        );
        assert.equal(
          await runNativeWindowPump(engine, 1, {
            handles: (message) => message === NATIVE_APPLICATION_SERVICES_MESSAGE,
            async deliver(packet) {
              assert.equal(process.allocations.get(process.load(block + 8)), 36);
              messages.push(packet.message);
              if (packet.message === NATIVE_APPLICATION_SERVICES_MESSAGE)
                await initializeNativeApplicationServices(engine);
            },
            stopping: () => false,
          }),
          null,
        );
        assert.deepEqual(messages, [0x40b, 0x40c]);
        assert.equal(engine.kernel.messageQueue.pending, false);
        const owner = process.load(block + 8),
          list = process.load(owner + 28),
          head = process.load(list);
        assert.deepEqual(
          Array.from({ length: 9 }, (_, index) => process.load(owner + index * 4)),
          [width, height, 0xffffffff, 0, 1391, 703, 1, list, 0],
        );
        assert.equal(process.allocations.get(list), 8);
        assert.equal(process.allocations.get(head), 28);
        assert.equal(process.load(head), head);
        assert.equal(process.load(head + 4), head);
        return [owner, list, head];
      };
      const soundResources = (engine, flags) => {
        const process = engine.process,
          owner = process.load(block + 12),
          backend = process.load(owner + 108),
          handle = process.load(backend + 12),
          threadID = engine.kernel.threadHandles.handles.get(handle)?.id,
          worker = engine.kernel.threadHandles.threads.get(threadID),
          banks = profile.startsWith('sdk-') ? 32 : 64,
          channels = Array.from({ length: banks }, (_, index) =>
            process.load(backend + 28 + index * 4),
          );
        assert.equal(process.allocations.get(owner), 0x78);
        assert.equal(process.load(owner + 116), flags);
        assert.equal(process.allocations.get(backend), banks === 32 ? 0x150 : 0x250);
        assert.equal(new Set(channels).size, banks);
        assert(channels.every((address) => process.allocations.has(address)));
        assert.equal(worker?.wait.kind, 'objects');
        assert.deepEqual(worker.wait.handles, [process.load(backend + 16)]);
        return { owner, backend, channels, handle, threadID, teb: worker.context.teb };
      };
      let fresh;
      try {
        first.options.configuration.setField('screen.fullWidth', 900);
        first.options.configuration.setField('screen.fullHeight', 660);
        await initializeNativeDesktop(first);
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
        Object.assign(first.options.configuration.soundOptions, { use3d: 1, sticky: 0 });
        const originalDisplay = await completeDisplay(first, 900, 660);
        const originalSound = soundResources(first, 0x10);
        fresh.options.configuration.setField('screen.noFullResolution', 1);
        Object.assign(fresh.options.configuration.soundOptions, { use3d: 0, sticky: 1 });
        const restoredDisplay = await completeDisplay(fresh, 1391, 703);
        const restoredSound = soundResources(fresh, 0x20);
        assert.equal(fresh.options.configuration.screen.fullWidth, 1391);
        assert.equal(fresh.options.configuration.screen.fullHeight, 703);
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
        assert.equal(fresh.process.load(block + 8), 0);
        assert.equal(fresh.process.load(block + 12), 0);
        assert.equal(fresh.kernel.threadHandles.handles.has(restoredSound.handle), false);
        assert.equal(fresh.kernel.threadHandles.threads.has(restoredSound.threadID), false);
        assert.equal(fresh.kernel.virtual.has(restoredSound.teb), false);
        for (const address of [
          restoredSound.owner,
          restoredSound.backend,
          ...restoredSound.channels,
        ])
          assert.equal(fresh.process.allocations.has(address), false);
        assert(first.process.allocations.has(originalSound.owner));
        assert(first.kernel.threadHandles.handles.has(originalSound.handle));
        for (const address of restoredDisplay)
          assert.equal(fresh.process.allocations.has(address), false);
        for (const address of originalDisplay) assert(first.process.allocations.has(address));
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
