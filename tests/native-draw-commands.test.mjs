// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { floatBits } from '../src/kcs.mjs';
import { imageOwnerFiles } from './fixtures/image-owner-fixture.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

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
      assert.ok(
        p.load(record.pointer + 72),
        'the original filename helper resolves and loads the ANM',
      );
      await call(0x271, [nativeID, 0, 0]);
      assert.equal(p.load(record.pointer + 80), 0);
      await call(0x271, [nativeID, 0, 1]);
      assert.equal(p.load(record.pointer + 80), 1);
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
        fp = (await fresh.getNativeFeature('draw-commands')).process;
      assert.equal(rr.pointer, record.pointer);
      assert.equal(fp.allocations.has(pointer), false);
      assert.equal(fp.load(rr.pointer + 80), 1);
      await invoke(0x271, [nativeID, 0, 0]);
      assert.equal(fp.load(rr.pointer + 80), 0);
      assert.equal(p.load(record.pointer + 80), 1, 'fresh controls have independent native RAM');
      await invoke(0x271, [0xffffffff, 0, 1]);
      assert.equal(
        fp.load(rr.pointer + 80),
        0,
        'an absent target leaves other drawing tasks alone',
      );
      await invoke(0x102, [nativeID, 0]);
      assert.equal(restored.state.renderer.items.length, 0);
      assert.equal(
        fp.allocations.has(rr.pointer),
        false,
        'removal releases the native retained object',
      );
      assert.equal(p.allocations.has(record.pointer), true);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
