// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { Binary } from '../src/binary.mjs';
import { HTTPFile } from '../src/files.mjs';
import { formatNativeAt } from '../src/kcs.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { M2ScenePreparation } from '../src/native/emote-scene-preparation.mjs';
import {
  NativeSceneData,
  NativeSceneReader,
  NativeSceneHistory,
  nativeSceneData,
} from '../src/native/scene-data.mjs';
import { kcsProgram, translation } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

function cst(blocks, packed = true) {
  const lines = blocks.flat(),
    strings = [],
    offsets = [];
  for (const [kind, text, header = [1, kind]] of lines) {
    offsets.push(strings.length);
    strings.push(...header, ...encodeCP932(text), 0);
  }
  const body = new Uint8Array(16 + blocks.length * 8 + lines.length * 4 + strings.length),
    view = new DataView(body.buffer);
  const header = [
    body.length - 16,
    blocks.length,
    blocks.length * 8,
    blocks.length * 8 + lines.length * 4,
  ];
  header.forEach((value, i) => view.setUint32(i * 4, value, true));
  let start = 0;
  blocks.forEach((block, i) => {
    view.setUint32(16 + i * 8, block.length, true);
    view.setUint32(20 + i * 8, start, true);
    start += block.length;
  });
  offsets.forEach((offset, i) => view.setUint32(16 + blocks.length * 8 + i * 4, offset, true));
  body.set(strings, 16 + header[3]);
  const payload = packed ? deflateSync(body) : body,
    file = new Uint8Array(16 + payload.length),
    fileView = new DataView(file.buffer);
  file.set(new TextEncoder().encode('CatScene'));
  fileView.setUint32(8, packed ? payload.length : 0, true);
  fileView.setUint32(12, body.length, true);
  file.set(payload, 16);
  return file;
}

