// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import {
  authoredAreaBitmaps,
  areaPixelParameters,
  recordAreaUploads,
} from './fixtures/area-effect-cases.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { floatBits } from '../src/kcs.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';

test('2.6.1.23 area natives start and finish an owned bitmap wipe', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23');
  t.after(() => world.close());
  const { machine } = world.main,
    call = (id, args) => world.runtime.native('main', id, args, machine, world.main),
    handles = await authoredAreaBitmaps(world),
    taskID = await world.objects.create({ kind: 26, parent: world.root }),
    nativeID = world.nativeTaskID(taskID),
    area = world.areaEffects.tasks.get(taskID),
    params = areaPixelParameters({ kind: 26, duration: 4 }, handles);
  assert.equal(params.length, 14);
  params.forEach((value, index) => machine.store(128 + 4 * index, value));
  assert.deepEqual(await call(200, [nativeID]), { control: 1, value: 0 });
  assert.deepEqual(await call(196, [nativeID, 128]), { control: 2 });
  assert.deepEqual(area.state.params, params);
  assert.ok(area.state.initialized);
  await world.graphics.ensureVRAM(world.game.width, world.game.height);
  assert.deepEqual(await call(197, [nativeID]), { control: 2 });
  assert.deepEqual(await call(200, [nativeID]), { control: 1, value: 1 });
  await world.tick();
  assert.deepEqual(await call(200, [nativeID]), { control: 1, value: 1 });
  assert.deepEqual(await call(203, [nativeID]), { control: 2 });
  assert.deepEqual(await call(200, [nativeID]), { control: 1, value: 0 });
  await assert.rejects(call(200, [0x12345678]), /Area effect query did not write/);
  assert.deepEqual([...machine.bytes(128, 56)], [...new NativeGraphicsPacket(params).bytes(0, 56)]);
});

async function checkPositionedWipe(t, kind, maskedPixels) {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23');
  t.after(() => world.close());
  const { machine } = world.main,
    call = (id, args) => world.runtime.native('main', id, args, machine, world.main),
    images = world.graphics.images,
    task = await world.objects.create({ kind, parent: world.root }),
    nativeID = world.nativeTaskID(task),
    area = world.areaEffects.tasks.get(task),
    handles = [
      [6, 4],
      [4, 3],
      [3, 3],
    ].map(([w, h]) => images.create(w, h, world.main.id)),
    [source, destination, mask] = handles.map((handle) => images.get(handle)),
    [from, to, stencil] = await Promise.all(
      [source, destination, mask].map((image) => image.pixels()),
    ),
    uploads = recordAreaUploads(world),
    clippedUpload = kind !== 26,
    offset = [4, 3],
    fullRegion = [0, 0, 4, 3],
    at = (image, x, y) => ((image.height - y - 1) * image.width + x) * 4;
  for (let i = 0; i < from.length; i += 4) from.set([40, 100, 200, 255], i);
  for (let i = 0; i < to.length; i += 4) to.set([180, 60, 80, 200], i);
  from.set([70, 45, 31, 0], at(source, 2, 1));
  from.set([1, 2, 3, 0], at(source, 0, 0));
  from.set([11, 12, 13, 0], at(source, 5, 0));
  to.set([10, 30, 50, 128], at(destination, 2, 1));
  stencil[at(mask, 1, 0) + 2] = 128;
  stencil[at(mask, 0, 1) + 2] = 64;
  stencil[at(mask, 1, 1) + 2] = 255;
  const params = areaPixelParameters(
    { kind, duration: 4, extent: [19, 22], maskOrigin: [2, 1] },
    handles,
  );
  params.forEach((value, i) => machine.store(128 + i * 4, value));
  assert.deepEqual(await call(196, [nativeID, 128]), { control: 2 });
  assert.deepEqual([area.state.width, area.state.height], [4, 3]);
  assert.deepEqual([area.state.blendWidth, area.state.blendHeight], [2, 2]);
  assert.deepEqual(
    [...from.slice(at(source, 0, 0), at(source, 0, 0) + 4)],
    kind === 29 ? [1, 2, 3, 0] : [180, 60, 80, 0],
  );
  assert.deepEqual([...from.slice(at(source, 5, 0), at(source, 5, 0) + 4)], [11, 12, 13, 0]);
  assert.deepEqual(await call(197, [nativeID]), { control: 2 });
  area.record.effectiveFrame = area.state.start + (area.record.pausedFrames ?? 0) + 2;
  await area.drawTick();
  assert.deepEqual(uploads, [
    {
      width: 4,
      height: 3,
      offset,
      region: clippedUpload ? [2, 1, 4, 3] : fullRegion,
      pixels: Array.from({ length: 12 }, (_, i) => maskedPixels[i] ?? [0, 0, 0, 0]).flat(),
    },
  ]);
  const end = kind === 30 ? 6 : 4,
    finalPixels = Array.from({ length: 12 }, (_, i) =>
      i === 6 ? [10, 30, 50, 128] : [180, 60, 80, 200],
    ).flat();
  area.record.effectiveFrame = area.state.start + (area.record.pausedFrames ?? 0) + end - 1;
  await area.drawTick();
  assert.deepEqual(await call(200, [nativeID]), { control: 1, value: 1 });
  area.record.effectiveFrame++;
  await area.drawTick();
  assert.deepEqual(await call(200, [nativeID]), { control: 1, value: 0 });
  assert.deepEqual(area.state.maskOrigin, [0, 0]);
  assert.deepEqual(uploads[2], {
    width: 4,
    height: 3,
    offset,
    region: fullRegion,
    pixels: finalPixels,
  });
  await call(196, [nativeID, 128]);
  await call(197, [nativeID]);
  assert.deepEqual(await call(203, [nativeID]), { control: 2 });
  assert.deepEqual(await call(200, [nativeID]), { control: 1, value: 0 });
  assert.deepEqual(uploads[3], {
    width: 4,
    height: 3,
    offset: clippedUpload ? [6, 4] : offset,
    region: fullRegion,
    pixels: finalPixels,
  });
}

