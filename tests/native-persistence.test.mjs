// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply, NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import {
  NativeGlobalFile,
  createGlobalEntries,
  nativePersistence,
  serializeStringBank,
  importStringBank,
} from '../src/native/persistence.mjs';
import { kcsProgram } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const machine = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(2048),
    stackSize: 1024,
  });
test('global-file records append duplicate IDs and read the first match through nested snapshots', async () => {
  const file = new NativeGlobalFile(3500);
  file.write(7, Uint8Array.of(1, 2, 3));
  file.write(7, Uint8Array.of(4));
  file.write(8, new Uint8Array());
  assert.deepEqual(file.read(7), Uint8Array.of(1, 2, 3));
  assert.equal(file.read(9), null);
  assert.equal(file.tag, 3500);
  const raw = NativeGlobalFile.fromRaw(file.raw());
  assert.deepEqual(raw.snapshot(), file.snapshot());
  const saved = await file.file(),
    loaded = await NativeGlobalFile.fromFile(saved);
  assert.equal(new Binary(saved).str(0, 4, 'utf-8'), 'CSS');
  assert.deepEqual(loaded.records, file.records);
  file.remove(7);
  assert.deepEqual(file.read(7), Uint8Array.of(4));
  assert.equal(file.capacity, 0x80000 - 11);
  raw.capacity = raw.used;
  raw.remove(8);
  assert.equal(raw.records.length, 3);
});

test('string variable persistence sorts unsigned indices, replaces the bank, and ignores reported padding', () => {
  const bank = new NativeStringBank();
  bank.set(8, '猫');
  bank.set(2, '');
  bank.set(0xffffffff, 'end');
  const bytes = serializeStringBank(bank),
    b = new Binary(bytes);
  assert.equal(b.u32(0), 3);
  assert.equal(b.u32(4), 2);
  assert.equal(b.u32(9), 8);
  const restored = new NativeStringBank();
  restored.set(9, 'old');
  importStringBank(restored, bytes);
  assert.equal(restored.get(9), undefined);
  assert.equal(restored.get(8), '猫');
  assert.equal(restored.get(-1), 'end');
  assert.equal(restored.dirty, true);
});

test('2.6.1.23 CSS stores the existing caller string bank and creates one only for a present entry', async () => {
  const runtime = new NativeRuntime({
      profile: 'grisaia-jp-engine-2.6.1.23',
      read: async () => kcsProgram([[59]]),
    }),
    source = await runtime.spawn('source.kcs'),
    target = await runtime.spawn('target.kcs'),
    call = (task, id, args) => runtime.native('main', id, args, task.machine, task),
    { value: file } = await call(source, 238, [0x81234567]);
  for (const [id, args] of [
    [243, [0, 7]],
    [243, [file, 7]],
    [253, [0, 7]],
    [253, [file, 7]],
  ])
    assert.deepEqual(await call(target, id, args), { control: 1, value: 0 });
  assert.equal(runtime.stringBank(target, false), null);
  const bank = runtime.stringBank(source);
  bank.set(0x82123456, '猫');
  assert.deepEqual(await call(source, 243, [file, 7]), { control: 1, value: 1 });
  assert.deepEqual(runtime.handles.get(file, 'global-file').read(7), serializeStringBank(bank));
  assert.deepEqual(await call(target, 253, [file, 7]), { control: 1, value: 1 });
  const restored = runtime.stringBank(target, false);
  assert.notEqual(restored, bank);
  assert.equal(restored.get(0x82123456), '猫');
  assert.equal(restored.dirty, true);
  restored.set(0x82123456, '犬');
  assert.equal(bank.get(0x82123456), '猫');
});

for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(`${profile} reads optional CSS task records through reviewed owners`, (t) =>
    verifyOptionalTaskRecords(t, profile));

