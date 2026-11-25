// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeEngineMessages } from '../src/native/engine-message.mjs';

function fixture() {
  const world = { profile: 'rebellions-jp-engine-2.6.1.63', objects: new NativeObjects() },
    messages = new NativeEngineMessages(world),
    records = world.objects.objects;
  world.objects.register(0, (record) => messages.base(record));
  const add = (id, parent = null) => {
    const record = { id, nativeID: id, kind: 0, parent, name: '', state: 'active' };
    records.set(id, record);
    record.implementation = messages.base(record);
    return record;
  };
  return { world, messages, records, add };
}

test('live child traversal retains signed order, descendant filtering and callback microtasks', async () => {
  const { messages, add } = fixture(),
    root = add(100),
    trace = [];
  add(0xffffffff, root.id);
  add(0x80000000, root.id);
  add(4, root.id);
  add(3, 4);
  add(1, root.id);
  await messages.eachChild(root, (child) => {
    trace.push(child.id);
    queueMicrotask(() => trace.push('microtask'));
  });
  assert.deepEqual(trace, [
    0x80000000,
    'microtask',
    0xffffffff,
    'microtask',
    1,
    'microtask',
    4,
    'microtask',
  ]);
});

test('live child traversal observes same-size replacements, live values, reentry and map replacement', async () => {
  const { messages, add } = fixture(),
    root = add(100),
    visits = [];
  add(1, root.id);
  add(3, root.id);
  add(5, root.id);
  add(7, root.id);
  await messages.eachChild(root, async (child) => {
    visits.push(child.id);
    if (child.id === 1) {
      root.nativeTaskRoutes.delete(3);
      add(2, root.id);
      root.nativeTaskRoutes.set(5, null);
      const nested = [];
      await messages.eachChild(root, (current) => nested.push(current.id));
      assert.deepEqual(nested, [1, 2, 7]);
      add(0, root.id);
    } else if (child.id === 2) {
      // A replaced ordinary Map remains a supported live route source.
      root.nativeTaskRoutes = new Map(root.nativeTaskRoutes);
      root.nativeTaskRoutes.delete(7);
      add(6, root.id);
    }
  });
  assert.deepEqual(visits, [1, 2, 6]);
  const repeated = [];
  await messages.eachChild(root, (child) => repeated.push(child.id));
  assert.deepEqual(repeated, [0, 1, 2, 6]);
});

test('live child traversal sees clear and new keys after an awaited callback', async () => {
  const { messages, add } = fixture(),
    root = add(100),
    visits = [];
  add(1, root.id);
  add(3, root.id);
  await messages.eachChild(root, async (child) => {
    visits.push(child.id);
    if (child.id === 1) {
      await Promise.resolve();
      root.nativeTaskRoutes.clear();
      add(0, root.id);
      add(2, root.id);
    }
  });
  assert.deepEqual(visits, [1, 2]);
});

test('route traversal rebuilds its transient index after an ordinary task checkpoint restore', async () => {
  const source = fixture(),
    root = source.add(100);
  source.add(0x80000000, root.id);
  source.add(1, root.id);
  const before = [];
  await source.messages.eachChild(root, (child) => before.push(child.id));
  const snapshot = source.world.objects.snapshot(),
    restored = fixture();
  await restored.world.objects.restore(snapshot);
  const current = restored.records.get(root.id),
    after = [];
  assert.ok(current.nativeTaskRoutes instanceof Map);
  assert.deepEqual([...current.nativeTaskRoutes], [...root.nativeTaskRoutes]);
  await restored.messages.eachChild(current, (child) => after.push(child.id));
  assert.deepEqual(after, before);
  restored.add(2, root.id);
  const changed = [];
  await restored.messages.eachChild(current, (child) => changed.push(child.id));
  assert.deepEqual(changed, [0x80000000, 1, 2]);
  assert.deepEqual(
    restored.world.objects.snapshot().objects.map(({ nativeTaskRoutes }) => [...nativeTaskRoutes]),
    [[...root.nativeTaskRoutes, [2, 2]], [], [], []],
  );
});
