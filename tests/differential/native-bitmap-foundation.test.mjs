// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { bitmapMemoryFixture } from '../fixtures/bitmap-memory-fixture.mjs';
import { bitmapFactoryFixture } from '../fixtures/bitmap-factory-fixture.mjs';
import { imageOwnerFixture } from '../fixtures/image-owner-fixture.mjs';
import { imageOwnerFiles } from '../fixtures/image-files.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NATIVE_EXE_PROFILES } from '../../src/native/catalog.mjs';
import { NATIVE_BITMAP_FACTORY_CONTRACTS } from '../../oracle/bitmap-factory.mjs';

const fields = [
  'width',
  'height',
  'bpp',
  'canvasWidth',
  'canvasHeight',
  'offsetX',
  'offsetY',
  'baseX',
  'baseY',
  'mask',
  'blendType',
  'alphaHint',
];
async function bitmapState(images, handle) {
  const image = images.get(handle),
    rgba = await image.pixels();
  return {
    fields: fields.map((name) => image.state[name] ?? 0),
    clip: [...image.state.clip],
    attributes: image.state.attributes ?? [],
    rgba: [...rgba],
  };
}
for (const fixture of await engineFixtureSet()) {
  test(
    fixture.profile +
      ' independent JS bitmap factory sequences retain exact pixels and output canaries',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const f = await bitmapFactoryFixture(fixture.bytes, fixture.profile),
        world = await dataWorld(
          fixture.profile,
          Object.fromEntries(
            [...(await imageOwnerFiles())].map(([name, bytes]) => [
              name.replace('@cat/image/', ''),
              bytes,
            ]),
          ),
        ),
        machines = [world.main.machine, f.machine],
        values = [new Map(), new Map()],
        live = new Set();
      const clears = [];
      world.graphics.fill = async (...args) => clears.push(args);
      f.machine.memory.set(world.main.machine.memory);
      async function run(id, args, { create, release } = {}) {
        const results = [];
        for (let side = 0; side < 2; side++) {
          const words = args.map((word) =>
              typeof word === 'string' ? values[side].get(word) : word,
            ),
            machine = machines[side];
          const reply = side
            ? await f.factories.apply(id, words, machine, { id: world.main.id })
            : await world.runtime.native('main', id, words, machine, world.main);
          if (create) values[side].set(create, reply.value);
          results.push({ ...reply, ...(create ? { value: reply.value ? create : 0 } : {}) });
        }
        assert.deepEqual(results[0], results[1], 'native ' + id.toString(16));
        assert.deepEqual(machines[0].memory, machines[1].memory, 'all VM output bytes');
        if (create && values[0].get(create)) live.add(create);
        if (release) live.delete(release);
        for (const name of live)
          assert.deepEqual(
            await bitmapState(world.graphics.images, values[0].get(name)),
            await bitmapState(f.images, values[1].get(name)),
            id.toString(16) + ' ' + name,
          );
      }
      try {
        for (const spec of NATIVE_BITMAP_FACTORY_CONTRACTS)
          assert.equal(
            f.process.load(NATIVE_EXE_PROFILES[fixture.profile].tables.main.va + 4 * spec.id),
            spec.handlers[Number(fixture.profile.startsWith('sdk-'))],
          );
        machines.forEach((m) => m.bytes(768, 24).fill(0xa5));
        await run(0x70, [3, 2], { create: 'one' });
        await run(0x75, ['one', 0, 0, 2, 1, 0xff123456]);
        await run(0x79, ['one', 50, 100, 200]);
        await run(0x76, ['one'], { create: 'copy' });
        await run(0x77, ['copy', 768, 772]);
        await run(0x75, ['one', -1, -1, 3, 3, 0x80402010]);
        await run(0x72, ['one'], { release: 'one' });
        for (const dimensions of [
          [0, 0],
          [0, 4],
          [4, 0],
        ]) {
          await run(0x70, dimensions, { create: 'empty' });
          await run(0x76, ['empty'], { create: 'emptyCopy' });
          await run(0x72, ['empty'], { release: 'empty' });
          await run(0x72, ['emptyCopy'], { release: 'emptyCopy' });
        }
        for (const m of machines) m.writeString('probe.hg2', 256);
        await run(0x6f, [256], { create: 'loaded' });
        await run(0x75, [0, 1, 2, 3, 4]);
        assert.deepEqual(clears, f.clears);
        for (const machine of machines) machine.writeString('missing.hg2', 256);
        await run(0x6f, [256], { create: 'missing' });
        await run(0x77, [0, 768, 772]);
        await run(0x76, [0], { create: 'null' });
        await run(0x79, [0]);
        await run(0x72, [0]);
        for (const name of [...live]) await run(0x72, [name], { release: name });
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await f.engine.close();
      }
    },
  );

  test(
    fixture.profile +
      ' JS bitmap and image-owner handles survive fresh World restore and automatic release',
    async () => {
      const world = await dataWorld(fixture.profile);
      let fresh;
      const call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
      try {
        const h = (await call(world, 0x70, [3, 2])).value;
        await call(world, 0x75, [h, 0, 0, 3, 2, 0xff123456]);
        const alias = world.graphics.images.alias(h, world.main.id),
          owner = (await call(world, 0x2dd, [4, 3])).value;
        await call(world, 0x2cf, [owner, -2, 3]);
        const state = structuredClone(world.snapshot());
        fresh = await dataWorld(fixture.profile, {}, { initialize: false });
        await fresh.restore(state);
        assert.deepEqual(
          await bitmapState(fresh.graphics.images, h),
          await bitmapState(world.graphics.images, h),
        );
        assert.equal(fresh.graphics.images.get(h).state, fresh.graphics.images.get(alias).state);
        await call(fresh, 0x2cb, [owner, 768, 772]);
        assert.deepEqual(
          [fresh.main.machine.load(768), fresh.main.machine.load(772)],
          [-2 >>> 0, 3],
        );
        await fresh.imageOwners.releaseOwner(fresh.main.id);
        await fresh.graphics.images.releaseOwner(fresh.main.id);
        assert.equal(fresh.runtime.handles.records.has(owner), false);
        assert.equal(fresh.runtime.handles.records.has(h), false);
        assert.equal(world.runtime.handles.records.has(owner), true);
        assert.equal(world.nativeEngine, undefined);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
}

for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' independent image-owner lifetime and metadata sequences',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const f = await imageOwnerFixture(fixture.bytes, fixture.profile),
        world = await dataWorld(fixture.profile),
        machines = [world.main.machine, f.machine],
        values = [new Map(), new Map()],
        live = new Set();
      f.machine.memory.set(world.main.machine.memory);
      async function originalState(handle) {
        const p = f.process,
          owner = f.images.pointer(handle),
          bitmap = p.load(p.load(owner + 12)),
          width = p.load(bitmap + 4),
          height = p.load(bitmap + 8),
          stride = p.load(bitmap + 20),
          bpp = p.load(bitmap + 24),
          data = p.load(bitmap + 12),
          rgba = [];
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const pixel = p.read(data + (height - y - 1) * stride + x * bpp, bpp);
            rgba.push(pixel[2], pixel[1], pixel[0], bpp === 4 ? pixel[3] : 255);
          }
        return {
          fields: [4, 8, 24, 28, 32, 36, 40, 48, 52, 76, 84, 44].map((offset) =>
            signedOffset(offset) ? p.load(bitmap + offset) | 0 : p.load(bitmap + offset),
          ),
          clip: [56, 60, 64, 68].map((offset) => p.load(bitmap + offset) | 0),
          attributes: [],
          rgba,
        };
      }
      function signedOffset(offset) {
        return [36, 40, 48, 52].includes(offset);
      }
      async function run(id, args, { create, release } = {}) {
        const replies = [];
        for (let side = 0; side < 2; side++) {
          const words = args.map((value) =>
              typeof value === 'string' ? values[side].get(value) : value,
            ),
            reply = side
              ? await f.images.apply(id, words, machines[side], { id: world.main.id })
              : await world.runtime.native('main', id, words, machines[side], world.main);
          if (create) values[side].set(create, reply.value);
          replies.push({ ...reply, ...(create ? { value: reply.value ? create : 0 } : {}) });
        }
        assert.deepEqual(replies[0], replies[1], id.toString(16));
        assert.deepEqual(machines[0].memory, machines[1].memory, 'VM output ' + id.toString(16));
        if (create) live.add(create);
        if (release) live.delete(release);
        for (const name of live)
          assert.deepEqual(
            await bitmapState(
              world.graphics.images,
              world.imageOwners.get(values[0].get(name)).bitmap,
            ),
            await originalState(values[1].get(name)),
            'owner bitmap ' + id.toString(16),
          );
      }
      try {
        machines.forEach((m) => m.bytes(768, 24).fill(0xa5));
        await run(0x2dd, [3, 2], { create: 'owner' });
        for (const id of [0x2c8, 0x2ca, 0x2cb, 0x2cd]) await run(id, ['owner', 768, 772]);
        for (const [id, x, y] of [
          [0x2ce, 9, 7],
          [0x2cf, -2, 3],
          [0x2d0, 4, -5],
        ])
          await run(id, ['owner', x, y]);
        for (const id of [0x2c8, 0x2ca, 0x2cb, 0x2cd]) await run(id, ['owner', 768, 772]);
        for (const hint of [0, 1, 2, 3]) {
          await run(0x2d2, ['owner', hint]);
          await run(0x2d1, ['owner']);
        }
        for (const id of [0x2c7, 0x2c8, 0x2ca, 0x2cb, 0x2cd, 0x2ce, 0x2cf, 0x2d0, 0x2d1, 0x2d2])
          await run(id, [0]);
        await run(0x2c7, ['owner'], { release: 'owner' });
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await f.engine.close();
      }
    },
  );

