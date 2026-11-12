// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  profiles,
  driverWorld,
  setup,
  defineControl,
  capture,
} from './fixtures/fes-control-driver-world.mjs';
import { FESControlDriver } from '../src/native/fes-control-driver.mjs';
import {
  setFESControlFile,
  setFESControlPage,
  setFESControlValue,
  setFESControlSkin,
} from '../src/native/fes-control-model.mjs';
import { fesMotionState, applyFESMotionState } from '../src/native/fes-motion-model.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';

const originals = JSON.parse(
  await readFile(new URL('./fixtures/control-original-golden.json', import.meta.url)),
).map((entry) => ({
  ...entry,
  items: entry.items.map(({ bitmap, ...item }) => {
    const { rgba, ...rest } = bitmap;
    return { ...item, bitmap: { ...rest, pixels: [...Buffer.from(rgba, 'base64')] } };
  }),
}));
const values = { 13: 10, 14: 30, 15: 25 };
async function loaded(world, type) {
  const h = await setup(world),
    object = await defineControl(h.api, type);
  setFESControlPage(object, 0, 100, 20);
  setFESControlValue(object, values[type]);
  await h.api.sync();
  return { ...h, object, task: world.objects.objects.get(object.nativeTaskID).implementation };
}
for (const profile of profiles) {
  for (const type of [13, 14, 15])
    test(`${profile} FES raw${type} loads actual kind${type + 27} and matches frozen original pixels/areas/planes`, async () => {
      const world = await driverWorld(profile);
      try {
        const h = await loaded(world, type),
          { object, task } = h,
          expected = originals.find(
            (e) =>
              e.profile === profile &&
              e.kind === type + 27 &&
              e.corpus === 'normal' &&
              e.label === 'normal',
          );
        assert.ok(expected);
        assert.deepEqual(await capture(world, task, h.draw), {
          items: expected.items,
          areas: expected.areas,
          // The saved low-task oracle stops before FES DISP1 ->354 ->plane47.
          // That real D6 message explicitly resumes each SimplePlane renderer.
          planes: expected.planes.map((plane) => ({ ...plane, renderPaused: false })),
        });
        assert.equal(task.record.parent, h.id);
        assert.equal(task.record.creator, h.id);
        assert.equal(object.nativeObjectPointer, undefined);
        assert.equal(world.nativeEngine, undefined);
        assert.equal(object.filePending, false);
        assert.equal(object.positionPending, false);
        assert.equal(object.pagePending, false);
        assert.equal(object.valuePending, false);
        const identities = Object.values(task.resource.areas),
          before = structuredClone(task.snapshot());
        await h.api.sync();
        assert.deepEqual(task.snapshot(), before);
        assert.deepEqual(Object.values(task.resource.areas), identities);
        await h.draw.render();
        assert.ok(
          (await world.graphics.images.get(h.draw.state.renderer.bitmap).pixels()).some(
            (b, i) => i % 4 !== 3 && b,
          ),
        );
      } finally {
        await world.close();
      }
    });

  test(`${profile} definition/factory creates no resource and live POS2 waits for FILE reload`, async () => {
    const world = await driverWorld(profile);
    try {
      const h = await setup(world),
        object = await defineControl(h.api, 15),
        count = world.objects.objects.size;
      assert.equal(object.nativeTaskID, undefined);
      assert.equal(h.api.cache.entries.size, 0);
      await h.api.sync();
      const task = h.api.controls.validate(h.api.instance, object),
        original = structuredClone(task.config),
        ids = Object.values(task.resource.areas);
      await h.api.definitions.row(['POS2'], 'control', ['area:8']);
      assert.equal(object.positionPending, true);
      await h.api.sync();
      assert.equal(object.positionPending, true);
      assert.deepEqual(task.config, original);
      setFESControlFile(object, object.file);
      await h.api.sync();
      assert.equal(object.positionPending, false);
      assert.deepEqual([...task.config.rect], [104, 12, 116, 76]);
      assert.deepEqual(Object.values(task.resource.areas), ids);
      assert.ok(world.objects.objects.size > count);
    } finally {
      await world.close();
    }
  });

  test(`${profile} control sleep masks actual input/render while retaining authored disp/enable and alpha-only MOT`, async () => {
    const world = await driverWorld(profile);
    try {
      const h = await setup(world),
        objects = [];
      for (const type of [13, 14, 15]) {
        const object = await defineControl(h.api, type, 'c' + type);
        setFESControlPage(object, 0, 100, 20);
        setFESControlValue(object, values[type]);
        objects.push(object);
      }
      await h.api.sync();
      for (const object of objects) {
        const bytes = fesMotionState(object).slice();
        assert.equal(bytes[MOTION_ABI.color + 3], 255);
        bytes[MOTION_ABI.color + 3] = 129;
        applyFESMotionState(h.api.instance, object, bytes);
      }
      await h.api.sync();
      h.api.player.nativeInput.state.sleeping = true;
      await h.api.sync();
      for (const object of objects) {
        const task = h.api.controls.validate(h.api.instance, object);
        assert.equal(object.disp, true);
        assert.equal(object.enable, true);
        assert.equal(task.model.state.shown, false);
        assert.equal(task.model.state.enabled, false);
        assert.equal(task.model.state.alpha, 129);
        assert.ok(
          Object.values(task.resource.areas).every((id) => !world.inputFor(id).get(id).enabled),
        );
      }
      h.api.player.nativeInput.state.sleeping = false;
      await h.api.sync();
      for (const object of objects) {
        const task = h.api.controls.validate(h.api.instance, object);
        assert.equal(task.model.state.shown, true);
        assert.equal(task.model.state.enabled, true);
        assert.equal(task.model.state.alpha, 129);
      }
    } finally {
      await world.close();
    }
  });

  test(`${profile} pending getters preserve per-family send and FES27 reentrancy timing`, async () => {
    const world = await driverWorld(profile);
    try {
      for (const type of [13, 14, 15]) {
        const h = await loaded(world, type),
          trace = [],
          send = h.api.controls.send.bind(h.api.controls);
        h.api.controls.send = (instance, object, ...args) => {
          trace.push(args[0]);
          return send(instance, object, ...args);
        };
        h.api.onEvent = (object, event) => {
          if (event === 'SCRL_P') setFESControlValue(object, 77, 0);
        };
        setFESControlPage(h.object, 0, 100, 20);
        setFESControlValue(h.object, 31, 1);
        if (type !== 13) {
          h.object.alpha = 91;
          h.object.alphaPending = true;
          setFESControlSkin(h.object, 2, 1);
        }
        h.object.dirty = true;
        await h.api.sync();
        const expected =
          type === 13
            ? [356, 357, 354, 355, 358]
            : type === 14
              ? [370, 371, 374, 369, 373, 375, 375, 375, 375, 376]
              : [362, 363, 365, 361, 360, 366, 366, 366, 366, 367];
        assert.deepEqual(trace, expected);
        assert.equal(h.object.value, 77);
        assert.equal(h.object.valueNotify, 0);
        assert.equal(h.object.valuePending, type === 13);
        assert.equal(h.object.pagePending, false);
        assert.equal(h.api.events.at(-1).value, 31);
        assert.equal(h.api.events.at(-1).scrollPosition, h.object.handle);
        assert.deepEqual(h.api.events.at(-1).mouse, h.api.player.mouse);
      }
    } finally {
      await world.close();
    }
  });

  test(`${profile} fresh World restores mid-drag owned tasks/input/pixels without loading or replay`, async () => {
    const first = await driverWorld(profile);
    let fresh;
    try {
      const h = await loaded(first, 15),
        thumb = h.task.resource.areas.thumb,
        input = first.inputFor(h.object.nativeTaskID),
        area = input.get(thumb);
      const x = (area.bounds[0] + area.bounds[2]) >> 1,
        y = (area.bounds[1] + area.bounds[3]) >> 1;
      input.pointer(x, y, 1);
      await first.tick();
      input.key(0, true, 2, 1);
      await first.tick();
      assert.equal(input.captures[0], thumb);
      assert.equal(h.task.model.state.dragging, true);
      const saved = structuredClone(first.snapshot()),
        frames = await capture(first, h.task, h.draw),
        events = structuredClone(h.api.events);
      fresh = await driverWorld(profile, { initialize: false, resources: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (/\.(?:hg2|hg3)$/.test(name)) throw new Error('restore reloaded control image');
        return read(name);
      };
      await fresh.restore(saved);
      const api = fresh.objects.objects.get(h.id).implementation,
        object = api.collection.lookup('control', 0),
        task = api.controls.validate(api.instance, object),
        draw = fresh.graphics.drawTasks.get(api.player.surface),
        snapshot = structuredClone(object),
        count = fresh.objects.objects.size;
      const send = fresh.sendEngine;
      fresh.sendEngine = () => {
        throw new Error('restore sent resource command');
      };
      api.cache.data = () => {
        throw new Error('restore performed metadata I/O');
      };
      api.controls.initialize = () => {
        throw new Error('restore initialized control');
      };
      await api.sync({ restoring: true });
      fresh.sendEngine = send;
      assert.deepEqual(structuredClone(object), snapshot);
      assert.equal(fresh.objects.objects.size, count);
      assert.deepEqual(api.events, events);
      assert.deepEqual(await capture(fresh, task, draw), frames);
      assert.equal(fresh.inputFor(object.nativeTaskID).captures[0], thumb);
      for (const candidate of [first, fresh]) {
        candidate.inputFor(object.nativeTaskID).pointer(x + 20, y, 1);
        await candidate.tick();
      }
      assert.equal(h.task.model.state.dragging, true);
      assert.deepEqual(task.model.snapshot(), h.task.model.snapshot());
      assert.deepEqual(api.events, h.api.events);
      assert.deepEqual(await capture(fresh, task, draw), await capture(first, h.task, h.draw));
      for (const candidate of [first, fresh]) {
        candidate.inputFor(object.nativeTaskID).key(0, false, 2, 1);
        await candidate.tick();
      }
      assert.equal(h.task.model.state.dragging, false);
      assert.equal(task.model.state.dragging, false);
      assert.deepEqual(task.model.snapshot(), h.task.model.snapshot());
      assert.deepEqual(api.events, h.api.events);
      const ids = [
          object.nativeTaskID,
          ...Object.values(task.resource.areas),
          ...task.resource.planes,
        ],
        freshInput = fresh.inputFor(h.id);
      await fresh.objects.release(h.id);
      assert.ok(ids.every((id) => !fresh.objects.objects.has(id)));
      assert.ok(Object.values(task.resource.areas).every((id) => !freshInput.get(id)));
    } finally {
      await fresh?.close();
      await first.close();
    }
  });
}

test('control resources require canonical services and actual task ownership; bare PL is not element0', async () => {
  const world = await driverWorld(profiles[1]);
  try {
    assert.throws(() => new FESControlDriver(world), /canonical cache/);
    const h = await setup(world),
      object = h.api.add(15, 'c')[0],
      planes = h.api.add(4, 'pl', 2);
    planes[0].vramX = 123;
    await h.api.definitions.row(['FILE', 'PL', 'POS2', 'DISP'], 'c', [
      'controls',
      'pl',
      'area:7',
      '1',
    ]);
    await h.api.sync();
    const task = h.api.controls.validate(h.api.instance, object);
    assert.equal(task.config.planeX, 0);
    assert.equal(object.planeReference.index, -1);
    object.nativeTaskID = world.main.id;
    assert.throws(
      () => h.api.controls.validate(h.api.instance, object),
      /actual owned JS World task/,
    );
    object.nativeTaskID = task.record.id;
    await assert.rejects(
      h.api.controls.message(world.objects.objects.get(h.id), h.api.player, [1, 999, 0, 0]),
      /canonical27 or28/,
    );
  } finally {
    await world.close();
  }
});

test('unallocated control checkpoint preserves pending fields without initialization or metadata I/O', async () => {
  const first = await driverWorld(profiles[1]);
  let fresh;
  try {
    const h = await setup(first);
    await defineControl(h.api, 15);
    const saved = structuredClone(first.snapshot());
    fresh = await driverWorld(profiles[1], { initialize: false, resources: false });
    await fresh.restore(saved);
    const api = fresh.objects.objects.get(h.id).implementation,
      before = structuredClone(api.instance.objects),
      count = fresh.objects.objects.size;
    api.controls.initialize = () => {
      throw new Error('unallocated restore initialized task');
    };
    api.cache.data = () => {
      throw new Error('unallocated restore read metadata');
    };
    await api.sync({ restoring: true });
    assert.deepEqual(structuredClone(api.instance.objects), before);
    assert.equal(fresh.objects.objects.size, count);
    assert.equal(api.collection.lookup('control', 0).nativeTaskID, undefined);
  } finally {
    await fresh?.close();
    await first.close();
  }
});

test('missing control FILE is a handled load failure; retry and semantic deletion own the real resources', async () => {
  const world = await driverWorld(profiles[1]);
  try {
    const h = await setup(world),
      object = h.api.add(13, 'missing')[0];
    setFESControlFile(object, 'missing-file');
    await h.api.sync();
    const task = h.api.controls.validate(h.api.instance, object);
    assert.equal(task.model.state.loaded, false);
    assert.equal(object.filePending, false);
    assert.equal(Object.keys(task.resource.areas).length, 0);
    setFESControlFile(object, 'scroll');
    await h.api.sync();
    assert.equal(task.model.state.loaded, true);
    assert.equal(Object.keys(task.resource.areas).length, 5);
    const ids = [
        object.nativeTaskID,
        ...Object.values(task.resource.areas),
        ...task.resource.planes,
      ],
      input = world.inputFor(h.id);
    await h.api.collection.remove(object);
    assert.equal(object.nativeTaskID, null);
    assert.equal(world.objects.objects.get(task.record.id).destroyRequested, true);
    await world.objects.tick(1);
    assert.ok(ids.every((id) => !world.objects.objects.has(id)));
    assert.ok(ids.slice(1).every((id) => !input.get(id)));
    assert.ok(
      h.draw.state.renderer.items.every((item) => (item.key & 65535) !== task.record.nativeID),
    );
  } finally {
    await world.close();
  }
});
