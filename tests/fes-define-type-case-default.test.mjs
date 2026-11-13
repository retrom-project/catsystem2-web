// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fesByteView } from '../src/fes/tokens.mjs';
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
  filename = 'assets.int/type.fes',
  source = `#DEFINE
cImAgE Panel
bUtToN Choice
vIeW Anchor
#OBJECT SIZE COLOR
Panel 2,3 0xff335577
#OBJECT SIZE POS DISP ENABLE
Choice 8,6 20,10 1 1
#START
break
#Choice.FOCUS
$60=++$60
break
#Choice.UNFOCUS
$61=++$61
break
`;
async function environment(profile, files = {}) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/type.fes': ascii(source), ...files },
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
          throw new Error('DEFINE type matching must not open the original');
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

const rawDefinitions = ['#DEFINE', 'cImAgE Panel', 'bUtToN Choice', 'vIeW Anchor'];
for (const profile of startupProfiles) {
  test(`DEFINE known ASCII type case reaches canonical object and real Button consumers with fresh restore: ${profile}`, async (t) => {
    const h = await environment(profile);
    let fresh,
      phase = 'load',
      sourceReads = 0;
    try {
      const current = await task(h.world),
        file = h.game.lookup(filename).file,
        read = file.read.bind(file);
      t.mock.method(file, 'read', (...args) => {
        if (phase === 'restore') throw new Error('Casefold fresh restore reread FES source');
        sourceReads++;
        return read(...args);
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => filename },
      });
      const root = current.implementation.player.root,
        runtime = root.runtime,
        collection = runtime.collection,
        panel = collection.lookup('Panel', 0),
        button = collection.lookup('Choice', 0),
        input = current.implementation.input,
        bank = h.world.runtime.variableBank(h.world.main, false);
      assert.ok(runtime instanceof FESCoordinator);
      assert.deepEqual(root.program.definitions.map(fesByteView), rawDefinitions);
      assert.deepEqual(
        [panel, button, collection.lookup('Anchor', 0)].map(({ type, nativeType }) => [
          type,
          nativeType,
        ]),
        [
          ['CIMAGE', 1],
          ['BUTTON', 6],
          ['VIEW', 0],
        ],
      );
      assert.deepEqual([...root.keyNames], ['Choice']);
      assert.equal(collection.lookup('choice', 0), null);
      assert.equal(collection.lookup('panel', 0), null);
      assert.throws(
        () => collection.create('bUtToN', 'Dynamic', 1),
        /Unknown FES object type bUtToN/,
      );
      assert.equal(collection.hasGroup('Dynamic'), false);
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      assert.deepEqual([panel.width, panel.height, panel.color], [2, 3, 0xff335577]);
      assert.ok(panel.imageResource.bitmap);
      const entry = runtime.resources.entries.find(({ savedType }) => savedType === 6),
        child = h.world.objects.objects.get(entry.buttonTaskID);
      assert.equal(entry.name, 'Choice');
      assert.equal(entry.initialHandle, button.handle);
      assert.equal(child.kind, 6);
      assert.equal(child.parent, current.id);
      assert.equal(button.nativeInputTaskID, child.id);
      assert.ok(input.state.buttons.some(([key, id]) => key === 'Choice' && id === child.id));
      assert.equal(bank.get(60), 0);
      await h.world.sendEngine(current.id, h.world.main.id, 64, h.world.nativeTaskID(child.id), 1);
      assert.equal(bank.get(60), 1);
      assert.deepEqual(input.state.focus, { nameBytes: ascii('Choice'), index: 0 });
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
            throw new Error('No original during casefold fresh restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const restored = fresh.world.objects.objects.get(current.id).implementation,
        next = restored.player.root,
        nextButton = next.runtime.collection.lookup('Choice', 0),
        nextBank = fresh.world.runtime.variableBank(fresh.world.main, false);
      assert.deepEqual(next.program.definitions.map(fesByteView), rawDefinitions);
      assert.deepEqual([...next.keyNames], ['Choice']);
      assert.equal(nextButton.type, 'BUTTON');
      assert.equal(nextButton.nativeType, 6);
      assert.equal(nextButton.handle, button.handle);
      assert.equal(nextButton.nativeInputTaskID, child.id);
      assert.equal(sourceReads, 1);
      assert.equal(nextBank.get(60), 1);
      await fresh.world.sendEngine(
        current.id,
        fresh.world.main.id,
        64,
        fresh.world.nativeTaskID(child.id),
        0,
      );
      assert.equal(nextBank.get(61), 1);
      await fresh.world.sendEngine(
        current.id,
        fresh.world.main.id,
        64,
        fresh.world.nativeTaskID(child.id),
        1,
      );
      assert.equal(nextBank.get(60), 2);
      assert.equal(bank.get(60), 1);
      assert.equal(bank.get(61), 0);
      await h.world.objects.release(current.id);
      assert.equal(h.world.objects.objects.has(child.id), false);
      assert.equal(fresh.world.objects.objects.get(child.id).parent, current.id);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}

test('DEFINE SDK unsupported 36/37/38 keep the same canonical descriptor and actual factory gate for uppercase and mixed case', async (t) => {
  const profiles = [
      [
        'EFKPLANE',
        'eFkPlAnE',
        36,
        'FES EFKPLANE has no registered JavaScript implementation for this ABI',
      ],
      ['STRING8', 'sTrInG8', 37, 'The registered ABI has no STRING8 task implementation'],
      ['LOGSTRING8', 'lOgStRiNg8', 38, 'The registered ABI has no LOGSTRING8 task implementation'],
    ],
    files = Object.fromEntries(
      profiles.flatMap(([upper, mixed]) =>
        [upper, mixed].map((type, index) => [
          `assets/denied-${upper}-${index}.fes`,
          ascii(`#DEFINE\n${type} Denied\n#START\nbreak\n`),
        ]),
      ),
    ),
    h = await environment('sdk-4.01-engine-2.6.1.74', files),
    descriptors = [],
    construct = FESCoordinator.prototype.construct;
  try {
    t.mock.method(FESCoordinator.prototype, 'construct', function (identity) {
      if (identity.baseName === 'Denied')
        descriptors.push({ type: identity.type, nativeType: identity.nativeType });
      return construct.call(this, identity);
    });
    const liveUnsupported = () =>
      [...h.world.objects.objects.values()]
        .filter(({ kind }) => [61, 63].includes(kind))
        .map(({ id, kind }) => [id, kind]);
    const before = liveUnsupported();
    for (const [upper, mixed, nativeType, message] of profiles) {
      for (const [index, type] of [upper, mixed].entries()) {
        const current = await task(h.world);
        descriptors.length = 0;
        await assert.rejects(
          h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
            payload: { string: () => `assets.int/denied-${upper}-${index}.fes` },
          }),
          { message },
        );
        assert.deepEqual(descriptors, [{ type: upper, nativeType }], type);
        assert.deepEqual(liveUnsupported(), before);
        await h.world.objects.release(current.id);
      }
    }
  } finally {
    await h.close();
  }
});
