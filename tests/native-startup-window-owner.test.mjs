// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import { initializeNativeStartupMenu } from '../src/native/engine-startup-menu.mjs';
import { initializeNativeWindowClass } from '../src/native/engine-window-class.mjs';
import { NativeInputDevice } from '../src/native/input-device.mjs';
import {
  createNativeStartupWindow,
  initializeNativeWindowOwner,
  releaseNativeWindowOwner,
  setNativeWindowCaption,
} from '../src/native/engine-startup-window.mjs';

for (const [profile, variable, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'W'],
]) {
  test(
    `${profile} original kcWindow synchronization and callbacks survive independent restore`,
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
        block = NATIVE_STARTUP_BLOCKS[profile];
      let restored;
      try {
        await initializeNativeStartupMenu(first);
        await initializeNativeWindowOwner(first);
        const owner = p.load(block),
          event = p.load(owner + 96),
          callbacks = p.load(owner + 56),
          head = p.load(callbacks);
        assert.equal(p.allocations.get(owner), 0x74);
        assert.equal(p.load(p.load(block + 36) + 4), block);
        assert.equal(p.load(owner + 84), event);
        assert.equal(p.allocations.get(callbacks), 8);
        assert.equal(p.load(head), head);
        assert.equal(p.load(head + 4), head);
        assert.equal(first.kernel.locks.get(owner + 60), 0);
        assert.equal(first.kernel.calls.get('kernel32.dll!CreateEvent' + suffix), 1);
        assert.equal(first.kernel.events.wait([event], false, 0), 0x102);
        first.kernel.events.signal(event, true);

        restored = await open();
        restored.restore(first.snapshot());
        assert.equal(restored.process.load(block), owner);
        assert.equal(restored.process.load(owner + 56), callbacks);
        assert.equal(restored.kernel.events.wait([event], false, 0), 0);
        assert.equal(restored.kernel.events.wait([event], false, 0), 0x102);
        await releaseNativeWindowOwner(restored);
        assert.equal(restored.process.load(block), 0);
        assert.equal(restored.process.allocations.has(owner), false);
        assert.equal(restored.process.allocations.has(callbacks), false);
        assert.equal(restored.process.allocations.has(head), false);
        assert.equal(restored.kernel.locks.has(owner + 60), false);
        assert.equal(restored.kernel.events.events.has(event), false);
        assert.equal(first.kernel.events.wait([event], false, 0), 0);
      } finally {
        await restored?.close();
        await first.close();
      }
    },
  );
}

