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
// These raw names are collection author data, not a DEFINE/338 admission claim.
const bindingNames = [Uint8Array.of(114, 0x81), Uint8Array.of(114, 0x82)],
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part])),
  bindingSource = join(
    ascii(source),
    ascii('#'),
    bindingNames[0],
    ascii('.FOCUS\n$62=100+@\nbreak\n#'),
    bindingNames[1],
    ascii('.FOCUS\n$62=200+@\nbreak\n'),
  );
function bindingIDs(input, reference) {
  return input.state.buttons
    .filter(
      ([stored]) =>
        stored.index === reference.index &&
        stored.nameBytes.length === reference.nameBytes.length &&
        stored.nameBytes.every((byte, at) => byte === reference.nameBytes[at]),
    )
    .map(([, id]) => id);
}
async function environment(profile, files = {}) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/type.fes': bindingSource, ...files },
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
      assert.ok(
        input.state.buttons.some(
          ([reference, id]) =>
            fesByteView(reference.nameBytes) === 'Choice' &&
            reference.index === 0 &&
            id === child.id,
        ),
      );
      assert.equal(bank.get(60), 0);
      await h.world.sendEngine(current.id, h.world.main.id, 64, h.world.nativeTaskID(child.id), 1);
      assert.equal(bank.get(60), 1);
      assert.deepEqual(input.state.focus, { nameBytes: ascii('Choice'), index: 0 });
      const rawObjects = [
          ...collection.create('BUTTON', bindingNames[0], 2),
          ...collection.create('BUTTON', bindingNames[1], 1),
        ],
        rawRefs = rawObjects.map((object) => collection.reference(object));
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
      assert.equal(
        input.state.buttons.length,
        4,
        'Choice and all three raw tuples retain separate borrowed bindings',
      );
      const originalRawIDs = rawObjects.map((object) => object.nativeInputTaskID);
      rawObjects.forEach((object, index) => {
        assert.deepEqual(bindingIDs(input, rawRefs[index]), [originalRawIDs[index]]);
        assert.deepEqual(input.bounds(object), [4 + index * 10, 5, 10 + index * 10, 9]);
      });
      collection.create('BUTTON', bindingNames[0], 1);
      await runtime.initializeResources();
      const latestRawIDs = rawObjects.map((object) => object.nativeInputTaskID),
        rawEntries = runtime.resources.entries.filter(
          (entry) =>
            entry.index === 0 && fesByteView(entry.nameBytes) === fesByteView(bindingNames[0]),
        ),
        visited = [],
        sent = [],
        registrations = [],
        visit = runtime.images.visitEntry.bind(runtime.images),
        send = h.world.graphics.send.bind(h.world.graphics);
      assert.equal(rawEntries.length, 2);
      assert.notEqual(latestRawIDs[0], originalRawIDs[0]);
      assert.deepEqual(latestRawIDs.slice(1), originalRawIDs.slice(1));
      assert.deepEqual(bindingIDs(input, rawRefs[0]), [latestRawIDs[0]]);
      assert.equal(input.state.buttons.length, 4);
      assert.ok(input.input.get(originalRawIDs[0]), 'The old entry still owns its live Graph');
      t.mock.method(runtime.images, 'visitEntry', async (instance, object, entry, ...args) => {
        if (rawEntries.includes(entry)) visited.push([entry.id, object.nativeInputTaskID]);
        return visit(instance, object, entry, ...args);
      });
      t.mock.method(h.world.graphics, 'send', (id, ...args) => {
        if ([originalRawIDs[0], latestRawIDs[0]].includes(id)) {
          sent.push(id);
          if (args[1] === 89)
            registrations.push({
              id,
              sender: args[0],
              w: args[2],
              l: args[3],
              area: Array.from({ length: 6 }, (_, at) => args[4].load(at * 4) | 0),
            });
        }
        return send(id, ...args);
      });
      rawObjects[0].sizeDirty = true;
      rawObjects[0].dirty = true;
      await runtime.resources.traverse();
      assert.deepEqual(
        visited,
        rawEntries.map((entry) => [entry.id, latestRawIDs[0]]),
      );
      assert.ok(sent.length > 0);
      assert.ok(
        sent.every((id) => id === latestRawIDs[0]),
        'Old and new entries drive the current object child',
      );
      assert.deepEqual(registrations, [
        { id: latestRawIDs[0], sender: current.id, w: 0, l: 0, area: [4, 5, 10, 9, 99, 0] },
      ]);
      assert.deepEqual(input.bounds(rawObjects[0]), [4, 5, 10, 9]);
      const resourceCount = runtime.resources.entries.length,
        worldObjectCount = h.world.objects.objects.size;

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
      const restoredInput = restored.input,
        nextRaw = rawRefs.map((ref) => next.collection.lookup(ref.nameBytes, ref.index));
      assert.equal(next.runtime.resources.entries.length, resourceCount);
      assert.equal(
        fresh.world.objects.objects.size,
        worldObjectCount,
        'Fresh restore does not replay child allocation',
      );
      assert.equal(restoredInput.state.buttons.length, 4);
      nextRaw.forEach((object, index) => {
        assert.equal(object.nativeInputTaskID, latestRawIDs[index]);
        assert.deepEqual(bindingIDs(restoredInput, rawRefs[index]), [latestRawIDs[index]]);
        assert.deepEqual(restoredInput.bounds(object), [4 + index * 10, 5, 10 + index * 10, 9]);
        const task = fresh.world.objects.objects.get(latestRawIDs[index]);
        assert.equal(task.kind, 6);
        assert.equal(task.parent, current.id);
      });
      assert.ok(fresh.world.inputFor(current.id).get(originalRawIDs[0]));
      await restoredInput.warp(nextRaw[0]);
      assert.deepEqual(restored.player.mouse, { x: 4, y: 5 });
      assert.equal(restoredInput.input.get(latestRawIDs[0]).active, true);
      assert.equal(restoredInput.input.get(latestRawIDs[2]).active, false);
      for (const index of [1, 2]) {
        await fresh.world.sendEngine(
          current.id,
          fresh.world.main.id,
          64,
          fresh.world.nativeTaskID(latestRawIDs[index]),
          1,
        );
        assert.equal(nextBank.get(62), index === 1 ? 101 : 200);
        assert.deepEqual(restoredInput.state.focus, rawRefs[index]);
      }
      assert.equal(sourceReads, 1, 'Fresh raw events do not reread source');

      await h.world.objects.release(current.id);
      assert.equal(h.world.objects.objects.has(child.id), false);
      assert.equal(fresh.world.objects.objects.get(child.id).parent, current.id);
      for (const id of [...originalRawIDs, latestRawIDs[0]]) {
        assert.equal(h.world.objects.objects.has(id), false);
        assert.equal(fresh.world.objects.objects.get(id).parent, current.id);
      }
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