async function verifyOptionalTaskRecords(t, profile) {
  const guest = kcsProgram([
      [37, 0x685d2e9a],
      [37, [0x13, 104]],
      [37, [0x13, 108]],
      [37, [0x13, 112]],
      [43, 576, 12],
      [37, [0x13, 104]],
      [37, [0x13, 108]],
      [37, [0x13, 112]],
      [43, 689, 12],
      [59],
    ]),
    world = await dataWorld(profile, { 'record.kcs': guest });
  t.after(() => world.close({ flushFiles: false }));
  const file = new NativeGlobalFile(),
    handle = world.runtime.handles.add('global-file', file),
    plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: 77 }),
    word = (value) => ({ control: 1, value }),
    run = async (css, record, owner) => {
      const task = await world.spawnScript('record.kcs', { initialExecute: false }),
        machine = task.machine,
        floor = machine.sp;
      [css, record, owner].forEach((value, i) => machine.store(104 + i * 4, value));
      await world.runtime.scheduler.execute(task);
      assert.equal(machine.sp, floor + 12);
      assert.equal(machine.load(floor), 0x685d2e9a);
      assert.deepEqual(
        [104, 108, 112].map((at) => machine.load(at)),
        [css, record, owner],
      );
      return [machine.load(floor + 4), machine.load(floor + 8)];
    },
    call = (id, args) => world.runtime.native('main', id, args, world.main.machine, world.main),
    validTree = new Uint8Array(28);
  new DataView(validTree.buffer).setUint32(4, 12, true);
  new DataView(validTree.buffer).setUint32(20, 4, true);
  validTree.set([23, 60, 76, 214], 24);
  assert.deepEqual(await run(0, 13, 77), [0, 0]);
  assert.deepEqual(await run(handle, 13, 77), [0, 0]);
  file.write(13, validTree);
  file.write(13, Uint8Array.of(37));
  file.write(11, Uint8Array.of(73));
  const before = file.snapshot();
  for (const owner of [0, world.nativeTaskID(world.main.id), NATIVE_RESULT_SENTINEL])
    assert.deepEqual(await run(handle, 13, owner), [1, 1]);
  await assert.rejects(run(handle, 13, world.nativeTaskID(plane)), /unreviewed CSS task recipient/);
  assert.deepEqual(await call(576, [handle, 11, 0]), word(1));
  assert.throws(() => call(689, [handle, 11, 0]), /Malformed CSS task tree/);
  assert.throws(() => call(576, [handle, 0, 0]), /unwritten CSS record zero/);
  assert.throws(() => call(689, [handle, 0, 0]), /unwritten CSS record zero/);
  assert.throws(() => call(688, [handle, 13, 0]), UnsupportedKCSNative);
  assert.deepEqual(file.snapshot(), before);
}

