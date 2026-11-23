// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { floatBits } from '../src/kcs.mjs';
import { imageOwnerFiles } from './fixtures/image-owner-fixture.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

test('2.6.1.23 Draw owns the returned bitmap and copies an independent base image', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23');
  t.after(() => world.close({ flushFiles: false }));
  const { main } = world,
    call = (id, args) => world.runtime.native('main', id, args, main.machine, main),
    id = await world.objects.create({ kind: 15, parent: world.root }),
    nativeID = world.nativeTaskID(id),
    draw = world.graphics.drawTasks.get(id),
    images = world.graphics.images;
  await world.sendEngine(id, main.id, 279, 8, 6);
  await world.sendEngine(id, main.id, 283, 0, 0);
  assert.deepEqual(await call(261, [nativeID]), { control: 1, value: draw.state.renderer.bitmap });
  const handle = images.create(2, 2),
    source = images.get(handle);
  await source.fill(0, 0, 2, 2, 0xff123456);
  const one = floatBits(1);
  assert.deepEqual(await call(257, [nativeID, 6, handle, one, one, 0, 0, 0, one, one, 300, 1, 0]), {
    control: 2,
  });
  const item = draw.entry((world.nativeTaskID(main.id) | (6 << 16)) >>> 0);
  assert.deepEqual(item.position, [1, 1]);
  assert.equal(images.get(item.image).dataHandle, source.dataHandle);
  assert.equal(item.alpha, 255);
  assert.deepEqual(await call(258, [nativeID, 6]), { control: 2 });
  assert.ok(!draw.state.renderer.items.includes(item));
  assert.deepEqual(await call(455, [nativeID, handle]), { control: 2 });
  const copied = images.get(draw.state.baseImage);
  await source.fill(0, 0, 2, 2, 0xffabcdef);
  assert.equal(draw.state.baseVisible, true);
  assert.deepEqual((await copied.pixels()).slice(0, 4), Uint8ClampedArray.of(18, 52, 86, 255));
  await call(257, [nativeID, 6, handle, one, one, 0, 0, 0, one, one, 255, 1, 0]);
  const key = (world.nativeTaskID(main.id) | (6 << 16)) >>> 0;
  assert.deepEqual(await call(339, [nativeID, 6, 1, 2, 3, 4]), { control: 2 });
  assert.deepEqual(draw.entry(key).clip, [1, 2, 4, 6]);
  assert.deepEqual(await call(534, [nativeID, 0]), { control: 2 });
  assert.equal(draw.state.dirty, false);
  assert.deepEqual(await call(340, [nativeID]), { control: 2 });
  assert.deepEqual(await call(341, [nativeID]), { control: 2 });
  assert.deepEqual(
    draw.state.renderer.items.map(({ key }) => key),
    [0],
  );
  assert.equal(images.get(draw.entry(0).image).dataHandle, copied.dataHandle);
  assert.deepEqual(await call(342, [nativeID]), { control: 2 });
  const bitmap = images.get(draw.state.renderer.bitmap),
    firstLogicalRow = (bitmap.height - 1) * bitmap.width * 4;
  assert.deepEqual(
    (await bitmap.pixels()).slice(firstLogicalRow, firstLogicalRow + 4),
    Uint8ClampedArray.of(18, 52, 86, 255),
  );
  assert.deepEqual(await call(258, [nativeID, 0]), { control: 2 });
  assert.deepEqual(await call(455, [nativeID, 0]), { control: 2 });
  assert.deepEqual(await call(341, [nativeID]), { control: 2 });
  assert.equal(draw.state.baseVisible, false);
  assert.equal(draw.entry(0), undefined);
});

