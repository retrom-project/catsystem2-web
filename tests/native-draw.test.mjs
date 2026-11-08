// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { installNativeGraphics } from '../src/native/graphics.mjs';
import { nativeDraw } from '../src/native/draw-task.mjs';
import { floatBits } from '../src/kcs.mjs';

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
  const pixels = await world.graphics.surface(id).bitmap.pixels(),
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
    pixel = async () => [...(await world.graphics.surface(id).bitmap.pixels()).subarray(0, 4)];
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
  assert.deepEqual(
    [...(await world.graphics.surface(id).bitmap.pixels()).subarray(0, 4)],
    [171, 205, 239, 255],
  );
  assert.equal(world.graphics.vramHandle, 0);
});

test('rotated draw entries use the original fixed-point samples, alpha and destination clip', async () => {
  const world = fixture(),
    id = await surface(world),
    image = world.graphics.images.create(2, 3),
    input = world.graphics.images.get(image);
  const colors = [0xffff0000, 0x8000ff00, 0xff0000ff, 0x00ffffff, 0xc0804020, 0xff123456];
  for (let i = 0; i < colors.length; i++)
    await input.fill(i % 2, Math.floor(i / 2), 1, 1, colors[i]);
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
  const pixels = await world.graphics.surface(id).bitmap.pixels();
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
  const world = fixture(),
    id = await surface(world),
    draw = world.graphics.drawTasks.get(id);
  world.objects.register(34, () => ({
    message() {
      throw new Error('Unexpected test-owner message');
    },
  }));
  const owner = await world.objects.create({ kind: 34 }),
    record = world.objects.objects.get(owner);
  record.implementation.surface = id;
  const { FESInstance } = await import('../src/fes/instance.mjs'),
    { parseProgram } = await import('../src/fes/program.mjs');
  const player = {
    frameCount: 0,
    metadata: new Map(),
    picture: () => null,
    expand: (v) => v,
    unsupported: () => {},
    unresolvedTargets: new Set(),
  };
  player.root = new FESInstance(
    'authored',
    parseProgram(
      '#DEFINE\nPLANE panel\nCIMAGE red\n#OBJECT SIZE PRI DISP VRAM\npanel 8,6 5000 1 0,0\n#OBJECT SIZE COLOR DISP PL PRI\nred 2,2 4294901760 1 panel 10\n#START\n',
    ),
    player,
  );
  player.root.runtimeID = owner;
  player.root.byKey.get('panel').alpha = 128;
  world.graphics.bindFES(id, player);
  await world.graphics.syncFES(record, player);
  await draw.render();
  const plane = world.graphics.get(player.root.byKey.get('panel').nativeTaskID);
  assert.equal(plane.record.kind, 2);
  assert.equal(plane.record.parent, owner);
  assert.equal(plane.state.shown, true);
  assert.equal(plane.graph.vram, true);
  assert.equal(new DataView(plane.graph.kx2.buffer).getUint32(0x70, true) >>> 24, 128);
  assert.deepEqual(
    [...(await world.graphics.surface(id).bitmap.pixels()).subarray(0, 4)],
    [255, 0, 0, 255],
  );
  assert.equal(
    draw.state.renderer.items[0].key,
    (owner | (player.root.byKey.get('red').handle << 16)) >>> 0,
  );
  await world.graphics.closeFES(record, player);
  assert.equal(draw.state.renderer.items.length, 0);
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
  assert.deepEqual(
    [...(await world.graphics.surface(id).bitmap.pixels()).subarray(0, 4)],
    [18, 52, 86, 255],
  );
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

test('FES baseimg captures the selected plane VRAM region rather than its screen transform', async () => {
  const world = fixture(),
    id = await surface(world),
    draw = world.graphics.drawTasks.get(id);
  world.objects.register(34, () => ({
    message() {
      return 0;
    },
  }));
  const owner = await world.objects.create({ kind: 34 }),
    record = world.objects.objects.get(owner);
  record.implementation.surface = id;
  const { FESInstance } = await import('../src/fes/instance.mjs'),
    { FESPlayer } = await import('../src/fes/player.mjs'),
    { parseProgram } = await import('../src/fes/program.mjs');
  const player = new FESPlayer(world.game, {});
  player.root = new FESInstance(
    'capture',
    parseProgram(
      '#DEFINE\nPLANE panel\nCIMAGE color\n#OBJECT SIZE PRI DISP VRAM\npanel 2,2 5000 1 3,2\n#OBJECT SIZE COLOR DISP PL PRI\ncolor 2,2 4279312947 1 panel 10\n#START\nbaseimg panel\n#WAIT\n',
    ),
    player,
  );
  player.root.runtimeID = owner;
  const panel = player.root.byKey.get('panel');
  panel.x = 20;
  panel.y = 30;
  panel.rotation = 90;
  panel.scaleX = 2;
  panel.alpha = 100;
  world.graphics.bindFES(id, player);
  await world.graphics.syncFES(record, player);
  player.root.execute('baseimg panel');
  await player.flush();
  const captured = world.graphics.images.get(draw.state.baseImage);
  assert.deepEqual([captured.width, captured.height], [2, 2]);
  assert.deepEqual([...(await captured.pixels())], Array(4).fill([17, 34, 51, 255]).flat());
  await captured.fill(0, 0, 2, 2, 0xff0000ff);
  await world.graphics.images
    .get(player.root.byKey.get('color').nativeImageHandle)
    .fill(0, 0, 2, 2, 0xffff0000);
  assert.deepEqual([...(await captured.pixels()).subarray(0, 4)], [0, 0, 255, 255]);
  await draw.render();
  await world.graphics.fill(0, 0, 8, 6, 0);
  player.root.execute('force_redraw');
  assert.equal(player.root.forceRedrawPending, true);
  assert.deepEqual(
    [...(await world.graphics.images.get(world.graphics.vramHandle).pixels()).subarray(0, 4)],
    [0, 0, 0, 0],
  );
  // Native notification 337 flushes this request after synchronizing objects.
  await world.graphics.flushFESRedraw(player.root);
  assert.equal(player.root.forceRedrawPending, false);
  assert.deepEqual(
    [...(await world.graphics.images.get(world.graphics.vramHandle).pixels()).subarray(0, 4)],
    [0, 0, 255, 255],
  );
});
