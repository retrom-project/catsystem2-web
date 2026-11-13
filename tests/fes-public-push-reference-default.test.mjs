// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
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
          throw new Error('Public push identity must not open the original');
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
        throw new Error('No original public-push-reference restore');
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

const firstName = Uint8Array.of(114, 0x81),
  secondName = Uint8Array.of(114, 0x82),
  join = (...parts) => Uint8Array.from(parts.flatMap((bytes) => [...bytes])),
  originalSlots = [50, 51, 52, 53, 54, 55, 56],
  slots = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62];

function source() {
  const parts = [
    ascii(
      '#MACRO\nCAPTURE value\n#DEFINE\nBUTTON Choice\n#OBJECT SIZE POS DISP\nChoice 6,4 4,5 1\n#START\nwait 1\n$56=++$56\nnext IDLE\n#IDLE\n#REENTER\nChoice getid 59\nChoice getid 60\n$61=++$61\nbreak\n#Choice.PUSH_L\n@ m2att\n$62=1\nbreak\n',
    ),
  ];
  for (const [name, pushSlot] of [
    [firstName, 52],
    [secondName, 53],
  ]) {
    for (const [event, body] of [
      ['FOCUS', '$50=++$50'],
      ['UNFOCUS', '$51=++$51'],
      [
        'PUSH_L',
        `$${pushSlot}=++$${pushSlot}\n@ getid 55\nclipboard (:public-push)\n@ getid 57\n$58=++$58`,
      ],
      ['RELEASE_L', '$54=++$54'],
    ])
      parts.push(ascii('#'), name, ascii(`.${event}\n${body}\nbreak\n`));
  }
  return join(...parts);
}

function observeEvents(t, instance, events) {
  const original = instance.dispatchEvent;
  t.mock.method(instance, 'dispatchEvent', async function (object, event) {
    const entry = [this.collection.reference(object), event, this.clickL, null];
    events.push(entry);
    try {
      return await original.call(this, object, event);
    } finally {
      entry[3] = this.clickL;
    }
  });
}

function observeCommands(t, instance, world, calls) {
  const original = instance.runtime.command;
  t.mock.method(instance.runtime, 'command', async function (verb, selection, args, context) {
    const nameBytes = selection.nameBytes.slice(),
      commandBytes = context.commandBytes.slice(),
      call = {
        verb,
        reference: { nameBytes, index: selection.index },
        commandBytes,
        commandPointer: context.commandPointer,
        objectNameAddress: context.objectNameAddress,
      };
    calls.push(call);
    assert.deepEqual(
      world.fesSources.read(call.objectNameAddress, nameBytes.length + 1),
      join(nameBytes, Uint8Array.of(0)),
    );
    assert.deepEqual(
      world.fesSources.read(call.commandPointer, commandBytes.length + 1),
      join(commandBytes, Uint8Array.of(0)),
    );
    try {
      const result = await original.call(this, verb, selection, args, context);
      call.result = result;
      return result;
    } catch (error) {
      call.error = error.message;
      throw error;
    }
  });
}

function installClipboard(t, world, id) {
  const writes = [],
    reentries = [],
    diagnostics = [],
    clipboard = world.host.nativeClipboard;
  assert.ok(clipboard instanceof BrowserNativeClipboard);
  assert.strictEqual(world.host.nativeClipboard, clipboard);
  assert.equal(clipboard.opened, false);
  const diagnostic = clipboard.diagnostic;
  t.mock.method(clipboard, 'diagnostic', function (entry) {
    diagnostics.push(entry);
    return diagnostic.call(this, entry);
  });
  clipboard.clipboard = {
    async writeText(text) {
      writes.push(text);
      if (text !== 'public-push') return;
      const instance = world.objects.objects.get(id).implementation.player.root,
        saved = {
          suspended: structuredClone(instance.suspended),
          object: instance.collection.reference(instance.eventObject),
          index: instance.eventIndex,
          label: instance.executingLabel,
          line: instance.executingLine,
          wait: instance.waitFrames,
        };
      assert.ok(instance.runtime.platform.inFlight);
      assert.equal(instance.player.pending.size, 0);
      assert.ok(instance.player.publicPushPending.size > 0);
      await world.sendEngine(id, world.main.id, 337, 0, 0, {
        payload: fesLabelPayload(() => ascii('REENTER')),
      });
      assert.deepEqual(instance.suspended, saved.suspended);
      assert.deepEqual(instance.collection.reference(instance.eventObject), saved.object);
      assert.equal(instance.eventIndex, saved.index);
      assert.equal(instance.executingLabel, saved.label);
      assert.equal(instance.executingLine, saved.line);
      assert.equal(instance.waitFrames, saved.wait);
      reentries.push(saved.object);
    },
  };
  return { writes, reentries, diagnostics, clipboard };
}

