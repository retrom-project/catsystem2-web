// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSceneData, NativeSceneHistory, nativeSceneData } from '../src/native/scene-data.mjs';
import {
  encodeNativeSceneHistory,
  decodeNativeSceneHistory,
} from '../src/native/scene-history.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeGlobalFile, createGlobalEntries } from '../src/native/persistence.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';

test('history encoding preserves current record fields, duplicate string keys and unused tails', () => {
  const h = new NativeSceneHistory();
  h.appendPath('main', 7);
  h.setString(0, 3, 4, Uint8Array.of(65, 66));
  const entry = h.path[0];
  entry.strings[0][1].fill(0xab, 10);
  entry.strings.push(['3:4', Uint8Array.from({ length: 64 }, (_, i) => (i ? 0 : 67))]);
  entry.extra = Uint8Array.of(9, 8, 7, 6);
  const bytes = h.encode('path', true),
    view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 4 + 48 + 2 * 72 + 4);
  assert.equal(view.getUint32(0, true), 0);
  assert.equal(view.getUint32(36, true), 7);
  assert.equal(view.getUint32(40, true), 2);
  assert.equal(view.getUint32(44, true), 4);
  assert.equal(view.getUint32(48, true), 192);
  const decoded = decodeNativeSceneHistory(bytes);
  assert.equal(decoded[0].strings.length, 2);
  assert.deepEqual(encodeNativeSceneHistory(decoded, true), bytes);
  h.decode('path', bytes);
  assert.deepEqual(h.getString(0, 3, 4).bytes, Uint8Array.of(65, 66));
});

test('native history importer accepts 40-byte records and preserves the seen extra-data source', () => {
  const old = new Uint8Array(40 + 72),
    view = new DataView(old.buffer);
  old.set(new TextEncoder().encode('old-scene'));
  view.setUint32(32, 9, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, 2, true);
  view.setUint32(44, 5, true);
  old[48] = 65;
  const list = decodeNativeSceneHistory(old);
  assert.equal(list[0].scene, 'old-scene');
  assert.equal(list[0].value, 9);
  assert.equal(list[0].strings[0][0], '2:5');
  const h = new NativeSceneHistory();
  h.markSeen('main', 1);
  h.seen[0].extra = Uint8Array.of(1, 2, 3);
  const bytes = h.encode('seen', true);
  assert.throws(() => decodeNativeSceneHistory(bytes, { side: 'seen' }), /null companion/);
  const companion = Uint8Array.from({ length: 100 }, (_, i) => i);
  assert.deepEqual(
    decodeNativeSceneHistory(bytes, { side: 'seen', companionPath: companion })[0].extra,
    Uint8Array.of(48, 49, 50),
  );
});

test('scene persistence natives write original history bytes through the shared CTS entry service', () => {
  const handles = new NativeHandles(),
    source = new NativeSceneData(),
    destination = new NativeSceneData();
  source.history.markSeen('main', 12);
  source.history.appendPath('main', 10);
  const sourceHandle = handles.add('scene-data', source),
    destinationHandle = handles.add('scene-data', destination),
    file = handles.add('global-file', new NativeGlobalFile(33));
  const services = {
    handles,
    globalEntries: createGlobalEntries(handles),
    sceneDataForTask: (id) => (id === 42 ? source : null),
  };
  assert.equal(nativeSceneData(0xef, [file, 1, 42, 0, 0], null, services).value, 1);
  assert.deepEqual(services.globalEntries.read(file, 1), source.history.encode('seen'));
  assert.equal(nativeSceneData(0x182, [file, 1, destinationHandle, 0], null, services).value, 1);
  assert.equal(destination.history.seenValue('MAIN'), 12);
  assert.equal(nativeSceneData(0x181, [file, 2, sourceHandle, 1, 0], null, services).value, 1);
  services.sceneDataForTask = () => destination;
  assert.equal(nativeSceneData(0xf9, [file, 2, 42, 1], null, services).value, 1);
  assert.equal(destination.history.path[0].value, 10);
  assert.equal(nativeSceneData(0xf9, [file, 3, 42, 1], null, services).value, 0);
});

