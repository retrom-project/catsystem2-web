// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { fesByteView } from '../src/fes/tokens.mjs';
import { fesLabelPayload, fesNotificationMemory } from './fixtures/default-fes-world.mjs';
import { controlFiles } from './fixtures/control-files.mjs';
import { FESControlDriver } from '../src/native/fes-control-driver.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  text = (value) => (typeof value === 'string' ? value : new TextDecoder().decode(value)),
  filename = 'assets.int/public-press.fes';

async function environment(profile, source, { controlImages = null } = {}) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { ...controlImages, 'assets/public-press.fes': source },
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>' +
          (controlImages
            ? '<int03><name>image</name><int>assets.int</int><ext>hg2</ext><dir>assets</dir></int03>'
            : ''),
      ),
      bytes = new Uint8Array(startup.length + mount.length);
    assert.ok(at >= 0);
    bytes.set(startup.subarray(0, at));
    bytes.set(mount, at);
    bytes.set(startup.subarray(at), at + mount.length);
    const input = new Map(template.input);
    input.set('startup.xml', new BlobFile(new Blob([bytes])));
    const game = new GameFiles(input);
    await game.open();
    player = new CatSystem2({
      game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      randomSeed: 77,
      audioContext: { currentTime: 0, close: async () => {} },
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          throw new Error('Public press ordering must not open the original');
        },
      },
    });
    await player.initialize();
    const world = player.world,
      parent = world.main;
    assert.equal(world.frame, 1);
    assert.equal(world.runtime.variableBank(parent, false).get(7), 0x12345678);
    world.runtime.stringBank(parent);
    const id = await world.objects.create({ kind: 34, parent: parent.id }),
      surface = await world.objects.create({ kind: 15, parent: parent.id });
    await world.sendEngine(surface, parent.id, 279, 64, 48);
    await world.sendEngine(surface, parent.id, 283);
    await world.sendEngine(id, parent.id, 331, 0, parent.context.variableBank);
    await world.sendEngine(id, parent.id, 334, 0, world.nativeTaskID(surface));
    const task = world.objects.objects.get(id).implementation;
    assert.equal(world.objects.objects.get(id).context.stringBank, parent.context.stringBank);
    return {
      player,
      world,
      game,
      id,
      task,
      strings: world.runtime.stringBank(parent),
      words: world.runtime.variableBank(parent, false),
      async load() {
        await world.sendEngine(id, parent.id, 332, 0, 0, {
          payload: { string: () => filename },
        });
        assert.ok(task.player.root.runtime instanceof FESCoordinator);
        return task.player.root;
      },
      async close() {
        try {
          await player.dispose();
        } finally {
          scope.restore();
        }
      },
    };
  } catch (error) {
    try {
      await player?.dispose();
    } finally {
      scope.restore();
    }
    throw error;
  }
}

async function freshCheckpoint(t, h, profile) {
  const gpu = h.world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  // Supply the fixture's known CPU frame for the existing checkpoint contract.
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
  const source = h.world.fesSources.snapshot(),
    checkpoint = await h.player.snapshot();
  let restoring = true;
  for (const [prototype, method] of [
    [FESInstance.prototype, 'execute'],
    [FESInstance.prototype, 'expandMacros'],
    [FESCoordinator.prototype, 'initialize'],
    [NativeStringBank.prototype, 'expandBytes'],
    [NativeScriptReplacements.prototype, 'apply'],
  ]) {
    const original = prototype[method];
    t.mock.method(prototype, method, function (...args) {
      assert.equal(restoring, false, 'fresh restoration must not replay ' + method);
      return original.apply(this, args);
    });
  }
  const file = h.game.lookup(filename).file,
    read = file.read;
  t.mock.method(file, 'read', function (...args) {
    assert.equal(restoring, false, 'fresh restoration must not reopen the FES');
    return read.apply(this, args);
  });
  const player = new CatSystem2({
    game: h.game,
    nativeProfile: profile,
    canvas: new StartupCanvas(),
    audioContext: { currentTime: 0, close: async () => {} },
    transitionalExe: {
      open() {
        throw new Error('No original public-press restore');
      },
    },
  });
  try {
    await player.initialize({ checkpoint });
  } catch (error) {
    await player.dispose();
    throw error;
  } finally {
    restoring = false;
  }
  assert.deepEqual(player.world.fesSources.snapshot(), source);
  assert.equal(player.world.nativeEngine, undefined);
  return player;
}

const source = ascii(
  [
    '#DEFINE',
    'BUTTON Choice[2]',
    'BUTTON Other',
    'BUTTON Silent',
    'BUTTON Replace[2]',
    'BUTTON Close',
    'BUTTON SyncFail',
    'BUTTON ReleaseFail',
    'BUTTON AsyncFail',
    '#OBJECT SIZE POS DISP',
    'Choice 6,4 4,5 1',
    'Other 6,4 20,5 1',
    'Silent 6,4 30,5 1',
    'Replace 6,4 4,15 1',
    'Close 6,4 20,15 1',
    'SyncFail 6,4 4,25 1',
    'ReleaseFail 6,4 20,25 1',
    'AsyncFail 6,4 30,25 1',
    '#START',
    'wait 1',
    'next IDLE',
    '#IDLE',
    'break',
    '#Other.PUSH_L',
    '$50=++$50',
    'break',
    '#Other.RELEASE_L',
    '$51=++$51',
    'break',
    '#Choice.PUSH_L',
    '$52=++$52',
    '@ getid 55',
    'clipboard (:public-press)',
    '@ getid 56',
    '$53=++$53',
    'break',
    '#Choice.RELEASE_L',
    '$54=++$54',
    '@ getid 57',
    'clipboard (:public-release)',
    '$58=++$58',
    'break',
    '#REENTER',
    'Other getid 63',
    '$62=++$62',
    'break',
    '#Replace.PUSH_L',
    'clipboard (:replace-press)',
    '$61=++$61',
    'break',
    '#Replace.RELEASE_L',
    '$59=++$59',
    'break',
    '#Close.PUSH_L',
    'clipboard (:close-press)',
    '$61=++$61',
    'break',
    '#Close.RELEASE_L',
    '$60=++$60',
    'break',
    '#SyncFail.PUSH_L',
    '$2=++$2',
    'K2B_UNKNOWN_HEAD',
    'break',
    '#SyncFail.RELEASE_L',
    '$3=++$3',
    'break',
    '#ReleaseFail.PUSH_L',
    '$4=++$4',
    'break',
    '#ReleaseFail.RELEASE_L',
    '$5=++$5',
    'K2B_RELEASE_UNKNOWN',
    'break',
    '#AsyncFail.PUSH_L',
    '$6=++$6',
    '@ m2att',
    '$8=++$8',
    'break',
    '#AsyncFail.RELEASE_L',
    '$9=++$9',
    'break',
    '#FINISH',
    'exit 0',
    'break',
    '',
  ].join('\n'),
);

const waitFields = [
  'waitFrames',
  'waitMotion',
  'waitSound',
  'waitObjects',
  'transitionUntil',
  'commandDelayUntil',
  'deferredCommandReturn',
];
function frame(instance) {
  return {
    suspended: structuredClone(instance.suspended),
    decodePending: instance.decodePending,
    eventObject: instance.eventObject,
    nativeContext: structuredClone(instance.nativeContext),
    executingLabel: instance.executingLabel,
    executingLine: instance.executingLine,
    waits: Object.fromEntries(waitFields.map((key) => [key, instance[key]])),
  };
}
function observeCommands(t, instance, world, calls, getters) {
  const command = instance.runtime.command,
    argument = instance.argumentBytes;
  t.mock.method(instance, 'argumentBytes', function (token, ...args) {
    getters.push({ label: this.executingLabel, line: this.executingLine, token: text(token) });
    return argument.call(this, token, ...args);
  });
  t.mock.method(instance.runtime, 'command', function (verb, selection, args, context) {
    if (verb === 'getid') {
      const call = {
        reference: { nameBytes: selection.nameBytes.slice(), index: selection.index },
        current: instance.nativeContext.current,
        commandBytes: context.commandBytes.slice(),
        commandPointer: context.commandPointer,
        objectNameAddress: context.objectNameAddress,
      };
      assert.equal(world.fesSources.string(call.objectNameAddress), text(call.reference.nameBytes));
      assert.equal(world.fesSources.string(call.commandPointer), text(call.commandBytes));
      calls.push(call);
    }
    return command.call(this, verb, selection, args, context);
  });
}
async function declareButtons(h, name, count) {
  const data = new Uint8Array(36),
    view = new DataView(data.buffer);
  data.set(ascii(name));
  view.setUint32(32, count, true);
  await h.world.sendEngine(
    h.id,
    h.world.main.id,
    338,
    0,
    FES_OBJECT_DEFINITION_ORDER.indexOf('BUTTON'),
    {
      payload: {
        string: (at) => text(data.subarray(at, data.indexOf(0, at))),
        bytes: (at, length) => data.subarray(at, at + length),
        load: (at) => view.getUint32(at, true),
      },
    },
  );
}
function installClipboard(h, instance) {
  const service = h.world.host.nativeClipboard,
    io = { writes: [], reentries: [], replaced: null, closing: null };
  assert.ok(service instanceof BrowserNativeClipboard);
  service.clipboard = {
    async writeText(value) {
      io.writes.push(value);
      if (value === 'public-press') {
        const saved = frame(instance);
        assert.ok(instance.runtime.platform.inFlight);
        assert.ok(instance.player.publicPushPending.size > 0);
        await h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
          payload: fesLabelPayload(() => ascii('REENTER')),
        });
        assert.deepEqual(frame(instance), saved);
        io.reentries.push(structuredClone(instance.nativeContext));
      } else if (value === 'replace-press') {
        const old = instance.collection.lookup(ascii('Replace'), 1);
        await instance.collection.remove(old);
        await declareButtons(h, 'Replace', 2);
        const replacement = instance.collection.lookup(ascii('Replace'), 1);
        assert.notStrictEqual(replacement, old);
        assert.notEqual(replacement.handle, old.handle);
        assert.equal(replacement.nativeType, 6);
        io.replaced = { old, replacement };
      } else if (value === 'close-press') {
        io.closing = h.world.objects.release(h.id);
        await io.closing;
      }
    },
  };
  return io;
}

