// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { hg3 } from './helpers.mjs';
import { readFile } from 'node:fs/promises';
import { setFESImageFile } from '../src/native/fes-image-driver.mjs';
import {
  profiles,
  imageWorld,
  setupImages,
  imageObject,
  syncImages,
} from './fixtures/fes-image-driver-world.mjs';
import { setFESImageID } from '../src/native/fes-image-model.mjs';
import { markFESObjectDirty, setFESGraphicalPriority } from '../src/native/fes-common-model.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { FESObjectCollection } from '../src/native/fes-object-collection.mjs';

const pixels = Uint8Array.from([
  11, 22, 33, 255, 44, 55, 66, 0, 77, 88, 99, 255, 110, 121, 132, 128,
]);
for (const profile of profiles) {
  test(`${profile} image-font bytes follow the held frame-map data and survive FILE changes and World restore`, async () => {
    const encoded = frames(),
      world = await imageWorld(profile, { 'first.hg3': encoded, 'second.hg3': asset() });
    let fresh;
    try {
      const { api, id } = await setupImages(world),
        image = imageObject(api, 2, 'font', { renderID: 4, fileSingle: true }),
        buffers = world.runtime.imageDataBuffers;
      setFESImageFile(image, 'first');
      await syncImages(api);
      assert.equal(
        api.images.dataFor(api.instance, image),
        null,
        'ordinary bitmap load does not assign the encoded getter',
      );
      setFESImageID(image, -1);
      await syncImages(api);
      const pointer = image.imageEncodedPointer;
      assert.deepEqual(api.images.dataFor(api.instance, image), encoded);
      assert.equal(buffers.words(pointer)[3], 2, 'cache and IMAGE each retain the actual buffer');
      setFESImageFile(image, 'second');
      assert.deepEqual(
        api.images.dataFor(api.instance, image),
        encoded,
        'FILE alone does not replace held bytes',
      );
      setFESImageID(image, 0);
      await syncImages(api);
      assert.deepEqual(
        api.images.dataFor(api.instance, image),
        encoded,
        'ordinary reload preserves the encoded getter',
      );
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      fresh.game.readCategory = () => {
        throw new Error('held image-font getter attempted I/O');
      };
      const restored = fresh.objects.objects.get(id).implementation,
        restoredImage = restored.instance.byKey.get('font');
      await syncImages(restored, { restoring: true });
      assert.equal(restoredImage.imageEncodedPointer, pointer);
      assert.deepEqual(restored.images.dataFor(restored.instance, restoredImage), encoded);
      assert.equal(fresh.runtime.imageDataBuffers.words(pointer)[3], 2);
      await restored.images.close(restoredImage);
      assert.equal(fresh.runtime.imageDataBuffers.words(pointer)[3], 1);
      restored.cache.close();
      assert.equal(fresh.runtime.imageDataBuffers.owns(pointer), false);
      setFESImageID(image, -1);
      setFESImageFile(image, 'missing');
      await syncImages(api);
      assert.equal(
        api.images.dataFor(api.instance, image),
        null,
        'frame-map miss clears the encoded getter',
      );
      assert.equal(buffers.words(pointer)[3], 1);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} pending BUTTON restore does not allocate or initialize resources`, async () => {
    const world = await imageWorld(profile);
    let fresh;
    try {
      const { api, id } = await setupImages(world);
      imageObject(api, 6, 'pending');
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation,
        object = restored.instance.byKey.get('pending'),
        before = structuredClone(object),
        count = fresh.objects.objects.size;
      await syncImages(restored, { restoring: true });
      assert.deepEqual(object, before);
      assert.equal(fresh.objects.objects.size, count);
      assert.equal(object.imageResource, undefined);
      assert.equal(object.nativeInputTaskID, null);
      await syncImages(restored);
      assert.ok(object.imageResource);
      assert.ok(fresh.objects.objects.has(object.nativeInputTaskID));
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} image references preserve the collection's bare-group index`, async () => {
    const world = await imageWorld(profile);
    try {
      const { api } = await setupImages(world),
        collection = new FESObjectCollection({ create: (identity) => ({ ...identity }) }),
        [first, second] = collection.create('IMAGE', 'group', 2);
      api.images.lookup = (_, reference) =>
        collection.lookup(reference.nameBytes ?? reference.name, reference.index);
      assert.equal(api.images.find(api.instance, { name: 'group', index: -1 }), null);
      assert.equal(api.images.find(api.instance, { name: 'group', index: 0 }), first);
      assert.equal(
        api.images.find(api.instance, { nameBytes: encodeCP932('group'), index: 1 }),
        second,
      );
    } finally {
      await world.close();
    }
  });
}
function asset({ offsetX = 0, offsetY = 0, baseX = 0, baseY = 0 } = {}) {
  const bytes = hg3(2, 2, pixels),
    v = new DataView(bytes.buffer);
  for (const [at, n] of [
    [12, offsetX],
    [16, offsetY],
    [20, 8],
    [24, 9],
    [32, baseX],
    [36, baseY],
  ])
    v.setInt32(36 + at, n, true);
  return bytes;
}
function frames() {
  const one = hg3(2, 2, pixels),
    two = hg3(
      2,
      2,
      new Uint8Array(pixels).map((v, i) => (i % 4 === 3 ? v : v + 20)),
    ),
    bytes = new Uint8Array(one.length + two.length - 12);
  bytes.set(one);
  bytes.set(two.subarray(12), one.length);
  new DataView(bytes.buffer).setUint32(12, one.length - 12, true);
  new DataView(bytes.buffer).setUint32(one.length + 4, 2, true);
  return bytes;
}
function animation() {
  const commands = [
      [12, 128],
      [0, 2, 3, 3],
      [12, 255],
      [0, 0, 3, 3],
    ],
    bytes = new Uint8Array(32 + commands.length * 68),
    v = new DataView(bytes.buffer);
  v.setUint32(0, 0x4d4e41, true);
  v.setUint32(8, commands.length, true);
  commands.forEach(([op, ...args], i) => {
    v.setUint32(32 + i * 68, op, true);
    args.forEach((a, j) => v.setUint32(32 + i * 68 + 8 + j * 8, a, true));
  });
  return bytes;
}
const windowFixture = JSON.parse(
  await readFile(new URL('./fixtures/fes-window-image.json', import.meta.url), 'utf8'),
);
function windowBytes(missing) {
  const items = windowFixture.inputs.filter((f) => !missing.includes(f.id)),
    parts = items.map((f) => hg3(f.width, f.height, Uint8Array.from(f.rgba))),
    bytes = new Uint8Array(12 + parts.reduce((n, p) => n + p.length - 12, 0));
  bytes.set(parts[0].subarray(0, 12));
  let at = 12;
  parts.forEach((part, i) => {
    const body = part.slice(12),
      v = new DataView(body.buffer);
    v.setUint32(0, i + 1 < parts.length ? body.length : 0, true);
    v.setUint32(4, items[i].id, true);
    bytes.set(body, at);
    at += body.length;
  });
  return bytes;
}
const key = (world, id, slot) => (world.nativeTaskID(id) | (slot << 16)) >>> 0;
for (const profile of profiles) {
  test(`${profile} pure image initialization is lazy; static and CIMAGE resources use actual retained key/layer and independent ownership`, async () => {
    const world = await imageWorld(profile, { 'picture.hg3': asset() });
    try {
      const { id, api, draw } = await setupImages(world),
        color = imageObject(api, 1, 'color', {
          width: 2,
          height: 2,
          color: 0xff803020,
          sizeDirty: true,
          dirty: true,
          renderID: 10,
          pri: 30,
          disp: true,
          x: 1,
          y: 2,
        }),
        image = imageObject(api, 2, 'image', { renderID: 20, pri: 40, disp: true, x: 4, y: 5 });
      setFESImageFile(image, 'picture');
      await api.images.initialize(api.instance, color);
      await api.images.initialize(api.instance, image);
      assert.equal(api.cache.entries.size, 0);
      assert.equal(draw.state.renderer.items.length, 0);
      await syncImages(api);
      assert.notEqual(id, world.nativeTaskID(id));
      assert.deepEqual(
        [...(await world.graphics.images.get(color.nativeImageHandle).pixels())].slice(0, 4),
        [128, 48, 32, 255],
      );
      assert.deepEqual(
        await world.graphics.images.get(image.nativeImageHandle).pixels(),
        new Uint8ClampedArray(pixels),
      );
      assert.deepEqual(draw.entry(key(world, id, 20)).position, [4, 5]);
      image.x = -1.75;
      image.y = 2.25;
      markFESObjectDirty(api.instance, image);
      await syncImages(api);
      assert.deepEqual(draw.entry(key(world, id, 20)).position, [-1.75, 2.25]);
      const originalHandle = image.nativeImageHandle,
        source = world.retainedDraw.record(draw, key(world, id, 20)).source;
      await syncImages(api);
      assert.equal(image.nativeImageHandle, originalHandle);
      assert.equal(world.retainedDraw.record(draw, key(world, id, 20)).source, source);
      setFESGraphicalPriority(api.instance, image, 80);
      await syncImages(api);
      assert.equal(draw.entry(key(world, id, 20)).layer, 100);
      assert.equal(image.renderID, 20);
      assert.equal(draw.entry(key(world, id, 80)), undefined);
      image.renderID = 21;
      await syncImages(api);
      assert.equal(draw.entry(key(world, id, 20)), undefined);
      assert.ok(draw.entry(key(world, id, 21)));
      setFESImageID(image, 9);
      await syncImages(api);
      assert.equal(
        image.nativeImageHandle,
        originalHandle,
        'a failed decoder load preserves its existing wrapper pixels',
      );
      assert.ok(!world.nativeEngine);
    } finally {
      await world.close();
    }
  });
  test(`${profile} BTYPE normalizes origins precisely and POS2 consumes once; parent changes dirty real child placement`, async () => {
    const world = await imageWorld(profile, {
      'picture.hg3': asset({ offsetX: 3, offsetY: 4, baseX: 7, baseY: 11 }),
    });
    try {
      const { api, draw, id } = await setupImages(world),
        parent = imageObject(api, 2, 'parent', { renderID: 2, disp: true }),
        child = imageObject(api, 2, 'child', {
          renderID: 3,
          disp: true,
          parentHandle: parent.handle,
          x: 1,
          y: 2,
        }),
        mode1 = imageObject(api, 2, 'mode1', {
          renderID: 4,
          disp: true,
          baseHandlingMode: 1,
          positionReference: { name: 'picture', index: 0 },
          positionPending: true,
        });
      for (const o of [parent, child, mode1]) setFESImageFile(o, 'picture');
      await syncImages(api);
      assert.deepEqual(
        [
          parent.baseX,
          parent.baseY,
          parent.imageOriginX,
          parent.imageOriginY,
          parent.width,
          parent.height,
        ],
        [4, 7, 7, 11, 2, 2],
      );
      assert.deepEqual(
        [
          world.graphics.images.get(parent.nativeImageHandle).state.offsetX,
          world.graphics.images.get(parent.nativeImageHandle).state.canvasWidth,
        ],
        [0, 2],
      );
      assert.deepEqual(
        [mode1.baseX, mode1.baseY, mode1.imageOriginX, mode1.imageOriginY, mode1.x, mode1.y],
        [7, 11, 0, 0, 3, 4],
      );
      const childPosition = draw.entry(key(world, id, 3)).position.slice();
      parent.x = 10;
      markFESObjectDirty(api.instance, parent);
      mode1.x = 20;
      markFESObjectDirty(api.instance, mode1);
      await syncImages(api);
      assert.equal(mode1.x, 20, 'POS2 is a consumed position request');
      assert.equal(draw.entry(key(world, id, 3)).position[0], childPosition[0] + 10);
    } finally {
      await world.close();
    }
  });
  test(`${profile} BUTTON uses real region/alpha and routes Input focus and clicks through its actual World child`, async () => {
    const world = await imageWorld(profile, { 'picture.hg3': asset() });
    try {
      const { api, id } = await setupImages(world),
        button = imageObject(api, 6, 'button', {
          renderID: 30,
          pri: 50,
          disp: true,
          x: 4,
          y: 5,
          buttonType: 1,
        });
      setFESImageFile(button, 'picture');
      await api.images.initialize(api.instance, button);
      const child = button.nativeInputTaskID;
      assert.equal(world.inputFor(id).get(child), null);
      await syncImages(api);
      const input = world.inputFor(id),
        region = input.get(child);
      assert.deepEqual(region.bounds, [4, 5, 6, 7]);
      assert.equal(region.priority, 150);
      assert.ok(region.alpha);
      input.pointer(4, 5, 1);
      await world.tick();
      assert.ok(api.events.some(([k, e]) => k === 'button' && e === 'FOCUS'));
      input.key(0, true, 2, 1);
      await world.tick();
      assert.equal(input.captures[0], child);
      assert.ok(api.events.some(([k, e]) => k === 'button' && e === 'PUSH_L'));
      input.key(0, false, 2, 1);
      await world.tick();
      assert.ok(api.events.some(([k, e]) => k === 'button' && e === 'RELEASE_L'));
      const authored = [button.disp, button.enable],
        retained = world.retainedDraw.record(
          world.graphics.drawTasks.get(api.surface),
          key(world, id, 30),
        ).source;
      api.input.state.sleeping = true;
      await syncImages(api);
      assert.equal(region.enabled, false);
      assert.deepEqual([button.disp, button.enable], authored);
      api.input.state.sleeping = false;
      await syncImages(api);
      assert.equal(region.enabled, true);
      assert.equal(
        world.retainedDraw.record(world.graphics.drawTasks.get(api.surface), key(world, id, 30))
          .source,
        retained,
      );
      button.fullInput = true;
      button.fullInputChanged = true;
      markFESObjectDirty(api.instance, button);
      const bound = region.bounds.slice(),
        send = world.sendEngine.bind(world),
        packets = [];
      world.sendEngine = (target, sender, message, w, l, context) => {
        if (message === 100)
          packets.push({
            target,
            w,
            rect: context?.payload
              ? Array.from({ length: 4 }, (_, i) => context.payload.load(i * 4) | 0)
              : null,
          });
        return send(target, sender, message, w, l, context);
      };
      await syncImages(api);
      assert.deepEqual(region.bounds, bound);
      assert.ok(
        packets.some(
          (p) =>
            p.target === world.engineMessages.closestTop(id).implementation.input &&
            p.w === world.nativeTaskID(child) &&
            JSON.stringify(p.rect) === '[-10000,-10000,10000,10000]',
        ),
      );
      assert.equal(region.priority, 100000);
      world.sendEngine = send;
      const handle = button.nativeImageHandle;
      button.deleted = true;
      await syncImages(api);
      await world.tick();
      assert.ok(!world.objects.objects.has(child));
      assert.ok(!input.get(child));
      assert.ok(!world.runtime.handles.records.has(handle));
      assert.deepEqual(api.input.state.buttons, []);
    } finally {
      await world.close();
    }
  });
  test(`${profile} actual frame-map ANM, cache, bitmap aliases and Button child survive a fresh World with no resource reads`, async () => {
    const world = await imageWorld(profile, { 'picture.hg3': frames(), 'anim.anm': animation() });
    let fresh;
    try {
      const { api, id, surface, draw } = await setupImages(world),
        animated = imageObject(api, 2, 'animated', {
          renderID: 10,
          disp: true,
          idIndex: 0xffffffff,
          x: 2,
          y: 3,
          anmFile: 'anim',
          anmEnabled: true,
          anmPending: true,
        }),
        button = imageObject(api, 6, 'button', { renderID: 30, disp: true, x: 8, y: 3 });
      setFESImageFile(animated, 'picture');
      setFESImageFile(button, 'picture');
      await syncImages(api);
      await world.objects.drawTick(1);
      assert.equal(draw.entry(key(world, id, 10)).alpha, 128);
      assert.equal(
        (await world.graphics.images.get(draw.entry(key(world, id, 10)).image).pixels())[0],
        31,
      );
      const before = structuredClone(world.snapshot()),
        resource = structuredClone(animated.imageResource),
        child = button.nativeInputTaskID;
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(before);
      const restored = fresh.objects.objects.get(id).implementation;
      fresh.game.readCategory = () => {
        throw new Error('restored image reloaded a resource');
      };
      await syncImages(restored, { restoring: true });
      await syncImages(restored);
      assert.deepEqual(restored.instance.byKey.get('animated').imageResource, resource);
      assert.equal(restored.instance.byKey.get('button').nativeInputTaskID, child);
      assert.equal(
        fresh.retainedDraw.record(fresh.graphics.drawTasks.get(surface), key(fresh, id, 10)).source,
        world.retainedDraw.record(draw, key(world, id, 10)).source,
      );
      await world.objects.drawTick(4);
      await fresh.objects.drawTick(4);
      assert.deepEqual(
        fresh.graphics.drawTasks.get(surface).entry(key(fresh, id, 10)),
        draw.entry(key(world, id, 10)),
      );
      assert.ok(!fresh.nativeEngine && !world.nativeEngine);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} deferred full reference and physical rectangle copy own independent pixels and preserve unresolved-reference rendering`, async () => {
    const world = await imageWorld(profile, { 'picture.hg3': asset() });
    try {
      const { api, id, draw } = await setupImages(world),
        source = imageObject(api, 2, 'source', { renderID: 1, disp: true }),
        reference = imageObject(api, 2, 'reference', {
          renderID: 2,
          disp: true,
          referenceRequest: { name: 'source', index: 0 },
        }),
        copied = imageObject(api, 2, 'copied', {
          renderID: 3,
          disp: true,
          copyRequest: { name: 'source', index: 0, rectangle: Int32Array.of(0, 0, 2, 1) },
        });
      setFESImageFile(source, 'picture');
      await syncImages(api);
      const a = world.graphics.images.get(source.nativeImageHandle),
        b = world.graphics.images.get(reference.nativeImageHandle),
        c = world.graphics.images.get(copied.nativeImageHandle);
      assert.notEqual(a.dataHandle, b.dataHandle);
      assert.deepEqual(await b.pixels(), new Uint8ClampedArray(pixels));
      assert.deepEqual([...(await c.pixels())], [77, 88, 99, 255, 110, 121, 132, 128]);
      const old = reference.nativeImageHandle;
      reference.referenceRequest = { name: 'missing', index: 0 };
      reference.imageChanged = true;
      await syncImages(api);
      assert.equal(reference.nativeImageHandle, old);
      assert.ok(draw.entry(key(world, id, 2)));
      await a.fill(0, 0, 1, 1, 0xffffffff);
      assert.equal((await b.pixels())[0], 11);
    } finally {
      await world.close();
    }
  });
  test(`${profile} TABLE selects actual images, preserves misses, saves parsed state and supports a raw empty-success name`, async () => {
    const table = new Uint8Array(132),
      view = new DataView(table.buffer);
    view.setUint32(0, 1, true);
    table.set(encodeCP932('picture'), 4);
    const world = await imageWorld(profile, {
      'picture.hg3': asset(),
      'names.tbl': table,
      'sections.tbl': encodeCP932('#_TOP_\npicture\n'),
    });
    let fresh;
    try {
      const { api, id } = await setupImages(world),
        o = imageObject(api, 16, 'bg', { renderID: 4, disp: true }),
        s = imageObject(api, 20, 'section', { renderID: 5, disp: true });
      assert.equal(await api.images.loadTable(api.instance, o, 'names.tbl'), true);
      assert.equal(api.images.tableMax(o, []), 1);
      assert.equal(api.images.selectTable(o, [0, 0]), true);
      await syncImages(api);
      const handle = o.nativeImageHandle;
      assert.equal(api.images.selectTable(o, [-1, 0]), false);
      await syncImages(api);
      assert.equal(o.nativeImageHandle, handle);
      assert.equal(await api.images.loadTable(api.instance, o, 'missing.tbl'), false);
      assert.equal(api.images.tableMax(o, []), 1);
      await api.images.loadTable(api.instance, s, 'sections.tbl');
      assert.equal(api.images.selectTable(s, [9]), true);
      assert.equal(s.file, '');
      const snapshot = structuredClone(world.snapshot());
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(snapshot);
      const restored = fresh.objects.objects.get(id).implementation;
      assert.equal(restored.images.tableMax(restored.instance.byKey.get('bg'), []), 1);
      assert.equal(restored.images.selectTable(restored.instance.byKey.get('bg'), [0, 0]), true);
      await syncImages(restored);
      assert.deepEqual(
        await fresh.graphics.images
          .get(restored.instance.byKey.get('bg').nativeImageHandle)
          .pixels(),
        new Uint8ClampedArray(pixels),
      );
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}

for (const profile of profiles) {
  test(`${profile} IMGWND default driver uses exact frozen nine-piece CPU pixels and restores owned bitmap without tile loads`, async () => {
    const expected = windowFixture.outputs[1],
      world = await imageWorld(profile, { 'window.hg3': windowBytes(expected.missing) });
    let fresh;
    try {
      const { api, id, surface, draw } = await setupImages(world),
        window = imageObject(api, 22, 'window', {
          renderID: 7,
          disp: true,
          width: expected.width,
          height: expected.height,
          x: 2,
          y: 3,
        });
      setFESImageFile(window, 'window');
      await api.images.initialize(api.instance, window);
      assert.equal(window.nativeImageHandle, undefined);
      assert.equal(api.cache.entries.size, 0);
      await syncImages(api);
      const bitmap = world.graphics.images.get(window.nativeImageHandle),
        pixels = await bitmap.pixels();
      assert.equal(Buffer.from(pixels).toString('hex'), expected.rgbaHex);
      await draw.render();
      const output = await world.graphics.images.get(draw.state.renderer.bitmap).pixels();
      for (let row = 0; row < expected.height; row++)
        assert.deepEqual(
          output.subarray(
            ((24 - 3 - expected.height + row) * 32 + 2) * 4,
            ((24 - 3 - expected.height + row) * 32 + 2 + expected.width) * 4,
          ),
          pixels.subarray(row * expected.width * 4, (row + 1) * expected.width * 4),
        );
      const handle = window.nativeImageHandle,
        source = world.retainedDraw.record(draw, key(world, id, 7)).source;
      fresh = await imageWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation;
      fresh.game.readCategory = () => {
        throw new Error('IMGWND restored tiles');
      };
      await syncImages(restored, { restoring: true });
      await syncImages(restored);
      assert.equal(restored.instance.byKey.get('window').nativeImageHandle, handle);
      assert.equal(
        fresh.retainedDraw.record(fresh.graphics.drawTasks.get(surface), key(fresh, id, 7)).source,
        source,
      );
      assert.equal(
        Buffer.from(await fresh.graphics.images.get(handle).pixels()).toString('hex'),
        expected.rgbaHex,
      );
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} per-FES inserted bytes are authoritative and frame publication keeps fractional/negative plane origins`, async () => {
    const world = await imageWorld(profile);
    try {
      const { api, id, draw } = await setupImages(world),
        buffers = world.runtime.imageDataBuffers,
        pointer = buffers.createPointer(asset()),
        image = imageObject(api, 2, 'image', {
          renderID: 2,
          disp: true,
          x: 1.25,
          y: 2.75,
          planeReference: { name: 'plane', index: 0 },
        }),
        plane = {
          baseZ: 0,
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
          motionMatrix: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
          nativeType: 4,
          key: 'plane',
          handle: 0x3000,
          x: 10.5,
          y: 20.5,
          z: 0,
          baseX: 1.25,
          baseY: 2.25,
          width: 6,
          height: 6,
          vramX: 3.75,
          vramY: -2.25,
          parentHandle: null,
          parent: null,
        };
      api.instance.byKey.set('plane', plane);
      api.cache.insert('inserted', pointer);
      buffers.releasePointer(pointer);
      setFESImageFile(image, 'inserted');
      await syncImages(api);
      const entry = draw.entry(key(world, id, 2));
      assert.deepEqual(entry.position, [4.25, 0.75]);
      assert.deepEqual(entry.clip, [3, -2, 9, 4]);
      assert.deepEqual(
        await world.graphics.images.get(image.nativeImageHandle).pixels(),
        new Uint8ClampedArray(pixels),
      );
      assert.equal(api.cache.entries.size, 1);
    } finally {
      await world.close();
    }
  });
}