test('2.6.1.67 KCS copies a CSS record into owned memory and restores it cold', async () => {
  const param = (i) => [0x13, 0x100 + i * 4],
    files = Object.fromEntries(
      [
        [238, 1],
        [244, 4],
        [834, 1],
        [836, 3],
      ].map(([id, words]) => [
        `${id}.kcs`,
        kcsProgram([
          [37, 0x34fa6712],
          ...Array.from({ length: words }, (_, i) => [37, param(i)]),
          [43, id, words * 4],
          [59],
        ]),
      ]),
    ),
    profile = 'bokutomo-engine-2.6.1.67';
  let world = await dataWorld(profile, files);
  const call = async (id, words, payload = []) => {
    const task = await world.spawnScript(`${id}.kcs`, { initialExecute: false }),
      { machine } = task;
    try {
      words.forEach((value, i) => machine.store(0x100 + i * 4, value));
      machine.bytes(0x200, payload.length).set(payload);
      machine.store(0x300, 0x67126712);
      machine.store(0x304, 0x459c3128);
      await world.runtime.scheduler.execute(task);
      assert.equal(machine.sp, machine.floor + (id === 834 ? 4 : 8));
      assert.equal(machine.load(machine.floor), 0x34fa6712);
      assert.equal(machine.load(0x304), 0x459c3128);
      return [id === 834 ? null : machine.load(machine.floor + 4), machine.load(0x300)];
    } finally {
      await world.objects.release(task.id);
    }
  };
  try {
    const [css] = await call(238, [70]);
    assert.deepEqual(await call(836, [css, 4, 0x300]), [0, 0x67126712]);
    await assert.rejects(call(836, [css, 0, 0x300]), /unwritten CSS record zero/);
    const bytes = [5, 103, 0, 9];
    assert.deepEqual(await call(244, [css, 4, bytes.length, 0x200], bytes), [1, 0x67126712]);
    assert.deepEqual(await call(244, [css, 0, 0, 0x200]), [1, 0x67126712]);
    const [data, size] = await call(836, [css, 4, 0x300]);
    assert.equal(size, bytes.length);
    let heap = world.runtime.imageDataBuffers.process;
    assert.equal(heap.load(data - 4), 1);
    assert.deepEqual([...heap.read(data, size)], bytes);
    const snapshot = structuredClone(world.snapshot());
    await world.close({ flushFiles: false });
    world = await dataWorld(profile, files, { initialize: false });
    await world.restore(snapshot);
    heap = world.runtime.imageDataBuffers.process;
    assert.deepEqual([...heap.read(data, size)], bytes);
    const [empty, emptySize] = await call(836, [css, 0, 0x300]);
    assert.equal(emptySize, 0);
    assert.equal(heap.allocations.get(empty - 4), 4);
    await call(834, [data]);
    await call(834, [empty]);
    assert.equal(heap.allocations.size, 0);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('global-file clear retains its tag and restores initial capacity while clones own independent payloads', () => {
  const m = machine(),
    handles = new NativeHandles(),
    services = { handles },
    call = (id, args) => nativePersistence(id, args, m, services),
    source = call(0xee, [0xcafebabe]).value;
  m.bytes(64, 4).set([1, 2, 3, 4]);
  call(0xf4, [source, 7, 4, 64]);
  const copy = call(0x186, [source]).value;
  assert.notEqual(copy, source);
  handles.get(source, 'global-file').read(7)[0] = 90;
  assert.deepEqual(handles.get(copy, 'global-file').read(7), Uint8Array.of(1, 2, 3, 4));
  assert.deepEqual(call(0x185, [source]), { control: 1, value: 1 });
  assert.equal(call(0xf8, [source]).value, 0xcafebabe);
  assert.equal(handles.get(source, 'global-file').used, 0);
  assert.equal(handles.get(source, 'global-file').capacity, 0x80000);
  assert.equal(handles.get(copy, 'global-file').used, 12);
  assert.deepEqual(call(0x185, [0]), { control: 1, value: 0 });
  assert.deepEqual(call(0x186, [0]), { control: 1, value: 0 });
});

test('native global entries bridge shared resource handles and copy bounded guest ranges', () => {
  const handles = new NativeHandles(),
    m = machine(),
    strings = new NativeStringBank();
  const bank = new NativeVariableBank();
  bank.initialize(5);
  bank.words.set([1, 2, 3, 4, 5]);
  const services = { handles, strings, variableBankForTask: (task) => (task === 42 ? bank : null) };
  const { value: handle } = nativePersistence(0xee, [901], m, services);
  const bridge = createGlobalEntries(handles);
  bridge.write(handle, 1, Uint8Array.of(9, 8, 7));
  assert.deepEqual(bridge.read(handle, 1), Uint8Array.of(9, 8, 7));
  m.bytes(200, 10).fill(0xaa);
  assert.deepEqual(nativePersistence(0xfe, [handle, 1, 200, 2], m, services), nativeReply(1, 2));
  assert.deepEqual([...m.bytes(200, 4)], [9, 8, 0xaa, 0xaa]);
  assert.deepEqual(nativePersistence(0xf0, [handle, 2, 42, 3, 9], m, services), nativeReply(1, 1));
  assert.equal(bridge.read(handle, 2).length, 8);
  bank.words.fill(0);
  nativePersistence(0xfa, [handle, 2, 42, 0], m, services);
  assert.deepEqual([...bank.words], [4, 5, 0, 0, 0]);
  strings.set(1, '猫');
  nativePersistence(0xf3, [handle, 3], m, services);
  strings.set(1, 'changed');
  nativePersistence(0xfd, [handle, 3], m, services);
  assert.equal(strings.get(1), '猫');
  assert.deepEqual(nativePersistence(0xf8, [handle], m, services), nativeReply(1, 901));
  nativePersistence(0xf6, [handle], m, services);
  assert.throws(() => bridge.read(handle, 1), /released/);
});

test('disk save services preserve names and timestamp policy, reopen native CSS data, and expose file time', async () => {
  const handles = new NativeHandles(),
    m = machine(),
    disk = new Map();
  const services = {
    handles,
    contextName: 'saves/profile-one',
    format: (at) => m.string(at),
    persistence: {
      read: async (name) => disk.get(name) ?? null,
      write: async (name, bytes, options) => {
        assert.equal(options.updateModified, false);
        disk.set(name, bytes);
        return true;
      },
      stat: async () => ({ modifiedMs: new Date(2020, 2, 4, 5, 6, 7).getTime() }),
      remove: async (name) => disk.delete(name),
    },
  };
  m.writeString('save01.dat', 0);
  const handle = nativePersistence(0xee, [100], m, services).value;
  createGlobalEntries(handles).write(handle, 10, Uint8Array.of(1, 2, 3));
  assert.deepEqual(await nativePersistence(0x407, [handle, 0], m, services), nativeReply(1, 1));
  assert.ok(disk.has('saves/profile-one/save01.dat'));
  const reopened = await nativePersistence(0xf7, [0], m, services);
  assert.deepEqual(createGlobalEntries(handles).read(reopened.value, 10), Uint8Array.of(1, 2, 3));
  assert.deepEqual(
    await nativePersistence(0xff, [0, 100, 104, 108, 112, 116], m, services),
    nativeReply(1, 1),
  );
  assert.deepEqual(
    [100, 104, 108, 112, 116].map((at) => m.load(at)),
    [2020, 3, 4, 5, 6],
  );
  await nativePersistence(0x3de, [0], m, services);
  assert.deepEqual(await nativePersistence(0xf7, [0], m, services), nativeReply(1, 0));
  assert.equal(nativePersistence(0xf7, [0], m, { handles }), undefined);
});

test('2.6.1.67 KCS CSS containers clone, nest, clear and copy records with the original length rules', async () => {
  const source = [0x13, 80],
    outer = [0x13, 84],
    clone = [0x13, 88],
    nested = [0x13, 92];
  const call = (id, args, at) => [
    ...args.map((value) => [37, value]),
    [43, id, args.length * 4],
    [38, at],
  ];
  const runtime = new NativeRuntime({
    profile: 'bokutomo-engine-2.6.1.67',
    read: async () =>
      kcsProgram([
        ...call(238, [0x81234567], 80),
        ...call(238, [0x11122233], 84),
        ...call(244, [source, 7, 4, 320], 96),
        ...call(389, [0], 100),
        ...call(390, [0], 104),
        ...call(242, [outer, 9, source], 108),
        ...call(242, [outer, 10, 0], 112),
        ...call(390, [source], 88),
        ...call(389, [source], 116),
        ...call(248, [source], 120),
        ...call(248, [clone], 124),
        ...call(252, [outer, 9], 92),
        ...call(252, [outer, 10], 128),
        ...call(254, [source, 7, 352, 8], 132),
        ...call(254, [clone, 7, 352, 2], 136),
        ...call(254, [nested, 7, 368, 16], 140),
        ...call(254, [nested, 7, 0xffffffff, 8], 144),
        [59],
      ]),
  });
  const task = await runtime.spawn('css-containers.kcs'),
    m = task.machine,
    stack = m.sp;
  m.bytes(320, 4).set([0x93, 0x45, 0xda, 0xf0]);
  m.bytes(352, 32).fill(0xa5);
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.equal(new Set([80, 84, 88, 92].map((at) => m.load(at))).size, 4);
  assert.deepEqual(
    Array.from({ length: 13 }, (_, i) => m.load(96 + i * 4)),
    [1, 0, 0, 1, 0, 1, 0x81234567, 0x81234567, 0, 0, 2, 4, 0],
  );
  assert.deepEqual(m.bytes(352, 4), Uint8Array.of(0x93, 0x45, 0xa5, 0xa5));
  assert.deepEqual(m.bytes(368, 5), Uint8Array.of(0x93, 0x45, 0xda, 0xf0, 0xa5));
  const get = (at) => runtime.handles.get(m.load(at), 'global-file');
  assert.deepEqual(get(80).snapshot(), { tag: 0x81234567, capacity: 0x80000, records: [] });
  assert.deepEqual(get(88).snapshot(), get(92).snapshot());
  assert.deepEqual(
    get(84).read(9),
    Uint8Array.of(
      0,
      0,
      0,
      0,
      0,
      0,
      8,
      0,
      12,
      0,
      0,
      0,
      0x67,
      0x45,
      0x23,
      0x81,
      7,
      0,
      0,
      0,
      4,
      0,
      0,
      0,
      0x93,
      0x45,
      0xda,
      0xf0,
    ),
  );
});

test('2.6.1.67 KCS CSS restores the target Script variable range and the caller string bank', async () => {
  const container = [0x13, 80],
    receiver = [0x13, 84];
  const call = (id, args, at) => [
    ...args.map((value) => [37, value]),
    [43, id, args.length * 4],
    [38, at],
  ];
  const runtime = new NativeRuntime({
    profile: 'bokutomo-engine-2.6.1.67',
    read: async (name) =>
      name === 'writer.kcs'
        ? kcsProgram([
            ...call(238, [901], 80),
            ...call(243, [container, 9], 88),
            ...call(240, [container, 8, receiver, 1, 2], 92),
            [59],
          ])
        : kcsProgram([
            ...call(243, [container, 7], 88),
            ...call(253, [container, 7], 92),
            ...call(250, [container, 8, 0, 2], 96),
            ...call(250, [container, 7, receiver, 2], 100),
            ...call(250, [container, 8, receiver, 2], 104),
            ...call(253, [container, 9], 108),
            [59],
          ]),
  });
  const writer = await runtime.spawn('writer.kcs'),
    reader = await runtime.spawn('reader.kcs'),
    bank = runtime.variableBank(writer),
    vars = runtime.variableBank(reader),
    strings = runtime.stringBank(writer);
  bank.initialize(3);
  bank.words.set([2, 0x91234567, 42]);
  vars.initialize(3);
  vars.words.fill(0x12345678);
  strings.set(0x82345678, '猫');
  writer.machine.store(84, writer.id);
  await runtime.scheduler.execute(writer);
  assert.deepEqual([writer.machine.load(88), writer.machine.load(92)], [1, 1]);
  const id = writer.machine.load(80),
    file = runtime.handles.get(id, 'global-file');
  assert.deepEqual(
    file.read(9),
    Uint8Array.of(1, 0, 0, 0, 0x78, 0x56, 0x34, 0x82, 0x94, 0x4c, 0, ...Array(8).fill(0)),
  );
  reader.machine.store(80, id);
  reader.machine.store(84, reader.id);
  const stack = reader.machine.sp;
  await runtime.scheduler.execute(reader);
  assert.equal(reader.machine.sp, stack);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => reader.machine.load(88 + i * 4)),
    [0, 0, 0, 0, 1, 1],
  );
  assert.equal(file.read(7), null);
  assert.deepEqual([...vars.words], [0x12345678, 0x12345678, 0x91234567]);
  assert.equal(vars.dirty, true);
  assert.equal(runtime.stringBank(reader, false).get(0x82345678), '猫');
  assert.equal(runtime.stringBank(reader, false).dirty, true);
});

test('2.6.1.67 KCS CSS timestamp recognizes the magic alone and leaves failed outputs intact', async () => {
  const calls = [],
    runtime = new NativeRuntime({
      profile: 'bokutomo-engine-2.6.1.67',
      services: {
        localOffsetMinutes: () => 120,
        persistence: {
          read: (path) => {
            calls.push(['read', path]);
            return Uint8Array.of(path.endsWith('0.dat') ? 0x43 : 0xff, 0x53, 0x53, 0);
          },
          stat: (path) => {
            calls.push(['stat', path]);
            return { modifiedMs: Date.UTC(2019, 11, 31, 23, 45, 56) };
          },
        },
      },
      read: async () =>
        kcsProgram([
          ...[0, 1].flatMap((slot) => [
            [37, 256 + slot * 32],
            ...Array.from({ length: 5 }, (_, i) => [37, 320 + slot * 32 + i * 4]),
            [43, 255, 24],
            [38, 80 + slot * 4],
          ]),
          [59],
        ]),
    });
  const task = await runtime.spawn('css-time.kcs', { context: { contextName: 'save' } }),
    m = task.machine,
    stack = m.sp;
  m.writeString('save0000.dat', 256);
  m.writeString('save0001.dat', 288);
  m.bytes(320, 56).fill(0xa5);
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    [m.load(80), m.load(84), ...Array.from({ length: 5 }, (_, i) => m.load(320 + i * 4))],
    [1, 0, 2020, 1, 1, 1, 45],
  );
  assert.deepEqual(m.bytes(352, 24), new Uint8Array(24).fill(0xa5));
  assert.deepEqual(calls, [
    ['read', 'save/save0000.dat'],
    ['stat', 'save/save0000.dat'],
    ['read', 'save/save0001.dat'],
  ]);
});
