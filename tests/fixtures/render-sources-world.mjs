// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../../src/kcs.mjs';
const call = (world, id, args) =>
  world.runtime.native('main', id, args, world.main.machine, world.main);
const drawWords = (source, x, alpha = 255, shown = 1) => [
  source,
  ...[x, 1, 0, 0, 0, 1, 1].map(floatBits),
  alpha,
  shown,
  0,
];
async function bindBitmap(world, bitmap, surface, index = 1) {
  await call(world, 0x101, [surface, index, ...drawWords(bitmap, 4)]);
}
export async function exerciseRenderSourcesWorld(make, layout, rgba, assert, inspectFrame) {
  const world = make(),
    { stride } = layout;
  assert.equal(rgba.length, 24);
  let fresh;
  try {
    await world.initialize('main.kcs');
    const m = world.main.machine,
      bitmap = m.load(4),
      block = m.allocate(stride * 3),
      source = 768;
    assert.equal(m.load(0), 1);
    assert.deepEqual(
      await world.graphics.images.get(bitmap).pixels(),
      Uint8ClampedArray.from({ length: 48 }, (_, i) => (i * 37 + 19) & 255),
    );
    m.writeString('sequence.hg3', 1024);
    m.bytes(block, stride * 3).fill(0xa5);
    assert.deepEqual(await call(world, 0x2bf, [1024, block, 2]), { control: 1, value: 1 });
    const animated = m.load(block + 4);
    assert.equal(m.load(block), 2);
    assert.equal(m.load(block + stride), 0);
    assert.ok(m.bytes(block + 8, stride - 8).every((b) => b === 0xa5));
    const metadata = [0, 0, 3, 2, 7, 8, 4, 2, 1];
    assert.deepEqual(await call(world, 0x2c2, [animated, source]), { control: 1, value: 1 });
    assert.deepEqual(
      metadata.map((_, i) => m.load(source + i * 4)),
      metadata,
    );
    const borrowed = (await call(world, 0x2c5, [animated, 0])).value;
    assert.equal((await call(world, 0x2c5, [animated, -1])).value, borrowed);
    assert.equal((await call(world, 0x2c5, [animated, 999])).value, 0);
    const alias = await world.spawnScript('alias.kcs');
    await world.runtime.scheduler.execute(alias);
    assert.equal(alias.machine.load(4100), 0);
    assert.equal(
      alias.machine.load(4100 + stride),
      0x42424242,
      'release rereads its live argv count',
    );
    const surface = await world.objects.create({ kind: 15, parent: world.main.id }),
      nativeSurface = world.nativeTaskID(surface),
      key = world.nativeTaskID(world.main.id),
      draw = world.graphics.drawTasks.get(surface);
    await call(world, 0x100, [nativeSurface, 8, 6]);
    await call(world, 0x104, [nativeSurface, 0, 0]);
    await call(world, 0x2c3, [nativeSurface, 0, ...drawWords(animated, 0)]);
    const retained = world.retainedDraw.record(draw, key);
    assert.equal(retained.source, animated);
    assert.equal(world.renderSources.get(animated).refs, 2);
    await call(world, 0x2c4, [nativeSurface, 0, ...drawWords(0xffffffff, 1)]);
    assert.equal(
      world.retainedDraw.record(draw, key).source,
      animated,
      'existing keys keep the same retained source',
    );
    await bindBitmap(world, borrowed, nativeSurface);
    await call(world, 0x370, [nativeSurface, 0, 63, 42]);
    await call(world, 0x154, [nativeSurface]);
    const pixels = (await world.graphics.images.get(draw.state.renderer.bitmap).pixels()).slice(),
      preview = inspectFrame ? await inspectFrame(world) : null;
    await call(world, 0x2c0, [block, 1]);
    assert.equal(world.renderSources.get(animated).refs, 1);
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    assert.equal(fresh.renderSources.get(animated).animation.registers[63], 42);
    assert.equal((await call(fresh, 0x2c5, [animated, 0])).value, borrowed);
    await call(fresh, 0x154, [nativeSurface]);
    assert.deepEqual(
      await fresh.graphics.images
        .get(fresh.graphics.drawTasks.get(surface).state.renderer.bitmap)
        .pixels(),
      pixels,
    );
    if (inspectFrame) assert.deepEqual(await inspectFrame(fresh), preview);
    await call(fresh, 0x370, [nativeSurface, 0, 63, 17]);
    assert.equal(world.renderSources.get(animated).animation.registers[63], 42);
    await call(fresh, 0x102, [nativeSurface, 0]);
    assert.throws(() => fresh.renderSources.get(animated), /released/);
    assert.throws(() => fresh.graphics.images.get(borrowed), /released/);
    assert.ok(
      fresh.graphics.drawTasks.get(surface).entry(key | (1 << 16)),
      'Draw owns its independent bitmap-data alias',
    );
    assert.ok(world.graphics.images.get(borrowed));
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
export async function exerciseRenderSourceResize(make, layout, assert, preview) {
  void layout;
  const world = make();
  let fresh;
  const run = async (owner, name, input) => {
    const task = await owner.spawnScript(name);
    task.machine.store(256, input);
    await owner.runtime.scheduler.execute(task);
    return task;
  };
  try {
    await world.initialize('main.kcs');
    const m = world.main.machine,
      original = m.load(4);
    await call(world, 0x7a, [original, 8, 6]);
    assert.deepEqual(
      [world.graphics.images.get(original).width, world.graphics.images.get(original).height],
      [8, 6],
    );
    m.writeString('raw-resize.hg3', 1024);
    await call(world, 0x2bf, [1024, 768, 1]);
    const source = m.load(772),
      script = await run(world, 'raw-resize.kcs', source),
      bitmap = script.machine.load(252),
      surface = await world.objects.create({ kind: 15, parent: world.main.id }),
      target = world.nativeTaskID(surface);
    assert.deepEqual(
      [world.graphics.images.get(bitmap).width, world.graphics.images.get(bitmap).height],
      [6, 4],
    );
    await call(world, 0x100, [target, 64, 48]);
    await call(world, 0x104, [target, 0, 0]);
    if (preview) await preview.show(world);
    const bind = async (owner) => {
        await bindBitmap(owner, bitmap, target);
        await call(owner, 0x154, [target]);
      },
      checkPixels = async (owner, width, height) => {
        const draw = owner.graphics.drawTasks.get(surface),
          actual = await owner.graphics.images.get(draw.state.renderer.bitmap).pixels(),
          expected = new Uint8ClampedArray(64 * 48 * 4),
          color = [49, 151, 211, 255],
          positions = [];
        for (let y = 1; y < 1 + height; y++)
          for (let x = 4; x < 4 + width; x++) {
            expected.set(color, ((47 - y) * 64 + x) * 4);
            positions.push(y * 64 + x);
          }
        assert.deepEqual(actual, expected);
        if (preview) {
          const pixels = await preview.pixels(owner),
            found = [];
          for (let i = 0; i < pixels.length; i += 4)
            if (color.every((v, j) => v === pixels[i + j])) found.push(i / 4);
          assert.deepEqual(found, positions);
        }
      };
    await bind(world);
    await checkPixels(world, 6, 4);
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    assert.equal(fresh.runtime.scheduler.tasks.get(script.id).machine.load(252), bitmap);
    await call(fresh, 0x102, [target, 1]);
    await run(fresh, 'raw-resize-again.kcs', bitmap);
    assert.deepEqual(
      [fresh.graphics.images.get(bitmap).width, fresh.graphics.images.get(bitmap).height],
      [12, 8],
    );
    assert.deepEqual(
      [world.graphics.images.get(bitmap).width, world.graphics.images.get(bitmap).height],
      [6, 4],
    );
    await bind(fresh);
    await checkPixels(fresh, 12, 8);
    await call(fresh, 0x2c0, [768, 1]);
    let rejected = false;
    try {
      await call(fresh, 0x7a, [bitmap, 3, 2]);
    } catch (error) {
      rejected = /released/.test(error.message);
    }
    assert.equal(rejected, true);
    const next = fresh.graphics.images.create(1, 1);
    assert.notEqual(next, bitmap, 'opaque IDs never reuse a released wrapper');
    await checkPixels(fresh, 12, 8);
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
export async function exerciseBitmapAlpha(make, assert) {
  const world = make();
  let fresh;
  const imageColor = async (owner, handle) => [
      ...(await owner.graphics.images.get(handle).pixels()).slice(0, 4),
    ],
    scale = async (owner, input, percentage) => {
      const task = await owner.spawnScript('bitmap-alpha.kcs', { parent: owner.main.id });
      try {
        task.machine.store(256, input);
        task.machine.store(260, percentage);
        await owner.runtime.scheduler.execute(task);
        assert.equal(task.status, 'finished');
        assert.deepEqual([task.machine.load(256), task.machine.load(260)], [input, percentage]);
      } finally {
        await owner.objects.release(task.id);
      }
    };
  try {
    await world.initialize('main.kcs');
    const bitmap = world.main.machine.load(4),
      before = await imageColor(world, bitmap);
    await scale(world, bitmap, 25);
    assert.deepEqual(await imageColor(world, bitmap), [...before.slice(0, 3), before[3] >>> 2]);
    const handle = (await call(world, 0x70, [3, 2])).value,
      alias = world.graphics.images.alias(handle, world.main.id);
    await world.graphics.images.get(handle).fill(0, 0, 3, 2, 0x89123456);
    await call(world, 0x17a, [handle, 0]);
    await scale(world, alias, 50);
    assert.deepEqual(await imageColor(world, handle), [18, 52, 86, 68]);
    assert.deepEqual(await call(world, 0x179, [alias]), { control: 1, value: 0 });
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    await scale(fresh, alias, 200);
    await scale(fresh, bitmap, 200);
    assert.deepEqual(await imageColor(fresh, handle), [18, 52, 86, 136]);
    assert.deepEqual(await imageColor(world, handle), [18, 52, 86, 68]);
    await call(fresh, 0x2c0, [0, 1]);
    let rejected = false;
    try {
      await scale(fresh, bitmap, 50);
    } catch (error) {
      rejected = /released/.test(error.message);
    }
    assert.equal(rejected, true);
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
