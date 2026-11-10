// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { HG3 } from '../src/formats/hg3.mjs';
import { authoredHG3, authoredHG3Frames } from './fixtures/hg3.mjs';
import { hg3 } from './helpers.mjs';

const metadata = (frame) =>
  ['width', 'height', 'canvasWidth', 'canvasHeight', 'offsetX', 'offsetY', 'baseX', 'baseY'].map(
    (field) => frame[field],
  );
test('HG3 parts preserve top-down rows, independent alpha, crop metadata and distinct selectors', async () => {
  const frames = authoredHG3Frames(),
    image = new HG3(authoredHG3(frames));
  for (const original of frames) {
    const decoded = await image.decode(image.frame(original.id));
    assert.deepEqual(metadata(decoded), metadata(original));
    assert.deepEqual([...decoded.rgba], [...original.rgba]);
  }
  assert.equal(image.frame(999), undefined);
});

for (const [profile, variable, pixelAt] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x68cd70],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x5638e0],
]) {
  test(
    `${profile} original HG3 parser agrees on every row, split part, selector and metadata field`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        buffers = new NativeDataBuffers(engine),
        frames = authoredHG3Frames(),
        bytes = authoredHG3(frames),
        source = buffers.createPointer(bytes),
        image = new HG3(bytes);
      try {
        for (const original of frames) {
          const wrapper = await buffers.decodeBitmapPointer(source, original.id);
          assert.ok(wrapper);
          try {
            const pointer = p.load(wrapper),
              decoded = await image.decode(image.frame(original.id)),
              nativeMetadata = [4, 8, 28, 32, 36, 40, 48, 52].map(
                (offset) => p.load(pointer + offset) | 0,
              ),
              rgba = [];
            for (let y = 0; y < original.height; y++)
              for (let x = 0; x < original.width; x++) {
                // Query the original image's logical (x,y) accessor. This does
                // not assume its physical allocation's row direction.
                const address = await engine.call(pixelAt, [x, y], pointer),
                  row = p.read(address, 4);
                rgba.push(row[2], row[1], row[0], row[3]);
              }
            assert.deepEqual(nativeMetadata, metadata(original));
            assert.deepEqual(rgba, [...original.rgba]);
            assert.deepEqual([...decoded.rgba], rgba);
          } finally {
            await buffers.releaseBitmapPointer(wrapper);
          }
        }
        assert.equal(await buffers.decodeBitmapPointer(source, 999), 0);
      } finally {
        buffers.releasePointer(source);
        engine.close();
      }
    },
  );

  test(
    `${profile} decodes a full HG3 bitmap within a bounded native call`,
    { skip: !process.env[variable] },
    async () => {
      const width = 512,
        height = 512,
        pitch = width * 4,
        rgba = new Uint8Array(pitch * height),
        bottomUp = new Uint8Array(rgba.length);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const r = (x * 53 + y * 19) & 255,
            g = (x * 7 + y * 29) & 255,
            b = (x * 13 + y * 31) & 255,
            a = 255 - ((x + y) & 127);
          rgba.set([r, g, b, a], y * pitch + x * 4);
          bottomUp.set([b, g, r, a], (height - y - 1) * pitch + x * 4);
        }
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        buffers = new NativeDataBuffers(engine),
        source = buffers.createPointer(hg3(width, height, rgba));
      let bitmap = 0;
      try {
        p.budget = 12000000;
        bitmap = await buffers.decodeBitmapPointer(source, 0);
        assert.ok(bitmap);
        const image = p.load(bitmap);
        assert.deepEqual(
          [4, 8, 20].map((at) => p.load(image + at)),
          [width, height, pitch],
        );
        assert.deepEqual(p.read(p.load(image + 12), bottomUp.length), bottomUp);
      } finally {
        if (bitmap) await buffers.releaseBitmapPointer(bitmap);
        buffers.releasePointer(source);
        await engine.close();
      }
    },
  );
}
