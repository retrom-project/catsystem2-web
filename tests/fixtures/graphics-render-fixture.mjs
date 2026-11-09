// SPDX-License-Identifier: MPL-2.0
import { createTextureMemoryWorld } from './texture-clear-fixture.mjs';
import { floatBits, bitsFloat } from '../../src/kcs.mjs';

const packet = (words = []) => {
  const bytes = new Uint8Array(128).fill(0xa5),
    view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setUint32(i * 4, word, true));
  return {
    bytes: (address, length) => bytes.subarray(address, address + length),
    write: (address, source) => bytes.set(source, address),
    load: (address) => view.getUint32(address, true),
  };
};
const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const colors = (pixels, color) => {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) if (equal(pixels.subarray(i, i + 3), color)) count++;
  return count;
};

export async function exerciseGraphRendering(profile, files, stageRendererFactory) {
  const make = () => {
      const world = createTextureMemoryWorld(profile, files, stageRendererFactory);
      world.configuration.fields.texture.areas[0].set([0, 0, 2, 2]);
      return world;
    },
    world = make(),
    checks = {},
    sdk = profile.startsWith('sdk-'),
    raw = sdk
      ? { render: 0x54cff0, changed: 0x555000, descriptor: 0x5531b0, graphs: 0x5527c0 }
      : { render: 0x675ee0, changed: 0x67e370, descriptor: 0x67c510, graphs: 0x67bb20 },
    render = async (owner) => {
      await owner.stageRenderer.render(owner.graphics.stage, null, owner.particles.drawItems());
      return owner.stageRenderer.renderer.ctx.getImageData(0, 0, 16, 16).data;
    },
    send = (task, message, w = 0, l = 0, payload = undefined) =>
      task.world.sendEngine(task.record.id, task.record.id, message, w, l, { payload }),
    shape = async (task, color, position = [2, 3, 0], priority = 100) => {
      await send(task, 42, 0, 0, packet([0, 0, 0, floatBits(4), floatBits(3), 0, 0, color]));
      await send(task, 49, 0, 0, packet([0, 0, priority].map(floatBits)));
      await send(task, 51, 0, 0, packet(position.map(floatBits)));
      await send(task, 48, 0, 1);
    },
    modelVector = async (task, message) => {
      const output = packet();
      await send(task, message, 0, 0, output);
      return [0, 4, 8].map((at) => bitsFloat(output.load(at)));
    },
    inheritPosition = (task, message, position) =>
      send(task, message, 0, 0, packet(position.map(floatBits)));
  let fresh;
  try {
    await world.initialize('main.kcs');
    const tops = [],
      tasks = [];
    for (let i = 0; i < 2; i++) {
      const top = await world.objects.create({
          kind: 1,
          parent: null,
          nativeID: 0,
          name: 'Top' + i,
        }),
        id = await world.objects.create({ kind: 2, parent: top, name: 'Original plane' + i });
      tops.push(top);
      tasks.push(world.graphics.get(id));
    }
    const platform = await world.getNativeFeature('graphics-platform'),
      engine = world.nativeEngine,
      p = engine.process,
      renderer = await world.getNativeFeature('renderer'),
      nativeID = tasks[0].record.nativeID,
      descriptor = () => engine.call(raw.descriptor, [nativeID], platform.refs.manager);
    checks.scopedTasks =
      tasks[0].record.id !== tasks[1].record.id &&
      tasks[0].record.nativeID === tasks[1].record.nativeID;
    checks.sharedView = tasks.every((task) => p.load(task.pointer + 104) === platform.refs.view);
    await shape(tasks[0], 0xffe02040);
    checks.queryBeforeCreate = equal(await modelVector(tasks[1], 61), [0, 0, 100]);
    // No host graph renderer has been attached yet. This is the full original
    // view -> GraphManager -> D3D -> Present chain, not a JS geometry oracle.
    const gpu = world.getNativeGPU(),
      previousPresent = renderer.d3d.onPresent;
    gpu.beginFrame(0xff000000, { preserve: true });
    renderer.d3d.onPresent = (request) => world.stageRenderer.presentNative(request);
    try {
      platform.sync();
      await engine.call(raw.changed, [0], platform.refs.manager);
      await engine.call(raw.render, [], platform.refs.view);
    } finally {
      renderer.d3d.onPresent = previousPresent;
      gpu.endNativeFrame();
    }
    const original = world.stageRenderer.renderer.ctx.getImageData(0, 0, 16, 16).data;
    checks.originalVisible = colors(original, [224, 32, 64]) === 12;
    checks.stage = equal(await render(world), original);
    checks.noHostModel = tasks.every((task) => task.graph === null);
    await shape(tasks[1], 0xff40e020, [2, 3, 0], 200);
    checks.alias = equal(await modelVector(tasks[0], 61), [0, 0, 200]);
    const green = await render(world);
    checks.replaced = colors(green, [64, 224, 32]) === 12 && colors(green, [224, 32, 64]) === 0;

    await world.objects.create({ kind: 0, parent: tops[1], name: 'Reserve local ID' });
    const texturedID = await world.objects.create({
        kind: 2,
        parent: tops[1],
        name: 'Original texture',
      }),
      textured = world.graphics.get(texturedID),
      image = world.graphics.images.get(world.graphics.images.create(8, 4)),
      pixels = await image.pixels();
    tasks.push(textured);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 8; x++)
        pixels.set([37 + x * 17, 9 + y * 50, (x ^ y) * 21 + 3, 255], (y * 8 + x) * 4);
    await image.changed();
    await world.graphics.output(image, [60, 62]);
    await send(textured, 41, 0, 0, packet([60, 62, 0, 8, 4, 0, 0, 0].map(floatBits)));
    await send(textured, 49, 0, 0, packet([60, 62, 250].map(floatBits)));
    await send(textured, 51, 0, 0, packet([2, 10, 0].map(floatBits)));
    await send(textured, 48, 0, 1);
    const texturedPixels = await render(world);
    let difference = 0;
    for (let i = 0; i < green.length; i += 4)
      if (!equal(green.subarray(i, i + 3), texturedPixels.subarray(i, i + 3))) difference++;
    checks.texturedVisible = difference === 32;
    checks.texturedRows = equal(
      texturedPixels.subarray((10 * 16 + 2) * 4, (10 * 16 + 3) * 4),
      pixels.subarray(0, 4),
    );

    const particleID = await world.objects.create({
        kind: 16,
        parent: tops[0],
        name: 'Original PPI',
      }),
      particle = world.particles.get(particleID);
    await particle.load({ family: 'plugin', program: 'tie.ppi', count: 1, priority: 200 });
    await particle.message([nativeID, 0x13b, 0, 0]);
    const afterParticle = await render(world);
    checks.particleLast =
      colors(afterParticle, [64, 224, 32]) === 0 && colors(afterParticle, [0, 0, 255]) > 0;
    await shape(tasks[1], 0xff40e020, [2, 3, 0], 200);
    const afterNative = await render(world),
      pointer = await descriptor();
    checks.nativeLast =
      colors(afterNative, [64, 224, 32]) === 12 && colors(afterNative, [0, 0, 255]) > 0;
    checks.order = particle.bank.nativeRenderOrder < world.graphics.nativeRenderOrder.get(pointer);
    // Authored FVF68 input exercises the original background branch. Its
    // descriptor is restored before destruction; this is a borrowed buffer.
    const manager = platform.refs.manager,
      background = p.allocate(120, true),
      backgroundFields = [240, 516, 520, 524, 528, 540],
      savedBackground = backgroundFields.map((offset) => p.load(manager + offset)),
      backgroundColor = [51, 17, 102],
      vertices = [
        [0, 0],
        [16, 0],
        [16, 16],
        [0, 0],
        [0, 16],
        [16, 16],
      ];
    vertices.forEach(([x, y], i) => {
      [
        floatBits(x - 0.5),
        floatBits(y - 0.5),
        floatBits(10000 / 65000),
        floatBits(1),
        0xff331166,
      ].forEach((word, j) => p.store(background + i * 20 + j * 4, word));
    });
    [1, 0, 0, 1, background, 0].forEach((value, i) =>
      p.store(manager + backgroundFields[i], value),
    );
    try {
      particle.bank.priority = 55000;
      checks.finalBackground = colors(await render(world), backgroundColor) === 256;
      particle.bank.priority = 55001;
      const afterFinalBackground = await render(world);
      checks.afterFinalBackground =
        colors(afterFinalBackground, [0, 0, 255]) > 0 &&
        colors(afterFinalBackground, [0, 0, 255]) +
          colors(afterFinalBackground, backgroundColor) ===
          256;
      await send(tasks[1], 49, 0, 0, packet([0, 0, 56000].map(floatBits)));
      particle.bank.priority = 55000;
      const between = await render(world);
      checks.backgroundBeforeNative =
        colors(between, backgroundColor) === 244 && colors(between, [64, 224, 32]) === 12;
      particle.bank.priority = 55001;
      const above = await render(world);
      checks.callbackAfterBackground =
        colors(above, [0, 0, 255]) > 0 &&
        colors(above, [64, 224, 32]) === 12 &&
        colors(above, [0, 0, 255]) +
          colors(above, backgroundColor) +
          colors(above, [64, 224, 32]) ===
          256;
    } finally {
      backgroundFields.forEach((offset, i) => p.store(manager + offset, savedBackground[i]));
      p.free(background);
      particle.bank.priority = 200;
      await send(tasks[1], 49, 0, 0, packet([0, 0, 200].map(floatBits)));
    }
    const finalPixels = await render(world);
    const host = world.particles.host,
      drawBank = host.drawBank;
    let nested = false,
      calls = 0;
    host.drawBank = async function (key, target) {
      calls++;
      if (!nested) {
        nested = true;
        const output = p.allocate(8, true);
        try {
          await engine.callFromHost(raw.graphs, [output, floatBits(0), floatBits(210)], manager);
        } finally {
          p.free(output);
          nested = false;
        }
      }
      return drawBank.call(this, key, target);
    };
    try {
      checks.nestedPixels = equal(await render(world), finalPixels);
      checks.nestedQueue = calls === 2;
    } finally {
      host.drawBank = drawBank;
    }
    const childID = await world.objects.create({
        kind: 2,
        parent: tasks[1].record.id,
        nativeID: 0x100,
        name: 'Attached child plane',
      }),
      child = world.graphics.get(childID);
    await shape(child, 0xffffff00);
    await inheritPosition(child, 53, [0, 0, 1]);
    await inheritPosition(tasks[1], 51, [7, 8, 0]);
    checks.inheritedPos = equal(await modelVector(child, 62), [7, 8, 0]);
    const inheritedPixels = await render(world);
    checks.inheritedPixels = colors(inheritedPixels, [255, 255, 0]) > 0;
    const saved = structuredClone(world.snapshot());
    fresh = make();
    await fresh.ensureNativeEngine();
    fresh.nativeEngine.process.trap('authored earlier transient render trap', 0, () => 0);
    await fresh.restore(saved);
    const restored = tasks.map((task) => fresh.graphics.get(task.record.id)),
      restoredChild = fresh.graphics.get(childID);
    checks.freshQuery = equal(await modelVector(restored[0], 61), [0, 0, 200]);
    const freshPlatform = await fresh.getNativeFeature('graphics-platform');
    checks.freshDescriptor =
      (await fresh.nativeEngine.call(raw.descriptor, [nativeID], freshPlatform.refs.manager)) ===
      pointer;
    checks.freshPixels = equal(await render(fresh), inheritedPixels);
    checks.freshOrder =
      fresh.particles.get(particleID).bank.nativeRenderOrder === particle.bank.nativeRenderOrder;
    await world.objects.destroy(tasks[0].record.id);
    checks.sharedDelete = (await descriptor()) === 0;
    checks.removedOrder = !world.graphics.nativeRenderOrder.has(pointer);
    const removed = await render(world);
    checks.deletedPixels = colors(removed, [64, 224, 32]) === 0 && colors(removed, [0, 0, 255]) > 0;
    checks.freshIsolated = equal(await render(fresh), inheritedPixels);
    await inheritPosition(restored[1], 51, [1, 9, 0]);
    checks.freshInheritedPos = equal(await modelVector(restoredChild, 62), [1, 9, 0]);
    const moved = await render(fresh);
    checks.freshInheritedPixels =
      !equal(moved, inheritedPixels) && colors(moved, [255, 255, 0]) > 0;

    const name = new TextEncoder().encode('Original custom plane\0');
    fresh.main.machine.bytes(128, name.length).set(name);
    const call = (id, args) =>
        fresh.runtime.native('main', id, args, fresh.main.machine, fresh.main),
      created = await call(0x42, [2, fresh.nativeTaskID(fresh.main.id), 128]),
      customNativeID = created.value,
      customID = fresh.resolveTaskID(customNativeID, fresh.main.id),
      custom = fresh.graphics.get(customID),
      sendCustom = (message, payload) =>
        fresh.sendEngine(customID, fresh.main.id, message, 0, 0, { payload }),
      freshEngine = fresh.nativeEngine,
      fp = freshEngine.process,
      getDescriptor = (id) => freshEngine.call(raw.descriptor, [id], freshPlatform.refs.manager);
    await call(0x50, [customNativeID]);
    const customDescriptor = await getDescriptor(customNativeID),
      customModel = customDescriptor && fp.load(customDescriptor + 8);
    checks.customPlane = Boolean(customModel) && fp.load(custom.pointer + 336) === 5;
    if (!sdk && customModel) {
      const callback = fp.load(fp.load(custom.pointer) + 24);
      const registered = await freshEngine.call(
        0x67e3d0,
        [customNativeID, 2, callback, custom.pointer, 0],
        undefined,
        { task: customID },
      );
      checks.customCallback =
        registered === 1 &&
        equal(
          [236, 240, 244, 248].map((at) => fp.load(customModel + at)),
          [2, callback, custom.pointer, 1],
        ) &&
        !freshEngine.features.get('m2').graphics.callbacks.has(customID);
    }
    await sendCustom(46, packet([0, 0, 0, floatBits(4), floatBits(3), 32, 1, 0xffffffff, 2, 1]));
    const tiles = fresh.objects.children(custom.record);
    checks.customTiles = fp.load(custom.pointer + 336) === 9 && tiles.length === 2;
    for (const [i, tile] of tiles.entries()) {
      const task = fresh.graphics.get(tile.id),
        tileDescriptor = await getDescriptor(tile.nativeID);
      checks['tile' + i] =
        Boolean(tileDescriptor && fp.load(tileDescriptor + 16)) &&
        fp.load(task.pointer + 12) === custom.pointer &&
        equal(
          [176, 180, 336].map((at) => fp.load(task.pointer + at)),
          [floatBits(4), floatBits(3), 1],
        );
    }
    const trailID = await fresh.objects.create({
        kind: 2,
        parent: fresh.main.id,
        nativeID: 0x305,
        name: 'Native trail',
      }),
      trail = fresh.graphics.get(trailID),
      auxiliary = [0x3050001, 0x3050002],
      configuration = packet([2, 1, 0, 0, 0, 0, 0, floatBits(2), 0, 0, 0, 0, 0]);
    await shape(trail, 0xff203050, [5, 5, 0], 800);
    await send(trail, 79, 1, 0, configuration);
    const history = fp.load(trail.pointer + 320);
    checks.trailModels =
      Boolean(history) && (await Promise.all(auxiliary.map(getDescriptor))).every(Boolean);
    await inheritPosition(trail, 51, [9, 6, 0]);
    await fresh.tick();
    checks.trailFrame =
      Boolean(history) &&
      fp.load(history + 28) === floatBits(9) &&
      fp.load(history + 128 + 28) === floatBits(7);
    await fresh.objects.destroy(trailID);
    await fresh.objects.release(trailID);
    checks.trailCleanup = !(await Promise.all(auxiliary.map(getDescriptor))).some(Boolean);
    return checks;
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