test('restored scene hints prepare one explicit M2 resource from the same mounted scene', async (t) => {
  const workerBefore = globalThis.Worker;
  let pending = Promise.withResolvers();
  let terminated = 0;
  globalThis.Worker = class {
    postMessage({ bytes, length }) {
      assert.equal(bytes.length, 65536);
      pending.resolve(() => this.onmessage({ data: { expanded: new Uint8Array(length) } }));
    }
    terminate() {
      terminated++;
    }
  };
  t.after(() => {
    if (workerBefore === undefined) delete globalThis.Worker;
    else globalThis.Worker = workerBefore;
  });
  const sceneBytes = cst(
      [
        [[0x30, 'mpl 1 sample,2,pose']],
        [
          [0x30, 'vo speech'],
          [0x20, 'Dialogue'],
        ],
        [
          [0x30, 'mpl 1 sample,2,pose'],
          [0x30, 'mpl 1 sample,3,pose'],
        ],
      ],
      false,
    ),
    scene = new NativeSceneData(),
    packed = new Uint8Array(16 + 65536);
  await scene.reader.load(sceneBytes);
  scene.history.appendPath('active', 0);
  packed.set([80, 83, 90, 0]);
  const header = new DataView(packed.buffer);
  header.setUint32(4, 65536, true);
  header.setUint32(8, 8 * 1024 * 1024, true);
  const sceneFile = new HTTPFile('http://localhost/scene', sceneBytes.length, 0),
    modelFile = new HTTPFile('http://localhost/model', packed.length, 0),
    reads = [];
  const resourceCache = { pending: 0, entries: [] };
  let mountedScene = sceneBytes;
  let modelOffset = 0;
  let onSceneRead;
  const owner = {
    profiles: {
      profileFiles: { sample: 'test' },
      profile: () => ({ bodies: { 2: 'model', 3: 'already-loaded' } }),
    },
    documents: new Map(),
    world: {
      profile: 'nekopara-vol3-engine-2.6.1.76',
      runtime: { handles: { records: new Map([[1, { type: 'scene-data', value: scene }]]) } },
      resourceCache,
      game: {
        resolveCategory: (name) => name,
        nativeCandidates(name) {
          const file = name === 'active' ? sceneFile : modelFile;
          return [{ hit: { file, offset: name === 'active' ? 0 : modelOffset, size: file.size } }];
        },
        async requireCategory(name, category) {
          reads.push([name, category]);
          if (name === 'active') onSceneRead?.();
          return name === 'active' ? mountedScene : packed;
        },
      },
    },
  };
  const preparation = new M2ScenePreparation(owner);
  owner.world.profile = 'sdk-4.01-engine-2.6.1.74';
  preparation.resume();
  assert.deepEqual(reads, []);
  owner.world.profile = 'nekopara-vol3-engine-2.6.1.76';

  mountedScene = cst([[[0x30, 'mpl 1 different,2,pose']]], false);
  preparation.resume();
  await new Promise(setImmediate);
  assert.deepEqual(reads.splice(0), [['active', 'scene']]);
  assert.equal(preparation.take('model'), null);
  preparation.discard();
  mountedScene = sceneBytes;

  preparation.resume();
  preparation.resume();
  const finish = await pending.promise;
  finish();
  await new Promise(setImmediate);
  assert.equal(terminated, 1);
  assert.deepEqual(reads, [
    ['active', 'scene'],
    ['model', 'm2psb'],
  ]);
  assert.equal(preparation.take('another-model'), null);
  const prepared = preparation.take('model');
  assert.equal(prepared.packed, packed);
  assert.equal(prepared.expanded.length, 8 * 1024 * 1024);
  assert.equal(preparation.take('model'), null);

  pending = Promise.withResolvers();
  preparation.hint(scene, 'active', 0);
  const stale = await pending.promise;
  scene.history.path = structuredClone(scene.history.path);
  stale();
  await new Promise(setImmediate);
  assert.equal(preparation.take('model'), null);
  assert.equal(terminated, 2);

  pending = Promise.withResolvers();
  preparation.resume();
  (await pending.promise)();
  await new Promise(setImmediate);
  modelOffset++;
  assert.equal(preparation.take('model'), null);
  assert.equal(terminated, 3);

  pending = Promise.withResolvers();
  preparation.resume();
  (await pending.promise)();
  await new Promise(setImmediate);
  resourceCache.entries.push({ filename: 'MODEL' });
  assert.equal(preparation.take('model'), null);
  assert.equal(terminated, 4);
  resourceCache.entries.length = 0;

  reads.length = 0;
  scene.history.appendPath('active', 1);
  preparation.resume();
  await new Promise(setImmediate);
  assert.deepEqual(reads, [], 'blocks without model declarations need no speculative CST read');
  assert.equal(preparation.take('model'), null);

  pending = Promise.withResolvers();
  scene.history.appendPath('active', 2);
  onSceneRead = () => owner.documents.set('already-loaded', {});
  preparation.resume();
  (await pending.promise)();
  await new Promise(setImmediate);
  assert.deepEqual(reads, [
    ['active', 'scene'],
    ['model', 'm2psb'],
  ]);
  assert.equal(preparation.take('model')?.packed, packed);
  assert.equal(terminated, 5);
  onSceneRead = null;

  pending = Promise.withResolvers();
  preparation.resume();
  const afterClose = await pending.promise;
  owner.world.disposalRequested = true;
  preparation.discard();
  afterClose();
  await new Promise(setImmediate);
  assert.equal(preparation.take('model'), null);
  assert.equal(terminated, 6);
});
const machine = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(16384),
    stackSize: 1024,
  });
const sample = () =>
  cst([
    [
      [0x30, 'next child'],
      [0x21, '猫'],
      [0x20, '一行'],
      [0x20, '続き'],
      [2, ''],
    ],
    [[0x30, 'return']],
  ]);

