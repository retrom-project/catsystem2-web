// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { readEffekseerEffect } from '../src/effekseer/effect-reader.mjs';
import { authoredEffect } from './fixtures/effekseer/authored-effect.mjs';
import { LogicalCRTThreads } from '../src/effekseer/crt-threads.mjs';
import { EffekseerManagerLifecycle } from '../src/effekseer/manager-lifecycle.mjs';

// These callbacks deliberately trace the lifecycle seam. They do not stand in
// for the yet separate full motion/color/matrix adapter or claim rendering.
function setup({ capacity = 2000, options = {}, groupRandom = false, fail = false } = {}) {
  const effect = readEffekseerEffect(authoredEffect(options)),
    assets = new Map([[1, { id: 1, effect, references: 1 }]]),
    calls = [],
    threads = new LogicalCRTThreads();
  threads.create('frame');
  threads.create('forced');
  const resources = {
      get(id) {
        const asset = assets.get(id);
        if (!asset || asset.references < 1) throw new Error('Unknown test asset');
        return asset;
      },
      retain(id) {
        this.get(id).references++;
      },
      release(id) {
        this.get(id).references--;
      },
    },
    operations = {
      initializeGroup({ node, random }) {
        calls.push(['group', node.id, random.calls]);
        return { marker: groupRandom && node.id !== effect.root ? random.nextInt() : null };
      },
      initializeInstance({ node, instance, random }) {
        calls.push(['instance', node.id, random.calls]);
        if (fail) throw new Error('Unimplemented test parameter');
        return { marker: instance.number, calculatedAges: [] };
      },
      calculateInstance({ instance }) {
        calls.push(['calculate', instance.id, instance.age]);
        instance.values.calculatedAges.push(instance.age);
      },
    },
    manager = new EffekseerManagerLifecycle({
      resources,
      threads,
      instanceOperations: operations,
      capacity,
    });
  return { manager, resources, threads, calls, operations, asset: assets.get(1) };
}
const particles = (manager) =>
  [...manager.instances.values()].filter((instance) => instance.slot !== null);

