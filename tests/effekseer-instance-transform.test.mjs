// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readEffekseerEffect } from '../src/effekseer/effect-reader.mjs';
import { authoredEffect } from './fixtures/effekseer/authored-effect.mjs';
import { LogicalThreadCRT } from '../src/effekseer/crt-random.mjs';
import { identity43, scaling43 } from '../src/effekseer/math43.mjs';
import {
  initializeInstanceTransform,
  calculateInstanceTransform,
  createInstanceTransformScratch,
} from '../src/effekseer/instance-transform.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

function setup(options = {}) {
  const node = readEffekseerEffect(authoredEffect({ translation: 0, ...options })).nodes[1],
    parent = { matrix: identity43() },
    root = { matrix: identity43() },
    instance = { number: 0, age: 0, life: 8, matrix: identity43(), values: null },
    set = { global: { targetLocation: [0, 0, 0] } },
    random = new LogicalThreadCRT(),
    scratch = createInstanceTransformScratch();
  let updates = 0;
  const initialize = (initializeRendered = () => ({ current: [255, 64, 0, 255] })) => {
      instance.values = initializeInstanceTransform({
        node,
        instance,
        parent,
        random,
        scratch,
        initializeRendered,
      });
    },
    calculate = (delta = 1) =>
      calculateInstanceTransform({
        node,
        instance,
        parent,
        root,
        set,
        delta,
        scratch,
        updateRendered: () => {
          updates++;
        },
      });
  return {
    node,
    instance,
    parent,
    root,
    set,
    random,
    scratch,
    initialize,
    calculate,
    get updates() {
      return updates;
    },
  };
}
test('fixed local translation and Always parent translation compose actual nonzero positions', () => {
  const s = setup();
  s.parent.matrix.set([10, 20, 30], 9);
  s.initialize();
  s.calculate();
  assert.deepEqual([...s.instance.matrix.slice(9)], [11, 22, 33]);
  assert.equal(s.updates, 1);
  assert.equal(s.random.calls, 3);
});
test('NotBind, WhenCreating and Always translation have distinct current-state ownership', () => {
  for (const [bind, expected] of [
    [0, [1, 2, 3]],
    [1, [11, 22, 33]],
    [2, [101, 202, 303]],
  ]) {
    const s = setup();
    s.node.common.translationBind = bind;
    s.parent.matrix.set([10, 20, 30], 9);
    s.initialize();
    s.parent.matrix.set([100, 200, 300], 9);
    s.calculate();
    assert.deepEqual([...s.instance.matrix.slice(9)], expected);
  }
});
test('all root-bind components use the current root and reject an absent source root', () => {
  const s = setup();
  Object.assign(s.node.common, { translationBind: 3, rotationBind: 3, scalingBind: 3 });
  s.root.matrix.set([-10, -20, -30], 9);
  s.initialize();
  s.calculate();
  assert.deepEqual([...s.instance.matrix.slice(9)], [-9, -18, -27]);
  assert.throws(
    () =>
      calculateInstanceTransform({
        node: s.node,
        instance: s.instance,
        parent: s.parent,
        root: null,
        set: s.set,
        delta: 1,
        updateRendered() {},
      }),
    /source root instance is absent/,
  );
});
test('mixed bind captures scale once while current translation continues to update', () => {
  const s = setup();
  Object.assign(s.node.common, { translationBind: 2, rotationBind: 0, scalingBind: 1 });
  scaling43(2, 3, 4, s.parent.matrix);
  s.initialize();
  scaling43(7, 8, 9, s.parent.matrix);
  s.parent.matrix.set([100, 200, 300], 9);
  s.calculate();
  assert.deepEqual([s.instance.matrix[0], s.instance.matrix[4], s.instance.matrix[8]], [2, 3, 4]);
  assert.deepEqual([...s.instance.matrix.slice(9)], [102, 206, 312]);
});
test('motion, generation, sound-delay and rendered-state sampling preserve fixed-source order', () => {
  const s = setup({ translation: 1, rotation: 3, scaling: 3, withSound: true });
  let enteringRender;
  s.initialize(({ random }) => {
    enteringRender = random.calls;
    return { marker: random.nextInt() };
  });
  assert.equal(enteringRender, 22); // 9 translation, 6 axis, 3 scale, 3 point, 1 delay.
  assert.equal(s.random.calls, 23);
  assert.ok(s.instance.values.soundDelay >= 1 && s.instance.values.soundDelay <= 3);
  const before = s.random.snapshot();
  s.calculate();
  assert.deepEqual(s.random.snapshot(), before);
});
test('all implemented old motion alternatives produce finite matrices without draws during evaluation', () => {
  for (const [domain, type] of [
    ['translation', 0],
    ['translation', 1],
    ['translation', 2],
    ['translation', 3],
    ['rotation', 0],
    ['rotation', 1],
    ['rotation', 2],
    ['rotation', 3],
    ['rotation', 4],
    ['rotation', 5],
    ['scaling', 0],
    ['scaling', 1],
    ['scaling', 2],
    ['scaling', 3],
    ['scaling', 4],
    ['scaling', 5],
  ]) {
    const s = setup({ [domain]: type });
    s.initialize();
    s.instance.age = 1;
    const before = s.random.snapshot();
    s.calculate();
    assert.ok([...s.instance.matrix].every(Number.isFinite), `${domain}/${type}`);
    assert.deepEqual(s.random.snapshot(), before);
  }
});
test('cached generation matrix, rather than a regenerated emitter, drives later transforms', () => {
  const s = setup({ generation: 1 });
  s.node.translation = { type: 'none' };
  s.initialize();
  const cached = [...s.instance.values.generation.matrix];
  const before = s.random.snapshot();
  s.node.generation.radius = { min: 1e9, max: 1e9 };
  s.calculate();
  assert.ok(Math.abs(s.instance.matrix[9]) < 100);
  assert.deepEqual(s.random.snapshot(), before);
  assert.deepEqual([...s.instance.matrix.slice(9)], cached.slice(9));
  assert.deepEqual(s.instance.values.generation.matrix, cached);
});
test('gravity uses current living time and stores revision independently of raw global position', () => {
  const s = setup();
  s.node.translation = { type: 'none' };
  s.node.absolute = { type: 'gravity', value: new Float32Array([0, -2, 0]) };
  s.initialize();
  s.instance.age = 2;
  s.calculate();
  assert.deepEqual([...s.instance.matrix.slice(9)], [0, -4, 0]);
  assert.deepEqual([...s.instance.values.globalPosition], [0, 0, 0]);
  assert.deepEqual([...s.instance.values.revisionLocation], [0, -4, 0]);
});
test('attractive force retains current revision velocity/location between updates', () => {
  const s = setup();
  s.node.translation = { type: 'none' };
  s.parent.matrix[9] = 2;
  s.node.absolute = { type: 'attractive', values: new Float32Array([1, 1, 0, 0]) };
  s.initialize();
  s.calculate();
  assert.deepEqual([...s.instance.matrix.slice(9)], [1, 0, 0]);
  s.instance.age = 1;
  s.calculate();
  assert.deepEqual([...s.instance.matrix.slice(9)], [-1, 0, 0]);
  assert.deepEqual([...s.instance.values.globalPosition], [2, 0, 0]);
  assert.deepEqual([...s.instance.values.revisionVelocity], [-2, 0, 0]);
});
test('uncalibrated zero-speed force division and singular parent rotation fail explicitly', () => {
  const s = setup();
  s.node.translation = { type: 'none' };
  s.parent.matrix[9] = 2;
  s.node.absolute = { type: 'attractive', values: new Float32Array([0, 1, 0, 0]) };
  s.initialize();
  const random = s.random.snapshot();
  assert.throws(() => s.calculate(), /nonfinite instance transform/);
  assert.deepEqual(s.random.snapshot(), random);
  const singular = setup();
  singular.node.common.rotationBind = 1;
  singular.node.common.scalingBind = 0;
  scaling43(0, 1, 1, singular.parent.matrix);
  assert.throws(() => singular.initialize(), /zero-length row/);
});
test('current motion/force/rendered state survives exported checkpoint restoration without initialization or reseeding', async () => {
  const before = setup({ translation: 1, rotation: 3, scaling: 4, generation: 1 });
  before.initialize();
  before.instance.age = 2;
  before.calculate();
  const saved = await deserializeCheckpoint(await serializeCheckpoint(before.instance)),
    after = setup({ translation: 1, rotation: 3, scaling: 4, generation: 1 });
  Object.assign(after.instance, saved);
  after.random.restore(before.random.snapshot());
  const random = after.random.snapshot();
  before.instance.age = after.instance.age = 3;
  before.calculate();
  after.calculate();
  assert.deepEqual(after.instance.matrix, before.instance.matrix);
  assert.deepEqual(after.instance.values, before.instance.values);
  assert.deepEqual(after.random.snapshot(), random);
});
