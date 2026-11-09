// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

test('the Win32 accelerator table consumes only matching messages and sends the menu callbacks synchronously', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    address = (name) => kernel.resolve({ dll: 'USER32.dll', name }),
    menuItem = (id, state = 0, children = null) => ({ id, label: '', type: 0, state, children }),
    root = kernel.windowMenus.add([
      menuItem(null, 0, [menuItem(98), menuItem(null, 0, [menuItem(10), menuItem(11, 3)])]),
      menuItem(12),
    ]),
    menu = p.call(address('GetSubMenu'), [root, 0]),
    popup = p.call(address('GetSubMenu'), [menu, 1]),
    name = p.allocate(32, true),
    info = p.allocate(48, true),
    packet = p.allocate(28, true),
    observed = [];
  let modifiers = 0,
    capture = 0;
  kernel.accelerators.readModifiers = () => modifiers;
  kernel.accelerators.readCapture = () => capture;
  try {
    const proc = p.trap('authored accelerator window procedure', 4, ([handle, id, w, l]) => {
      if ([0x111, 0x116, 0x117].includes(id)) observed.push([handle, id, w, l]);
      return Number(id === 0x81);
    });
    kernel.writeString(name, 'AcceleratorProbe', true);
    p.store(info, 48);
    p.store(info + 8, proc);
    p.store(info + 20, 0x400000);
    p.store(info + 40, name);
    const atom = p.call(address('RegisterClassExW'), [info]),
      window = await p.callAsync(address('CreateWindowExW'), [
        0,
        atom,
        name,
        0xca0000,
        0,
        0,
        320,
        240,
        0,
        root,
        0x400000,
        0,
      ]),
      view = kernel.windowViews.windows.get(window),
      rows = [
        [0x13, 13, 10],
        [0x13, 115, 11],
        [3, 112, 99],
        [1, 65, 12],
        [5, 65, 13],
        [0, 65, 14],
        [4, 66, 15],
        [0x10, 67, 16],
        [9, 68, 17],
        [0, 65, 18],
        [1, 9, 19],
        [2, 68, 20],
        [8, 1, 21],
      ],
      records = p.allocate(rows.length * 6, true),
      bytes = new DataView(new ArrayBuffer(rows.length * 6));
    rows.forEach(([flags, key, command], index) => {
      bytes.setUint8(index * 6, flags);
      bytes.setUint16(index * 6 + 2, key, true);
      bytes.setUint16(index * 6 + 4, command, true);
    });
    p.write(records, new Uint8Array(bytes.buffer));
    const table = p.call(address('CreateAcceleratorTableW'), [records, rows.length]),
      init = [0x116, root, 0],
      enterPopup = [0x117, popup, 1],
      command = (id) => [0x111, 0x10000 | id, 0],
      altContext = 1 << 29;
    const check = async (
      [id, key, data, state, translated, messages, lastError = 12345],
      { hwnd = window, accel = table, suffix = 'W' } = {},
    ) => {
      modifiers = state;
      observed.length = 0;
      kernel.lastError = 12345;
      [window, id, key, data, 123, 4, 5].forEach((value, i) => p.store(packet + i * 4, value));
      const originalPacket = p.read(packet, 28);
      assert.equal(
        await p.callAsync(address('TranslateAccelerator' + suffix), [hwnd, accel, packet]),
        translated,
      );
      assert.deepEqual(
        observed,
        messages.map((message) => [window, ...message]),
      );
      assert.equal(kernel.lastError, lastError);
      assert.deepEqual(p.read(packet, 28), originalPacket);
    };

    // Matching order, exact virtual modifiers, character keys, menu paths and
    // the last error values were measured with the same table in pinned Wine.
    for (const row of [
      [0x104, 13, altContext, 16, 1, [init, enterPopup, command(10)], 0],
      [0x100, 13, 0, 16, 1, [init, enterPopup, command(10)], 0],
      [0x104, 13, altContext, 0, 0, []],
      [0x104, 13, 0, 16, 1, [init, enterPopup, command(10)], 0],
      [0x105, 115, altContext, 16, 0, []],
      [0x100, 112, 0, 0, 1, [command(99)]],
      [0x100, 65, 0, 0, 1, [init, command(12)], 0],
      [0x100, 65, 0, 4, 1, [command(13)]],
      [0x100, 65, 0, 12, 0, []],
      [0x102, 65, 0, 4, 1, [command(14)]],
      [0x102, 65, 0, 8, 1, [command(14)]],
      [0x102, 65, 0, 16, 0, []],
      [0x102, 0x10041, 0, 0, 0, []],
      [0x102, 66, 0, 0, 1, [command(15)]],
      [0x102, 66, 0, 4, 1, [command(15)]],
      [0x106, 67, 0, 16, 1, [command(16)]],
      [0x104, 67, altContext, 0, 1, [command(16)]],
      [0x104, 67, 0, 16, 0, []],
      [0x104, 67, altContext | (1 << 24), 16, 0, []],
      [0x102, 67, 0, 0, 0, []],
      [0x100, 68, 0, 8, 1, [command(17)]],
      [0x102, 68, 0, 0, 1, [command(20)]],
      [0x102, 1, 0, 0, 1, [command(21)]],
      [0x100, 9, 0, 0, 1, [command(19)]],
    ])
      await check(row);
    await check([0x104, 115, altContext, 16, 1, [init, enterPopup], 0], { suffix: 'A' });
    capture = window;
    await check([0x104, 13, altContext, 16, 1, [init, enterPopup], 0]);
    await check([0x100, 112, 0, 0, 1, [command(99)]]);
    capture = 0;
    view.style |= 0x08000000;
    await check([0x104, 13, altContext, 16, 1, [], 0]);
    await check([0x100, 112, 0, 0, 1, [command(99)]]);
    view.style = (view.style & ~0x08000000) | 0x20000000;
    await check([0x104, 13, altContext, 16, 1, [init, enterPopup], 0]);
    await check([0x100, 112, 0, 0, 1, [command(99)]]);
    await check([0x100, 112, 0, 0, 0, []], { accel: 42 });
    await check([0x100, 112, 0, 0, 0, []], { hwnd: 0 });
    await check([0x100, 112, 0, 0, 1, [], 1400], { hwnd: 42 });
  } finally {
    p.close();
  }
});