test('native CST indexing uses blocks, count sentinels, byte headers and current-position fallbacks', async () => {
  for (const packed of [true, false]) {
    const reader = new NativeSceneReader();
    assert.equal(reader.type(-1, -1), -1);
    assert.equal(
      await reader.load(cst([[[0x20, '猫']], [[0x30, 'A', [3, 0x30, 7, 8]]]], packed)),
      true,
    );
    assert.equal(reader.type(-1, 0), 2);
    assert.equal(reader.type(0, -1), 1);
    assert.equal(reader.type(0, 0), 0x20);
    assert.equal(reader.type(1, 0), -1);
    assert.equal(reader.type(2, 0), -1);
    assert.equal(decoder.decode(reader.text(1, 0)), 'A');
    assert.equal(reader.text(2, 0), null);
    assert.deepEqual(reader.text(-1, -1), encodeCP932('猫'));
    reader.block = 1;
    assert.equal(decoder.decode(reader.text(-1, -1)), 'A');
    assert.equal(await reader.load(new Uint8Array(16)), false);
    assert.equal(reader.type(-1, -1), 2);
  }
});
const decoder = new TextDecoder('shift_jis');

test('CSTL uses registered exact prefixes, block ordinal, first-message joining and UTF-8 bytes', async () => {
  const reader = new NativeSceneReader(['en', 'jp']);
  await reader.load(sample());
  assert.equal(
    reader.loadTranslations(translation(['unknown'], [{ unknown: ['Other', 'No'] }])),
    false,
  );
  assert.equal(
    reader.loadTranslations(
      translation(['en'], [{ en: ['Cat', 'First\x1fSecond\x1f\x1fIgnored'] }]),
    ),
    true,
  );
  assert.equal(new TextDecoder().decode(reader.text(0, 1, { language: 'en' })), 'Cat');
  assert.equal(new TextDecoder().decode(reader.text(0, 2, { language: 'en' })), 'FirstSecond');
  assert.equal(reader.text(0, 3, { language: 'en' }).length, 0);
  assert.deepEqual(reader.text(0, 2, { language: 'EN' }), encodeCP932('一行'));
  assert.equal(new TextDecoder().decode(reader.text(0, 2, { toUTF8: true })), '一行');
  assert.deepEqual(reader.text(0, 0, { language: 'en' }), encodeCP932('next child'));
  assert.equal(reader.messageCount(), 2);
  assert.deepEqual(
    new NativeSceneReader().restore(reader.snapshot()).snapshot(),
    reader.snapshot(),
  );
});

test('native scene resources keep explicit and task-local results, buffers and path indexes distinct', async () => {
  const m = machine(),
    handles = new NativeHandles(),
    services = {
      handles,
      sceneLanguages: [],
      format: (address) => m.string(address),
      read: (name) => (name === 'main' ? sample() : null),
    };
  const handle = nativeSceneData(0x143, [], m, services).value;
  services.sceneData = handles.get(handle, 'scene-data');
  m.writeString('main', 0);
  assert.equal((await nativeSceneData(0x145, [handle, 0], m, services)).value, 1);
  assert.equal(nativeSceneData(0x146, [handle, -1, 0], m, services).value, 2);
  assert.equal(nativeSceneData(0xdd, [0, 2], m, services).value, 0x20);
  m.writeString('unchanged', 64);
  assert.equal(nativeSceneData(0x147, [handle, 64, 5, 0], m, services).value, 0);
  assert.equal(nativeSceneData(0xde, [64, 5, 0], m, services).value, 9);
  assert.equal(m.string(64), 'unchanged');
  assert.equal(nativeSceneData(0x147, [handle, 64, 0, 2], m, services).value, 4);
  assert.equal(m.string(64), '一行');
  nativeSceneData(0x40d, [handle, 64, 0, 2], m, services);
  assert.equal(new TextDecoder().decode(m.bytes(64, 6)), '一行');
  m.writeString('CHILD.CST', 0);
  assert.equal(nativeSceneData(0x149, [handle, 0, 2], m, services).value, 0);
  assert.equal(nativeSceneData(0x149, [handle, 0, 3], m, services).value, 0);
  m.writeString('next.cst', 0);
  assert.equal(nativeSceneData(0x149, [handle, 0, 4], m, services).value, 1);
  assert.equal(nativeSceneData(0x14d, [handle, -1, 64, 128], m, services).value, 1);
  assert.equal(m.string(64), 'next');
  assert.equal(m.load(128), 4);
  nativeSceneData(0x144, [handle], m, services);
  assert.throws(() => handles.get(handle, 'scene-data'), /released/);
});

