// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { append, files } from './fixtures/fes-log-model.mjs';
import { hg3, kcsProgram } from './helpers.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { EngineHost } from '../src/host.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const utf8 = (value) => new TextEncoder().encode(value);
function configs(world, object, raw) {
  if (object.nativeType !== 29) return [raw ?? world.text.fes.layout(object).config()];
  const bytes = raw ?? object.nativeTextState.nv,
    size = nativeABI(world.profile).layouts.textCores.cp932.configSize;
  return [24, 24 + size + 16].map((offset) => bytes.slice(offset, offset + size));
}
function field(world, object, bytes) {
  const abi = nativeABI(world.profile),
    fontBytes = abi.text.fesLayouts[object.nativeType === 37 ? 37 : 21].fontBytes,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    at = 128 + fontBytes;
  return {
    face: bytes.slice(128, at),
    weight: view.getUint32(at, true),
    rightdown: view.getUint32(at + 4, true),
    around: view.getUint32(at + 8, true),
    fixed: view.getUint32(at + 12, true),
    wipe: view.getUint32(at + 16, true),
    index: view.getUint32(at + 20, true),
    proportional: view.getUint32(124, true),
  };
}
function face(world) {
  const width = nativeABI(world.profile).text.settingsCharacterBytes,
    bytes = world.configuration.fields.data,
    view = new DataView(bytes.buffer);
  for (let end = 0; end < bytes.length; end += width)
    if ((width === 1 ? bytes[end] : view.getUint16(end, true)) === 0)
      return bytes.slice(0, end + width);
  throw new Error('test Settings has no terminated face');
}
function assertFace(actual, expected) {
  assert.deepEqual(actual.subarray(0, expected.length), expected);
}
async function assertD5(world, objects) {
  for (const object of objects) {
    const writer = await world.graphics.get(object.nativeTaskID).writer();
    assert.deepEqual(configs(world, object, writer.config), configs(world, object));
  }
}
async function restore(profile, state) {
  const world = await defaultFESWorld(profile, {}, { initialize: false }),
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    if (name !== 'case.kcs') throw new Error(`configuration restore read ${name}`);
    return read(name);
  };
  try {
    await world.restore(state);
    return world;
  } catch (error) {
    await world.close();
    throw error;
  }
}
async function declare(world, id, name, type) {
  const bytes = new Uint8Array(36),
    view = new DataView(bytes.buffer);
  bytes.set(utf8(name));
  view.setUint32(32, 1, true);
  await world.sendEngine(id, world.main.id, 338, 0, FES_OBJECT_DEFINITION_ORDER.indexOf(type), {
    payload: {
      string: (at) => new TextDecoder().decode(bytes.subarray(at, bytes.indexOf(0, at))),
      load: (at) => view.getUint32(at, true),
    },
  });
}

