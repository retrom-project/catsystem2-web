// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESObjectCollection, compareFESObjectKeys } from '../src/native/fes-object-collection.mjs';
import { FES_FIRST_OBJECT_HANDLE } from '../src/native/fes-object-graph.mjs';

class TypedObject {
  constructor(identity) {
    Object.assign(this, identity);
    this.position = Float32Array.of(-0, 7, -8);
  }
  kind() {
    return this.nativeType;
  }
}
function fixture() {
  const constructed = [],
    closed = [],
    collection = new FESObjectCollection({
      create(identity) {
        constructed.push(identity);
        return new TypedObject(identity);
      },
      close(object) {
        closed.push(object.key);
      },
    });
  return { collection, constructed, closed };
}

test('native first-wins insertion preserves type/identity and first count through grow, shrink, delete and recreate', async () => {
  const { collection: c, constructed } = fixture(),
    initial = c.create('IMAGE', 'g', 2),
    grown = c.create('STRING', 'g', 4);
  assert.deepEqual(grown.slice(0, 2), initial);
  assert.deepEqual(
    grown.map((o) => o.nativeType),
    [2, 2, 21, 21],
  );
  assert.equal(c.count('g'), 2);
  assert.equal(c.lookup('g', 3), grown[3], 'explicit lookup does not use the first bare count');
  assert.deepEqual([...c.selection('g')], initial);
  assert.equal(constructed.length, 4, 'duplicates do not construct hidden leaked objects');
  assert.deepEqual(c.create('BUTTON', 'g', 1), [initial[0]]);
  await c.remove(initial[0]);
  await c.remove(initial[1]);
  assert.equal(c.count('g'), 2);
  assert.deepEqual([...c.selection('g')], [null, null]);
  const recreated = c.create('BUTTON', 'g', 1)[0];
  assert.equal(recreated.nativeType, 6);
  assert.equal(recreated.handle, FES_FIRST_OBJECT_HANDLE + 4);
  assert.equal(c.count('g'), 2);
  assert.deepEqual([...c.selection('g')], [recreated, null]);
  assert.equal(c.lookup('g', 3), grown[3]);
});

test('scalar and array zero share an exact CP932 C-string key while case, bytes and first presentation remain distinct', () => {
  const { collection: c } = fixture(),
    scalar = c.create('IMAGE', 'History', 1, { scalar: true })[0];
  assert.strictEqual(c.create('STRING', 'History', 1)[0], scalar);
  assert.equal(scalar.key, 'History');
  assert.equal(scalar.index, null);
  assert.equal(c.lookup('history', 0), null);
  assert.strictEqual(c.lookup('History\0ignored', 0), scalar);
  const byte = c.create('STRING8', Uint8Array.of(0x82, 0xa0), 1)[0];
  assert.strictEqual(c.lookup('あ', 0), byte);
  assert.strictEqual(c.create('IMAGE', Uint8Array.of(0x82, 0xa0, 0, 0x41), 1)[0], byte);
  assert.throws(() => c.create('IMAGE', 'あ'.repeat(16), 1), /31-byte/);
  assert.equal(
    c.lookup('History', 0x100000000),
    scalar,
    'lookup follows int32 argument conversion',
  );
});

test('known nonallocating NUMIMG retains declared count and initializer requests; unknown types fail visibly', () => {
  const { collection: c, constructed } = fixture();
  assert.deepEqual(c.create('NUMIMG', 'numbers', 3), [null, null, null]);
  assert.equal(c.count('numbers'), 3);
  assert.equal(c.hasGroup('numbers'), true);
  assert.equal(c.lookup('numbers', 0), null);
  assert.equal(c.peekPending().object, null);
  assert.equal(constructed.length, 0);
  c.create('NUMIMG', 'empty', 0);
  c.create('NUMIMG', 'negative', -1);
  assert.equal(c.hasGroup('empty'), true);
  assert.equal(c.count('negative'), -1);
  assert.throws(() => c.create(99, 'bad', 0), /Unknown FES object type/);
  assert.equal(c.hasGroup('bad'), false);
  assert.equal(c.graph.nextHandle, FES_FIRST_OBJECT_HANDLE);
});

