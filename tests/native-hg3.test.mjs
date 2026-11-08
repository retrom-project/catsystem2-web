// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { HG3 } from '../src/formats/hg3.mjs';
import { authoredHG3, authoredHG3Frames } from './fixtures/hg3.mjs';

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
}