test('history preserves unsigned maxima, consecutive path coalescing and clipped string snapshots', () => {
  const h = new NativeSceneHistory();
  h.markSeen('Main', -1);
  h.markSeen('main', 10);
  assert.equal(h.seenValue('MAIN'), 0xffffffff);
  assert.equal(h.appendPath('A', 2), 0);
  assert.equal(h.appendPath('a', 1), 0);
  assert.equal(h.appendPath('B', 4), 1);
  assert.equal(h.appendPath('A', 3), 2);
  assert.equal(h.path[0].value, 2);
  assert.equal(h.setString(-1, 1, 2, new TextEncoder().encode('x'.repeat(80))), true);
  assert.equal(h.getString(2, 1, 2).bytes.length, 62);
  assert.deepEqual(h.getString(2, 1, 3), { found: false, bytes: new Uint8Array() });
  assert.equal(h.getString(0, 1, 2), null);
  h.aliasSeen('main', 'alias');
  assert.equal(h.seenValue('ALIAS'), 0xffffffff);
  assert.deepEqual(new NativeSceneHistory().restore(h.snapshot()).snapshot(), h.snapshot());
});

test('seen writes preserve the original formatted bytes, suffix rules and unsigned values after import', () => {
  const m = machine(),
    data = new NativeSceneData(),
    handles = new NativeHandles(),
    handle = handles.add('scene-data', data),
    services = { handles, sceneData: data, formatBytes: formatNativeAt },
    raw = Uint8Array.of(0x81, 0x30, 0xff, 0x51),
    filename = Uint8Array.of(...raw, 46, 67, 83, 84);
  m.writeString('%s[G768]', 128);
  m.writeStringBytes(filename, 768);
  assert.equal(nativeSceneData(0x148, [handle, 128, -1], m, services).value, 1);
  assert.equal(nativeSceneData(0x148, [handle, 128, 12], m, services).value, 1);
  assert.equal(nativeSceneData(0xdf, [128, 7], m, services).value, 1);
  const restored = new NativeSceneHistory();
  restored.decode('seen', data.history.encode('seen', true));
  data.history = restored;
  assert.deepEqual(
    restored.seen.map(({ nameBytes }) => nameBytes.slice(0, nameBytes.indexOf(0))),
    [raw, filename],
  );
  assert.equal(nativeSceneData(0x14c, [handle, 128], m, services).value, 0xffffffff);
  assert.equal(nativeSceneData(0xe3, [128], m, services).value, 7);
});

test('native path writes, copies and reads keep undecodable names distinct after import', () => {
  const m = machine(),
    handles = new NativeHandles(),
    source = new NativeSceneData(),
    target = new NativeSceneData(),
    handle = handles.add('scene-data', source),
    copied = handles.add('scene-data', target),
    services = { handles, formatBytes: formatNativeAt },
    raw = Uint8Array.of(0x81, 0x30, 0xff, 0x51),
    other = Uint8Array.of(0x81, 0x30, 0xfe, 0x51);
  m.writeStringBytes(Uint8Array.of(...raw, 46, 67, 83, 84), 128);
  assert.equal(nativeSceneData(0x149, [handle, 128, 6], m, services).value, 0);
  m.writeStringBytes(Uint8Array.of(0x81, 0x30, 0xff, 0x71), 128);
  assert.equal(nativeSceneData(0x149, [handle, 128, 3], m, services).value, 0);
  m.writeStringBytes(other, 128);
  assert.equal(nativeSceneData(0x149, [handle, 128, 4], m, services).value, 1);
  assert.equal(nativeSceneData(0x3e1, [copied, handle], m, services).control, 2);
  target.history.decode('path', target.history.encode('path', true));
  for (const [index, expectedIndex, expectedName, expectedValue] of [
    [0, 0, raw, 6],
    [-1, 1, other, 4],
  ]) {
    m.bytes(256, 8).fill(0xa5);
    assert.equal(
      nativeSceneData(0x14d, [copied, index, 256, 288], m, services).value,
      expectedIndex,
    );
    assert.deepEqual(m.bytes(256, 8), Uint8Array.of(...expectedName, 0, 0xa5, 0xa5, 0xa5));
    assert.equal(m.load(288), expectedValue);
  }
});

