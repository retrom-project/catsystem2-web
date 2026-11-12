// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, textWorld, setup, append } from './fixtures/fes-text-log-world.mjs';
import { initializeFESString } from '../src/native/fes-string-driver.mjs';
import { initializeFESLogObject } from '../src/native/fes-log-driver.mjs';
import { fesMotionState, applyFESMotionState } from '../src/native/fes-motion-model.mjs';
import { setFESGraphicalPosition } from '../src/native/fes-common-model.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';

for (const profile of profiles) {
  const types = profile.startsWith('sdk') ? [21, 29] : [21, 29, 37];
  test(`${profile}: pure definitions preserve approved POS/VRAM W and keep explicit BASE/MOT W`, async () => {
    const world = await textWorld(profile);
    try {
      const h = await setup(world);
      for (const type of types) {
        const object = h.api.add(type, 'text' + type)[0];
        assert.equal(object.positionW, 1);
        assert.equal(object.baseW, 1);
        assert.equal(object.vramW, 1);
        assert.equal(object.nativeTaskID, undefined);
        object.positionW = 7.25;
        object.baseW = 8.5;
        object.vramW = -9.75;
        object.vramZ = 99;
        await h.api.definitions.row(
          ['POS', 'VRAM', 'BASE', 'SIZE', 'PRI', 'DISP', 'COLOR', 'BLEND'],
          object.baseName,
          ['2,3', '4,5', '6,7,8', '24,16', '60000', '1', '1,2,3', '91'],
        );
        assert.deepEqual([object.x, object.y, object.z, object.positionW], [2, 3, 0, 7.25]);
        assert.deepEqual(
          [object.vramX, object.vramY, object.vramZ, object.vramW],
          [4, 5, 0, -9.75],
        );
        assert.deepEqual([object.baseX, object.baseY, object.baseZ, object.baseW], [6, 7, 8, 0]);
        assert.equal(object.pri, 60000);
        assert.equal(object.alpha, 91);
        assert.equal(object.nativeTaskID, undefined);
        const bytes = fesMotionState(object).slice(),
          view = new DataView(bytes.buffer);
        view.setFloat32(MOTION_ABI.pos, 11, true);
        applyFESMotionState(h.api.instance, object, bytes);
        assert.equal(object.positionW, 0);
        assert.equal(object.vramW, -9.75);
        object.positionW = 17;
        setFESGraphicalPosition(h.api.instance, object, [1, 2, 3]);
        assert.equal(object.positionW, 1);
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: fresh World preserves nondefault definition W without replay or resource allocation`, async () => {
    const first = await textWorld(profile);
    let fresh;
    try {
      const h = await setup(first);
      for (const type of types) {
        const object = h.api.add(type, 'w' + type)[0];
        object.positionW = 7.25;
        object.vramW = -9.75;
        object.vramZ = 99;
        await h.api.definitions.row(['POS', 'VRAM', 'BASE'], 'w' + type, ['2,3', '4,5', '6,7,8']);
      }
      const saved = structuredClone(first.snapshot());
      fresh = await textWorld(profile, { initialize: false });
      await fresh.restore(saved);
      const api = fresh.objects.objects.get(h.id).implementation,
        count = fresh.objects.objects.size,
        objects = structuredClone(api.instance.objects);
      api.strings.initialize = () => {
        throw new Error('restore called init');
      };
      api.strings.applyDefinition = () => {
        throw new Error('restore replayed definition');
      };
      api.cache.data = () => {
        throw new Error('restore loaded resource');
      };
      for (const object of api.instance.objects)
        await api.strings.update(api.instance, object, { restoring: true });
      assert.equal(fresh.objects.objects.size, count);
      assert.deepEqual(structuredClone(api.instance.objects), objects);
      for (const object of api.instance.objects) {
        assert.equal(object.positionW, 7.25);
        assert.equal(object.vramW, -9.75);
        assert.equal(object.vramZ, 0);
        assert.equal(object.baseW, 0);
      }
    } finally {
      await first.close();
      await fresh?.close();
    }
  });

  for (const type of types)
    test(`${profile}: raw${type} uses actual default World JS writer/pixels without FES EXE prefix`, async () => {
      const world = await textWorld(profile);
      try {
        const h = await setup(world),
          object = h.api.add(type, 'message')[0];
        await h.api.definitions.row(['SIZE', 'VRAM', 'PRI', 'DISP'], 'message', [
          '24,16',
          '0,0',
          '60000',
          '1',
        ]);
        await h.api.strings.command(h.api.instance, object, 'layout', ['size', '4']);
        await h.api.strings.command(h.api.instance, object, 'layout', ['shadow', '0']);
        if (type === 29) await h.api.strings.command(h.api.instance, object, 'insert', []);
        await h.api.strings.command(
          h.api.instance,
          object,
          type === 29 ? 'apend' : 'str',
          ['ABC'],
          { rawTail: 'ABC' },
        );
        await h.api.strings.command(h.api.instance, object, 'draw', []);
        for (let frame = 0; frame < 12; frame++) await h.api.frame(frame);
        const task = world.graphics.get(object.nativeTaskID),
          writer = await task.writer(),
          frame = writer.frame();
        assert.ok(frame.rgba.some((value, index) => index % 4 === 3 && value));
        assert.ok(world.graphics.vramHandle);
        assert.equal((await world.text.runtime()).get(task.text.writer), writer);
        assert.equal(task.record.parent, h.id);
        assert.equal(task.record.kind, type === 29 ? 49 : type === 37 ? 63 : 48);
        assert.equal(object.nativeObjectPointer, undefined);
        assert.equal(world.nativeEngine, undefined);
        assert.ok(!world.nativeFeatures?.has?.('fes-objects'));
        await assert.rejects(
          h.api.strings.command(h.api.instance, object, 'unknown'),
          /Unknown text command/,
        );
      } finally {
        await world.close();
      }
    });

  test(`${profile}: metadata references use encoded stdinfo and consume POS2 only once`, async () => {
    const world = await textWorld(profile);
    try {
      const h = await setup(world),
        object = h.api.add(21, 'metadata')[0];
      await h.api.definitions.row(['POS2', 'SIZE2', 'DISP'], 'metadata', [
        'area.hg3:2',
        'area.hg3:0',
        '1',
      ]);
      await h.api.frame(0);
      assert.deepEqual([object.x, object.y, object.width, object.height], [2, 36, 24, 16]);
      assert.equal(object.positionPending, false);
      assert.equal(object.sizePending, true);
      object.x = 99;
      await h.api.frame(1);
      assert.equal(object.x, 99);
      await h.api.definitions.row(['SIZE2'], 'metadata', ['area.hg3:3']);
      object.width = 31;
      await h.api.frame(2);
      assert.equal(object.width, 31, 'live SIZE2 alone does not reenter first allocation');
    } finally {
      await world.close();
    }
  });

  for (const type of profile.startsWith('sdk') ? [24] : [24, 38])
    test(`${profile}: raw${type} LOG uses canonical generated STRINGs, real D5 pixels and fresh World restore`, async () => {
      const first = await textWorld(profile);
      let fresh;
      try {
        const h = await setup(first),
          object = h.api.add(type, 'history')[0];
        await h.api.definitions.row(['COUNT', 'POS2', 'SIZE2', 'PRI', 'VRAM', 'DISP'], 'history', [
          '3',
          'area.hg3:0',
          'area.hg3:0',
          '60000',
          '0,0',
          '1',
        ]);
        assert.equal(object.disp, false, 'header DISP before binding retains original gate');
        await h.api.frame(0);
        const model = h.api.logs.model(h.api.instance, object),
          handle = first.displayLogs.create(h.id),
          source = first.displayLogs.get(handle);
        Object.assign(first.configuration.fields.log, {
          col: 16,
          prof: 0,
          dispName: 0,
          nameline: 0,
          nameindent: 0,
        });
        for (let i = 0; i < 6; i++)
          append(first.displayLogs, source, String.fromCharCode(65 + i), i);
        await h.api.logs.command(h.api.instance, object, 'setlog', [String(handle)]);
        await model.position(0);
        await model.layout('size', [4]);
        await model.layout('shadow', [0]);
        await model.display(1);
        for (let frame = 1; frame < 12; frame++) await h.api.frame(frame);
        const frames = await h.api.frames();
        assert.equal(frames.length, type === 38 ? 6 : 3);
        assert.ok(frames.some(({ frame }) => frame.rgba.some((v, i) => i % 4 === 3 && v)));
        assert.ok(first.text.core.writers.size === frames.length);
        const retained = model.slot(1).main,
          retainedObject = h.api.collection.graph.get(retained),
          retainedID = retainedObject.nativeTaskID,
          events = structuredClone(first.graphics.get(retainedID).text.sourceEvents);
        await model.next(1, 0);
        await h.api.frame(12);
        assert.equal(h.api.collection.graph.get(retained).nativeTaskID, retainedID);
        assert.deepEqual(first.graphics.get(retainedID).text.sourceEvents, events);
        const saved = structuredClone(first.snapshot()),
          ids = object.slots.map((slot) => [slot.main, slot.secondary]),
          pixels = await h.api.frames();
        fresh = await textWorld(profile, { initialize: false });
        const originalRead = fresh.game.read.bind(fresh.game);
        fresh.game.read = async (name) => {
          if (!['area.hg3', 'story.cst', 'story.cstl'].includes(name)) return originalRead(name);
          throw new Error('text/LOG restore performed resource I/O');
        };
        fresh.game.require = async () => {
          throw new Error('restore performed file I/O');
        };
        await fresh.restore(saved);
        const api = fresh.objects.objects.get(h.id).implementation,
          restored = api.collection.lookup('history', 0),
          count = fresh.objects.objects.size,
          snapshot = structuredClone(restored);
        const oldSend = fresh.sendEngine.bind(fresh);
        fresh.sendEngine = () => {
          throw new Error('restore sent task message');
        };
        await api.logs.update(api.instance, restored, { restoring: true });
        for (const child of api.instance.objects)
          if (api.strings.supports(child))
            await api.strings.update(api.instance, child, { restoring: true });
        fresh.sendEngine = oldSend;
        assert.equal(fresh.objects.objects.size, count);
        assert.deepEqual(structuredClone(restored), snapshot);
        assert.deepEqual(
          restored.slots.map((slot) => [slot.main, slot.secondary]),
          ids,
        );
        for (const expected of pixels) {
          const child = api.collection.graph.get(expected.handle),
            writer = await fresh.graphics.get(child.nativeTaskID).writer();
          assert.deepEqual(writer.frame(), expected.frame);
        }
        const childIDs = frames.map((entry) => entry.id);
        await h.api.collection.remove(object);
        assert.ok(
          childIDs.every((id) => first.objects.objects.has(id)),
          'ordinary LOG close preserves actual children',
        );
        await first.objects.release(h.id);
        assert.ok(
          childIDs.every((id) => !first.objects.objects.has(id)),
          'owner teardown reclaims writers/tasks',
        );
        assert.equal(first.text.core.writers.size, 0);
      } finally {
        await fresh?.close();
        await first.close();
      }
    });
}

test('ABI gates and canonical image-font lookup preserve bare index and avoid resource I/O', async () => {
  const world = await textWorld(profiles[0]);
  try {
    assert.throws(() => initializeFESString({ nativeType: 37 }, world), /no STRING8/);
    assert.throws(() => initializeFESLogObject({ nativeType: 38 }, world), /no LOGSTRING8/);
    const h = await setup(world),
      object = h.api.add(21, 'font')[0],
      images = h.api.add(2, 'atlas', 2);
    await h.api.definitions.row(['SIZE', 'PRI', 'DISP'], 'font', ['24,16', '60000', '1']);
    await h.api.frame(0);
    const seen = [],
      lookup = h.api.strings.lookup;
    h.api.strings.lookup = (instance, ref) => {
      seen.push(ref.index);
      return lookup(instance, ref);
    };
    await h.api.strings.command(h.api.instance, object, 'userfontobj', ['atlas'], {
      reference: { name: 'atlas', index: -1 },
    });
    assert.deepEqual(seen, [-1]);
    assert.equal(h.api.strings.state(object).fontSource, null);
    await h.api.frame(1);
    await assert.rejects(
      h.api.strings.command(h.api.instance, object, 'userfontobj', ['atlas']),
      /once-parsed canonical reference/,
    );
    images[1].fixtureHeldData = null;
    await h.api.strings.command(h.api.instance, object, 'userfontobj', ['atlas[1]'], {
      reference: { name: 'atlas', index: 1 },
    });
    const cache = h.api.cache.data;
    h.api.cache.data = () => {
      throw new Error('image-font loaded filename');
    };
    await h.api.frame(2);
    h.api.cache.data = cache;
    assert.equal(h.api.strings.state(object).fontSource, images[1].handle);
  } finally {
    await world.close();
  }
});

test('STRING layout view and ignored definition columns preserve actual configuration timing', async () => {
  const world = await textWorld(profiles[1]);
  try {
    const h = await setup(world),
      o = h.api.add(21, 'view')[0];
    await h.api.strings.command(h.api.instance, o, 'layout', ['view', '24', '16']);
    await h.api.strings.command(h.api.instance, o, 'layout', ['size', '4']);
    await h.api.strings.command(h.api.instance, o, 'layout', ['shadow', '0']);
    await h.api.definitions.row(['DISP'], 'view', ['1']);
    await h.api.frame(0);
    const task = world.graphics.get(o.nativeTaskID),
      config = task.text.config;
    assert.deepEqual([o.width, o.height], [24, 16]);
    assert.equal(new DataView(config.buffer).getUint32(8, true), 24);
    await h.api.definitions.row(['FILE', 'COUNT'], 'view', ['ignored.hg3', '99']);
    await h.api.frame(1);
    assert.equal(
      task.text.config,
      config,
      'inapplicable header fields do not reconfigure or restart writer',
    );
  } finally {
    await world.close();
  }
});

test('NV DIV changes only outer section rectangles and GETDIV/INSERT retain per-type gates', async () => {
  const world = await textWorld(profiles[1]);
  try {
    const h = await setup(world),
      o = h.api.add(29, 'nv')[0],
      plain = h.api.add(21, 'plain')[0];
    await h.api.definitions.row(['SIZE'], 'nv', ['24,16']);
    const before = h.api.strings.state(o).nv.slice(),
      size = (await world.text.runtime()).bindings('cp932').configSize;
    await h.api.definitions.row(['DIV'], 'nv', ['8']);
    const state = h.api.strings.state(o),
      v = new DataView(state.nv.buffer);
    assert.deepEqual(
      Array.from({ length: 4 }, (_, i) => v.getInt32(8 + i * 4, true)),
      [8, 0, 16, 16],
    );
    assert.deepEqual(
      Array.from({ length: 4 }, (_, i) => v.getInt32(24 + size + i * 4, true)),
      [0, 0, 8, 16],
    );
    assert.deepEqual(state.nv.subarray(24, 24 + size), before.subarray(24, 24 + size));
    await h.api.strings.command(h.api.instance, o, 'getdiv');
    assert.equal(h.api.instance.locals.get(0), 8);
    await h.api.strings.command(h.api.instance, plain, 'getdiv');
    assert.equal(h.api.instance.locals.get(0), 0);
    await h.api.strings.command(h.api.instance, plain, 'insert');
    assert.equal(h.api.strings.state(plain).section, false);
  } finally {
    await world.close();
  }
});

test('LOG font mappings evaluate once and affect the original main-child subset', async () => {
  const world = await textWorld(profiles[1]);
  try {
    const h = await setup(world),
      o = h.api.add(38, 'fontlog')[0];
    await h.api.definitions.row(['COUNT', 'SIZE2', 'POS2'], 'fontlog', [
      '2',
      'area.hg3:0',
      'area.hg3:0',
    ]);
    await h.api.frame(0);
    const handle = world.displayLogs.create(h.id),
      model = h.api.logs.model(h.api.instance, o);
    append(world.displayLogs, world.displayLogs.get(handle), 'A');
    model.bind(handle);
    const seen = [];
    h.api.instance.value = (value) => {
      seen.push(value);
      return Number(value);
    };
    await h.api.logs.command(h.api.instance, o, 'userfont', ['65', '3']);
    assert.deepEqual(seen, ['65', '3']);
    assert.deepEqual(h.api.strings.state(h.api.collection.graph.get(o.slots[0].main)).fontMap, [
      [65, 3],
    ]);
    assert.deepEqual(h.api.strings.state(h.api.collection.graph.get(o.slots[1].main)).fontMap, []);
    assert.deepEqual(
      h.api.strings.state(h.api.collection.graph.get(o.slots[0].secondary)).fontMap,
      [],
    );
    await assert.rejects(
      h.api.logs.command(h.api.instance, o, 'not_a_command'),
      /Unknown LOG command/,
    );
    await assert.rejects(
      h.api.logs.command(h.api.instance, o, 'next', []),
      /parsed reference index/,
    );
  } finally {
    await world.close();
  }
});

test('single-target adapters consume prepared numeric arguments and a selection-shared argument accessor', async () => {
  const world = await textWorld(profiles[1]);
  try {
    const h = await setup(world),
      targets = h.api.add(21, 'group', 2),
      evaluated = new Map(),
      seen = [];
    h.api.instance.value = () => {
      throw new Error('prepared numeric argument evaluated again');
    };
    for (const object of targets) {
      await h.api.strings.command(h.api.instance, object, 'layout', ['size', 4, 5, 6, 7, 8]);
      await h.api.strings.command(h.api.instance, object, 'draw', [2]);
      assert.equal(h.api.strings.state(object).page, 2);
    }
    const context = {
      argument(index) {
        if (!evaluated.has(index)) {
          seen.push(index);
          evaluated.set(index, index + 12);
        }
        return evaluated.get(index);
      },
    };
    for (const object of targets) {
      h.api.strings.state(object).end = [7, 9];
      await h.api.strings.command(h.api.instance, object, 'endpos', ['exprX', 'exprY'], context);
    }
    assert.deepEqual(seen, [0, 1]);
    assert.equal(h.api.instance.globals.get(12), 7);
    assert.equal(h.api.instance.globals.get(13), 9);
    const log = h.api.add(24, 'log')[0];
    await h.api.logs.command(h.api.instance, log, 'userfont', [65, 3]);
    await h.api.logs.command(h.api.instance, log, 'layout', ['size', 4]);
  } finally {
    await world.close();
  }
});

test('game NV font setter preserves both existing face records and updates their indices', async () => {
  const world = await textWorld(profiles[1]);
  try {
    const h = await setup(world),
      object = h.api.add(29, 'nvfont')[0],
      state = h.api.strings.state(object),
      size = world.text.core.bindings('cp932').configSize,
      sub = 24 + size + 16;
    const main = state.nv.slice(24 + 128, 24 + 192),
      secondary = state.nv.slice(sub + 128, sub + 192);
    state.dirty = false;
    await h.api.strings.command(h.api.instance, object, 'layout', [
      'fontind',
      7,
      'unused native face input',
    ]);
    assert.deepEqual(state.nv.subarray(24 + 128, 24 + 192), main);
    assert.deepEqual(state.nv.subarray(sub + 128, sub + 192), secondary);
    const view = new DataView(state.nv.buffer);
    assert.equal(view.getUint32(24 + size - 4, true), 7);
    assert.equal(view.getUint32(sub + size - 4, true), 7);
    assert.equal(state.dirty, true);
  } finally {
    await world.close();
  }
});