for (const profile of profiles) {
  test(`${profile}: FES message19 refreshes only selected defaults, with exact native face bytes and real D5/fresh state`, async () => {
    const hasUTF8 = profile === profiles[1],
      world = await defaultFESWorld(profile, {
        'screen.fes': utf8(`#DEFINE
STRING text[4]
NVSTRING nv[2]
${hasUTF8 ? 'STRING8 utf[2]' : ''}
#OBJECT SIZE
text 48,16
nv 48,16
${hasUTF8 ? 'utf 48,16' : ''}
#START
next IDLE
#IDLE
#MANUAL
text[1] layout fontind 7 ManualFace
text[1] layout weight 333
text[1] layout shadow 4 5
text[1] layout wipewidth 77
nv[1] layout fontind 9 CustomNV
nv[1] layout weight 334
nv[1] layout shadow 6 7
${hasUTF8 ? 'utf[1] layout fontind 8 ManualUTF8\nutf[1] layout weight 335\nutf[1] layout shadow 8 9' : ''}
break
#RESET
nv reset
break
#MES_CHANGECONFIG
text[3] layout fontind 11 NotificationFace
break
`),
      });
    let fresh;
    try {
      world.configuration.fields.font.name = 'InitialFace';
      const h = await loadDefaultFES(world);
      await h.task.tick();
      await h.task.player.notify('MANUAL');
      await h.task.syncObjects();
      const objects = h.instance.objects,
        before = new Map(objects.map((object) => [object.handle, configs(world, object)]));
      Object.assign(world.configuration.fields.font, {
        prop: 0,
        fix: 9,
        weight: 1,
        rightdown: 12,
        around: 13,
      });
      if (hasUTF8) world.configuration.fields.font.name = '猫😀Current';
      else world.configuration.fields.data.set([0x87, 0x90, 0]);
      const expectedFace = face(world),
        bank = h.task.variableBank(),
        notify = h.task.player.notify.bind(h.task.player);
      bank.registerContext('outside');
      let notifications = 0;
      h.task.player.notify = (label, ...args) => {
        if (label === 'MES_CHANGECONFIG') {
          notifications++;
          assert.equal(bank.selectedContext, 'outside');
        }
        return notify(label, ...args);
      };
      assert.equal(await world.sendEngine(h.id, world.main.id, 19), NATIVE_UNWRITTEN_WORD);
      assert.equal(notifications, hasUTF8 ? 1 : 0);
      if (!hasUTF8) assert.equal(bank.selectedContext, 'outside');
      for (const object of objects) {
        const current = configs(world, object).map((bytes) => field(world, object, bytes));
        if (object.index === 1) {
          for (let index = 0; index < current.length; index++) {
            const old = field(world, object, before.get(object.handle)[index]);
            assert.deepEqual(current[index].face, old.face);
            assert.equal(current[index].index, old.index);
            assert.equal(current[index].weight, old.weight);
            assert.equal(current[index].rightdown, old.rightdown);
            assert.equal(current[index].around, old.around);
            assert.equal(current[index].wipe, old.wipe);
            assert.equal(current[index].fixed, 1);
          }
        } else {
          for (const [index, value] of current.entries()) {
            if (hasUTF8 && object.baseName === 'text' && object.index === 3) {
              assert.equal(value.index, 11);
              assertFace(
                value.face,
                hasUTF8
                  ? utf8('N\0o\0t\0i\0f\0i\0c\0a\0t\0i\0o\0n\0F\0a\0c\0e\0\0\0')
                  : utf8('NotificationFace\0'),
              );
            } else assertFace(value.face, expectedFace);
            assert.equal(value.weight, 700);
            assert.equal(value.rightdown, 12);
            assert.equal(value.around, 13);
            assert.equal(value.fixed, 1);
            assert.equal(
              value.proportional,
              field(world, object, before.get(object.handle)[index]).proportional,
              'the callback does not overwrite this separate field',
            );
          }
        }
      }
      const nv = h.instance.collection.lookup('nv', 1);
      assert.equal(nv.nativeTextState.nvFontDefault, false);
      assert.equal(nv.nativeTextState.nvWeightDefault, false);
      assert.equal(nv.nativeTextState.nvShadowDefault, false);
      assert.equal(nv.nativeTextState.nvFixedDefault, true);
      await h.task.syncObjects();
      await assertD5(world, objects);

      const saved = objects.map((object) => configs(world, object));
      world.configuration.fields.font.name = 'NotAnEvent';
      world.markConfigurationDirty();
      await h.task.syncObjects();
      assert.deepEqual(
        objects.map((object) => configs(world, object)),
        saved,
      );
      assert.equal(world.configurationDirty, true, 'preference persistence dirty is independent');
      fresh = await restore(profile, world.snapshot());
      const task = fresh.objects.objects.get(h.id).implementation,
        restoredObjects = objects.map((object) =>
          task.player.root.collection.graph.get(object.handle),
        );
      assert.deepEqual(
        restoredObjects.map((object) => configs(fresh, object)),
        saved,
      );
      await task.syncObjects();
      await assertD5(fresh, restoredObjects);
      assert.equal(
        restoredObjects.find((object) => object.handle === nv.handle).nativeTextState
          .nvWeightDefault,
        false,
      );
      await h.task.player.notify('RESET');
      Object.assign(world.configuration.fields.font, {
        prop: 1,
        fix: 17,
        weight: 0,
        rightdown: 21,
        around: 22,
      });
      await world.sendEngine(h.id, world.main.id, 19);
      for (const object of objects.filter((object) => object.nativeType === 29)) {
        assert.equal(object.nativeTextState.nvWeightDefault, true);
        assert.equal(object.nativeTextState.nvShadowDefault, true);
        for (const bytes of configs(world, object)) {
          const value = field(world, object, bytes);
          assertFace(value.face, face(world));
          assert.deepEqual(
            [value.fixed, value.weight, value.rightdown, value.around],
            [17, 400, 21, 22],
          );
        }
      }
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile}: message19 follows saved FIFO keys through same-layout and switch-default rebindings, and diagnoses unrecovered concrete layouts`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': utf8(`#DEFINE
STRING rebound
CIMAGE ignored
CIMAGE ordinary
STRING missing
#OBJECT SIZE
rebound 24,16
missing 24,16
#START
next IDLE
#IDLE
#DROP
rebound delete
ignored delete
missing delete
break
#REMOVE
rebound delete
break
`),
    });
    let fresh;
    try {
      world.configuration.fields.font.name = 'InitialFace';
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const old = h.instance.collection.lookup('rebound', 0),
        oldTask = old.nativeTaskID,
        oldConfig = configs(world, old),
        calls = [],
        apply = world.text.fes.configurationChanged.bind(world.text.fes);
      world.text.fes.configurationChanged = (object) => {
        calls.push(object.handle);
        return apply(object);
      };
      await h.task.player.notify('DROP');
      await declare(world, h.id, 'ignored', 'STRING');
      await declare(world, h.id, 'rebound', 'STRING');
      const rebound = h.instance.collection.lookup('rebound', 0),
        ignored = h.instance.collection.lookup('ignored', 0),
        ignoredConfig = configs(world, ignored),
        ordinary = h.instance.collection.lookup('ordinary', 0),
        ordinaryDirty = ordinary.dirty;
      world.configuration.fields.font.name = 'CurrentFace';
      assert.equal(await world.sendEngine(h.id, world.main.id, 19), NATIVE_UNWRITTEN_WORD);
      assert.deepEqual(calls, [rebound.handle]);
      assertFace(field(world, rebound, configs(world, rebound)[0]).face, face(world));
      assert.deepEqual(
        configs(world, ignored),
        ignoredConfig,
        'saved CIMAGE dispatch is a proven no-op even when its current key is STRING',
      );
      assert.deepEqual(configs(world, old), oldConfig);
      assert.ok(world.objects.objects.has(oldTask), 'old text child remains independently owned');
      assert.equal(ordinary.dirty, ordinaryDirty);
      await h.task.syncObjects();
      calls.length = 0;
      await world.sendEngine(h.id, world.main.id, 19);
      assert.deepEqual(calls, [rebound.handle, ignored.handle, rebound.handle]);
      fresh = await restore(profile, world.snapshot());
      const freshCalls = [],
        freshApply = fresh.text.fes.configurationChanged.bind(fresh.text.fes);
      fresh.text.fes.configurationChanged = (object) => {
        freshCalls.push(object.handle);
        return freshApply(object);
      };
      await fresh.sendEngine(h.id, fresh.main.id, 19);
      assert.deepEqual(freshCalls, calls);
      assert.ok(fresh.objects.objects.has(oldTask));
      await h.task.player.notify('REMOVE');
      await declare(world, h.id, 'rebound', 'CIMAGE');
      await assert.rejects(
        world.sendEngine(h.id, world.main.id, 19),
        /Unrecovered FES configuration callback raw21 on raw1/,
      );
      await h.task.player.notify('REMOVE');
      await declare(world, h.id, 'rebound', 'NVSTRING');
      await assert.rejects(
        world.sendEngine(h.id, world.main.id, 19),
        /Unrecovered FES configuration callback raw21 on raw29/,
      );
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile}: saved SOUND/SNDTABLE callbacks borrow the existing service and preserve its real MOT through same-layout rebinding`, async () => {
    const world = await defaultFESWorld(profile, {
      'held.kcs': kcsProgram([[59]]),
      'screen.fes': utf8(
        '#DEFINE\nSOUND live\nSNDTABLE other\n#SUBCOMMAND\ncontinue custom held p[0] : [0]\n#START\nlive custom 1\nnext IDLE\n#IDLE\n#DROP\nlive delete\nbreak\n',
      ),
    });
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const object = h.instance.collection.lookup('live', 0),
        target = h.instance.runtime.targetFor(object, false),
        motion = target.snapshot(),
        calls = [],
        apply = world.fesSound.configurationChanged.bind(world.fesSound);
      world.fesSound.configurationChanged = (instance, current, ...rest) => {
        calls.push([current.key, current.nativeType]);
        return apply(instance, current, ...rest);
      };
      await world.sendEngine(h.id, world.main.id, 19);
      assert.deepEqual(calls, [
        ['live', 9],
        ['other', 10],
      ]);
      assert.deepEqual(target.snapshot(), motion);
      assert.strictEqual(world.fesSound.target(h.instance, object), target);
      assert.equal(world.fesSound.state(h.instance, object).get('dirty'), 1);
      await h.task.player.notify('DROP');
      await declare(world, h.id, 'live', 'SNDTABLE');
      calls.length = 0;
      await world.sendEngine(h.id, world.main.id, 19);
      assert.deepEqual(calls, [
        ['live[0]', 10],
        ['other', 10],
      ]);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });

  for (const type of profile === profiles[1] ? ['LOGSTRING', 'LOGSTRING8'] : ['LOGSTRING'])
    test(`${profile}: message19 visits ${type}'s actual generated FIFO children and restores their independent default flags`, async () => {
      const frame = hg3(24, 16, new Uint8Array(24 * 16 * 4)),
        regions = new Uint8Array(frame.length * 2 - 12),
        view = new DataView(regions.buffer);
      regions.set(frame);
      regions.set(frame.subarray(12), frame.length);
      view.setUint32(12, frame.length - 12, true);
      view.setUint32(frame.length + 4, 1, true);
      const world = await defaultFESWorld(profile, {
        ...files,
        'area.hg3': regions,
        'screen.fes': utf8(
          `#DEFINE\n${type} log\n#OBJECT COUNT POS2 SIZE2 PRI\nlog 2 area:0 area:0 60000\n#START\nnext IDLE\n#IDLE\n#BIND\nlog setlog $0\nlog layout fontind 3 ManualMain\nbreak\n`,
        ),
      });
      let fresh;
      try {
        world.configuration.fields.font.name = 'InitialFace';
        const h = await loadDefaultFES(world);
        await h.task.syncObjects();
        await h.task.syncObjects();
        const object = h.instance.collection.lookup('log', 0),
          log = world.displayLogs.create(h.id),
          model = world.displayLogs.get(log);
        append(world.displayLogs, model, 'A');
        append(world.displayLogs, model, 'B');
        h.instance.setGlobal(0, log);
        await h.task.player.notify('BIND');
        await h.task.syncObjects();
        const slots = object.slots.map((slot) => ({
            main: h.instance.collection.graph.get(slot.main),
            secondary:
              slot.secondary === null ? null : h.instance.collection.graph.get(slot.secondary),
          })),
          children = slots.flatMap(({ main, secondary }) =>
            secondary ? [main, secondary] : [main],
          ),
          before = new Map(children.map((child) => [child.handle, configs(world, child)])),
          calls = [],
          apply = world.text.fes.configurationChanged.bind(world.text.fes);
        world.text.fes.configurationChanged = (child) => {
          calls.push(child.handle);
          return apply(child);
        };
        world.configuration.fields.font.name = 'LogCurrent';
        world.configuration.fields.font.weight = 1;
        await world.sendEngine(h.id, world.main.id, 19);
        assert.deepEqual(
          calls,
          h.instance.runtime.resources.entries
            .filter((entry) => [21, 37].includes(entry.savedType))
            .map((entry) => h.instance.collection.lookup(entry.nameBytes, entry.index).handle),
        );
        assert.equal(calls.length, children.length);
        for (const { main, secondary } of slots) {
          assert.deepEqual(
            field(world, main, configs(world, main)[0]).face,
            field(world, main, before.get(main.handle)[0]).face,
          );
          if (secondary)
            assertFace(field(world, secondary, configs(world, secondary)[0]).face, face(world));
          for (const child of [main, secondary].filter(Boolean))
            assert.equal(field(world, child, configs(world, child)[0]).weight, 700);
        }
        await h.task.syncObjects();
        await assertD5(world, children);
        fresh = await restore(profile, world.snapshot());
        const task = fresh.objects.objects.get(h.id).implementation,
          restored = children.map((child) => task.player.root.collection.graph.get(child.handle));
        assert.deepEqual(
          restored.map((child) => configs(fresh, child)),
          children.map((child) => configs(world, child)),
        );
        await task.syncObjects();
        await assertD5(fresh, restored);
        assert.equal(world.nativeEngine, undefined);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await world.close();
      }
    });
}

for (const profile of profiles)
  test(`${profile}: saved duplicate STRING entries refresh current defaults without constructing a writer or changing the old D5 pixels/cursor`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': utf8(
        '#DEFINE\nSTRING text[1]\n#OBJECT SIZE POS PRI DISP\ntext 48,16 4,4 60001 1\n#START\ntext layout size 4\ntext layout color 255 255 255\ntext layout frame 10\ntext layout shadow 0 0\ntext str ABC\ntext draw\ntext skip\nnext IDLE\n#IDLE\n',
      ),
    });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      await h.task.tick();
      const object = h.instance.collection.lookup('text', 0),
        oldTask = object.nativeTaskID,
        writer = await world.graphics.get(oldTask).writer(),
        pixels = writer.frame().rgba.slice(),
        end = [...object.nativeTextState.end];
      assert.equal(object.nativeTextState.endKnown, true);
      assert.ok(pixels.some((value, at) => at % 4 === 3 && value));
      await declare(world, h.id, 'text', 'STRING');
      await h.task.syncObjects();
      assert.equal(world.graphics.get(object.nativeTaskID).text.writer, null);
      assert.notEqual(object.nativeTaskID, oldTask);
      assert.equal(h.instance.runtime.resources.entries.length, 2);
      world.configuration.fields.font.name = 'CurrentFace';
      await world.sendEngine(h.id, world.main.id, 19);
      await h.task.syncObjects();
      assert.equal(world.graphics.get(object.nativeTaskID).text.writer, null);
      assert.equal(object.nativeTextState.first, false);
      assert.equal(object.nativeTextState.endKnown, true);
      assert.deepEqual(object.nativeTextState.end, end);
      assert.deepEqual(writer.frame().rgba, pixels);
      assertFace(field(world, object, configs(world, object)[0]).face, face(world));
      fresh = await restore(profile, world.snapshot());
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = task.player.root.collection.lookup('text', 0);
      await fresh.sendEngine(h.id, fresh.main.id, 19);
      await task.syncObjects();
      assert.equal(fresh.graphics.get(restored.nativeTaskID).text.writer, null);
      assert.deepEqual(restored.nativeTextState.end, end);
      assert.deepEqual((await fresh.graphics.get(oldTask).writer()).frame().rgba, pixels);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