test('2.6.1.23 cross-task Scene follows Script owners and copies compact histories after interpreter removal', async (t) => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    files = { 'idle.kcs': kcsProgram([[59]]) },
    world = await dataWorld(profile, files),
    make = async (nativeID, kind = 12) => {
      const id = await world.objects.create({ kind, nativeID, parent: world.root });
      const record = world.objects.objects.get(id);
      if (kind !== 12) return record;
      await record.implementation.loadScript('idle.kcs');
      return world.runtime.scheduler.tasks.get(id);
    },
    source = await make(73),
    caller = await make(57),
    empty = await make(75),
    base = await make(81, 17),
    call = (task, id, args) => world.runtime.native('main', id, args, task.machine, task),
    sourceData = () => world.runtime.sceneData(source),
    destination = () => world.runtime.sceneData(caller);
  t.after(() => world.close({ flushFiles: false }));
  assert.deepEqual(await call(caller, 233, [73, 0, 53, 0x7fffffff]), { control: 2 });
  await call(source, 219, []);
  source.machine.writeString('Scene01.cst', 256);
  await call(source, 223, [256, 0x80000002]);
  await call(source, 224, [256, 4]);
  source.machine.writeString('保存の文', 256);
  await call(source, 229, [0, 53, 47, 256]);
  assert.deepEqual(await call(caller, 234, [73]), { control: 1, value: 0 });
  await call(caller, 219, []);
  for (const target of [75, 81, 999999, 0, 0xffffffff]) {
    assert.deepEqual(await call(caller, 234, [target]), { control: 1, value: 0 });
    caller.machine.writeString('plain $strx', 256);
    caller.machine.bytes(256 + 13, 8).fill(0xa5);
    assert.deepEqual(await call(caller, 233, [target, 0, 53, 256]), { control: 2 });
    assert.equal(caller.machine.string(256), 'plain $strx');
    assert.equal(caller.machine.load(256 + 11, 1), 0);
    assert.equal(caller.machine.load(256 + 12, 1), 0);
    assert.equal(caller.machine.load(256 + 13, 1), 0xa5);
  }
  caller.machine.writeString('A$str47 B$str5 C$strx', 256);
  await call(caller, 233, [73, 0, 53, 256]);
  assert.equal(caller.machine.string(256), 'A保存の文 B$str5 C$strx');
  caller.machine.writeString('A$str47', 256);
  await assert.rejects(async () => call(caller, 233, [75, 0, 53, 256]), /null scene context/);

  await world.runtime.scheduler.execute(source);
  assert.equal(source.status, 'finished');
  const sourceRecord = world.objects.objects.get(source.id);
  await sourceRecord.implementation.loadScript('missing.kcs', { nativeLoad: true });
  assert.equal(world.runtime.scheduler.tasks.has(source.id), false);
  assert.equal(sourceRecord.context.sceneData, source.context.sceneData);
  assert.deepEqual(await call(caller, 234, [73]), { control: 1, value: 1 });
  assert.deepEqual(destination().history.snapshot(), sourceData().history.snapshot());
  const before = destination().history.snapshot();
  assert.deepEqual(await call(caller, 234, [57]), { control: 1, value: 1 });
  assert.deepEqual(destination().history.snapshot(), before);
  sourceData().history.setString(0, 53, 47, new TextEncoder().encode('changed'));
  assert.deepEqual(destination().history.getString(0, 53, 47).bytes, encodeCP932('保存の文'));
  base.context = { sceneData: sourceRecord.context.sceneData };
  assert.deepEqual(await call(caller, 234, [81]), { control: 1, value: 0 });
  assert.deepEqual(destination().history.snapshot(), before);
  delete base.context;

  const restored = await dataWorld(profile, files, { initialize: false });
  t.after(() => restored.close({ flushFiles: false }));
  await restored.restore(structuredClone(world.snapshot()));
  const restoredCaller = restored.runtime.scheduler.tasks.get(caller.id),
    restoredSource = restored.objects.objects.get(source.id);
  assert.equal(restored.runtime.scheduler.tasks.has(source.id), false);
  assert.equal(restoredSource.context.sceneData, sourceRecord.context.sceneData);
  assert.deepEqual(
    await restored.runtime.native('main', 234, [73], restoredCaller.machine, restoredCaller),
    { control: 1, value: 1 },
  );
  const history = restored.runtime.sceneData(restoredCaller).history;
  assert.equal(history.seenValue('scene01.cst'), 0x80000002);
  assert.deepEqual(history.getString(0, 53, 47).bytes, new TextEncoder().encode('changed'));
  assert.equal(world.runtime.sceneData(empty), null);
});

