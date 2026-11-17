// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { installNativeGraphics } from '../src/native/graphics.mjs';
import { nativeDraw } from '../src/native/draw-task.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { flipBitmapRows } from '../src/native/raster-kernel.mjs';
import { floatBits } from '../src/kcs.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import {
  defaultFESWorld,
  loadDefaultFES,
  drawPixels as fesPixels,
} from './fixtures/default-fes-world.mjs';

async function drawPixels(world, id) {
  const bitmap = world.graphics.surface(id).bitmap;
  return flipBitmapRows(await bitmap.pixels(), bitmap.width, bitmap.height);
}

function fixture() {
  const world = {
    game: { width: 8, height: 6 },
    configuration: new NativeConfiguration({ profile: 'nekopara-vol3-engine-2.6.1.76' }),
    runtime: { handles: new NativeHandles(), register() {} },
    objects: new NativeObjects(),
    sendEngine(target, sender, message, w = 0, l = 0, context = {}) {
      return this.objects.objects
        .get(target)
        ?.implementation.message([sender, message, w, l], context);
    },
    sendNativeEngine(...args) {
      return this.sendEngine(...args);
    },
    base: (record) => ({
      message: ([, id]) => {
        if (id === 3) return 0;
        throw new Error(`Task ${record.id} engine message ${id}`);
      },
    }),
  };
  installNativeGraphics(world);
  return world;
}
async function surface(world, width = 8, height = 6) {
  const id = await world.objects.create({ kind: 15 }),
    task = { id: 99 };
  await nativeDraw(0x100, [id, width, height], null, task, world);
  await nativeDraw(0x104, [id, 0, 0], null, task, world);
  return id;
}
const draw = (
  world,
  id,
  layer,
  image,
  {
    position = [0, 0],
    base = [0, 0],
    rotation = 0,
    scale = [1, 1],
    alpha = 255,
    visible = 1,
    mode = 0,
  } = {},
) =>
  nativeDraw(
    0x101,
    [
      id,
      layer,
      image,
      ...position.map(floatBits),
      ...base.map(floatBits),
      floatBits(rotation),
      ...scale.map(floatBits),
      alpha,
      visible,
      mode,
    ],
    null,
    { id: 99 },
    world,
  );

test('drawing task initialization owns its bitmap and creates the original hidden base plane', async () => {
  const world = fixture(),
    id = await world.objects.create({ kind: 15 });
  assert.equal(world.graphics.drawTasks.get(id).state.renderer, null);
  await nativeDraw(0x100, [id, 12, 16], null, { id: 99 }, world);
  const resource = world.graphics.surface(id),
    task = world.graphics.drawTasks.get(id),
    plane = world.graphics.get(task.state.basePlane);
  assert.deepEqual([resource.width, resource.height, resource.offset], [12, 16, null]);
  assert.equal(plane.state.shown, false);
  assert.equal(plane.graph.vram, true);
  await nativeDraw(0x104, [id, 3, -4], null, { id: 99 }, world);
  assert.deepEqual(world.graphics.surface(id).offset, [3, -4]);
  assert.equal((await nativeDraw(0x105, [id], null, { id: 99 }, world)).value, resource.handle);
});

test('native draw entries share source pixels after release and rasterize offset/anchor and integer alpha', async () => {
  const world = fixture(),
    id = await surface(world),
    image = world.graphics.images.create(2, 2, 99),
    source = world.graphics.images.get(image);
  await source.fill(0, 0, 2, 2, 0xff123456);
  source.state.offsetX = 1;
  source.state.offsetY = 1;
  await draw(world, id, 7, image, { position: [3, 4], base: [1, 2], alpha: 128 });
  world.graphics.images.release(image);
  const task = world.graphics.drawTasks.get(id),
    entry = task.state.renderer.items[0];
  assert.equal(entry.key, (99 | (7 << 16)) >>> 0);
  assert.equal(entry.layer, 7);
  await task.render();
  const pixels = await drawPixels(world, id),
    at = (3 * 8 + 3) * 4;
  assert.deepEqual([...pixels.subarray(at, at + 4)], [18, 52, 86, 128]);
  assert.deepEqual([...pixels.subarray(0, 4)], [0, 0, 0, 0]);
  assert.notEqual(world.graphics.vramHandle, 0);
});

test('draw priority, visibility, clipping and removal modify the actual retained surface', async () => {
  const world = fixture(),
    id = await surface(world),
    red = world.graphics.images.create(2, 2),
    blue = world.graphics.images.create(2, 2);
  await world.graphics.images.get(red).fill(0, 0, 2, 2, 0xffff0000);
  await world.graphics.images.get(blue).fill(0, 0, 2, 2, 0xff0000ff);
  await draw(world, id, 5, red);
  await draw(world, id, 9, blue);
  const task = world.graphics.drawTasks.get(id),
    pixel = async () => [...(await drawPixels(world, id)).subarray(0, 4)];
  await task.render();
  assert.deepEqual(await pixel(), [0, 0, 255, 255]);
  await nativeDraw(0x1cf, [id, 9, 1], null, { id: 99 }, world);
  await task.render();
  assert.deepEqual(await pixel(), [255, 0, 0, 255]);
  await nativeDraw(0x107, [id, 5, 0], null, { id: 99 }, world);
  await task.render();
  assert.deepEqual(await pixel(), [0, 0, 255, 255]);
  await nativeDraw(0x102, [id, 9], null, { id: 99 }, world);
  await task.render();
  assert.deepEqual(await pixel(), [0, 0, 0, 0]);
});

test('disabled output still updates the offscreen native bitmap', async () => {
  const world = fixture(),
    id = await surface(world),
    image = world.graphics.images.create(1, 1);
  await world.graphics.images.get(image).fill(0, 0, 1, 1, 0xffabcdef);
  await nativeDraw(0x106, [id, 0], null, { id: 99 }, world);
  await draw(world, id, 1, image);
  const task = world.graphics.drawTasks.get(id);
  await task.render();
  assert.deepEqual([...(await drawPixels(world, id)).subarray(0, 4)], [171, 205, 239, 255]);
  assert.equal(world.graphics.vramHandle, 0);
});