for (const profile of profiles)
  test(`${profile}: message19 resolves each saved key after its ABI notification can delete the current object`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': utf8(
        '#DEFINE\nSTRING text\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n#MES_CHANGECONFIG\ntext delete\nbreak\n',
      ),
    });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const original = h.instance.collection.lookup('text', 0),
        child = original.nativeTaskID,
        calls = [],
        apply = world.text.fes.configurationChanged.bind(world.text.fes);
      world.text.fes.configurationChanged = (object) => {
        calls.push(object.handle);
        return apply(object);
      };
      assert.equal(h.instance.runtime.resources.entries.length, 1);
      await world.sendEngine(h.id, world.main.id, 19);
      assert.deepEqual(calls, profile === profiles[1] ? [] : [original.handle]);
      assert.equal(
        h.instance.collection.lookup('text', 0),
        profile === profiles[1] ? null : original,
      );
      assert.ok(
        world.objects.objects.has(child),
        'the saved resource entry retains its original owned child',
      );
      fresh = await restore(profile, world.snapshot());
      const task = fresh.objects.objects.get(h.id).implementation;
      await fresh.sendEngine(h.id, fresh.main.id, 19);
      assert.equal(!!task.player.root.collection.lookup('text', 0), profile === profiles[0]);
      assert.ok(fresh.objects.objects.has(child));
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

function configurationDeferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
for (const holdCancel of [false, true])
  test(
    `Game configuration continuation stops after real config_open owner close, pendingCancel=${holdCancel}`,
    { timeout: 1500 },
    async (t) => {
      let dom;
      t.after(() => dom?.dispose());
      const world = await defaultFESWorld(profiles[1], {
          'screen.fes': utf8(
            '#DEFINE\nSOUND sound\nSTRING text\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n#MES_CHANGECONFIG\nconfig_open\n$40=++$10\nbreak\n',
          ),
        }),
        opened = configurationDeferred(),
        canceled = configurationDeferred(),
        cancelGate = configurationDeferred(),
        calls = [];
      world.host.engine = {};
      world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
      world.host.nativeWindowAction = function (action, owner) {
        const result = EngineHost.prototype.nativeWindowAction.call(this, action, owner);
        if (action.type === 'fes-configuration') opened.resolve();
        if (action.type === 'fes-owner-close') {
          canceled.resolve();
          if (holdCancel) return cancelGate.promise.then(() => result);
        }
        return result;
      };
      let request, closing;
      try {
        const h = await loadDefaultFES(world);
        await h.task.tick();
        dom = nativeWindowDOM();
        const player = h.task.player,
          runtime = h.instance.runtime,
          owner = world.objects.objects.get(h.id),
          text = world.text.fes.configurationChanged.bind(world.text.fes),
          sound = world.fesSound.configurationChanged.bind(world.fesSound);
        world.text.fes.configurationChanged = (...args) => {
          calls.push(['text', runtime.closed]);
          return text(...args);
        };
        world.fesSound.configurationChanged = (...args) => {
          calls.push(['sound', runtime.closed]);
          return sound(...args);
        };
        h.instance.setGlobal(10, 9);
        request = world.sendEngine(h.id, world.main.id, 19);
        await opened.promise;
        for (let i = 0; i < 60 && !world.host.windowService?.dialog?.open; i++)
          await Promise.resolve();
        assert.ok(world.host.windowService?.dialog?.open);
        assert.equal(world.host.windowService.dialogOwner, h.id);
        world.configuration.fields.font.name = 'ChangedFace';
        closing = world.objects.release(h.id);
        await canceled.promise;
        if (holdCancel) {
          assert.equal(
            h.task.player,
            player,
            'the Host cancel wait still owns the same captured player',
          );
          assert.equal(owner.state, 'releasing');
          assert.equal(runtime.closed, true);
        }
        await request;
        assert.deepEqual(calls, [], 'no saved FIFO callback starts after cancellation');
        assert.equal(h.instance.global(10), 9);
        assert.equal(h.instance.global(40), 0);
        assert.equal(h.instance.finished, null);
        assert.equal(owner.exitCode, -1);
        cancelGate.resolve();
        await closing;
        assert.equal(h.task.player, null);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        cancelGate.resolve();
        world.host.windowService?.close();
        await closing?.catch(() => {});
        await request?.catch(() => {});
        await world.close();
      }
    },
  );

