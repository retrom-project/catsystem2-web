// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bitmapFactoryFixture } from './fixtures/bitmap-factory-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { imageOwnerFiles } from './fixtures/image-owner-fixture.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} complete bitmap producers retain original wrappers, row coordinates and automatic lists`,
    { skip: !process.env[variable] },
    async () => {
      const f = await bitmapFactoryFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        m = f.machine,
        p = f.process,
        call = (id, args) => f.factories.apply(id, args, m, { id: 1 });
      try {
        const h = (await call(0x70, [3, 2])).value,
          wrapper = await f.memory.wrapper(h),
          source = await f.memory.pointer(h),
          context = f.factories.refs.contexts.get(1),
          head = p.load(context.list);
        assert.equal(p.allocations.get(wrapper), profile.startsWith('sdk-') ? 276 : 536);
        assert.equal(p.load(context.list + 4), 1);
        assert.equal(p.load(p.load(head) + 8), wrapper);
        await call(0x75, [h, 0, 0, 1, 1, 0xff123456]);
        assert.deepEqual(
          [...(await f.images.get(h).pixels()).slice(12, 16)],
          [0x12, 0x34, 0x56, 255],
          'native row zero is the logical bottom row',
        );
        assert.deepEqual([...(await f.images.get(h).pixels()).slice(0, 4)], [0, 0, 0, 0]);
        await call(0x79, [h, 50, 100, 200]);
        const clone = (await call(0x76, [h])).value;
        assert.notEqual(await f.memory.pointer(clone), source);
        assert.deepEqual(await f.images.get(clone).pixels(), await f.images.get(h).pixels());
        m.bytes(0, 12).fill(0xa5);
        await call(0x77, [clone, 0, 4]);
        assert.deepEqual([m.load(0), m.load(4), m.load(8)], [3, 2, 0xa5a5a5a5]);
        await call(0x72, [h]);
        assert.equal(p.allocations.has(source), false);
        assert.equal(p.allocations.has(wrapper), false);
        assert.equal(p.load(context.list + 4), 1);
        m.writeString('probe.hg2', 256);
        const loaded = (await call(0x6f, [256])).value;
        assert.ok(loaded);
        assert.deepEqual([f.images.get(loaded).width, f.images.get(loaded).height], [4, 3]);
        for (const [width, height] of [
          [0, 0],
          [0, 4],
          [4, 0],
        ]) {
          const empty = (await call(0x70, [width, height])).value,
            copied = (await call(0x76, [empty])).value;
          assert.ok(copied);
          assert.equal((await f.images.get(copied).pixels()).length, 0);
          await call(0x72, [empty]);
          await call(0x72, [copied]);
        }
        await call(0x75, [0, 1, 2, 3, 4]);
        assert.deepEqual(f.clears, [[1, 2, 3, 4]], 'screen clear does not consume a color');
        await f.images.releaseOwner(1);
        assert.equal(f.factories.refs.contexts.has(1), false);
        assert.equal(p.allocations.has(context.list), false);
        assert.equal(p.allocations.has(head), false);
        assert.equal(f.handles.records.size, 0);
      } finally {
        await f.engine.close();
      }
    },
  );

test(
  'SDK World bitmap factory lists, cloned pixels and image loads survive fresh restore and Script reload',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      files = await imageOwnerFiles(),
      make = () => {
        const game = memoryGame(
            Object.fromEntries([
              ...files,
              ['engine.exe', bytes],
              ['main.kcs', kcsProgram([[37, 1024], [43, 0x47, 4], [59]])],
            ]),
          ),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        game.resolveCategory = (name, category) =>
          game.has(name) ? name : `@cat/${category}/${name}`;
        game.readCategory = (name, category) => game.read(game.resolveCategory(name, category));
        Object.assign(configuration.screen, {
          width: 64,
          height: 48,
          currentWidth: 64,
          currentHeight: 48,
          virtualWidth: 64,
          virtualHeight: 48,
        });
        return new NativeWorld({
          game,
          profile,
          configuration,
          random,
          images: {},
          host: {},
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
        h = (await call(0x70, [4, 3])).value;
      await call(0x75, [h, 0, 0, 4, 3, 0xff123456]);
      const copy = (await call(0x76, [h])).value;
      m.writeString('probe.hg2', 256);
      const loaded = (await call(0x6f, [256])).value;
      assert.ok(loaded);
      const memory = await world.getNativeFeature('bitmap-memory'),
        wrapper = await memory.wrapper(h),
        data = world.graphics.images.get(h).dataHandle;
      assert.ok(world.runtime.handles.get(data, 'bitmap-data').rgba);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const fm = fresh.main.machine,
        restored = await fresh.getNativeFeature('bitmap-memory');
      assert.equal(await restored.wrapper(h), wrapper);
      assert.deepEqual(
        await fresh.graphics.images.get(h).pixels(),
        await world.graphics.images.get(h).pixels(),
      );
      assert.equal(fresh.runtime.handles.get(data, 'bitmap-data').nativeBitmapPointer, undefined);
      await fresh.runtime.native('main', 0x72, [h], fm, fresh.main);
      assert.equal(fresh.nativeEngine.process.allocations.has(wrapper), false);
      assert.deepEqual(
        [...(await fresh.graphics.images.get(copy).pixels()).slice(0, 4)],
        [0x12, 0x34, 0x56, 255],
      );
      await fresh.objects.objects
        .get(fresh.main.id)
        .implementation.loadScript('missing.kcs', { nativeLoad: true });
      assert.equal(
        [...fresh.runtime.handles.records.values()].some(
          (record) => record.type === 'bitmap' && record.value.owner === task.id,
        ),
        false,
      );
      assert.equal(world.nativeEngine.process.allocations.has(wrapper), true);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