test(
  'SDK full World retains decoded image pixels and original ANM control across fresh restoration',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      resources = Object.fromEntries(await imageOwnerFiles()),
      profile = 'sdk-4.01-engine-2.6.1.74',
      make = () => {
        const game = memoryGame({
            ...resources,
            'engine.exe': exe,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        Object.assign(configuration.screen, {
          width: 640,
          height: 480,
          currentWidth: 640,
          currentHeight: 480,
          virtualWidth: 640,
          virtualHeight: 480,
        });
        game.resolveCategory = (name, category) =>
          game.has(name) ? name : `@cat/${category}/${name}`;
        game.readCategory = (name, category) => game.read(game.resolveCategory(name, category));
        return new NativeWorld({
          game,
          images: {},
          host: {},
          profile,
          random,
          configuration,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, task),
        id = await world.objects.create({ kind: 15, parent: world.root }),
        nativeID = world.nativeTaskID(id),
        draw = world.graphics.drawTasks.get(id);
      await call(0x100, [nativeID, 8, 6]);
      await call(0x104, [nativeID, 0, 0]);
      m.writeString('probe.hg2', 256);
      const handle = (await call(0x16d, [256])).value,
        buffers = await world.getNativeFeature('data-buffers'),
        pointer = buffers.pointer(handle),
        p = buffers.process,
        args = [nativeID, 0, handle, 0, 0, 0, 0, 0, floatBits(1), floatBits(1), 255, 1, 0];
      assert.deepEqual(await call(0x26e, args), { control: 2 });
      assert.equal(
        p.load(pointer + 12),
        1,
        'a single-frame source is decoded without retaining its raw descriptor',
      );
      assert.equal(draw.state.renderer.items.length, 1);
      const image = world.graphics.images.get(draw.state.renderer.items[0].image);
      assert.deepEqual(
        await image.pixels(),
        Uint8ClampedArray.from({ length: 48 }, (_, i) => (i * 37 + 19) & 255),
      );
      args[3] = floatBits(1);
      args[4] = floatBits(2);
      await call(0x26f, args);
      assert.equal(p.load(pointer + 12), 1, 'rebinding the same data does not duplicate ownership');
      assert.deepEqual(draw.state.renderer.items[0].position, [1, 2]);
      const retained = await world.getNativeFeature('retained-draw'),
        key = world.nativeTaskID(task.id),
        record = retained.record(draw, key);
      m.writeString('@cat/image/anim.hg3', 256);
      await call(0x270, [nativeID, 0, 256]);
      const source = world.renderSources.get(record.source),
        animation = source.animation;
      assert.ok(animation, 'the shared filename lookup resolves and loads the JS ANM');
      assert.deepEqual(await call(0x370, [nativeID, 0, 0, 0x81234567]), { control: 2 });
      await call(0x370, [nativeID, 0, 63, 0xfedcba98]);
      const variables = () => [...animation.registers];
      const expected = variables();
      assert.equal(expected[0], 0x81234567);
      assert.equal(expected[63], 0xfedcba98);
      for (const badIndex of [64, 0xffffffff])
        await call(0x370, [nativeID, 0, badIndex, 0xcccccccc]);
      assert.deepEqual(variables(), expected);
      await call(0x370, [nativeID, 1, 0, 0]);
      assert.deepEqual(
        variables(),
        expected,
        'an absent drawing key cannot overwrite another entry',
      );
      await call(0x271, [nativeID, 0, 0]);
      assert.equal(source.enabled, 0);
      await call(0x271, [nativeID, 0, 1]);
      assert.equal(source.enabled, 1);
      await call(0x16e, [handle]);
      assert.equal(
        p.allocations.has(pointer),
        false,
        'the raw descriptor is released after decoding',
      );
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const ft = fresh.main,
        fm = ft.machine,
        invoke = (id, args) => fresh.runtime.native('main', id, args, fm, ft),
        restored = fresh.graphics.drawTasks.get(id),
        rr = (await fresh.getNativeFeature('retained-draw')).record(restored, key),
        fp = fresh.nativeEngine.process,
        restoredSource = fresh.renderSources.get(rr.source);
      assert.equal(rr.source, record.source);
      assert.equal(fp.allocations.has(pointer), false);
      assert.equal(restoredSource.enabled, 1);
      assert.deepEqual(restoredSource.animation.snapshot(), animation.snapshot());
      assert.deepEqual([...restoredSource.animation.registers], expected);
      await invoke(0x370, [nativeID, 0, 63, 1000]);
      assert.equal(restoredSource.animation.registers[63], 1000);
      assert.equal(animation.registers[63], expected[63]);
      await invoke(0x271, [nativeID, 0, 0]);
      assert.equal(restoredSource.enabled, 0);
      assert.equal(source.enabled, 1, 'fresh controls have independent native RAM');
      await invoke(0x271, [0xffffffff, 0, 1]);
      assert.equal(restoredSource.enabled, 0, 'an absent target leaves other drawing tasks alone');
      await invoke(0x102, [nativeID, 0]);
      assert.equal(restored.state.renderer.items.length, 0);
      assert.equal(
        fresh.runtime.handles.records.has(rr.source),
        false,
        'removal releases the JS retained source',
      );
      assert.equal(world.runtime.handles.records.has(record.source), true);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
