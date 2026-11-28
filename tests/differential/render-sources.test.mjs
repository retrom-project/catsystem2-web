// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { renderSourceFiles } from '../fixtures/render-sources-fixture.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { floatBits } from '../../src/kcs.mjs';
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS source arrays retain frame, aliases, VM bytes and fresh-World ownership',
    async () => {
      const { files } = await renderSourceFiles(),
        data = Object.fromEntries([...files].map(([n, b]) => [n.replace('@cat/image/', ''), b])),
        make = () => dataWorld(profile, data),
        world = await make(),
        m = world.main.machine,
        stride = nativeABI(profile).graphics.renderSources.stride,
        call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
      let fresh;
      try {
        m.writeString('sequence.hg3', 256);
        m.bytes(1024, stride * 2).fill(0xa5);
        assert.deepEqual(await call(world, 0x2bf, [256, 1024, 1]), { control: 1, value: 1 });
        assert.equal(m.load(1024), 2);
        assert.ok(m.bytes(1032, stride - 8).every((v) => v === 0xa5));
        const source = m.load(1028),
          frame = (await call(world, 0x2c5, [source, 1])).value;
        assert.ok(frame);
        assert.equal(
          (await call(world, 0x2c5, [source, -1])).value,
          world.renderSources.get(source).frames[0].bitmap,
        );
        m.bytes(0, 40).fill(0xa5);
        assert.deepEqual(await call(world, 0x2c2, [source, 0]), { control: 1, value: 1 });
        assert.equal(m.load(36), 0xa5a5a5a5);
        const task = await world.objects.create({ kind: 15, parent: world.main.id }),
          target = world.nativeTaskID(task);
        await call(world, 0x100, [target, 16, 12]);
        await call(world, 0x104, [target, 0, 0]);
        await call(world, 0x2c3, [
          target,
          0,
          source,
          ...[0, 0, 0, 0, 0, 1, 1].map(floatBits),
          255,
          1,
          0,
        ]);
        assert.equal(world.renderSources.get(source).refs, 2);
        await call(world, 0x2c0, [1024, 1]);
        assert.equal(world.renderSources.get(source).refs, 1);
        assert.equal(m.load(1028), 0);
        assert.equal((await call(world, 0x2c5, [source, 1])).value, frame);
        await call(world, 0x370, [target, 0, 63, 42]);
        const second = await world.objects.create({ kind: 15, parent: world.main.id }),
          secondTarget = world.nativeTaskID(second);
        await call(world, 0x100, [secondTarget, 16, 12]);
        await call(world, 0x104, [secondTarget, 0, 0]);
        await call(world, 0x2c3, [
          secondTarget,
          0,
          source,
          ...[0, 0, 0, 0, 0, 1, 1].map(floatBits),
          255,
          1,
          0,
        ]);
        const firstDraw = world.graphics.drawTasks.get(task),
          secondDraw = world.graphics.drawTasks.get(second),
          firstImage = firstDraw.entry(world.nativeTaskID(world.main.id)).image,
          secondImage = secondDraw.entry(world.nativeTaskID(world.main.id)).image;
        await call(world, 0x107, [target, 0, 0]);
        await secondDraw.drawTick(1);
        assert.equal(secondDraw.entry(world.nativeTaskID(world.main.id)).visible, false);
        await call(world, 0x107, [target, 0, 1]);
        await secondDraw.drawTick(2);
        assert.equal(secondDraw.entry(world.nativeTaskID(world.main.id)).visible, true);
        assert.equal(firstDraw.entry(world.nativeTaskID(world.main.id)).image, firstImage);
        assert.equal(secondDraw.entry(world.nativeTaskID(world.main.id)).image, secondImage);
        await secondDraw.releaseRenderer();
        fresh = await dataWorld(profile, data, { initialize: false });
        await fresh.restore(structuredClone(world.snapshot()));
        assert.equal(fresh.renderSources.get(source).animation.registers[63], 42);
        await call(fresh, 0x370, [target, 0, 63, 17]);
        assert.equal(world.renderSources.get(source).animation.registers[63], 42);
        await call(fresh, 0x102, [target, 0]);
        assert.throws(() => fresh.renderSources.get(source), /released/);
        assert.throws(() => fresh.graphics.images.get(frame), /released/);
        assert.ok(world.graphics.images.get(frame));
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
