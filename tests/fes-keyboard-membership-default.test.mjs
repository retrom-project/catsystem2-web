// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { fesByteView } from '../src/fes/tokens.mjs';
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
  filename = 'assets.int/keyboard-membership.fes';

async function environment(profile, source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/keyboard-membership.fes': source },
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
          throw new Error('Keyboard membership must not open the original');
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
        throw new Error('No original keyboard-membership restore');
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
  join = (...parts) => Uint8Array.from(parts.flatMap((bytes) => [...bytes]));
function source() {
  return join(
    ascii(
      '#MACRO\nCAPTURE value\n#DEFINE\nBUTTON Choice\n#OBJECT SIZE POS DISP\nChoice 6,4 4,5 1\n#START\nwait 1\nnext IDLE\n#IDLE\n#',
    ),
    firstName,
    ascii('.FOCUS\n$60=++$60\nbreak\n#'),
    secondName,
    ascii('.FOCUS\n$61=++$61\nbreak\n'),
  );
}
for (const profile of startupProfiles) {
  test(`normal raw BUTTON keyboard membership survives public candidates and fresh restore: ${profile}`, async (t) => {
    const h = await environment(profile, source());
    assert.equal(h.words.capacity, 64);
    assert.ok([60, 61].every((index) => index >= 0 && index < h.words.capacity));
    let fresh;
    try {
      const root = await h.load(),
        runtime = root.runtime,
        collection = root.collection,
        choice = collection.lookup('Choice', 0),
        registered = fesByteView(collection.reference(choice).nameBytes);
      // Observe real coordinator registration before any authored membership control.
      assert.equal(registered, 'Choice');
      assert.deepEqual([...root.keyNames], [registered]);
      assert.deepEqual([...root.keyNames], ['Choice']);
      h.words.set(60, 0);
      h.words.set(61, 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(root.suspended, [['START', 1]]);
      // Accepted I0 data author: actual typed collection and real resources, not DEFINE/338 admission.
      const rawObjects = [
        ...collection.create('BUTTON', firstName, 2),
        ...collection.create('BUTTON', secondName, 1),
      ];
      rawObjects.forEach((object, index) =>
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
      assert.equal(rawObjects[0].baseName, rawObjects[2].baseName);
      assert.equal(rawObjects[0].key, rawObjects[2].key);
      const references = rawObjects.map((object) => collection.reference(object));
      assert.deepEqual(
        references.map((ref) => ref.index),
        [0, 1, 0],
      );
      assert.deepEqual(
        root.player.candidates().map(({ o }) => collection.reference(o)),
        [collection.reference(choice)],
      );
      const borrowed = collection.reference(rawObjects[0]),
        key = fesByteView(borrowed.nameBytes);
      assert.deepEqual(
        [...key].map((char) => char.charCodeAt(0)),
        [114, 0x81],
      );
      assert.notEqual(key, fesByteView(references[2].nameBytes));
      // Deliberate control of the existing mutable membership Set isolates the filter.
      // It does not claim native KEYBLOCK or non-ASCII DEFINE/338 support.
      root.keyNames.clear();
      assert.deepEqual(
        root.player.candidates().map(({ o }) => collection.reference(o)),
        [collection.reference(choice), ...references],
      );
      root.keyNames.add(key);
      borrowed.nameBytes[1] = 0x82;
      assert.deepEqual(collection.reference(rawObjects[0]), references[0]);
      assert.deepEqual(
        root.player.candidates().map(({ o }) => collection.reference(o)),
        references.slice(0, 2),
      );
      root.player.focus(null);
      assert.equal(root.player.moveFocus('right'), true);
      assert.strictEqual(root.player.focused.o, rawObjects[0]);
      assert.equal(root.player.moveFocus('right'), true);
      assert.strictEqual(root.player.focused.o, rawObjects[1]);
      assert.equal(root.player.moveFocus('right'), false);
      assert.deepEqual([h.words.get(60), h.words.get(61)], [2, 0]);
      assert.deepEqual(root.player.nativeInput.state.focus, references[1]);
      const selected = root.player.focused.o,
        counts = [h.words.get(60), h.words.get(61)];
      assert.equal(collection.lookup(firstName, -1), null);
      assert.equal(collection.lookup(Uint8Array.of(114, 0x83), 0), null);
      assert.strictEqual(root.player.focused.o, selected);
      assert.deepEqual([h.words.get(60), h.words.get(61)], counts);
      assert.deepEqual(root.player.snapshot().root.keyNames, [key]);
      fresh = await freshCheckpoint(t, h, profile);
      const next = fresh.world.objects.objects.get(h.id).implementation.player.root,
        nextCollection = next.collection,
        words = fresh.world.runtime.variableBank(fresh.world.main, false);
      assert.equal(words.capacity, 64);
      assert.deepEqual([...next.keyNames], [key]);
      assert.deepEqual(next.player.snapshot().root.keyNames, [key]);
      assert.deepEqual(
        next.player.candidates().map(({ o }) => nextCollection.reference(o)),
        references.slice(0, 2),
      );
      assert.deepEqual([words.get(60), words.get(61)], counts);
      next.player.focus(null);
      assert.equal(next.player.moveFocus('right'), true);
      assert.deepEqual(nextCollection.reference(next.player.focused.o), references[0]);
      assert.deepEqual([words.get(60), words.get(61)], [3, 0]);
      assert.deepEqual([h.words.get(60), h.words.get(61)], counts);
      assert.deepEqual(next.suspended, [['START', 1]]);
      assert.equal(fresh.world.nativeEngine, undefined);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
