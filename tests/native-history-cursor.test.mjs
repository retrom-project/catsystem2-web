// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHistoryCursor, nativeHistoryCursor } from '../src/native/history-cursor.mjs';
import { historyCursorFixture } from './fixtures/history-cursor-fixture.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint, checkpointBytes } from '../src/checkpoint.mjs';

const cursorRows = (cursor) =>
  Array.from({ length: cursor.capacity }, (_, index) => cursor.row(index));

test('history windows rotate complete reader identities and skip blocks without display text', async () => {
  const f = historyCursorFixture();
  f.scene.history.appendPath('a', 3);
  f.scene.history.appendPath('b', 2);
  const reply = await nativeHistoryCursor(0x17b, [f.sceneHandle, 3], f.machine, f.services),
    cursor = f.handles.get(reply.value, 'history-cursor');
  assert.deepEqual(
    cursorRows(cursor).map((r) => [r.path, r.block, r.valid]),
    [
      [0, 3, 1],
      [1, 0, 1],
      [1, 2, 1],
    ],
  );
  const readers = cursorRows(cursor).map((r) => r.reader);
  assert.equal(
    (await nativeHistoryCursor(0x17d, [reply.value, 0], f.machine, f.services)).value,
    1,
  );
  assert.deepEqual(
    cursorRows(cursor).map((r) => [r.path, r.block]),
    [
      [0, 2],
      [0, 3],
      [1, 0],
    ],
  );
  assert.deepEqual(
    cursorRows(cursor).map((r) => r.reader),
    [readers[2], readers[0], readers[1]],
  );
  assert.equal(
    (await nativeHistoryCursor(0x17d, [reply.value, 1], f.machine, f.services)).value,
    1,
  );
  assert.deepEqual(
    cursorRows(cursor).map((r) => [r.path, r.block]),
    [
      [0, 3],
      [1, 0],
      [1, 2],
    ],
  );
  const state = cursor.snapshot();
  assert.equal(
    (await nativeHistoryCursor(0x17d, [reply.value, 99], f.machine, f.services)).value,
    0,
  );
  assert.deepEqual(cursor.snapshot(), state);
});

test('history text and commands preserve byte buffers on misses and keep the live source history', async () => {
  const f = historyCursorFixture();
  f.scene.history.appendPath('a', 3);
  const created = await nativeHistoryCursor(0x17b, [f.sceneHandle, 4], f.machine, f.services),
    handle = created.value,
    cursor = f.handles.get(handle, 'history-cursor');
  f.memory.fill(0x7f);
  assert.equal(
    (await nativeHistoryCursor(0x17e, [handle, 0, 64, 128], f.machine, f.services)).value,
    1,
  );
  assert.equal(new TextDecoder().decode(f.memory.subarray(64, 68)), 'A0+\0');
  assert.equal(new TextDecoder().decode(f.memory.subarray(128, 134)), 'Alice\0');
  assert.equal(f.memory[68], 0x7f);
  assert.equal(
    (await nativeHistoryCursor(0x17f, [handle, 0, 256, 1], f.machine, f.services)).value,
    1,
  );
  assert.equal(new TextDecoder().decode(f.memory.subarray(256, 265)), 'voice a1\0');
  assert.equal(
    (await nativeHistoryCursor(0x17f, [handle, 0, 256, 2], f.machine, f.services)).value,
    0,
  );
  assert.equal(f.memory[256], 0);
  const saved = structuredClone(f.handles.snapshot());
  f.handles.restore(saved);
  f.handles.get(f.sceneHandle, 'scene-data').history.path[0].value = 2;
  const restored = f.handles.get(handle, 'history-cursor');
  assert.notEqual(restored, cursor);
  await nativeHistoryCursor(0x17e, [handle, 0, 64, 128], f.machine, f.services);
  assert.equal(restored.row(0).lastBlock, 2);
  assert.equal((await nativeHistoryCursor(0x17c, [handle], f.machine, f.services)).control, 2);
  assert.equal(f.handles.records.has(handle), false);
  assert.equal(f.handles.records.has(f.sceneHandle), true);
});

test('one-slot history window excludes the live final block and empty history retains a zero-capacity descriptor', async () => {
  const f = historyCursorFixture();
  f.scene.history.appendPath('a', 3);
  const cursor = new NativeHistoryCursor(f.sceneHandle, 1);
  await cursor.initialize(f.services);
  assert.equal(cursor.row(0).block, 2);
  const state = cursor.snapshot();
  assert.equal(await cursor.move(1, f.services), 0);
  assert.deepEqual(cursor.snapshot(), state);
  f.scene.history.path = [];
  const empty = new NativeHistoryCursor(f.sceneHandle, 0);
  await empty.initialize(f.services);
  assert.equal(empty.capacity, 0);
  assert.throws(() => empty.rotate(false), /no mapped reader slots/);
  assert.throws(() => new NativeHistoryCursor(f.sceneHandle, -1), /mapped/);
  assert.equal(nativeHistoryCursor(0x17b, [], f.machine), undefined);
});

