// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { bitmapMemoryFixture } from '../fixtures/bitmap-memory-fixture.mjs';
import { openImage } from '../../src/formats/hg3.mjs';
const fixture = JSON.parse(
  await readFile(new URL('../fixtures/native-jpeg-cases.json', import.meta.url)),
);
for (const engine of await engineFixtureSet())
  test(
    engine.profile + ' authored JPEGs preserve original decode bytes without browser codecs',
    { skip: !engine.available },
    async () => {
      const oracle = await bitmapMemoryFixture(engine.bytes, engine.profile);
      try {
        for (const sample of fixture.cases) {
          const bytes = new Uint8Array(Buffer.from(sample.jpeg, 'base64')),
            source = oracle.buffers.createPointer(bytes),
            wrapper = await oracle.buffers.decodeBitmapPointer(source),
            handle = oracle.images.create(0, 0);
          try {
            assert.ok(wrapper);
            await oracle.memory.adopt(handle, oracle.process.load(wrapper));
            const expected = await oracle.images.get(handle).pixels(),
              image = await openImage(bytes),
              frame = await image.decode(image.frame(0));
            assert.deepEqual(frame.rgba, expected, sample.name);
          } finally {
            await oracle.images.release(handle);
            await oracle.buffers.releaseBitmapPointer(wrapper);
            oracle.buffers.releasePointer(source);
          }
        }
      } finally {
        await oracle.engine.close();
      }
    },
  );