test('rotated draw entries use the original fixed-point samples, alpha and destination clip', async () => {
  const world = fixture(),
    id = await surface(world),
    image = world.graphics.images.create(2, 3),
    input = world.graphics.images.get(image);
  const colors = [0xffff0000, 0x8000ff00, 0xff0000ff, 0x00ffffff, 0xc0804020, 0xff123456];
  for (let i = 0; i < colors.length; i++)
    await input.fill(i % 2, 2 - Math.floor(i / 2), 1, 1, colors[i]);
  await draw(world, id, 2, image, {
    position: [4.25, 2.5],
    base: [0.5, 0.25],
    rotation: Math.PI / 4,
    scale: [1.5, 0.75],
    alpha: 171,
    mode: 1,
  });
  await nativeDraw(0x153, [id, 2, 1, 0, 6, 6], null, { id: 99 }, world);
  await world.graphics.drawTasks.get(id).render();
  const pixels = await drawPixels(world, id);
  const argb = Array.from(
    { length: 48 },
    (_, i) =>
      ((pixels[i * 4 + 3] << 24) |
        (pixels[i * 4] << 16) |
        (pixels[i * 4 + 1] << 8) |
        pixels[i * 4 + 2]) >>>
      0,
  );
  // Authored input, captured from frozen game76 874A40/874BD0.
  const expected = new Array(48).fill(0);
  expected[2 * 8 + 6] = 0x403ffe3f;
  expected[3 * 8 + 6] = 0x785951c2;
  assert.deepEqual(argb, expected);
});

test('FES retained surfaces create real visible VRAM planes and retain separate plane opacity', async () => {
  const source =
      '#DEFINE\nPLANE panel\nCIMAGE red\n#OBJECT SIZE PRI DISP VRAM BLEND\npanel 8,6 5000 1 0,0 128\n#OBJECT SIZE COLOR DISP PL PRI\nred 2,2 4294901760 1 panel 10\n#START\nnext WAIT\n#WAIT\n',
    world = await defaultFESWorld('nekopara-vol3-engine-2.6.1.76', {
      'screen.fes': new TextEncoder().encode(source),
    });
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const panel = h.instance.byKey.get('panel'),
      red = h.instance.byKey.get('red'),
      plane = world.graphics.get(panel.nativeTaskID);
    assert.equal(plane.record.kind, 2);
    assert.equal(plane.record.parent, h.id);
    assert.equal(plane.state.shown, true);
    assert.equal(plane.graph.vram, true);
    assert.equal(new DataView(plane.graph.kx2.buffer).getUint32(0x70, true) >>> 24, 128);
    assert.deepEqual([...(await fesPixels(world, h.surface)).subarray(0, 4)], [255, 0, 0, 255]);
    assert.equal(
      h.draw.state.renderer.items[0].key,
      (world.nativeTaskID(h.id) | (red.renderID << 16)) >>> 0,
    );
    await world.objects.release(h.id);
    assert.equal(h.draw.state.renderer.items.length, 0);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});

test('base-image capture is a deep bitmap copy, survives entry reset and controls the real base plane', async () => {
  const world = fixture(),
    id = await surface(world),
    task = world.graphics.drawTasks.get(id),
    image = world.graphics.images.create(2, 2),
    source = world.graphics.images.get(image);
  await source.fill(0, 0, 2, 2, 0xff123456);
  await nativeDraw(0x1c7, [id, image], null, { id: 99 }, world);
  const captured = task.state.baseImage;
  assert.equal(world.graphics.get(task.state.basePlane).state.shown, true);
  await source.fill(0, 0, 2, 2, 0xffabcdef);
  world.graphics.images.release(image);
  await nativeDraw(0x155, [id], null, { id: 99 }, world);
  assert.deepEqual(
    task.state.renderer.items.map((item) => item.key),
    [0],
  );
  await task.render();
  assert.deepEqual([...(await drawPixels(world, id)).subarray(0, 4)], [18, 52, 86, 255]);
  const handles = world.runtime.handles.snapshot(),
    state = task.snapshot();
  await nativeDraw(0x1c7, [id, 0], null, { id: 99 }, world);
  assert.equal(task.state.baseVisible, false);
  assert.equal(world.graphics.get(task.state.basePlane).state.shown, false);
  assert.equal(task.entry(0), undefined);
  // The native renderer keeps its private base bitmap after hiding it.
  assert.equal(task.state.baseImage, captured);
  world.runtime.handles.restore(handles);
  task.restore(state);
  assert.equal(task.state.baseVisible, true);
  assert.deepEqual(
    [...(await world.graphics.images.get(task.state.baseImage).pixels()).subarray(0, 4)],
    [18, 52, 86, 255],
  );
  await task.close();
  assert.equal(world.runtime.handles.records.has(captured), false);
});

test('base-image crop copies raw pixels and resets source canvas, anchor and clip metadata', async () => {
  const world = fixture(),
    id = await surface(world),
    task = world.graphics.drawTasks.get(id),
    image = world.graphics.images.create(4, 3),
    source = world.graphics.images.get(image);
  await source.fill(0, 0, 4, 3, 0xffff0000);
  await source.fill(1, 1, 2, 2, 0xffabcdef);
  Object.assign(source.state, {
    offsetX: 15,
    offsetY: 17,
    baseX: 19,
    baseY: 21,
    canvasWidth: 40,
    canvasHeight: 50,
    clip: [0, 0, 1, 1],
  });
  await task.setBaseImage(image, [1, 1, 3, 3]);
  const captured = world.graphics.images.get(task.state.baseImage);
  assert.deepEqual(
    [
      captured.width,
      captured.height,
      captured.state.canvasWidth,
      captured.state.canvasHeight,
      captured.state.offsetX,
      captured.state.offsetY,
      captured.state.baseX,
      captured.state.baseY,
      captured.state.clip,
    ],
    [2, 2, 2, 2, 0, 0, 0, 0, [0, 0, 2, 2]],
  );
  assert.deepEqual([...(await captured.pixels())], Array(4).fill([171, 205, 239, 255]).flat());
  await nativeDraw(0x106, [id, 0], null, { id: 99 }, world);
  await nativeDraw(0x156, [id], null, { id: 99 }, world);
  assert.notEqual(world.graphics.vramHandle, 0);
});

