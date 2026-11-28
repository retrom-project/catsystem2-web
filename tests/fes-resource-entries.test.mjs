// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESResourceEntries } from '../src/native/fes-resource-entries.mjs';

const bytes = (name) => Uint8Array.from([...name].map((letter) => letter.charCodeAt(0)));
function fixture(overrides = {}) {
  const live = new Map(),
    pending = [],
    events = [];
  const resolve = (name, index) => live.get(`${Array.from(name)}:${index}`) ?? null;
  const services = {
    resolve,
    allocate(entry, object) {
      entry.wrapper = entry.id + 100;
      object.currentWrapper = entry.wrapper;
      events.push(['allocate', entry.id, object.handle]);
    },
    visit(entry, object) {
      events.push([
        'visit',
        entry.id,
        object.handle,
        object.nativeType,
        entry.wrapper,
        object.currentWrapper,
      ]);
    },
    cleanup(entry) {
      events.push(['cleanup', entry.id, entry.savedType, entry.wrapper]);
    },
    validate(entry, object) {
      events.push(['validate', entry.id, object?.handle ?? null, entry.wrapper]);
    },
    ...overrides,
  };
  const list = new FESResourceEntries(services),
    collection = { shiftPending: () => pending.shift() ?? null };
  return {
    live,
    pending,
    events,
    services,
    list,
    collection,
    set(name, object, index = 0) {
      live.set(`${Array.from(bytes(name))}:${index}`, object);
    },
    delete(name, index = 0) {
      live.delete(`${Array.from(bytes(name))}:${index}`);
    },
    queue(name, index = 0) {
      pending.push({ name, nameBytes: bytes(name), index });
    },
  };
}
test('resource FIFO allocates every duplicate request and visits explicit wrappers with the latest object getter', async () => {
  const f = fixture(),
    object = { nativeType: 2, handle: 0x1001 };
  f.set('image', object);
  f.queue('image');
  f.queue('image');
  assert.equal(await f.list.appendPending(f.collection), 2);
  assert.equal(f.list.entries.length, 2);
  assert.equal(object.currentWrapper, 102);
  assert.deepEqual(await f.list.traverse(), { visited: 2, cleaned: 0 });
  assert.deepEqual(f.events, [
    ['allocate', 1, 0x1001],
    ['allocate', 2, 0x1001],
    ['visit', 1, 0x1001, 2, 101, 102],
    ['visit', 2, 0x1001, 2, 102, 102],
  ]);
});
test('resource FIFO re-resolves byte keys after delete and recreation without handle or saved-type comparisons', async () => {
  const f = fixture();
  f.set('key', { nativeType: 2, handle: 0x1001 });
  f.queue('key');
  await f.list.appendPending(f.collection);
  f.delete('key');
  f.set('key', { nativeType: 23, handle: 0x1002, currentWrapper: 999 });
  f.queue('key');
  await f.list.appendPending(f.collection);
  await f.list.traverse();
  assert.deepEqual(f.events.slice(-2), [
    ['visit', 1, 0x1002, 23, 101, 102],
    ['visit', 2, 0x1002, 23, 102, 102],
  ]);
  f.delete('key');
  assert.deepEqual(await f.list.traverse(), { visited: 0, cleaned: 2 });
  assert.deepEqual(f.events.slice(-2), [
    ['cleanup', 1, 2, 101],
    ['cleanup', 2, 23, 102],
  ]);
});
test('resource FIFO observes deletion during the pass only when the next entry resolves its key', async () => {
  const f = fixture({
    visit(entry, object) {
      f.events.push(['visit', entry.id, object.handle]);
      f.delete('same');
    },
  });
  f.set('same', { nativeType: 6, handle: 0x1001 });
  f.queue('same');
  f.queue('same');
  await f.list.appendPending(f.collection);
  assert.deepEqual(await f.list.traverse(), { visited: 1, cleaned: 1 });
  assert.equal(f.list.entries[0].id, 1);
  assert.deepEqual(await f.list.traverse(), { visited: 0, cleaned: 1 });
});
test('resource FIFO consumes missing keys and proved nonresource types, preserving successful allocation order', async () => {
  const f = fixture({
    allocate(entry, object) {
      f.events.push(['allocate', entry.id, object.nativeType]);
      if (object.fail) return false;
      entry.wrapper = entry.id;
    },
  });
  for (const nativeType of [0, 34, 35, 2, 7, 6]) {
    const name = String(nativeType);
    f.set(name, { nativeType, fail: nativeType === 7 });
    f.queue(name);
  }
  f.queue('missing');
  assert.equal(await f.list.appendPending(f.collection), 2);
  assert.deepEqual(f.events, [
    ['allocate', 1, 2],
    ['allocate', 2, 7],
    ['allocate', 3, 6],
  ]);
  assert.deepEqual(
    f.list.entries.map((e) => [e.id, e.savedType]),
    [
      [1, 2],
      [3, 6],
    ],
  );
  f.set('bad', { nativeType: 99 });
  f.queue('bad');
  await assert.rejects(
    f.list.appendPending(f.collection),
    /Unsupported FES resource allocation type 99/,
  );
});
test('resource FIFO restores all independent resources and the next counter without replay, cleanup or allocation', async () => {
  const f = fixture(),
    object = { nativeType: 2, handle: 0x1001 };
  f.set('same', object);
  f.queue('same');
  f.queue('same');
  await f.list.appendPending(f.collection);
  const saved = structuredClone(f.list.snapshot());
  const fresh = fixture();
  fresh.set('same', { ...object, handle: 0x2001 });
  await fresh.list.restore(saved);
  assert.deepEqual(fresh.events, [
    ['validate', 1, 0x2001, 101],
    ['validate', 2, 0x2001, 102],
  ]);
  assert.deepEqual(fresh.list.snapshot(), f.list.snapshot());
  fresh.queue('same');
  await fresh.list.appendPending(fresh.collection);
  assert.equal(fresh.list.entries[2].id, 3);
  await assert.rejects(fresh.list.restore(saved), /fresh list/);
  const invalid = structuredClone(saved);
  invalid.entries[1].id = 1;
  await assert.rejects(fixture().list.restore(invalid), /invalid allocation type or identity/);
});
