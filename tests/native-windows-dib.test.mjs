// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { NativeTextWindows } from '../src/native/text-windows.mjs';

async function fixture() {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    windows = new NativeTextWindows(p, { kernel }),
    call = (name, args = []) => p.callAsync(windows.resolve({ dll: 'GDI32.dll', name }), args);
  return { p, kernel, windows, call };
}
test('DIB allocations and complete A/W GetObject structures match authored pinned-Wine cases', async () => {
  const golden = JSON.parse(
      await readFile(new URL('fixtures/native-dib-golden.json', import.meta.url)),
    ),
    { p, kernel, windows, call } = await fixture(),
    info = p.allocate(1200, true),
    bits = p.allocate(4, true),
    out = p.allocate(136, true);
  try {
    for (const row of golden.cases) {
      p.zero(info, 1200);
      [
        row.header,
        row.width,
        row.height,
        (row.bpp << 16) | row.planes,
        row.compression,
        0,
        row.xppm ?? 0,
        row.yppm ?? 0,
        row.colorsUsed ?? 0,
        row.colorsImportant ?? 0,
        ...(row.masks ?? [0, 0, 0]),
      ].forEach((n, i) => p.store(info + i * 4, n));
      p.store(bits, 0x13579bdf);
      kernel.lastError = 0xb16a5;
      const handle = await call('CreateDIBSection', [0, info, 0, row.nullBits ? 0 : bits, 0, 0]);
      assert.equal(Number(!!handle), row.success, JSON.stringify(row));
      assert.equal(kernel.lastError, row.error);
      assert.equal(p.load(bits) === 0x13579bdf ? 0 : p.load(bits) ? 2 : 1, row.bits);
      if (handle) {
        const bitmap = windows.object(handle, 'bitmap');
        assert.deepEqual(
          p.read(bitmap.pixels, bitmap.stride * bitmap.height),
          new Uint8Array(bitmap.stride * bitmap.height),
        );
      }
      for (const expected of row.objects) {
        p.write(out, new Uint8Array(136).fill(0xa5));
        const returned = await call(`GetObject${expected.wide ? 'W' : 'A'}`, [
            handle,
            expected.size,
            out + 4,
          ]),
          bytes = p.read(out + 4, 128);
        assert.equal(returned, expected.returned);
        if (returned >= 24 && new DataView(bytes.buffer).getUint32(20, true))
          new DataView(bytes.buffer).setUint32(20, 1, true);
        assert.equal(
          Buffer.from(bytes).toString('hex'),
          expected.bytes,
          `${row.bpp}/${row.header}/${expected.size}`,
        );
        assert.deepEqual([...p.read(out, 4), ...p.read(out + 132, 4)], new Array(8).fill(0xa5));
      }
      assert.equal(await call('GetObjectA', [handle, 0, 0]), row.queryA);
      assert.equal(await call('GetObjectW', [handle, 0, 0]), row.queryW);
      const pixels = handle ? windows.object(handle).pixels : 0;
      assert.equal(await call('DeleteObject', [handle]), row.deleted);
      if (pixels)
        assert.equal(
          p.allocations.has(pixels),
          false,
          'DeleteObject releases the actual pixel allocation',
        );
    }
  } finally {
    p.close();
  }
});
test('DIB pixels and descriptor identity retain one allocation through WASM growth and a fresh process', async () => {
  const first = await fixture();
  let fresh,
    closed = false;
  try {
    const info = first.p.allocate(40, true),
      bits = first.p.allocate(4, true),
      out = first.p.allocate(84, true);
    [40, 3, 0xfffffffd, 0x200001].forEach((n, i) => first.p.store(info + i * 4, n));
    const handle = await first.call('CreateDIBSection', [0, info, 0, bits, 0, 0]),
      pixels = first.p.load(bits);
    first.p.write(pixels, Uint8Array.of(1, 2, 3, 4));
    await first.call('GetObjectA', [handle, 84, out]);
    assert.equal(first.p.load(out + 20), pixels);
    const process = first.p.snapshot(),
      kernel = structuredClone(first.kernel.snapshot()),
      windows = structuredClone(first.windows.snapshot());
    fresh = await fixture();
    for (const trap of process.traps) {
      const match = /^text:([^!]+)!([^!]+)$/.exec(trap.name);
      if (match) fresh.windows.resolve({ dll: match[1], name: match[2] });
    }
    fresh.p.restore(process);
    fresh.kernel.restore(kernel);
    fresh.windows.restore(windows);
    first.p.close();
    closed = true;
    assert.equal(fresh.windows.object(handle).pixels, pixels);
    const allocation = fresh.p.allocate(20 * 1024 * 1024, true);
    fresh.p.write(pixels + 4, Uint8Array.of(5, 6, 7, 8));
    assert.deepEqual([...fresh.p.read(pixels, 8)], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(await fresh.call('GetObjectA', [handle, 84, out]), 84);
    assert.equal(fresh.p.load(out + 20), pixels);
    assert.equal(await fresh.call('DeleteObject', [handle]), 1);
    assert.equal(fresh.p.allocations.has(pixels), false);
    fresh.p.free(allocation);
  } finally {
    fresh?.p.close();
    if (!closed) first.p.close();
  }
});
