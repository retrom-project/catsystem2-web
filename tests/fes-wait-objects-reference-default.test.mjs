// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { kcsProgram } from './helpers.mjs';
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
  filename = 'assets.int/wait-objects-reference.fes';

async function environment(profile, source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: {
          'assets/wait-objects-reference.fes': source,
          'motions/wait-position.kcs': motionProgram,
        },
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>' +
          '<int03><name>mot</name><int>motions.int</int><ext>kcs</ext><dir>motions</dir></int03>',
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
          throw new Error('Object wait identity must not open the original');
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
  const restore = FESPlayer.prototype.restore;
  let waitRestores = 0;
  t.mock.method(FESPlayer.prototype, 'restore', async function (saved) {
    const result = await restore.call(this, saved);
    if (saved.root?.waitObjects) {
      waitRestores++;
      assert.deepEqual(this.root.waitObjects, saved.root.waitObjects);
      this.root.waitObjects.forEach((reference, index) => {
        assert.notStrictEqual(
          reference.nameBytes.buffer,
          saved.root.waitObjects[index].nameBytes.buffer,
        );
      });
    }
    return result;
  });
  const player = new CatSystem2({
    game: h.game,
    nativeProfile: profile,
    canvas: new StartupCanvas(),
    audioContext: { currentTime: 0, close: async () => {} },
    transitionalExe: {
      open() {
        throw new Error('No original wait-objects-reference restore');
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
  assert.equal(waitRestores, 1);
  assert.deepEqual(player.world.fesSources.snapshot(), source);
  assert.equal(player.world.nativeEngine, undefined);
  return player;
}

const firstName = Uint8Array.of(114, 0x81),
  secondName = Uint8Array.of(114, 0x82),
  join = (...parts) => Uint8Array.from(parts.flatMap((bytes) => [...bytes])),
  shared = (offset) => [0x13, (0x80000000 + offset) >>> 0],
  motionProgram = kcsProgram([[21, shared(MOTION_ABI.pos), shared(MOTION_ABI.registers)], [59]]);

function source() {
  return join(
    ascii(
      '#MACRO\nCAPTURE value\n#DEFINE\nBUTTON Choice\n#OBJECT SIZE POS DISP\nChoice 6,4 4,5 1\n#SUBCOMMAND\ncontinue custom wait-position PX[0] : [0]\n#START\nwait 1\nnext WAIT\n#WAIT\nwait ',
    ),
    firstName,
    ascii('\n$50=++$50\nnext IDLE\n#IDLE\n#PLAY_A\n'),
    firstName,
    ascii('[1] custom 75\nbreak\n#PLAY_B\n'),
    secondName,
    ascii('[1] custom 99\nbreak\n#STOP_A\n'),
    firstName,
    ascii('[1] stop\nbreak\n#DELETE_A\n'),
    firstName,
    ascii('[1] delete\nbreak\n#CANCEL\nnext IDLE\n'),
  );
}
const notify = (world, id, label) =>
  world.sendEngine(id, world.main.id, 337, 0, 0, {
    payload: fesLabelPayload(() => ascii(label)),
  });
function observeWaitGetters(t, instance, trace) {
  const elements = instance.elements,
    argument = instance.argumentBytes,
    isTarget = (value) =>
      value instanceof Uint8Array &&
      value.length === firstName.length &&
      value.every((byte, index) => byte === firstName[index]);
  t.mock.method(instance, 'elements', function (token) {
    if (isTarget(token)) trace.push(['elements', token.slice()]);
    return elements.call(this, token);
  });
  t.mock.method(instance, 'argumentBytes', function (token) {
    if (isTarget(token)) trace.push(['getter', token.slice()]);
    return argument.call(this, token);
  });
}
const expectedGetters = () =>
  Array.from({ length: 3 }, () => [
    ['elements', firstName],
    ['getter', firstName],
  ]).flat();

for (const profile of startupProfiles) {
  test(`normal named object waits retain raw groups through busy, fresh missing and clear: ${profile}`, async (t) => {
    const h = await environment(profile, source());
    assert.equal(h.words.capacity, 64);
    assert.ok([50].every((index) => index >= 0 && index < h.words.capacity));
    let fresh;
    try {
      const root = await h.load(),
        runtime = root.runtime,
        collection = root.collection;
      h.words.set(50, 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(root.suspended, [['START', 1]]);
      // Author actual typed objects, not non-ASCII DEFINE or dynamic338 admission.
      const [a0, a1] = collection.create('BUTTON', firstName, 2),
        [b0, b1] = collection.create('BUTTON', secondName, 2);
      [a0, a1, b0, b1].forEach((object, index) =>
        Object.assign(object, {
          width: 6,
          height: 4,
          x: 4 + index * 10,
          y: 5,
          disp: true,
          displayValue: 1,
          dirty: true,
          sizeDirty: true,
        }),
      );
      await runtime.initializeResources();
      await runtime.resources.traverse();
      assert.equal(a0.key, b0.key);
      assert.equal(a1.key, b1.key);
      const refs = [a0, a1].map((object) => collection.reference(object)),
        trace = [],
        rng = h.world.random.snapshot(),
        playerRandom = root.player.randomState;
      assert.deepEqual(
        refs.map((reference) => reference.index),
        [0, 1],
      );
      observeWaitGetters(t, root, trace);
      await notify(h.world, h.id, 'PLAY_A');
      assert.equal(a0.motionBusy, false);
      assert.equal(a1.motionBusy, true);
      assert.equal(b0.motionBusy, false);
      assert.equal(b1.motionBusy, false);
      assert.equal(runtime.targetFor(a1, false).manager.records.size, 1);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(trace, expectedGetters());
      assert.equal(a1.x, 75);
      assert.equal(h.words.get(50), 0);
      assert.deepEqual(root.waitObjects, refs);
      assert.deepEqual(root.suspended, [['WAIT', 1]]);
      const savedWait = root.player.snapshot().root.waitObjects,
        motionState = runtime.targetFor(a1, false).snapshot();
      assert.deepEqual(savedWait, refs);
      savedWait.forEach((reference, index) => {
        assert.notStrictEqual(reference.nameBytes.buffer, root.waitObjects[index].nameBytes.buffer);
      });
      savedWait[0].nameBytes.fill(120);
      assert.deepEqual(root.waitObjects, refs);
      fresh = await freshCheckpoint(t, h, profile);
      const next = fresh.world.objects.objects.get(h.id).implementation.player.root,
        nextRuntime = next.runtime,
        restoredA0 = next.collection.lookup(firstName, 0),
        restoredA1 = next.collection.lookup(firstName, 1),
        restoredB1 = next.collection.lookup(secondName, 1),
        words = fresh.world.runtime.variableBank(fresh.world.main, false),
        freshTrace = [];
      assert.deepEqual(next.waitObjects, refs);
      assert.deepEqual(next.suspended, [['WAIT', 1]]);
      assert.equal(words.get(50), 0);
      assert.equal(restoredA1.motionBusy, true);
      assert.deepEqual(nextRuntime.targetFor(restoredA1, false).snapshot(), motionState);
      next.waitObjects.forEach((reference, index) => {
        assert.notStrictEqual(reference.nameBytes.buffer, root.waitObjects[index].nameBytes.buffer);
      });
      observeWaitGetters(t, next, freshTrace);
      await notify(h.world, h.id, 'PLAY_B');
      assert.equal(b1.motionBusy, true);
      assert.equal(root.player.nativeEvent(null, 'PUSH_L'), false);
      assert.equal(root.skipPressed, true);
      await h.world.tick();
      assert.equal(
        runtime.targetFor(a1, false).manager.records.values().next().value.instance.skip,
        true,
      );
      assert.equal(
        runtime.targetFor(b1, false).manager.records.values().next().value.instance.skip,
        true,
      );
      assert.equal(a1.motionBusy, true, 'continue MOT owns completion after skip');
      assert.deepEqual(root.waitObjects, refs);
      assert.equal(h.words.get(50), 0);
      assert.deepEqual(trace, expectedGetters());
      await notify(h.world, h.id, 'STOP_A');
      assert.equal(a1.motionBusy, false);
      assert.equal(b1.motionBusy, true);
      await h.world.tick();
      assert.equal(root.waitObjects, null);
      assert.equal(h.words.get(50), 1);
      assert.equal(root.label, 'IDLE');
      assert.deepEqual(trace, expectedGetters());
      await notify(fresh.world, h.id, 'PLAY_B');
      assert.equal(restoredB1.motionBusy, true);
      await notify(fresh.world, h.id, 'DELETE_A');
      assert.equal(next.collection.lookup(firstName, 1), null);
      assert.strictEqual(next.collection.lookup(firstName, 0), restoredA0);
      await fresh.world.tick();
      assert.equal(next.waitObjects, null);
      assert.equal(words.get(50), 1);
      assert.equal(restoredB1.motionBusy, true);
      assert.deepEqual(freshTrace, []);
      await notify(h.world, h.id, 'PLAY_A');
      await h.world.sendEngine(h.id, h.world.main.id, 335, 0, 0, {
        payload: fesLabelPayload(() => ascii('WAIT')),
      });
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.equal(a1.motionBusy, true);
      assert.deepEqual(root.waitObjects, refs);
      assert.deepEqual(root.suspended, [['WAIT', 1]]);
      assert.deepEqual(trace, [...expectedGetters(), ...expectedGetters()]);
      await notify(h.world, h.id, 'CANCEL');
      assert.equal(root.waitObjects, null);
      assert.equal(root.waitSound, null);
      assert.equal(root.label, 'IDLE');
      assert.equal(h.words.get(50), 1);
      assert.equal(a1.motionBusy, true);
      assert.deepEqual(trace, [...expectedGetters(), ...expectedGetters()]);
      assert.deepEqual(h.world.random.snapshot(), rng);
      assert.deepEqual(fresh.world.random.snapshot(), rng);
      assert.equal(root.player.randomState, playerRandom);
      assert.equal(next.player.randomState, playerRandom);
      assert.equal(h.world.nativeEngine, undefined);
      assert.equal(fresh.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