for (const profile of profiles)
  for (const completion of ['resolve', 'reject'])
    test(
      `${profile}: configuration continuation cancels real sound185 ${completion} after owner close before pendingPlay or later FIFO writes`,
      { timeout: 1500 },
      async () => {
        const world = await defaultFESWorld(profile, {
            'screen.fes': utf8(
              '#DEFINE\nSOUND first\nSTRING text\nSOUND later\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n',
            ),
          }),
          entered = configurationDeferred(),
          response = configurationDeferred(),
          lateWrites = [],
          callbacks = [];
        let request,
          watch = false;
        try {
          const h = await loadDefaultFES(world);
          await h.task.tick();
          const runtime = h.instance.runtime,
            owner = world.objects.objects.get(h.id),
            target = world.resolveTaskID(h.task.soundTaskID, h.id),
            soundTask = world.objects.objects.get(target).implementation,
            receive = soundTask.message.bind(soundTask),
            stateFor = world.fesSound.state.bind(world.fesSound),
            configureSound = world.fesSound.configurationChanged.bind(world.fesSound),
            configureText = world.text.fes.configurationChanged.bind(world.text.fes);
          const queryMessage = mapABIMessage(profile, 'fesSound', 'raw', 185);
          let held = false,
            actualQueries = 0;
          soundTask.message = async (words, context) => {
            const result = await receive(words, context);
            if (words[1] === queryMessage && !held) {
              held = true;
              actualQueries++;
              entered.resolve();
              await response.promise;
            }
            return result;
          };
          world.fesSound.state = (...args) => {
            const state = stateFor(...args),
              set = state.set.bind(state);
            state.set = (...values) => {
              if (watch) lateWrites.push(values);
              return set(...values);
            };
            return state;
          };
          world.fesSound.configurationChanged = (...args) => {
            callbacks.push('sound');
            return configureSound(...args);
          };
          world.text.fes.configurationChanged = (...args) => {
            callbacks.push('text');
            return configureText(...args);
          };
          request = world.sendEngine(h.id, world.main.id, 19);
          // Install the rejection observer before canceling the real response.
          const observed = request.then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
          await entered.promise;
          assert.equal(actualQueries, 1);
          await world.objects.release(h.id);
          assert.equal(runtime.closed, true);
          assert.equal(owner.state, 'releasing');
          assert.equal(world.objects.objects.has(h.id), false);
          watch = true;
          if (completion === 'reject')
            response.reject(new Error('authored delayed query cancellation'));
          else response.resolve();
          const settled = await observed;
          assert.equal(
            settled.error,
            undefined,
            'canceled query rejection does not become a fatal',
          );
          assert.deepEqual(
            lateWrites,
            [],
            'no post-close sound field write, including pendingPlay',
          );
          assert.deepEqual(callbacks, ['sound']);
          assert.equal(h.instance.finished, null);
          assert.equal(owner.exitCode, -1);
          assert.equal(world.nativeEngine, undefined);
        } finally {
          response.resolve();
          await request?.catch(() => {});
          await world.close();
        }
      },
    );

