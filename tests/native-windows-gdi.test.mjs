// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineWindows } from '../src/native/engine-process.mjs';
import { NativeTextWindows } from '../src/native/text-windows.mjs';

async function fixture() {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    windows = new NativeTextWindows(p, { kernel }),
    call = (name, args = []) =>
      p.callAsync(
        windows.resolve({ dll: name === 'FillRect' ? 'USER32.dll' : 'GDI32.dll', name }),
        args,
      );
  return { p, kernel, windows, call };
}
async function dib(f, width, height, bpp) {
  const info = f.p.allocate(64, true),
    out = f.p.allocate(4, true);
  try {
    [40, width, height, (bpp << 16) | 1].forEach((v, i) => f.p.store(info + i * 4, v));
    const handle = await f.call('CreateDIBSection', [0, info, 0, out, 0, 0]);
    return { handle, bitmap: f.windows.object(handle, 'bitmap') };
  } finally {
    f.p.free(info);
    f.p.free(out);
  }
}
test('selected DIB lifetime, fill, raster operations and stretch pixels match 144 pinned-Wine cases', async () => {
  const golden = JSON.parse(
      await readFile(new URL('fixtures/native-gdi-blit-golden.json', import.meta.url)),
    ),
    f = await fixture(),
    { p, kernel, call } = f,
    rect = p.allocate(16, true),
    out = p.allocate(24, true);
  try {
    for (const row of golden.cases) {
      const src = await dib(f, 4, -3, 32),
        dst = await dib(f, 5, row.height, row.depth),
        source = new Uint8Array(48);
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 4; x++)
          source.set(
            [
              (x * 23 + y * 71 + 3) & 255,
              (x * 31 + y * 17 + 5) & 255,
              (x * 47 + y * 11 + 7) & 255,
              (x * 19 + y * 29 + 13) & 255,
            ],
            (y * 4 + x) * 4,
          );
      p.write(src.bitmap.pixels, source);
      p.write(dst.bitmap.pixels, new Uint8Array(dst.bitmap.stride * 4).fill(0xa5));
      const sc = await call('CreateCompatibleDC', [0]),
        dc = await call('CreateCompatibleDC', [0]),
        other = await call('CreateCompatibleDC', [0]),
        stock = await call('GetCurrentObject', [sc, 7]),
        so = await call('SelectObject', [sc, src.handle]),
        od = await call('SelectObject', [dc, dst.handle]),
        conflict = await call('SelectObject', [other, src.handle]),
        previous = await call('SetStretchBltMode', [dc, row.mode ?? 3]);
      kernel.lastError = 0xb16a5;
      let returned;
      if (row.operation === 'fill') {
        row.rect.forEach((v, i) => p.store(rect + i * 4, v));
        const brush = await call('CreateSolidBrush', [row.color]);
        returned = await call('FillRect', [dc, rect, brush]);
        await call('DeleteObject', [brush]);
      } else {
        const [dx, dy, dw, dh, sx, sy, sw, sh] = row.params;
        returned = await call(
          row.operation === 'blit' ? 'BitBlt' : 'StretchBlt',
          row.operation === 'blit'
            ? [dc, dx, dy, dw, dh, sc, sx, sy, row.rop]
            : [dc, dx, dy, dw, dh, sc, sx, sy, sw, sh, row.rop],
        );
      }
      const label = JSON.stringify({ ...row, pixels: undefined });
      assert.deepEqual(
        [
          Number(!!stock),
          Number(so === stock),
          Number(!!od),
          Number(!!conflict),
          previous,
          returned,
          kernel.lastError,
        ],
        row.returned,
        label,
      );
      assert.equal(
        Buffer.from(p.read(dst.bitmap.pixels, dst.bitmap.stride * 4)).toString('hex'),
        row.pixels,
        label,
      );
      const deleted = await call('DeleteObject', [dst.handle]),
        queried = await call('GetObjectA', [dst.handle, 24, out]),
        old = await call('SelectObject', [dc, od]),
        again = await call('DeleteObject', [dst.handle]);
      assert.deepEqual(
        [deleted, queried, Number(old === dst.handle), again, kernel.lastError],
        row.deletion,
        label,
      );
      assert.equal(
        p.allocations.has(dst.bitmap.pixels),
        false,
        'deferred bitmap data is released at deselection',
      );
      await call('SelectObject', [sc, so]);
      await call('DeleteObject', [src.handle]);
      for (const h of [sc, dc, other]) await call('DeleteDC', [h]);
    }
  } finally {
    p.close();
  }
});
test('GDI selected pixels and deferred deletion retain original RAM and independent ownership in a fresh process', async () => {
  const a = await fixture(),
    b = await fixture();
  try {
    const image = await dib(a, 3, 2, 32),
      dc = await a.call('CreateCompatibleDC', [0]),
      old = await a.call('SelectObject', [dc, image.handle]),
      rect = a.p.allocate(16, true);
    [0, 0, 3, 2].forEach((v, i) => a.p.store(rect + i * 4, v));
    const brush = await a.call('CreateSolidBrush', [0x123456]);
    await a.call('FillRect', [dc, rect, brush]);
    await a.call('DeleteObject', [image.handle]);
    const state = a.windows.snapshot(),
      memory = a.p.snapshot();
    for (const trap of memory.traps) {
      const match = /^text:([^!]+)!([^!]+)$/.exec(trap.name);
      if (match) b.windows.resolve({ dll: match[1], name: match[2] });
    }
    b.p.restore(structuredClone(memory));
    b.windows.restore(structuredClone(state));
    assert.equal(await b.call('GetCurrentObject', [dc, 7]), image.handle);
    assert.deepEqual(b.p.read(image.bitmap.pixels, 24), a.p.read(image.bitmap.pixels, 24));
    const previous = await b.call('SelectObject', [dc, old]);
    assert.equal(previous, image.handle);
    assert.equal(b.p.allocations.has(image.bitmap.pixels), false);
    assert.equal(a.p.allocations.has(image.bitmap.pixels), true);
    await a.call('DeleteDC', [dc]);
    assert.equal(a.p.allocations.has(image.bitmap.pixels), false);
  } finally {
    b.p.close();
    a.p.close();
  }
});
