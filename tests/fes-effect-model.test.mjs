// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { floatBits } from '../src/kcs.mjs';
import {
  FESEffectModel,
  fesScreenEffectOptions,
  snapshotFESPlaneCounts,
  reconcileFESPlaneCounts,
  fesEffectClock,
} from '../src/native/fes-effect-model.mjs';
import {
  profiles,
  makeWorld,
  makeDraw,
  harness,
  messages,
  fillBitmap,
} from './fixtures/fes-effect-model-world.mjs';

const numbers = { evaluate: (text) => Number(text), text: String };

test('command defaults, signed duration and unsigned32-to-f32 ranges are explicit', () => {
  assert.deepEqual(fesScreenEffectOptions(31, [], numbers), {
    duration: 30,
    minimum: 0,
    maximum: 50000,
    mask: '',
    level: 16,
    flags: [0, 0],
  });
  const parsed = fesScreenEffectOptions(32, ['-3', '-1', '-2', '7', '-1', '-2147483647'], numbers);
  assert.equal(parsed.duration, 1);
  assert.equal(parsed.minimum, 4294967296);
  assert.equal(parsed.maximum, 2147483648);
  assert.equal(parsed.level, 0xffffffff);
  assert.deepEqual(parsed.flags, [0xfffffffe, 7]);
  assert.equal(fesScreenEffectOptions(27, ['5', 'mask', '7', '9'], numbers).mask, 'mask');
  assert.equal(fesEffectClock({ effectiveFrame: 40, pausedFrames: 7 }), 33);
  assert.throws(() => fesScreenEffectOptions(29, [], numbers), /outside this model/);
});

test('plane counts use live identities, a signed one-step delta, and retain unresolved deltas', () => {
  const plane = { nativeType: 4, currentCount: 2, beforeCount: -1 };
  const other = { nativeType: 3, currentCount: 77, beforeCount: 88 };
  const objects = [
    plane,
    other,
    { nativeType: 1, displayDelta: -17 },
    { nativeType: 2, displayDelta: 9 },
    { nativeType: 6, displayDelta: -8 },
    { nativeType: 13, displayDelta: 1 },
  ];
  snapshotFESPlaneCounts(objects);
  assert.equal(plane.beforeCount, 2);
  assert.equal(other.beforeCount, 88);
  reconcileFESPlaneCounts(objects, (o) => (o.nativeType === 6 ? null : plane));
  assert.equal(plane.currentCount, 2);
  assert.equal(objects[4].displayDelta, -8);
  assert.equal(objects[5].displayDelta, 1);
  plane.currentCount = 0;
  reconcileFESPlaneCounts(objects, () => plane);
  assert.equal(plane.currentCount, -1, 'count is not clamped');
  assert.equal(objects[4].displayDelta, 0);
  plane.currentCount = 2147483647;
  reconcileFESPlaneCounts([{ nativeType: 1, displayDelta: 1 }], () => plane);
  assert.equal(plane.currentCount, -2147483648, 'the retained count is a wrapping word');
});