test('initialization FIFO retains repeated declaration requests and resolves the current object when consumed', async () => {
  const { collection: c } = fixture(),
    initial = c.create('IMAGE', 'g', 2);
  c.create('STRING', 'g', 2);
  assert.equal(c.peekPending().object, initial[0]);
  assert.equal(c.peekPending().object, initial[0], 'peek does not consume');
  await c.remove(initial[0]);
  assert.deepEqual(
    c.snapshot().pending.map((p) => p.index),
    [1, 0, 1],
    'delete removes only first matching initializer',
  );
  const replacement = c.create('BUTTON', 'g', 1, { enqueue: false })[0];
  assert.equal(c.shiftPending().object, initial[1]);
  assert.equal(
    c.shiftPending().object,
    replacement,
    'later duplicate request performs a fresh key lookup',
  );
  assert.equal(c.shiftPending().object, initial[1]);
  assert.equal(c.shiftPending(), null);
  assert.equal(c.pending.length, 0);
  assert.equal(c.pendingHead, 0);
});

test('collection deletion is child-first unsigned lifetime order and leaves bare counts and child FIFO holes intact', async () => {
  const { collection: c, closed } = fixture(),
    root = c.create('BASE', 'root', 1)[0],
    z = c.create('IMAGE', 'z', 1, { parent: root })[0],
    a = c.create('IMAGE', 'a', 1, { parent: root })[0],
    leaf = c.create('IMAGE', 'leaf', 1, { parent: z })[0];
  assert.deepEqual(
    c.ordered().map((o) => o.baseName),
    ['a', 'leaf', 'root', 'z'],
  );
  await c.remove(root);
  assert.deepEqual(closed, [leaf.key, z.key, a.key, root.key]);
  assert.equal(c.objects.length, 0);
  assert.equal(c.byKey.size, 0);
  assert.equal(c.graph.records.size, 0);
  assert.equal(c.count('root'), 1);
  assert.equal(c.count('z'), 1);
  assert.deepEqual(
    c.snapshot().pending.map((p) => p.name),
    ['z', 'a', 'leaf'],
  );
  assert.equal(c.shiftPending().object, null, 'a deleted child request is an actual hole');
});

test('object-map order includes signed CP932 bytes and signed indices without changing allocation or lifetime order', () => {
  const { collection: c } = fixture(),
    ascii = c.create('IMAGE', 'A', 1)[0],
    wide = c.create('IMAGE', 'あ', 1)[0],
    empty = c.create('IMAGE', '', 1)[0];
  assert.deepEqual(c.objects, [ascii, wide, empty]);
  assert.deepEqual(c.ordered(), [wide, empty, ascii]);
  assert.strictEqual(c.ordered(), c.ordered(), 'ordered visits borrow the cached buffer');
  assert.ok(
    compareFESObjectKeys(
      { nameBytes: Uint8Array.of(65), index: -1 },
      { nameBytes: Uint8Array.of(65), index: 0 },
    ) < 0,
  );
  assert.ok(
    compareFESObjectKeys(
      { nameBytes: Uint8Array.of(65), index: 0x7fffffff },
      { nameBytes: Uint8Array.of(65), index: -0x80000000 },
    ) > 0,
  );
  assert.ok(
    compareFESObjectKeys(
      { nameBytes: Uint8Array.of(65, 0x82), index: 0 },
      { nameBytes: Uint8Array.of(65), index: 0 },
    ) < 0,
    'the original comparison includes signed high bytes against the terminator',
  );
});

