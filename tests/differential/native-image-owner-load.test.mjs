// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { imageOwnerFixture, imageOwnerFiles } from '../fixtures/image-owner-fixture.mjs';
import { authoredHG3 } from '../fixtures/hg3.mjs';

for (const fixture of await engineFixtureSet())
  test(
    fixture.profile +
      ' JS collection loading preserves selector tails, frame IDs, pixels and metadata',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const files = await imageOwnerFiles();
      const frame = {
        width: 2,
        height: 2,
        offsetX: 1,
        offsetY: 2,
        baseX: 3,
        baseY: -1,
        canvasWidth: 8,
        canvasHeight: 9,
        rgba: Uint8Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 255 : i * 11)),
      };
      files.set(
        '@cat/image/frames.hg3',
        authoredHG3([
          { ...frame, id: 7, bpp: 24 },
          { ...frame, id: 3, width: 2, height: 2, bpp: 32 },
        ]),
      );
      files.set('@cat/image/frames.anm', files.get('@cat/image/anim.anm'));
      const world = await dataWorld(
          fixture.profile,
          Object.fromEntries([...files].map(([k, v]) => [k.replace('@cat/image/', ''), v])),
        ),
        oracle = await imageOwnerFixture(fixture.bytes, fixture.profile, files),
        m = world.main.machine,
        p = oracle.process;
      oracle.machine.memory.set(m.memory);
      try {
        for (const file of [
          'probe.hg2',
          'attr.hg3',
          'anim.hg2',
          'frames.hg3',
          'probe:0.hg2',
          'missing.hg2',
          'broken.hg2',
          'empty.hg2',
          'composite,1.hg2',
          'composite,1,0.hg2',
          'composite,1,2.hg2',
          'composite,1,2,0.hg2',
        ]) {
          m.writeString(file, 256);
          oracle.machine.writeString(file, 256);
          const h = (await world.runtime.native('main', 0x2c6, [256], m, world.main)).value,
            oh = (await oracle.images.apply(0x2c6, [256], oracle.machine, world.main)).value;
          assert.equal(Boolean(h), Boolean(oh), file + ' success');
          assert.deepEqual(m.memory, oracle.machine.memory, file + ' VM');
          if (!h) continue;
          const model = world.imageOwners.get(h),
            raw = oracle.images.pointer(oh),
            v = p.load(raw + 16),
            entries = [];
          for (let at = p.load(v); at !== p.load(v + 4); at += 20) entries.push(at);
          assert.deepEqual(
            model.layers.map((l) => [
              l.key,
              Boolean(l.bitmap),
              Boolean(l.animation),
              l.program?.length ?? 0,
            ]),
            entries.map((at) => [
              p.load(at),
              Boolean(p.load(at + 4)),
              Boolean(p.load(at + 16)),
              p.load(at + 12),
            ]),
            file + ' layer kinds',
          );
          assert.deepEqual(
            model.info.map((n) => n >>> 0),
            Array.from({ length: 11 }, (_, i) => p.load(raw + 20 + i * 4)),
            file + ' info',
          );
          const bitmap = p.load(p.load(raw + 12)),
            w = p.load(bitmap + 4),
            height = p.load(bitmap + 8),
            bpp = p.load(bitmap + 24),
            pitch = p.load(bitmap + 20),
            data = p.load(bitmap + 12),
            rgba = new Uint8ClampedArray(w * height * 4);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < w; x++) {
              const row = p.read(data + (height - y - 1) * pitch + x * bpp, bpp);
              rgba.set([row[2], row[1], row[0], bpp === 4 ? row[3] : 255], (y * w + x) * 4);
            }
          assert.deepEqual(
            await world.graphics.images.get(model.bitmap).pixels(),
            rgba,
            file + ' pixels',
          );
          await world.imageOwners.release(h);
          await oracle.images.apply(0x2c7, [oh], oracle.machine, world.main);
        }
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );
