// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { Binary } from '../src/binary.mjs';
import { HTTPFile } from '../src/files.mjs';
import { formatNativeAt, readKCS } from '../src/kcs.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
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
import { NativeResources } from '../src/native/resources.mjs';
import { parseXML } from '../src/xml.mjs';

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

test('2.6.1.67 CST GCALLs return count sentinels, current file markers and bounded CP932 strings', async (t) => {
  const text = encodeCP932('最初の本文'),
    handle = [0x13, 64],
    owned = [0x23, 256],
    missing = [0x23, 320],
    destination = [0x23, 512],
    rows = [
      [322, [owned], 1],
      [322, [missing], 0],
      [326, [0, 0, 0], 0],
      [326, [handle, 0, 0], -1],
      [608, [handle], -1],
      [325, [handle, owned], 1],
      [325, [handle, missing], 0],
      [326, [handle, -1, 0], 2],
      [326, [handle, 0, -1], 3],
      [326, [handle, 0, 0], 0xf0],
      [326, [handle, 0, 1], 0xf1],
      [326, [handle, 1, 0], 0x20],
      [326, [handle, 2, 0], -1],
      [327, [handle, destination, 1, 0], text.length],
      [327, [handle, [0x23, 768], 9, 9], 0],
      [338, [handle, [0x23, 640]], 42],
      [608, [handle], 2],
    ],
    world = await dataWorld('bokutomo-engine-2.6.1.67', {
      'scene-reader.kcs': kcsProgram(
        [
          [43, 323, 0],
          [38, 64],
          ...rows.flatMap(([id, args], index) => [
            ...args.map((word) => [37, word]),
            [43, id, args.length * 4],
            [38, 1024 + index * 4],
          ]),
          [59],
        ],
        [
          [256, 'owned.cst'],
          [320, 'missing.cst'],
        ],
      ),
      'release-scene.kcs': kcsProgram([[37, handle], [43, 324, 4], [59]]),
      'owned.cst': cst([
        [
          [0xf0, '本文'],
          [0xf1, '0x2a'],
          [0x20, '始まり'],
        ],
        [
          [0x20, '最初の本文'],
          [0x21, '語り手'],
        ],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    task = await world.spawnScript('scene-reader.kcs', { parent, initialExecute: false }),
    { machine } = task,
    floor = machine.sp,
    reads = [],
    read = world.game.read;
  world.game.read = function (name, ...args) {
    reads.push(name);
    return Reflect.apply(read, this, [name, ...args]);
  };
  for (const at of [512, 640, 768]) machine.bytes(at, 64).fill(0xba);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor);
  assert.deepEqual(
    rows.map((_, index) => machine.load(1024 + index * 4)),
    rows.map(([, , value]) => value >>> 0),
  );
  assert.deepEqual(machine.bytes(512, text.length + 2), Uint8Array.of(...text, 0, 0xba));
  assert.equal(machine.string(640), '本文');
  assert.deepEqual(machine.bytes(768, 64), new Uint8Array(64).fill(0xba));
  assert.deepEqual(reads, ['owned.cst', 'missing.cst', 'owned.cst', 'missing.cst']);
  const scene = machine.load(64),
    release = await world.spawnScript('release-scene.kcs', { parent, initialExecute: false });
  release.machine.store(64, scene);
  await world.runtime.scheduler.execute(release);
  assert.throws(() => world.runtime.handles.get(scene, 'scene-data'), /released/);
});

test('63 direct CST reads file markers and restores independent CP932 path history', async () => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    world = await dataWorld(profile, {
      'owned.cst': cst([
        [
          [0xf0, '本文'],
          [0xf1, '0x1c'],
          [0x20, '日本語の本文'],
        ],
      ]),
    });
  let fresh;
  try {
    const { main } = world,
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main),
      handle = (await call(323, [])).value;
    assert.deepEqual(await call(326, [0, 0, 0]), { control: 1, value: 0 });
    assert.deepEqual(await call(329, [0, 256, 0]), { control: 1, value: 0 });
    assert.deepEqual(await call(326, [handle, 0, 0]), { control: 1, value: 0xffffffff });
    await assert.rejects(async () => call(327, [handle, 1024, 0, 0]), /has no readable record/);
    m.writeString('owned.cst', 256);
    const reads = [],
      read = world.game.read;
    world.game.read = function (name, ...args) {
      reads.push(name);
      return Reflect.apply(read, this, [name, ...args]);
    };
    assert.deepEqual(await call(325, [handle, 256]), { control: 1, value: 1 });
    assert.deepEqual(reads, ['owned.cst']);
    assert.deepEqual(await call(328, [handle, 256, 9]), { control: 1, value: 1 });
    m.writeString('OWNED', 768);
    m.writeString('alias', 832);
    assert.deepEqual(await call(934, [handle, 768, 832]), { control: 2 });
    assert.deepEqual(await call(332, [handle, 832]), { control: 1, value: 9 });
    assert.deepEqual(await call(934, [handle, 0xffffffff, 832]), { control: 2 });
    assert.deepEqual(await call(329, [handle, 256, 4]), { control: 1, value: 1 });
    m.writeString('later.cst', 512);
    assert.deepEqual(await call(329, [handle, 512, 2]), { control: 1, value: 1 });
    assert.deepEqual(await call(329, [handle, 0xffffffff, 7]), { control: 1, value: 0 });
    assert.deepEqual(await call(326, [handle, -1, 0]), { control: 1, value: 1 });
    assert.deepEqual(await call(326, [handle, 0, -1]), { control: 1, value: 3 });
    assert.deepEqual(await call(326, [handle, 0, 0]), { control: 1, value: 0xf0 });
    assert.deepEqual(await call(326, [handle, 0, 1]), { control: 1, value: 0xf1 });
    assert.deepEqual(await call(327, [handle, 1024, 0, 2]), {
      control: 1,
      value: encodeCP932('日本語の本文').length,
    });
    assert.equal(m.string(1024), '日本語の本文');
    m.writeString('keep', 1024);
    assert.deepEqual(await call(338, [handle, 1024]), { control: 1, value: 28 });
    assert.equal(m.string(1024), '本文');
    assert.deepEqual(await call(333, [handle, 999, 1024, 1056]), { control: 1, value: 1 });
    assert.equal(m.string(1024), 'later');
    assert.equal(m.load(1056), 2);
    fresh = await dataWorld(profile, {}, { initialize: false });
    await fresh.restore(structuredClone(world.snapshot()));
    const restored = fresh.runtime.handles.get(handle, 'scene-data');
    assert.equal(restored.reader.type(0, 2), 0x20);
    assert.deepEqual(restored.reader.fileNameBytes, encodeCP932('本文'));
    assert.deepEqual(
      restored.history.path.map(({ scene, value }) => [scene, value]),
      [
        ['owned', 4],
        ['later', 2],
      ],
    );
    assert.deepEqual(await call(324, [handle]), { control: 2 });
    assert.throws(() => world.runtime.handles.get(handle, 'scene-data'), /released/);
    assert.equal(restored.history.path.length, 2);
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});

test('2.6.1.23 Script owns a narrow scene reader and path history', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23', {
    'owned.cst': cst([
      [
        [0xf0, '本文'],
        [0xf1, '0x1c'],
        [0x20, '日本語の本文'],
      ],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { main } = world,
    m = main.machine,
    call = (id, args) => world.runtime.native('main', id, args, m, main),
    value = (word) => ({ control: 1, value: word >>> 0 }),
    { value: handle } = call(323, []);
  assert.deepEqual(await call(608, [handle]), value(-1));
  m.writeString('owned.cst', 256);
  assert.deepEqual(await call(325, [handle, 256]), value(1));
  assert.deepEqual(await call(608, [handle]), value(1));
  assert.deepEqual(await call(326, [handle, 0, 0]), value(0xf0));
  assert.deepEqual(await call(326, [handle, 0, 1]), value(0xf1));
  assert.deepEqual(await call(338, [handle, 512]), value(28));
  assert.equal(m.string(512), '本文');
  const text = encodeCP932('日本語の本文');
  m.bytes(512, text.length + 2).fill(0xad);
  assert.deepEqual(await call(327, [handle, 512, 0, 2]), value(text.length));
  assert.deepEqual(m.bytes(512, text.length + 2), Uint8Array.of(...text, 0, 0xad));
  assert.deepEqual(await call(329, [handle, 256, 4]), value(1));
  m.writeString('', 320);
  assert.deepEqual(await call(329, [handle, 320, 9]), value(1));
  const data = world.runtime.handles.get(handle, 'scene-data');
  assert.deepEqual(
    data.history.path.map(({ scene, value }) => [scene, value]),
    [['owned', 4]],
  );
  assert.deepEqual(await call(324, [handle]), { control: 2 });
  assert.throws(() => world.runtime.handles.get(handle, 'scene-data'), /released/);
});

test('2.6.1.23 Scene existence GCALL formats category names without parsing or creating a reader', async () => {
  const resources = new NativeResources(
      parseXML('<document><INT><int00><name>scene</name><ext>cst</ext></int00></INT></document>'),
    ),
    files = new Map([
      ['chapter.cst', Uint8Array.of(1, 2, 3)],
      ['empty.cst', new Uint8Array()],
    ]),
    reads = [],
    runtime = new NativeRuntime({
      profile: 'grisaia-jp-engine-2.6.1.23',
      shared: new Uint8Array(2048),
      read: (name, category) => {
        if (category === 'kcs') return kcsProgram([[59]]);
        const resolved = resources.resolve(name, category);
        reads.push([name, category, resolved]);
        return files.get(resolved) ?? null;
      },
    }),
    task = await runtime.spawn('exists.kcs'),
    canary = 0x36eb67a5;
  for (const [name, result, address] of [
    ['chapter.cst', 1, 256],
    ['chapter', 1, 256],
    ['empty.cst', 1, 256],
    ['empty', 1, 0x80000040],
    ['missing.cst', 0, 256],
    ['%s[G200].cst', 1, 0x80000040],
  ]) {
    const program = await readKCS(kcsProgram([[37, canary], [37, address], [43, 322, 4], [59]]));
    task.status = 'ready';
    task.io = null;
    const m = (task.machine = new KCSMachine(
      program,
      { native: (id, args, machine) => runtime.scheduler.native(task, id, args, machine) },
      runtime.scheduler.shared,
    ));
    m.writeString('chapter', 200);
    m.writeString(name, address);
    const memory = m.bytes(0, 4096).slice(),
      shared = m.shared.slice(),
      floor = m.sp;
    assert.equal((await runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(m.sp, floor + 8);
    assert.equal(m.pop(), result);
    assert.equal(m.pop(), canary);
    assert.deepEqual(m.bytes(0, 4096), memory);
    assert.deepEqual(m.shared, shared);
    assert.equal(runtime.sceneData(task), null);
  }
  assert.deepEqual(
    reads.map(([, category]) => category),
    Array(6).fill('scene'),
  );
  const before = reads.length;
  await assert.rejects(
    async () => runtime.native('main', 322, [0x7fffffff], task.machine, task),
    /memory|unmapped/iu,
  );
  assert.equal(reads.length, before);
});

test('2.6.1.23 task Scene GCALLs preserve raw names, markers and captured strings across cold restore', async (t) => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    ptr = (address) => [0x23, address],
    steps = [
      [220, [0x7fffffff], 0],
      [219, []],
      [221, [0, 0], -1],
      [220, [ptr(256)], 1],
      [221, [-1, 0], 1],
      [221, [0, -1], 3],
      [221, [0, 0], 0xf0],
      [221, [0, 1], 0xf1],
      [222, [ptr(1024), 0, 2], encodeCP932('本文の表示').length],
      [235, [ptr(1088)], 33],
      [223, [ptr(320), 0x80000002], 1],
      [223, [ptr(384), 7], 1],
      [227, [ptr(384)], 0x80000002],
      [227, [ptr(448)], 0],
      [224, [ptr(320), 2], 1],
      [224, [ptr(384), 0x80000002], 1],
      [228, [0xffffffff, ptr(1152), ptr(1216)], 0],
      [231, [0, 53, ptr(512)]],
      [276, [47, ptr(576)]],
      [231, [0, 53, ptr(640)]],
      [276, [47, ptr(704)]],
      [230, [0, 53, 47, ptr(1280)], 1],
      [232, [0, 53, ptr(768)]],
    ],
    files = {
      'task-scene.kcs': kcsProgram(
        [
          ...steps.flatMap(([id, args, expected], index) => [
            ...args.map((arg) => [37, arg]),
            [43, id, 4 * args.length],
            ...(expected === undefined ? [] : [[38, 1536 + index * 4]]),
          ]),
          [59],
        ],
        [
          [200, 'owned'],
          [256, '%s[G200].cst'],
          [320, 'MiXeD.CsT'],
          [384, 'mixed.cst'],
          [448, 'MIXED'],
          [512, 'no reference'],
          [576, '保存の文字'],
          [640, '$str47 $str999999'],
          [704, '後の文字'],
          [768, '始$str47/末$str5!'],
        ],
      ),
      'owned.cst': cst([
        [
          [0xf0, '章の名前'],
          [0xf1, '0x21'],
          [0x20, '本文の表示'],
        ],
      ]),
    },
    world = await dataWorld(profile, files),
    reads = [],
    read = world.game.read;
  t.after(() => world.close({ flushFiles: false }));
  world.game.read = function (name, ...args) {
    reads.push([name, ...args]);
    return Reflect.apply(read, this, [name, ...args]);
  };
  const task = await world.spawnScript('task-scene.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  m.bytes(1024, 320).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(m.sp, floor);
  steps.forEach(([, , expected], index) => {
    if (expected !== undefined) assert.equal(m.load(1536 + index * 4), expected >>> 0);
  });
  assert.equal(m.string(1024), '本文の表示');
  assert.equal(m.load(1024 + encodeCP932('本文の表示').length + 1, 1), 0xa5);
  assert.equal(m.string(1088), '章の名前');
  assert.equal(m.string(1152), 'MiXeD.CsT');
  assert.equal(m.load(1216), 0x80000002);
  assert.equal(m.string(1280), '保存の文字');
  assert.equal(m.string(768), '始保存の文字/末!');
  assert.deepEqual(
    reads.filter(([name]) => name.endsWith('.cstl')),
    [],
  );
  assert.equal(reads.filter(([name]) => name === 'owned.cst').length, 1);

  const restored = await dataWorld(profile, files, { initialize: false });
  t.after(() => restored.close({ flushFiles: false }));
  await restored.restore(structuredClone(world.snapshot()));
  const owner = restored.runtime.scheduler.tasks.get(task.id),
    data = restored.runtime.sceneData(owner),
    strings = restored.runtime.stringBank(owner, false);
  assert.equal(data.reader.type(0, 2), 0x20);
  assert.deepEqual(data.reader.fileNameBytes, encodeCP932('章の名前'));
  assert.equal(data.reader.fileValue, 33);
  assert.equal(data.history.seenValue('mixed.cst'), 0x80000002);
  assert.equal(data.history.path[0].scene, 'MiXeD.CsT');
  assert.deepEqual(data.history.getString(0, 53, 47).bytes, encodeCP932('保存の文字'));
  assert.equal(strings.get(47), '後の文字');
  strings.set(47, '復元後');
  assert.equal(world.runtime.stringBank(task, false).get(47), '後の文字');
});

test('2.6.1.23 task Scene only dereferences an active reader and parsed string references', async () => {
  const runtime = new NativeRuntime({
      profile: 'grisaia-jp-engine-2.6.1.23',
      read: async () => kcsProgram([[59]]),
    }),
    task = await runtime.spawn('case.kcs'),
    m = task.machine,
    call = (id, args) => runtime.native('main', id, args, m, task, runtime.scheduler);
  assert.deepEqual(await call(222, [0x7fffffff, 0, 0]), { control: 1, value: 0 });
  assert.deepEqual(await call(231, [0, 0, 0x7fffffff]), { control: 2 });
  await call(219, []);
  await assert.rejects(async () => call(222, [0x7fffffff, 0, 0]), /unmapped destination/);
  m.bytes(512, 32).fill(0xa5);
  await assert.rejects(async () => call(222, [512, 0, 0]), /no readable record/);
  assert.deepEqual(m.bytes(512, 32), new Uint8Array(32).fill(0xa5));
  m.writeString('no $strx lookup', 128);
  assert.deepEqual(await call(231, [0, 53, 128]), { control: 2 });
  assert.equal(runtime.stringBank(task, false), null);
  m.writeString('L$str47R', 128);
  await assert.rejects(async () => call(231, [0, 53, 128]), /null caller string bank/);
  assert.equal(runtime.stringBank(task, false), null);
  m.writeString('other.cst', 128);
  await call(224, [128, 2]);
  const old = runtime.sceneData(task);
  await call(219, []);
  assert.notEqual(runtime.sceneData(task), old);
  assert.deepEqual(runtime.sceneData(task).history.path, []);
});

test('restored scene hints prepare one explicit M2 resource from the same mounted scene', async (t) => {
  const workerBefore = globalThis.Worker;
  let pending = Promise.withResolvers();
  let terminated = 0;
  globalThis.Worker = class {
    postMessage({ bytes, length }) {
      assert.equal(bytes.length, 65536);
      pending.resolve(() => this.onmessage?.({ data: { expanded: new Uint8Array(length) } }));
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
  owner.world.prepareSceneWorkers = false;
  preparation.resume();
  preparation.hint(scene, 'active', 0);
  assert.deepEqual(reads, []);
  assert.equal(preparation.take('model'), null);
  owner.world.prepareSceneWorkers = true;
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

test('63 Main336 captures the referenced bytes from an existing caller string bank', async () => {
  const runtime = new NativeRuntime({
      profile: 'rebellions-jp-engine-2.6.1.63',
      read: async () => kcsProgram([[59]]),
    }),
    task = await runtime.spawn('case.kcs'),
    m = task.machine,
    call = (id, args) => runtime.native('main', id, args, m, task, runtime.scheduler),
    { value: handle } = await call(323, []),
    data = runtime.handles.get(handle, 'scene-data');
  data.history.appendPath('scene', 1);
  m.writeString('A$str3 B$str9', 128);
  assert.deepEqual(await call(336, [handle, 0, 11, 128]), { control: 2 });
  assert.equal(runtime.stringBank(task, false), null);
  assert.equal(data.history.path[0].strings, null);
  const bank = runtime.stringBank(task);
  bank.setBytes(3, Uint8Array.of(0x87, 0x90));
  bank.set(5, 'unreferenced');
  assert.deepEqual(await call(336, [handle, 0, 11, 128]), { control: 2 });
  bank.set(3, 'later');
  assert.deepEqual(data.history.getString(0, 11, 3), {
    found: true,
    bytes: Uint8Array.of(0x87, 0x90),
  });
  assert.equal(data.history.getString(0, 11, 9).found, false);
  assert.equal(data.history.getString(0, 11, 5).found, false);
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
