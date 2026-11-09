// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineWindows } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

test('Win32 menu queries preserve buffer boundaries and deletion releases submenu handles', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    command = { id: 17, label: 'space', type: 0, state: 0, children: null },
    separator = { id: 0, label: '', type: 0x800, state: 3, children: null },
    menu = kernel.windowMenus.add([
      { id: null, label: 'parent', type: 0, state: 0, children: [command, separator] },
    ]),
    info = p.allocate(48),
    buffer = p.allocate(16),
    call = (name, ...args) => p.call(kernel.resolve({ dll: 'USER32.dll', name }), args),
    request = (mask, capacity, ptr = buffer) => {
      p.write(info, new Uint8Array(48).fill(0xee));
      p.store(info, 48);
      p.store(info + 4, mask);
      p.store(info + 36, ptr);
      p.store(info + 40, capacity);
      p.write(buffer, new Uint8Array(16).fill(0xa5));
    },
    check = (bytes) =>
      assert.deepEqual(
        p.read(buffer, 16),
        Uint8Array.from([...bytes, ...Array(16 - bytes.length).fill(0xa5)]),
      );
  try {
    // An authored Windows probe under the pinned Wine build covers lookup by
    // nested command ID, short buffers and the two different terminator rules.
    for (const [suffix, cap, count, bytes] of [
      ['A', 0, 5, []],
      ['A', 1, 0, [115]],
      ['A', 4, 3, [115, 112, 97, 99]],
      ['A', 6, 5, [115, 112, 97, 99, 101, 0]],
      ['W', 0, 5, []],
      ['W', 1, 0, [0, 0]],
      ['W', 4, 3, [115, 0, 112, 0, 97, 0, 0, 0]],
      ['W', 6, 5, [115, 0, 112, 0, 97, 0, 99, 0, 101, 0, 0, 0]],
    ]) {
      request(0x147, cap);
      assert.equal(call('GetMenuItemInfo' + suffix, menu, 17, 0, info), 1);
      assert.equal(p.load(info + 40), count);
      assert.equal(p.load(info + 16), 17);
      assert.equal(p.load(info + 20), 0);
      check(bytes);
    }
    request(0x40, 0, 0);
    assert.equal(call('GetMenuItemInfoW', menu, 17, 0, info), 1);
    assert.equal(p.load(info + 40), 5);
    assert.equal(p.load(info + 16), 0xeeeeeeee);
    check([]);

    const sub = call('GetSubMenu', menu, 0);
    request(0x44, 8);
    assert.equal(call('GetMenuItemInfoW', sub, 1, 1, info), 1);
    assert.equal(p.load(info + 40), 0);
    assert.equal(p.load(info + 8), 0xeeeeeeee);
    check([0, 0]);

    request(0x40, 0);
    kernel.writeString(buffer, '猫');
    assert.equal(call('SetMenuItemInfoA', menu, 17, 0, info), 1);
    request(0x40, 8);
    assert.equal(call('GetMenuItemInfoW', menu, 17, 0, info), 1);
    assert.equal(p.string(buffer, true), '猫');
    assert.equal(p.load(info + 40), 1);
    assert.equal(call('GetMenuItemInfoW', menu, 999, 0, info), 0);
    assert.equal(kernel.lastError, 1456);
    assert.equal(p.load(info + 40), 1);
    assert.equal(call('DeleteMenu', menu, 17, 0), 1);
    assert.equal(call('GetMenuItemInfoW', menu, 17, 0, info), 0);
    assert.equal(call('GetMenuItemCount', sub), 1);
    assert.equal(call('DeleteMenu', menu, 0, 0x400), 1);
    assert.equal(call('GetMenuItemCount', menu), 0);
    assert.equal(call('GetMenuItemCount', sub), 0xffffffff);
  } finally {
    p.close();
  }
});