for (const profile of profiles) {
  test(`${profile} generated-name guards span the FES collection; commands queue dummy without allocating tasks`, async () => {
    const world = await makeWorld(profile);
    try {
      const h = harness(world),
        plane = { nativeType: 4, identity: 'plane', index: 0 };
      h.identities.set('collision', { nativeType: 2, name: '__rdrawobj__' });
      assert.deepEqual(await h.model.screenCommand('rdraw', [], { top: 'top', ...numbers }), {
        created: false,
      });
      assert.deepEqual(await h.model.areaCommand('draw', { ...plane, index: -1 }, [], numbers), {
        created: false,
      });
      const draw = await h.model.areaCommand('draw', plane, ['-8'], numbers);
      assert.equal(draw.effect.duration, 1);
      assert.deepEqual(
        await h.model.areaCommand('draw', { ...plane, identity: 'different' }, [], numbers),
        { created: false },
      );
      const wipe = await h.model.areaCommand('wipe', plane, ['-8', 'mask'], numbers);
      assert.equal(wipe.effect.duration, -8);
      assert.deepEqual(
        h.events.filter((e) => e[0] === 'dummy').map((e) => e[2]),
        [
          { category: 'mot', name: 'dummy', registers: [] },
          { category: 'mot', name: 'dummy', registers: [] },
        ],
      );
      assert.deepEqual(h.events.find((e) => e[0] === 'wipeRecord')[2], [13, 1, 0, 0, 0]);
      assert.equal(h.events.filter((e) => e[0] === 'task').length, 0);
    } finally {
      await world.close();
    }
  });

  for (const [label, type, before, after, taskKind, init, crop] of [
    ['draw', 7, 1, 1, 27, 275, [2, 1, 3, 2]],
    ['incoming', 8, 0, 2, 28, 276, null],
    ['outgoing', 8, -4, 0, 28, 276, [0, 0, 3, 2]],
    ['cross', 8, -4, 3, 26, 274, [3, 2, 3, 2]],
  ]) {
    test(`${profile} ${label} allocates exact nonzero-origin D6 packet and restores owned resources`, async () => {
      const world = await makeWorld(profile);
      let fresh;
      try {
        const drawId = await makeDraw(world),
          bitmap = world.graphics.drawTasks.get(drawId).state.renderer.bitmap;
        const original = world.graphics.images.get(bitmap),
          authored = await original.pixels();
        for (let y = 0; y < original.height; y++)
          for (let x = 0; x < original.width; x++)
            authored.set([120 + x * 4, y * 8, 0, 255], (y * original.width + x) * 4);
        await original.changed();
        const mask = world.graphics.images.create(3, 2, world.main.id);
        await fillBitmap(world, mask, [0, 0, 128, 255]);
        const plane = {
          nativeType: 4,
          vram: [2.75, 1.5],
          size: [3, 2],
          beforeCount: before,
          currentCount: after,
        };
        const planes = new Map([['plane', plane]]),
          h = harness(world, { drawId, mask, planes });
        const e = h.model.declare({
          identity: 'authored',
          name: label,
          type,
          parent: 'plane',
          duration: 4,
          mask: 'mask',
        });
        await h.model.allocate(e);
        assert.equal(e.taskKind, taskKind);
        assert.equal(e.remaining, 2);
        assert.equal(
          messages(h.events).filter((event) => event[1] === init).length,
          0,
          'area has no eager init',
        );
        assert.equal(world.graphics.drawTasks.get(drawId).state.enabled, false);
        assert.deepEqual(h.events.find((event) => event[0] === 'snapshot')?.slice(1) ?? null, crop);
        const old = type === 7 ? e.ownedBitmaps[0] : e.ownedBitmaps[1];
        const stencil = type === 8 ? e.ownedBitmaps[0] : 0;
        const expected =
          type === 7
            ? [4, old, 0, 0, bitmap, 2, 1, 3, 2, 3, 2]
            : label === 'incoming'
              ? [4, bitmap, 2, 1, stencil, 3, 2, 3, 2, 1, 0, 0]
              : label === 'outgoing'
                ? [4, old, 0, 0, stencil, 3, 2, 3, 2, 0, 0, 0]
                : [4, old, 0, 0, bitmap, 3, 2, stencil, 3, 2, 3, 2, 0, 0];
        assert.deepEqual([...e.packetWords], expected);
        await fillBitmap(world, bitmap, [0, 0, 240, 255]);
        if (old)
          assert.deepEqual(
            [...(await world.graphics.images.get(old).pixels()).subarray(0, 4)],
            [120 + crop[0] * 4, (original.height - crop[1] - crop[3]) * 8, 0, 255],
            'nonzero-origin copies select distinct authored pixels',
          );
        await h.model.visit(e, 1);
        assert.equal(e.remaining, 1);
        await h.model.visit(e, 1);
        const task = world.areaEffects.tasks.get(e.taskId);
        assert.equal(task.state.initialized, true);
        assert.deepEqual(task.state.output, [3, 2]);
        await h.model.visit(e, 1);
        assert.equal(task.state.active, 1);
        task.record.effectiveFrame = task.state.start + 2;
        await task.drawTick();
        if (type === 7) {
          const pixel = [
            ...(await world.graphics.images.get(task.state.work).pixels()).subarray(0, 4),
          ];
          assert.ok(
            pixel[0] > 0 && pixel[2] > 0,
            'real D6 work contains the intermediate red/blue blend',
          );
        }
        const modelState = h.model.snapshot(),
          saved = structuredClone(world.snapshot());
        fresh = await makeWorld(profile, false);
        await fresh.restore(saved);
        const re = harness(fresh, { drawId, mask, planes: structuredClone(planes) });
        re.model.restore(modelState);
        assert.equal(re.events.length, 0, 'restore does not create, initialize or capture');
        const restored = re.model.entries.get(e.identity),
          restoredTask = fresh.areaEffects.tasks.get(e.taskId);
        assert.equal(restored.taskId, e.taskId);
        task.record.effectiveFrame++;
        restoredTask.record.effectiveFrame++;
        await task.drawTick();
        await restoredTask.drawTick();
        assert.deepEqual(
          await fresh.graphics.images.get(restoredTask.state.work).pixels(),
          await world.graphics.images.get(task.state.work).pixels(),
        );
        const output = await world.graphics.images.get(world.graphics.vramHandle).pixels();
        assert.ok(
          output.some((value) => value !== 0),
          'D6 draw submits real output pixels',
        );
        assert.deepEqual(
          await fresh.graphics.images.get(fresh.graphics.vramHandle).pixels(),
          output,
        );
        h.state.busy = false;
        await h.model.visit(e, 3);
        assert.equal(task.state.active, 0, 'area idle uses force-finish258');
        await h.model.visit(e, 4);
        assert.equal(e.deleted, true);
        assert.equal(world.graphics.drawTasks.get(drawId).state.enabled, true);
        const owned = [...e.ownedBitmaps],
          pending = h.model.snapshot();
        assert.equal(
          pending.entries.length,
          1,
          'deleted identity retains a deferred cleanup record',
        );
        if (type === 7) {
          await fresh.close();
          fresh = await makeWorld(profile, false);
          await fresh.restore(structuredClone(world.snapshot()));
          const pendingModel = harness(fresh, { drawId, mask, planes: structuredClone(planes) });
          pendingModel.model.restore(pending);
          assert.equal(pendingModel.events.length, 0);
          await pendingModel.model.visit(pendingModel.model.entries.get(e.identity), 5);
          assert.equal(pendingModel.model.entries.size, 0);
          for (const handle of owned)
            assert.throws(() => fresh.graphics.images.get(handle), /released/);
          assert.ok(fresh.graphics.images.get(bitmap));
        }
        await h.model.visit(e, 5);
        assert.equal(h.model.entries.size, 0);
        assert.ok(messages(h.events).some((event) => event[1] === 3));
        for (const handle of owned)
          assert.throws(() => world.graphics.images.get(handle), /released/);
        assert.ok(world.graphics.images.get(bitmap), 'live Draw bitmap stays borrowed');
        assert.ok(world.graphics.images.get(mask), 'loader-owned original mask stays live');
      } finally {
        await fresh?.close();
        await world.close();
      }
    });
  }

  test(`${profile} RWMOS preserves two capture ranges, repeated init, raw flags and a fresh-World checkpoint`, async () => {
    const world = await makeWorld(profile);
    let fresh;
    try {
      // Existing renderer owns the shared target capacity; no FES-private copies.
      world.screenEffects.rendering.prepare(2);
      const h = harness(world);
      const { effect: e } = await h.model.screenCommand(
        'rwmos',
        ['8', '2', '-2147483647', '5', '15'],
        { top: 'top', ...numbers },
      );
      assert.deepEqual(
        h.events.filter((event) => event[0] === 'capture'),
        [['capture', 0, 5, 15]],
      );
      await h.model.allocate(e);
      const task = world.screenEffects.tasks.get(e.taskId);
      assert.equal(task.record.kind, 50);
      assert.deepEqual([...e.packetWords], [floatBits(5), floatBits(15), 8, 2, 0x80000001]);
      assert.deepEqual(
        [...world.stageRenderer.surfacePixels(task.state.work[0]).subarray(0, 4)],
        [160, 20, 40, 255],
      );
      await h.model.visit(e, 1); // -5 -> -4
      await h.model.visit(e, 1); // repeat516
      const inits = messages(h.events).filter((event) => event[1] === 516);
      assert.equal(inits.length, 2);
      assert.equal(inits[0][5], inits[1][5], 'repeat init reuses the same packet object');
      assert.equal(h.packets.length, 1);
      await h.model.visit(e, 1); // -3 -> -2; capture1 remains pending
      assert.equal(e.remaining, 2);
      const state = h.model.snapshot(),
        worldState = structuredClone(world.snapshot());
      fresh = await makeWorld(profile, false);
      await fresh.restore(worldState);
      const re = harness(fresh);
      re.model.restore(state);
      assert.equal(re.events.length, 0);
      const restored = re.model.entries.get(e.identity);
      h.state.color = re.state.color = [10, 180, 60, 255];
      for (const [model, effect] of [
        [h.model, e],
        [re.model, restored],
      ]) {
        await model.visit(effect, 2); // capture1 +517
        await model.visit(effect, 2); // -1 -> ready
        await model.visit(effect, 2); // start518(1)
      }
      assert.deepEqual(
        re.events.filter((event) => event[0] === 'capture'),
        [['capture', 1, 5, 15]],
      );
      const originalTask = world.screenEffects.tasks.get(e.taskId),
        restoredTask = fresh.screenEffects.tasks.get(e.taskId);
      assert.deepEqual(originalTask.state.params, restoredTask.state.params);
      assert.deepEqual(
        [...world.stageRenderer.surfacePixels(originalTask.state.work[1]).subarray(0, 4)],
        [10, 180, 60, 255],
      );
      assert.deepEqual(
        fresh.stageRenderer.surfacePixels(restoredTask.state.work[1]),
        world.stageRenderer.surfacePixels(originalTask.state.work[1]),
      );
      originalTask.record.effectiveFrame = originalTask.state.end + 20;
      assert.equal(
        originalTask.state.active,
        1,
        'a headless clock alone does not finish a screen effect',
      );
      await originalTask.render();
      assert.equal(originalTask.state.active, 0, 'real D6 render submission finishes it');
      await h.model.visit(e, 30);
      await h.model.visit(e, 31);
      assert.equal(h.model.entries.size, 0);
      assert.equal(
        world.screenEffects.tasks.has(e.taskId),
        true,
        'original mosaic normal cleanup does not send child3',
      );
      assert.equal(messages(h.events).filter((event) => event[1] === 3).length, 0);
      assert.equal(
        world.screenEffects.callback,
        e.taskId,
        'ordinary cleanup retains the original callback',
      );
      await world.objects.release(world.main.id);
      assert.equal(
        world.screenEffects.tasks.has(e.taskId),
        false,
        'existing World owner teardown releases its actual child',
      );
      assert.equal(world.screenEffects.callback, 0);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} RDRAW/RWIPE/RFMOS repeat initialization and use start(0) for motion idle`, async () => {
    const world = await makeWorld(profile);
    try {
      const mask = world.graphics.images.create(8, 6, world.main.id);
      await fillBitmap(world, mask, [0, 0, 127, 255]);
      for (const [verb, args, kind, init, start, clean] of [
        ['rdraw', ['6', '5', '15'], 38, 384, 385, true],
        ['rwipe', ['6', 'mask', '5', '15'], 39, 387, 388, true],
        ['rfmos', ['6', '2', '5', '-1', '5', '15'], 51, 519, 520, false],
      ]) {
        world.screenEffects.rendering.prepare(2);
        const h = harness(world, { mask });
        const { effect: e } = await h.model.screenCommand(verb, args, { top: 'top', ...numbers });
        await h.model.allocate(e);
        assert.equal(e.taskKind, kind);
        if (verb === 'rwipe')
          assert.equal(h.events.filter((event) => event[0] === 'capture').length, 2);
        if (verb === 'rfmos')
          assert.deepEqual([...e.packetWords], [floatBits(5), floatBits(15), 6, 2, 5, 0xffffffff]);
        await h.model.visit(e, 0);
        await h.model.visit(e, 0);
        assert.equal(messages(h.events).filter((event) => event[1] === init).length, 2);
        await h.model.visit(e, 0);
        await h.model.visit(e, 0);
        assert.equal(e.phase, 'ready');
        assert.equal(
          messages(h.events).filter((event) => event[1] === start && event[2] === 1).length,
          2,
          'clock-zero restart remains explicit',
        );
        await h.model.visit(e, 1);
        h.state.busy = false;
        await h.model.visit(e, 2);
        assert.ok(messages(h.events).some((event) => event[1] === start && event[2] === 0));
        assert.equal(messages(h.events).filter((event) => [386, 523].includes(event[1])).length, 0);
        h.model.markDeleted(e);
        await h.model.cleanup(e);
        assert.equal(messages(h.events).filter((event) => event[1] === 3).length, clean ? 1 : 0);
        if (!clean) assert.equal(world.screenEffects.callback, e.taskId);
      }
    } finally {
      await world.close();
    }
  });

  test(`${profile} declaration-only mosaic packets explicitly retain approved default ranges`, async () => {
    const world = await makeWorld(profile);
    try {
      for (const type of [31, 32]) {
        world.screenEffects.rendering.prepare(2);
        const h = harness(world);
        const e = h.model.declare({ identity: type, name: `declared${type}`, type });
        await h.model.allocate(e);
        assert.deepEqual(
          [...e.packetWords],
          [0, floatBits(50000), 30, 16, 0, ...(type === 32 ? [0] : [])],
        );
        assert.equal(h.events.filter((event) => event[0] === 'capture').length, 0);
        h.model.markDeleted(e);
        await h.model.cleanup(e);
      }
    } finally {
      await world.close();
    }
  });

  test(`${profile} DRAW and WIPE sleep258 happens after one driver visit; wake flushes without restart`, async () => {
    const world = await makeWorld(profile);
    try {
      const drawId = await makeDraw(world),
        mask = world.graphics.images.create(3, 2, world.main.id);
      await fillBitmap(world, mask, [0, 0, 127, 255]);
      const plane = {
        nativeType: 4,
        vram: [2, 1],
        size: [3, 2],
        beforeCount: 1,
        currentCount: 2,
        displayValue: 9,
        enabled: true,
        displayDelta: -3,
      };
      const h = harness(world, { drawId, mask, planes: new Map([['plane', plane]]) });
      for (const type of [7, 8]) {
        const e = h.model.declare({
          identity: type,
          name: String(type),
          type,
          parent: 'plane',
          duration: 4,
          mask: 'mask',
        });
        await h.model.allocate(e);
        await h.model.visit(e, 1);
        await h.model.visit(e, 1);
        await h.model.visit(e, 1);
      }
      const before = structuredClone(plane),
        at = h.events.length;
      await h.model.setSleeping(true, 2);
      const sleep = h.events.slice(at);
      assert.deepEqual(sleep[0], ['notify', '_FES_SLEEP_']);
      assert.equal(messages(sleep).filter((event) => event[1] === 259).length, 2);
      assert.equal(messages(sleep).filter((event) => event[1] === 258).length, 2);
      assert.deepEqual(sleep.at(-1), ['maskOutputs', true]);
      assert.deepEqual(plane, before);
      const count = h.events.length;
      for (const effect of h.model.entries.values()) await h.model.visit(effect, 40);
      assert.equal(h.events.length, count, 'ordinary FES visits are gated while asleep');
      await h.model.setSleeping(false, 41);
      assert.deepEqual(h.events.at(-2), ['maskOutputs', false]);
      assert.deepEqual(h.events.at(-1), ['flush']);
      assert.equal(messages(h.events.slice(count)).filter((event) => event[1] === 257).length, 0);
      assert.deepEqual(plane, before);
    } finally {
      await world.close();
    }
  });
}

test('failed parent/mask allocation stays visible and preserves FES identity; in-flight checkpoints reject', async () => {
  const events = [];
  const model = new FESEffectModel({
    plane: () => null,
    clearMotion: (effect) => events.push(['clear', effect.identity]),
  });
  const e = model.declare({ identity: 'bad', name: 'bad', type: 7 });
  await assert.rejects(model.allocate(e), /live PLANE/);
  assert.equal(e.deleted, false);
  assert.equal(e.phase, 'failed');
  assert.deepEqual(events, [['clear', 'bad']]);
  const missingMask = new FESEffectModel({
    plane: () => ({ nativeType: 4, vram: [0, 0], size: [2, 2] }),
    drawing: () => ({ taskId: 9, bitmap: 7, offset: [0, 0] }),
    loadMask: async () => 0,
    clearMotion: (effect) => events.push(['clear', effect.identity]),
  });
  const wipe = missingMask.declare({
    identity: 'missingMask',
    name: 'wipe',
    type: 8,
    parent: 'plane',
  });
  await assert.rejects(missingMask.allocate(wipe), /mask could not be loaded/);
  assert.equal(wipe.deleted, false);
  assert.equal(wipe.failure, 'the WIPE mask could not be loaded');
  let release;
  const waiting = new FESEffectModel({
    objectExists: () => false,
    createObject: async () => 'pending',
    hasView: () => true,
    prepareCaptures: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    capture: async () => {},
    addDummyMotion: async () => {},
  });
  const operation = waiting.screenCommand('rdraw', [], { top: 'top', ...numbers });
  await Promise.resolve();
  await Promise.resolve();
  assert.throws(() => waiting.snapshot(), /settled/);
  release();
  await operation;
  assert.equal(waiting.snapshot().entries.length, 1);
});
