// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { controlWorld, setupControl, controlLoad } from './fixtures/control-world.mjs';
import { controlTaskBehavior } from '../src/native/control-task-js.mjs';
import { installJSControlTasks } from '../src/native/control-task-js.mjs';

const originals = JSON.parse(
  await readFile(new URL('./fixtures/control-original-golden.json', import.meta.url)),
).map((record) => ({
  ...record,
  items: record.items.map((item) => {
    const { rgba, ...bitmap } = item.bitmap;
    return { ...item, bitmap: { ...bitmap, pixels: [...Buffer.from(rgba, 'base64')] } };
  }),
}));
const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
async function capture(world, { id, task, draw }) {
  const items = [];
  for (const item of draw.state.renderer.items.filter(
    (entry) => (entry.key & 65535) === world.nativeTaskID(id),
  )) {
    const bitmap = world.graphics.images.get(item.image);
    items.push({
      priority: item.key >>> 16,
      position: [...item.position],
      base: [...item.base],
      scale: [...item.scale],
      alpha: item.alpha,
      visible: item.visible,
      bitmap: {
        width: bitmap.width,
        height: bitmap.height,
        offsetX: bitmap.state.offsetX,
        offsetY: bitmap.state.offsetY,
        canvasWidth: bitmap.state.canvasWidth,
        canvasHeight: bitmap.state.canvasHeight,
        pixels: [...(await bitmap.pixels())],
      },
    });
  }
  const areas = Object.values(task.resource.areas).map((area) => {
    const region = world.inputFor(id).get(area);
    return { bounds: [...region.bounds], priority: region.priority };
  });
  const planes = task.resource.planes.map((id) => {
    const { state, graph } = world.objects.objects.get(id).implementation;
    return {
      shape: [graph.width, graph.height],
      shown: state.shown,
      renderPaused: state.renderPaused,
      pos: motionVector(graph.kx2, MOTION_ABI.pos),
      base: motionVector(graph.kx2, MOTION_ABI.base),
      scale: motionVector(graph.kx2, MOTION_ABI.scale),
      texturePos: motionVector(graph.textureTransform, MOTION_ABI.pos),
      alpha: new DataView(graph.kx2.buffer).getUint32(MOTION_ABI.color, true) >>> 24,
    };
  });
  return { items, areas, planes };
}
function expected(profile, kind, label, corpus = 'normal') {
  const fixture = originals.find(
    (entry) =>
      entry.corpus === corpus &&
      entry.profile === profile &&
      entry.kind === kind &&
      entry.label === label,
  );
  assert.ok(fixture);
  const { items, areas, planes } = fixture;
  return { items, areas, planes };
}

