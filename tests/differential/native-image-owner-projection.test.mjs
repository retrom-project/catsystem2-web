// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { imageOwnerFiles } from '../fixtures/image-files.mjs';
import { imageOwnerFixture } from '../fixtures/image-owner-fixture.mjs';
import { transitionalExe } from '../../web/transitional-entry.mjs';
const fixtures = await engineFixtureSet(),
  sdk = fixtures.find((f) => f.profile.startsWith('sdk-'));
test(
  'SDK image-owner projection keeps layer inputs in JS across resize, ANM rebuild and restore',
  { skip: sdk.available ? false : sdk.reason },
  async () => {
    const files = Object.fromEntries(
      [...(await imageOwnerFiles())].map(([key, bytes]) => [key.replace('@cat/image/', ''), bytes]),
    );
    files['engine.exe'] = sdk.bytes;
    const make = async () => {
      const w = await dataWorld(sdk.profile, files, { initialize: false });
      delete w.ensureNativeEngine;
      w.transitionalExe = transitionalExe;
      return w;
    };
    const world = await make(),
      oracle = await imageOwnerFixture(sdk.bytes, sdk.profile);
    let fresh;
    try {
      await world.initialize('case.kcs');
      const m = world.main.machine;
      oracle.machine.memory.set(m.memory);
      for (const file of ['probe.hg2', 'anim.hg2', 'composite,1,2.hg2']) {
        m.writeString(file, 256);
        oracle.machine.writeString(file, 256);
        const h = (await world.runtime.native('main', 0x2c6, [256], m, world.main)).value,
          oh = (await oracle.images.apply(0x2c6, [256], oracle.machine, world.main)).value;
        assert.ok(h);
        const projection = await world.getNativeFeature('image-owner-projection');
        for (const [id, args] of [
          [0x2c9, [50, 100, 200]],
          [0x2d3, [90]],
          [0x2d7, [1]],
          [0x2da, [8, 6]],
        ]) {
          await world.runtime.native('main', id, [h, ...args], m, world.main);
          await oracle.images.apply(id, [oh, ...args], oracle.machine, world.main);
          const model = world.imageOwners.get(h),
            p = oracle.process,
            op = oracle.images.pointer(oh);
          assert.deepEqual(
            model.info.map((v) => v >>> 0),
            Array.from({ length: 11 }, (_, i) => p.load(op + 20 + i * 4)),
            file + '/' + id.toString(16) + ' owner metadata',
          );
          const out = p.load(p.load(op + 12)),
            w = p.load(out + 4),
            height = p.load(out + 8),
            pitch = p.load(out + 20),
            data = p.load(out + 12),
            rgba = new Uint8ClampedArray(w * height * 4);
          for (let y = 0; y < height; y++) {
            const row = p.read(data + (height - y - 1) * pitch, w * 4);
            for (let x = 0; x < w; x++)
              rgba.set(
                [row[x * 4 + 2], row[x * 4 + 1], row[x * 4], row[x * 4 + 3]],
                (y * w + x) * 4,
              );
          }
          assert.deepEqual(
            await world.graphics.images.get(model.bitmap).pixels(),
            rgba,
            file + '/' + id.toString(16) + ' output pixels',
          );
          await world.imageOwners.materialize(h);
          const record = projection.refs.models.get(h),
            wp = world.nativeEngine.process;
          assert.deepEqual(
            Array.from({ length: 11 }, (_, i) => wp.load(record.pointer + 20 + i * 4)),
            model.info.map((v) => v >>> 0),
          );
          for (const source of record.sources) {
            if (!world.runtime.handles.records.has(source.handle)) continue;
            const image = world.graphics.images.get(source.handle);
            assert.equal(wp.load(source.pointer + 4), image.width);
            assert.equal(wp.load(source.pointer + 8), image.height);
          }
        }
      }
      fresh = await make();
      await fresh.restore(structuredClone(world.snapshot()));
      for (const [handle, entry] of world.runtime.handles.records)
        if (entry.type === 'image-owner')
          assert.deepEqual(fresh.imageOwners.get(handle), entry.value);
    } finally {
      await fresh?.close();
      await world.close();
      await oracle.engine.close();
    }
  },
);