test('2.6.1.23 raw Scene pointer query maps the actual Script kind without stopping its interpreter', async (t) => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    world = await dataWorld(profile, { 'idle.kcs': kcsProgram([[59]]) }),
    caller = world.main,
    target = await world.spawnScript('idle.kcs'),
    targetID = world.nativeTaskID(target.id),
    record = world.objects.objects.get(target.id),
    m = caller.machine;
  t.after(() => world.close({ flushFiles: false }));
  assert.equal(mapABIMessage(profile, 'taskQueries', 'raw', 162, 12), 175);
  assert.equal(mapABIMessage(profile, 'taskQueries', 'canonical', 175, 12), 162);
  target.machine.setExecutionMode(1);
  record.scriptEnabled = 1;
  m.bytes(256, 12).fill(0xa5);
  assert.equal(
    await world.sendNativeEngine(targetID, caller.id, 162, 256, 260),
    NATIVE_UNWRITTEN_WORD,
  );
  assert.deepEqual(m.bytes(256, 12), Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0xa5, 0xa5, 0xa5, 0xa5));
  assert.equal(target.machine.executionMode, 1);
  assert.equal(record.scriptEnabled, 1);
  await world.runtime.native('main', 219, [], target.machine, target);
  m.bytes(256, 12).fill(0xa5);
  await assert.rejects(
    world.sendNativeEngine(targetID, caller.id, 162, 256, 260),
    /Physical CST reader\/history pointers require explicit original-engine ownership/,
  );
  assert.deepEqual(m.bytes(256, 12), new Uint8Array(12).fill(0xa5));
  assert.equal(target.machine.executionMode, 1);
  assert.equal(record.scriptEnabled, 1);
  const fes = await world.objects.create({ kind: 34, parent: world.root }),
    base = await world.objects.create({ kind: 17, parent: world.root });
  for (const id of [fes, base])
    await assert.rejects(
      world.sendNativeEngine(world.nativeTaskID(id), caller.id, 162, 256, 260),
      /Unreviewed ABI message/,
    );
  assert.equal(
    await world.sendNativeEngine(999999, caller.id, 162, 256, 260),
    NATIVE_UNWRITTEN_WORD,
  );
});

test('2.6.1.23 explicit history string GCALLs retain owner isolation and saved CP932 bytes after cold restore', async (t) => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    scene = [0x13, 64],
    other = [0x13, 68],
    ptr = (address) => [0x23, address],
    steps = [
      [334, [0, 0, 53, 47, 0x7fffffff], 0],
      [335, [0, 0, 53, 47, 0x7fffffff], 0],
      [337, [0, 0, 53, 0x7fffffff]],
      [329, [scene, ptr(256), 4], 1],
      [334, [scene, 0, 53, 47, ptr(320)], 1],
      [335, [scene, 0xffffffff, 53, 47, ptr(1024)], 1],
      [335, [scene, 0, 53, 5, ptr(1088)], 0],
      [335, [other, 0, 53, 47, ptr(1152)], 0],
      [337, [scene, 0, 53, ptr(384)]],
      [336, [scene, 0, 53, ptr(512)]],
      [276, [47, ptr(448)]],
      [336, [scene, 0, 53, ptr(512)]],
      [276, [47, ptr(576)]],
      [335, [scene, 0, 53, 47, ptr(1216)], 1],
    ],
    files = {
      'explicit-history.kcs': kcsProgram(
        [
          [43, 323, 0],
          [38, 64],
          [43, 323, 0],
          [38, 68],
          ...steps.flatMap(([id, args, expected], index) => [
            ...args.map((arg) => [37, arg]),
            [43, id, args.length * 4],
            ...(expected === undefined ? [] : [[38, 1536 + index * 4]]),
          ]),
          [59],
        ],
        [
          [256, 'Scene.cst'],
          [320, '昔の文字'],
          [384, 'A$str47 B$str5 C$strx'],
          [448, '保存の文字'],
          [512, '$str47 $str999999'],
          [576, '後の変更'],
        ],
      ),
    },
    world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('explicit-history.kcs', { initialExecute: false }),
    m = task.machine,
    floor = m.sp;
  m.bytes(1024, 256).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(m.sp, floor);
  steps.forEach(([, , expected], index) => {
    if (expected !== undefined) assert.equal(m.load(1536 + index * 4), expected >>> 0);
  });
  assert.equal(m.string(1024), '昔の文字');
  assert.deepEqual(m.bytes(1088, 2), Uint8Array.of(0, 0xa5));
  assert.deepEqual(m.bytes(1152, 32), new Uint8Array(32).fill(0xa5));
  assert.equal(m.string(384), 'A昔の文字 B C$strx');
  assert.equal(m.string(1216), '保存の文字');
  const restored = await dataWorld(profile, files, { initialize: false });
  t.after(() => restored.close({ flushFiles: false }));
  await restored.restore(structuredClone(world.snapshot()));
  const first = restored.runtime.handles.get(m.load(64), 'scene-data'),
    second = restored.runtime.handles.get(m.load(68), 'scene-data');
  assert.deepEqual(first.history.getString(0, 53, 47).bytes, encodeCP932('保存の文字'));
  assert.deepEqual(second.history.path, []);
  assert.notEqual(first, world.runtime.handles.get(m.load(64), 'scene-data'));
  const owner = restored.runtime.scheduler.tasks.get(task.id);
  assert.equal(restored.runtime.stringBank(owner, false).get(47), '後の変更');
});

test('2.6.1.67 Scene history GCALLs keep CP932 aliases and import compact save records', async (t) => {
  const scene = [0x13, 64],
    restored = [0x13, 68],
    save = [0x13, 72],
    ptr = (address) => [0x23, address],
    call = (id, args) => [...args.map((word) => [37, word]), [43, id, args.length * 4]],
    steps = [
      [328, [scene, ptr(256), 0x80000003], 1],
      [328, [scene, ptr(256), 6], 1],
      [934, [scene, ptr(320), ptr(384)]],
      [332, [scene, ptr(384)], 0x80000003],
      [329, [scene, ptr(256), 4], 1],
      [329, [scene, ptr(320), 3], 1],
      [329, [scene, ptr(448), 7], 1],
      [329, [scene, ptr(416), 99], 1],
      [333, [scene, 99, ptr(1600), ptr(1632)], 1],
      [336, [scene, 1, 9, ptr(640)]],
      [276, [7, ptr(576)]],
      [336, [scene, 1, 9, ptr(640)]],
      [334, [scene, 1, 9, 13, ptr(704)], 1],
      [335, [scene, 1, 9, 7, ptr(1664)], 1],
      [335, [scene, 1, 9, 18, ptr(1728)], 0],
      [337, [scene, 1, 9, ptr(768)]],
      [385, [save, 89, scene, 1], 1],
      [385, [save, 90, scene, 0], 1],
      [331, [scene]],
      [330, [scene]],
      [332, [scene, ptr(384)], 0],
      [333, [scene, 0, ptr(1760), ptr(1792)], 0xffffffff],
      [386, [save, 90, restored, 0], 1],
      [386, [save, 89, restored, 1], 1],
      [386, [save, 99, restored, 1], 0],
      [332, [restored, ptr(384)], 0x80000003],
      [335, [restored, 1, 9, 13, ptr(1824)], 1],
    ],
    world = await dataWorld('bokutomo-engine-2.6.1.67', {
      'history.kcs': kcsProgram(
        [
          ...call(323, []),
          [38, 64],
          ...call(323, []),
          [38, 68],
          ...call(238, [0x12345678]),
          [38, 72],
          ...steps.flatMap(([id, args, expected], index) => [
            ...call(id, args),
            ...(expected === undefined ? [] : [[38, 1024 + index * 4]]),
          ]),
          [59],
        ],
        [
          [256, 'Scene01.cst'],
          [320, 'SCENE01'],
          [384, '別名'],
          [416, ''],
          [448, 'Scene02.cst'],
          [576, '文章'],
          [640, 'A$str7'],
          [704, '表示'],
          [768, 'A$str7-$str13/$str18Z'],
        ],
      ),
    });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('history.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    { machine } = task,
    floor = machine.sp;
  machine.bytes(1600, 256).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor);
  steps.forEach(([, , expected], index) => {
    if (expected !== undefined) assert.equal(machine.load(1024 + index * 4), expected);
  });
  assert.equal(machine.string(1600), 'Scene02');
  assert.equal(machine.load(1632), 7);
  assert.equal(machine.string(1664), '文章');
  assert.equal(machine.load(1728, 1), 0);
  assert.equal(machine.load(1729, 1), 0xa5);
  assert.equal(machine.string(768), 'A文章-表示/Z');
  assert.equal(machine.string(1760), '');
  assert.equal(machine.load(1792), 0xffffffff);
  assert.equal(machine.string(1824), '表示');
  const packed = world.runtime.handles.get(machine.load(72), 'global-file').read(89),
    history = decodeNativeSceneHistory(packed, { legacy: true });
  assert.equal(packed.length, 2 * 40 + 2 * 72);
  assert.deepEqual(
    history.map(({ scene, value }) => [scene, value]),
    [
      ['Scene01', 4],
      ['Scene02', 7],
    ],
  );
  assert.deepEqual(
    history[1].strings.map(([key]) => key),
    ['9:7', '9:13'],
  );
});

for (const profile of ['grisaia-jp-engine-2.6.1.23', 'bokutomo-engine-2.6.1.67'])
  test(`${profile} KCS CSS history uses the designated Script owner and restores both compact sides`, (t) =>
    verifyTaskHistoryCSS(profile, t));

async function verifyTaskHistoryCSS(profile, t) {
  const file = [0x13, 80],
    source = [0x13, 84],
    destination = [0x13, 88],
    calls = [
      [238, [0x80000001], 80],
      [239, [file, 10, 0, 0, 0], 92],
      [239, [file, 10, source, 0, 0], 96],
      [239, [file, 11, source, 1, 1], 100],
      [249, [file, 10, destination, 0], 104],
      [249, [file, 11, destination, 1], 108],
      [249, [file, 12, destination, 1], 112],
      [249, [0, 10, destination, 0], 116],
    ].map(([id, words, at]) => [
      id,
      id === 239 && profile === 'grisaia-jp-engine-2.6.1.23' ? words.slice(0, 4) : words,
      at,
    ]),
    files = {
      'scene-owner.kcs': kcsProgram([[59]]),
      'history-file.kcs': kcsProgram([
        ...calls.flatMap(([id, words, at]) => [
          ...words.map((word) => [37, word]),
          [43, id, words.length * 4],
          [38, at],
        ]),
        [59],
      ]),
    },
    world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  const spawn = (script) =>
    world.spawnScript(script, { parent: world.main.id, initialExecute: false });
  const writer = await spawn('scene-owner.kcs'),
    reader = await spawn('scene-owner.kcs'),
    io = await spawn('history-file.kcs'),
    sourceHistory = world.runtime.sceneData(writer, true).history,
    destinationHistory = world.runtime.sceneData(reader, true).history;
  sourceHistory.markSeen('回想', 42);
  sourceHistory.appendPath('回想', 19);
  sourceHistory.setString(0, 2, 3, Uint8Array.of(0x94, 0x4c));
  destinationHistory.appendPath('other', 7);
  const m = io.machine,
    stack = m.sp;
  m.store(84, world.nativeTaskID(writer.id));
  m.store(88, world.nativeTaskID(reader.id));
  await world.runtime.scheduler.execute(io);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    [92, 96, 100, 104, 108, 112, 116].map((address) => m.load(address)),
    [0, 1, 1, 1, 1, 0, 0],
  );
  const css = world.runtime.handles.get(m.load(80), 'global-file');
  assert.equal(css.read(10).length, 40);
  assert.equal(css.read(11).length, 40 + 72);
  assert.equal(destinationHistory.seenValue('回想'), 42);
  assert.deepEqual(
    destinationHistory.path.map(({ scene, value }) => [scene, value]),
    [['回想', 19]],
  );
  assert.deepEqual(destinationHistory.getString(0, 2, 3).bytes, Uint8Array.of(0x94, 0x4c));
  if (profile === 'grisaia-jp-engine-2.6.1.23') {
    await world.objects.objects
      .get(writer.id)
      .implementation.loadScript('missing.kcs', { nativeLoad: true });
    assert.equal(world.runtime.scheduler.tasks.has(writer.id), false);
    assert.deepEqual(
      await world.runtime.native(
        'main',
        239,
        [m.load(80), 13, world.nativeTaskID(writer.id), 1],
        m,
        io,
      ),
      { control: 1, value: 1 },
    );
    assert.deepEqual(css.read(13), css.read(11));
    const restored = await dataWorld(profile, files, { initialize: false });
    t.after(() => restored.close({ flushFiles: false }));
    await restored.restore(structuredClone(world.snapshot()));
    assert.deepEqual(
      restored.runtime.handles.get(m.load(80), 'global-file').read(13),
      css.read(13),
    );
    assert.equal(restored.runtime.scheduler.tasks.has(writer.id), false);
    const restoredIO = restored.runtime.scheduler.tasks.get(io.id);
    assert.deepEqual(
      await restored.runtime.native(
        'main',
        249,
        [m.load(80), 13, restored.nativeTaskID(reader.id), 1],
        restoredIO.machine,
        restoredIO,
      ),
      { control: 1, value: 1 },
    );
    const restoredReader = restored.runtime.scheduler.tasks.get(reader.id);
    assert.deepEqual(
      restored.runtime.sceneData(restoredReader).history.getString(0, 2, 3).bytes,
      Uint8Array.of(0x94, 0x4c),
    );
  }
}

for (const profile of ['rebellions-jp-engine-2.6.1.63', 'grisaia-jp-engine-2.6.1.23'])
  test(`${profile} direct history saves read and write original compact records`, () =>
    verifyCompactHistory(profile));

async function verifyCompactHistory(profile) {
  const world = await dataWorld(profile);
  try {
    const { main } = world,
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main),
      source = (await call(323, [])).value,
      target = (await call(323, [])).value,
      save = (await call(238, [0x89234567])).value,
      data = world.runtime.handles.get(source, 'scene-data'),
      file = world.runtime.handles.get(save, 'global-file');
    assert.deepEqual(await call(248, [save]), { control: 1, value: 0x89234567 });
    assert.deepEqual(await call(248, [0]), { control: 1, value: 0 });
    m.writeString('start.cst', 256);
    await call(329, [source, 256, 3]);
    data.history.setString(0, 1, 2, Uint8Array.of(65));
    data.history.path[0].extra = Uint8Array.of(7, 8);
    assert.deepEqual(await call(385, [save, 89, source, 1]), { control: 1, value: 1 });
    const packed = file.read(89),
      view = new DataView(packed.buffer, packed.byteOffset, packed.length);
    assert.equal(packed.length, 112);
    assert.deepEqual([...packed.subarray(0, 6)], [115, 116, 97, 114, 116, 0]);
    assert.deepEqual(
      [32, 36, 40, 44, 48].map((offset) => view.getUint32(offset, true)),
      [3, 1, 1, 2, 65],
    );
    assert.deepEqual(await call(386, [save, 89, target, 1]), { control: 1, value: 1 });
    const restored = world.runtime.handles.get(target, 'scene-data').history;
    assert.deepEqual(
      restored.path.map(({ scene, value, extra }) => [scene, value, extra]),
      [['start', 3, null]],
    );
    assert.deepEqual(restored.getString(0, 1, 2).bytes, Uint8Array.of(65));
    assert.deepEqual(await call(386, [save, 90, target, 1]), { control: 1, value: 0 });
    assert.equal(restored.path.length, 1);
    assert.deepEqual(await call(331, [source]), { control: 2 });
    assert.deepEqual(await call(385, [save, 90, source, 1]), { control: 1, value: 1 });
    assert.deepEqual(file.read(90), new Uint8Array());
    assert.deepEqual(await call(386, [save, 90, target, 1]), { control: 1, value: 1 });
    assert.equal(restored.path.length, 0);
    assert.deepEqual(await call(389, [0]), { control: 1, value: 0 });
    assert.deepEqual(await call(389, [save]), { control: 1, value: 1 });
    assert.equal(file.capacity, 0x80000);
    assert.equal(file.used, 0);
    assert.equal(file.tag, 0x89234567);
    assert.equal(file.read(89), null);
  } finally {
    await world.close({ flushFiles: false });
  }
}

test('path extra data uses the native CTS memory record and separate copy operations', () => {
  const handles = new NativeHandles(),
    first = new NativeSceneData(),
    second = new NativeSceneData(),
    a = handles.add('scene-data', first),
    b = handles.add('scene-data', second),
    file = new NativeGlobalFile(77);
  file.write(9, Uint8Array.of(1, 2, 3));
  const save = handles.add('global-file', file),
    services = { handles };
  first.history.appendPath('first', 1);
  second.history.appendPath('second', 2);
  nativeSceneData(0x3d2, [a, save], null, services);
  const extracted = nativeSceneData(0x3d3, [a, 0], null, services).value;
  assert.equal(handles.get(extracted, 'global-file').tag, 77);
  assert.deepEqual(handles.get(extracted, 'global-file').read(9), Uint8Array.of(1, 2, 3));
  nativeSceneData(0x3d5, [b, a], null, services);
  assert.deepEqual(second.history.path[0].extra, first.history.path[0].extra);
  nativeSceneData(0x3e1, [b, a], null, services);
  assert.equal(second.history.path[0].scene, 'first');
  assert.equal(second.history.path[0].extra, null);
  let initialized = 0;
  assert.deepEqual(nativeSceneData(0xdb, [], null, { initializeSceneData: () => initialized++ }), {
    control: 2,
  });
  assert.equal(initialized, 1);
});