for (const profile of startupProfiles) {
  test('normal public BUTTON press preserves complete action order: ' + profile, async (t) => {
    const h = await environment(profile, source);
    let fresh;
    try {
      const root = await h.load(),
        player = root.player;
      assert.equal(h.words.capacity, 64);
      for (const index of [2, 3, 4, 5, 6, 8, 9]) h.words.set(index, 0);
      for (let index = 50; index < 64; index++) h.words.set(index, 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      const first = root.collection.lookup(ascii('Choice'), 1),
        other = root.collection.lookup(ascii('Other'), 0),
        silent = root.collection.lookup(ascii('Silent'), 0),
        firstRef = root.collection.reference(first),
        otherRef = root.collection.reference(other),
        saved = frame(root),
        rng = h.world.random.snapshot(),
        calls = [],
        getters = [],
        events = [],
        io = installClipboard(h, root),
        dispatch = root.dispatchEvent;
      for (const object of [first, other, silent]) {
        assert.equal(object.type, 'BUTTON');
        assert.equal(object.nativeType, 6);
        assert.equal(Number.isInteger(object.idIndex), true);
      }
      assert.equal(firstRef.index, 1);
      assert.equal(otherRef.index, 0);
      assert.notEqual(first.handle, other.handle);
      observeCommands(t, root, h.world, calls, getters);
      t.mock.method(root, 'dispatchEvent', function (object, event, settled) {
        events.push({ object, event, clickL: this.clickL, completed: h.words.get(58) });
        return dispatch.call(this, object, event, settled);
      });

      player.focus(null);
      assert.equal(player.press(), false);
      player.focus({ s: root, o: other });
      assert.equal(player.press(), true);
      assert.strictEqual(player.focused.o, other);
      assert.deepEqual([h.words.get(50), h.words.get(51)], [1, 1]);
      assert.equal(root.clickL, other.handle);
      assert.equal(player.publicPushPending.size, 0);
      assert.deepEqual(
        events.map((entry) => [entry.object, entry.event, entry.clickL]),
        [
          [other, 'PUSH_L', 0],
          [other, 'RELEASE_L', other.handle],
        ],
        'a genuinely synchronous press completes its callbacks and field write inline',
      );

      player.focus({ s: root, o: silent });
      const count = events.length;
      assert.equal(player.press(), true);
      assert.equal(root.clickL, silent.handle);
      assert.equal(events.length, count, 'missing handlers are successful no-ops');
      assert.equal(player.publicPushPending.size, 0);
      player.focus({ s: root, o: other });
      assert.equal(player.press(), true);
      assert.deepEqual([h.words.get(50), h.words.get(51)], [2, 2]);
      events.length = 0;
      assert.deepEqual(frame(root), saved);

      player.focus({ s: root, o: first });
      assert.equal(player.press(), true);
      assert.strictEqual(player.focused.o, first);
      assert.equal(h.words.get(52), 1);
      assert.equal(h.words.get(53), 0);
      assert.equal(
        root.clickL,
        other.handle,
        'PUSH must settle before press commits its captured object handle',
      );
      assert.equal(h.words.get(54), 0);
      assert.ok(player.publicPushPending.size > 0);
      assert.throws(() => player.snapshot(), /public push is in flight/);

      // Capture another public action while the first real getid/clipboard awaits.
      player.focus({ s: root, o: other });
      assert.equal(player.press(), true);
      assert.strictEqual(player.focused.o, other);
      assert.deepEqual([h.words.get(50), h.words.get(51)], [2, 2]);
      assert.equal(root.clickL, other.handle);
      await player.flush();
      assert.deepEqual(
        events.map((entry) => [entry.object, entry.event, entry.clickL, entry.completed]),
        [
          [first, 'PUSH_L', other.handle, 0],
          [first, 'RELEASE_L', first.handle, 0],
          [other, 'PUSH_L', first.handle, 1],
          [other, 'RELEASE_L', other.handle, 1],
        ],
        'the first captured target finishes RELEASE before the next queued action begins',
      );
      assert.deepEqual(
        calls.map((call) => [call.reference, text(call.commandBytes), call.current]),
        [
          [firstRef, '@ getid 55', 1],
          [otherRef, 'Other getid 63', 0],
          [firstRef, '@ getid 56', 1],
          [firstRef, '@ getid 57', 1],
        ],
      );
      assert.deepEqual(
        [55, 56, 57, 63].map((index) => h.words.get(index)),
        [first.idIndex, first.idIndex, first.idIndex, other.idIndex],
        'BUTTON selector outputs do not stand in for its lifetime handle or S9 address',
      );
      for (const [label, line, head] of [
        ['Choice.PUSH_L', 2, '@'],
        ['Choice.PUSH_L', 4, '@'],
        ['Choice.RELEASE_L', 2, '@'],
        ['REENTER', 1, 'Other'],
      ]) {
        const tokens = getters.filter((entry) => entry.label === label && entry.line === line);
        assert.equal(tokens.filter((entry) => entry.token === head).length, 1);
        assert.equal(tokens.filter((entry) => entry.token === 'getid').length, 1);
      }
      assert.deepEqual(
        [50, 51, 52, 53, 54, 58, 62].map((index) => h.words.get(index)),
        [3, 3, 1, 1, 1, 1, 1],
      );
      assert.deepEqual(io.writes, ['', 'public-press', '', 'public-release']);
      assert.deepEqual(io.reentries, [{ ...firstRef, current: 1 }]);
      assert.deepEqual(frame(root), saved);
      assert.equal(player.pending.size, 0);
      assert.equal(player.publicPushPending.size, 0);
      assert.deepEqual(h.world.random.snapshot(), rng);

      fresh = await freshCheckpoint(t, h, profile);
      const fRoot = fresh.world.objects.objects.get(h.id).implementation.player.root,
        fPlayer = fRoot.player,
        fWords = fresh.world.runtime.variableBank(fresh.world.main, false),
        fInitialClick = 0,
        fSaved = frame(fRoot),
        fOther = fRoot.collection.lookup(otherRef.nameBytes, otherRef.index),
        fSync = fRoot.collection.lookup(ascii('SyncFail'), 0),
        fRelease = fRoot.collection.lookup(ascii('ReleaseFail'), 0),
        fAsync = fRoot.collection.lookup(ascii('AsyncFail'), 0);
      assert.strictEqual(fPlayer.focused.o, fOther);
      assert.notStrictEqual(fOther, other);
      assert.equal(fRoot.clickL, fInitialClick);
      assert.deepEqual(fSaved, { ...saved, executingLabel: undefined, executingLine: undefined });
      assert.deepEqual(
        [50, 51, 52, 53, 54, 58, 62].map((index) => fWords.get(index)),
        [3, 3, 1, 1, 1, 1, 1],
      );
      assert.equal(fPlayer.publicPushPending.size, 0);

      let synchronousError;
      const execute = fRoot.execute;
      t.mock.method(fRoot, 'execute', function (...args) {
        try {
          return execute.apply(this, args);
        } catch (error) {
          synchronousError = error;
          throw error;
        }
      });
      fPlayer.focus({ s: fRoot, o: fSync });
      assert.throws(
        () => fPlayer.press(),
        (error) => {
          assert.strictEqual(error, synchronousError);
          assert.match(error.message, /FES whole-row evaluator is pending: K2B_UNKNOWN_HEAD/);
          return true;
        },
      );
      assert.deepEqual([fWords.get(2), fWords.get(3)], [1, 0]);
      assert.equal(fRoot.clickL, fInitialClick);
      assert.deepEqual(frame(fRoot), fSaved);
      assert.equal(fPlayer.publicPushPending.size, 0);
      assert.equal(fPlayer.error, null);
      await fPlayer.flush();

      fPlayer.focus({ s: fRoot, o: fRelease });
      assert.throws(
        () => fPlayer.press(),
        (error) => {
          assert.strictEqual(error, synchronousError);
          assert.match(error.message, /FES whole-row evaluator is pending: K2B_RELEASE_UNKNOWN/);
          return true;
        },
      );
      assert.deepEqual([fWords.get(4), fWords.get(5)], [1, 1]);
      assert.equal(
        fRoot.clickL,
        fRelease.handle,
        'synchronous RELEASE fails after the field write',
      );
      assert.deepEqual(frame(fRoot), fSaved);
      assert.equal(fPlayer.publicPushPending.size, 0);
      assert.equal(fPlayer.error, null);
      await fPlayer.flush();

      let asynchronousError;
      const command = fRoot.runtime.command;
      t.mock.method(fRoot.runtime, 'command', function (...args) {
        const result = command.apply(this, args);
        if (args[0] === 'm2att')
          result.catch((error) => {
            asynchronousError = error;
          });
        return result;
      });
      fPlayer.focus({ s: fRoot, o: fAsync });
      assert.equal(fPlayer.press(), true);
      assert.equal(fWords.get(6), 1);
      assert.equal(fRoot.clickL, fRelease.handle);
      assert.throws(() => fPlayer.snapshot(), /public push is in flight/);
      await assert.rejects(fPlayer.flush(), (error) => {
        assert.strictEqual(error, asynchronousError);
        assert.match(error.message, /Unimplemented FES raw6 command m2att/);
        return true;
      });
      assert.deepEqual([fWords.get(8), fWords.get(9)], [0, 0]);
      assert.deepEqual(frame(fRoot), fSaved);
      assert.strictEqual(fPlayer.error, asynchronousError);
      assert.equal(fPlayer.publicPushPending.size, 0);
      await fRoot.notify('FINISH');
      assert.equal(fRoot.finished, 0);
      fPlayer.focus({ s: fRoot, o: fSync });
      assert.equal(fPlayer.press(), true, 'finished callbacks do not cancel the admission result');
      assert.equal(fRoot.clickL, fSync.handle);
      assert.deepEqual([fWords.get(2), fWords.get(3)], [1, 0]);
      assert.equal(fPlayer.publicPushPending.size, 0);

      const replaced = root.collection.lookup(ascii('Replace'), 1),
        beforeReplace = root.clickL,
        releases = events.filter((entry) => entry.event === 'RELEASE_L').length;
      player.focus({ s: root, o: replaced });
      assert.equal(player.press(), true);
      assert.equal(root.clickL, beforeReplace);
      await player.flush();
      assert.strictEqual(io.replaced.old, replaced);
      assert.strictEqual(root.collection.lookup(ascii('Replace'), 1), io.replaced.replacement);
      assert.equal(replaced.deleted, true);
      assert.equal(
        root.clickL,
        beforeReplace,
        'replacement cannot receive the old captured commit',
      );
      assert.equal(h.words.get(59), 0);
      assert.equal(h.words.get(61), 1);
      assert.equal(events.filter((entry) => entry.event === 'RELEASE_L').length, releases);
      assert.deepEqual(frame(root), saved);
      assert.equal(player.publicPushPending.size, 0);

      const closing = root.collection.lookup(ascii('Close'), 0),
        beforeClose = root.clickL;
      player.focus({ s: root, o: closing });
      assert.equal(player.press(), true);
      assert.equal(root.clickL, beforeClose);
      await player.flush();
      assert.ok(io.closing);
      await io.closing;
      assert.equal(h.world.objects.objects.has(h.id), false);
      assert.equal(root.runtime.closed, true);
      assert.equal(root.clickL, beforeClose, 'close cancels the pending field write');
      assert.equal(h.words.get(60), 0);
      assert.equal(h.words.get(61), 1);
      assert.equal(events.filter((entry) => entry.event === 'RELEASE_L').length, releases);
      assert.equal(player.publicPushPending.size, 0);
      assert.deepEqual(h.world.random.snapshot(), rng);
      assert.equal(fresh.world.nativeEngine, undefined);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}

const nonButtonSource = ascii(
  [
    '#DEFINE',
    'CPLANE Choice[2]',
    'CPLANE Other',
    'CPLANE Silent',
    '#OBJECT SIZE POS DISP',
    'Choice 6,4 4,5 1',
    'Other 6,4 20,5 1',
    'Silent 6,4 30,5 1',
    '#START',
    'wait 1',
    'next IDLE',
    '#IDLE',
    'break',
    '#Other.PUSH_L',
    '$50=++$50',
    'break',
    '#Other.RELEASE_L',
    '$51=++$51',
    'break',
    '#Choice.PUSH_L',
    '$52=++$52',
    '@ getid 55',
    'clipboard (:public-press)',
    '@ getid 56',
    '$53=++$53',
    'break',
    '#Choice.RELEASE_L',
    '$54=++$54',
    '@ getid 57',
    'clipboard (:public-release)',
    '$58=++$58',
    'break',
    '#REENTER',
    'Other getid 63',
    '$62=++$62',
    'break',
    '',
  ].join('\n'),
);

for (const profile of startupProfiles) {
  test('normal public non-BUTTON press preserves complete action order: ' + profile, async (t) => {
    const h = await environment(profile, nonButtonSource);
    let fresh;
    try {
      const root = await h.load(),
        player = root.player;
      for (let index = 50; index < 64; index++) h.words.set(index, 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      const first = root.collection.lookup(ascii('Choice'), 1),
        other = root.collection.lookup(ascii('Other'), 0),
        silent = root.collection.lookup(ascii('Silent'), 0),
        firstRef = { nameBytes: ascii('Choice'), index: 1 },
        otherRef = { nameBytes: ascii('Other'), index: 0 },
        saved = frame(root),
        rng = h.world.random.snapshot(),
        calls = [],
        getters = [],
        events = [],
        producers = [],
        io = installClipboard(h, root),
        dispatch = root.dispatchEvent,
        firstOwned = { ...firstRef, current: 1 },
        notifyOwned = { nameBytes: new Uint8Array(), index: 0, current: 0 },
        expected = [
          {
            label: 'Choice.PUSH_L',
            line: 2,
            head: '@',
            row: '@ getid 55',
            slot: 55,
            ref: firstRef,
            owned: firstOwned,
          },
          {
            label: 'REENTER',
            line: 1,
            head: 'Other',
            row: 'Other getid 63',
            slot: 63,
            ref: otherRef,
            owned: notifyOwned,
          },
          {
            label: 'Choice.PUSH_L',
            line: 4,
            head: '@',
            row: '@ getid 56',
            slot: 56,
            ref: firstRef,
            owned: firstOwned,
          },
          {
            label: 'Choice.RELEASE_L',
            line: 2,
            head: '@',
            row: '@ getid 57',
            slot: 57,
            ref: firstRef,
            owned: firstOwned,
          },
        ];
      for (const object of [first, other, silent]) {
        assert.equal(object.type, 'CPLANE');
        assert.equal(object.nativeType, 3);
      }
      assert.deepEqual(root.collection.reference(first), firstRef);
      assert.deepEqual(root.collection.reference(other), otherRef);
      assert.notEqual(first.handle, other.handle);
      observeCommands(t, root, h.world, calls, getters);
      const command = root.runtime.command;
      t.mock.method(root.runtime, 'command', function (verb, selection, args, context) {
        if (verb === 'getid') {
          const entry = expected[producers.length],
            arena = h.world.fesSources,
            record = arena.programs.get(root.program.sourceKey).blocks[entry.label][entry.line - 1],
            row = ascii(entry.row),
            nameAddress = record.names.get(fesByteView(entry.ref.nameBytes)),
            rowAddress = record.copies.get(fesByteView(row));
          // Observe the actual producer record after context() populated it.
          // Never call context() here or derive this oracle from its consumer.
          assert.equal(root.executingLabel, entry.label);
          assert.equal(root.executingLine, entry.line);
          assert.deepEqual(record.bytes, row);
          assert.deepEqual(selection, entry.ref);
          assert.deepEqual(root.nativeContext, entry.owned);
          for (const [address, bytes] of [
            [nameAddress, entry.ref.nameBytes],
            [rowAddress, row],
          ]) {
            assert.ok(Number.isInteger(address));
            assert.ok(
              address >= arena.base && address + bytes.length + 1 <= arena.base + arena.used,
            );
            assert.deepEqual(arena.read(address, bytes.length + 1), Uint8Array.from([...bytes, 0]));
          }
          assert.notEqual(nameAddress, first.handle);
          assert.notEqual(nameAddress, other.handle);
          assert.equal(context.objectNameAddress, nameAddress);
          assert.equal(context.commandPointer, rowAddress);
          assert.deepEqual(context.commandBytes, row);
          producers.push({ nameAddress, rowAddress });
        }
        return command.call(this, verb, selection, args, context);
      });
      t.mock.method(root, 'dispatchEvent', function (object, event, settled) {
        events.push({ object, event, clickL: this.clickL, completed: h.words.get(58) });
        return dispatch.call(this, object, event, settled);
      });

      player.focus({ s: root, o: other });
      assert.equal(player.press(), true);
      assert.strictEqual(player.focused.o, other);
      assert.deepEqual([h.words.get(50), h.words.get(51)], [1, 1]);
      assert.equal(root.clickL, other.handle);
      assert.equal(player.publicPushPending.size, 0);
      assert.deepEqual(
        events.map((entry) => [entry.object, entry.event, entry.clickL]),
        [
          [other, 'PUSH_L', 0],
          [other, 'RELEASE_L', other.handle],
        ],
      );
      player.focus({ s: root, o: silent });
      const count = events.length;
      assert.equal(player.press(), true);
      assert.equal(root.clickL, silent.handle);
      assert.equal(events.length, count);
      assert.equal(player.publicPushPending.size, 0);
      player.focus({ s: root, o: other });
      assert.equal(player.press(), true);
      assert.deepEqual([h.words.get(50), h.words.get(51)], [2, 2]);
      events.length = 0;
      assert.deepEqual(frame(root), saved);

      player.focus({ s: root, o: first });
      assert.equal(player.press(), true);
      assert.strictEqual(player.focused.o, first);
      assert.equal(h.words.get(52), 1);
      assert.equal(h.words.get(53), 0);
      assert.equal(root.clickL, other.handle, 'CPLANE PUSH must settle before the clickL write');
      assert.equal(h.words.get(54), 0);
      assert.ok(player.publicPushPending.size > 0);
      assert.throws(() => player.snapshot(), /public push is in flight/);
      player.focus({ s: root, o: other });
      assert.equal(player.press(), true);
      assert.strictEqual(player.focused.o, other);
      assert.deepEqual([h.words.get(50), h.words.get(51)], [2, 2]);
      assert.equal(root.clickL, other.handle);
      await player.flush();
      assert.deepEqual(
        events.map((entry) => [entry.object, entry.event, entry.clickL, entry.completed]),
        [
          [first, 'PUSH_L', other.handle, 0],
          [first, 'RELEASE_L', first.handle, 0],
          [other, 'PUSH_L', first.handle, 1],
          [other, 'RELEASE_L', other.handle, 1],
        ],
      );
      assert.equal(producers.length, expected.length);
      assert.deepEqual(
        calls.map((call) => [call.reference, text(call.commandBytes), call.current]),
        expected.map((entry) => [entry.ref, entry.row, entry.ref.index]),
      );
      for (const [index, entry] of expected.entries()) {
        assert.equal(h.words.get(entry.slot), producers[index].nameAddress);
        const tokens = getters.filter(
          (value) => value.label === entry.label && value.line === entry.line,
        );
        assert.equal(tokens.filter((value) => value.token === entry.head).length, 1);
        assert.equal(tokens.filter((value) => value.token === 'getid').length, 1);
      }
      assert.deepEqual(
        [50, 51, 52, 53, 54, 58, 62].map((index) => h.words.get(index)),
        [3, 3, 1, 1, 1, 1, 1],
      );
      assert.deepEqual(io.writes, ['', 'public-press', '', 'public-release']);
      assert.deepEqual(io.reentries, [{ ...firstRef, current: 1 }]);
      assert.deepEqual(frame(root), saved);
      assert.equal(player.pending.size, 0);
      assert.equal(player.publicPushPending.size, 0);
      assert.deepEqual(h.world.random.snapshot(), rng);

      fresh = await freshCheckpoint(t, h, profile);
      const fRoot = fresh.world.objects.objects.get(h.id).implementation.player.root,
        fPlayer = fRoot.player,
        fWords = fresh.world.runtime.variableBank(fresh.world.main, false),
        fOther = fRoot.collection.lookup(otherRef.nameBytes, otherRef.index),
        fSaved = frame(fRoot);
      assert.equal(fOther.nativeType, 3);
      assert.strictEqual(fPlayer.focused.o, fOther);
      assert.notStrictEqual(fOther, other);
      assert.equal(fRoot.clickL, 0);
      assert.deepEqual(fSaved, { ...saved, executingLabel: undefined, executingLine: undefined });
      assert.deepEqual(
        [50, 51, 52, 53, 54, 58, 62].map((index) => fWords.get(index)),
        [3, 3, 1, 1, 1, 1, 1],
      );
      for (const [index, entry] of expected.entries()) {
        const record = fresh.world.fesSources.programs.get(fRoot.program.sourceKey).blocks[
          entry.label
        ][entry.line - 1];
        assert.equal(
          record.names.get(fesByteView(entry.ref.nameBytes)),
          producers[index].nameAddress,
        );
        assert.equal(record.copies.get(fesByteView(ascii(entry.row))), producers[index].rowAddress);
        assert.equal(fWords.get(entry.slot), producers[index].nameAddress);
      }
      assert.equal(fPlayer.press(), true);
      assert.deepEqual([fWords.get(50), fWords.get(51)], [4, 4]);
      assert.equal(fRoot.clickL, fOther.handle);
      assert.deepEqual(frame(fRoot), fSaved);
      assert.equal(fPlayer.publicPushPending.size, 0);
      assert.equal(fresh.world.nativeEngine, undefined);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}

const clickNames = [
  'Hit',
  'Next[2]',
  'AltHit',
  'Sync',
  'Silent',
  'AwaitOld',
  'Plain',
  'Queue',
  'OldDelete',
  'ReplaceHit',
  'CloseHit',
  'BadU',
  'BadF',
  'AsyncBadU',
  'AsyncBadF',
  'Decline',
];
const clickBlocks = {
  'Hit.FOCUS': [
    '$50=++$50',
    '@ getid 55',
    'clipboard (:click-focus)',
    'Next[1] setact',
    'lockactive 0',
    '$51=++$51',
    'break',
  ],
  'Hit.PUSH_L': ['$40=++$40', 'break'],
  'Hit.RELEASE_L': ['$41=++$41', 'break'],
  'Next.FOCUS': ['$53=++$53', 'break'],
  'Next.UNFOCUS': ['$61=++$61', 'break'],
  'Next.PUSH_L': ['$42=++$42', '@ getid 56', 'break'],
  'Next.RELEASE_L': ['$43=++$43', '@ getid 57', 'clipboard (:click-release)', '$52=++$52', 'break'],
  'AltHit.FOCUS': ['$54=++$54', '@ getid 58', 'clipboard (:plane-focus)', 'break'],
  'AltHit.PUSH_L': ['$44=++$44', 'break'],
  'AltHit.RELEASE_L': ['$45=++$45', 'break'],
  'Plane.PUSH_L': ['$46=++$46', '@ getid 59', 'clipboard (:plane-press)', 'break'],
  'Plane.RELEASE_L': [
    '$47=++$47',
    '@ getid 60',
    'clipboard (:plane-release)',
    '$48=++$48',
    'break',
  ],
  REENTER: ['Next[1] getid 63', '$62=++$62', 'break'],
  'Sync.FOCUS': ['$10=++$10', 'break'],
  'Sync.UNFOCUS': ['$11=++$11', 'break'],
  'Sync.PUSH_L': ['$12=++$12', 'break'],
  'Sync.RELEASE_L': ['$13=++$13', 'break'],
  'AwaitOld.UNFOCUS': ['$14=++$14', 'clipboard (:unfocus-click)', '$15=++$15', 'break'],
  'Plain.FOCUS': ['$16=++$16', 'break'],
  'Plain.PUSH_L': ['$17=++$17', 'break'],
  'Plain.RELEASE_L': ['$18=++$18', 'break'],
  'Queue.FOCUS': ['$19=++$19', 'break'],
  'Queue.PUSH_L': ['$20=++$20', 'break'],
  'Queue.RELEASE_L': ['$21=++$21', 'break'],
  'OldDelete.UNFOCUS': ['clipboard (:delete-old)', '$22=++$22', 'break'],
  'ReplaceHit.FOCUS': ['clipboard (:replace-hit)', '$23=++$23', 'break'],
  'ReplaceHit.PUSH_L': ['$24=++$24', 'break'],
  'ReplaceHit.RELEASE_L': ['$25=++$25', 'break'],
  'CloseHit.FOCUS': ['clipboard (:close-hit)', '$26=++$26', 'break'],
  'CloseHit.PUSH_L': ['$27=++$27', 'break'],
  'CloseHit.RELEASE_L': ['$28=++$28', 'break'],
  'BadU.UNFOCUS': ['$29=++$29', 'K2_CLICK_UNKNOWN_U', 'break'],
  'BadF.FOCUS': ['$30=++$30', 'K2_CLICK_UNKNOWN_F', 'break'],
  'AsyncBadU.UNFOCUS': ['$31=++$31', '@ m2att', '$32=++$32', 'break'],
  'AsyncBadF.FOCUS': ['$33=++$33', '@ m2att', '$34=++$34', 'break'],
  'Decline.FOCUS': ['clipboard (:decline-click)', 'break'],
  'Decline.PUSH_L': ['$35=++$35', 'break'],
  'Decline.RELEASE_L': ['$36=++$36', 'break'],
};
const clickSource = ascii(
  [
    '#DEFINE',
    ...clickNames.map((name) => 'BUTTON ' + name),
    'CPLANE Plane[2]',
    '#OBJECT SIZE POS DISP',
    ...clickNames.map(
      (name, index) =>
        name.replace(/\[.*$/, '') +
        ' 6,4 ' +
        (1 + (index % 6) * 10) +
        ',' +
        (1 + Math.floor(index / 6) * 10) +
        ' 1',
    ),
    'Plane 6,4 51,35 1',
    '#START',
    'wait 1',
    'next IDLE',
    '#IDLE',
    'break',
    ...Object.entries(clickBlocks).flatMap(([label, lines]) => ['#' + label, ...lines]),
    '',
  ].join('\n'),
);
async function clickTrial(profile) {
  const h = await environment(profile, clickSource);
  try {
    const root = await h.load();
    for (let index = 10; index < 64; index++) h.words.set(index, 0);
    await h.world.sendEngine(h.id, h.world.main.id, 333);
    return {
      h,
      root,
      fes: root.player,
      get: (name, index = 0) => root.collection.lookup(ascii(name), index),
    };
  } catch (error) {
    await h.close();
    throw error;
  }
}
function clickAt(root, object) {
  const rect = root.rect(object);
  assert.ok(rect?.w > 0 && rect?.h > 0);
  const x = rect.x + rect.w / 2,
    y = rect.y + rect.h / 2;
  assert.strictEqual(
    root.player.hit(x, y)?.o,
    object,
    'the real geometry must hit this owned BUTTON',
  );
  return root.player.click(x, y);
}
function clickClipboard(trial) {
  const { h, root, fes, get } = trial,
    service = h.world.host.nativeClipboard,
    io = { writes: [], reentries: [], replaced: null, deletedOld: null, closing: null };
  assert.ok(service instanceof BrowserNativeClipboard);
  service.clipboard = {
    async writeText(value) {
      io.writes.push(value);
      if (value === 'click-focus' || value === 'plane-press') {
        const saved = frame(root);
        assert.ok(root.runtime.platform.inFlight);
        assert.ok(fes.publicPushPending.size > 0);
        await h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
          payload: fesLabelPayload(() => ascii('REENTER')),
        });
        assert.deepEqual(frame(root), saved);
        io.reentries.push(structuredClone(root.nativeContext));
      } else if (value === 'plane-focus') {
        // setact is BUTTON-only. The actual clipboard host uses public focus for raw3.
        const plane = get('Plane', 1);
        fes.focus({ s: root, o: plane });
        assert.strictEqual(fes.focused.o, plane);
        assert.deepEqual(fes.nativeInput.state.focus, root.collection.reference(plane));
      } else if (value === 'unfocus-click') {
        // Neither Plain.UNFOCUS nor Silent.FOCUS has a handler. This public
        // redirect must survive the outer click's awaited UNFOCUS continuation.
        fes.focus({ s: root, o: get('Silent') });
      } else if (value === 'delete-old') {
        io.deletedOld = get('OldDelete');
        await root.collection.remove(io.deletedOld);
      } else if (value === 'replace-hit') {
        const old = get('ReplaceHit');
        await root.collection.remove(old);
        await declareButtons(h, 'ReplaceHit', 1);
        const replacement = get('ReplaceHit');
        assert.notStrictEqual(replacement, old);
        assert.notEqual(replacement.handle, old.handle);
        io.replaced = { old, replacement };
      } else if (value === 'decline-click') {
        // Change the existing semantic enable flag during a real host await,
        // as the accepted push admission fixture does.
        get('Decline').enable = false;
      } else if (value === 'close-hit') {
        io.closing = h.world.objects.release(h.id);
        await io.closing;
      }
    },
  };
  return io;
}
function observeClickSource(t, trial) {
  const { h, root, get } = trial,
    calls = [],
    getters = [],
    produced = [],
    specs = {
      'Hit.FOCUS': { name: 'Hit', index: 0, raw: 6, line: 2, slot: 55, head: '@' },
      'Next.PUSH_L': { name: 'Next', index: 1, raw: 6, line: 2, slot: 56, head: '@' },
      'Next.RELEASE_L': { name: 'Next', index: 1, raw: 6, line: 2, slot: 57, head: '@' },
      'AltHit.FOCUS': { name: 'AltHit', index: 0, raw: 6, line: 2, slot: 58, head: '@' },
      'Plane.PUSH_L': { name: 'Plane', index: 1, raw: 3, line: 2, slot: 59, head: '@' },
      'Plane.RELEASE_L': { name: 'Plane', index: 1, raw: 3, line: 2, slot: 60, head: '@' },
      REENTER: { name: 'Next', index: 1, raw: 6, line: 1, slot: 63, head: 'Next[1]', notify: true },
    };
  observeCommands(t, root, h.world, calls, getters);
  const command = root.runtime.command;
  t.mock.method(root.runtime, 'command', function (verb, selection, args, context) {
    if (verb === 'getid') {
      const label = root.executingLabel,
        spec = specs[label],
        object = get(spec.name, spec.index),
        reference = { nameBytes: ascii(spec.name), index: spec.index },
        row = spec.head + ' getid ' + spec.slot,
        arena = h.world.fesSources,
        record = arena.programs.get(root.program.sourceKey).blocks[label][spec.line - 1],
        nameAddress = record.names.get(fesByteView(reference.nameBytes)),
        rowAddress = record.copies.get(row),
        owner = spec.notify
          ? { nameBytes: new Uint8Array(), index: 0, current: 0 }
          : { ...reference, current: reference.index };
      assert.equal(object.nativeType, spec.raw);
      assert.deepEqual(root.collection.reference(object), reference);
      assert.equal(root.executingLine, spec.line);
      assert.deepEqual(selection, reference);
      assert.deepEqual(root.nativeContext, owner);
      assert.deepEqual(record.bytes, ascii(row));
      for (const [address, bytes] of [
        [nameAddress, reference.nameBytes],
        [rowAddress, ascii(row)],
      ]) {
        assert.ok(Number.isInteger(address));
        assert.ok(address >= arena.base && address + bytes.length + 1 <= arena.base + arena.used);
        assert.deepEqual(arena.read(address, bytes.length + 1), Uint8Array.from([...bytes, 0]));
      }
      assert.equal(context.objectNameAddress, nameAddress);
      assert.equal(context.commandPointer, rowAddress);
      assert.deepEqual(context.commandBytes, ascii(row));
      const occurrences = produced.filter((entry) => entry.label === label).length + 1,
        tokens = getters.filter((entry) => entry.label === label && entry.line === spec.line);
      assert.equal(tokens.filter((entry) => entry.token === spec.head).length, occurrences);
      assert.equal(tokens.filter((entry) => entry.token === 'getid').length, occurrences);
      produced.push({
        label,
        slot: spec.slot,
        reference,
        current: owner.current,
        nameAddress,
        rowAddress,
        expected: spec.raw === 3 ? nameAddress : object.idIndex | 0,
      });
    }
    return command.call(this, verb, selection, args, context);
  });
  return {
    calls,
    produced,
    check() {
      assert.deepEqual(
        calls.map((entry) => [
          entry.reference,
          entry.current,
          entry.objectNameAddress,
          entry.commandPointer,
        ]),
        produced.map((entry) => [
          entry.reference,
          entry.current,
          entry.nameAddress,
          entry.rowAddress,
        ]),
      );
      for (const entry of produced) assert.equal(h.words.get(entry.slot), entry.expected);
    },
  };
}

for (const profile of startupProfiles) {
  test(
    'normal public BUTTON click waits for owned focus before capturing press: ' + profile,
    async (t) => {
      const trial = await clickTrial(profile),
        { h, root, fes, get } = trial;
      let fresh;
      try {
        const hit = get('Hit'),
          next = get('Next', 1),
          saved = frame(root),
          rng = h.world.random.snapshot(),
          io = clickClipboard(trial),
          sourceCalls = observeClickSource(t, trial),
          events = [],
          fifo = [],
          dispatch = root.dispatchEvent,
          flushRecords = root.runtime.flushRecords;
        assert.equal(hit.nativeType, 6);
        assert.equal(next.nativeType, 6);
        t.mock.method(root, 'dispatchEvent', function (object, event, settled) {
          events.push({
            object,
            event,
            reference: this.collection.reference(object),
            clickL: this.clickL,
            releaseDone: h.words.get(52),
          });
          return dispatch.call(this, object, event, settled);
        });
        t.mock.method(root.runtime, 'flushRecords', function (...args) {
          if (this.pendingRecords.some((entry) => entry.operation === 'active-reference'))
            fifo.push(structuredClone(this.pendingRecords));
          return flushRecords.apply(this, args);
        });

        // First oracle is the existing asynchronous wrong receiver, before any
        // assertions about the new policy for a second queued click.
        fes.focus(null);
        assert.equal(clickAt(root, hit), true);
        await fes.flush();
        assert.strictEqual(fes.focused.o, next);
        assert.deepEqual(fifo[0], [
          { operation: 'active-reference', reference: { nameBytes: ascii('Next'), index: 1 } },
          { operation: 'active-lock', value: 0 },
        ]);
        assert.deepEqual(
          [40, 41, 42, 43].map((index) => h.words.get(index)),
          [0, 0, 1, 1],
          'click must capture Next[1] after its real FOCUS redirect settles',
        );
        assert.equal(root.clickL, next.handle);
        assert.equal(h.words.get(50), 1);
        assert.equal(h.words.get(51), 1);
        assert.equal(h.words.get(52), 1);
        assert.deepEqual(root.runtime.pendingRecords, []);
        sourceCalls.check();
        assert.deepEqual(frame(root), saved);
        assert.equal(fes.publicPushPending.size, 0);

        fresh = await freshCheckpoint(t, h, profile);
        const fRoot = fresh.world.objects.objects.get(h.id).implementation.player.root,
          fWords = fresh.world.runtime.variableBank(fresh.world.main, false),
          fSaved = frame(fRoot),
          fSilent = fRoot.collection.lookup(ascii('Silent'), 0);
        assert.deepEqual(fRoot.collection.reference(fRoot.player.focused.o), {
          nameBytes: ascii('Next'),
          index: 1,
        });
        assert.equal(fRoot.clickL, 0);
        assert.deepEqual(fSaved, { ...saved, executingLabel: undefined, executingLine: undefined });
        assert.deepEqual(
          [40, 41, 42, 43].map((index) => fWords.get(index)),
          [0, 0, 1, 1],
        );
        assert.equal(clickAt(fRoot, fSilent), true);
        assert.equal(fRoot.clickL, fSilent.handle);
        assert.deepEqual(frame(fRoot), fSaved);
        assert.equal(fRoot.player.publicPushPending.size, 0);

        fes.focus(null);
        events.length = 0;
        const sync = get('Sync');
        assert.equal(clickAt(root, sync), true);
        assert.deepEqual(
          [10, 12, 13].map((index) => h.words.get(index)),
          [1, 1, 1],
        );
        assert.strictEqual(fes.focused.o, sync);
        assert.equal(root.clickL, sync.handle);
        assert.equal(fes.publicPushPending.size, 0);
        assert.equal(clickAt(root, sync), true);
        assert.deepEqual(
          [10, 12, 13].map((index) => h.words.get(index)),
          [1, 2, 2],
        );
        assert.deepEqual(
          events.map((entry) => entry.event),
          ['FOCUS', 'PUSH_L', 'RELEASE_L', 'PUSH_L', 'RELEASE_L'],
        );
        assert.equal(fes.click(-1000, -1000), false);
        assert.equal(root.clickL, -1);
        assert.strictEqual(fes.focused.o, sync);
        const silent = get('Silent');
        assert.equal(clickAt(root, silent), true);
        assert.equal(root.clickL, silent.handle);
        assert.equal(fes.publicPushPending.size, 0);

        fes.focus({ s: root, o: get('AwaitOld') });
        assert.equal(clickAt(root, get('Plain')), true);
        assert.strictEqual(
          fes.focused.o,
          get('Plain'),
          'UNFOCUS prefix precedes immediate focused commit',
        );
        assert.equal(h.words.get(14), 1);
        assert.equal(h.words.get(15), 0);
        assert.equal(h.words.get(16), 0);
        await fes.flush();
        assert.strictEqual(
          fes.focused.o,
          silent,
          'awaited UNFOCUS must not commit hit again over a real redirect',
        );
        assert.equal(h.words.get(15), 1);
        assert.equal(h.words.get(16), 1);
        assert.deepEqual([h.words.get(17), h.words.get(18)], [0, 0]);
        assert.equal(root.clickL, silent.handle);
        assert.deepEqual(frame(root), saved);

        assert.equal(clickAt(root, get('AltHit')), true);
        await fes.flush();
        const plane = get('Plane', 1);
        assert.strictEqual(fes.focused.o, plane);
        assert.deepEqual(
          [44, 45, 46, 47, 48].map((index) => h.words.get(index)),
          [0, 0, 1, 1, 1],
        );
        assert.equal(root.clickL, plane.handle);
        sourceCalls.check();
        assert.deepEqual(io.reentries, [
          { nameBytes: ascii('Hit'), index: 0, current: 0 },
          { nameBytes: ascii('Plane'), index: 1, current: 1 },
        ]);

        fes.focus({ s: root, o: sync });
        events.length = 0;
        const releaseBefore = h.words.get(52),
          queue = get('Queue');
        assert.equal(clickAt(root, hit), true);
        assert.strictEqual(fes.focused.o, hit);
        assert.equal(clickAt(root, queue), true);
        assert.strictEqual(
          fes.focused.o,
          hit,
          'an already pending whole click does not commit focus at its caller',
        );
        assert.equal(h.words.get(19), 0);
        assert.throws(() => fes.snapshot(), /public push is in flight/);
        await fes.flush();
        assert.strictEqual(fes.focused.o, queue);
        assert.deepEqual(
          events
            .filter((entry) => ['PUSH_L', 'RELEASE_L'].includes(entry.event))
            .map((entry) => [entry.reference, entry.event]),
          [
            [{ nameBytes: ascii('Next'), index: 1 }, 'PUSH_L'],
            [{ nameBytes: ascii('Next'), index: 1 }, 'RELEASE_L'],
            [{ nameBytes: ascii('Queue'), index: 0 }, 'PUSH_L'],
            [{ nameBytes: ascii('Queue'), index: 0 }, 'RELEASE_L'],
          ],
        );
        const queueFocus = events.findIndex(
            (entry) => entry.object === queue && entry.event === 'FOCUS',
          ),
          previous = events
            .slice(0, queueFocus)
            .filter((entry) => entry.event === 'UNFOCUS')
            .at(-1);
        assert.strictEqual(previous.object, next, 'previous is read when the queued click begins');
        assert.equal(events[queueFocus].releaseDone, releaseBefore + 1);
        assert.deepEqual(
          [19, 20, 21].map((index) => h.words.get(index)),
          [1, 1, 1],
        );
        assert.equal(root.clickL, queue.handle);
        sourceCalls.check();
        assert.deepEqual(frame(root), saved);

        fes.focus({ s: root, o: get('OldDelete') });
        assert.equal(clickAt(root, get('Plain')), true);
        assert.strictEqual(fes.focused.o, get('Plain'));
        await fes.flush();
        assert.equal(io.deletedOld.deleted, true);
        assert.equal(h.words.get(22), 1);
        assert.deepEqual([h.words.get(17), h.words.get(18)], [1, 1]);
        assert.equal(
          root.clickL,
          get('Plain').handle,
          'old previous deletion cannot cancel a live new hit',
        );

        const beforeReplace = root.clickL,
          replacedHit = get('ReplaceHit');
        assert.equal(clickAt(root, replacedHit), true);
        await fes.flush();
        assert.strictEqual(io.replaced.old, replacedHit);
        assert.strictEqual(get('ReplaceHit'), io.replaced.replacement);
        assert.equal(replacedHit.deleted, true);
        assert.deepEqual(
          [23, 24, 25].map((index) => h.words.get(index)),
          [1, 0, 0],
        );
        assert.equal(root.clickL, beforeReplace);
        assert.equal(fes.publicPushPending.size, 0);
        const beforeDecline = root.clickL;
        assert.equal(clickAt(root, get('Decline')), true);
        await fes.flush();
        assert.equal(get('Decline').enable, false);
        assert.deepEqual([h.words.get(35), h.words.get(36)], [0, 0]);
        assert.equal(root.clickL, beforeDecline);

        let synchronousError;
        const execute = root.execute;
        t.mock.method(root, 'execute', function (...args) {
          try {
            return execute.apply(this, args);
          } catch (error) {
            synchronousError = error;
            throw error;
          }
        });
        const badU = get('BadU'),
          beforeError = root.clickL;
        fes.focus({ s: root, o: badU });
        assert.throws(
          () => clickAt(root, get('Plain')),
          (error) => {
            assert.strictEqual(error, synchronousError);
            assert.match(error.message, /FES whole-row evaluator is pending: K2_CLICK_UNKNOWN_U/);
            return true;
          },
        );
        assert.strictEqual(fes.focused.o, badU);
        assert.equal(h.words.get(29), 1);
        assert.equal(root.clickL, beforeError);
        assert.equal(fes.error, null);
        assert.equal(fes.publicPushPending.size, 0);
        await root.collection.remove(badU);
        const badF = get('BadF');
        assert.throws(
          () => clickAt(root, badF),
          (error) => {
            assert.strictEqual(error, synchronousError);
            assert.match(error.message, /FES whole-row evaluator is pending: K2_CLICK_UNKNOWN_F/);
            return true;
          },
        );
        assert.strictEqual(fes.focused.o, badF);
        assert.equal(h.words.get(30), 1);
        assert.equal(root.clickL, beforeError);
        assert.equal(fes.error, null);
        assert.equal(fes.publicPushPending.size, 0);
        await fes.flush();
        assert.deepEqual(frame(root), saved);
        assert.deepEqual(h.world.random.snapshot(), rng);

        // Each terminal failure/close gets a real fresh startup owner. No error
        // field or suspended stack is cleared to manufacture a continuation.
        for (const mode of ['unfocus-error', 'focus-error', 'close']) {
          const isolated = await clickTrial(profile),
            { h: ih, root: ir, fes: ip, get: ig } = isolated;
          try {
            const iSaved = frame(ir);
            clickClipboard(isolated);
            if (mode === 'close') {
              assert.equal(clickAt(ir, ig('CloseHit')), true);
              await ip.flush();
              assert.equal(ih.world.objects.objects.has(ih.id), false);
              assert.equal(ir.runtime.closed, true);
              assert.deepEqual(
                [26, 27, 28].map((index) => ih.words.get(index)),
                [0, 0, 0],
              );
              assert.equal(ir.clickL, 0);
              assert.equal(ip.publicPushPending.size, 0);
            } else {
              let asynchronousError;
              const command = ir.runtime.command;
              t.mock.method(ir.runtime, 'command', function (...args) {
                const result = command.apply(this, args);
                if (args[0] === 'm2att')
                  result.catch((error) => {
                    asynchronousError = error;
                  });
                return result;
              });
              const isUnfocus = mode === 'unfocus-error',
                target = ig(isUnfocus ? 'Plain' : 'AsyncBadF');
              ip.focus({ s: ir, o: ig(isUnfocus ? 'AsyncBadU' : 'Silent') });
              assert.equal(clickAt(ir, target), true);
              assert.strictEqual(ip.focused.o, target);
              assert.equal(ih.words.get(isUnfocus ? 31 : 33), 1);
              await assert.rejects(ip.flush(), (error) => {
                assert.strictEqual(error, asynchronousError);
                assert.match(error.message, /Unimplemented FES raw6 command m2att/);
                return true;
              });
              assert.strictEqual(ip.error, asynchronousError);
              assert.deepEqual(
                [17, 18, 32, 34].map((index) => ih.words.get(index)),
                [0, 0, 0, 0],
              );
              assert.equal(ir.clickL, 0);
              assert.deepEqual(frame(ir), iSaved);
              assert.equal(ip.publicPushPending.size, 0);
            }
            assert.equal(ih.world.nativeEngine, undefined);
          } finally {
            await ih.close();
          }
        }
        assert.equal(fresh.world.nativeEngine, undefined);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await fresh?.dispose();
        await h.close();
      }
    },
  );
}

const rightBlocks = {
  'A.PUSH_R': ['$50=_CLICK_R_', '@ getid 55', 'clipboard (:right-A)', '$51=_CLICK_R_', 'break'],
  'A.RELEASE_R': [
    '$52=_CLICK_R_',
    '@ getid 56',
    'clipboard (:right-release)',
    '$53=++$53',
    'break',
  ],
  'B.PUSH_R': ['$54=_CLICK_R_', '@ getid 57', 'break'],
  'B.RELEASE_R': ['$59=_CLICK_R_', '@ getid 58', '$60=++$60', 'break'],
  REENTER: ['$61=_CLICK_R_', 'A[1] getid 63', '$62=++$62', 'break'],
  'Sync.PUSH_R': ['$10=_CLICK_R_', '$11=++$11', 'break'],
  'Sync.RELEASE_R': ['$12=_CLICK_R_', '$13=++$13', 'break'],
  'Victim.PUSH_R': ['$14=++$14', 'break'],
  'Victim.RELEASE_R': ['$15=++$15', 'break'],
  'Kill.PUSH_R': ['clipboard (:right-kill)', '$16=++$16', 'break'],
  'Kill.RELEASE_R': ['$17=++$17', 'break'],
  'Close.PUSH_R': ['clipboard (:right-close)', '$18=++$18', 'break'],
  'Close.RELEASE_R': ['$19=++$19', 'break'],
  'SyncFail.PUSH_R': ['$20=++$20', 'RIGHT_UNKNOWN_PUSH', 'break'],
  'SyncFail.RELEASE_R': ['$21=++$21', 'break'],
  'ReleaseFail.PUSH_R': ['$22=++$22', 'break'],
  'ReleaseFail.RELEASE_R': ['$23=++$23', 'RIGHT_UNKNOWN_RELEASE', 'break'],
  'AsyncFail.PUSH_R': ['$24=++$24', '@ m2att', '$25=++$25', 'break'],
  'AsyncFail.RELEASE_R': ['$26=++$26', 'break'],
  'AsyncRelease.PUSH_R': ['$27=++$27', 'break'],
  'AsyncRelease.RELEASE_R': ['$28=++$28', '@ m2att', '$29=++$29', 'break'],
  FINISH: ['exit 0', 'break'],
};
const rightSource = ascii(
  [
    '#DEFINE',
    'BUTTON A[2]',
    'CPLANE B[2]',
    'BUTTON Silent',
    'BUTTON Sync',
    'BUTTON Victim[2]',
    'BUTTON Kill',
    'BUTTON Close',
    'BUTTON SyncFail',
    'BUTTON ReleaseFail',
    'BUTTON AsyncFail',
    'BUTTON AsyncRelease',
    '#OBJECT SIZE POS DISP',
    'A 6,4 4,5 1',
    'B 6,4 20,5 1',
    'Silent 6,4 30,5 1',
    'Sync 6,4 4,15 1',
    '#START',
    'wait 1',
    'next IDLE',
    '#IDLE',
    'break',
    ...Object.entries(rightBlocks).flatMap(([label, lines]) => ['#' + label, ...lines]),
    '',
  ].join('\n'),
);
async function rightTrial(profile) {
  const h = await environment(profile, rightSource);
  try {
    const root = await h.load();
    for (let index = 10; index < 64; index++) h.words.set(index, 0);
    await h.world.sendEngine(h.id, h.world.main.id, 333);
    return {
      h,
      root,
      fes: root.player,
      get: (name, index = 0) => root.collection.lookup(ascii(name), index),
    };
  } catch (error) {
    await h.close();
    throw error;
  }
}
function rightClipboard(trial) {
  const { h, root, fes, get } = trial,
    service = h.world.host.nativeClipboard,
    io = {
      mode: 'pair',
      writes: [],
      reentries: [],
      releaseValues: [],
      replacement: null,
      killed: null,
      closing: null,
    };
  assert.ok(service instanceof BrowserNativeClipboard);
  service.clipboard = {
    async writeText(value) {
      io.writes.push(value);
      if (value === 'right-A') {
        if (io.mode === 'pair') {
          const b = get('B', 1);
          b.enable = false;
          b.disp = false;
          fes.focus({ s: root, o: b });
          assert.strictEqual(fes.rightClick(), undefined);
        } else if (io.mode === 'sentinel') {
          fes.focus(null);
          assert.strictEqual(fes.rightClick(), undefined);
          // The captured no-target call must not select this later focus.
          fes.focus({ s: root, o: get('B', 1) });
        } else if (io.mode === 'queued-replace') {
          const old = get('Victim', 1);
          fes.focus({ s: root, o: old });
          assert.strictEqual(fes.rightClick(), undefined);
          await root.collection.remove(old);
          await declareButtons(h, 'Victim', 2);
          const replacement = get('Victim', 1);
          assert.notStrictEqual(old, replacement);
          assert.notEqual(old.handle, replacement.handle);
          io.replacement = { old, replacement };
        }
        const saved = frame(root);
        assert.ok(root.runtime.platform.inFlight);
        assert.ok(fes.publicPushPending.size > 0);
        await h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
          payload: fesLabelPayload(() => ascii('REENTER')),
        });
        assert.deepEqual(frame(root), saved);
        io.reentries.push(structuredClone(root.nativeContext));
      } else if (value === 'right-release') {
        io.releaseValues.push(root.system('_CLICK_R_'));
      } else if (value === 'right-kill') {
        io.killed = get('Kill');
        await root.collection.remove(io.killed);
      } else if (value === 'right-close') {
        fes.focus(null);
        assert.strictEqual(fes.rightClick(), undefined);
        io.closing = h.world.objects.release(h.id);
        await io.closing;
      }
    },
  };
  return io;
}
function observeRightSource(t, trial) {
  const { h, root, get } = trial,
    calls = [],
    getters = [],
    produced = [],
    specs = {
      'A.PUSH_R': { name: 'A', index: 1, raw: 6, line: 2, slot: 55, head: '@' },
      'A.RELEASE_R': { name: 'A', index: 1, raw: 6, line: 2, slot: 56, head: '@' },
      'B.PUSH_R': { name: 'B', index: 1, raw: 3, line: 2, slot: 57, head: '@' },
      'B.RELEASE_R': { name: 'B', index: 1, raw: 3, line: 2, slot: 58, head: '@' },
      REENTER: { name: 'A', index: 1, raw: 6, line: 2, slot: 63, head: 'A[1]', notify: true },
    };
  observeCommands(t, root, h.world, calls, getters);
  const command = root.runtime.command;
  t.mock.method(root.runtime, 'command', function (verb, selection, args, context) {
    if (verb === 'getid') {
      const label = root.executingLabel,
        spec = specs[label],
        object = get(spec.name, spec.index),
        reference = { nameBytes: ascii(spec.name), index: spec.index },
        row = spec.head + ' getid ' + spec.slot,
        arena = h.world.fesSources,
        record = arena.programs.get(root.program.sourceKey).blocks[label][spec.line - 1],
        nameAddress = record.names.get(fesByteView(reference.nameBytes)),
        rowAddress = record.copies.get(row),
        owner = spec.notify
          ? { nameBytes: new Uint8Array(), index: 0, current: 0 }
          : { ...reference, current: reference.index };
      assert.equal(object.nativeType, spec.raw);
      assert.deepEqual(root.collection.reference(object), reference);
      assert.deepEqual(selection, reference);
      assert.deepEqual(root.nativeContext, owner);
      assert.equal(root.executingLine, spec.line);
      assert.deepEqual(record.bytes, ascii(row));
      for (const [address, bytes] of [
        [nameAddress, reference.nameBytes],
        [rowAddress, ascii(row)],
      ]) {
        assert.ok(Number.isInteger(address));
        assert.ok(address >= arena.base && address + bytes.length + 1 <= arena.base + arena.used);
        assert.deepEqual(arena.read(address, bytes.length + 1), Uint8Array.from([...bytes, 0]));
      }
      assert.equal(context.objectNameAddress, nameAddress);
      assert.equal(context.commandPointer, rowAddress);
      assert.deepEqual(context.commandBytes, ascii(row));
      const occurrence = produced.filter((entry) => entry.label === label).length + 1,
        tokens = getters.filter((entry) => entry.label === label && entry.line === spec.line);
      assert.equal(tokens.filter((entry) => entry.token === spec.head).length, occurrence);
      assert.equal(tokens.filter((entry) => entry.token === 'getid').length, occurrence);
      produced.push({
        label,
        slot: spec.slot,
        reference,
        current: owner.current,
        nameAddress,
        rowAddress,
        expected: spec.raw === 3 ? nameAddress : object.idIndex | 0,
      });
    }
    return command.call(this, verb, selection, args, context);
  });
  return {
    produced,
    check() {
      assert.deepEqual(
        calls.map((entry) => [
          entry.reference,
          entry.current,
          entry.objectNameAddress,
          entry.commandPointer,
        ]),
        produced.map((entry) => [
          entry.reference,
          entry.current,
          entry.nameAddress,
          entry.rowAddress,
        ]),
      );
      for (const entry of produced) assert.equal(h.words.get(entry.slot), entry.expected);
    },
  };
}

for (const profile of startupProfiles) {
  test(
    'normal public right click keeps its field until RELEASE completes: ' + profile,
    async (t) => {
      const trial = await rightTrial(profile),
        { h, root, fes, get } = trial;
      let fresh;
      try {
        const a = get('A', 1),
          b = get('B', 1),
          saved = frame(root),
          rng = h.world.random.snapshot(),
          io = rightClipboard(trial),
          sourceCalls = observeRightSource(t, trial),
          events = [],
          dispatch = root.dispatchEvent;
        assert.equal(a.nativeType, 6);
        assert.equal(b.nativeType, 3);
        assert.notEqual(a.handle, b.handle);
        t.mock.method(root, 'dispatchEvent', function (object, event, settled) {
          events.push({ object, event, clickR: this.clickR, releaseDone: h.words.get(53) });
          return dispatch.call(this, object, event, settled);
        });
        fes.focus(null);
        assert.strictEqual(fes.rightClick(), undefined);
        assert.equal(root.clickR, -1);
        assert.equal(events.length, 0);
        fes.focus({ s: root, o: a });
        assert.strictEqual(fes.rightClick(), undefined);
        assert.equal(root.clickR, a.handle, 'idle right click commits before PUSH_R');
        assert.equal(h.words.get(50), a.handle);
        await fes.flush();
        assert.deepEqual(
          [50, 51, 52].map((index) => h.words.get(index)),
          [a.handle, a.handle, a.handle],
          'queued right click must not replace the field read by the earlier A callbacks',
        );
        assert.deepEqual([h.words.get(54), h.words.get(59)], [b.handle, b.handle]);
        assert.equal(h.words.get(53), 1);
        assert.equal(h.words.get(60), 1);
        assert.equal(h.words.get(61), a.handle);
        assert.equal(root.clickR, b.handle);
        assert.equal(b.enable, false);
        assert.equal(b.disp, false);
        assert.deepEqual(
          events.map((entry) => [entry.object, entry.event, entry.clickR, entry.releaseDone]),
          [
            [a, 'PUSH_R', a.handle, 0],
            [a, 'RELEASE_R', a.handle, 0],
            [b, 'PUSH_R', b.handle, 1],
            [b, 'RELEASE_R', b.handle, 1],
          ],
        );
        assert.deepEqual(io.releaseValues, [a.handle]);
        assert.deepEqual(io.reentries, [{ nameBytes: ascii('A'), index: 1, current: 1 }]);
        sourceCalls.check();
        assert.deepEqual(frame(root), saved);
        assert.equal(fes.publicPushPending.size, 0);

        fresh = await freshCheckpoint(t, h, profile);
        const fRoot = fresh.world.objects.objects.get(h.id).implementation.player.root,
          fWords = fresh.world.runtime.variableBank(fresh.world.main, false),
          fSaved = frame(fRoot),
          fSilent = fRoot.collection.lookup(ascii('Silent'), 0);
        assert.equal(fRoot.clickR, 0);
        assert.deepEqual(fSaved, { ...saved, executingLabel: undefined, executingLine: undefined });
        assert.deepEqual(
          [50, 51, 52].map((index) => fWords.get(index)),
          [a.handle, a.handle, a.handle],
        );
        fRoot.player.focus({ s: fRoot, o: fSilent });
        assert.strictEqual(fRoot.player.rightClick(), undefined);
        assert.equal(fRoot.clickR, fSilent.handle);
        assert.deepEqual(frame(fRoot), fSaved);
        assert.equal(fRoot.player.publicPushPending.size, 0);

        const sync = get('Sync');
        fes.focus({ s: root, o: sync });
        assert.strictEqual(fes.rightClick(), undefined);
        assert.deepEqual(
          [10, 11, 12, 13].map((index) => h.words.get(index)),
          [sync.handle, 1, sync.handle, 1],
        );
        assert.equal(root.clickR, sync.handle);
        assert.equal(fes.publicPushPending.size, 0);
        fes.focus({ s: root, o: get('Silent') });
        const eventCount = events.length;
        assert.strictEqual(fes.rightClick(), undefined);
        assert.equal(root.clickR, get('Silent').handle);
        assert.equal(events.length, eventCount);
        assert.equal(fes.publicPushPending.size, 0);

        io.mode = 'sentinel';
        fes.focus({ s: root, o: a });
        assert.strictEqual(fes.rightClick(), undefined);
        assert.throws(() => fes.snapshot(), /public push is in flight/);
        await fes.flush();
        assert.deepEqual(
          [50, 51, 52].map((index) => h.words.get(index)),
          [a.handle, a.handle, a.handle],
        );
        assert.equal(root.clickR, -1);
        assert.strictEqual(fes.focused.o, b);
        assert.equal(h.words.get(60), 1, 'captured no-target action emits no B callback');
        assert.deepEqual(io.releaseValues, [a.handle, a.handle]);

        io.mode = 'queued-replace';
        fes.focus({ s: root, o: a });
        assert.strictEqual(fes.rightClick(), undefined);
        await fes.flush();
        assert.equal(io.replacement.old.deleted, true);
        assert.strictEqual(get('Victim', 1), io.replacement.replacement);
        assert.deepEqual([h.words.get(14), h.words.get(15)], [0, 0]);
        assert.equal(
          root.clickR,
          a.handle,
          'stale queued action is cancelled before its field write',
        );
        assert.deepEqual(
          [50, 51, 52].map((index) => h.words.get(index)),
          [a.handle, a.handle, a.handle],
        );
        sourceCalls.check();

        const kill = get('Kill');
        fes.focus({ s: root, o: kill });
        assert.strictEqual(fes.rightClick(), undefined);
        await fes.flush();
        assert.equal(io.killed.deleted, true);
        assert.deepEqual([h.words.get(16), h.words.get(17)], [1, 0]);
        assert.equal(
          root.clickR,
          kill.handle,
          'await cancellation does not roll back the pre-PUSH write',
        );
        assert.equal(fes.publicPushPending.size, 0);

        let synchronousError;
        const execute = root.execute;
        t.mock.method(root, 'execute', function (...args) {
          try {
            return execute.apply(this, args);
          } catch (error) {
            synchronousError = error;
            throw error;
          }
        });
        for (const [name, pattern, slots] of [
          ['SyncFail', /FES whole-row evaluator is pending: RIGHT_UNKNOWN_PUSH/, [20, 21]],
          ['ReleaseFail', /FES whole-row evaluator is pending: RIGHT_UNKNOWN_RELEASE/, [22, 23]],
        ]) {
          const object = get(name);
          fes.focus({ s: root, o: object });
          assert.throws(
            () => fes.rightClick(),
            (error) => {
              assert.strictEqual(error, synchronousError);
              assert.match(error.message, pattern);
              return true;
            },
          );
          assert.equal(root.clickR, object.handle);
          assert.deepEqual(
            slots.map((index) => h.words.get(index)),
            name === 'SyncFail' ? [1, 0] : [1, 1],
          );
          assert.equal(fes.error, null);
          assert.equal(fes.publicPushPending.size, 0);
          assert.deepEqual(frame(root), saved);
          await fes.flush();
        }
        await root.notify('FINISH');
        assert.equal(root.finished, 0);
        fes.focus({ s: root, o: sync });
        assert.strictEqual(fes.rightClick(), undefined);
        assert.equal(root.clickR, sync.handle);
        assert.deepEqual([h.words.get(11), h.words.get(13)], [1, 1]);
        assert.equal(fes.publicPushPending.size, 0);
        assert.deepEqual(h.world.random.snapshot(), rng);

        for (const mode of ['push-error', 'release-error', 'close']) {
          const isolated = await rightTrial(profile),
            { h: ih, root: ir, fes: ip, get: ig } = isolated;
          try {
            const iSaved = frame(ir);
            rightClipboard(isolated);
            if (mode === 'close') {
              const object = ig('Close');
              ip.focus({ s: ir, o: object });
              assert.strictEqual(ip.rightClick(), undefined);
              await ip.flush();
              assert.equal(ih.world.objects.objects.has(ih.id), false);
              assert.equal(ir.runtime.closed, true);
              assert.deepEqual([ih.words.get(18), ih.words.get(19)], [0, 0]);
              assert.equal(
                ir.clickR,
                object.handle,
                'closed owner cancels queued no-target field write',
              );
            } else {
              let asynchronousError;
              const command = ir.runtime.command;
              t.mock.method(ir.runtime, 'command', function (...args) {
                const result = command.apply(this, args);
                if (args[0] === 'm2att')
                  result.catch((error) => {
                    asynchronousError = error;
                  });
                return result;
              });
              const object = ig(mode === 'push-error' ? 'AsyncFail' : 'AsyncRelease');
              ip.focus({ s: ir, o: object });
              assert.strictEqual(ip.rightClick(), undefined);
              assert.equal(ir.clickR, object.handle);
              ip.focus(null);
              assert.strictEqual(ip.rightClick(), undefined);
              await assert.rejects(ip.flush(), (error) => {
                assert.strictEqual(error, asynchronousError);
                assert.match(error.message, /Unimplemented FES raw6 command m2att/);
                return true;
              });
              assert.equal(ir.clickR, object.handle);
              assert.strictEqual(ip.error, asynchronousError);
              assert.deepEqual(
                [24, 25, 26, 27, 28, 29].map((index) => ih.words.get(index)),
                mode === 'push-error' ? [1, 0, 0, 0, 0, 0] : [0, 0, 0, 1, 1, 0],
              );
              assert.deepEqual(frame(ir), iSaved);
            }
            assert.equal(ip.publicPushPending.size, 0);
            assert.equal(ih.world.nativeEngine, undefined);
          } finally {
            await ih.close();
          }
        }
        assert.equal(fresh.world.nativeEngine, undefined);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await fresh?.dispose();
        await h.close();
      }
    },
  );
}

test('bare public right click retains inline field and undefined return', async () => {
  const bytes = ascii(
      '#DEFINE\nBUTTON button\n#OBJECT DISP\nbutton 0\n#START\nwait 10\n#button.PUSH_R\n$1=_CLICK_R_\nbreak\n#button.RELEASE_R\n$2=_CLICK_R_\nbreak\n',
    ),
    player = new FESPlayer(
      { require: async () => bytes, has: () => false, width: 64, height: 48 },
      {},
    );
  assert.strictEqual(player.rightClick(), undefined);
  await player.start('bare-right-click');
  assert.equal(player.root.runtime, undefined);
  await player.step();
  assert.strictEqual(player.rightClick(), undefined);
  assert.equal(player.root.clickR, -1);
  const object = player.root.byKey.get('button'),
    expected = object.handle || -1;
  object.enable = false;
  object.disp = false;
  player.focus({ s: player.root, o: object });
  assert.strictEqual(player.rightClick(), undefined);
  assert.equal(player.root.clickR, expected);
  assert.deepEqual([player.globals[1], player.globals[2]], [expected, expected]);
  assert.equal(player.publicPushPending.size, 0);
  player.focus(null);
  assert.strictEqual(player.rightClick(), undefined);
  assert.equal(player.root.clickR, -1);
  await player.step();
  assert.equal(player.root.clickR, 0);
});

const controlHitSource = ascii(
  '#DEFINE\nPLANE Parent[2]\nPLANE Plane[2]\nSLIDER Slider[2]\nSCROLL2 Scroll[2]\n' +
    '#OBJECT SIZE POS VRAM DISP\nParent 128,96 30,19 0,0 1\nPlane 128,96 9,17 2,3 1\n' +
    '#OBJECT FILE PL PARENT POS2 PRI DISP ENABLE\nSlider controls Plane[1] Parent[1] area:7 80 1 1\nScroll controls Plane[1] Parent[1] area:8 90 1 1\n' +
    '#OBJECT ENABLE\nSlider[0] 0\nScroll[0] 0\n#START\nwait 1\nnext IDLE\n#IDLE\nbreak\n' +
    '#Slider.PROBE\n@ getid 50\n$51=@\nbreak\n#Scroll.PROBE\n@ getid 50\n$51=@\nbreak\n#NOOP\nbreak\n' +
    '#RELOAD\nSlider[1] load controls\nScroll[1] load controls\nbreak\n',
);
// Independent authored cropped-frame inputs in control-files.mjs, not rect outputs.
const controlHitBounds = [
    [16, 12, 88, 24],
    [104, 12, 116, 76],
  ],
  controlHitReferences = [
    { nameBytes: ascii('Slider'), index: 1 },
    { nameBytes: ascii('Scroll'), index: 1 },
  ];
const controlHitRect = ([x, y, right, bottom]) => ({ x, y, w: right - x, h: bottom - y });
function controlTrack(world, root, object) {
  const task = world.controlsFES.validate(root, object),
    id = task.resource.areas.track,
    area = world.inputFor(task.record.id).get(id);
  assert.equal(task.record.parent, root.runtimeID);
  assert.equal(task.record.kind, object.nativeType + 27);
  assert.ok(area);
  return { task, id, area };
}
async function controlHitDefinition(h, columns, row) {
  await h.world.sendEngine(h.id, h.world.main.id, 339, 0, 128, {
    payload: {
      string: (address) => {
        assert.ok(address === 0 || address === 128);
        return address === 0 ? '#OBJECT ' + columns : row;
      },
    },
  });
}
async function controlHitNotify(h, label, name = null, index = 0) {
  const packet = fesNotificationMemory(ascii(label), name === null ? null : ascii(name), index);
  await h.world.sendEngine(h.id, h.world.main.id, 337, name === null ? 0 : 64, 0, {
    payload: packet,
  });
  assert.equal(packet.stringReads, 0);
}
function observeControlHitSource(t, h, root) {
  const calls = [],
    getters = [],
    produced = [];
  observeCommands(t, root, h.world, calls, getters);
  const command = root.runtime.command;
  t.mock.method(root.runtime, 'command', function (verb, selection, args, context) {
    if (verb === 'getid') {
      const spec = controlHitReferences[produced.length],
        label = text(spec.nameBytes) + '.PROBE',
        object = root.collection.lookup(spec.nameBytes, 1),
        arena = h.world.fesSources,
        row = '@ getid 50',
        record = arena.programs.get(root.program.sourceKey).blocks[label][0],
        nameAddress = record.names.get(fesByteView(spec.nameBytes)),
        rowAddress = record.copies.get(row);
      assert.equal(object.nativeType, produced.length === 0 ? 15 : 14);
      assert.deepEqual(selection, spec);
      assert.deepEqual(root.collection.reference(object), spec);
      assert.deepEqual(root.nativeContext, { ...spec, current: 1 });
      assert.equal(root.executingLabel, label);
      assert.equal(root.executingLine, 1);
      assert.deepEqual(record.bytes, ascii(row));
      for (const [address, bytes] of [
        [nameAddress, spec.nameBytes],
        [rowAddress, ascii(row)],
      ]) {
        assert.ok(
          Number.isInteger(address) &&
            address >= arena.base &&
            address + bytes.length + 1 <= arena.base + arena.used,
        );
        assert.deepEqual(arena.read(address, bytes.length + 1), Uint8Array.from([...bytes, 0]));
      }
      assert.equal(context.objectNameAddress, nameAddress);
      assert.equal(context.commandPointer, rowAddress);
      assert.deepEqual(context.commandBytes, ascii(row));
      for (const token of ['@', 'getid'])
        assert.equal(
          getters.filter(
            (entry) => entry.label === label && entry.line === 1 && entry.token === token,
          ).length,
          1,
        );
      produced.push({ label, reference: spec, current: 1, nameAddress, rowAddress });
    }
    return command.call(this, verb, selection, args, context);
  });
  return {
    produced,
    check() {
      assert.deepEqual(
        calls.map((entry) => [
          entry.reference,
          entry.current,
          entry.objectNameAddress,
          entry.commandPointer,
        ]),
        produced.map((entry) => [
          entry.reference,
          entry.current,
          entry.nameAddress,
          entry.rowAddress,
        ]),
      );
    },
  };
}
for (const profile of startupProfiles) {
  test('normal public control hit uses owned typed FILE rectangles: ' + profile, async (t) => {
    const { 'controls.hg2': controls, 'area.hg2': area } = await controlFiles(new Uint8Array()),
      h = await environment(profile, controlHitSource, {
        controlImages: { 'assets/controls.hg2': controls, 'assets/area.hg2': area },
      });
    let fresh;
    try {
      const root = await h.load();
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      const objects = controlHitReferences.map((ref) =>
          root.collection.lookup(ref.nameBytes, ref.index),
        ),
        tracks = objects.map((object) => controlTrack(h.world, root, object)),
        hits = () =>
          [
            [20, 16],
            [110, 20],
          ].map(([x, y]) => root.player.hit(x, y)),
        hitReferences = () =>
          hits().map((hit) => (hit === null ? null : root.collection.reference(hit.o)));
      assert.deepEqual(
        objects.map((object) => object.nativeType),
        [15, 14],
      );
      assert.deepEqual(
        objects.map((object) => [object.areaWidth, object.areaHeight]),
        [
          [0, 0],
          [0, 0],
        ],
      );
      assert.deepEqual(
        tracks.map(({ task }) => [...task.config.rect]),
        controlHitBounds,
      );
      assert.deepEqual(
        tracks.map(({ area }) => [...area.bounds]),
        controlHitBounds,
      );
      assert.deepEqual(
        hitReferences(),
        controlHitReferences,
        'typed FILE track rectangles must be reachable by public hit for both controls',
      );

      const saved = frame(root),
        rng = h.world.random.snapshot(),
        queryState = () => ({
          frame: frame(root),
          clickL: root.clickL,
          clickR: root.clickR,
          scroll: root.scrollPosition,
          objects: h.world.objects.objects.size,
          sourceBytes: h.world.fesSources.used,
          pending: root.player.publicPushPending.size,
          fields: objects.map((o) => [
            o.x,
            o.y,
            o.width,
            o.height,
            o.positionPending,
            o.filePending,
            o.value,
            o.valuePending,
          ]),
        });
      let imageReads = 0,
        loads = 0;
      for (const name of ['controls', 'area']) {
        const resolved = h.game.resolveCategory(name, 'image');
        assert.notEqual(resolved, null);
        const file = h.game.lookup(resolved).file,
          read = file.read;
        t.mock.method(file, 'read', function (...args) {
          imageReads++;
          return read.apply(this, args);
        });
      }
      const load = FESControlDriver.prototype.load;
      t.mock.method(FESControlDriver.prototype, 'load', function (...args) {
        loads++;
        return load.apply(this, args);
      });
      const beforeQuery = queryState();
      assert.deepEqual(
        objects.map((o) => root.rect(o)),
        controlHitBounds.map(controlHitRect),
      );
      for (const [x, y, reference] of [
        [16, 12, controlHitReferences[0]],
        [87.5, 23.5, controlHitReferences[0]],
        [88, 16, null],
        [20, 24, null],
        [104, 12, controlHitReferences[1]],
        [115.5, 75.5, controlHitReferences[1]],
        [116, 20, null],
        [110, 76, null],
      ]) {
        const hit = root.player.hit(x, y);
        assert.deepEqual(hit ? root.collection.reference(hit.o) : null, reference);
      }
      assert.deepEqual(queryState(), beforeQuery);
      assert.deepEqual([imageReads, loads], [0, 0]);

      const observed = observeControlHitSource(t, h, root);
      for (const ref of controlHitReferences) {
        await controlHitNotify(h, 'PROBE', text(ref.nameBytes), 1);
        assert.equal(h.words.get(50), observed.produced.at(-1).nameAddress);
        assert.equal(h.words.get(51), 1);
        assert.deepEqual(frame(root), saved);
      }
      observed.check();
      await controlHitDefinition(h, 'PARENT', 'Slider[1] Parent[0]');
      await controlHitDefinition(h, 'PARENT', 'Scroll[1] Parent[0]');
      await controlHitDefinition(h, 'POS', 'Parent[0] 33,27');
      await controlHitDefinition(h, 'POS VRAM', 'Plane[1] 42,25 13,14');
      await controlHitNotify(h, 'NOOP');
      for (const object of objects)
        assert.equal(object.parentHandle, root.collection.lookup(ascii('Parent'), 0).handle);
      assert.deepEqual(
        objects.map((o) => root.rect(o)),
        controlHitBounds.map(controlHitRect),
      );
      assert.deepEqual(hitReferences(), controlHitReferences);
      assert.deepEqual(
        tracks.map(({ task }) => [task.config.planeX, task.config.planeY]),
        [
          [2, 3],
          [2, 3],
        ],
      );

      await controlHitDefinition(h, 'POS2', 'Slider[1] area:8');
      await controlHitDefinition(h, 'POS2', 'Scroll[1] area:7');
      assert.deepEqual(
        objects.map((o) => o.positionPending),
        [true, true],
      );
      await controlHitNotify(h, 'NOOP');
      assert.deepEqual(
        objects.map((o) => o.positionPending),
        [true, true],
      );
      assert.deepEqual(
        objects.map((o) => root.rect(o)),
        controlHitBounds.map(controlHitRect),
      );
      assert.deepEqual(
        tracks.map(({ task }) => [...task.config.rect]),
        controlHitBounds,
      );
      assert.deepEqual(hitReferences(), controlHitReferences);
      assert.deepEqual([imageReads, loads], [0, 0]);
      assert.deepEqual(frame(root), saved);

      fresh = await freshCheckpoint(t, h, profile);
      const fRoot = fresh.world.objects.objects.get(h.id).implementation.player.root,
        fSaved = frame(fRoot),
        fObjects = controlHitReferences.map((ref) =>
          fRoot.collection.lookup(ref.nameBytes, ref.index),
        ),
        fTracks = fObjects.map((object) => controlTrack(fresh.world, fRoot, object));
      assert.deepEqual(fSaved, { ...saved, executingLabel: undefined, executingLine: undefined });
      assert.deepEqual(
        fObjects.map((o) => o.positionPending),
        [true, true],
      );
      assert.deepEqual(
        fObjects.map((o) => fRoot.rect(o)),
        controlHitBounds.map(controlHitRect),
      );
      assert.deepEqual(
        fTracks.map(({ area }) => [...area.bounds]),
        controlHitBounds,
      );
      assert.deepEqual(
        [
          [20, 16],
          [110, 20],
        ].map(([x, y]) => fRoot.collection.reference(fRoot.player.hit(x, y).o)),
        controlHitReferences,
      );
      assert.deepEqual(
        [imageReads, loads],
        [0, 0],
        'fresh geometry must not reopen image data or replay control load',
      );
      assert.deepEqual(frame(fRoot), fSaved);

      await controlHitNotify(h, 'RELOAD');
      const swapped = [controlHitBounds[1], controlHitBounds[0]];
      assert.deepEqual(
        objects.map((o) => [o.positionPending, o.filePending]),
        [
          [false, false],
          [false, false],
        ],
      );
      assert.deepEqual(
        objects.map((o) => root.rect(o)),
        swapped.map(controlHitRect),
      );
      assert.deepEqual(
        objects.map((o) => [...controlTrack(h.world, root, o).task.config.rect]),
        swapped,
      );
      assert.deepEqual(
        objects.map((o) => [...controlTrack(h.world, root, o).area.bounds]),
        controlHitBounds,
      );
      assert.deepEqual(
        objects.map((o) => controlTrack(h.world, root, o).id),
        tracks.map(({ id }) => id),
      );
      assert.deepEqual(hitReferences(), [controlHitReferences[1], controlHitReferences[0]]);
      assert.deepEqual(
        tracks.map(({ task }) => [task.config.planeX, task.config.planeY]),
        [
          [13, 14],
          [13, 14],
        ],
      );
      assert.deepEqual([imageReads, loads], [4, 2]);
      assert.deepEqual(frame(root), saved);
      assert.deepEqual(h.world.random.snapshot(), rng);
      assert.equal(fresh.world.nativeEngine, undefined);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}

const controlSlideSource = ascii(
  [
    '#DEFINE',
    'SLIDER Slider[2]',
    'SCROLL2 Scroll[2]',
    '#OBJECT FILE POS2 PRI DISP ENABLE',
    'Slider controls area:8 80 1 1',
    'Scroll controls area:7 90 1 1',
    '#OBJECT ENABLE',
    'Slider[0] 0',
    'Scroll[0] 0',
    '#START',
    'Slider[1] page 10 110',
    'Slider[1] pos 25',
    'Scroll[1] page 10 110 20',
    'Scroll[1] pos 30',
    'wait 1',
    'next IDLE',
    '#IDLE',
    'break',
    '#Slider.SCRL_P',
    '$10=++$10',
    '$11=@',
    '$12=_SCRL_P_',
    'break',
    '#Scroll.SCRL_P',
    '$13=++$13',
    '$14=@',
    '$15=_SCRL_P_',
    'break',
    '#Slider.PROBE',
    '@ getid 50',
    '@ getpos 52',
    '$51=@',
    'break',
    '#Scroll.PROBE',
    '@ getid 50',
    '@ getpos 52',
    '$51=@',
    'break',
  ].join('\n'),
);
for (const profile of startupProfiles) {
  test('normal public control slide uses decoded typed numbers: ' + profile, async (t) => {
    const { 'controls.hg2': controls, 'area.hg2': area } = await controlFiles(new Uint8Array()),
      h = await environment(profile, controlSlideSource, {
        controlImages: { 'assets/controls.hg2': controls, 'assets/area.hg2': area },
      });
    let fresh;
    try {
      const root = await h.load();
      for (let index = 10; index < 16; index++) h.words.set(index, 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      const objects = controlHitReferences.map((ref) => root.collection.lookup(ref.nameBytes, 1)),
        tracks = objects.map((o) => controlTrack(h.world, root, o)),
        points = [
          [110, 43],
          [50, 16],
        ],
        saved = frame(root),
        rng = h.world.random.snapshot(),
        previousScroll = root.scrollPosition;
      assert.deepEqual(
        objects.map((o) => o.nativeType),
        [15, 14],
      );
      assert.deepEqual(
        objects.map((o) => [o.minimum, o.maximum, o.pageSize]),
        [
          [10, 110, 0],
          [10, 110, 20],
        ],
      );
      assert.deepEqual(
        tracks.map(({ task }) => [task.model.state.direction, task.model.state.value]),
        [
          [1, 25],
          [0, 30],
        ],
      );
      assert.deepEqual(
        tracks.map(({ task }) => [...task.config.rect]),
        [controlHitBounds[1], controlHitBounds[0]],
      );
      let imageReads = 0,
        loads = 0;
      for (const name of ['controls', 'area']) {
        const file = h.game.lookup(h.game.resolveCategory(name, 'image')).file,
          read = file.read;
        t.mock.method(file, 'read', function (...args) {
          imageReads++;
          return read.apply(this, args);
        });
      }
      const load = FESControlDriver.prototype.load;
      t.mock.method(FESControlDriver.prototype, 'load', function (...args) {
        loads++;
        return load.apply(this, args);
      });
      const modelBefore = tracks.map(({ task }) => task.model.snapshot());
      for (const [index, [x, y]] of points.entries()) {
        const target = root.player.hit(x, y);
        assert.strictEqual(target.o, objects[index]);
        assert.deepEqual(root.collection.reference(target.o), controlHitReferences[index]);
        assert.strictEqual(root.player.slide(target, x, y), undefined);
      }
      const pendingBeforeProbe = objects.map((o) => [o.valuePending, o.valueNotify]),
        modelAfterProjection = tracks.map(({ task }) => task.model.snapshot());
      const observed = observeControlHitSource(t, h, root),
        actual = [];
      for (const ref of controlHitReferences) {
        await controlHitNotify(h, 'PROBE', text(ref.nameBytes), 1);
        assert.equal(h.words.get(50), observed.produced.at(-1).nameAddress);
        assert.equal(h.words.get(51), 1);
        actual.push(h.words.get(52));
      }
      // Independent frame inputs and the original short threshold counts:
      // Slider: N100/travel56/pixel27 ->48; Scroll: full100/cap80/travel56,
      // step70/scaled2600 crosses37 thresholds. Neither result adds minimum10.
      assert.deepEqual(
        actual,
        [48, 37],
        'public slide must project both decoded typed control values',
      );
      observed.check();
      assert.deepEqual(pendingBeforeProbe, [
        [true, 0],
        [true, 0],
      ]);
      assert.deepEqual(modelAfterProjection, modelBefore);
      assert.deepEqual(
        tracks.map(({ task }) => [task.model.state.value, task.model.state.pixel]),
        [
          [48, 26],
          [37, 25],
        ],
      );
      assert.deepEqual(
        [h.words.get(10), h.words.get(13)],
        [1, 1],
        'driver notify0 does not duplicate public callbacks',
      );
      assert.deepEqual([h.words.get(11), h.words.get(14)], [1, 1]);
      assert.deepEqual([h.words.get(12), h.words.get(15)], [previousScroll, objects[0].handle]);
      assert.equal(root.scrollPosition, objects[1].handle);
      assert.deepEqual(frame(root), saved);
      assert.deepEqual([imageReads, loads], [0, 0]);
      // Projection itself must not mutate the actual task before its driver consumes.
      assert.deepEqual(
        modelBefore.map((s) => [s.value, s.pixel]),
        [
          [25, 14],
          [30, 21],
        ],
      );
      for (const [index, [x, y]] of points.entries()) {
        assert.strictEqual(root.player.slide({ s: root, o: objects[index] }, x, y), undefined);
      }
      assert.deepEqual([h.words.get(10), h.words.get(13)], [1, 1]);
      assert.deepEqual(
        objects.map((o) => o.valuePending),
        [false, false],
      );
      assert.equal(root.scrollPosition, objects[1].handle);

      fresh = await freshCheckpoint(t, h, profile);
      const fRoot = fresh.world.objects.objects.get(h.id).implementation.player.root,
        words = fresh.world.runtime.variableBank(fresh.world.main, false),
        fSaved = frame(fRoot),
        slider = fRoot.collection.lookup(ascii('Slider'), 1),
        beforeInput = fRoot.scrollPosition;
      assert.deepEqual(fSaved, { ...saved, executingLabel: undefined, executingLine: undefined });
      assert.deepEqual(
        controlHitReferences.map((ref) => fRoot.collection.lookup(ref.nameBytes, 1).value),
        [48, 37],
      );
      assert.deepEqual([words.get(10), words.get(13)], [1, 1]);
      assert.deepEqual([imageReads, loads], [0, 0]);
      // This is a new restored input, after the existing restore-only replay guard.
      // y75 centers beyond the last pixel: clamp56, N100 -> endpoint100, not48.
      assert.strictEqual(fRoot.player.slide({ s: fRoot, o: slider }, 110, 75), undefined);
      assert.equal(slider.value, 100);
      assert.deepEqual([words.get(10), words.get(11), words.get(12)], [2, 1, beforeInput]);
      assert.equal(fRoot.scrollPosition, slider.handle);
      assert.deepEqual(frame(fRoot), fSaved);
      assert.deepEqual(
        [imageReads, loads],
        [0, 0],
        'a new restored slide uses restored decoded metadata without IO',
      );

      const fh = { world: fresh.world, id: h.id };
      await controlHitDefinition(fh, 'POS2', 'Slider[1] area:7');
      assert.equal(slider.positionPending, true);
      assert.strictEqual(fRoot.player.slide({ s: fRoot, o: slider }, 110, 43), undefined);
      assert.equal(
        slider.value,
        48,
        'POS2-only pending does not replace the current vertical rectangle',
      );
      assert.equal(slider.positionPending, true);
      assert.equal(words.get(10), 3);
      await controlHitDefinition(fh, 'FILE', 'Slider[1] controls');
      assert.equal(slider.filePending, true);
      const unavailable = {
        value: slider.value,
        count: words.get(10),
        scroll: fRoot.scrollPosition,
      };
      assert.strictEqual(fRoot.player.slide({ s: fRoot, o: slider }, 110, 75), undefined);
      assert.deepEqual(
        { value: slider.value, count: words.get(10), scroll: fRoot.scrollPosition },
        unavailable,
      );
      assert.deepEqual([imageReads, loads], [0, 0]);
      assert.deepEqual(frame(fRoot), fSaved);
      assert.deepEqual(h.world.random.snapshot(), rng);
      assert.equal(h.world.nativeEngine, undefined);
      assert.equal(fresh.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
