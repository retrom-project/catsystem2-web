// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bitmapMemoryFixture } from './fixtures/bitmap-memory-fixture.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original mirror changes shared pixels, canvas-relative metadata and retained attributes`,
    { skip: !process.env[variable] },
    async () => {
      const f = await bitmapMemoryFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        h = f.images.create(3, 2, 1),
        bitmap = f.images.get(h),
        source = Uint8ClampedArray.from(
          [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [0, 255, 255, 255],
            [255, 0, 255, 255],
            [255, 255, 0, 255],
          ].flat(),
        );
      Object.assign(bitmap.state, {
        rgba: source,
        canvasWidth: 9,
        canvasHeight: 7,
        offsetX: -2,
        offsetY: 1,
        baseX: 4,
        baseY: -3,
        attributes: [{ id: 7, rect: [1, 2, 3, 4], color: 0xffaabbcc }],
      });
      const alias = f.images.alias(h, 2),
        call = (id, args) => f.operations.apply(id, args, f.machine, { id: 1 });
      try {
        const pointer = await f.memory.pointer(h),
          p = f.process,
          attribute = p.load(p.load(p.load(p.load(pointer + 72))) + 20),
          reversed = [
            ...source.slice(8, 12),
            ...source.slice(4, 8),
            ...source.slice(0, 4),
            ...source.slice(20, 24),
            ...source.slice(16, 20),
            ...source.slice(12, 16),
          ];
        assert.deepEqual(await call(0x22e, [alias, 1]), { control: 2 });
        assert.equal(await f.memory.pointer(alias), pointer);
        assert.deepEqual([...(await bitmap.pixels())], reversed);
        assert.deepEqual(
          [bitmap.state.offsetX, bitmap.state.offsetY, bitmap.state.baseX, bitmap.state.baseY],
          [8, 1, 5, -3],
        );
        assert.deepEqual(bitmap.state.attributes, [
          { id: 7, rect: [8, 2, 3, 4], color: 0xffaabbcc },
        ]);
        assert.equal(p.load(p.load(p.load(p.load(pointer + 72))) + 20), attribute);
        assert.deepEqual(await call(0x22e, [h, 0]), { control: 2 });
        assert.deepEqual(
          [...(await f.images.get(alias).pixels())],
          [...reversed.slice(12), ...reversed.slice(0, 12)],
        );
        assert.deepEqual(
          [bitmap.state.offsetX, bitmap.state.offsetY, bitmap.state.baseX, bitmap.state.baseY],
          [8, 4, 5, 10],
        );
        assert.deepEqual(bitmap.state.attributes, [
          { id: 7, rect: [8, 5, 3, 4], color: 0xffaabbcc },
        ]);
        assert.equal(p.load(p.load(p.load(p.load(pointer + 72))) + 20), attribute);
        const pixels = [...(await bitmap.pixels())];
        assert.deepEqual(await call(0x234, [alias, 0x89abcdef]), { control: 2 });
        assert.equal(bitmap.state.mask, 0x89abcdef);
        assert.equal(p.load(pointer + 76), 0x89abcdef);
        assert.deepEqual([...(await bitmap.pixels())], pixels);
        assert.deepEqual(await call(0x22e, [0]), { control: 2 });
        assert.deepEqual(await call(0x234, [0]), { control: 2 });
      } finally {
        await f.engine.close();
      }
    },
  );
