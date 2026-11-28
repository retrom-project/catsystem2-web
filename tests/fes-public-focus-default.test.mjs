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
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  text = (value) => (typeof value === 'string' ? value : new TextDecoder().decode(value)),
  filename = 'assets.int/public-push-reference.fes';

async function environment(profile, source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/public-push-reference.fes': source },
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
          throw new Error('Public focus identity must not open the original');
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
        throw new Error('No original public-focus restore');
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
    '#OBJECT SIZE POS DISP',
    'Choice 6,4 4,5 1',
    'Other 6,4 20,5 1',
    '#START',
    'wait 1',
    'next IDLE',
    '#IDLE',
    'break',
    '#Choice.FOCUS',
    '$50=++$50',
    'break',
    '#Choice.UNFOCUS',
    '$51=++$51',
    '@ getid 55',
    'clipboard (:public-focus)',
    '@ getid 56',
    '$52=++$52',
    'break',
    '#Other.FOCUS',
    '@ getid 57',
    '$53=++$53',
    'break',
    '#Other.UNFOCUS',
    '$54=++$54',
    'break',
    '#Choice.SYNC_FAIL',
    '$58=++$58',
    'fw_hash',
    'break',
    '#Choice.ASYNC_FAIL',
    '$59=++$59',
    '@ m2att',
    '$60=++$60',
    'break',
    '#Choice.CLOSE',
    'clipboard (:close-focus)',
    '$61=++$61',
    'break',
    '#REENTER',
    'Other getid 63',
    '$62=++$62',
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
function clipboard(t, h, instance, before) {
  const service = h.world.host.nativeClipboard,
    writes = [],
    reentries = [];
  assert.ok(service instanceof BrowserNativeClipboard);
  let closing;
  service.clipboard = {
    async writeText(value) {
      writes.push(value);
      if (value === 'public-focus') {
        const saved = frame(instance);
        assert.ok(instance.runtime.platform.inFlight);
        assert.ok(instance.player.publicPushPending.size > 0);
        await h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
          payload: fesLabelPayload(() => ascii('REENTER')),
        });
        assert.deepEqual(frame(instance), saved);
        reentries.push(structuredClone(instance.nativeContext));
      } else if (value === 'close-focus') {
        closing = h.world.objects.release(h.id);
        await closing;
      }
    },
  };
  return {
    writes,
    reentries,
    get closing() {
      return closing;
    },
    before,
  };
}