test('FES baseimg copies the original physical VRAM rows independently of the plane screen transform', async () => {
  const source =
      '#DEFINE\nPLANE panel\nCIMAGE color\n#OBJECT SIZE PRI DISP VRAM POS BLEND\npanel 2,2 5000 1 3,2 20,30 100\n#OBJECT SIZE COLOR DISP POS PRI\ncolor 2,2 4279312947 1 3,92 10\n#START\nnext WAIT\n#WAIT\n#CAPTURE\nbaseimg panel\nbreak\n#REDRAW\nforce_redraw\nbreak\n',
    world = await defaultFESWorld('nekopara-vol3-engine-2.6.1.76', {
      'screen.fes': new TextEncoder().encode(source),
    });
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const panel = h.instance.byKey.get('panel');
    panel.rotation = 90;
    panel.scaleX = 2;
    panel.dirty = true;
    await h.task.player.notify('CAPTURE');
    const captured = world.graphics.images.get(h.draw.state.baseImage);
    assert.deepEqual([captured.width, captured.height], [2, 2]);
    assert.deepEqual([...(await captured.pixels())], Array(4).fill([17, 34, 51, 255]).flat());
    await captured.fill(0, 0, 2, 2, 0xff0000ff);
    const color = h.instance.byKey.get('color');
    await world.graphics.images.get(color.imageResource.bitmap).fill(0, 0, 2, 2, 0xffff0000);
    assert.deepEqual([...(await captured.pixels()).subarray(0, 4)], [0, 0, 255, 255]);
    await h.draw.render();
    await world.graphics.fill(0, 0, 128, 96, 0);
    await h.task.player.notify('REDRAW');
    assert.equal(h.instance.forceRedrawPending, true);
    assert.deepEqual(
      [...(await world.graphics.images.get(world.graphics.vramHandle).pixels()).subarray(0, 4)],
      [0, 0, 0, 0],
    );
    await world.graphics.flushFESRedraw(h.instance);
    assert.equal(h.instance.forceRedrawPending, false);
    assert.deepEqual(
      [...(await world.graphics.images.get(world.graphics.vramHandle).pixels()).subarray(0, 4)],
      [0, 0, 255, 255],
    );
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});
const forceOutputSentinel = 0x13579bdf;
const forceOutputCode = kcsProgram([
  [37, forceOutputSentinel],
  [37, [0x13, 128]],
  [43, 342, 4],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);

async function forceOutputCall(world, target) {
  const id = await world.objects.create({ kind: 12, parent: world.main.id, name: 'force.kcs' }),
    record = world.objects.objects.get(id);
  await record.implementation.loadScript('force.kcs');
  const task = record.implementation.task,
    machine = task.machine,
    initialSP = machine.sp;
  machine.store(128, target);
  machine.bytes(800, 16).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.load(516), 89);
  assert.equal(machine.sp, initialSP + 4, 'the void call leaves only its original sentinel');
  assert.equal(machine.load(machine.sp - 4), forceOutputSentinel);
  assert.deepEqual(Array.from(machine.bytes(800, 16)), Array(16).fill(0xa5));
  assert.equal(machine.load(128), target >>> 0);
  return task;
}

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} main342 GCALL forces full Draw pixels and retains cold ownership`, async () => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'force.kcs': forceOutputCode },
      world = await dataWorld(profile, files);
    let fresh;
    try {
      const texture = world.configuration.fields.texture;
      texture.size.set([64, 64]);
      texture.grid.set([1, 1]);
      texture.bppY.set([0, 1]);
      texture.areas[0].set([0, 0, 1, 1]);
      texture.bpp = 32;
      const surfaceID = await world.objects.create({
          kind: 15,
          parent: world.main.id,
          nativeID: 0x00342342,
          name: 'force output surface',
        }),
        siblingID = await world.objects.create({ kind: 15, parent: world.main.id }),
        draw = world.graphics.drawTasks.get(surfaceID),
        sibling = world.graphics.drawTasks.get(siblingID),
        target = world.nativeTaskID(surfaceID),
        messages = [],
        send = world.sendNativeEngine;
      assert.notEqual(surfaceID, target);
      world.sendNativeEngine = function (destination, sender, number, w, l, context) {
        if (number === 292) messages.push([destination, sender, number, w, l, context?.flags ?? 0]);
        return send.call(this, destination, sender, number, w, l, context);
      };
      await world.sendNativeEngine(target, world.main.id, 286, 0, 1);
      await world.sendNativeEngine(target, world.main.id, 304, 0, 0);
      const siblingBefore = structuredClone(sibling.state),
        empty = await forceOutputCall(world, target);
      assert.equal(draw.state.renderer, null);
      assert.equal(draw.state.dirty, true, 'a missing renderer still receives the dirty store');
      assert.equal(draw.state.pending, true, 'the missing-renderer branch does not clear pending');
      assert.deepEqual(messages.at(-1), [target, empty.id, 292, 0, 0, 0]);
      const call = (id, args) =>
        world.runtime.native('main', id, args, world.main.machine, world.main);
      await call(0x100, [target, 4, 1]);
      await call(0x104, [target, 2, 1]);
      const bitmapID = world.graphics.images.create(1, 1, world.main.id),
        bitmap = world.graphics.images.get(bitmapID),
        color = [17, 33, 65, 255];
      (await bitmap.pixels()).set(color);
      await bitmap.changed();
      await call(0x101, [
        target,
        7,
        bitmapID,
        floatBits(1),
        0,
        0,
        0,
        0,
        floatBits(1),
        floatBits(1),
        255,
        1,
        0,
      ]);
      await world.graphics.images.release(bitmapID);
      const outputs = [],
        output = world.graphics.output;
      world.graphics.output = function (image, offset, region, ...rest) {
        const promise = output.call(this, image, offset, region, ...rest);
        outputs.push({ offset: [...offset], region, promise });
        return promise;
      };
      await call(0x106, [target, 1]);
      await call(0x216, [target, 0]);
      await forceOutputCall(world, target);
      const firstPixels = [0, 0, 0, 0, ...color, 0, 0, 0, 0, 0, 0, 0, 0];
      assert.deepEqual(Array.from(await drawPixels(world, surfaceID)), firstPixels);
      assert.equal(draw.state.pending, false);
      assert.equal(outputs.length, 1);
      assert.deepEqual(outputs[0].offset, [2, 1]);
      assert.equal(outputs[0].region, null, 'force output copies the complete surface');
      assert.equal(typeof outputs[0].promise?.then, 'function');
      const alias = world.graphics.images.get(draw.state.renderer.items[0].image),
        changed = [117, 133, 165, 255];
      (await alias.pixels()).set(changed);
      await alias.changed();
      await call(0x106, [target, 0]);
      await call(0x216, [target, 0]);
      await forceOutputCall(world, target);
      const expected = [0, 0, 0, 0, ...changed, 0, 0, 0, 0, 0, 0, 0, 0];
      assert.deepEqual(Array.from(await drawPixels(world, surfaceID)), expected);
      assert.equal(draw.state.enabled, false);
      assert.equal(outputs.length, 2, 'disabled ordinary output is overridden by this command');
      const vram = world.graphics.images.get(world.graphics.vramHandle),
        pixels = await vram.pixels();
      assert.deepEqual(
        Array.from(pixels.subarray((vram.width + 2) * 4, (vram.width + 6) * 4)),
        expected,
      );
      const zero = await forceOutputCall(world, 0),
        missing = await forceOutputCall(world, 0x7f342342);
      assert.deepEqual(messages.at(-2), [0, zero.id, 292, 0, 0, 0]);
      assert.deepEqual(messages.at(-1), [0x7f342342, missing.id, 292, 0, 0, 0]);
      assert.equal(outputs.length, 2);
      assert.deepEqual(sibling.state, siblingBefore);

      const saved = world.snapshot(),
        encoded = await serializeCheckpoint(saved),
        decoded = await deserializeCheckpoint(encoded);
      fresh = await dataWorld(profile, files, { initialize: false });
      fresh.runtime.native = () => {
        throw new Error('Draw restore replayed a native command');
      };
      for (const stream of [fresh.random.integer, fresh.random.real])
        stream.nextUint32 = () => {
          throw new Error('Draw restore replayed RNG');
        };
      await fresh.restore(decoded);
      assert.deepEqual(fresh.snapshot(), saved, 'the complete DTO agrees before a warm frame');
      assert.deepEqual(Array.from(await drawPixels(fresh, surfaceID)), expected);
      await world.objects.release(surfaceID);
      assert.equal(world.objects.objects.has(surfaceID), false);
      assert.deepEqual(Array.from(await drawPixels(fresh, surfaceID)), expected);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}

const clearDrawCode = kcsProgram([
  [37, forceOutputSentinel],
  [37, 0],
  [43, 341, 4],
  [37, 73],
  [38, [0x13, 512]],
  [37, [0x13, 128]],
  [43, 341, 4],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} entry Draw clear GCALL preserves real bitmap and cold ownership`, async () => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'clear.kcs': clearDrawCode },
      scene = await dataWorld(profile, files);
    let fresh;
    try {
      const surfaceID = await scene.objects.create({
          kind: 15,
          parent: scene.main.id,
          nativeID: 0x01550001,
        }),
        target = scene.nativeTaskID(surfaceID),
        draw = scene.graphics.drawTasks.get(surfaceID);
      assert.notEqual(surfaceID, target);
      await scene.runtime.native('main', 0x100, [target, 6, 4], scene.main.machine, scene.main);
      await scene.runtime.native('main', 0x104, [target, 0, 0], scene.main.machine, scene.main);
      const base = scene.graphics.images.create(2, 2),
        overlay = scene.graphics.images.create(2, 2);
      await scene.graphics.images.get(base).fill(0, 0, 2, 2, 0xff123456);
      await scene.graphics.images.get(overlay).fill(0, 0, 2, 2, 0xffaabbcc);
      await scene.sendEngine(surfaceID, scene.main.id, 296, 0, base);
      const captured = draw.state.baseImage;
      await scene.runtime.native(
        'main',
        0x101,
        [target, 7, overlay, 0, 0, 0, 0, 0, floatBits(1), floatBits(1), 255, 1, 0],
        scene.main.machine,
        scene.main,
      );
      await draw.render();
      assert.equal(draw.state.renderer.items.length, 2);
      assert.deepEqual(
        [...(await drawPixels(scene, surfaceID)).subarray(0, 4)],
        [170, 187, 204, 255],
      );
      const traces = [],
        replies = [],
        send = scene.sendNativeEngine,
        native = scene.runtime.native;
      scene.sendNativeEngine = function (destination, sender, id, w, l, context = {}) {
        const trace =
          id === 291 ? { destination, sender, id, w, l, flags: context.flags ?? 0 } : null;
        if (trace) traces.push(trace);
        const reply = send.call(this, destination, sender, id, w, l, context);
        if (trace) trace.reply = reply;
        return reply;
      };
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 341) replies.push(reply);
        return reply;
      };
      const call = async (destination, nativeID) => {
        const id = await scene.objects.create({
            kind: 12,
            parent: scene.main.id,
            nativeID,
            name: 'clear caller',
          }),
          record = scene.objects.objects.get(id);
        await record.implementation.loadScript('clear.kcs');
        const task = record.implementation.task,
          machine = task.machine,
          sp = machine.sp;
        machine.store(128, destination);
        machine.bytes(800, 8).fill(0xa5);
        await scene.runtime.scheduler.execute(task);
        assert.equal(machine.load(512), 73);
        assert.equal(machine.load(516), 89);
        assert.equal(machine.halted, true);
        assert.equal(machine.pop(), forceOutputSentinel);
        assert.equal(machine.sp, sp);
        assert.deepEqual([...machine.bytes(800, 8)], Array(8).fill(0xa5));
        return task;
      };
      const caller = await call(target, 0x01551000);
      assert.deepEqual(
        traces
          .slice(0, 2)
          .map(({ destination, sender, id, w, l, flags }) => [
            destination,
            sender,
            id,
            w,
            l,
            flags,
          ]),
        [
          [0, caller.id, 291, 0, 0, 0],
          [target, caller.id, 291, 0, 0, 0],
        ],
      );
      assert.deepEqual(
        draw.state.renderer.items.map((item) => item.key),
        [0],
        'The current base image is reinserted after all entries are cleared',
      );
      assert.equal(draw.state.baseImage, captured);
      await draw.render();
      const pixels = [...(await drawPixels(scene, surfaceID))];
      assert.deepEqual(pixels.slice(0, 4), [18, 52, 86, 255]);
      assert.deepEqual(
        pixels.slice(5 * 4, 6 * 4),
        [0, 0, 0, 0],
        'Clear resets the bitmap outside the retained base',
      );
      assert.deepEqual(
        [...(await scene.graphics.images.get(overlay).pixels()).subarray(0, 4)],
        [170, 187, 204, 255],
        'Clearing shared entries does not corrupt their source bitmap',
      );
      const emptyID = await scene.objects.create({
          kind: 15,
          parent: scene.main.id,
          nativeID: 0x01550002,
        }),
        empty = scene.graphics.drawTasks.get(emptyID),
        before = structuredClone(empty.state);
      await call(scene.nativeTaskID(emptyID), 0x01551010);
      assert.deepEqual(
        empty.state,
        before,
        'A Draw with no renderer has no fabricated pixels or initialized offset',
      );
      await call(0x7fffffff, 0x01551020);
      assert.deepEqual(
        await Promise.all(replies),
        Array.from({ length: 6 }, () => ({ control: 2 })),
      );
      assert.equal(typeof traces[1].reply.then, 'function');
      const dto = scene.snapshot(),
        decoded = await deserializeCheckpoint(await serializeCheckpoint(dto));
      fresh = await dataWorld(profile, files, { initialize: false });
      fresh.runtime.native = () => {
        throw new Error('Draw clear cold restore replayed native');
      };
      for (const stream of [fresh.random.integer, fresh.random.real])
        stream.nextUint32 = () => {
          throw new Error('Draw clear cold restore replayed RNG');
        };
      await fresh.restore(decoded);
      assert.deepEqual(fresh.snapshot(), dto, 'The entire DTO agrees before render or warm tick');
      assert.deepEqual([...(await drawPixels(fresh, surfaceID))], pixels);
      assert.notStrictEqual(
        fresh.graphics.images.get(captured).state.rgba,
        scene.graphics.images.get(captured).state.rgba,
      );
      await scene.objects.release(surfaceID);
      assert.equal(scene.objects.objects.has(draw.state.basePlane), false);
      assert.equal(fresh.objects.objects.has(surfaceID), true);
      assert.deepEqual([...(await drawPixels(fresh, surfaceID))], pixels);
      assert.equal(scene.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await scene.close();
    }
  });

