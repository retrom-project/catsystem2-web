// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profiles,
  effectWorld,
  setupEffects,
  fill,
  coloredGraph,
} from './fixtures/fes-effect-driver-world.mjs';
import { fesScreenEffectOptions } from '../src/native/fes-effect-model.mjs';
import { floatBits } from '../src/kcs.mjs';

const evaluate = Number;
for (const profile of profiles) {
  test(`${profile}: restore leaves pending effect declarations unallocated`, async () => {
    const world = await effectWorld(profile);
    let fresh;
    try {
      const { api, ownerID } = await setupEffects(world),
        object = api.add(30, 'pending');
      assert.equal(api.effects.state(object), null);
      fresh = await effectWorld(profile, { initialize: false });
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(ownerID).implementation,
        pending = restored.collection.lookup('pending', 0),
        count = fresh.objects.objects.size,
        random = fresh.random.snapshot();
      await restored.effects.update(pending, { restoring: true });
      assert.equal(restored.effects.state(pending), null);
      assert.equal(fresh.objects.objects.size, count);
      assert.deepEqual(fresh.random.snapshot(), random);
      await restored.effects.update(pending);
      assert.equal(fresh.objects.objects.size, count + 1);
      assert.equal(restored.effects.state(pending).taskKind, 52);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile}: WBREAK options and real two-initializer RNG/phase sequence`, async () => {
    const world = await effectWorld(profile);
    try {
      const h = await setupEffects(world),
        object = h.api.add(30, 'break'),
        effect = h.api.effects.initialize(object, {
          duration: 8,
          minimum: 0,
          maximum: 60000,
          shardSize: [4, 3],
          shardSpeed: [1, 5],
        });
      const messages = [],
        original = world.sendEngine.bind(world);
      world.sendEngine = async (target, sender, message, w, l, context) => {
        if ([521, 522, 523, 377, 3].includes(message))
          messages.push([message, l, context?.payload]);
        return original(target, sender, message, w, l, context);
      };
      const before = world.random.snapshot();
      await h.api.advance(1);
      assert.equal(effect.phase, 'waiting');
      assert.equal(effect.remaining, 1);
      assert.equal(effect.taskKind, 52);
      assert.equal(world.objects.objects.get(effect.taskId).parent, h.ownerID);
      const first = world.random.snapshot();
      assert.notDeepEqual(first, before);
      const packet = messages[0][2];
      assert.deepEqual(Array.from(effect.packetWords), [
        floatBits(0),
        floatBits(60000),
        8,
        4,
        3,
        floatBits(1),
        floatBits(5),
      ]);
      await h.api.advance(2);
      assert.equal(effect.phase, 'ready');
      assert.equal(messages[1][2], packet);
      assert.notDeepEqual(
        world.random.snapshot(),
        first,
        'the repeated521 consumes real shard RNG',
      );
      await h.api.advance(3);
      assert.equal(effect.phase, 'running');
      assert.deepEqual(
        messages.map((m) => [m[0], m[1]]),
        [
          [521, 0],
          [521, 0],
          [522, 1],
        ],
      );
      await h.api.advance(4);
      assert.deepEqual(
        messages.slice(-2).map((m) => [m[0], m[1]]),
        [
          [377, 0],
          [522, 0],
        ],
      );
      assert.ok(!messages.some((m) => m[0] === 523), 'MOT-idle uses522l0, not finish523');
      await h.api.advance(5);
      assert.equal(h.api.collection.lookup('break', 0), null);
      assert.equal(world.screenEffects.tasks.has(effect.taskId), false);
      assert.ok(messages.some((m) => m[0] === 3));
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: global WBREAK captures actual World graphs and installs actual dummy MOT`, async () => {
    const world = await effectWorld(profile);
    try {
      const h = await setupEffects(world);
      await coloredGraph(world, h.ownerID, 1, 0xffff0000);
      await coloredGraph(world, h.ownerID, 10, 0xff123456);
      await coloredGraph(world, h.ownerID, 20, 0xff0000ff);
      const result = await h.api.effects.screenCommand(
        'wbreak',
        ['4', '4', '3', '1', '5', '5', '15'],
        { top: h.top.handle, evaluate },
      );
      assert.equal(result.created, true);
      assert.equal(h.api.motion.busy(h.api.collection.graph.get(result.effect.identity)), true);
      const render = world.screenEffects.rendering;
      assert.equal(render.frame, null);
      assert.deepEqual(
        [...world.stageRenderer.surfacePixels(render.captures[0]).subarray(0, 4)],
        [18, 52, 86, 255],
      );
      assert.equal(
        (await h.api.effects.screenCommand('wbreak', [], { top: h.top.handle, evaluate })).created,
        false,
      );
      assert.equal(h.api.effects.model.entries.size, 1);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: area command honors its parsed reference index independently of scalar declaration`, async () => {
    const world = await effectWorld(profile);
    try {
      const h = await setupEffects(world),
        plane = h.api.collection.create(4, 'scalar', 1, {
          scalar: true,
          parent: h.top,
          enqueue: false,
        })[0];
      assert.equal(plane.index, null);
      let evaluated = false;
      const expressions = {
        evaluate: (value) => {
          evaluated = true;
          return Number(value);
        },
      };
      assert.throws(
        () => h.api.effects.areaCommand('draw', plane, [], expressions),
        /parsed int32 reference index/,
      );
      assert.equal(
        (
          await h.api.effects.areaCommand('draw', plane, ['4'], {
            ...expressions,
            referenceIndex: -1,
          })
        ).created,
        false,
      );
      assert.equal(evaluated, false);
      const result = await h.api.effects.areaCommand('draw', plane, ['4'], {
        ...expressions,
        referenceIndex: 0,
      });
      assert.equal(result.created, true);
      assert.equal(evaluated, true);
      assert.equal(result.effect.parent, plane.handle);
      assert.equal(h.api.motion.busy(h.api.collection.graph.get(result.effect.identity)), true);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: screen26/27/31/32 use live captures and independent task-owned masks`, async () => {
    for (const type of [26, 27, 31, 32]) {
      const world = await effectWorld(profile);
      try {
        const h = await setupEffects(world),
          object = h.api.add(type, 'screen'),
          effect = h.api.effects.initialize(object, { duration: 8, mask: 'mask.hg3', level: 2 });
        await h.api.advance(1);
        const task = world.screenEffects.tasks.get(effect.taskId);
        assert.equal(task.record.parent, h.ownerID);
        for (let frame = 2; frame <= (type === 31 ? 6 : 3); frame++) await h.api.advance(frame);
        assert.equal(effect.phase, 'running');
        assert.equal(task.state.active, 1);
        if (type === 27) {
          assert.equal(effect.ownedBitmaps.length, 1);
          assert.equal(world.graphics.images.get(effect.ownedBitmaps[0]).owner, h.ownerID);
          assert.ok(task.state.maskSource);
          assert.notEqual(task.state.maskSource, effect.ownedBitmaps[0]);
          assert.equal(
            world.graphics.images.get(task.state.maskSource).state,
            world.graphics.images.get(effect.ownedBitmaps[0]).state,
          );
        }
        await h.api.collection.remove(object);
        await h.api.effects.collectDeleted();
        assert.equal(world.screenEffects.tasks.has(effect.taskId), type === 31 || type === 32);
      } finally {
        await world.close();
      }
    }
  });

  test(`${profile}: DRAW/WIPE use real physical snapshots, Draw output gating and D6 completion`, async () => {
    for (const type of [7, 8]) {
      const world = await effectWorld(profile);
      try {
        const h = await setupEffects(world),
          plane = h.api.add(4, 'plane', {
            width: 4,
            height: 3,
            vramX: 0,
            vramY: 0,
            beforeCount: 0,
            currentCount: 1,
          }),
          object = h.api.add(type, 'area');
        h.api.collection.graph.bind(object, plane);
        const live = world.graphics.drawTasks.get(h.surface).state.renderer.bitmap;
        await fill(world, live, [33, 55, 77, 255]);
        const effect = h.api.effects.initialize(object, { duration: 4, mask: 'mask.hg3' });
        await h.api.advance(1);
        const task = world.areaEffects.tasks.get(effect.taskId);
        assert.equal(task.record.parent, h.ownerID);
        assert.equal(world.graphics.drawTasks.get(h.surface).state.enabled, false);
        if (type === 7) {
          const snapshot = world.graphics.images.get(effect.ownedBitmaps[0]);
          assert.equal(snapshot.width, 4);
          assert.equal(snapshot.height, 3);
          assert.deepEqual([...(await snapshot.pixels())].slice(0, 4), [33, 55, 77, 255]);
        }
        await h.api.advance(2);
        await h.api.advance(3);
        assert.equal(task.state.active, 1);
        await world.objects.drawTick(9);
        const output = await world.graphics.images.get(world.graphics.vramHandle).pixels();
        assert.ok(
          output.some(
            (v, i) => i % 4 === 0 && v === 33 && output[i + 1] === 55 && output[i + 2] === 77,
          ),
          'real D6 uploaded source color into VRAM',
        );
        await h.api.advance(10);
        assert.equal(h.api.collection.lookup('area', 0), null);
        assert.equal(world.graphics.drawTasks.get(h.surface).state.enabled, true);
        assert.equal(world.objects.objects.get(effect.taskId).destroyRequested, true);
        await h.api.advance(11);
        assert.equal(world.areaEffects.tasks.has(effect.taskId), false);
      } finally {
        await world.close();
      }
    }
  });

  test(`${profile}: all six existing families rebind fresh World resources without reinitialization`, async () => {
    for (const type of [7, 8, 26, 27, 31, 32]) {
      const first = await effectWorld(profile);
      let second;
      try {
        const h = await setupEffects(first),
          object = h.api.add(type, 'restore-family');
        if (type === 7 || type === 8) {
          const plane = h.api.add(4, 'parent-plane', {
            width: 4,
            height: 3,
            vramX: 0,
            vramY: 0,
            beforeCount: 0,
            currentCount: 1,
          });
          h.api.collection.graph.bind(object, plane);
        }
        const effect = h.api.effects.initialize(object, {
          duration: 8,
          mask: 'mask.hg3',
          level: 2,
        });
        await h.api.advance(1);
        const saved = structuredClone(first.snapshot()),
          original = structuredClone(effect);
        second = await effectWorld(profile, { initialize: false });
        second.game.require = async () => {
          throw new Error('family restore attempted resource I/O');
        };
        await second.restore(saved);
        const api = second.objects.objects.get(h.ownerID).implementation,
          restored = api.collection.lookup('restore-family', 0),
          state = api.effects.state(restored),
          count = second.objects.objects.size;
        const send = second.sendEngine.bind(second);
        second.sendEngine = () => {
          throw new Error('family restore sent a message');
        };
        await api.effects.update(restored, { restoring: true });
        second.sendEngine = send;
        assert.equal(second.objects.objects.size, count);
        assert.deepEqual(state, original);
        for (const id of state.ownedBitmaps)
          assert.deepEqual(
            await second.graphics.images.get(id).pixels(),
            await first.graphics.images.get(id).pixels(),
          );
        assert.equal(state.taskId, effect.taskId);
        assert.equal(second.objects.objects.get(state.taskId).parent, h.ownerID);
      } finally {
        await first.close();
        await second?.close();
      }
    }
  });

  test(`${profile}: WBREAK completion is driven by actual render while FES sleeps`, async () => {
    const world = await effectWorld(profile);
    try {
      const h = await setupEffects(world),
        object = h.api.add(30, 'render'),
        effect = h.api.effects.initialize(object, {
          duration: 4,
          shardSize: [4, 3],
          shardSpeed: [1, 5],
        });
      await h.api.motion.add(object, 'dummy');
      await h.api.advance(1);
      await h.api.advance(2);
      await h.api.advance(3);
      const task = world.screenEffects.tasks.get(effect.taskId);
      await h.api.effects.model.setSleeping(true, 3);
      assert.equal(task.state.active, 1);
      assert.equal(h.api.effects.model.sleeping, true);
      await world.objects.tick(5);
      await task.render();
      const middle = structuredClone(task.state.current);
      await world.objects.tick(8);
      await task.render();
      assert.equal(task.state.active, 0);
      assert.notDeepEqual(task.state.current, middle);
      assert.ok(h.api.collection.lookup('render', 0));
      await h.api.effects.model.setSleeping(false, 8);
      await h.api.effects.collectDeleted();
      assert.equal(h.api.collection.lookup('render', 0), null);
      assert.equal(world.screenEffects.tasks.has(effect.taskId), false);
      assert.deepEqual(
        h.api.events.filter((e) => e[0] === 'notify').map((e) => e[1]),
        ['_FES_SLEEP_', '_FES_WAKE_'],
      );
    } finally {
      await world.close();
    }
  });

  test(`${profile}: fresh World WBREAK restoration retains task/captures/RNG without521 or allocation`, async () => {
    const first = await effectWorld(profile);
    let second;
    try {
      const h = await setupEffects(first),
        object = h.api.add(30, 'restore'),
        effect = h.api.effects.initialize(object, {
          duration: 8,
          shardSize: [4, 3],
          shardSpeed: [1, 5],
        });
      await h.api.advance(1);
      await h.api.advance(2);
      await h.api.advance(3);
      const state = structuredClone(first.snapshot()),
        random = first.random.snapshot(),
        oldTask = first.screenEffects.tasks.get(effect.taskId),
        geometry = structuredClone(oldTask.state.geometry);
      second = await effectWorld(profile, { initialize: false });
      second.game.require = async () => {
        throw new Error('effect restore attempted resource I/O');
      };
      await second.restore(state);
      const api = second.objects.objects.get(h.ownerID).implementation,
        restored = api.collection.lookup('restore', 0),
        restoredEffect = api.effects.state(restored),
        task = second.screenEffects.tasks.get(restoredEffect.taskId),
        before = second.objects.objects.size;
      const send = second.sendEngine.bind(second);
      second.sendEngine = () => {
        throw new Error('restore sent a task message');
      };
      await api.effects.update(restored, { restoring: true });
      second.sendEngine = send;
      assert.equal(second.objects.objects.size, before);
      assert.equal(restoredEffect.taskId, effect.taskId);
      assert.deepEqual(task.state.geometry, geometry);
      assert.deepEqual(second.random.snapshot(), random);
      oldTask.record.effectiveFrame = task.record.effectiveFrame = 6;
      await oldTask.render();
      await task.render();
      assert.deepEqual(task.state.current, oldTask.state.current);
      assert.deepEqual(second.random.snapshot(), first.random.snapshot());
      assert.equal(second.nativeEngine, undefined);
    } finally {
      await first.close();
      await second?.close();
    }
  });
}

test('WBREAK signed evaluator words become uint32-to-f32 speed/range without widening dimensions', () => {
  assert.deepEqual(fesScreenEffectOptions(30, [], { evaluate }), {
    duration: 30,
    minimum: 0,
    maximum: 50000,
    mask: '',
    level: 16,
    flags: [0, 0],
    shardSize: [32, 32],
    shardSpeed: [300, 300],
  });
  const state = fesScreenEffectOptions(30, [0, -1, 0x80000000, -1, -2147483648, -1, -2147483648], {
    evaluate,
  });
  assert.equal(state.duration, 1);
  assert.deepEqual(state.shardSize, [0xffffffff, 0x80000000]);
  assert.deepEqual(state.shardSpeed, [Math.fround(0xffffffff), Math.fround(0x80000000)]);
  assert.equal(state.minimum, Math.fround(0xffffffff));
  assert.equal(state.maximum, Math.fround(0x80000000));
  const order = [];
  fesScreenEffectOptions(30, ['0', '1', '2', '3', '4', '5', '6'], {
    evaluate: (value) => {
      order.push(value);
      return Number(value);
    },
  });
  assert.deepEqual(order, ['0', '1', '2', '3', '4', '5', '6']);
});

test('missing World/semantic/motion services fail explicitly', async () => {
  const world = await effectWorld(profiles[0]);
  try {
    const h = await setupEffects(world),
      object = h.api.add(30, 'bad');
    h.api.effects.initialize(object);
    delete h.api.effects.hooks.addDummyMotion;
    await assert.rejects(
      h.api.effects.screenCommand('wbreak', [], { top: h.top.handle, evaluate }),
      /addDummyMotion is missing/,
    );
    await assert.rejects(h.api.effects.send(0x7fffffff, 522, 1), /World target .* is absent/);
    await assert.rejects(
      h.api.effects.send(h.surface, 521),
      /did not handle521|did not handle 521/,
    );
    assert.throws(() => h.api.effects.object(0x7fffffff), /semantic object .* is absent/);
  } finally {
    await world.close();
  }
});

test('area allocation clears real MOT on invalid parent; RGB24 mask conversion owns its bitmap', async () => {
  const world = await effectWorld(profiles[0]);
  try {
    const h = await setupEffects(world),
      object = h.api.add(7, 'invalid-parent');
    h.api.effects.initialize(object);
    await h.api.motion.add(object, 'dummy');
    assert.equal(h.api.motion.busy(object), true);
    await assert.rejects(h.api.effects.update(object), /live PLANE parent/);
    assert.equal(h.api.motion.busy(object), false);
    const load = h.api.cache.load.bind(h.api.cache);
    h.api.cache.load = async (...args) => {
      const id = await load(...args);
      world.graphics.images.get(id).state.bpp = 3;
      return id;
    };
    const id = await h.api.effects.mask('mask.hg3'),
      bitmap = world.graphics.images.get(id),
      pixels = await bitmap.pixels();
    assert.equal(bitmap.state.bpp, 4);
    assert.equal(bitmap.owner, h.ownerID);
    assert.ok(pixels.every((v, i) => i % 4 !== 3 || v === 255));
    assert.ok(pixels.some((v, i) => i % 4 !== 3 && v !== 0));
    await world.graphics.images.release(id);
  } finally {
    await world.close();
  }
});