for (const profile of startupProfiles) {
  test(
    'normal public focus keeps owned event context and synchronous completion: ' + profile,
    async (t) => {
      const h = await environment(profile, source);
      let fresh;
      try {
        const root = await h.load(),
          player = root.player;
        assert.equal(h.words.capacity, 64);
        for (let index = 50; index < 64; index++) h.words.set(index, 0);
        await h.world.sendEngine(h.id, h.world.main.id, 333);
        const first = root.collection.lookup(ascii('Choice'), 1),
          next = root.collection.lookup(ascii('Other'), 0),
          firstRef = root.collection.reference(first),
          nextRef = root.collection.reference(next),
          saved = frame(root),
          calls = [],
          getters = [],
          rng = h.world.random.snapshot(),
          io = clipboard(t, h, root, saved);
        assert.equal(first.nativeType, 6);
        assert.equal(next.nativeType, 6);
        assert.equal(Number.isInteger(first.idIndex), true);
        assert.equal(Number.isInteger(next.idIndex), true);
        assert.equal(firstRef.index, 1);
        assert.equal(nextRef.index, 0);
        assert.equal(root.event(first, 'NO_HANDLER'), false);
        assert.equal(player.publicPushPending.size, 0);
        observeCommands(t, root, h.world, calls, getters);

        player.focus({ s: root, o: first });
        assert.strictEqual(player.focused.o, first);
        assert.equal(h.words.get(50), 1, 'a pure synchronous FOCUS finishes inside focus()');
        assert.equal(player.publicPushPending.size, 0);
        assert.deepEqual(root.nativeContext, saved.nativeContext);

        // Actual getid and clipboard operations yield; no mocked handler Promise.
        player.focus({ s: root, o: next });
        assert.strictEqual(
          player.focused.o,
          next,
          'focused commits synchronously after UNFOCUS prefix',
        );
        assert.equal(h.words.get(51), 1);
        assert.equal(h.words.get(52), 0);
        assert.equal(h.words.get(53), 0);
        assert.ok(player.publicPushPending.size > 0);
        assert.throws(() => player.snapshot(), /public push is in flight/);
        await player.flush();
        assert.deepEqual(
          calls.map((call) => [call.reference, text(call.commandBytes), call.current]),
          [
            [firstRef, '@ getid 55', 1],
            [nextRef, 'Other getid 63', 0],
            [firstRef, '@ getid 56', 1],
            [nextRef, '@ getid 57', 0],
          ],
        );
        assert.deepEqual(
          [55, 56, 57, 63].map((index) => h.words.get(index)),
          [first.idIndex, first.idIndex, next.idIndex, next.idIndex],
          'BUTTON getid returns its actual selector, independently of S9 source addresses',
        );
        for (const [label, line, head] of [
          ['Choice.UNFOCUS', 2, '@'],
          ['Choice.UNFOCUS', 4, '@'],
          ['Other.FOCUS', 1, '@'],
          ['REENTER', 1, 'Other'],
        ]) {
          const tokens = getters.filter((entry) => entry.label === label && entry.line === line);
          assert.equal(tokens.filter((entry) => entry.token === head).length, 1);
          assert.equal(tokens.filter((entry) => entry.token === 'getid').length, 1);
        }
        assert.deepEqual(
          [50, 51, 52, 53, 62].map((index) => h.words.get(index)),
          [1, 1, 1, 1, 1],
        );
        assert.deepEqual(io.writes, ['', 'public-focus']);
        assert.deepEqual(io.reentries, [{ ...firstRef, current: 1 }]);
        assert.deepEqual(frame(root), saved);
        assert.equal(player.pending.size, 0);
        assert.equal(player.publicPushPending.size, 0);
        assert.deepEqual(h.world.random.snapshot(), rng);

        fresh = await freshCheckpoint(t, h, profile);
        const fRoot = fresh.world.objects.objects.get(h.id).implementation.player.root,
          fPlayer = fRoot.player,
          fFirst = fRoot.collection.lookup(firstRef.nameBytes, firstRef.index),
          fNext = fRoot.collection.lookup(nextRef.nameBytes, nextRef.index),
          fWords = fresh.world.runtime.variableBank(fresh.world.main, false),
          fSaved = frame(fRoot);
        assert.strictEqual(fPlayer.focused.o, fNext);
        assert.notStrictEqual(fFirst, first);
        assert.deepEqual(fSaved, { ...saved, executingLabel: undefined, executingLine: undefined });
        assert.deepEqual(
          [50, 51, 52, 53, 62].map((index) => fWords.get(index)),
          [1, 1, 1, 1, 1],
        );
        assert.equal(fPlayer.publicPushPending.size, 0);
        assert.equal(fRoot.event(fFirst, 'NO_HANDLER'), false);

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
        assert.throws(
          () => fRoot.event(fFirst, 'SYNC_FAIL'),
          (error) => {
            assert.strictEqual(error, synchronousError);
            assert.match(error.message, /FES native common handler is pending: fw_hash/);
            return true;
          },
        );
        assert.equal(fWords.get(58), 1);
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
        assert.equal(fRoot.event(fFirst, 'ASYNC_FAIL'), true);
        assert.equal(fWords.get(59), 1);
        assert.throws(() => fPlayer.snapshot(), /public push is in flight/);
        await assert.rejects(fPlayer.flush(), (error) => {
          assert.strictEqual(error, asynchronousError);
          assert.match(error.message, /Unimplemented FES raw6 command m2att/);
          return true;
        });
        assert.equal(fWords.get(60), 0);
        assert.deepEqual(frame(fRoot), fSaved);
        assert.strictEqual(fPlayer.error, asynchronousError);
        assert.equal(fPlayer.publicPushPending.size, 0);
        await fRoot.notify('FINISH');
        assert.equal(fRoot.finished, 0);
        assert.equal(fRoot.event(fFirst, 'FOCUS'), false);
        assert.equal(fPlayer.publicPushPending.size, 0);

        // The original live owner closes during a real clipboard action.
        const count = calls.length;
        assert.equal(root.event(first, 'CLOSE'), true);
        assert.equal(root.event(next, 'FOCUS'), true);
        await player.flush();
        assert.ok(io.closing);
        await io.closing;
        assert.equal(h.world.objects.objects.has(h.id), false);
        assert.equal(root.runtime.closed, true);
        assert.equal(player.publicPushPending.size, 0);
        assert.equal(calls.length, count, 'a queued FOCUS cannot dispatch to the released owner');
        assert.equal(h.words.get(61), 0);
        assert.deepEqual(io.writes, ['', 'public-focus', '', 'close-focus']);
        assert.deepEqual(h.world.random.snapshot(), rng);
        assert.equal(fresh.world.nativeEngine, undefined);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await fresh?.dispose();
        await h.close();
      }
    },
  );
}
