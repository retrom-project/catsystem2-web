// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineWindows } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

test('a declined Win32 creation reports the original callbacks and releases its transient HWND', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    call = (name, ...args) => p.call(kernel.resolve({ dll: 'USER32.dll', name }), args),
    info = p.allocate(48, true),
    name = p.allocate(32, true),
    messages = [],
    createStructs = [];
  let decline;
  try {
    const proc = p.trap('authored create callback', 4, ([handle, message, wParam, lParam]) => {
      messages.push(message);
      assert.equal(kernel.windowViews.windows.has(handle), true);
      assert.equal(wParam, 0);
      if (message === 0x81 || message === 1) {
        createStructs.push(Array.from({ length: 12 }, (_, i) => p.load(lParam + i * 4)));
        if (message === decline) return message === 1 ? 0xffffffff : 0;
      }
      return message === 0x81 ? 1 : 0;
    });
    kernel.writeString(name, 'Authored', true);
    p.store(info, 48);
    p.store(info + 8, proc);
    p.store(info + 20, 0x400000);
    p.store(info + 40, name);
    const atom = call('RegisterClassExW', info),
      create = kernel.resolve({ dll: 'USER32.dll', name: 'CreateWindowExW' }),
      allocations = p.allocations.size,
      args = [0, atom, name, 0xca0000, 31, 35, 646, 505, 0, 0, 0x400000, 0x3456],
      expectedStruct = [0x3456, 0x400000, 0, 0, 505, 646, 35, 31, 0xca0000, name, atom, 0];
    assert.ok(atom);
    // The pinned Wine host sends WM_NCDESTROY after either creation refusal.
    for (const [message, expected] of [
      [0x81, [0x24, 0x81, 0x82]],
      [1, [0x24, 0x81, 0x83, 1, 0x82]],
    ]) {
      decline = message;
      messages.length = createStructs.length = 0;
      assert.equal(await p.callAsync(create, args), 0);
      assert.deepEqual(messages, expected);
      for (const structure of createStructs) assert.deepEqual(structure, expectedStruct);
      assert.equal(createStructs.length, message === 1 ? 2 : 1);
      assert.equal(kernel.windowViews.windows.size, 0);
      assert.equal(p.allocations.size, allocations);
    }
    assert.equal(call('UnregisterClassW', atom, 0x400000), 1);
  } finally {
    p.close();
  }
});