test('large history windows allocate occupied slots and round-trip real GCALL state through a checkpoint file', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    capacity = 0x100001,
    source = [0x13, 64],
    cursor = [0x13, 68],
    f = historyCursorFixture(),
    steps = [
      [329, [source, 256, 3], 72],
      [379, [source, capacity], 68],
      [384, [cursor, 0, 512, 516], 76],
      [384, [cursor, capacity - 1, 520, 524], 80],
      [382, [cursor, 0, 640, 768], 84],
      [383, [cursor, 0, 896, 1], 88],
    ],
    program = kcsProgram(
      [
        [43, 323, 0],
        [38, 64],
        ...steps.flatMap(([id, args, at]) => [
          ...args.map((arg) => [37, arg]),
          [43, id, args.length * 4],
          [38, at],
        ]),
        [59],
      ],
      [[256, 'a']],
    ),
    make = () =>
      new NativeRuntime({
        profile,
        shared: new Uint8Array(2048),
        read: (name) => (name === 'window.kcs' ? program : f.services.read(name)),
      }),
    runtime = make(),
    task = await runtime.spawn('window.kcs'),
    m = task.machine,
    floor = m.sp;
  m.bytes(512, 32).fill(0xa5);
  assert.equal((await runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(m.sp, floor);
  assert.deepEqual(
    [72, 76, 80, 84, 88].map((at) => m.load(at)),
    [1, 1, 0, 1, 1],
  );
  assert.deepEqual([m.load(512), m.load(516)], [0, 0]);
  assert.deepEqual(m.bytes(520, 8), new Uint8Array(8).fill(0xa5));
  assert.equal(m.string(640), 'A0+');
  assert.equal(m.string(768), 'Alice');
  assert.equal(m.string(896), 'voice a1');
  const handle = m.load(68),
    resource = runtime.handles.get(handle, 'history-cursor');
  assert.equal(resource.capacity, capacity);
  assert.ok(resource.slots.size <= 5);
  const state = runtime.snapshot();
  assert.ok(checkpointBytes(state) < 65536);
  const file = await serializeCheckpoint(state);
  assert.ok(file.length < 16384);
  const fresh = make();
  await fresh.restore(await deserializeCheckpoint(file));
  const restored = fresh.handles.get(handle, 'history-cursor'),
    owner = fresh.scheduler.tasks.get(task.id),
    call = (id, args) => fresh.native('main', id, args, owner.machine, owner);
  assert.deepEqual(restored.snapshot(), resource.snapshot());
  assert.notEqual(restored.row(0).reader, resource.row(0).reader);
  assert.deepEqual(await call(382, [handle, 1, 640, 768]), { control: 1, value: 1 });
  assert.equal(owner.machine.string(640), 'A2');
  assert.equal(owner.machine.string(768), 'Bob');
  assert.deepEqual(await call(381, [handle, 0]), { control: 1, value: 0 });
  assert.ok(restored.slots.size <= 5);
  assert.deepEqual(await call(380, [handle]), { control: 2 });
  assert.throws(() => fresh.handles.get(handle, 'history-cursor'), /released/);
  const scene = fresh.handles.get(m.load(64), 'scene-data');
  assert.equal(scene.history.path.length, 1);
  scene.history.path = [];
  const empty = (await call(379, [m.load(64), 0x200001])).value;
  assert.equal(fresh.handles.get(empty, 'history-cursor').slots.size, 0);
  assert.deepEqual(await call(380, [empty]), { control: 2 });
  assert.deepEqual(await call(324, [m.load(64)]), { control: 2 });
});

for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(`${profile} native dispatch and fresh runtime restore share the original scene handle`, async () => {
    const f = historyCursorFixture(),
      program = kcsProgram([[59]]),
      reads = [],
      make = () =>
        new NativeRuntime({
          profile,
          read: async (name, category) => {
            if (name === 'main.kcs') return program;
            reads.push([name, category]);
            return f.services.read(name);
          },
        }),
      runtime = make(),
      task = await runtime.spawn('main.kcs'),
      call = (id, args) => runtime.native('main', id, args, task.machine, task),
      source = (await call(0x143, [])).value;
    task.machine.writeString('日本', 32);
    await call(0x149, [source, 32, 3]);
    const cursorHandle = (await call(0x17b, [source, 4])).value,
      fresh = make();
    await fresh.restore(structuredClone(runtime.snapshot()));
    const ft = fresh.scheduler.tasks.get(task.id),
      fc = (id, args) => fresh.native('main', id, args, ft.machine, ft);
    assert.equal((await fc(0x180, [cursorHandle, 0, 8, 12])).value, 1);
    assert.equal(ft.machine.load(8), 0);
    assert.equal(ft.machine.load(12), 0);
    assert.equal((await fc(0x17e, [cursorHandle, 0, 256, 512])).value, 1);
    const buffer = ft.machine.bytes(256, 256),
      message = buffer.subarray(0, buffer.indexOf(0));
    assert.deepEqual(message.subarray(message.length - 4), Uint8Array.of(0x81, 0x5c, 0xff, 0x80));
    fresh.handles.get(source, 'scene-data').history.path[0].value = 2;
    await fc(0x17e, [cursorHandle, 0, 256, 512]);
    assert.equal(fresh.handles.get(cursorHandle, 'history-cursor').row(0).lastBlock, 2);
    assert.equal(runtime.handles.get(cursorHandle, 'history-cursor').row(0).lastBlock, 3);
    await fc(0x17c, [cursorHandle]);
    assert.equal(fresh.handles.records.has(source), true);
    await fc(0x144, [source]);
    if (profile === 'grisaia-jp-engine-2.6.1.23') {
      assert.ok(reads.length);
      assert.ok(reads.every(([name, category]) => !name.endsWith('.cstl') && category === 'scene'));
      const largeHandle = (await call(0x17b, [source, 0x100001])).value;
      const large = runtime.handles.get(largeHandle, 'history-cursor');
      assert.equal(large.capacity, 0x100001);
      assert.ok(large.slots.size <= 5);
      const restored = make();
      await restored.restore(structuredClone(runtime.snapshot()));
      const restoredLarge = restored.handles.get(largeHandle, 'history-cursor');
      assert.equal(restoredLarge.capacity, large.capacity);
      assert.deepEqual(restoredLarge.snapshot(), large.snapshot());
      assert.ok(restoredLarge.slots.size <= 5);
    }
  });
