// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FESObjectGraph, FES_LAST_OBJECT_HANDLE } from '../src/native/fes-object-graph.mjs';
import { FESMotionDriver, createFESMotionTarget } from '../src/native/fes-motion-driver.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const oracle = JSON.parse(
  await readFile(new URL('./fixtures/fes-motion-driver.json', import.meta.url), 'utf8'),
);
const shared = (offset) => [0x13, (0x80000000 + offset) >>> 0];
const programs = {
  'held.kcs': kcsProgram([[21, shared(28), shared(156)], [21, shared(140), shared(144)], [59]]),
  'random.kcs': kcsProgram([[43, 40, 0], [38, [3, 0x80000018]], [59]]),
};
function add(graph, key, fields = {}) {
  return graph.register({ handle: graph.allocateHandle(), key, ...fields });
}
function createObject(graph, name, x, y) {
  return add(graph, name, {
    nativeType: 1,
    x,
    y,
    imageOriginX: 0,
    imageOriginY: 0,
    baseX: 0,
    baseY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 255,
    pri: -1,
    displayValue: 0,
    displayDelta: 0,
    disp: false,
    motionDelay: 0,
  });
}
function fixture(profile, { records, graphState, randomState } = {}) {
  const random = new ParticleRandom(),
    game = memoryGame(programs);
  game.requireCategory = (name) => game.require(`${name}.kcs`);
  if (randomState) random.restore(randomState);
  const library = new MotionLibrary(game, { profile, random }),
    graph = new FESObjectGraph(records ? { ...graphState, objects: structuredClone(records) } : {});
  if (!records) {
    const root = createObject(graph, 'root', 11, 12),
      alpha = createObject(graph, 'alpha', 21, 22),
      beta = createObject(graph, 'beta', 31, 32);
    graph.bind(alpha, root);
    graph.bind(beta, root);
  }
  const objects = [...graph.records.values()],
    instance = { objects, byKey: new Map(objects.map((o) => [o.key, o])) },
    targets = new Map(),
    targetFor = (o, create) => {
      if (!targets.has(o.handle) && create)
        targets.set(o.handle, createFESMotionTarget(library, instance, o));
      return targets.get(o.handle);
    },
    driver = new FESMotionDriver(graph, targetFor);
  return {
    graph,
    instance,
    targets,
    targetFor,
    driver,
    random,
    objects,
    root: objects[0],
    alpha: objects[1],
    beta: objects[2],
  };
}
function state(f) {
  return f.objects.map((o) => ({
    name: o.key,
    x: o.x,
    y: o.y,
    displayValue: o.displayValue,
    displayDelta: o.displayDelta,
    delay: o.motionDelay >>> 0,
    recursiveBusy: f.driver.busy(o),
    managerBase: [...new Uint32Array(f.targetFor(o, true).manager.base.buffer)],
  }));
}

test('recursive FES snapshot gates, real MOT updates and root-only stop match both original engines', async () => {
  for (const profile of oracle.profiles) {
    const f = fixture(profile.profile);
    assert.deepEqual(
      f.graph.children(f.root).map((o) => o.key),
      profile.originalChildOrder,
    );
    assert.deepEqual(state(f), profile.stop.before);
    await f.driver.add(f.alpha, 'held', { registers: [7] });
    await f.driver.add(f.root, 'held', { registers: [99] });
    assert.deepEqual(state(f), profile.stop.prepared);
    f.root.motionDelay = 3;
    f.alpha.motionDelay = 7;
    f.driver.update(f.root, 10);
    assert.deepEqual(state(f), profile.stop.frame10);
    f.driver.update(f.root, 20);
    assert.deepEqual(state(f), profile.stop.frame20);
    f.driver.stop(f.root);
    assert.deepEqual(state(f), profile.stop.stopped);
    assert.equal(f.targetFor(f.root).busy(), false, 'only the root is unconditionally cleared');
    assert.equal(f.targetFor(f.alpha).busy(), true, 'a child script may deliberately ignore skip');
    f.driver.update(f.root, 21);
    assert.deepEqual(state(f), profile.stop.continued);
  }
});