test(
  'Game configuration continuation preserves a real sound185 rejection while the owner remains live',
  { timeout: 1500 },
  async () => {
    const world = await defaultFESWorld(profiles[1], {
      'screen.fes': utf8(
        '#DEFINE\nSOUND first\nSTRING text\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n',
      ),
    });
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const target = world.resolveTaskID(h.task.soundTaskID, h.id),
        soundTask = world.objects.objects.get(target).implementation,
        receive = soundTask.message.bind(soundTask);
      soundTask.message = async (words, context) => {
        const result = await receive(words, context);
        if (words[1] === 185) throw new Error('authored live query failure');
        return result;
      };
      await assert.rejects(
        world.sendEngine(h.id, world.main.id, 19),
        /authored live query failure/,
      );
      assert.equal(h.instance.runtime.closed, false);
      assert.equal(h.task.player, h.instance.player);
      assert.equal(h.instance.finished, null);
    } finally {
      await world.close();
    }
  },
);

test(
  'Game configuration continuation stops its FIFO after real sound185 while Host cancel keeps the same objects pending teardown',
  { timeout: 1500 },
  async (t) => {
    let dom;
    t.after(() => dom?.dispose());
    const world = await defaultFESWorld(profiles[1], {
        'screen.fes': utf8(
          '#DEFINE\nSOUND first\nSTRING text\nSOUND later\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n#OPEN\nconfig_open\nbreak\n',
        ),
      }),
      queried = configurationDeferred(),
      response = configurationDeferred(),
      opened = configurationDeferred(),
      canceled = configurationDeferred(),
      cancelGate = configurationDeferred(),
      callbacks = [];
    world.host.engine = {};
    world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
    world.host.nativeWindowAction = function (action, owner) {
      const result = EngineHost.prototype.nativeWindowAction.call(this, action, owner);
      if (action.type === 'fes-configuration') opened.resolve();
      if (action.type === 'fes-owner-close') {
        canceled.resolve();
        return cancelGate.promise.then(() => result);
      }
      return result;
    };
    let request, modal, closing;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      dom = nativeWindowDOM();
      const runtime = h.instance.runtime,
        player = h.task.player,
        owner = world.objects.objects.get(h.id),
        target = world.resolveTaskID(h.task.soundTaskID, h.id),
        soundTask = world.objects.objects.get(target).implementation,
        receive = soundTask.message.bind(soundTask),
        sound = world.fesSound.configurationChanged.bind(world.fesSound),
        text = world.text.fes.configurationChanged.bind(world.text.fes);
      let held = false;
      soundTask.message = async (words, context) => {
        const result = await receive(words, context);
        if (words[1] === 185 && !held) {
          held = true;
          queried.resolve();
          await response.promise;
        }
        return result;
      };
      world.fesSound.configurationChanged = (...args) => {
        callbacks.push(['sound', runtime.closed]);
        return sound(...args);
      };
      world.text.fes.configurationChanged = (...args) => {
        callbacks.push(['text', runtime.closed]);
        return text(...args);
      };
      request = world.sendEngine(h.id, world.main.id, 19);
      await queried.promise;
      modal = player.notify('OPEN');
      await opened.promise;
      for (let i = 0; i < 60 && !world.host.windowService?.dialog?.open; i++)
        await Promise.resolve();
      assert.ok(world.host.windowService?.dialog?.open);
      closing = world.objects.release(h.id);
      await canceled.promise;
      assert.equal(h.task.player, player);
      assert.equal(owner.state, 'releasing');
      assert.equal(runtime.closed, true);
      assert.ok(
        h.instance.collection.lookup('text', 0),
        'cancel await still retains the current collection',
      );
      response.resolve();
      await request;
      assert.deepEqual(
        callbacks,
        [['sound', false]],
        'the captured FIFO does not resume into current objects after close',
      );
      assert.equal(h.instance.finished, null);
      assert.equal(owner.exitCode, -1);
      cancelGate.resolve();
      await closing;
      await modal;
    } finally {
      response.resolve();
      cancelGate.resolve();
      world.host.windowService?.close();
      await closing?.catch(() => {});
      await modal?.catch(() => {});
      await request?.catch(() => {});
      await world.close();
    }
  },
);
