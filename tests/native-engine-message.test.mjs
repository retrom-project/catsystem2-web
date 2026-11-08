// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_UNWRITTEN_WORD, nativeEngineWord } from '../src/native/engine-message.mjs';
import {
  engineMessageFixture,
  engineMessageWorld,
  engineMessageCases,
  messageMemory,
  messageMemoryBase,
  prepareEngineMessageCase,
  engineMessageModelState,
  prepareEngineMessageOperation,
} from './fixtures/engine-message-fixture.mjs';

const golden = JSON.parse(
    await fs.readFile(new URL('fixtures/engine-message-golden.json', import.meta.url)),
  ),
  game = 'nekopara-vol3-engine-2.6.1.76',
  sdk = 'sdk-4.01-engine-2.6.1.74',
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const profile of golden.profiles)
  test(`complete task routing and Base/Top results match the original ${profile.profile}`, async () => {
    const results = [];
    for (const operations of engineMessageCases(profile.profile)) {
      const fixture = await engineMessageFixture(profile.profile),
        memory = messageMemory(),
        context = { payload: memory },
        replies = [];
      await prepareEngineMessageCase(fixture, operations);
      for (const operation of operations) {
        prepareEngineMessageOperation(fixture, operation);
        const { sender, target, message, w, l, taskL, flags } = operation;
        context.flags = flags;
        const reply = await fixture.messages.dispatchNative(
          sender,
          target,
          message,
          w,
          taskL ?? l,
          context,
        );
        replies.push({
          ...reply,
          result: reply.result === NATIVE_UNWRITTEN_WORD ? 'unwritten' : reply.result,
        });
      }
      results.push({
        replies,
        state: engineMessageModelState(fixture),
        memorySHA256: hash(memory.data),
        files: [...fixture.files].map(([name, bytes]) => [name, hash(bytes)]),
        visits: fixture.visits,
      });
    }
    assert.equal(results.length, profile.total);
    assert.equal(hash(JSON.stringify(results)), profile.resultsSHA256);
  });

test('task messages distinguish routing, handling and output initialization without losing their context', async () => {
  const { world, messages } = await engineMessageFixture(game),
    context = { marker: {} },
    seen = [];
  const task = world.objects.objects.get(4),
    original = task.implementation.message;
  task.implementation.message = (words, incoming) => {
    seen.push(incoming);
    return original(words, incoming);
  };
  assert.deepEqual(await messages.dispatch(4, 3, 17, 0, 0, context), {
    routed: true,
    handled: true,
    result: NATIVE_UNWRITTEN_WORD,
  });
  assert.equal(seen[0], context);
  assert.equal(context.nativeUnhandled, false);
  assert.deepEqual(await messages.dispatch(4, 3, 999, 0, 0, context), {
    routed: true,
    handled: false,
    result: NATIVE_UNWRITTEN_WORD,
  });
  assert.equal(context.nativeUnhandled, true);
  assert.deepEqual(await messages.dispatch(99, 3, 13, 0, 0, context), {
    routed: false,
    handled: false,
    result: NATIVE_UNWRITTEN_WORD,
  });
  assert.equal(await messages.send(0, 3, 13), NATIVE_UNWRITTEN_WORD);
  assert.throws(
    () => nativeEngineWord(NATIVE_UNWRITTEN_WORD, 'root type'),
    /root type.*initialized/,
  );
  assert.throws(() => nativeEngineWord(undefined), /initialized/);
  assert.throws(() => nativeEngineWord(null), /initialized/);
  assert.equal(nativeEngineWord(-1), 0xffffffff);
  assert.equal(await messages.send(4, 3, 23), 0xffffffff);
  task.state = 'releasing';
  assert.equal(await messages.send(4, 3, 13), 0);
  task.state = 'active';
  assert.equal(await messages.send(4, 3, 24, 0, -7), NATIVE_UNWRITTEN_WORD);
  assert.equal(await messages.send(4, 3, 23), 0xfffffff9);
});

test('nested Tops retain separate native IDs while the owning Root excludes itself from its registry', async () => {
  const { world, messages } = await engineMessageFixture(game),
    records = world.objects.objects;
  assert.equal(records.get(0).namespace, null);
  assert.equal(records.get(5).namespace, 0);
  assert.equal(records.get(6).namespace, 5);
  assert.equal(records.get(1).nativeID, 1);
  assert.equal(records.get(6).nativeID, 0);
  assert.equal(records.get(7).nativeID, 1);
  assert.equal(messages.resolve(3, 0), 0);
  assert.equal(messages.resolve(6, 0), 6);
  assert.equal(messages.resolve(6, 1), 7);
  assert.equal(messages.resolve(3, 5), 5);
  assert.equal(messages.resolve(6, 99), null);
  assert.equal(await messages.send(0, 3, 33, 0), 0);
  assert.equal(await messages.send(0, 3, 33, 5), 1);
  assert.equal(await messages.send(5, 6, 33, 5), 0);
  assert.equal(await messages.send(5, 6, 34), 0);
  assert.equal(await messages.send(5, 6, 35), 1);
  assert.deepEqual(messages.creation(3), { nativeID: 6, namespace: 0, frameRate: 60 });
  assert.deepEqual(messages.creation(6), { nativeID: 4, namespace: 5, frameRate: 60 });
});

