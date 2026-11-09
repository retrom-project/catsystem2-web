// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import { initializeNativeStartupMenu } from '../src/native/engine-startup-menu.mjs';
import {
  createNativeStartupWindow,
  initializeNativeWindowOwner,
} from '../src/native/engine-startup-window.mjs';
import { initializeNativeWindowClass } from '../src/native/engine-window-class.mjs';
import { runNativeWindowPump } from '../src/native/engine-window-pump.mjs';

for (const [profile, variable, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'W'],
]) {
  test(
    `${profile} runs the original kcWindow event, message, and quit loop`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
          bootstrapOwner: {},
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          readFile: async () => null,
        }),
        p = engine.process,
        { messageQueue, windowViews, events, calls } = engine.kernel,
        user32 = (name) => engine.kernel.resolve({ dll: 'USER32.dll', name }),
        trace = [];
      try {
        await initializeNativeWindowClass(engine);
        await initializeNativeStartupMenu(engine);
        await initializeNativeWindowOwner(engine);
        await createNativeStartupWindow(engine);
        const owner = p.load(NATIVE_STARTUP_BLOCKS[profile]),
          handle = p.load(owner),
          popup = p.load(p.load(owner + 48) + 4),
          event = p.load(owner + 0x54),
          callback = p.trap('authored original idle callback', 1, ([argument]) => {
            trace.push(['event', argument]);
            assert.equal(messageQueue.post(handle, 0x4212, 21, 22), 1);
          }),
          pump = () =>
            runNativeWindowPump(engine, handle, {
              handles: (message) => message !== 0x4214,
              async deliver({ message, wParam, lParam }) {
                trace.push(['host', message, wParam, lParam]);
                if (message === 0x4210) {
                  await engine.call(user32('GetQueueStatus'), [0x108]);
                  assert.equal(messageQueue.post(handle, 0x4213, 31, 32), 1);
                }
              },
              stopping: () => false,
            }),
          count = (name) => calls.get('user32.dll!' + name) ?? 0;
        p.store(owner + 0x58, callback);
        p.store(owner + 0x5c, 73);
        const procedure = windowViews.windows.get(handle).procedure,
          unhook = p.beforeInstruction(procedure, 'observe original window dispatch', () => {
            const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
            trace.push(['guest', p.load(sp + 4), p.load(sp + 8)]);
          });
        try {
          assert.equal(await pump(), null);
          assert.equal(count('MsgWaitForMultipleObjects'), 0);
          assert.equal(messageQueue.post(handle, 0x4210, 11, 12), 1);
          assert.equal(messageQueue.post(popup, 0x4211), 1);
          assert.equal(messageQueue.post(handle, 0x4214), 1);
          events.signal(event, true);
          assert.equal(await pump(), null);
          assert.deepEqual(trace, [
            ['event', 73],
            ['host', 0x4210, 11, 12],
            ['guest', popup, 0x4211],
            ['guest', handle, 0x4214],
            ['host', 0x4214, 0, 0],
            ['host', 0x4212, 21, 22],
            ['host', 0x4213, 31, 32],
          ]);
          assert.equal(events.poll([event], false, false), null);
          assert.equal(count('MsgWaitForMultipleObjects'), 2);
          assert.equal(count('GetMessage' + suffix), 5);
          assert.equal(count('TranslateMessage'), 5);
          assert.equal(count('DispatchMessage' + suffix), 5);
          assert.equal(messageQueue.pending, false);
          assert.equal(await pump(), null);
          assert.equal(count('MsgWaitForMultipleObjects'), 2);
          await engine.call(user32('PostQuitMessage'), [-29]);
          assert.equal(await pump(), -29);
          assert.equal(count('GetMessage' + suffix), 6);
          assert.equal(count('DispatchMessage' + suffix), 5);
          assert.equal(messageQueue.pending, false);
          assert.equal(messageQueue.dispatchToHost, undefined);
        } finally {
          unhook();
        }
      } finally {
        await engine.close();
      }
    },
  );
}
