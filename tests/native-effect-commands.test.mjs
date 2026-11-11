// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { floatBits } from '../src/kcs.mjs';

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS effect wrappers retain masks, clocks and independent restored state',
    async () => {
      const world = await dataWorld(profile);
      let fresh;
      try {
        Object.assign(world.configuration.screen, {
          width: 64,
          height: 48,
          currentWidth: 64,
          currentHeight: 48,
        });
        world.graphics.view.configure({
          clientWidth: 64,
          clientHeight: 48,
          drawingRectangle: [0, 0, 64, 48],
        });
        const task = world.main,
          machine = task.machine,
          call = (id, args) => world.runtime.native('main', id, args, machine, task),
          starts = new Map([
            [35, 0x20a],
            [36, 0x20c],
            [37, 0x20e],
            [38, 0x210],
            [39, 0x213],
            [50, 0x357],
            [51, 0x359],
            [52, 0x35d],
            [57, 0x3c8],
            [58, 0x3cc],
          ]);
        for (const [kind, start] of starts) {
          const id = await world.objects.create({ kind, parent: world.root, name: 'KCS effect' }),
            native = world.nativeTaskID(id),
            implementation = world.objects.objects.get(id).implementation;
          assert.deepEqual(await call(0x208, [native]), { control: 1, value: 0 });
          assert.deepEqual(await call(start, [native, 17]), { control: 2 });
          assert.deepEqual(await call(0x208, [native]), { control: 1, value: 17 });
          assert.equal(implementation.state.active, 17);
          await call(start, [native, 0]);
          assert.deepEqual(await call(0x208, [native]), { control: 1, value: 0 });
          await world.objects.release(id);
        }
        assert.deepEqual(await call(0x208, [0]), { control: 1, value: 0 });
        const result = (await call(0x208, [0xffffffff])).value;
        assert.ok(result, 'an untouched query retains its nonzero result-storage identity');
        assert.equal(
          world.runtime.imageDataBuffers.process.contains(result, 4),
          false,
          'the wrapper frees its scratch word',
        );
        const id = await world.objects.create({
            kind: 38,
            parent: world.root,
            name: 'Retained draw effect',
          }),
          native = world.nativeTaskID(id),
          implementation = world.objects.objects.get(id).implementation;
        await call(0x20f, [native, 12, floatBits(1.5), floatBits(100)]);
        assert.deepEqual(
          [
            implementation.state.minimum,
            implementation.state.maximum,
            implementation.state.duration,
          ],
          [1.5, 100, 12],
        );
        await call(0x210, [native, 1]);
        const images = world.graphics.images,
          mask = images.create(4, 3, task.id),
          alias = images.alias(mask, task.id),
          data = images.get(mask).dataHandle;
        await images.get(mask).fill(0, 0, 4, 3, 0xff123456);
        const wipeID = await world.objects.create({
            kind: 39,
            parent: world.root,
            name: 'Owned bitmap wipe',
          }),
          wipeNative = world.nativeTaskID(wipeID),
          wipe = world.objects.objects.get(wipeID).implementation;
        await call(0x212, [wipeNative, 12, floatBits(1.5), floatBits(100), mask]);
        assert.equal(images.get(wipe.state.maskSource).dataHandle, data);
        assert.equal(wipe.state.params[4], 0);
        const firstMask = wipe.state.mask;
        assert.deepEqual(
          [...world.stageRenderer.surfacePixels(firstMask).slice(0, 4)],
          [18, 52, 86, 255],
        );
        await images.get(alias).fill(0, 0, 4, 3, 0xffaabbcc);
        await call(0x389, [wipeNative, 20, floatBits(2), floatBits(80), alias]);
        assert.equal(world.stageRenderer.surfaces.records.has(firstMask), false);
        assert.equal(images.get(wipe.state.maskSource).dataHandle, data);
        assert.equal(wipe.state.params[4], 1);
        const ownedMask = wipe.state.mask;
        assert.deepEqual(
          [...world.stageRenderer.surfacePixels(ownedMask).slice(0, 4)],
          [170, 187, 204, 255],
        );
        await images.release(mask);
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(world.snapshot()));
        const invoke = (id, args) =>
            fresh.runtime.native('main', id, args, fresh.main.machine, fresh.main),
          restored = fresh.objects.objects.get(id).implementation,
          freshWipe = fresh.objects.objects.get(wipeID).implementation;
        assert.deepEqual(restored.state, implementation.state);
        assert.deepEqual(await invoke(0x208, [native]), { control: 1, value: 1 });
        assert.deepEqual(freshWipe.state, wipe.state);
        await fresh.graphics.images.get(alias).fill(0, 0, 4, 3, 0xff010203);
        assert.deepEqual(
          [...fresh.stageRenderer.surfacePixels(ownedMask).slice(0, 4)],
          [170, 187, 204, 255],
        );
        await invoke(0x212, [wipeNative, 10, floatBits(0), floatBits(10), alias]);
        assert.equal(freshWipe.state.params[4], 0);
        assert.deepEqual(
          [...fresh.stageRenderer.surfacePixels(freshWipe.state.mask).slice(0, 4)],
          [1, 2, 3, 255],
        );
        assert.deepEqual(
          [...world.stageRenderer.surfacePixels(ownedMask).slice(0, 4)],
          [170, 187, 204, 255],
        );
        await fresh.objects.release(wipeID);
        assert.equal(fresh.stageRenderer.surfaces.records.has(ownedMask), false);
        assert.equal(fresh.runtime.handles.records.has(data), true);
        await fresh.graphics.images.release(alias);
        assert.equal(fresh.runtime.handles.records.has(data), false);
        assert.equal(world.runtime.handles.records.has(data), true);
        await invoke(0x211, [native]);
        assert.equal(restored.state.finishFlag, 1);
        assert.equal(implementation.state.finishFlag, 0);
        await invoke(0x210, [native, 0]);
        assert.deepEqual(await invoke(0x208, [native]), { control: 1, value: 0 });
        await fresh.objects.release(id);
        assert.equal(world.screenEffects.tasks.has(id), true);
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