test('2.6.1.23 places the mask of a blended wipe within the shared extent', (t) =>
  checkPositionedWipe(t, 26, {
    6: [10, 30, 50, 0],
    7: [110, 80, 140, 227],
    10: [75, 90, 170, 241],
    11: [179, 60, 80, 200],
  }));

test('2.6.1.23 threshold wipe publishes only the mask region, preserving source RGB', (t) =>
  checkPositionedWipe(t, 29, {
    6: [70, 45, 31, 0],
    7: [180, 60, 80, 200],
    10: [40, 100, 200, 255],
    11: [180, 60, 80, 200],
  }));

test('2.6.1.23 delayed wipe publishes the mask region through its full blend duration', (t) =>
  checkPositionedWipe(t, 30, {
    6: [10, 30, 50, 0],
    7: [40, 100, 200, 255],
    10: [40, 100, 200, 255],
    11: [180, 60, 80, 200],
  }));

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(
    profile + ' JS area resources, empty receivers and opaque query identity survive fresh restore',
    async () => {
      const world = await dataWorld(profile);
      let fresh;
      try {
        const call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
        const allocated = world.runtime.imageDataBuffers.process.allocations.size;
        for (const kind of [17, 21, 22, 23, 24, 25]) {
          const id = await world.objects.create({
              kind,
              parent: world.root,
              name: 'Empty receiver',
            }),
            native = world.nativeTaskID(id);
          const first = await call(world, 0xc8, [native]),
            second = await call(world, 0xc8, [native]);
          assert.equal(first.control, 1);
          assert.ok(first.value);
          assert.equal(first.value, second.value);
          await call(world, 0xc4, [native, 0xffffffff]);
          assert.equal(
            world.runtime.imageDataBuffers.process.allocations.size,
            allocated + 1,
            'one caller word, no scratch leak',
          );
          await world.objects.release(id);
        }
        const handles = await authoredAreaBitmaps(world),
          id = await world.objects.create({ kind: 27, parent: world.root, name: 'Owned CPU work' }),
          record = world.objects.objects.get(id),
          params = areaPixelParameters({ kind: 27 }, handles);
        await world.graphics.ensureVRAM(world.game.width, world.game.height);
        const baseline = world.runtime.handles.records.size;
        await world.sendEngine(id, world.root, 275, 0, 0, {
          payload: new NativeGraphicsPacket(params),
        });
        const work = record.implementation.state.work;
        assert.ok(work);
        await world.sendEngine(id, world.root, 257);
        await world.tick();
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(world.snapshot()));
        assert.equal((await call(fresh, 0xc8, [fresh.nativeTaskID(id)])).value, 1);
        await world.tick();
        await fresh.tick();
        assert.deepEqual(
          await fresh.graphics.images.get(work).frame(),
          await world.graphics.images.get(work).frame(),
        );
        await world.objects.release(id);
        assert.equal(
          world.runtime.handles.records.size,
          baseline,
          'work bitmap/data are both released',
        );
        for (const handle of handles)
          assert.ok(world.graphics.images.get(handle), 'borrowed images stay live');
        await world.objects.release(world.main.id);
        assert.equal(
          world.runtime.imageDataBuffers.process.allocations.size,
          allocated,
          'opaque query identity freed with caller',
        );
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
  test(
    profile + ' Rain custom graph checkpoint preserves order, RNG and vertex state',
    async () => {
      const world = await dataWorld(profile);
      let fresh;
      try {
        const id = await world.objects.create({ kind: 19, parent: world.root, name: 'Rain' }),
          params = [
            ...[64, 16, 48].map(floatBits),
            300,
            ...[14, 7, 42].map(floatBits),
            4,
            4,
            0xff60c4f4,
          ];
        await world.sendEngine(id, world.root, 266, 0, 0, {
          payload: new NativeGraphicsPacket(params),
        });
        await world.sendEngine(id, world.root, 257);
        await world.tick();
        const rain = world.objects.objects.get(id).implementation,
          state = structuredClone(rain.state),
          random = world.random.snapshot(),
          calls = [];
        assert.equal(rain.rainGraph.queryDraw, undefined);
        assert.equal(rain.rainGraph.graph.callback, undefined);
        assert.equal(rain.rainGraph.graph.registrationEnabled, 'unverified');
        await rain.rainGraph.drawGPU(
          { drawGeometry: (...args) => calls.push(args) },
          { minimum: 0, maximum: 0 },
        );
        assert.equal(calls.length, 1, 'legacy draw has no new D6 range gate');
        assert.equal(calls[0][0].length, 4);
        assert.ok(calls[0][0].every((drop) => drop.vertices.length === 2));
        assert.equal(calls[0][2].context, world.graphics.d3dContext);
        assert.deepEqual(calls[0][2].lineViewport, [0, 0, world.game.width, world.game.height]);
        assert.deepEqual(rain.state, state);
        assert.deepEqual(world.random.snapshot(), random);
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(world.snapshot()));
        assert.equal(fresh.graphics.renderSequence, world.graphics.renderSequence);
        const restoredRain = fresh.objects.objects.get(id).implementation;
        assert.equal(restoredRain.rainGraph.queryDraw, undefined);
        assert.equal(restoredRain.rainGraph.graph.registrationEnabled, 'unverified');
        await fresh.tick();
        await world.tick();
        assert.deepEqual(
          fresh.objects.objects.get(id).implementation.state,
          world.objects.objects.get(id).implementation.state,
        );
        assert.deepEqual(fresh.random.snapshot(), world.random.snapshot());
        if (nativeABI(profile).capabilities.effekseerTask) {
          const effectID = await world.objects.create({ kind: 61, parent: world.root });
          assert.equal(
            world.objects.objects.get(effectID).implementation.plane.graph.registrationEnabled,
            false,
            'the registered kind61 query opt-in retains its proven initial value',
          );
        }
        await fresh.objects.release(id);
        assert.equal(fresh.graphics.get(id), null);
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
}