test('formatted seen aliases preserve raw bytes and values across native history import', () => {
  const m = machine(),
    data = new NativeSceneData(),
    handles = new NativeHandles(),
    handle = handles.add('scene-data', data),
    services = { handles, formatBytes: formatNativeAt },
    alias = Uint8Array.of(0x81, 0x30, 0xff, 0x51);
  data.history.markSeen('source', -1);
  m.writeString('%s[G512]', 128);
  m.writeString('%s[G768]', 256);
  m.writeString('SOURCE', 512);
  m.writeStringBytes(alias, 768);
  assert.equal(nativeSceneData(0x3a6, [handle, 128, 256], m, services).control, 2);

  const restored = new NativeSceneHistory();
  restored.decode('seen', data.history.encode('seen', true));
  assert.deepEqual(
    restored.seen[1].nameBytes.subarray(0, alias.length + 1),
    Uint8Array.of(...alias, 0),
  );
  assert.equal(restored.seenValue(alias), 0xffffffff);
  assert.equal(restored.seenValue(Uint8Array.of(0x81, 0x30, 0xff, 0x71)), 0xffffffff);
  assert.equal(restored.seenValue(Uint8Array.of(0x81, 0x30, 0xfe, 0x51)), 0);
  data.history = restored;
  m.writeStringBytes(Uint8Array.from([...alias, ...encodeCP932('.CST')]), 384);
  assert.equal(nativeSceneData(0x14c, [handle, 384], m, services).value, 0xffffffff);
  assert.equal(nativeSceneData(0xe3, [384], m, { ...services, sceneData: data }).value, 0);
  assert.equal(nativeSceneData(0xe3, [768], m, { ...services, sceneData: data }).value, 0xffffffff);
  assert.throws(
    () => nativeSceneData(0x3a6, [handle, 128, 0x7fffffff], m, services),
    /unmapped format string/,
  );
  assert.equal(nativeSceneData(0x3a6, [0, 128, 0x7fffffff], m, services).control, 2);
});

test('history string substitution snapshots only referenced values and expands once', () => {
  const m = machine(),
    data = new NativeSceneData(),
    strings = new NativeStringBank(),
    handles = new NativeHandles(),
    handle = handles.add('scene-data', data),
    services = { handles, strings };
  data.history.appendPath('main', 1);
  strings.set(3, 'stored $str4');
  strings.set(4, 'late');
  m.writeString('A$str3 B$str4 C$str5', 0);
  nativeSceneData(0x150, [handle, 0, 9, 0], m, services);
  strings.set(3, 'changed');
  nativeSceneData(0x151, [handle, 0, 9, 0], m, services);
  assert.equal(m.string(0), 'Astored $str4 Blate C');
});

