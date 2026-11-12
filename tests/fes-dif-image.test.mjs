// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageWorld, setupImages, imageObject, profiles } from './fixtures/fes-dif-image-world.mjs';
import {
  setFESDifImageFile,
  setFESDifImageFilter,
  setFESDifImageAnimation,
  requestFESDifCapture,
} from '../src/native/fes-dif-image.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { ScreenVectorGPU } from './fixtures/screen-effects-fixture.mjs';

for (const profile of profiles)
  test(`${profile} pending DIFIMAGE restore preserves its typed requests without initialization`, async () => {
    const world = await imageWorld(profile);
    let fresh;
    try {
      const { api, id } = await setupImages(world),
        object = imageObject(api, 25, 'pending');
      requestFESDifCapture(object, 7, 42);
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation,
        pending = restored.instance.byKey.get('pending'),
        before = structuredClone(pending),
        count = fresh.objects.objects.size;
      await restored.images.update(restored.instance, pending, { restoring: true });
      assert.deepEqual(pending, before);
      assert.equal(pending.imageResource, undefined);
      assert.equal(fresh.objects.objects.size, count);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

const palette = Uint8Array.from(
  Array.from({ length: 12 }, (_, i) => [
    17 + (i % 4) * 51,
    13 + Math.floor(i / 4) * 59,
    213 - i * 11,
    255,
  ]).flat(),
);
const key = (world, id, slot) => (world.nativeTaskID(id) | (slot << 16)) >>> 0;
async function owner(world, task, rgba = palette, width = 4, height = 3, metadata = {}) {
  const bitmap = world.graphics.images.create(width, height),
    b = world.graphics.images.get(bitmap);
  (await b.pixels()).set(rgba);
  Object.assign(b.state, metadata);
  await b.changed();
  const s = b.state,
    handle = world.imageOwners.add(bitmap, task, [
      width,
      height,
      width,
      height,
      s.offsetX,
      s.offsetY,
      s.baseX,
      s.baseY,
      4,
      1,
      1,
    ]);
  return { handle, bitmap, b };
}
async function rendered(world, draw) {
  await draw.render();
  return (await world.graphics.images.get(draw.state.renderer.bitmap).pixels()).slice();
}
function expectedAt(source, width, height, x, y) {
  const out = new Uint8ClampedArray(32 * 24 * 4);
  for (let row = 0; row < height; row++)
    out.set(
      source.subarray(row * width * 4, (row + 1) * width * 4),
      ((24 - y - height + row) * 32 + x) * 4,
    );
  return out;
}
function anm() {
  const instructions = [
      [0, 2, 2, 2],
      [0, 0, 2, 2],
    ],
    bytes = new Uint8Array(32 + instructions.length * 68),
    v = new DataView(bytes.buffer);
  v.setUint32(0, 0x4d4e41, true);
  v.setUint32(8, instructions.length, true);
  instructions.forEach(([code, ...values], i) => {
    v.setUint32(32 + i * 68, code, true);
    values.forEach((n, j) => v.setUint32(32 + i * 68 + 8 + j * 8, n, true));
  });
  return bytes;
}
for (const profile of profiles) {
  test(`${profile} DIFIMAGE retains every actual owner pixel after external release and fresh World restore without an EXE`, async () => {
    const world = await imageWorld(profile);
    let fresh;
    try {
      const { api, id, draw } = await setupImages(world),
        o = imageObject(api, 25, 'face', {
          renderID: 11,
          pri: 31,
          x: 3,
          y: 4,
          disp: true,
          displayValue: 1,
        }),
        source = await owner(world, world.main.id);
      await api.images.refex(api.instance, o, source.handle);
      assert.equal(api.motionSnapshots, 1);
      assert.equal(o.width, -1);
      assert.equal(o.height, -1, 'refex does not invent IMAGE dimensions');
      const original = source.bitmap,
        retainedSource = o.imageResource.source;
      assert.ok(retainedSource);
      assert.equal(o.imageResource.bitmap, 0);
      await api.images.update(api.instance, o);
      assert.deepEqual(await rendered(world, draw), expectedAt(palette, 4, 3, 3, 4));
      assert.equal(
        world.retainedDraw.record(draw, key(world, id, 11)).kind,
        2,
        'semantic JS source replaces the original raw owner pointer',
      );
      await world.imageOwners.release(source.handle);
      assert.equal(world.runtime.handles.records.has(source.handle), false);
      assert.equal(world.runtime.handles.records.has(original), false);
      assert.deepEqual(await rendered(world, draw), expectedAt(palette, 4, 3, 3, 4));
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation,
        face = restored.instance.byKey.get('face'),
        restoredDraw = fresh.graphics.drawTasks.get(restored.surface);
      await restored.images.update(restored.instance, face, { restoring: true });
      assert.equal(face.imageResource.source, retainedSource);
      assert.equal(restored.cache.entries.size, 0);
      assert.deepEqual(await rendered(fresh, restoredDraw), expectedAt(palette, 4, 3, 3, 4));
      const data = new Set(
        [...fresh.runtime.handles.records]
          .filter(([, r]) => r.type === 'render-source')
          .map(([id]) => id),
      );
      await restored.images.close(face);
      assert.equal(face.imageResource.closed, true);
      assert.equal(restoredDraw.entry(key(fresh, id, 11)), undefined);
      for (const h of data)
        assert.equal(
          fresh.runtime.handles.records.has(h),
          false,
          'final DIF owner releases all actual retained source references',
        );
      assert.ok(!world.nativeEngine && !fresh.nativeEngine);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} DIFIMAGE snapshots real MOT fields but renders local XY independently of PARENT and query origins`, async () => {
    const world = await imageWorld(profile);
    try {
      const { api, id, draw } = await setupImages(world),
        parent = imageObject(api, 2, 'parent', { x: 19, y: 17, disp: true, displayValue: 1 }),
        o = imageObject(api, 25, 'face', {
          renderID: 4,
          pri: 24,
          x: 7,
          y: 8,
          disp: true,
          displayValue: 1,
          parentHandle: parent.handle,
        }),
        input = await owner(world, world.main.id, palette, 4, 3, {
          offsetX: 1,
          offsetY: 2,
          baseX: 3,
          baseY: 4,
        });
      await api.images.refex(api.instance, o, input.handle);
      assert.deepEqual([o.imageOriginX, o.imageOriginY, o.baseX, o.baseY], [1, 2, 3, 4]);
      const state = new DataView(o.motionTarget.manager.base.buffer);
      assert.equal(state.getFloat32(MOTION_ABI.pos, true), 7);
      assert.equal(state.getFloat32(MOTION_ABI.base, true), 3);
      await api.images.update(api.instance, o);
      assert.deepEqual(draw.entry(key(world, id, 4)).position, [7, 8]);
      assert.deepEqual(await rendered(world, draw), expectedAt(palette, 4, 3, 5, 6));
      await api.images.refex(api.instance, o, 0);
      await api.images.update(api.instance, o);
      assert.equal(
        api.motionSnapshots,
        1,
        'null refex leaves the previous starting snapshot alone',
      );
      assert.deepEqual([o.imageOriginX, o.imageOriginY, o.baseX, o.baseY], [1, 2, 3, 4]);
      assert.equal(draw.entry(key(world, id, 4)), undefined);
    } finally {
      await world.close();
    }
  });
  test(`${profile} DIFIMAGE shares live bitmap data, applies the actual filter once and keeps FILE as the recovered stored-only request`, async () => {
    const world = await imageWorld(profile);
    try {
      const { api, draw } = await setupImages(world),
        o = imageObject(api, 25, 'face', {
          renderID: 5,
          pri: 25,
          x: 2,
          y: 3,
          disp: true,
          displayValue: 1,
        }),
        input = await owner(world, world.main.id);
      await api.images.refex(api.instance, o, input.handle);
      await api.images.update(api.instance, o);
      const next = new Uint8Array(palette);
      for (let at = 0; at < next.length; at += 4) next.set([213, 5, 15, 255], at);
      (await input.b.pixels()).set(next);
      await input.b.changed();
      assert.deepEqual(
        await rendered(world, draw),
        expectedAt(next, 4, 3, 2, 3),
        'a live owner mutation remains shared',
      );
      setFESDifImageFilter(o, 3);
      await api.images.update(api.instance, o);
      const inverted = next.map((v, i) => (i % 4 === 3 ? v : 255 - v));
      assert.deepEqual(await rendered(world, draw), expectedAt(inverted, 4, 3, 2, 3));
      assert.deepEqual(await input.b.pixels(), new Uint8ClampedArray(inverted));
      await api.images.update(api.instance, o);
      assert.deepEqual(
        await rendered(world, draw),
        expectedAt(inverted, 4, 3, 2, 3),
        'filter is a consumed request, not per-frame inversion',
      );
      setFESDifImageFile(o, 'unread-resource');
      await api.images.update(api.instance, o);
      assert.equal(o.file, 'unread-resource');
      assert.equal(o.difImage.filePending, true);
      assert.equal(api.cache.entries.size, 0);
      assert.deepEqual(await rendered(world, draw), expectedAt(inverted, 4, 3, 2, 3));
    } finally {
      await world.close();
    }
  });
  test(`${profile} DIFIMAGE owner layers retain all ANM frames and real controller clocks across external release and restore`, async () => {
    const world = await imageWorld(profile);
    let fresh;
    try {
      const { api, id, draw } = await setupImages(world),
        o = imageObject(api, 25, 'face', {
          renderID: 7,
          pri: 27,
          x: 1,
          y: 2,
          disp: true,
          displayValue: 1,
        }),
        red = await owner(world, world.main.id, Uint8Array.of(200, 10, 20, 255), 1, 1),
        green = await owner(world, world.main.id, Uint8Array.of(6, 170, 19, 255), 1, 1),
        record = {
          owner: world.main.id,
          bitmap: 0,
          info: Array(11).fill(0),
          layers: [
            {
              bitmap: 0,
              program: anm(),
              animation: {
                frames: [
                  { key: 0, bitmap: red.bitmap },
                  { key: 2, bitmap: green.bitmap },
                ],
                selected: 0,
                bounds: {
                  width: 1,
                  height: 1,
                  canvasWidth: 1,
                  canvasHeight: 1,
                  offsetX: 0,
                  offsetY: 0,
                  baseX: 0,
                  baseY: 0,
                },
              },
            },
          ],
        };
      // The layer record takes the two actual bitmap wrappers; discard only
      // the temporary owner handles without releasing their transferred refs.
      world.runtime.handles.release(red.handle, 'image-owner');
      world.runtime.handles.release(green.handle, 'image-owner');
      await world.imageOwners.rebuild(record);
      const handle = world.runtime.handles.add('image-owner', record);
      await api.images.refex(api.instance, o, handle);
      setFESDifImageAnimation(o, 1);
      await api.images.update(api.instance, o);
      for (let frame = 1; frame <= 2; frame++) await world.objects.drawTick(frame);
      assert.deepEqual(
        await rendered(world, draw),
        expectedAt(Uint8Array.of(6, 170, 19, 255), 1, 1, 1, 2),
      );
      const rootSource = o.imageResource.source,
        childSource = world.renderSources.get(rootSource).children[0],
        clock = world.renderSources.get(childSource).animation.snapshot();
      await api.images.refex(api.instance, o, handle);
      await api.images.update(api.instance, o);
      assert.equal(
        o.imageResource.source,
        rootSource,
        'repeating the same owner does not reset Draw source identity',
      );
      assert.equal(world.renderSources.get(rootSource).children[0], childSource);
      assert.deepEqual(world.renderSources.get(childSource).animation.snapshot(), clock);
      assert.deepEqual(
        await rendered(world, draw),
        expectedAt(Uint8Array.of(6, 170, 19, 255), 1, 1, 1, 2),
      );
      await world.imageOwners.release(handle);
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation,
        rd = fresh.graphics.drawTasks.get(restored.surface);
      for (let frame = 3; frame <= 5; frame++) {
        await world.objects.drawTick(frame);
        await fresh.objects.drawTick(frame);
        assert.deepEqual(await rendered(fresh, rd), await rendered(world, draw));
      }
      assert.deepEqual(
        await rendered(fresh, rd),
        expectedAt(Uint8Array.of(200, 10, 20, 255), 1, 1, 1, 2),
      );
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} DIFIMAGE filter visits every declared layer even when bitmap data repeats`, async () => {
    const world = await imageWorld(profile);
    try {
      const { api, draw } = await setupImages(world),
        o = imageObject(api, 25, 'repeat', {
          renderID: 10,
          pri: 30,
          x: 1,
          y: 2,
          disp: true,
          displayValue: 1,
        }),
        input = await owner(world, world.main.id, Uint8Array.of(13, 51, 97, 255), 1, 1),
        record = {
          owner: world.main.id,
          bitmap: 0,
          info: Array(11).fill(0),
          layers: [
            { bitmap: input.bitmap, program: null },
            { bitmap: input.bitmap, program: null },
          ],
        };
      world.runtime.handles.release(input.handle, 'image-owner');
      await world.imageOwners.rebuild(record);
      const handle = world.runtime.handles.add('image-owner', record);
      await api.images.refex(api.instance, o, handle);
      setFESDifImageFilter(o, 3);
      await api.images.update(api.instance, o);
      assert.deepEqual(
        await input.b.pixels(),
        new Uint8ClampedArray([13, 51, 97, 255]),
        'two declaration visits invert twice',
      );
      assert.deepEqual(
        await rendered(world, draw),
        expectedAt(Uint8Array.of(13, 51, 97, 255), 1, 1, 1, 2),
      );
      record.layers.push({ bitmap: input.bitmap, program: null });
      await world.imageOwners.rebuild(record);
      setFESDifImageFilter(o, 3);
      await api.images.update(api.instance, o);
      assert.equal(
        world.renderSources.get(o.imageResource.source).children.length,
        3,
        'filter refreshes a live owner rebuild before visiting its current layers',
      );
      assert.deepEqual(
        await input.b.pixels(),
        new Uint8ClampedArray([242, 204, 158, 255]),
        'three current declaration visits invert three times',
      );
      assert.deepEqual(
        await rendered(world, draw),
        expectedAt(Uint8Array.of(242, 204, 158, 255), 1, 1, 1, 2),
      );
    } finally {
      await world.close();
    }
  });
}

test('DIFIMAGE consumes refcap before a real screen capability failure and preserves its previous owner', async () => {
  const world = await imageWorld(profiles[0]);
  try {
    const { api, draw } = await setupImages(world),
      o = imageObject(api, 25, 'preserve', {
        renderID: 9,
        pri: 29,
        x: 1,
        y: 2,
        disp: true,
        displayValue: 1,
      }),
      input = await owner(world, world.main.id);
    await api.images.refex(api.instance, o, input.handle);
    await api.images.update(api.instance, o);
    const source = o.imageResource.source;
    world.configuration.fields.general.renderTargetCount = 0;
    requestFESDifCapture(o, -1, -2147483648);
    assert.deepEqual(o.difImage.captureRequest, { minimum: 0xffffffff, maximum: 0x80000000 });
    await api.images.update(api.instance, o);
    assert.equal(o.difImage.captureRequest, null);
    assert.equal(o.imageResource.source, source);
    assert.equal(api.motionSnapshots, 1);
    assert.equal(world.screenEffects.rendering.prepared, false);
    assert.deepEqual(await rendered(world, draw), expectedAt(palette, 4, 3, 1, 2));
  } finally {
    await world.close();
  }
});

test('DIFIMAGE refcap uses the real shared screen renderer, exact priority range, viewport pixels and release boundary', async () => {
  const world = await imageWorld(profiles[0]);
  try {
    const { api } = await setupImages(world),
      o = imageObject(api, 25, 'capture', { renderID: 8, pri: 28, disp: true, displayValue: 1 }),
      gpu = new ScreenVectorGPU(4, 3),
      renderer = world.screenEffects.rendering,
      drawn = [];
    world.stageRenderer.gpu = gpu;
    Object.assign(world.graphics.view, {
      clientWidth: 4,
      clientHeight: 3,
      drawingRectangle: [1, 1, 4, 3],
    });
    const physical = Uint8Array.from(
      Array.from({ length: 12 }, (_, i) => [
        10 + Math.floor(i / 4) * 20 + (i % 4),
        1 + i,
        200 - i,
        255,
      ]).flat(),
    );
    renderer.frame = {
      items: [{ priority: 2 }, { priority: 9 }],
      draw: async (item, device) => {
        drawn.push(item.priority);
        device.target.bytes.set(physical);
      },
    };
    requestFESDifCapture(o, 0, 5);
    await api.images.update(api.instance, o);
    renderer.frame = null;
    assert.deepEqual(drawn, [2]);
    assert.equal(o.difImage.captureRequest, null);
    assert.equal(renderer.prepared, false);
    assert.deepEqual(renderer.captures, []);
    const source = world.renderSources.get(o.imageResource.source),
      b = world.graphics.images.get(source.bitmap);
    assert.deepEqual([b.width, b.height], [3, 2]);
    assert.deepEqual(
      await b.pixels(),
      new Uint8ClampedArray([
        31, 6, 195, 255, 32, 7, 194, 255, 33, 8, 193, 255, 11, 2, 199, 255, 12, 3, 198, 255, 13, 4,
        197, 255,
      ]),
    );
    assert.equal(
      api.motionSnapshots,
      undefined,
      'capture does not imitate refex handler MOT snapshot',
    );
  } finally {
    world.screenEffects.rendering.frame = null;
    await world.close();
  }
});
