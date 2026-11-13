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
  filename = 'assets.int/unknown-type.fes',
  source = `#DEFINE
CIMAGE before[$60++]
UNKNOWN skipped[$60++]
CIMAGE after[$60++]
#OBJECT SIZE COLOR POS
before 2,2 0xff335577 7,11
after 1,3 0xff445566 1,2
#START
break
`;
async function environment(profile) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/unknown-type.fes': ascii(source) },
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
for (const profile of startupProfiles) {
  test(`unknown DEFINE type diagnoses before name/count and continues legitimate declarations: ${profile}`, async (t) => {
    const h = await environment(profile);
    const names = [];
    let pending;
    try {
      const current = await task(h.world),
        bank = h.world.runtime.variableBank(h.world.main, false),
        host = current.implementation.player.host,
        argument = host.nativeFESArgumentBytes,
        initialize = FESCoordinator.prototype.initialize;
      assert.equal(bank.capacity, 64);
      bank.set(60, 1);
      t.mock.method(host, 'nativeFESArgumentBytes', function (token, ...args) {
        if (typeof token === 'string') names.push([token, bank.get(60)]);
        return argument.call(this, token, ...args);
      });
      t.mock.method(FESCoordinator.prototype, 'initialize', async function (...args) {
        const result = await initialize.apply(this, args);
        pending = this.collection.pending.map(({ name, index }) => [name.text, index]);
        assert.equal(this.resources.entries.length, 0);
        return result;
      });
      try {
        await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
          payload: { string: () => filename },
        });
      } catch (error) {
        t.diagnostic(JSON.stringify({ counter60: bank.get(60), nameExpansions: names }));
        throw error;
      }
      const root = current.implementation.player.root,
        runtime = root.runtime,
        collection = runtime.collection,
        before = collection.lookup('before', 0),
        after = collection.lookup('after', 1);
      assert.ok(runtime instanceof FESCoordinator);
      assert.deepEqual(
        root.program.definitions.map(({ type, name, count }) => [type, name, count]),
        [
          ['CIMAGE', 'before', '$60++'],
          ['UNKNOWN', 'skipped', '$60++'],
          ['CIMAGE', 'after', '$60++'],
        ],
      );
      assert.deepEqual(names, [
        ['before', 1],
        ['after', 2],
      ]);
      assert.equal(bank.get(60), 3);
      assert.deepEqual(
        [...root.player.unsupportedCommands],
        ['assets.int/unknown-type#START:0: Unknown FES declaration type UNKNOWN'],
      );
      assert.equal(collection.hasGroup('skipped'), false);
      assert.equal(collection.lookup('skipped', 0), null);
      assert.equal(collection.count('before'), 1);
      assert.equal(collection.count('after'), 2);
      assert.equal(collection.objects.length, 3);
      assert.ok(collection.objects.every((object) => object.nativeType === 1));
      assert.deepEqual(pending, [
        ['before', 0],
        ['after', 0],
        ['after', 1],
      ]);
      assert.equal(collection.peekPending(), null);
      assert.deepEqual(
        runtime.resources.entries.map(({ name, index }) => [name, index]),
        pending,
      );
      assert.deepEqual(collection.reference(after), { nameBytes: ascii('after'), index: 1 });
      assert.equal(before.imageResource.bitmap, 0);
      assert.equal(after.imageResource.bitmap, 0);
      assert.deepEqual(
        [before.width, before.height, before.color, before.x, before.y],
        [2, 2, 0xff335577, 7, 11],
      );
      assert.deepEqual(
        [after.width, after.height, after.color, after.x, after.y],
        [1, 3, 0xff445566, 1, 2],
      );
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      for (const [object, width, height] of [
        [before, 2, 2],
        [after, 1, 3],
      ]) {
        const bitmap = object.imageResource.bitmap;
        assert.ok(bitmap);
        assert.deepEqual(
          [h.world.graphics.images.get(bitmap).width, h.world.graphics.images.get(bitmap).height],
          [width, height],
        );
      }
      assert.equal(runtime.resources.entries.length, 3);
      assert.ok(runtime.resources.entries.every((entry) => entry.image.owner === current.id));
      assert.equal(bank.get(60), 3);
      assert.deepEqual(names, [
        ['before', 1],
        ['after', 2],
      ]);
    } finally {
      await h.close();
    }
  });
}
