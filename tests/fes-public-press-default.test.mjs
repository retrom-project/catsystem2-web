// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { fesByteView } from '../src/fes/tokens.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  text = (value) => (typeof value === 'string' ? value : new TextDecoder().decode(value)),
  filename = 'assets.int/public-press.fes';

async function environment(profile, source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/public-press.fes': source },
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>',
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