test('manager requires explicit parameter operations and caller thread registration', () => {
  assert.throws(() => new EffekseerManagerLifecycle(), /required/);
  const s = setup();
  assert.throws(() => s.manager.play(1, [0, 0, 0], 'unknown'), /Unregistered/);
  assert.equal(s.manager.sets.size, 0);
  assert.equal(s.asset.references, 1);
  assert.equal(s.manager.play(null, [0, 0, 0], 'frame'), -1);
});
test('each Play owns a root outside the particle capacity and retains its own Effect', () => {
  const s = setup({ capacity: 1 });
  assert.deepEqual(
    [0, 1, 2].map(() => s.manager.play(1, [1, 2, 3], 'frame')),
    [0, 1, 2],
  );
  assert.equal(s.manager.instances.size, 3);
  assert.equal(s.manager.freeSlots.length, 1);
  assert.equal(s.asset.references, 4);
  assert.equal(s.threads.forThread('frame').calls, 3);
  for (const set of s.manager.sets.values())
    assert.deepEqual([...s.manager.root(set).matrix.slice(9)], [1, 2, 3]);
  s.manager.close();
  assert.equal(s.asset.references, 1);
});
test('constructor group sampling precedes child offset and lifetime sampling', () => {
  const s = setup({ groupRandom: true });
  s.manager.play(1, [0, 0, 0], 'frame');
  assert.deepEqual(s.calls.slice(0, 2), [
    ['group', 0, 0],
    ['group', 1, 0],
  ]);
  assert.equal(s.threads.forThread('frame').calls, 2);
  s.manager.update('frame');
  s.manager.update('frame');
  assert.ok(s.calls.some((call) => call[0] === 'instance' && call[2] === 3));
  assert.equal(s.threads.forThread('frame').calls, 4);
  s.manager.close();
});
test('first Update arms time; births use strict boundaries and newly born children update in the same pass', () => {
  const s = setup(),
    handle = s.manager.play(1, [0, 0, 0], 'frame');
  s.manager.update('frame');
  assert.equal(particles(s.manager).length, 0);
  assert.equal(s.manager.root(s.manager.sets.get(handle)).age, 0);
  s.manager.update('frame');
  assert.equal(particles(s.manager).length, 1);
  assert.equal(particles(s.manager)[0].age, 0);
  assert.equal(particles(s.manager)[0].stepTime, true);
  s.manager.update('frame');
  assert.equal(particles(s.manager).length, 1);
  s.manager.update('frame');
  assert.equal(particles(s.manager).length, 2);
  s.manager.update('frame');
  s.manager.update('frame');
  assert.equal(particles(s.manager).length, 3);
  assert.equal(s.threads.forThread('frame').calls, 7);
  s.manager.close();
});
test('full pool defers a birth without sampling life/interval, and freed slots return FIFO after two removal phases', () => {
  const s = setup({ capacity: 2, options: { life: [0, 0], interval: 0 } });
  // A future possible offset keeps the source's root-only expiry estimate
  // from collecting this deliberately pool-starved retry case.
  s.asset.effect.nodes[1].common.generationOffset.max = 100;
  const handle = s.manager.play(1, [0, 0, 0], 'frame');
  s.manager.update('frame');
  s.manager.update('frame');
  assert.deepEqual(
    particles(s.manager).map((i) => i.slot),
    [0, 1],
  );
  assert.equal(s.threads.forThread('frame').calls, 5);
  assert.equal(s.manager.root(s.manager.sets.get(handle)).generated[0], 2);
  for (let i = 0; i < 3; i++) s.manager.update('frame');
  assert.equal(s.threads.forThread('frame').calls, 5);
  assert.deepEqual(s.manager.freeSlots, [0, 1]);
  s.manager.update('frame');
  assert.deepEqual(
    particles(s.manager).map((i) => i.slot),
    [0],
  );
  assert.deepEqual(s.manager.freeSlots, [1]);
  assert.equal(s.threads.forThread('frame').calls, 7);
  s.manager.close();
});
test('Stop flags only its handle, then keeps references through the double drawset GC delay', () => {
  const s = setup(),
    a = s.manager.play(1, [0, 0, 0], 'frame'),
    b = s.manager.play(1, [0, 0, 0], 'frame');
  s.manager.update('frame');
  s.manager.update('frame');
  s.manager.stop(b);
  assert.equal(s.manager.exists(a), true);
  assert.equal(s.manager.exists(b), false);
  assert.equal(s.asset.references, 3);
  s.manager.update('frame');
  assert.equal(s.manager.removing[0].has(b), true);
  assert.equal(s.asset.references, 3);
  s.manager.update('frame');
  assert.equal(s.manager.removing[1].has(b), true);
  assert.equal(s.asset.references, 3);
  s.manager.update('frame');
  assert.equal(s.asset.references, 2);
  s.manager.close();
  s.manager.close();
  assert.equal(s.asset.references, 1);
  assert.equal(s.manager.instances.size, 0);
  assert.equal(s.manager.groups.size, 0);
});
test('pause and shown flags preserve independent source update behavior', () => {
  const s = setup(),
    handle = s.manager.play(1, [0, 0, 0], 'frame'),
    set = s.manager.sets.get(handle);
  set.paused = true;
  s.manager.update('frame');
  assert.equal(s.manager.root(set).stepTime, false);
  assert.equal(set.global.updatedFrame, 0);
  set.paused = false;
  set.shown = false;
  s.manager.update('frame');
  s.manager.update('frame');
  assert.equal(particles(s.manager).length, 1);
  assert.equal(set.global.updatedFrame, 2);
  let drawn = 0;
  s.manager.draw({ instance: () => drawn++ });
  assert.equal(drawn, 0);
  s.manager.close();
});
test('draw-only visits are read-only for age, births, counters and sampled state', () => {
  const s = setup();
  s.manager.play(1, [0, 0, 0], 'frame');
  s.manager.update('frame');
  s.manager.update('frame');
  const before = s.manager.snapshot(),
    random = s.threads.snapshot(),
    visits = [];
  s.manager.draw({ instance: ({ node, group }) => visits.push([node.type, group.active.length]) });
  s.manager.draw({ instance: ({ node, group }) => visits.push([node.type, group.active.length]) });
  assert.deepEqual(visits, [
    ['sprite', 1],
    ['sprite', 1],
  ]);
  assert.deepEqual(s.manager.snapshot(), before);
  assert.deepEqual(s.threads.snapshot(), random);
  s.manager.close();
});
test('forced Play and ordinary Update use the caller-selected streams, not a manager-private seed', () => {
  const s = setup();
  s.manager.play(1, [0, 0, 0], 'forced');
  s.manager.update('frame');
  s.manager.update('frame');
  assert.equal(s.threads.forThread('forced').calls, 1);
  assert.equal(s.threads.forThread('frame').calls, 2);
  assert.equal(s.threads.forThread('frame').seedCalls, 0);
  s.manager.close();
});
test('unimplemented parameter errors poison the partial manager and remain visible until cleanup', () => {
  const s = setup({ fail: true });
  s.manager.play(1, [0, 0, 0], 'frame');
  s.manager.update('frame');
  assert.throws(() => s.manager.update('frame'), /Unimplemented test parameter/);
  assert.throws(() => s.manager.snapshot(), /incomplete failed operation/);
  s.manager.close();
  assert.equal(s.asset.references, 1);
  assert.equal(s.manager.instances.size, 0);
});
test('source root-only expiry uses its last-birth estimate even after pool starvation', () => {
  const s = setup({ capacity: 1, options: { life: [0, 0], interval: 0 } });
  const handle = s.manager.play(1, [0, 0, 0], 'frame');
  for (let i = 0; i < 6; i++) s.manager.update('frame');
  assert.equal(s.manager.exists(handle), false);
  assert.equal(s.manager.removing[0].has(handle), true);
  assert.equal(s.threads.forThread('frame').calls, 3);
  s.manager.close();
});
test('paused draw refreshes stale matrix/color caches with zero delta and no time/random advance', () => {
  const s = setup(),
    handle = s.manager.play(1, [0, 0, 0], 'frame');
  s.manager.update('frame');
  s.manager.update('frame');
  const instance = particles(s.manager)[0],
    age = instance.age,
    evaluations = instance.values.calculatedAges.length,
    random = s.threads.snapshot();
  s.manager.sets.get(handle).paused = true;
  s.manager.update('frame');
  assert.notEqual(instance.sequence, s.manager.sequence);
  s.manager.draw({ instance() {} });
  assert.equal(instance.sequence, s.manager.sequence);
  assert.equal(instance.age, age);
  assert.equal(instance.values.calculatedAges.length, evaluations + 1);
  assert.deepEqual(s.threads.snapshot(), random);
  s.manager.close();
});
test('exported checkpoint fresh restore adopts current graph, pending stops and aggregate references without initialization or replay', async () => {
  const before = setup(),
    a = before.manager.play(1, [-0, 2, 3], 'forced'),
    b = before.manager.play(1, [4, 5, 6], 'frame');
  before.manager.update('frame');
  before.manager.update('frame');
  before.manager.stop(b);
  before.manager.update('frame');
  const checkpoint = await deserializeCheckpoint(
      await serializeCheckpoint(before.manager.snapshot()),
    ),
    savedThreads = before.threads.snapshot(),
    after = setup(),
    restoredThreads = new LogicalCRTThreads();
  restoredThreads.restore(savedThreads);
  after.manager.threads = restoredThreads;
  after.asset.references = before.asset.references; // E1 aggregate owner restore precedes this component.
  after.manager.restore(checkpoint);
  assert.equal(after.calls.length, 0);
  assert.equal(after.asset.references, before.asset.references);
  assert.deepEqual(after.manager.snapshot(), checkpoint);
  assert.deepEqual(restoredThreads.snapshot(), savedThreads);
  assert.equal(Object.is(after.manager.root(after.manager.sets.get(a)).matrix[9], -0), true);
  for (let i = 0; i < 15; i++) {
    before.manager.update('frame');
    after.manager.update('frame');
    const left = [],
      right = [];
    before.manager.draw({ instance: ({ instance }) => left.push([instance.id, instance.age]) });
    after.manager.draw({ instance: ({ instance }) => right.push([instance.id, instance.age]) });
    assert.deepEqual(right, left);
    assert.deepEqual(after.manager.snapshot(), before.manager.snapshot());
    assert.deepEqual(restoredThreads.snapshot(), before.threads.snapshot());
    assert.equal(after.asset.references, before.asset.references);
  }
  before.manager.close();
  after.manager.close();
  assert.equal(after.asset.references, 1);
});
test('invalid graph restore leaves a fresh owner unchanged and never draws random values', () => {
  const before = setup();
  before.manager.play(1, [0, 0, 0], 'frame');
  before.manager.update('frame');
  before.manager.update('frame');
  const checkpoint = before.manager.snapshot();
  for (const alter of [
    (s) => {
      s.freeSlots[1] = s.freeSlots[0];
    },
    (s) => {
      s.sets[0].global.count++;
    },
    (s) => {
      s.instances[0].childGroups[0] = -1;
    },
    (s) => {
      s.rendering[0].handle = 999;
    },
  ]) {
    const changed = structuredClone(checkpoint);
    alter(changed);
    const after = setup(),
      clean = after.manager.snapshot(),
      random = after.threads.snapshot();
    after.asset.references = before.asset.references;
    assert.throws(() => after.manager.restore(changed), /Invalid Effekseer/);
    assert.deepEqual(after.manager.snapshot(), clean);
    assert.deepEqual(after.threads.snapshot(), random);
    assert.equal(after.calls.length, 0);
  }
  before.manager.close();
});