function queuedNumberProgram() {
  const token = 1024,
    index = 1536,
    value = 1540,
    instructions = [
      [43, 0x41, 0],
      [21, [0x13, value], 0],
      [60],
      [37, token],
      [37, 256],
      [37, 1],
      [43, 0x207, 12],
      [45],
      [37, token],
      [43, 0xd5, 4],
      [38, [0x13, index]],
      [37, token],
      [37, 256],
      [37, 2],
      [43, 0x207, 12],
      [39, 0],
      [37, token],
      [43, 0xd5, 4],
      [38, [0x13, value]],
    ],
    formatPC = instructions.reduce((size, row) => size + 1 + (row.length - 1) * 5, 0);
  instructions[15][1] = formatPC;
  instructions.push(
    [37, token],
    [37, 2048],
    [43, 0x0e, 8],
    [45],
    [37, [0x13, index]],
    [37, token],
    [43, 0x114, 8],
    [43, 0x41, 0],
    [41, 11],
  );
  return kcsProgram(instructions, [[2048, '%d[G1540]']]);
}

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} queued CST numeric strings evaluate at dispatch and survive a cold World`, async () => {
    // Owned KCS composes the same selector/evaluator/formatter/string-bank
    // boundary as sscript strn; private source bytecode is never executed here.
    const files = {
        'queued.kcs': queuedNumberProgram(),
        'queued.cst': cst([
          [
            [0x30, 'strn $1 $2'],
            [0x20, 'value=$str7'],
            [0x30, 'strn 9'],
          ],
        ]),
      },
      world = await dataWorld(profile, files);
    let fresh;
    try {
      const main = world.main;
      await world.runtime.native('main', 0xd1, [16], main.machine, main);
      const bank = world.runtime.variableBank(main, false),
        strings = world.runtime.stringBank(main);
      bank.set(1, 5);
      bank.set(2, 12);
      strings.set(5, 'untouched');
      strings.set(7, 'before');
      const task = await world.spawnScript('queued.kcs', { parent: main.id, initialExecute: true }),
        m = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, task),
        scene = (await call(0x143, [])).value;
      assert.equal(task.status, 'yielded');
      m.writeString('queued.cst', 128);
      assert.equal((await call(0x145, [scene, 128])).value, 1);
      await call(0x147, [scene, 256, 0, 0]);
      await call(0x147, [scene, 512, 0, 1]);
      assert.equal(m.string(256), 'strn $1 $2');
      assert.equal(m.string(512), 'value=$str7');
      assert.equal(strings.get(7), 'before');
      bank.set(1, 7);
      bank.set(2, -19);
      const saved = structuredClone(world.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      const calls = [],
        reads = [],
        native = fresh.runtime.native,
        read = fresh.game.read;
      fresh.runtime.native = function (...args) {
        calls.push(args[1]);
        return native.apply(this, args);
      };
      fresh.game.read = function (...args) {
        reads.push(args[0]);
        return read.apply(this, args);
      };
      await fresh.restore(saved);
      assert.deepEqual(fresh.snapshot(), saved, 'fresh restore does not execute queued commands');
      assert.deepEqual(calls, []);
      // Game's existing M2 owner reopens its immutable configuration when an
      // initialized owner is rebound; the stored CST body is not reloaded.
      assert.ok(reads.every((name) => ['case.kcs', 'queued.kcs', 'm2view.cnf'].includes(name)));
      assert.equal(reads.includes('queued.cst'), false);
      assert.deepEqual(fresh.random.snapshot(), world.random.snapshot());
      const restored = fresh.runtime.scheduler.tasks.get(task.id),
        restoredStrings = fresh.runtime.stringBank(restored, false);
      assert.equal(restoredStrings.get(7), 'before');
      assert.equal(restored.machine.string(512), 'value=$str7');
      await fresh.runtime.scheduler.execute(restored);
      assert.deepEqual(calls, [0x207, 0xd5, 0x207, 0xd5, 0x0e, 0x114, 0x41]);
      assert.equal(restoredStrings.get(5), 'untouched');
      assert.equal(restoredStrings.get(7), '-19');
      assert.equal(strings.get(7), 'before', 'fresh string bank is independently owned');
      assert.equal(restored.machine.string(512), 'value=$str7');
      await fresh.runtime.native('main', 0x116, [512], restored.machine, restored);
      assert.equal(restored.machine.string(512), 'value=-19');
      await fresh.runtime.native('main', 0x147, [scene, 256, 0, 2], restored.machine, restored);
      await fresh.runtime.scheduler.execute(restored);
      assert.equal(
        restoredStrings.get(9),
        '0',
        'an omitted numeric argument uses the script default',
      );
      assert.equal(restoredStrings.get(7), '-19');
      assert.equal(fresh.nativeEngine, undefined);
      assert.equal(world.nativeEngine, undefined);
      await fresh.runtime.native('main', 0x144, [scene], restored.machine, restored);
      assert.throws(() => fresh.runtime.handles.get(scene), /released/);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
}
