// SPDX-License-Identifier: MPL-2.0
import { createTextureMemoryWorld } from './texture-clear-fixture.mjs';
import { NativePlaneReceiver } from '../../src/native/graphics-task.mjs';
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
    shape = async (receiver, color, position = [2, 3, 0], priority = 100) => {
      const sender = receiver.task.record.nativeID;
      await receiver.message([sender, 42, 0, 0], {
        payload: packet([0, 0, 0, floatBits(4), floatBits(3), 0, 0, color]),
      });
      await receiver.message([sender, 49, 0, 0], {
        payload: packet([0, 0, priority].map(floatBits)),
      });
      await receiver.message([sender, 51, 0, 0], { payload: packet(position.map(floatBits)) });
      await receiver.message([sender, 48, 0, 1]);
    },
    base = async (receiver) => {
      const output = packet();
      await receiver.message([receiver.task.record.nativeID, 61, 0, 0], { payload: output });
      return [0, 4, 8].map((at) => bitsFloat(output.load(at)));
    };
  let fresh;
  try {
    await world.initialize('main.kcs');
    const tops = [],
      tasks = [],
      receivers = [];
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
      receivers.push(new NativePlaneReceiver(tasks[i]));
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
    await shape(receivers[0], 0xffe02040);
    checks.queryBeforeCreate = equal(await base(receivers[1]), [0, 0, 100]);
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
    await shape(receivers[1], 0xff40e020, [2, 3, 0], 200);
    checks.alias = equal(await base(receivers[0]), [0, 0, 200]);
    const green = await render(world);
    checks.replaced = colors(green, [64, 224, 32]) === 12 && colors(green, [224, 32, 64]) === 0;

    await world.objects.create({ kind: 0, parent: tops[1], name: 'Reserve local ID' });
    const texturedID = await world.objects.create({
        kind: 2,
        parent: tops[1],
        name: 'Original texture',
      }),
      textured = world.graphics.get(texturedID),
      textureReceiver = new NativePlaneReceiver(textured),
      image = world.graphics.images.get(world.graphics.images.create(8, 4)),
      pixels = await image.pixels();
    tasks.push(textured);
    receivers.push(textureReceiver);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 8; x++)
        pixels.set([37 + x * 17, 9 + y * 50, (x ^ y) * 21 + 3, 255], (y * 8 + x) * 4);
    await image.changed();
    await world.graphics.output(image, [60, 62]);
    await textureReceiver.message([nativeID, 41, 0, 0], {
      payload: packet([60, 62, 0, 8, 4, 0, 0, 0].map(floatBits)),
    });
    await textureReceiver.message([nativeID, 49, 0, 0], {
      payload: packet([60, 62, 250].map(floatBits)),
    });
    await textureReceiver.message([nativeID, 51, 0, 0], {
      payload: packet([2, 10, 0].map(floatBits)),
    });
    await textureReceiver.message([nativeID, 48, 0, 1]);
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
    await shape(receivers[1], 0xff40e020, [2, 3, 0], 200);
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
      await receivers[1].message([nativeID, 49, 0, 0], {
        payload: packet([0, 0, 56000].map(floatBits)),
      });
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
      await receivers[1].message([nativeID, 49, 0, 0], {
        payload: packet([0, 0, 200].map(floatBits)),
      });
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
    const saved = structuredClone(world.snapshot());
    fresh = make();
    await fresh.ensureNativeEngine();
    fresh.nativeEngine.process.trap('authored earlier transient render trap', 0, () => 0);
    await fresh.restore(saved);
    const restored = tasks.map(
      (task) => new NativePlaneReceiver(fresh.graphics.get(task.record.id)),
    );
    checks.freshQuery = equal(await base(restored[0]), [0, 0, 200]);
    const freshPlatform = await fresh.getNativeFeature('graphics-platform');
    checks.freshDescriptor =
      (await fresh.nativeEngine.call(raw.descriptor, [nativeID], freshPlatform.refs.manager)) ===
      pointer;
    checks.freshPixels = equal(await render(fresh), finalPixels);
    checks.freshOrder =
      fresh.particles.get(particleID).bank.nativeRenderOrder === particle.bank.nativeRenderOrder;
    await receivers[0].message([nativeID, 3, 0, 0]);
    checks.sharedDelete = (await descriptor()) === 0;
    checks.removedOrder = !world.graphics.nativeRenderOrder.has(pointer);
    const removed = await render(world);
    checks.deletedPixels = colors(removed, [64, 224, 32]) === 0 && colors(removed, [0, 0, 255]) > 0;
    checks.freshIsolated = equal(await render(fresh), finalPixels);
    return checks;
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