const captureBaseCode = kcsProgram([
  [37, forceOutputSentinel],
  [37, [0x13, 128]],
  [37, [0x13, 132]],
  [43, 455, 8],
  [37, 73],
  [38, [0x13, 512]],
  [59],
]);
async function captureBaseCall(world, target, bitmap, nativeID) {
  const id = await world.objects.create({
      kind: 12,
      parent: world.main.id,
      nativeID,
      name: 'base capture caller',
    }),
    record = world.objects.objects.get(id);
  await record.implementation.loadScript('capture.kcs');
  const task = record.implementation.task,
    machine = task.machine,
    sp = machine.sp;
  machine.store(128, target);
  machine.store(132, bitmap);
  machine.bytes(800, 8).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.halted, true);
  assert.equal(machine.load(512), 73);
  assert.equal(machine.pop(), forceOutputSentinel);
  assert.equal(machine.sp, sp);
  assert.deepEqual([...machine.bytes(800, 8)], Array(8).fill(0xa5));
  return task;
}
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} main455 GCALL captures owned base pixels and hides without releasing the copy`, async () => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'capture.kcs': captureBaseCode },
      scene = await dataWorld(profile, files);
    let fresh;
    try {
      const surfaceID = await scene.objects.create({
          kind: 15,
          parent: scene.main.id,
          nativeID: 0x01c70001,
        }),
        target = scene.nativeTaskID(surfaceID),
        draw = scene.graphics.drawTasks.get(surfaceID);
      assert.notEqual(surfaceID, target);
      await scene.runtime.native('main', 0x100, [target, 4, 3], scene.main.machine, scene.main);
      await scene.runtime.native('main', 0x104, [target, 0, 0], scene.main.machine, scene.main);
      const image = scene.graphics.images.create(2, 2),
        source = scene.graphics.images.get(image);
      await source.fill(0, 0, 2, 2, 0xff123456);
      const traces = [],
        replies = [],
        send = scene.sendNativeEngine,
        native = scene.runtime.native;
      scene.sendNativeEngine = function (destination, sender, id, w, l, context = {}) {
        const trace =
          id === 296 ? { destination, sender, id, w, l, flags: context.flags ?? 0 } : null;
        if (trace) traces.push(trace);
        const reply = send.call(this, destination, sender, id, w, l, context);
        if (trace) trace.reply = reply;
        return reply;
      };
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 455) replies.push(reply);
        return reply;
      };
      const first = await captureBaseCall(scene, target, image, 0x01c71000),
        captured = draw.state.baseImage;
      assert.notEqual(first.id, scene.nativeTaskID(first.id));
      assert.notEqual(captured, image);
      assert.deepEqual(
        traces.map(({ destination, sender, id, w, l, flags }) => [
          destination,
          sender,
          id,
          w,
          l,
          flags,
        ]),
        [[target, first.id, 296, 0, image, 0]],
      );
      assert.equal(typeof traces[0].reply.then, 'function');
      assert.equal(draw.state.baseVisible, true);
      assert.equal(scene.graphics.get(draw.state.basePlane).state.shown, true);
      await source.fill(0, 0, 2, 2, 0xffabcdef);
      await scene.graphics.images.release(image);
      assert.equal(scene.runtime.handles.records.has(image), false);
      await draw.render();
      const expected = [
        18, 52, 86, 255, 18, 52, 86, 255, 0, 0, 0, 0, 0, 0, 0, 0, 18, 52, 86, 255, 18, 52, 86, 255,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ];
      assert.deepEqual([...(await drawPixels(scene, surfaceID))], expected);
      const hidden = await captureBaseCall(scene, target, 0, 0x01c71001);
      assert.deepEqual(
        [
          traces.at(-1).destination,
          traces.at(-1).sender,
          traces.at(-1).w,
          traces.at(-1).l,
          traces.at(-1).flags,
        ],
        [target, hidden.id, 0, 0, 0],
      );
      assert.equal(draw.entry(0), undefined);
      assert.equal(draw.state.baseVisible, false);
      assert.equal(scene.graphics.get(draw.state.basePlane).state.shown, false);
      assert.equal(draw.state.baseImage, captured, 'zero retains the private base bitmap');
      assert.equal(scene.runtime.handles.records.has(captured), true);
      assert.deepEqual(
        [...(await scene.graphics.images.get(captured).pixels())],
        [18, 52, 86, 255, 18, 52, 86, 255, 18, 52, 86, 255, 18, 52, 86, 255],
      );
      const replacement = scene.graphics.images.create(1, 1);
      await scene.graphics.images.get(replacement).fill(0, 0, 1, 1, 0xff224466);
      await captureBaseCall(scene, target, replacement, 0x01c71002);
      const current = draw.state.baseImage;
      assert.notEqual(current, captured);
      assert.equal(scene.runtime.handles.records.has(captured), false);
      await scene.graphics.images.release(replacement);
      await scene.runtime.native('main', 341, [target], scene.main.machine, scene.main);
      assert.deepEqual(
        draw.state.renderer.items.map((item) => item.key),
        [0],
      );
      await draw.render();
      const pixels = [...(await drawPixels(scene, surfaceID))];
      assert.deepEqual(pixels, [34, 68, 102, 255, ...Array(44).fill(0)]);
      const before = draw.snapshot(),
        zero = await captureBaseCall(scene, 0, 0x80000000, 0x01c71003),
        missing = await captureBaseCall(scene, 0x7fffffff, 0xffffffff, 0x01c71004);
      assert.deepEqual(
        traces
          .slice(-2)
          .map(({ destination, sender, id, w, l, flags }) => [
            destination,
            sender,
            id,
            w,
            l,
            flags,
          ]),
        [
          [0, zero.id, 296, 0, 0x80000000, 0],
          [0x7fffffff, missing.id, 296, 0, 0xffffffff, 0],
        ],
      );
      assert.deepEqual(draw.snapshot(), before, 'unhandled targets cannot invent a bitmap owner');
      assert.deepEqual(
        await Promise.all(replies),
        Array.from({ length: 5 }, () => ({ control: 2 })),
      );
      const dto = scene.snapshot(),
        decoded = await deserializeCheckpoint(await serializeCheckpoint(dto));
      fresh = await dataWorld(profile, files, { initialize: false });
      const freshNative = fresh.runtime.native;
      fresh.runtime.native = () => {
        throw new Error('Base-image cold restore replayed a native command');
      };
      for (const stream of [fresh.random.integer, fresh.random.real])
        stream.nextUint32 = () => {
          throw new Error('Base-image cold restore replayed RNG');
        };
      await fresh.restore(decoded);
      assert.deepEqual(fresh.snapshot(), dto, 'the entire DTO agrees before any warm frame');
      assert.deepEqual([...(await drawPixels(fresh, surfaceID))], pixels);
      assert.notStrictEqual(
        fresh.graphics.images.get(current).state.rgba,
        scene.graphics.images.get(current).state.rgba,
      );
      fresh.runtime.native = freshNative;
      await captureBaseCall(fresh, target, 0, 0x01c71005);
      assert.equal(fresh.graphics.drawTasks.get(surfaceID).state.baseVisible, false);
      assert.equal(draw.state.baseVisible, true);
      assert.equal(fresh.runtime.handles.records.has(current), true);
      const basePlane = draw.state.basePlane;
      await scene.objects.release(surfaceID);
      assert.equal(scene.runtime.handles.records.has(current), false);
      assert.equal(scene.objects.objects.has(basePlane), false);
      assert.equal(fresh.objects.objects.has(surfaceID), true);
      assert.deepEqual([...(await drawPixels(fresh, surfaceID))], pixels);
      assert.equal(scene.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await scene.close();
      if (fresh) assert.equal(fresh.graphics.drawTasks.size, 0);
      assert.equal(scene.graphics.drawTasks.size, 0);
    }
  });

const clipGCALLCode = kcsProgram([
  [37, forceOutputSentinel],
  ...[128, 132, 136, 140, 144, 148].map((at) => [37, [0x13, at]]),
  [43, 339, 24],
  [37, 73],
  [38, [0x13, 512]],
  [59],
]);
async function clipGCALL(world, record, words) {
  await record.implementation.loadScript('clip.kcs');
  const task = record.implementation.task,
    machine = task.machine,
    sp = machine.sp;
  words.forEach((word, i) => machine.store(128 + i * 4, word));
  machine.bytes(800, 8).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.halted, true);
  assert.equal(machine.load(512), 73);
  assert.equal(machine.pop(), forceOutputSentinel);
  assert.equal(machine.sp, sp);
  assert.deepEqual([...machine.bytes(800, 8)], Array(8).fill(0xa5));
}
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' main339 GCALL preserves clipping reset, equality and cold bitmap ownership',
    async () => {
      const files = { 'case.kcs': kcsProgram([[59]]), 'clip.kcs': clipGCALLCode },
        scene = await dataWorld(profile, files);
      let fresh;
      try {
        const surfaceID = await scene.objects.create({
            kind: 15,
            parent: scene.main.id,
            nativeID: 0x01530001,
          }),
          target = scene.nativeTaskID(surfaceID),
          draw = scene.graphics.drawTasks.get(surfaceID),
          callerID = await scene.objects.create({
            kind: 12,
            parent: scene.main.id,
            nativeID: 0x153,
            name: 'clip caller',
          }),
          caller = scene.objects.objects.get(callerID),
          rawKey = 0x80000007,
          entryKey = 0x00070153;
        assert.notEqual(surfaceID, target);
        assert.notEqual(callerID, 0x153);
        await caller.implementation.loadScript('clip.kcs');
        await scene.runtime.native('main', 0x100, [target, 4, 3], scene.main.machine, scene.main);
        await scene.runtime.native('main', 0x104, [target, 0, 0], scene.main.machine, scene.main);
        const image = scene.graphics.images.create(3, 2, scene.main.id);
        await scene.graphics.images.get(image).fill(0, 0, 3, 2, 0xff123456);
        await scene.runtime.native(
          'main',
          0x101,
          [target, rawKey, image, 0, 0, 0, 0, 0, floatBits(1), floatBits(1), 255, 1, 0],
          caller.implementation.task.machine,
          caller.implementation.task,
        );
        await scene.graphics.images.release(image);
        const item = draw.entry(entryKey);
        assert.ok(item, 'the retained key combines native sender and the low selector word');
        const retained = await scene.retainedDraw.ensure(draw, entryKey),
          retainedState = () => structuredClone(scene.renderSources.get(retained.source)),
          traces = [],
          receipts = [],
          send = scene.sendNativeEngine,
          native = scene.runtime.native,
          receive = scene.objects.objects.get(surfaceID).implementation.message;
        scene.sendNativeEngine = function (destination, sender, id, w, l, context = {}) {
          const trace =
            id === 289
              ? {
                  destination,
                  sender,
                  id,
                  w,
                  l,
                  flags: context.flags ?? 0,
                  rect: context.payload
                    ? [0, 4, 8, 12].map((at) => context.payload.load(at))
                    : null,
                }
              : null;
          if (trace) traces.push(trace);
          const result = send.call(this, destination, sender, id, w, l, context);
          if (trace) trace.result = result;
          return result;
        };
        scene.objects.objects.get(surfaceID).implementation.message = function (words, context) {
          if (words[1] === 289) receipts.push([...words]);
          return receive.call(this, words, context);
        };
        const replies = [];
        scene.runtime.native = function (table, id, ...args) {
          const result = native.call(this, table, id, ...args);
          if (table === 'main' && id === 339) replies.push(result);
          return result;
        };
        const call = (destination, x, y, width, height) =>
          clipGCALL(scene, caller, [destination, rawKey, x, y, width, height]);
        await call(target, 1, 0, 1, 2);
        assert.deepEqual(draw.entry(entryKey).clip, [1, 0, 2, 2]);
        assert.deepEqual(receipts.at(-1), [0x153, 289, rawKey, 0]);
        assert.deepEqual(
          traces.at(-1).rect,
          [1, 0, 2, 2],
          'the wrapper writes exactly the four RECT words before dispatch',
        );
        assert.deepEqual(
          [traces[0].destination, traces[0].sender, traces[0].w, traces[0].flags],
          [target, callerID, rawKey, 0],
        );
        assert.equal(typeof traces[0].result.then, 'function');
        await draw.render();
        const clipped = [
          0, 0, 0, 0, 18, 52, 86, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18, 52, 86, 255, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert.deepEqual([...(await drawPixels(scene, surfaceID))], clipped);
        await call(target, 0, 0, 0, 0);
        assert.deepEqual(
          draw.entry(entryKey).clip,
          [0, 0, 4, 3],
          'empty RECT resets to the renderer range',
        );
        await draw.render();
        const full = [
          18, 52, 86, 255, 18, 52, 86, 255, 18, 52, 86, 255, 0, 0, 0, 0, 18, 52, 86, 255, 18, 52,
          86, 255, 18, 52, 86, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert.deepEqual([...(await drawPixels(scene, surfaceID))], full);
        const equalDraw = draw.snapshot(),
          equalSource = retainedState();
        await call(target, 0, 0, 4, 3);
        assert.deepEqual(
          draw.snapshot(),
          equalDraw,
          'equal raw RECT is a no-op before invalidation',
        );
        assert.deepEqual(
          retainedState(),
          equalSource,
          'equal RECT does not revise the retained source',
        );
        await call(target, 0, 0, 0, 0);
        assert.equal(
          draw.state.renderer.dirtyRects.length,
          2,
          'raw empty differs from stored full before normalization',
        );
        await draw.render();
        const nullBefore = draw.snapshot();
        await scene.sendNativeEngine(target, callerID, 289, rawKey, 0);
        assert.deepEqual(
          draw.snapshot(),
          nullBefore,
          'the null RECT path resets without manager invalidation',
        );
        const unknownBefore = { draw: draw.snapshot(), source: retainedState() },
          partial = new NativeGraphicsPacket([0, 0, undefined, 3], { unwritten: [2] });
        await assert.rejects(
          scene.sendNativeEngine(target, callerID, 289, rawKey, 0, { payload: partial }),
          /Draw clip RECT has no initialized 32-bit output word/,
        );
        assert.deepEqual({ draw: draw.snapshot(), source: retainedState() }, unknownBefore);
        await scene.sendNativeEngine(target, callerID, 289, 8, 0, { payload: partial });
        assert.deepEqual(
          { draw: draw.snapshot(), source: retainedState() },
          unknownBefore,
          'a missing entry is checked before its RECT is read',
        );
        await call(target, 0x7ffffffe, 0xfffffff9, 3, 2);
        assert.deepEqual(traces.at(-1).rect, [0x7ffffffe, 0xfffffff9, 0x80000001, 0xfffffffb]);
        assert.deepEqual(
          draw.entry(entryKey).clip,
          [0, 0, 4, 3],
          'wrapped/inverted signed RECT follows the empty branch',
        );
        await draw.render();
        const untouched = { draw: draw.snapshot(), source: retainedState() };
        await call(0, 1, 2, 3, 4);
        await call(0x7fffffff, 1, 2, 3, 4);
        assert.deepEqual(
          traces.slice(-2).map((x) => [x.destination, x.sender, x.w, x.flags]),
          [
            [0, callerID, rawKey, 0],
            [0x7fffffff, callerID, rawKey, 0],
          ],
        );
        assert.deepEqual({ draw: draw.snapshot(), source: retainedState() }, untouched);
        assert.deepEqual(
          await Promise.all(replies),
          Array.from({ length: 7 }, () => ({ control: 2 })),
        );
        const dto = scene.snapshot(),
          decoded = await deserializeCheckpoint(await serializeCheckpoint(dto));
        fresh = await dataWorld(profile, files, { initialize: false });
        fresh.runtime.native = () => {
          throw new Error('Clip cold restore replayed a native command');
        };
        for (const stream of [fresh.random.integer, fresh.random.real])
          stream.nextUint32 = () => {
            throw new Error('Clip cold restore replayed RNG');
          };
        await fresh.restore(decoded);
        assert.deepEqual(fresh.snapshot(), dto, 'the entire DTO agrees without a warm frame');
        assert.deepEqual([...(await drawPixels(fresh, surfaceID))], full);
        const restored = fresh.graphics.drawTasks.get(surfaceID);
        assert.notStrictEqual(restored.state.renderer, draw.state.renderer);
        await fresh.sendNativeEngine(target, callerID, 289, rawKey, 0, {
          payload: new NativeGraphicsPacket([1, 0, 2, 1]),
        });
        assert.deepEqual(restored.entry(entryKey).clip, [1, 0, 2, 1]);
        assert.deepEqual(draw.entry(entryKey).clip, [0, 0, 4, 3]);
        await restored.render();
        assert.deepEqual([...(await drawPixels(scene, surfaceID))], full);
        await scene.objects.release(surfaceID);
        assert.equal(fresh.objects.objects.has(surfaceID), true);
        assert.deepEqual(restored.entry(entryKey).clip, [1, 0, 2, 1]);
        assert.equal(scene.nativeEngine, undefined);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await scene.close();
        assert.equal(scene.graphics.drawTasks.size, 0);
        if (fresh) assert.equal(fresh.graphics.drawTasks.size, 0);
      }
    },
  );

const bitmapQueryCode = kcsProgram([
  [37, forceOutputSentinel],
  [37, [0x13, 128]],
  [43, 261, 4],
  [38, [0x13, 512]],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);
const ordinaryDrawCode = kcsProgram([
  [37, forceOutputSentinel],
  [37, [0x13, 128]],
  [43, 340, 4],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);
let drawQueryCaller = 0;
async function drawQueryCall(world, target, query = true) {
  const name = query ? 'bitmap-query.kcs' : 'ordinary-draw.kcs',
    id = await world.objects.create({
      kind: 12,
      parent: world.main.id,
      nativeID: 0x01051000 + ++drawQueryCaller,
      name,
    }),
    record = world.objects.objects.get(id);
  await record.implementation.loadScript(name);
  const task = record.implementation.task,
    machine = task.machine,
    sp = machine.sp;
  machine.store(128, target);
  machine.store(512, 0x89abcdef);
  machine.bytes(800, 16).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.halted, true);
  assert.equal(machine.load(128), target >>> 0);
  assert.equal(machine.load(516), 89);
  assert.equal(machine.pop(), forceOutputSentinel);
  assert.equal(machine.sp, sp);
  assert.deepEqual([...machine.bytes(800, 16)], Array(16).fill(0xa5));
  if (!query) assert.equal(machine.load(512), 0x89abcdef, 'control2 writes no VM result');
  return { task, value: machine.load(512) };
}
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} gallery Draw bitmap query and ordinary render keep owned pixels and cold state`, async () => {
    const files = {
        'case.kcs': kcsProgram([[59]]),
        'bitmap-query.kcs': bitmapQueryCode,
        'ordinary-draw.kcs': ordinaryDrawCode,
      },
      world = await dataWorld(profile, files);
    let fresh;
    try {
      const texture = world.configuration.fields.texture;
      texture.size.set([64, 64]);
      texture.grid.set([1, 1]);
      texture.bppY.set([0, 1]);
      texture.areas[0].set([0, 0, 1, 1]);
      texture.bpp = 32;
      const surfaceID = await world.objects.create({
          kind: 15,
          parent: world.main.id,
          nativeID: 0x01050001,
          name: 'gallery bitmap surface',
        }),
        emptyID = await world.objects.create({
          kind: 15,
          parent: world.main.id,
          nativeID: 0x01050002,
          name: 'gallery empty surface',
        }),
        target = world.nativeTaskID(surfaceID),
        emptyTarget = world.nativeTaskID(emptyID),
        draw = world.graphics.drawTasks.get(surfaceID),
        sibling = world.graphics.drawTasks.get(emptyID),
        siblingBefore = structuredClone(sibling.state),
        messages = [],
        send = world.sendNativeEngine,
        outputs = [],
        output = world.graphics.output;
      assert.notEqual(surfaceID, target);
      world.sendNativeEngine = function (destination, sender, message, w, l, context) {
        const promise = send.call(this, destination, sender, message, w, l, context);
        if (message === 285 || message === 290)
          messages.push({
            destination,
            sender,
            message,
            w,
            l,
            flags: context?.flags ?? 0,
            promise,
          });
        return promise;
      };
      world.graphics.output = function (...args) {
        const promise = output.apply(this, args);
        outputs.push({ promise });
        return promise;
      };
      const call = (id, args) =>
          world.runtime.native('main', id, args, world.main.machine, world.main),
        bitmapRecords = () =>
          world.runtime.handles
            .snapshot()
            .records.filter(([, r]) => ['bitmap', 'bitmap-data'].includes(r.type));
      await call(256, [target, 4, 3]);
      await call(260, [target, 1, 2]);
      await call(262, [target, 0]);
      const sourceHandle = world.graphics.images.create(1, 1, world.main.id),
        source = world.graphics.images.get(sourceHandle),
        bind = () =>
          call(257, [
            target,
            7,
            sourceHandle,
            floatBits(1),
            floatBits(1),
            floatBits(0),
            floatBits(0),
            floatBits(0),
            floatBits(1),
            floatBits(1),
            255,
            1,
            0,
          ]);
      await source.fill(0, 0, 1, 1, 0xff112141);
      await bind();
      const bitmapHandle = draw.state.renderer.bitmap,
        bitmapBefore = bitmapRecords(),
        stateBefore = structuredClone(draw.state),
        query = await drawQueryCall(world, target);
      assert.equal(query.value, bitmapHandle);
      assert.notEqual(world.nativeTaskID(query.task.id), query.task.id);
      assert.notEqual(query.value, draw.state.renderer.items.length, 'bitmap is not an item count');
      assert.deepEqual(
        bitmapRecords(),
        bitmapBefore,
        'the query does not allocate or retain a bitmap',
      );
      assert.deepEqual(draw.state, stateBefore, 'the getter does not render or dirty its owner');
      assert.deepEqual(
        messages.at(-1) && [
          messages.at(-1).destination,
          messages.at(-1).sender,
          messages.at(-1).message,
          messages.at(-1).w,
          messages.at(-1).l,
          messages.at(-1).flags,
        ],
        [target, query.task.id, 285, 0, 0, 0],
      );
      assert.equal(typeof messages.at(-1).promise?.then, 'function');
      assert.equal(
        (await drawQueryCall(world, emptyTarget)).value,
        0,
        'a real L store of zero is a result',
      );
      const rendered = await drawQueryCall(world, target, false),
        firstPixels = [...Array(20).fill(0), 17, 33, 65, 255, ...Array(24).fill(0)];
      assert.deepEqual([...(await drawPixels(world, surfaceID))], firstPixels);
      assert.equal(outputs.length, 0, 'ordinary rendering honors disabled output');
      assert.equal(draw.state.enabled, false);
      assert.equal(draw.state.pending, false);
      assert.deepEqual(
        [
          messages.at(-1).destination,
          messages.at(-1).sender,
          messages.at(-1).message,
          messages.at(-1).w,
          messages.at(-1).l,
          messages.at(-1).flags,
        ],
        [target, rendered.task.id, 290, 0, 0, 0],
      );
      await call(262, [target, 1]);
      await source.fill(0, 0, 1, 1, 0xff7585a5);
      await bind();
      await drawQueryCall(world, target, false);
      const pixels = [...Array(20).fill(0), 117, 133, 165, 255, ...Array(24).fill(0)];
      assert.deepEqual([...(await drawPixels(world, surfaceID))], pixels);
      assert.equal(outputs.length, 1, 'the enabled ordinary compositor reaches the real output');
      assert.equal(typeof outputs[0].promise?.then, 'function');
      assert.equal(draw.state.pending, false);
      assert.deepEqual(sibling.state, siblingBefore);
      const saved = world.snapshot(),
        decoded = await deserializeCheckpoint(await serializeCheckpoint(saved));
      fresh = await dataWorld(profile, files, { initialize: false });
      const native = fresh.runtime.native,
        read = fresh.game.read,
        restoredScripts = [],
        random = [fresh.random.integer, fresh.random.real].map((stream) => [
          stream,
          stream.nextUint32,
        ]);
      fresh.runtime.native = () => {
        throw new Error('Gallery Draw cold restore replayed a native');
      };
      fresh.game.read = function (name, ...args) {
        assert.equal(
          Object.hasOwn(files, name) || name === 'm2view.cnf',
          true,
          'cold restore reads owned script code or the explicitly absent M2 configuration',
        );
        const promise = read.call(this, name, ...args);
        restoredScripts.push({ name, promise });
        return promise;
      };
      for (const [stream] of random)
        stream.nextUint32 = () => {
          throw new Error('Gallery Draw cold restore replayed RNG');
        };
      await fresh.restore(decoded);
      assert.deepEqual(fresh.snapshot(), saved, 'all DTO fields agree without a warm frame');
      assert.notEqual(
        restoredScripts.length,
        0,
        'cold restore loads owned code without executing it',
      );
      for (const restored of restoredScripts)
        if (restored.name === 'm2view.cnf') assert.equal(await restored.promise, null);
      fresh.runtime.native = native;
      fresh.game.read = read;
      for (const [stream, next] of random) stream.nextUint32 = next;
      const freshMessages = [],
        freshSend = fresh.sendNativeEngine;
      fresh.sendNativeEngine = function (destination, sender, message, w, l, context) {
        const promise = freshSend.call(this, destination, sender, message, w, l, context);
        if (message === 285 || message === 290)
          freshMessages.push([destination, sender, message, w, l, context?.flags ?? 0]);
        return promise;
      };
      assert.deepEqual([...(await drawPixels(fresh, surfaceID))], pixels);
      assert.equal((await drawQueryCall(fresh, target)).value, bitmapHandle);
      await world.objects.release(surfaceID);
      assert.equal(
        world.runtime.handles.records.has(bitmapHandle),
        false,
        'borrowed result keeps no owner alive',
      );
      assert.deepEqual(
        [...(await drawPixels(fresh, surfaceID))],
        pixels,
        'cold bitmap is isolated from old owner release',
      );
      await assert.rejects(
        () => drawQueryCall(world, target),
        /Draw bitmap query.*initialized/,
        'a released owner cannot return a fabricated bitmap word',
      );
      await assert.rejects(
        () => drawQueryCall(fresh, 0),
        /Draw bitmap query.*initialized/,
        'zero target is dispatched, not silently skipped or converted to a result',
      );
      await assert.rejects(
        () => drawQueryCall(fresh, 0x7f010501),
        /Draw bitmap query.*initialized/,
      );
      await drawQueryCall(fresh, 0, false);
      await drawQueryCall(fresh, 0x7f010501, false);
      assert.deepEqual(
        freshMessages
          .slice(-4)
          .map(([destination, , message, w, l, flags]) => [destination, message, w, l, flags]),
        [
          [0, 285, 0, 0, 0],
          [0x7f010501, 285, 0, 0, 0],
          [0, 290, 0, 0, 0],
          [0x7f010501, 290, 0, 0, 0],
        ],
        'zero and missing native targets are really dispatched with the original words',
      );
      for (const [, sender] of freshMessages) {
        assert.equal(fresh.objects.objects.get(sender).kind, 12);
        assert.notEqual(fresh.nativeTaskID(sender), sender);
      }
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