function expectedCommands(references) {
  return references.flatMap((reference) => [
    [reference, ascii('@ getid 55')],
    [{ nameBytes: ascii('Choice'), index: 0 }, ascii('Choice getid 59')],
    [{ nameBytes: ascii('Choice'), index: 0 }, ascii('Choice getid 60')],
    [reference, ascii('@ getid 57')],
  ]);
}
function assertCommands(calls, references) {
  assert.deepEqual(
    calls.map((call) => [call.reference, call.commandBytes]),
    expectedCommands(references),
  );
  assert.deepEqual(
    calls.map((call) => [call.verb, call.result]),
    calls.map(() => ['getid', 0]),
  );
}
function assertExtras(words, count) {
  assert.deepEqual(
    [57, 58, 59, 60, 61, 62].map((index) => words.get(index)),
    [0, count, 0, 0, count, 0],
  );
}

for (const profile of startupProfiles) {
  test(`normal public push preserves raw target identity and fresh continuation: ${profile}`, async (t) => {
    const h = await environment(profile, source());
    assert.equal(h.words.capacity, 64);
    assert.ok(slots.every((index) => index >= 0 && index < h.words.capacity));
    let fresh;
    try {
      const root = await h.load(),
        runtime = root.runtime,
        collection = root.collection;
      for (const index of slots) h.words.set(index, [55, 57, 59, 60].includes(index) ? 99 : 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(root.suspended, [['START', 1]]);
      assert.equal(root.waitFrames, 1);
      // Actual typed collection authors, not non-ASCII DEFINE/KEYBLOCK/338 admission.
      const [a0, a1] = collection.create('BUTTON', firstName, 2),
        [b0] = collection.create('BUTTON', secondName, 1);
      [a0, a1, b0].forEach((object, index) =>
        Object.assign(object, {
          width: 6,
          height: 4,
          x: 4 + index * 10,
          y: 5,
          z: 0,
          disp: true,
          displayValue: 1,
          dirty: true,
          sizeDirty: true,
        }),
      );
      await runtime.initializeResources();
      await runtime.resources.traverse();
      assert.equal(a0.baseName, b0.baseName);
      assert.equal(a0.key, b0.key);
      const refs = [a0, a1, b0].map((object) => collection.reference(object)),
        events = [],
        commands = [],
        clipboard = installClipboard(t, h.world, h.id),
        rng = h.world.random.snapshot(),
        playerRandom = root.player.randomState,
        counters = () => originalSlots.map((index) => h.words.get(index));
      assert.deepEqual(
        refs.map((ref) => ref.index),
        [0, 1, 0],
      );
      assert.equal(root.clickL, 0);
      observeEvents(t, root, events);
      observeCommands(t, root, h.world, commands);
      assert.equal(root.player.push(refs[0]), true);
      assert.equal(root.player.publicPushPending.size, 1);
      assert.deepEqual(events, []);
      assert.equal(root.clickL, 0);
      assert.deepEqual(counters(), [0, 0, 0, 0, 0, 99, 0]);
      assert.deepEqual(root.suspended, [['START', 1]]);
      assert.throws(() => root.player.snapshot(), /public push is in flight/);
      await root.player.flush();
      assert.strictEqual(root.player.focused.o, a0);
      assert.equal(root.clickL, a0.handle);
      assert.deepEqual(counters(), [1, 0, 1, 0, 1, 0, 0]);
      assertExtras(h.words, 1);
      const request = { nameBytes: refs[1].nameBytes.slice(), index: 1 };
      assert.equal(root.player.push(request), true);
      request.nameBytes.fill(120);
      request.index = -1;
      assert.equal(root.player.push(refs[2]), true);
      assert.equal(root.player.publicPushPending.size, 2);
      assert.strictEqual(root.player.focused.o, a0);
      assert.equal(events.length, 3);
      assert.throws(() => root.player.snapshot(), /public push is in flight/);
      await root.player.flush();
      assert.strictEqual(root.player.focused.o, b0);
      assert.equal(root.clickL, b0.handle);
      assert.deepEqual(root.player.nativeInput.state.focus, refs[2]);
      assert.deepEqual(events, [
        [refs[0], 'FOCUS', 0, 0],
        [refs[0], 'PUSH_L', 0, 0],
        [refs[0], 'RELEASE_L', a0.handle, a0.handle],
        [refs[0], 'UNFOCUS', a0.handle, a0.handle],
        [refs[1], 'FOCUS', a0.handle, a0.handle],
        [refs[1], 'PUSH_L', a0.handle, a0.handle],
        [refs[1], 'RELEASE_L', a1.handle, a1.handle],
        [refs[1], 'UNFOCUS', a1.handle, a1.handle],
        [refs[2], 'FOCUS', a1.handle, a1.handle],
        [refs[2], 'PUSH_L', a1.handle, a1.handle],
        [refs[2], 'RELEASE_L', b0.handle, b0.handle],
      ]);
      assert.deepEqual(counters(), [3, 2, 2, 1, 3, 0, 0]);
      assertExtras(h.words, 3);
      assertCommands(commands, refs);
      assert.deepEqual(clipboard.writes, ['', 'public-push', '', 'public-push', '', 'public-push']);
      assert.deepEqual(clipboard.reentries, refs);
      assert.deepEqual(clipboard.diagnostics, []);
      assert.equal(clipboard.clipboard.opened, false);
      const protectedState = () => ({
        focused: collection.reference(root.player.focused.o),
        clickL: root.clickL,
        words: slots.map((index) => h.words.get(index)),
        suspended: structuredClone(root.suspended),
        waitFrames: root.waitFrames,
        events: structuredClone(events),
        commands: structuredClone(commands),
        writes: clipboard.writes.slice(),
        rng: h.world.random.snapshot(),
        playerRandom: root.player.randomState,
      });
      a1.enable = false;
      const beforeMiss = protectedState();
      assert.equal(root.player.push(refs[1]), false);
      assert.equal(root.player.push(null), false);
      assert.equal(root.player.push({ nameBytes: firstName, index: -1 }), false);
      assert.equal(root.player.push({ nameBytes: Uint8Array.of(114, 0x83), index: 0 }), false);
      assert.deepEqual(protectedState(), beforeMiss);
      a1.enable = true;
      assert.equal(root.player.publicPushPending.size, 0);
      assert.equal(root.player.pending.size, 0);
      assert.deepEqual(root.suspended, [['START', 1]]);
      assert.equal(root.waitFrames, 1);
      assert.deepEqual(h.world.random.snapshot(), rng);
      assert.equal(root.player.randomState, playerRandom);
      fresh = await freshCheckpoint(t, h, profile);
      const next = fresh.world.objects.objects.get(h.id).implementation.player.root,
        words = fresh.world.runtime.variableBank(fresh.world.main, false),
        restoredA = next.collection.lookup(firstName, 1),
        restoredB = next.collection.lookup(secondName, 0),
        freshEvents = [],
        freshCommands = [],
        freshClipboard = installClipboard(t, fresh.world, h.id),
        initialClick = next.clickL;
      assert.equal(words.capacity, 64);
      assert.deepEqual(next.collection.reference(next.player.focused.o), refs[2]);
      assert.strictEqual(next.player.focused.o, restoredB);
      assert.notStrictEqual(restoredA, a1);
      assert.deepEqual(
        originalSlots.map((index) => words.get(index)),
        [3, 2, 2, 1, 3, 0, 0],
      );
      assertExtras(words, 3);
      assert.deepEqual(next.suspended, [['START', 1]]);
      assert.equal(next.waitFrames, 1);
      assert.deepEqual(fresh.world.random.snapshot(), rng);
      assert.equal(next.player.randomState, playerRandom);
      observeEvents(t, next, freshEvents);
      observeCommands(t, next, fresh.world, freshCommands);
      assert.equal(next.player.push(refs[1]), true);
      assert.equal(next.player.publicPushPending.size, 1);
      assert.throws(() => next.player.snapshot(), /public push is in flight/);
      await next.player.flush();
      assert.strictEqual(next.player.focused.o, restoredA);
      assert.equal(next.clickL, restoredA.handle);
      assert.deepEqual(next.player.nativeInput.state.focus, refs[1]);
      assert.deepEqual(freshEvents, [
        [refs[2], 'UNFOCUS', initialClick, initialClick],
        [refs[1], 'FOCUS', initialClick, initialClick],
        [refs[1], 'PUSH_L', initialClick, initialClick],
        [refs[1], 'RELEASE_L', restoredA.handle, restoredA.handle],
      ]);
      assert.deepEqual(
        originalSlots.map((index) => words.get(index)),
        [4, 3, 3, 1, 4, 0, 0],
      );
      assertExtras(words, 4);
      assertCommands(freshCommands, [refs[1]]);
      assert.deepEqual(
        freshCommands.map(({ commandPointer, objectNameAddress }) => [
          commandPointer,
          objectNameAddress,
        ]),
        commands
          .slice(4, 8)
          .map(({ commandPointer, objectNameAddress }) => [commandPointer, objectNameAddress]),
      );
      assert.deepEqual(freshClipboard.writes, ['', 'public-push']);
      assert.deepEqual(freshClipboard.reentries, [refs[1]]);
      assert.deepEqual(freshClipboard.diagnostics, []);
      assert.equal(freshClipboard.clipboard.opened, false);
      assert.deepEqual(counters(), [3, 2, 2, 1, 3, 0, 0]);
      assert.deepEqual(next.suspended, [['START', 1]]);
      assert.equal(next.waitFrames, 1);
      assert.deepEqual(fresh.world.random.snapshot(), rng);
      assert.equal(next.player.randomState, playerRandom);
      const choice = next.collection.lookup(ascii('Choice'), 0),
        choiceRef = next.collection.reference(choice);
      assert.equal(next.player.push(choiceRef), true);
      await assert.rejects(next.player.flush(), /Unimplemented FES raw6 command m2att/);
      assert.deepEqual(freshEvents.slice(4), [
        [refs[1], 'UNFOCUS', restoredA.handle, restoredA.handle],
        [choiceRef, 'FOCUS', restoredA.handle, restoredA.handle],
        [choiceRef, 'PUSH_L', restoredA.handle, restoredA.handle],
      ]);
      assert.equal(freshCommands.at(-1).verb, 'm2att');
      assert.match(freshCommands.at(-1).error, /Unimplemented FES raw6 command m2att/);
      assert.equal(words.get(62), 0);
      assert.deepEqual(next.suspended, [['START', 1]]);
      assert.equal(next.waitFrames, 1);
      assert.equal(next.player.pending.size, 0);
      assert.equal(next.player.publicPushPending.size, 0);
      assert.deepEqual(fresh.world.random.snapshot(), rng);
      assert.equal(next.player.randomState, playerRandom);
      assert.equal(fresh.world.nativeEngine, undefined);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}

test('bare public push retains its independent String target and event order', async (t) => {
  const bytes = ascii(
      '#DEFINE\nPLANE parent\nBUTTON button\n#OBJECT PL DISP\nparent - 0\nbutton parent 1\n#START\nwait 10\n#button.FOCUS\n$1=++$1\nbreak\n#button.PUSH_L\n$2=++$2\nbreak\n#button.RELEASE_L\n$3=++$3\nbreak\n',
    ),
    player = new FESPlayer(
      { require: async () => bytes, has: () => false, width: 64, height: 48 },
      {},
    );
  await player.start('bare-public-push');
  assert.equal(player.root.runtime, undefined);
  await player.step();
  const object = player.root.byKey.get('button'),
    parent = player.root.byKey.get('parent'),
    events = [],
    original = player.root.event;
  t.mock.method(player.root, 'event', function (object, event) {
    events.push([object.key, event]);
    return original.call(this, object, event);
  });
  assert.equal(player.push('missing'), false);
  assert.equal(player.push('button'), false);
  assert.deepEqual(events, []);
  assert.equal(player.focused, null);
  parent.disp = true;
  object.enable = false;
  assert.equal(player.push('button'), false);
  assert.deepEqual(events, []);
  object.enable = true;
  assert.equal(player.push('button'), true);
  assert.strictEqual(player.focused.o, object);
  assert.equal(player.root.clickL, object.handle);
  assert.deepEqual(events, [
    ['button', 'FOCUS'],
    ['button', 'PUSH_L'],
    ['button', 'RELEASE_L'],
  ]);
  assert.deepEqual([player.globals[1], player.globals[2], player.globals[3]], [1, 1, 1]);
  assert.deepEqual(player.root.suspended, [['START', 1]]);
});