test('Root shared bytes remain live and restore VM references against the new task memory', async () => {
  const fixture = await engineMessageFixture(sdk),
    memory = messageMemory(),
    context = { payload: memory };
  fixture.world.objects.machine = (id) => (id === 3 ? memory : null);
  await fixture.messages.send(0, 3, 30, 4, messageMemoryBase + 256, context);
  const root = fixture.world.objects.objects.get(0);
  assert.deepEqual(root.sharedDataRef, {
    kind: 'vm',
    taskID: 3,
    address: messageMemoryBase + 256,
    length: 4,
  });
  memory.data[256] = 0x9a;
  assert.equal(root.implementation.sharedData[0], 0x9a);
  const state = structuredClone(fixture.world.objects.snapshot()),
    next = engineMessageWorld(sdk),
    restoredMemory = messageMemory();
  restoredMemory.data.set(memory.data);
  next.world.objects.machine = (id) => (id === 3 ? restoredMemory : null);
  await next.world.objects.restore(state);
  restoredMemory.data[256] = 0x5a;
  assert.equal(next.world.objects.objects.get(0).implementation.sharedData[0], 0x5a);
  assert.equal(root.implementation.sharedData[0], 0x9a);
  const process = { read: (address, count) => memory.bytes(address, count).slice() };
  next.world.nativeEngine = { process };
  const payload = { bytes: (...args) => process.read(...args) };
  await next.messages.send(0, 3, 30, 4, messageMemoryBase + 256, { payload, nativePointer: true });
  memory.data[256] = 0x4c;
  assert.equal(next.world.objects.objects.get(0).implementation.sharedData[0], 0x4c);
  await next.messages.send(0, 3, 30, 0, 0x12345678, { payload, nativePointer: true });
  assert.equal(next.world.objects.objects.get(0).sharedDataRef.address, 0x12345678);
  assert.equal(next.world.objects.objects.get(0).implementation.sharedData.length, 0);
});

test('live ordered-map broadcasting visits new later siblings and preserves predecessors for the next send', async () => {
  const operations = [...engineMessageCases(game)].find((operations) => operations[0].dynamic),
    fixture = await engineMessageFixture(game),
    context = { payload: messageMemory(), flags: 1 };
  await prepareEngineMessageCase(fixture, operations);
  await fixture.messages.dispatchNative(3, 3, 222, 0, 0, context);
  assert.deepEqual(fixture.visits, [3, 4, 10]);
  assert.equal(fixture.messages.resolve(3, 2), 11);
  assert.equal(fixture.messages.resolve(0, 2), 2);
  assert.equal(fixture.world.objects.queue.length, 0);
  fixture.visits.length = 0;
  await fixture.messages.dispatchNative(3, 3, 222, 0, 0, context);
  assert.deepEqual(fixture.visits, [3, 11, 4, 10]);
});

test('factory pointer identity is normalized to a native task ID and all new Tops own their input/sound IDs', async () => {
  const fixture = await engineMessageFixture(game),
    context = { payload: messageMemory() };
  const created = await fixture.messages.dispatchNative(3, 3, 1, 1, messageMemoryBase, context);
  assert.equal(created.result, 6);
  const id = fixture.messages.resolve(3, created.result),
    record = fixture.world.objects.objects.get(id);
  assert.equal(id, 10);
  assert.equal(record.parent, 3);
  assert.equal(record.namespace, 0);
  assert.equal(await fixture.messages.send(id, 3, 34), 0);
  assert.equal(await fixture.messages.send(id, 3, 35), 1);
  assert.equal(context.nativeNewTask, undefined);
});

test('released native task IDs are reused without removing their surviving ancestor routes', async () => {
  const { world, messages } = await engineMessageFixture(game);
  await world.objects.release(4);
  assert.equal(messages.resolve(0, 4), null);
  assert.equal(messages.resolve(0, 3), 3);
  assert.equal(messages.allocateNativeID(0), 6);
  await world.objects.tick(1);
  assert.equal(messages.allocateNativeID(0), 4);
  const next = await world.objects.create({ kind: 0, parent: 3, name: 'replacement' });
  assert.equal(next, 4);
  assert.equal(world.objects.objects.get(next).nativeID, 4);
  assert.equal(messages.resolve(0, 4), next);
  const state = structuredClone(world.objects.snapshot()),
    restored = engineMessageWorld(game);
  await restored.world.objects.restore(state);
  assert.deepEqual(
    [...restored.messages.registry(restored.world.objects.objects.get(0))],
    [...messages.registry(world.objects.objects.get(0))],
  );
  assert.equal(restored.messages.resolve(6, 0), 6);
});

test('unregister retains NULL entries until the separate frame sweep, including matching ancestor keys', async () => {
  const { world, messages } = await engineMessageFixture(game),
    root = world.objects.objects.get(0),
    nested = world.objects.objects.get(5),
    sound = world.objects.objects.get(7);
  messages.unregister(sound, { erase: false });
  assert.equal(messages.registry(nested).get(1), null);
  // The native helper follows parent pointers; it does not stop at Top.
  assert.equal(messages.registry(root).get(1), null);
  assert.equal(await messages.send(0, 3, 33, 1), 1);
  assert.equal(messages.resolve(3, 1), null);
  assert.equal(messages.allocateNativeID(0), 6);
  messages.pruneNullRoutes(root);
  assert.equal(await messages.send(0, 3, 33, 1), 0);
  assert.equal(messages.allocateNativeID(0), 1);
  assert.equal(messages.registry(nested).has(1), true);
  messages.pruneNullRoutes(nested);
  assert.equal(messages.allocateNativeID(5), 1);
});
