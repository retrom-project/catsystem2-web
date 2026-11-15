// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { FESDefinitionModel } from '../src/native/fes-definitions.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { parseProgram } from '../src/fes/program.mjs';
import { fesByteView } from '../src/fes/tokens.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  filename = 'assets.int/raw-define.fes',
  source = `#DEFINE
$str0
UNKNOWN skipped[$60++]
#DEFINE
CIMAGE second[$60++]
#OBJECT SIZE COLOR POS
final 2,3 0xff335577 7,11
second 1,1 0xff445566 1,2
#START
break
`;
async function environment(profile, contents = source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/raw-define.fes': ascii(contents) },
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
  const parent = world.main;
  world.runtime.stringBank(parent);
  const id = await world.objects.create({ kind: 34, parent: parent.id }),
    surface = await world.objects.create({ kind: 15, parent: parent.id });
  await world.sendEngine(surface, parent.id, 279, 64, 48);
  await world.sendEngine(surface, parent.id, 283);
  await world.sendEngine(id, parent.id, 331, 0, parent.context.variableBank);
  await world.sendEngine(id, parent.id, 334, 0, world.nativeTaskID(surface));
  assert.equal(world.objects.objects.get(id).context.stringBank, parent.context.stringBank);
  return {
    id,
    implementation: world.objects.objects.get(id).implementation,
    strings: world.runtime.handles.get(parent.context.stringBank, 'string-bank'),
  };
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

const rawRows = ['#DEFINE', '$str0', 'UNKNOWN skipped[$60++]', '#DEFINE', 'CIMAGE second[$60++]'];
const expectedTrace = [
  ['bank', '$str0', 1],
  ['token', '$str1', 1],
  ['token', '$str2', 1],
  ['bank', '$str3', 1],
  ['bank', 'UNKNOWN skipped[$60++]', 2],
  ['token', 'UNKNOWN', 2],
  ['bank', '#DEFINE', 2],
  ['bank', 'CIMAGE second[$60++]', 2],
  ['token', 'CIMAGE', 2],
  ['token', 'second[$60++]', 2],
  ['bank', 'second', 2],
];

for (const profile of startupProfiles) {
  test(`raw DEFINE rows keep all expansion stages, current resources and fresh state: ${profile}`, async (t) => {
    const h = await environment(profile);
    let fresh,
      phase = 'load',
      reads = 0,
      initializeCalls = 0,
      declarationTrace,
      pending;
    const trace = [],
      restoredBanks = [],
      restoredScripts = [];
    try {
      const current = await task(h.world),
        words = h.world.runtime.variableBank(h.world.main, false),
        strings = current.strings,
        file = h.game.lookup(filename).file,
        read = file.read.bind(file),
        host = current.implementation.player.host,
        bankOnly = host.nativeFESStringBytes,
        token = host.nativeFESArgumentBytes,
        initialize = FESCoordinator.prototype.initialize,
        compile = FESDefinitionModel.prototype.compile,
        expand = NativeStringBank.prototype.expandBytes,
        apply = NativeScriptReplacements.prototype.apply;
      words.set(60, 1);
      strings.setBytes(0, ascii('$str1 $str2'));
      strings.setBytes(1, ascii('TYPE_TOKEN'));
      strings.setBytes(2, ascii('seed[COUNT_TOKEN]'));
      strings.setBytes(3, ascii('final'));
      h.world.configuration.scriptReplacements.add(ascii('TYPE_TOKEN'), ascii('CIMAGE'));
      h.world.configuration.scriptReplacements.add(ascii('COUNT_TOKEN'), ascii('$60++'));
      h.world.configuration.scriptReplacements.add(ascii('seed'), ascii('$str3'));
      t.mock.method(file, 'read', (...args) => {
        if (phase === 'restore') throw new Error('raw DEFINE restore reread source');
        reads++;
        return read(...args);
      });
      t.mock.method(host, 'nativeFESStringBytes', function (bytes) {
        trace.push(['bank', fesByteView(bytes), words.get(60)]);
        return bankOnly.call(this, bytes);
      });
      t.mock.method(host, 'nativeFESArgumentBytes', function (bytes, ...args) {
        trace.push(['token', fesByteView(bytes), words.get(60)]);
        return token.call(this, bytes, ...args);
      });
      t.mock.method(FESDefinitionModel.prototype, 'compile', function (...args) {
        if (this.instance.runtimeID === current.id && declarationTrace === undefined)
          declarationTrace = trace.slice();
        return compile.apply(this, args);
      });
      t.mock.method(FESCoordinator.prototype, 'initialize', async function (...args) {
        initializeCalls++;
        if (phase === 'restore') throw new Error('fresh replayed raw DEFINE initialization');
        const value = await initialize.apply(this, args);
        pending = this.collection.pending.map(({ name, index }) => [name.text, index]);
        return value;
      });
      t.mock.method(NativeStringBank.prototype, 'expandBytes', function (...args) {
        if (phase === 'restore') restoredBanks.push(this);
        return expand.apply(this, args);
      });
      t.mock.method(NativeScriptReplacements.prototype, 'apply', function (...args) {
        if (phase === 'restore') restoredScripts.push(this);
        return apply.apply(this, args);
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => filename },
      });
      const root = current.implementation.player.root,
        runtime = root.runtime,
        collection = runtime.collection;
      assert.deepEqual(root.program.definitions.map(fesByteView), rawRows);
      assert.deepEqual(declarationTrace, expectedTrace);
      assert.equal(words.get(60), 3);
      assert.deepEqual(
        [...root.player.unsupportedCommands],
        ['assets.int/raw-define#START:0: Unknown FES declaration type UNKNOWN'],
      );
      assert.equal(collection.hasGroup('skipped'), false);
      assert.equal(collection.count('final'), 1);
      assert.equal(collection.count('second'), 2);
      assert.deepEqual(pending, [
        ['final', 0],
        ['second', 0],
        ['second', 1],
      ]);
      assert.equal(collection.peekPending(), null);
      assert.deepEqual(
        runtime.resources.entries.map(({ name, index }) => [name, index]),
        pending,
      );
      const final = collection.lookup('final', 0),
        second = collection.lookup('second', 1);
      assert.deepEqual(collection.reference(final), { nameBytes: ascii('final'), index: 0 });
      assert.deepEqual(
        [final.width, final.height, final.color, final.x, final.y],
        [2, 3, 0xff335577, 7, 11],
      );
      assert.deepEqual([second.width, second.height], [1, 1]);
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      const bitmap = final.imageResource.bitmap;
      assert.ok(bitmap);
      assert.deepEqual(
        [h.world.graphics.images.get(bitmap).width, h.world.graphics.images.get(bitmap).height],
        [2, 3],
      );
      assert.equal(runtime.resources.entries.length, 3);
      assert.ok(runtime.resources.entries.every((entry) => entry.image.owner === current.id));
      assert.equal(words.get(60), 3);
      assert.equal(reads, 1);
      assert.equal(initializeCalls, 1);
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      phase = 'restore';
      words.set(60, 99);
      strings.setBytes(3, ascii('changed'));
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original during raw DEFINE fresh');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const nextRoot = fresh.world.objects.objects.get(current.id).implementation.player.root,
        next = nextRoot.runtime,
        nextBank = fresh.world.runtime.stringBank(fresh.world.main);
      assert.deepEqual(nextRoot.program.definitions.map(fesByteView), rawRows);
      assert.notEqual(nextRoot.program.definitions[1], root.program.definitions[1]);
      assert.equal(fresh.world.runtime.variableBank(fresh.world.main, false).get(60), 3);
      assert.equal(words.get(60), 99);
      assert.deepEqual(nextBank.getBytes(3), ascii('final'));
      assert.equal(restoredBanks.filter((bank) => bank === nextBank).length, 0);
      assert.equal(
        restoredScripts.filter((rules) => rules === fresh.world.configuration.scriptReplacements)
          .length,
        0,
      );
      assert.equal(reads, 1);
      assert.equal(initializeCalls, 1);
      assert.equal(next.collection.count('final'), 1);
      assert.equal(next.collection.count('second'), 2);
      assert.equal(next.collection.peekPending(), null);
      assert.equal(next.resources.entries.length, 3);
      assert.equal(next.collection.lookup('final', 0).imageResource.bitmap, bitmap);
      assert.notEqual(next.collection.lookup('final', 0), final);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}

test('bare terminators and normal literal semicolons use the same owned raw-row schema', async () => {
  const prepared = ascii('#DEFINE\nCIMAGE x[0]\n\n; kept\n#DEFINE\nCIMAGE y\n'),
    program = parseProgram(prepared, { prepared: true });
  prepared.fill(0);
  assert.deepEqual(program.definitions.map(fesByteView), [
    '#DEFINE',
    'CIMAGE x[0]',
    '',
    '; kept',
    '#DEFINE',
    'CIMAGE y',
  ]);
  const bareSource = '#DEFINE\nCIMAGE scalar;\nCIMAGE array[2];\n#START\nbreak\n',
    bare = new FESInstance('bare-terminators', parseProgram(bareSource), new FESPlayer(null, null));
  assert.equal(bare.objects[0].baseName, 'scalar');
  assert.equal(bare.declaredGroups.array, 2);
  for (const bad of ['bad[12];;', 'bad;[12]', 'bad[12;]'])
    assert.throws(
      () =>
        new FESInstance(
          'bare-invalid',
          parseProgram(`#DEFINE\nCIMAGE ${bad}\n#START\nbreak\n`),
          new FESPlayer(null, null),
        ),
      /Invalid FES definition/,
    );
  const nativeSource =
      '#DEFINE\nCIMAGE scalar;\nCIMAGE array[2];\nCIMAGE suffix[1];;\nCIMAGE bad;[1]\n#OBJECT SIZE COLOR\nscalar; 1,1 0xff112233\narray 1,1 0xff223344\nsuffix 1,1 0xff334455\nbad; 1,1 0xff445566\n#START\nbreak\n',
    h = await environment(startupProfiles[1], nativeSource);
  try {
    const current = await task(h.world);
    await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
      payload: { string: () => filename },
    });
    const root = current.implementation.player.root,
      c = root.runtime.collection;
    assert.equal(c.lookup('scalar', 0), null);
    assert.equal(c.lookup('scalar;', 0).key, 'scalar;');
    assert.equal(c.count('array'), 2);
    assert.equal(c.count('suffix'), 1);
    assert.equal(c.count('bad;'), 1);
    assert.equal(c.objects.length, 5);
    assert.deepEqual([...root.player.unsupportedCommands], []);
    await h.world.sendEngine(current.id, h.world.main.id, 333);
    assert.equal(root.runtime.resources.entries.length, 5);
    assert.ok(c.objects.every((object) => object.imageResource.bitmap));
  } finally {
    await h.close();
  }
});

for (const profile of startupProfiles) {
  test(`normal CIMAGE FIFO keeps old wrappers through same-name SIZE and fresh restore: ${profile}`, async (t) => {
    const contents = `#DEFINE
CIMAGE same
#OBJECT SIZE COLOR
same 1,1 0xff112233
#START
break
#RESIZE
same[0] size 3 2
$41=++$41
break
`,
      h = await environment(profile, contents);
    let fresh,
      restoring = false,
      reads = 0,
      allocations = 0,
      initializations = 0;
    try {
      const current = await task(h.world),
        words = h.world.runtime.variableBank(h.world.main, false),
        file = h.game.lookup(filename).file,
        read = file.read.bind(file),
        initialize = FESCoordinator.prototype.initialize,
        allocate = FESCoordinator.prototype.allocateEntry;
      t.mock.method(file, 'read', (...args) => {
        if (restoring) throw new Error('CIMAGE FIFO restore reread FES source');
        reads++;
        return read(...args);
      });
      t.mock.method(FESCoordinator.prototype, 'initialize', function (...args) {
        if (restoring) throw new Error('CIMAGE FIFO restore replayed initialization');
        initializations++;
        return initialize.apply(this, args);
      });
      t.mock.method(FESCoordinator.prototype, 'allocateEntry', function (...args) {
        if (restoring) throw new Error('CIMAGE FIFO restore replayed resource allocation');
        allocations++;
        return allocate.apply(this, args);
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => filename },
      });
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      const root = current.implementation.player.root,
        runtime = root.runtime,
        collection = runtime.collection,
        old = collection.lookup(ascii('same'), 0),
        first = runtime.resources.entries[0],
        visits = [],
        visit = runtime.visitEntry;
      assert.equal(old.nativeType, 1);
      assert.equal(first.image.owner, current.id);
      assert.equal(first.image, old.imageResource);
      assert.deepEqual(
        [
          h.world.graphics.images.get(first.image.bitmap).width,
          h.world.graphics.images.get(first.image.bitmap).height,
        ],
        [1, 1],
      );
      t.mock.method(runtime, 'visitEntry', function (entry, object, ...args) {
        visits.push([entry.id, object.handle]);
        return visit.call(this, entry, object, ...args);
      });
      await collection.remove(old);
      const [replacement] = collection.create('CIMAGE', ascii('same'), 1, { scalar: true });
      assert.notEqual(replacement.handle, old.handle);
      assert.equal(replacement.nativeType, 1);
      assert.equal(collection.count('same'), 1);
      assert.equal(first.image.closed, false);
      assert.equal(runtime.resources.entries.length, 1);
      assert.equal(collection.peekPending().object, replacement);
      assert.deepEqual(collection.peekPending().nameBytes, ascii('same'));
      assert.equal(collection.peekPending().index, 0);
      assert.equal(words.get(41), 0);
      await h.world.sendEngine(current.id, h.world.main.id, 337, 0, 0, {
        payload: fesLabelPayload(() => ascii('RESIZE')),
      });
      assert.equal(words.get(41), 1, 'real RESIZE source ran once');
      assert.deepEqual([replacement.width, replacement.height], [3, 2]);
      assert.deepEqual(visits, [[first.id, replacement.handle]]);
      assert.deepEqual(
        [
          h.world.graphics.images.get(first.image.bitmap).width,
          h.world.graphics.images.get(first.image.bitmap).height,
        ],
        [3, 2],
        'the retained entry wrapper consumes SIZE for the new same-key CIMAGE',
      );
      assert.equal(runtime.resources.entries.length, 1);
      assert.equal(collection.peekPending().object, replacement);
      visits.length = 0;
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      const second = runtime.resources.entries[1];
      assert.equal(runtime.resources.entries.length, 2);
      assert.deepEqual(visits, [
        [first.id, replacement.handle],
        [second.id, replacement.handle],
      ]);
      assert.notEqual(first.image, second.image);
      assert.equal(second.image.owner, current.id);
      assert.equal(replacement.imageResource, second.image);
      assert.equal(second.image.bitmap, 0, 'SIZE was already consumed by the earlier entry');
      assert.equal(runtime.images.currentBitmap(replacement), 0);
      assert.equal(collection.peekPending(), null);
      assert.equal(words.get(41), 1);
      assert.deepEqual([reads, initializations, allocations], [1, 1, 2]);
      const savedResources = runtime.resources.snapshot();
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      restoring = true;
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original during CIMAGE FIFO restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const next = fresh.world.objects.objects.get(current.id).implementation.player.root.runtime,
        restored = next.collection.lookup(ascii('same'), 0);
      assert.notEqual(fresh.world, h.world);
      assert.notEqual(restored, replacement);
      assert.equal(restored.handle, replacement.handle);
      assert.deepEqual(next.resources.snapshot(), savedResources);
      assert.notEqual(next.resources.entries[0].image, first.image);
      assert.notEqual(next.resources.entries[1].image, second.image);
      assert.equal(restored.imageResource, next.resources.entries[1].image);
      assert.equal(next.images.currentBitmap(restored), 0);
      assert.deepEqual(
        [
          fresh.world.graphics.images.get(next.resources.entries[0].image.bitmap).width,
          fresh.world.graphics.images.get(next.resources.entries[0].image.bitmap).height,
        ],
        [3, 2],
      );
      assert.equal(fresh.world.runtime.variableBank(fresh.world.main, false).get(41), 1);
      assert.deepEqual([reads, initializations, allocations], [1, 1, 2]);
      restoring = false;
      await collection.remove(replacement);
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      assert.equal(runtime.resources.entries.length, 0);
      assert.equal(first.image.closed, true);
      assert.equal(second.image.closed, true);
      assert.equal(next.resources.entries.length, 2, 'the fresh World retains independent entries');
      assert.deepEqual([...root.player.unsupportedCommands], []);
      assert.equal(h.world.nativeEngine, undefined);
      assert.equal(fresh.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