for (const [profile, variable, menuFlag, hook] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 48804, 0xc9659c],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 51728, 0xb91bc4],
]) {
  test(
    `${profile} original kcWindow opens its main and menu windows`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        open = () =>
          NativeEngineProcess.open({
            profile,
            bytes,
            bootstrapOwner: { displaySize: () => [1391, 703] },
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            readFile: async () => null,
          }),
        engine = await open(),
        p = engine.process,
        block = NATIVE_STARTUP_BLOCKS[profile],
        device = (instance) =>
          new NativeInputDevice(instance, {
            configuration: instance.options.configuration,
            input: { x: 0, y: 0 },
            host: {},
            game: { width: 640, height: 480 },
            windowMessages: [],
          });
      let fresh;
      try {
        await initializeNativeWindowClass(engine);
        await initializeNativeStartupMenu(engine);
        await initializeNativeWindowOwner(engine);
        engine.options.configuration.setField('screen.width', 640);
        engine.options.configuration.setField('screen.height', 480);
        engine.configurationMemory.push();
        p.store(engine.refs.settings + menuFlag, 1);
        const owner = p.load(block),
          menu = p.load(block + 36),
          classRecord = engine.refs.windowClass,
          atom = p.load(classRecord) & 0xffff,
          proc = engine.kernel.windowClasses.classes.get(atom).procedure,
          messages = [],
          removeHook = p.beforeInstruction(proc, 'record startup window creation messages', () => {
            const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
            messages.push([p.load(sp + 4), p.load(sp + 8)]);
          });
        try {
          await createNativeStartupWindow(engine);
        } finally {
          removeHook();
        }
        const handle = p.load(owner),
          windows = engine.kernel.windowViews.windows,
          helper = p.load(p.load(owner + 48) + 4),
          root = windows.get(handle),
          popup = windows.get(helper),
          call = (name, ...args) =>
            p.call(engine.kernel.resolve({ dll: 'USER32.dll', name }), args),
          suffix = profile.startsWith('sdk-') ? 'A' : 'W';
        assert.equal(p.load(owner), handle);
        assert.equal(handle, 1);
        assert.notEqual(helper, handle);
        assert.deepEqual(messages, [
          ...[0x24, 0x81, 0x83, 1].map((message) => [handle, message]),
          ...[0x81, 0x83, 1, 5, 3].map((message) => [helper, message]),
        ]);
        assert.deepEqual(root.bounds, [372, 70, 1018, 594]);
        assert.deepEqual(root.client, [375, 111, 640, 480]);
        assert.deepEqual(popup.bounds, [0, 0, 1391, 19]);
        assert.equal(popup.parent, handle);
        assert.equal(root.title, 'kcWindow');
        assert.equal(popup.title, 'kcMenuWindow');
        assert.equal(root.menu, p.load(menu + 8));
        assert.equal(popup.menu, root.menu);
        assert.equal(call('GetWindowLong' + suffix, handle, -21), owner);
        assert.equal(call('UnregisterClass' + suffix, atom, engine.module.base), 0);
        assert.equal(engine.kernel.lastError, 1412);

        const input = device(engine),
          nativeInput = await input.pointer(),
          hookOwner = p.load(hook);
        assert.equal(p.load(owner + 8), nativeInput);
        assert.equal(input.refs.userData, owner);
        assert.equal(p.load(nativeInput), handle);
        assert.equal(p.allocations.get(hookOwner), 8);
        engine.options.configuration.setField('application.title', '$WINDOW$猫の窓');
        const caption = await setNativeWindowCaption(engine);
        assert.equal(caption, suffix === 'A' ? '$WINDOW$猫の窓' : '猫の窓');
        assert.equal(root.title, caption);
        assert.equal(popup.title, 'kcMenuWindow');
        assert.equal(engine.kernel.calls.get('user32.dll!SetWindowText' + suffix), 1);
        const captionBytes = p.allocations.size;
        assert.equal(await setNativeWindowCaption(engine, '更新した窓'), '更新した窓');
        assert.equal(p.allocations.size, captionBytes);
        const output = p.allocate(64, true);
        for (const wide of [false, true]) {
          const getText = engine.kernel.resolve({
            dll: 'USER32.dll',
            name: wide ? 'GetWindowTextW' : 'GetWindowTextA',
          });
          assert.equal(await engine.call(getText, [handle, output, 32]), wide ? 5 : 10);
          assert.equal(p.string(output, wide), '更新した窓');
        }
        p.free(output);
        fresh = await open();
        const freshInput = device(fresh);
        fresh.restore(engine.snapshot());
        assert.deepEqual(fresh.kernel.windowViews.windows, windows);
        assert.equal(await freshInput.pointer(), nativeInput);
        await freshInput.close();
        assert.equal(fresh.process.load(owner + 8), 0);
        assert.equal(fresh.process.allocations.has(nativeInput), false);
        assert.equal(p.load(owner + 8), nativeInput);
        await releaseNativeWindowOwner(fresh);
        assert.equal(fresh.process.load(hook), 0);
        assert.equal(fresh.process.allocations.has(hookOwner), false);
        assert.equal(fresh.kernel.windowViews.windows.size, 0);
        assert.equal(fresh.kernel.windowViews.quit, 0);
        assert.equal(fresh.kernel.windowMenus.menus.has(root.menu), true);
        assert.equal(windows.size, 2);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
}
