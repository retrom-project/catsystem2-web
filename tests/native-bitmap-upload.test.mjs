// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeGraphicsPlatform } from '../src/native/graphics-process.mjs';
import { NativeGraphics } from '../src/native/graphics.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeTexturePages } from '../src/native/texture-layout.mjs';
import {
  BITMAP_UPLOAD_LAYOUT,
  bitmapUploadCases,
  bitmapUploadSource,
} from './fixtures/bitmap-upload.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-d3d-bitmap-upload-golden.json', import.meta.url)),
);
for (const [index, probe] of bitmapUploadCases().entries())
  test(`native bitmap upload matches both original D3D LockRect paths: ${probe.name}`, async () => {
    assert.equal(golden.profiles.length, 2);
    const [pageWidth, pageHeight] = BITMAP_UPLOAD_LAYOUT.size,
      [columns, rows] = BITMAP_UPLOAD_LAYOUT.grid,
      width = pageWidth * columns,
      height = pageHeight * rows,
      world = { game: { width, height }, runtime: { handles: new NativeHandles() } },
      memory = new Uint8Array(1024),
      view = new DataView(memory.buffer),
      pointer = 64,
      data = 256,
      platform = Object.create(NativeGraphicsPlatform.prototype);
    world.graphics = new NativeGraphics(world);
    const graphics = world.graphics;
    graphics.texturePages = new NativeTexturePages({
      ...BITMAP_UPLOAD_LAYOUT,
      bpp: 32,
      bppY: [0, rows],
      areas: [[0, 0, columns, rows]],
    });
    for (const page of graphics.texturePages.pages.values()) page.frame.rgba.fill(0xa5);
    (await (await graphics.ensureVRAM(width, height)).pixels()).fill(0xa5);
    Object.assign(platform, {
      world,
      process: {
        load: (at) => view.getUint32(at, true),
        read: (at, length) => memory.slice(at, at + length),
      },
    });
    for (const [offset, value] of [
      [4, 5],
      [8, 4],
      [12, data],
      [20, 20],
      [24, 4],
      [36, probe.origin?.[0] ?? 0],
      [40, probe.origin?.[1] ?? 0],
    ])
      view.setUint32(pointer + offset, value >>> 0, true);
    memory.set(bitmapUploadSource(), data);
    const expected = golden.cases[index];
    assert.equal(expected.name, probe.name);
    assert.equal(
      await platform.copyBitmap(pointer, ...probe.source, ...probe.destination),
      expected.result,
    );
    for (const [pageIndex, page] of graphics.texturePages.pages) {
      const output = new Uint8Array(expected.pitch * pageHeight).fill(0xa5),
        rgba = page.frame.rgba;
      for (let y = 0; y < pageHeight; y++)
        for (let x = 0; x < pageWidth; x++) {
          const at = (y * pageWidth + x) * 4,
            out = y * expected.pitch + x * 4;
          output.set([rgba[at + 2], rgba[at + 1], rgba[at], rgba[at + 3]], out);
        }
      assert.equal(
        Buffer.from(output).toString('base64'),
        expected.pages[pageIndex],
        `entire page ${pageIndex}, including untouched pixels`,
      );
      assert.equal(
        Number(page.frame.revision > 0),
        expected.dirty[pageIndex],
        `dirty page ${pageIndex}`,
      );
    }
  });