test('fresh pure restore preserves typed prototypes, graph identity, pending requests, first counts and delete/recreate history', async () => {
  const f = fixture(),
    c = f.collection,
    originals = c.create('IMAGE', 'g', 2),
    grown = c.create('STRING8', 'g', 4),
    root = c.create('BASE', 'root', 1, { enqueue: false })[0];
  c.graph.bind(grown[3], root);
  await c.remove(originals[0]);
  const replacement = c.create('BUTTON', 'g', 1, { scalar: true })[0];
  replacement.flags = Uint8Array.of(7, 0xff, 19);
  const saved = c.snapshot(),
    fresh = fixture();
  fresh.collection.restore(structuredClone(saved));
  const r = fresh.collection;
  assert.deepEqual(r.snapshot(), saved);
  assert.deepEqual(fresh.closed, []);
  assert.equal(
    fresh.constructed.length,
    c.objects.length,
    'restore constructs state only, without replaying declarations',
  );
  assert.equal(r.lookup('g', 0).kind(), 6);
  assert.equal(r.lookup('g', 0).index, null);
  assert.ok(Object.is(r.lookup('g', 0).position[0], -0));
  assert.deepEqual(r.lookup('g', 0).flags, replacement.flags);
  assert.equal(r.lookup('g', 3).parentHandle, root.handle);
  assert.equal(r.graph.children(r.lookup('root', 0))[0], r.lookup('g', 3));
  assert.equal(r.count('g'), 2);
  assert.equal(r.create('IMAGE', 'new', 1)[0].handle, c.graph.nextHandle);
  assert.throws(() => r.restore(saved), /fresh collection/);
});

test('current checkpoint rejects duplicate keys and impossible allocated NUMIMG without compatibility machinery', () => {
  const { collection: c } = fixture();
  c.create('IMAGE', 'g', 1);
  const duplicate = c.snapshot();
  duplicate.objects.push(structuredClone(duplicate.objects[0]));
  assert.throws(() => fixture().collection.restore(duplicate), /Duplicate FES saved object key/);
  const invalid = c.snapshot();
  invalid.objects[0].type = 'NUMIMG';
  invalid.objects[0].nativeType = 28;
  assert.throws(() => fixture().collection.restore(invalid), /NUMIMG/);
});

test('owning collection teardown closes remaining tasks once, releases group storage and never reuses a handle', async () => {
  const { collection: c, closed } = fixture(),
    [object] = c.create('LOGSTRING', 'history', 1);
  const next = c.graph.nextHandle;
  await c.close();
  await c.close();
  assert.deepEqual(closed, [object.key]);
  assert.equal(c.hasGroup('history'), false);
  assert.equal(c.objects.length, 0);
  assert.equal(c.pending.length, 0);
  assert.equal(c.entries.size, 0);
  assert.equal(c.create('IMAGE', 'history', 1)[0].handle, next);
});

test('typed construction failure is explicit and consumes no semantic handle', () => {
  const c = new FESObjectCollection({
    create() {
      return null;
    },
  });
  assert.throws(() => c.create('IMAGE', 'g', 1), /synchronous object/);
  assert.equal(c.graph.nextHandle, FES_FIRST_OBJECT_HANDLE);
  assert.equal(c.objects.length, 0);
  assert.equal(c.hasGroup('g'), false);
});

test('VIEW declaration type5 owns a real raw0 Base object and survives fresh typed restoration', () => {
  const f = fixture(),
    c = f.collection,
    view = c.create(5, 'camera', 1)[0];
  assert.equal(f.constructed[0].type, 'VIEW');
  assert.equal(f.constructed[0].nativeType, 0);
  assert.equal(view.type, 'VIEW');
  assert.equal(view.nativeType, 0);
  assert.equal(view.kind(), 0);
  assert.strictEqual(c.create('IMAGE', 'camera', 1)[0], view);
  const saved = c.snapshot(),
    fresh = fixture();
  assert.equal(saved.objects[0].type, 'VIEW');
  assert.equal(saved.objects[0].nativeType, 0);
  fresh.collection.restore(saved);
  const restored = fresh.collection.lookup('camera', 0);
  assert.equal(restored.type, 'VIEW');
  assert.equal(restored.nativeType, 0);
  assert.equal(restored.kind(), 0);
  assert.deepEqual(fresh.collection.snapshot(), saved);
  const inconsistent = c.snapshot();
  inconsistent.objects[0].nativeType = 5;
  assert.throws(
    () => fixture().collection.restore(inconsistent),
    /declaration and raw object type/,
  );
});
