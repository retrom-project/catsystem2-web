// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  filename = 'assets.int/zero.fes',
  source = `#DEFINE
CIMAGE zero[0]
CIMAGE pair[2]
VIEW scalar
NUMIMG hole[0]
#OBJECT SIZE COLOR POS
zero 2,3 0xff335577 7,11
pair 1,1 0xff445566 0,0
#START
break
`;
async function environment(profile) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/zero.fes': ascii(source) },
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

for (const profile of startupProfiles) {
  test(`DEFINE zero count creates one default object and initializer, with current fresh ownership: ${profile}`, async (t) => {
    const h = await environment(profile);
    let fresh,
      phase = 'load',
      sourceReads = 0,
      initializeCalls = 0,
      declarationPending,
      declarationResourceCount;
    try {
      const current = await task(h.world),
        file = h.game.lookup(filename).file,
        read = file.read.bind(file),
        initialize = FESCoordinator.prototype.initialize;
      t.mock.method(file, 'read', (...args) => {
        if (phase === 'restore') throw new Error('Fresh DEFINE replayed FES source');
        sourceReads++;
        return read(...args);
      });
      t.mock.method(FESCoordinator.prototype, 'initialize', async function (...args) {
        initializeCalls++;
        const result = await initialize.apply(this, args);
        declarationPending = this.collection.pending.map(({ name, index }) => [name.text, index]);
        declarationResourceCount = this.resources.entries.length;
        return result;
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => filename },
      });
      const root = current.implementation.player.root,
        runtime = root.runtime,
        collection = runtime.collection,
        zero = collection.lookup('zero', 0);
      assert.ok(runtime instanceof FESCoordinator);
      assert.equal(collection.count('zero'), 1);
      assert.ok(zero);
      assert.equal(zero.key, 'zero[0]');
      assert.equal(zero.nativeType, 1);
      assert.deepEqual(
        [zero.width, zero.height, zero.color, zero.x, zero.y],
        [2, 3, 0xff335577, 7, 11],
      );
      assert.equal(collection.count('pair'), 2);
      assert.equal(collection.count('scalar'), 1);
      assert.equal(collection.lookup('scalar', 0).key, 'scalar');
      assert.equal(collection.count('hole'), 1);
      assert.equal(collection.lookup('hole', 0), null);
      assert.deepEqual(declarationPending, [
        ['zero', 0],
        ['pair', 0],
        ['pair', 1],
        ['scalar', 0],
        ['hole', 0],
      ]);
      assert.equal(declarationResourceCount, 0);
      assert.equal(collection.peekPending(), null);
      assert.equal(runtime.resources.entries.length, 3);
      assert.equal(zero.imageResource.bitmap, 0);
      assert.equal(root.program.definitions[0].count, '0');
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      assert.equal(collection.peekPending(), null);
      assert.deepEqual(
        runtime.resources.entries.map(({ name, index, savedType }) => [name, index, savedType]),
        [
          ['zero', 0, 1],
          ['pair', 0, 1],
          ['pair', 1, 1],
        ],
      );
      assert.equal(runtime.resources.entries[0].image.owner, current.id);
      const bitmap = zero.imageResource.bitmap;
      assert.ok(bitmap);
      assert.deepEqual(
        [h.world.graphics.images.get(bitmap).width, h.world.graphics.images.get(bitmap).height],
        [2, 3],
      );
      // The dynamic instance API delegates to the same collection but is not
      // the original normal-DEFINE zero-to-one branch.
      assert.deepEqual(root.createObjects(1, 'dynamicZero', 0), []);
      assert.equal(collection.hasGroup('dynamicZero'), true);
      assert.equal(collection.count('dynamicZero'), 0);
      assert.equal(collection.lookup('dynamicZero', 0), null);
      assert.equal(collection.peekPending(), null);
      assert.equal(initializeCalls, 1);
      assert.equal(sourceReads, 1);
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      phase = 'restore';
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original during fresh DEFINE restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const restored = fresh.world.objects.objects.get(current.id).implementation.player.root,
        next = restored.runtime,
        nextZero = next.collection.lookup('zero', 0);
      assert.equal(initializeCalls, 1);
      assert.equal(sourceReads, 1);
      assert.equal(restored.program.definitions[0].count, '0');
      assert.equal(next.collection.count('zero'), 1);
      assert.equal(next.collection.count('hole'), 1);
      assert.equal(next.collection.lookup('hole', 0), null);
      assert.equal(next.collection.count('dynamicZero'), 0);
      assert.equal(next.collection.lookup('dynamicZero', 0), null);
      assert.equal(next.collection.peekPending(), null);
      assert.equal(nextZero.key, 'zero[0]');
      assert.equal(nextZero.handle, zero.handle);
      assert.deepEqual(
        [nextZero.width, nextZero.height, nextZero.color, nextZero.x, nextZero.y],
        [2, 3, 0xff335577, 7, 11],
      );
      assert.equal(next.resources.entries.length, 3);
      assert.equal(nextZero.imageResource.bitmap, bitmap);
      assert.equal(nextZero.imageResourceEntryID, zero.imageResourceEntryID);
      assert.notEqual(nextZero.imageResource, zero.imageResource);
      assert.deepEqual(
        [
          fresh.world.graphics.images.get(bitmap).width,
          fresh.world.graphics.images.get(bitmap).height,
        ],
        [2, 3],
      );
      await h.world.objects.release(current.id);
      assert.equal(h.world.runtime.handles.records.has(bitmap), false);
      assert.equal(fresh.world.graphics.images.get(bitmap).width, 2);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