for (const profile of profiles) {
  test(`${profile} kinds40/41/42 retain Base identity, unwritten outputs and unknown-message control`, async () => {
    const world = await controlWorld(profile);
    try {
      for (const kind of [40, 41, 42]) {
        const id = await world.objects.create({ kind, parent: world.main.id });
        assert.equal(await world.sendEngine(id, world.main.id, 13), 0);
        assert.equal(await world.sendEngine(id, world.main.id, 24, 0, -123), NATIVE_UNWRITTEN_WORD);
        assert.equal(await world.sendEngine(id, world.main.id, 23), -123 >>> 0);
        const context = {};
        assert.equal(
          await world.sendEngine(id, world.main.id, 999, 0, 0, context),
          NATIVE_UNWRITTEN_WORD,
        );
        assert.equal(context.nativeUnhandled, true);
        assert.equal(world.objects.children(world.objects.objects.get(id)).length, 0);
      }
      assert.ok(!world.nativeEngine);
    } finally {
      await world.close();
    }
  });

  for (const kind of [42, 41, 40])
    test(`${profile} kind${kind} real resource pixels, area priorities and planes match independent original normal output`, async () => {
      const world = await controlWorld(profile);
      try {
        const current = await setupControl(world, kind);
        assert.notEqual(current.id, world.nativeTaskID(current.id));
        assert.deepEqual(await capture(world, current), expected(profile, kind, 'normal'));
        await current.draw.render();
        const image = world.graphics.images.get(current.draw.state.renderer.bitmap);
        assert.ok((await image.pixels()).some((byte, index) => index % 4 !== 3 && byte));
        if (kind !== 40) {
          await world.sendEngine(
            current.id,
            world.main.id,
            kind === 41 ? 375 : 366,
            2,
            kind === 41 ? 0 : 1,
          );
          const thumb = current.task.resource.areas.thumb;
          const bounds = world.inputFor(current.id).get(thumb).bounds;
          world.inputFor(current.id).pointer(bounds[0] + 1, bounds[1] + 1, 1);
          await world.sendEngine(current.id, thumb, 64, world.nativeTaskID(thumb), 1);
          assert.deepEqual(await capture(world, current), expected(profile, kind, 'custom-hover'));
        }
        assert.ok(!world.nativeEngine);
      } finally {
        await world.close();
      }
    });

  for (const kind of [42, 41, 40])
    test(`${profile} kind${kind} distinct state pixels, unequal pieces and horizontal metadata match original output`, async () => {
      const world = await controlWorld(profile, { extra: true });
      try {
        const current = await setupControl(world, kind, { extra: true });
        assert.deepEqual(await capture(world, current), expected(profile, kind, 'normal', 'extra'));
        const input = world.inputFor(current.id);
        if (kind !== 40) {
          await world.sendEngine(
            current.id,
            world.main.id,
            kind === 41 ? 375 : 366,
            2,
            kind === 41 ? 0 : 1,
          );
          const thumb = current.task.resource.areas.thumb;
          const bounds = input.get(thumb).bounds;
          input.pointer(bounds[0] + 1, bounds[1] + 1, 1);
          await world.sendEngine(current.id, thumb, 64, world.nativeTaskID(thumb), 1);
          assert.deepEqual(
            await capture(world, current),
            expected(profile, kind, 'custom-hover', 'extra'),
          );
        } else {
          const decrement = current.task.resource.areas.decrement,
            thumb = current.task.resource.areas.thumb;
          await world.sendEngine(current.id, decrement, 64, world.nativeTaskID(decrement), 1);
          assert.deepEqual(
            await capture(world, current),
            expected(profile, kind, 'decrement-hover', 'extra'),
          );
          input.source = 2;
          const box = input.get(thumb).bounds;
          input.pointer(box[0] + 1, box[1] + 1, 1);
          await world.sendEngine(current.id, thumb, 9, world.nativeTaskID(thumb), 0);
          assert.deepEqual(
            await capture(world, current),
            expected(profile, kind, 'thumb-pressed', 'extra'),
          );
        }
      } finally {
        await world.close();
      }
    });

  test(`${profile} real Input captures slider drag and restores it into a World without image files`, async () => {
    const world = await controlWorld(profile);
    let fresh;
    try {
      const current = await setupControl(world, 42);
      const { id, task, parent, surface } = current;
      await world.sendEngine(id, world.main.id, 363, 1, 64);
      const input = world.inputFor(id),
        thumb = task.resource.areas.thumb;
      const box = input.get(thumb).bounds,
        x = (box[0] + box[2]) >> 1,
        y = (box[1] + box[3]) >> 1;
      input.pointer(x, y, 1);
      await world.tick();
      input.key(0, true, 2, 1);
      await world.tick();
      assert.equal(input.captures[0], thumb);
      assert.equal(task.model.state.dragging, true);
      assert.deepEqual(input.get(thumb).bounds, [0, 0, 0, 0]);
      const saved = structuredClone(world.snapshot());
      fresh = await controlWorld(profile, { initialize: false, resources: false });
      await fresh.restore(saved);
      for (const candidate of [world, fresh]) {
        candidate.inputFor(id).pointer(x + 20, y, 1);
        await candidate.tick();
        const active = candidate.objects.objects.get(id).implementation;
        assert.equal(active.model.state.value, 94);
        assert.equal(active.model.state.pixel, 60);
        candidate.inputFor(id).key(0, false, 2, 1);
        await candidate.tick();
        assert.equal(active.model.state.dragging, false);
        assert.equal(active.model.state.pixel, 60);
        const before = candidate.objects.objects
          .get(parent)
          .implementation.events()
          .filter((event) => event.message === 27);
        assert.deepEqual(
          before.map((event) => event.value),
          [64, 94],
        );
        assert.deepEqual(candidate.inputFor(id).get(thumb).bounds, [76, 12, 84, 20]);
        // This frame was not decoded before the checkpoint: the saved resource
        // bytes, rather than a file service, must supply the new skin.
        await candidate.sendEngine(id, candidate.main.id, 366, 2, 20);
        await candidate.sendEngine(id, thumb, 64, candidate.nativeTaskID(thumb), 1);
        await candidate.graphics.drawTasks.get(surface).render();
      }
      const first = await capture(world, current);
      const next = {
        id,
        task: fresh.objects.objects.get(id).implementation,
        draw: fresh.graphics.drawTasks.get(surface),
      };
      assert.deepEqual(await capture(fresh, next), first);
      assert.deepEqual(
        await fresh.graphics.images.get(next.draw.state.renderer.bitmap).pixels(),
        await world.graphics.images.get(current.draw.state.renderer.bitmap).pixels(),
      );
      assert.ok(!world.nativeEngine && !fresh.nativeEngine);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} SCROLL2 range recomposes pixels while retaining children, value and unsnapped pixel`, async () => {
    const world = await controlWorld(profile);
    try {
      const { id, task } = await setupControl(world, 41);
      const children = structuredClone(task.resource.areas);
      assert.equal(task.model.state.pixel, 18);
      const packet = new NativeGraphicsPacket([0, 100, 40]);
      await world.sendEngine(id, world.main.id, 370, 0, 0, { payload: packet });
      assert.deepEqual(task.resource.areas, children);
      assert.equal(task.model.state.value, 30);
      assert.equal(task.model.state.pixel, 18);
      assert.equal(task.model.state.thumbLength, 25);
      const bitmap = world.graphics.images.get(task.resource.current);
      assert.equal(bitmap.height, 25);
      assert.ok((await bitmap.pixels()).some((byte, index) => index % 4 !== 3 && byte));
      assert.deepEqual(task.resource.descriptorPosition, [104, 12]);
      assert.deepEqual(world.inputFor(id).get(children.thumb).bounds, [104, 30, 112, 55]);
    } finally {
      await world.close();
    }
  });

  test(`${profile} SCROLL2 real vertical drag preserves unsnapped38 then release37 across fresh World`, async () => {
    const world = await controlWorld(profile);
    let fresh;
    try {
      const current = await setupControl(world, 41);
      const { id, task, parent, surface } = current,
        thumb = task.resource.areas.thumb;
      const input = world.inputFor(id),
        bounds = input.get(thumb).bounds;
      const x = (bounds[0] + bounds[2]) >> 1,
        y = (bounds[1] + bounds[3]) >> 1;
      input.pointer(x, y, 1);
      await world.tick();
      input.key(0, true, 2, 1);
      await world.tick();
      assert.equal(task.model.state.dragging, true);
      fresh = await controlWorld(profile, { initialize: false, resources: false });
      await fresh.restore(structuredClone(world.snapshot()));
      for (const candidate of [world, fresh]) {
        candidate.inputFor(id).pointer(x, y + 20, 1);
        await candidate.tick();
        const active = candidate.objects.objects.get(id).implementation;
        assert.equal(active.model.state.pixel, 38);
        assert.equal(active.model.state.value, 63);
        candidate.inputFor(id).key(0, false, 2, 1);
        await candidate.tick();
        assert.equal(active.model.state.pixel, 37);
        assert.equal(active.model.state.value, 63);
        assert.deepEqual(candidate.inputFor(id).get(thumb).bounds, [104, 49, 112, 65]);
        assert.deepEqual(
          candidate.objects.objects
            .get(parent)
            .implementation.events()
            .filter((event) => event.message === 27)
            .map((event) => event.value),
          [63],
        );
        await candidate.graphics.drawTasks.get(surface).render();
      }
      assert.deepEqual(
        await capture(fresh, {
          id,
          task: fresh.objects.objects.get(id).implementation,
          draw: fresh.graphics.drawTasks.get(surface),
        }),
        await capture(world, current),
      );
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} SCROLL real held Input and independent timer survive fresh World without replay`, async () => {
    const world = await controlWorld(profile);
    let fresh;
    try {
      const current = await setupControl(world, 40),
        { id, task, parent, surface } = current;
      const input = world.inputFor(id),
        arrow = task.resource.areas.increment,
        box = input.get(arrow).bounds;
      input.pointer((box[0] + box[2]) >> 1, (box[1] + box[3]) >> 1, 1);
      await world.tick();
      input.key(0, true, 2, 1);
      await world.tick();
      assert.equal(input.captures[0], arrow);
      assert.equal(task.model.state.value, 11);
      const before = world.objects.objects.get(parent).implementation.events().length;
      fresh = await controlWorld(profile, { initialize: false, resources: false });
      await fresh.restore(structuredClone(world.snapshot()));
      assert.equal(fresh.objects.objects.get(parent).implementation.events().length, before);
      for (const candidate of [world, fresh]) {
        for (let frame = 0; frame < 35; frame++) await candidate.tick();
        const active = candidate.objects.objects.get(id).implementation;
        assert.ok(active.model.state.value > 12);
        candidate.inputFor(id).key(0, false, 2, 1);
        await candidate.tick();
        assert.equal(active.model.state.repeatPart, null);
        await candidate.graphics.drawTasks.get(surface).render();
      }
      assert.deepEqual(
        fresh.objects.objects.get(id).implementation.model.snapshot(),
        task.model.snapshot(),
      );
      assert.deepEqual(
        fresh.objects.objects.get(parent).implementation.events(),
        world.objects.objects.get(parent).implementation.events(),
      );
      assert.deepEqual(
        await capture(fresh, {
          id,
          task: fresh.objects.objects.get(id).implementation,
          draw: fresh.graphics.drawTasks.get(surface),
        }),
        await capture(world, current),
      );
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} SCROLL held-arrow repeat uses real area routing and its own +30/+5 timer`, async () => {
    const world = await controlWorld(profile);
    try {
      const { id, task, parent } = await setupControl(world, 40);
      const input = world.inputFor(id),
        arrow = task.resource.areas.increment;
      const region = input.get(arrow);
      input.source = 2;
      input.pointer(region.bounds[0] + 1, region.bounds[1] + 1, 1);
      const start = task.record.effectiveFrame;
      await world.sendEngine(id, arrow, 9, world.nativeTaskID(arrow), 0);
      assert.equal(task.model.state.value, 11);
      assert.equal(task.model.state.nextRepeat, start + 30);
      // Direct task visits isolate the task's timer from Input's separate held
      // key repeat; the latter is covered through the actual Input drag above.
      task.record.lastFrame = start + 29;
      await task.tick(start + 29);
      assert.equal(task.model.state.value, 11);
      task.record.lastFrame = start + 30;
      await task.tick(start + 30);
      assert.equal(task.model.state.value, 12);
      task.record.lastFrame = start + 40;
      await task.tick(start + 40);
      assert.equal(task.model.state.value, 13);
      assert.equal(task.model.state.nextRepeat, start + 40);
      const events = world.objects.objects
        .get(parent)
        .implementation.events()
        .filter((event) => event.message === 27);
      assert.deepEqual(
        events.map((event) => event.value),
        [11, 12, 13],
      );
      await world.sendEngine(id, arrow, 10, world.nativeTaskID(arrow), 0);
      assert.equal(task.model.state.repeatPart, null);
    } finally {
      await world.close();
    }
  });

  test(`${profile} reload/close owns areas, planes, captures and retained resources`, async () => {
    const world = await controlWorld(profile);
    try {
      for (const kind of [42, 41, 40]) {
        const { id, task, surface, draw } = await setupControl(world, kind, {
          nativeID: 111 + kind,
        });
        const previous = [...Object.values(task.resource.areas), ...task.resource.planes];
        await world.sendEngine(
          id,
          world.main.id,
          kind === 40 ? 353 : kind === 41 ? 368 : 359,
          0,
          0,
          { payload: controlLoad(world, surface, kind) },
        );
        const after = [...Object.values(task.resource.areas), ...task.resource.planes];
        if (kind === 40) {
          assert.ok(after.every((id) => !previous.includes(id)));
          assert.ok(previous.every((id) => world.objects.objects.get(id).destroyRequested));
          assert.ok(previous.every((id) => !world.inputFor(task.record.id).get(id)));
          await world.tick();
          assert.ok(previous.every((id) => !world.objects.objects.has(id)));
        } else assert.deepEqual(after, previous);
        const owned = task.resource.frames
          .map(([, handle]) => handle)
          .concat(task.resource.composites);
        await world.objects.release(id);
        assert.ok(after.every((id) => !world.objects.objects.has(id)));
        assert.ok(after.every((id) => !world.input.get(id)));
        assert.ok(owned.every((handle) => !world.runtime.handles.records.has(handle)));
        assert.ok(!draw.state.renderer.items.some((entry) => (entry.key & 65535) === 111 + kind));
      }
      assert.ok(!world.nativeEngine);
    } finally {
      await world.close();
    }
  });
}

test('SCROLL mandatory metadata fails visibly and no skin policy is inferred from a profile prefix', async () => {
  const world = await controlWorld(profiles[0]);
  try {
    const surface = await world.objects.create({ kind: 15, parent: world.main.id });
    await world.sendEngine(surface, world.main.id, 279, 128, 96);
    await world.sendEngine(surface, world.main.id, 283, 0, 0);
    const id = await world.objects.create({ kind: 40, parent: world.main.id });
    await assert.rejects(
      world.sendEngine(id, world.main.id, 353, 0, 0, {
        payload: controlLoad(world, surface, 40, 'controls.hg2'),
      }),
      /mandatory frame1000/,
    );
    const task = world.objects.objects.get(id).implementation;
    assert.equal(task.model.state.loaded, false);
    assert.equal(world.objects.children(world.objects.objects.get(id)).length, 0);
    assert.equal(task.resource.frames.length, 0);
    assert.deepEqual(profiles.map(controlTaskBehavior), [
      { scroll2Skin: 'state-direct' },
      { scroll2Skin: 'state-direct' },
    ]);
    assert.throws(
      () => installJSControlTasks(world, { behavior: { scroll2Skin: 'unverified' } }),
      /verified SCROLL2/,
    );
  } finally {
    await world.close();
  }
});