for (const fixture of await engineFixtureSet())
  test(
    fixture.profile +
      ' script bitmap projections preserve JS authority while raw renderer views follow their owner',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const f = await bitmapMemoryFixture(fixture.bytes, fixture.profile),
        { engine, images, process: p } = f;
      engine.features.delete('bitmap-memory');
      const projection = engine.createBitmapProjection(f.world);
      try {
        const handle = images.create(2, 2, 7),
          image = images.get(handle);
        await image.fill(0, 0, 2, 2, 0xff123456);
        const pointer = await projection.pointer(handle),
          wrapper = await projection.wrapper(handle),
          data = p.load(pointer + 12),
          stride = p.load(pointer + 20);
        assert.equal(projection.isOwned(image.dataHandle), true);
        p.write(data + stride, Uint8Array.of(9, 8, 7, 6));
        assert.deepEqual(
          [...(await image.pixels()).slice(0, 4)],
          [0x12, 0x34, 0x56, 255],
          'a consumer copy is not the script authority',
        );
        const raw = images.create(0, 0, 8);
        projection.borrow(raw, pointer);
        assert.equal(projection.isOwned(images.get(raw).dataHandle), false);
        assert.deepEqual(
          [...(await images.get(raw).pixels()).slice(0, 4)],
          [7, 8, 9, 6],
          'raw render targets retain their separate PE owner',
        );
        await images.release(raw);
        await image.fill(0, 0, 1, 1, 0xffabcdef);
        assert.deepEqual([...p.read(data + stride, 4)], [0xef, 0xcd, 0xab, 255]);
        const snapshot = images.handles.snapshot(),
          resource = snapshot.records.find(([id]) => id === image.dataHandle)[1].value;
        assert.ok(resource.rgba);
        assert.equal(resource.nativeBitmapPointer, undefined);
        await images.release(handle);
        assert.equal(p.allocations.has(wrapper), false);
        assert.equal(p.allocations.has(pointer), false);
      } finally {
        await engine.close();
      }
    },
  );