test('original no-reuse child order preserves shared MOT RNG ownership and survives a fresh model', async () => {
  for (const profile of oracle.profiles) {
    const f = fixture(profile.profile, { randomState: profile.random.randomBefore });
    await f.driver.add(f.alpha, 'random');
    await f.driver.add(f.beta, 'random');
    f.driver.update(f.root, 10);
    assert.deepEqual(state(f), profile.random.after);
    assert.deepEqual(f.random.snapshot(), profile.random.randomAfter);
    f.alpha.x = 17; // Current commands remain separate from cached MOT output.
    const records = structuredClone(f.objects),
      graphState = f.graph.snapshot(),
      motions = [...f.targets].map(([handle, target]) => [handle, target.snapshot()]),
      fresh = fixture(profile.profile, { records, graphState, randomState: f.random.snapshot() });
    for (const [handle, snapshot] of motions)
      await fresh.driver.restore(fresh.graph.get(handle), snapshot);
    assert.equal(fresh.alpha.x, 17, 'restore must not replay working output');
    assert.deepEqual(
      fresh.graph.postorder(fresh.root).map((o) => o.handle),
      f.graph.postorder(f.root).map((o) => o.handle),
    );
    f.driver.update(f.root, 11);
    fresh.driver.update(fresh.root, 11);
    assert.deepEqual(fresh.objects, f.objects);
    assert.deepEqual(fresh.random.snapshot(), f.random.snapshot());
    assert.deepEqual(
      [...fresh.targets].map(([id, t]) => [id, t.snapshot()]),
      [...f.targets].map(([id, t]) => [id, t.snapshot()]),
    );
  }
});

test('semantic child handles remain ordered through delete/create, reparenting and restore', () => {
  const graph = new FESObjectGraph(),
    root = add(graph, 'root'),
    first = add(graph, 'zeta[9]'),
    second = add(graph, 'alpha[0]'),
    parent = add(graph, 'parent');
  graph.bind(first, root);
  graph.bind(second, root);
  const traversal = graph.postorder(root);
  assert.deepEqual(
    traversal.map((o) => o.key),
    ['zeta[9]', 'alpha[0]', 'root'],
  );
  assert.strictEqual(graph.postorder(root), traversal);
  graph.release(first);
  const replacement = add(graph, 'aaa[0]');
  graph.bind(replacement, root);
  assert.ok(replacement.handle > parent.handle, 'deleted handle is never reused');
  assert.deepEqual(
    graph.postorder(root).map((o) => o.key),
    ['alpha[0]', 'aaa[0]', 'root'],
  );
  const identity = second.handle;
  graph.bind(second, parent);
  assert.equal(second.handle, identity);
  assert.deepEqual(
    graph.children(root).map((o) => o.key),
    ['aaa[0]'],
  );
  assert.deepEqual(
    graph.children(parent).map((o) => o.key),
    ['alpha[0]'],
  );
  assert.throws(() => graph.bind(parent, second), /parent cycle/);
  assert.throws(() => graph.release(parent), /still owns lifetime children/);
  assert.throws(() => graph.register({ key: 'collision', handle: first.handle }), /not allocated/);
  const fresh = new FESObjectGraph({
    objects: structuredClone([...graph.records.values()]),
    ...graph.snapshot(),
  });
  assert.deepEqual(fresh.snapshot(), graph.snapshot());
  assert.deepEqual(
    fresh.postorder(fresh.get(parent.handle)).map((o) => o.key),
    ['alpha[0]', 'parent'],
  );
  assert.equal(fresh.get(first.handle), null);
});

test('handle exhaustion and invalid checkpoint identities fail before uint32 wrap or collisions', () => {
  const graph = new FESObjectGraph({ nextHandle: FES_LAST_OBJECT_HANDLE }),
    last = add(graph, 'last');
  assert.equal(last.handle, FES_LAST_OBJECT_HANDLE);
  assert.deepEqual(graph.snapshot(), { nextHandle: 0xffffffff });
  assert.throws(() => graph.allocateHandle(), /exhausted/);
  const fresh = new FESObjectGraph({ objects: [structuredClone(last)], ...graph.snapshot() });
  assert.throws(() => fresh.allocateHandle(), /exhausted/);
  for (const handle of [0, 0xffffffff, -1, 0x100000000, 1.5])
    assert.throws(
      () => new FESObjectGraph({ objects: [{ handle, key: 'invalid' }], nextHandle: 0xffffffff }),
      /handle/,
    );
  assert.throws(() => new FESObjectGraph({ nextHandle: 0x100000000 }), /range/);
  assert.throws(
    () => new FESObjectGraph({ objects: [last, last], nextHandle: 0xffffffff }),
    /duplicate/,
  );
});
