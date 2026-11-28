// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fesByteView } from '../src/fes/tokens.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { FESDefinitionModel } from '../src/native/fes-definitions.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  filename = 'assets.int/count-expression.fes',
  source = `#DEFINE
CIMAGE bank[1+$7]
CIMAGE first[$60++]
CIMAGE second[$60++]
CIMAGE zero[00]
CIMAGE signed[+2]
CIMAGE sentinel[-1]
CIMAGE bank[-1]
VIEW scalar
#OBJECT SIZE COLOR POS
bank 2,3 0xff335577 7,11
first 1,1 0xff445566 0,0
second 2,1 0xff556677 1,1
zero 1,2 0xff667788 2,2
signed 2,2 0xff778899 3,3
sentinel 3,1 0xff8899aa 4,4
#START
break
`;
async function environment(profile) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/count-expression.fes': ascii(source) },
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
          throw new Error('DEFINE must not open the original');
        },
      },
    });
    await player.initialize();
    assert.equal(player.world.frame, 1);
    assert.equal(player.world.runtime.variableBank(player.world.main, false).get(7), 0x12345678);
    assert.equal(player.world.nativeEngine, undefined);
    return {
      player,
      world: player.world,
      game,
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
async function task(world) {
  const parent = world.main,
    id = await world.objects.create({ kind: 34, parent: parent.id }),
    surface = await world.objects.create({ kind: 15, parent: parent.id });
  await world.sendEngine(surface, parent.id, 279, 64, 48);
  await world.sendEngine(surface, parent.id, 283);
  await world.sendEngine(id, parent.id, 331, 0, parent.context.variableBank);
  await world.sendEngine(id, parent.id, 334, 0, world.nativeTaskID(surface));
  return { id, implementation: world.objects.objects.get(id).implementation };
}
function defineCheckpointPixels(world) {
  const gpu = world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  // The CPU-entry fixture supplies a full known frame, without a GPU claim.
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
}

const expectedDefinitions = [
  '#DEFINE',
  'CIMAGE bank[1+$7]',
  'CIMAGE first[$60++]',
  'CIMAGE second[$60++]',
  'CIMAGE zero[00]',
  'CIMAGE signed[+2]',
  'CIMAGE sentinel[-1]',
  'CIMAGE bank[-1]',
  'VIEW scalar',
];
const expectedPending = [
  ['bank', 0],
  ['bank', 1],
  ['first', 0],
  ['second', 0],
  ['second', 1],
  ['zero', 0],
  ['signed', 0],
  ['signed', 1],
  ['sentinel', 0],
  ['scalar', 0],
];
const expectedCounts = [
  ['bank', 2],
  ['first', 1],
  ['second', 2],
  ['zero', 1],
  ['signed', 2],
  ['sentinel', 1],
  ['scalar', 1],
];

for (const profile of startupProfiles) {
  test(`DEFINE count expressions run once in declaration order against the current bank: ${profile}`, async (t) => {
    const h = await environment(profile);
    let fresh,
      phase = 'load',
      reads = 0,
      initializeCalls = 0,
      declarationPending,
      readingDeclarations = true;
    const nameObservations = [];
    try {
      const current = await task(h.world),
        bank = h.world.runtime.variableBank(h.world.main, false),
        file = h.game.lookup(filename).file,
        read = file.read.bind(file),
        initialize = FESCoordinator.prototype.initialize,
        host = current.implementation.player.host,
        argument = host.nativeFESStringBytes,
        compile = FESDefinitionModel.prototype.compile;
      assert.equal(bank.capacity, 64);
      bank.set(7, 1);
      bank.set(60, 1);
      t.mock.method(file, 'read', (...args) => {
        if (phase === 'restore') throw new Error('Count expression restore reread FES');
        reads++;
        return read(...args);
      });
      t.mock.method(host, 'nativeFESStringBytes', function (bytes, ...args) {
        const name = fesByteView(bytes);
        if (
          readingDeclarations &&
          ['bank', 'first', 'second', 'zero', 'signed', 'sentinel', 'scalar'].includes(name)
        )
          nameObservations.push([name, bank.get(60)]);
        return argument.call(this, bytes, ...args);
      });
      t.mock.method(FESDefinitionModel.prototype, 'compile', function (...args) {
        if (this.instance.runtimeID === current.id) readingDeclarations = false;
        return compile.apply(this, args);
      });
      t.mock.method(FESCoordinator.prototype, 'initialize', async function (...args) {
        initializeCalls++;
        const result = await initialize.apply(this, args);
        declarationPending = this.collection.pending.map(({ name, index }) => [name.text, index]);
        assert.equal(this.resources.entries.length, 0);
        return result;
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => filename },
      });
      const root = current.implementation.player.root,
        runtime = root.runtime,
        collection = runtime.collection;
      assert.ok(runtime instanceof FESCoordinator);
      assert.equal(
        h.world.objects.objects.get(current.id).context.variableBank,
        h.world.main.context.variableBank,
      );
      assert.deepEqual(root.program.definitions.map(fesByteView), expectedDefinitions);
      assert.deepEqual(nameObservations, [
        ['bank', 1],
        ['first', 1],
        ['second', 2],
        ['zero', 3],
        ['signed', 3],
        ['sentinel', 3],
        ['bank', 3],
        ['scalar', 3],
      ]);
      assert.equal(bank.get(7), 1);
      assert.equal(bank.get(60), 3);
      for (const [name, count] of expectedCounts) assert.equal(collection.count(name), count, name);
      assert.deepEqual(declarationPending, expectedPending);
      assert.equal(collection.peekPending(), null);
      assert.equal(collection.lookup('scalar', 0).key, 'scalar');
      assert.deepEqual(
        [...root.player.unsupportedCommands],
        [
          'assets.int/count-expression#START:0: FES definition bank requires an explicit array count',
        ],
      );
      const objects = expectedPending
        .slice(0, -1)
        .map(([name, index]) => collection.lookup(ascii(name), index));
      assert.ok(objects.every((object) => object?.nativeType === 1));
      for (let at = 0; at < objects.length; at++) {
        const object = objects[at],
          [name, index] = expectedPending[at];
        assert.equal(object.key, `${name}[${index}]`);
        assert.deepEqual(collection.reference(object), { nameBytes: ascii(name), index });
        assert.equal(object.imageResource.bitmap, 0);
      }
      assert.equal(runtime.resources.entries.length, 9);
      assert.deepEqual(
        runtime.resources.entries.map(({ name, index }) => [name, index]),
        expectedPending.slice(0, -1),
      );
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      const image = collection.lookup('bank', 1),
        bitmap = image.imageResource.bitmap;
      assert.ok(bitmap);
      assert.deepEqual(
        [image.width, image.height, image.color, image.x, image.y],
        [2, 3, 0xff335577, 7, 11],
      );
      assert.deepEqual(
        [h.world.graphics.images.get(bitmap).width, h.world.graphics.images.get(bitmap).height],
        [2, 3],
      );
      assert.equal(runtime.resources.entries[0].image.owner, current.id);
      assert.equal(bank.get(60), 3);
      assert.equal(reads, 1);
      assert.equal(initializeCalls, 1);
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      phase = 'restore';
      bank.set(60, 99);
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original during count expression restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const restored = fresh.world.objects.objects.get(current.id).implementation.player.root,
        next = restored.runtime,
        restoredBank = fresh.world.runtime.variableBank(fresh.world.main, false);
      assert.equal(reads, 1);
      assert.equal(initializeCalls, 1);
      assert.equal(
        restoredBank.get(60),
        3,
        'fresh must restore evaluated state without running count expressions',
      );
      assert.equal(bank.get(60), 99);
      assert.deepEqual(restored.program.definitions.map(fesByteView), expectedDefinitions);
      for (const [name, count] of expectedCounts)
        assert.equal(next.collection.count(name), count, name);
      assert.equal(next.collection.peekPending(), null);
      assert.equal(next.resources.entries.length, 9);
      assert.equal(next.collection.lookup('bank', 1).imageResource.bitmap, bitmap);
      assert.notEqual(next.collection.lookup('bank', 1), image);
      assert.deepEqual(
        [...restored.player.unsupportedCommands],
        [],
        'diagnostic output is not replayed on restore',
      );
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
