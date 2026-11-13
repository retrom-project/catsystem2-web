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
  filename = 'assets.int/hyphen.fes',
  source = `#DEFINE
CIMAGE panel-one[2]
BUTTON choice-one
#OBJECT SIZE COLOR
panel-one 2,3 0xff335577
#OBJECT SIZE POS DISP ENABLE
choice-one 8,6 20,10 1 1
#START
panel-one[1] pos 7 11
break
#choice-one.FOCUS
$60=++$60
break
#choice-one.UNFOCUS
$61=++$61
break
`;
async function environment(profile, files = {}) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/hyphen.fes': ascii(source), ...files },
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
          throw new Error('DEFINE literal names must not open the original');
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
  test(`DEFINE ASCII hyphen names retain literal native keys through actual objects, Button events and fresh: ${profile}`, async (t) => {
    const h = await environment(profile);
    let fresh,
      phase = 'load',
      sourceReads = 0;
    try {
      const current = await task(h.world),
        file = h.game.lookup(filename).file,
        read = file.read.bind(file);
      t.mock.method(file, 'read', (...args) => {
        if (phase === 'restore') throw new Error('Hyphen-name fresh restore reread FES source');
        sourceReads++;
        return read(...args);
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => filename },
      });
      const root = current.implementation.player.root,
        runtime = root.runtime,
        collection = runtime.collection,
        panels = [
          collection.lookup(ascii('panel-one'), 0),
          collection.lookup(ascii('panel-one'), 1),
        ],
        button = collection.lookup(ascii('choice-one'), 0),
        bank = h.world.runtime.variableBank(h.world.main, false);
      assert.ok(runtime instanceof FESCoordinator);
      assert.equal(bank.capacity, 64);
      assert.deepEqual(root.program.definitions.map(fesByteView), [
        '#DEFINE',
        'CIMAGE panel-one[2]',
        'BUTTON choice-one',
      ]);
      assert.equal(collection.count('panel-one'), 2);
      assert.equal(collection.count('choice-one'), 1);
      assert.deepEqual(
        panels.map(({ baseName, index, type }) => [baseName, index, type]),
        [
          ['panel-one', 0, 'CIMAGE'],
          ['panel-one', 1, 'CIMAGE'],
        ],
      );
      assert.equal(button.type, 'BUTTON');
      assert.equal(button.baseName, 'choice-one');
      assert.deepEqual(collection.reference(panels[1]), {
        nameBytes: ascii('panel-one'),
        index: 1,
      });
      assert.deepEqual(collection.reference(button), { nameBytes: ascii('choice-one'), index: 0 });
      assert.equal(collection.lookup('panel_one', 0), null);
      assert.equal(collection.lookup('panelone', 0), null);
      assert.equal(collection.lookup('PANEL-ONE', 0), null);
      assert.deepEqual([...root.keyNames], ['choice-one']);
      assert.deepEqual(
        runtime.resources.entries.map(({ name, nameBytes, index, savedType }) => [
          name,
          Array.from(nameBytes),
          index,
          savedType,
        ]),
        [
          ['panel-one', Array.from(ascii('panel-one')), 0, 1],
          ['panel-one', Array.from(ascii('panel-one')), 1, 1],
          ['choice-one', Array.from(ascii('choice-one')), 0, 6],
        ],
      );
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      assert.deepEqual(
        panels.map(({ width, height, color, x, y }) => [width, height, color, x, y]),
        [
          [2, 3, 0xff335577, 0, 0],
          [2, 3, 0xff335577, 7, 11],
        ],
      );
      assert.ok(panels.every((panel) => panel.imageResource.bitmap));
      const childID = button.nativeInputTaskID;
      assert.equal(h.world.objects.objects.get(childID).kind, 6);
      await h.world.sendEngine(current.id, h.world.main.id, 64, h.world.nativeTaskID(childID), 1);
      assert.equal(bank.get(60), 1);
      assert.deepEqual(current.implementation.input.state.focus, {
        nameBytes: ascii('choice-one'),
        index: 0,
      });
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
            throw new Error('No original during hyphen-name fresh restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const restored = fresh.world.objects.objects.get(current.id).implementation,
        next = restored.player.root,
        nextPanels = [
          next.runtime.collection.lookup(ascii('panel-one'), 0),
          next.runtime.collection.lookup(ascii('panel-one'), 1),
        ],
        nextButton = next.runtime.collection.lookup(ascii('choice-one'), 0),
        nextBank = fresh.world.runtime.variableBank(fresh.world.main, false);
      assert.deepEqual(next.program.definitions.map(fesByteView), [
        '#DEFINE',
        'CIMAGE panel-one[2]',
        'BUTTON choice-one',
      ]);
      assert.deepEqual(next.runtime.collection.reference(nextPanels[1]), {
        nameBytes: ascii('panel-one'),
        index: 1,
      });
      assert.deepEqual(next.runtime.collection.reference(nextButton), {
        nameBytes: ascii('choice-one'),
        index: 0,
      });
      assert.deepEqual(
        nextPanels.map(({ handle }) => handle),
        panels.map(({ handle }) => handle),
      );
      assert.deepEqual(
        nextPanels.map(({ imageResource }) => imageResource.bitmap),
        panels.map(({ imageResource }) => imageResource.bitmap),
      );
      assert.equal(nextButton.nativeInputTaskID, childID);
      assert.deepEqual([...next.keyNames], ['choice-one']);
      assert.equal(sourceReads, 1);
      assert.equal(nextBank.get(60), 1);
      await fresh.world.sendEngine(
        current.id,
        fresh.world.main.id,
        64,
        fresh.world.nativeTaskID(childID),
        0,
      );
      assert.equal(nextBank.get(61), 1);
      await fresh.world.sendEngine(
        current.id,
        fresh.world.main.id,
        64,
        fresh.world.nativeTaskID(childID),
        1,
      );
      assert.equal(nextBank.get(60), 2);
      assert.equal(bank.get(60), 1);
      assert.equal(bank.get(61), 0);
      await h.world.objects.release(current.id);
      assert.equal(h.world.objects.objects.has(childID), false);
      assert.equal(fresh.world.objects.objects.get(childID).parent, current.id);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
