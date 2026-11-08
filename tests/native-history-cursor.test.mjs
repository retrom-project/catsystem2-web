// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHistoryCursor, nativeHistoryCursor } from '../src/native/history-cursor.mjs';
import { historyCursorFixture } from './fixtures/history-cursor-fixture.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { kcsProgram } from './helpers.mjs';

test('history windows rotate complete reader identities and skip blocks without display text', async () => {
  const f = historyCursorFixture();
  f.scene.history.appendPath('a', 3);
  f.scene.history.appendPath('b', 2);
  const reply = await nativeHistoryCursor(0x17b, [f.sceneHandle, 3], f.machine, f.services),
    cursor = f.handles.get(reply.value, 'history-cursor');
  assert.deepEqual(
    cursor.rows.map((r) => [r.path, r.block, r.valid]),
    [
      [0, 3, 1],
      [1, 0, 1],
      [1, 2, 1],
    ],
  );
  const readers = cursor.rows.map((r) => r.reader);
  assert.equal(
    (await nativeHistoryCursor(0x17d, [reply.value, 0], f.machine, f.services)).value,
    1,
  );
  assert.deepEqual(
    cursor.rows.map((r) => [r.path, r.block]),
    [
      [0, 2],
      [0, 3],
      [1, 0],
    ],
  );
  assert.deepEqual(
    cursor.rows.map((r) => r.reader),
    [readers[2], readers[0], readers[1]],
  );
  assert.equal(
    (await nativeHistoryCursor(0x17d, [reply.value, 1], f.machine, f.services)).value,
    1,
  );
  assert.deepEqual(
    cursor.rows.map((r) => [r.path, r.block]),
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
  assert.equal(restored.rows[0].lastBlock, 2);
  assert.equal((await nativeHistoryCursor(0x17c, [handle], f.machine, f.services)).control, 2);
  assert.equal(f.handles.records.has(handle), false);
  assert.equal(f.handles.records.has(f.sceneHandle), true);
});

test('one-slot history window excludes the live final block and empty history retains a zero-capacity descriptor', async () => {
  const f = historyCursorFixture();
  f.scene.history.appendPath('a', 3);
  const cursor = new NativeHistoryCursor(f.sceneHandle, 1);
  await cursor.initialize(f.services);
  assert.equal(cursor.rows[0].block, 2);
  const state = cursor.snapshot();
  assert.equal(await cursor.move(1, f.services), 0);
  assert.deepEqual(cursor.snapshot(), state);
  f.scene.history.path = [];
  const empty = new NativeHistoryCursor(f.sceneHandle, 0);
  await empty.initialize(f.services);
  assert.equal(empty.rows.length, 0);
  assert.throws(() => empty.rotate(false), /no mapped reader slots/);
  assert.throws(() => new NativeHistoryCursor(f.sceneHandle, -1), /mapped/);
  assert.equal(nativeHistoryCursor(0x17b, [], f.machine), undefined);
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} native dispatch and fresh runtime restore share the original scene handle`, async () => {
    const f = historyCursorFixture(),
      program = kcsProgram([[59]]),
      make = () =>
        new NativeRuntime({
          profile,
          read: async (name) => (name === 'main.kcs' ? program : f.services.read(name)),
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
    assert.equal(fresh.handles.get(cursorHandle, 'history-cursor').rows[0].lastBlock, 2);
    assert.equal(runtime.handles.get(cursorHandle, 'history-cursor').rows[0].lastBlock, 3);
    await fc(0x17c, [cursorHandle]);
    assert.equal(fresh.handles.records.has(source), true);
    await fc(0x144, [source]);
  });
