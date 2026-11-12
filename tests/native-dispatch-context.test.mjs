// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDispatchContext } from '../src/native/dispatch-context.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
test('executor IDs are explicitly registered and capabilities are opaque', () => {
  const context = new NativeDispatchContext(),
    a = context.register('A');
  assert.equal(context.executor('A'), a);
  assert.deepEqual(Object.keys(a), []);
  assert.throws(() => context.register('A'), /already exists/);
  assert.throws(() => context.executor('sender:42'), /Unknown logical executor/);
  assert.throws(() => context.run('A', () => {}), /capability/);
  assert.throws(() => context.run(structuredClone(a), () => {}), /capability/);
  assert.throws(() => context.executorID(), /live explicit/);
});
test('sync nested A/B/reentry uses only the explicit entries', () => {
  const c = new NativeDispatchContext(),
    a = c.register('A'),
    b = c.register('B'),
    seen = [];
  let old;
  c.run(a, (ea) => {
    old = ea;
    seen.push(c.executorID(ea));
    c.run(b, (eb) => {
      seen.push(c.executorID(eb));
      c.reenter(ea, (child) => seen.push(c.executorID(child)));
      seen.push(c.executorID(eb));
    });
    seen.push(c.executorID(ea));
  });
  assert.deepEqual(seen, ['A', 'B', 'A', 'B', 'A']);
  assert.throws(() => c.executorID(old), /live explicit/);
  c.assertSettled();
});
test('independent awaits retain A and B without an ambient current variable', async () => {
  const c = new NativeDispatchContext(),
    a = c.register('A'),
    b = c.register('B');
  const ga = deferred(),
    gb = deferred(),
    seen = [];
  let ea, eb;
  const pa = c.run(a, async (entry) => {
    ea = entry;
    seen.push(c.executorID(entry));
    await ga.promise;
    seen.push(c.executorID(entry));
    await Promise.resolve();
    seen.push(c.executorID(entry));
  });
  const pb = c.run(b, async (entry) => {
    eb = entry;
    seen.push(c.executorID(entry));
    await gb.promise;
    seen.push(c.executorID(entry));
  });
  assert.throws(() => c.assertSettled(), /settle/);
  assert.throws(() => c.executorID(), /live explicit/);
  gb.resolve();
  await pb;
  assert.throws(() => c.executorID(eb), /live explicit/);
  assert.equal(c.executorID(ea), 'A');
  ga.resolve();
  await pa;
  assert.deepEqual(seen, ['A', 'B', 'B', 'A', 'A']);
  c.assertSettled();
});
test('entry closes after synchronous exception', () => {
  const c = new NativeDispatchContext(),
    a = c.register('A');
  let saved;
  assert.throws(
    () =>
      c.run(a, (e) => {
        saved = e;
        throw Error('sync failure');
      }),
    /sync failure/,
  );
  assert.throws(() => c.executorID(saved), /live explicit/);
  c.assertSettled();
});
test('entry closes after rejection and a rejecting reentry preserves its parent', async () => {
  const c = new NativeDispatchContext(),
    a = c.register('A');
  let old;
  await c.run(a, async (parent) => {
    await assert.rejects(
      c.reenter(parent, async (child) => {
        old = child;
        await Promise.resolve();
        throw Error('child failure');
      }),
      /child failure/,
    );
    assert.throws(() => c.executorID(old), /live explicit/);
    assert.equal(c.executorID(parent), 'A');
  });
  c.assertSettled();
});
test('then getter failure closes its entry', () => {
  const c = new NativeDispatchContext(),
    a = c.register('A');
  let old;
  assert.throws(
    () =>
      c.run(a, (e) => {
        old = e;
        return {
          get then() {
            throw Error('then failure');
          },
        };
      }),
    /then failure/,
  );
  assert.throws(() => c.executorID(old), /live explicit/);
  c.assertSettled();
});
test('foreign World capabilities and entries cannot impersonate a caller', () => {
  const a = new NativeDispatchContext(),
    b = new NativeDispatchContext();
  const ha = a.register('same'),
    hb = b.register('same');
  assert.throws(() => a.run(hb, () => {}), /capability/);
  b.run(hb, (entry) => assert.throws(() => a.executorID(entry), /live explicit/));
  a.run(ha, (entry) => assert.equal(a.executorID(entry), 'same'));
});
test('identity views may reset only while settled and old capabilities stay invalid', async () => {
  const c = new NativeDispatchContext(),
    old = c.register('A'),
    gate = deferred();
  const pending = c.run(old, async () => gate.promise);
  assert.throws(() => c.replaceExecutors(['A']), /settle/);
  assert.throws(() => c.close(), /settle/);
  gate.resolve();
  await pending;
  c.replaceExecutors(['A', 'B']);
  assert.throws(() => c.run(old, () => {}), /capability/);
  c.run(c.executor('A'), (e) => assert.equal(c.executorID(e), 'A'));
  c.close();
  assert.throws(() => c.executor('A'), /closed/);
});
