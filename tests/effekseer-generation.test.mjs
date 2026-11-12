// SPDX-License-Identifier: MPL-2.0
// Pure JS generation checks and fixed public-source numerical references.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nodeTest from 'node:test';
import * as g from '../src/effekseer/generation.mjs';
import { floatBits, identity43, transformVector43 } from '../src/effekseer/math43.mjs';

const test = (name, run) => nodeTest(name, run);
function rng(sequence) {
  return {
    sequence,
    index: 0,
    nextInt() {
      assert.ok(this.index < this.sequence.length, 'extra random draw');
      return this.sequence[this.index++];
    },
  };
}
function crt(seed = 1) {
  return {
    state: seed >>> 0,
    count: 0,
    nextInt() {
      this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
      this.count++;
      return (this.state >>> 16) & 32767;
    },
  };
}
const range = (min, max = min) => ({ min, max });
const point = (extra = {}) => ({
  type: 'point',
  effectsRotation: false,
  location: { min: [7, 11, -13], max: [7, 11, -13] },
  ...extra,
});
const sphere = (extra = {}) => ({
  type: 'sphere',
  effectsRotation: false,
  radius: range(7),
  rotationX: range(0),
  rotationY: range(0),
  ...extra,
});
const circle = (extra = {}) => ({
  type: 'circle',
  effectsRotation: false,
  division: 4,
  radius: range(7),
  angleStart: range(0),
  angleEnd: range(4),
  mode: 1,
  ...extra,
});
const model = (extra = {}) => ({
  type: 'model',
  effectsRotation: false,
  index: 0,
  mode: 0,
  ...extra,
});
const matrixBits = (state) => state.matrix.map(floatBits);

test('point XYZ draws preserve exact component order and nonzero translation', () => {
  const p = point({ location: { min: [0, 0, 0], max: [32767, 32767, 32767] } });
  const r = rng([1, 2, 3]),
    state = g.initializeGeneration(p, 0, r);
  assert.deepEqual(state.position, [1, 2, 3]);
  assert.deepEqual(state.matrix.slice(9), [1, 2, 3]);
  assert.equal(r.index, 3);
});
test('fixed nonzero point ranges still consume XYZ draws', () => {
  const r = rng([5, 6, 7]),
    state = g.initializeGeneration(point(), 0, r);
  assert.deepEqual(state.position, [7, 11, -13]);
  assert.deepEqual(state.matrix.slice(9), [7, 11, -13]);
  assert.equal(r.index, 3);
});
test('zero point ranges still consume all three draws', () => {
  const r = rng([5, 6, 7]);
  g.initializeGeneration(point({ location: { min: [0, 0, 0], max: [0, 0, 0] } }), 0, r);
  assert.equal(r.index, 3);
});
test('sphere draws X then Y then radius regardless of reader property order', () => {
  const p = sphere({
    radius: range(0, 32767),
    rotationX: range(0, 32767),
    rotationY: range(0, 32767),
  });
  const r = rng([1, 2, 3]),
    state = g.initializeGeneration(p, 0, r);
  assert.equal(state.rotationX, 1);
  assert.equal(state.rotationY, 2);
  assert.equal(state.radius, 3);
  assert.equal(r.index, 3);
  assert.ok(state.matrix.slice(9).some((v) => v !== 0));
});
test('zero-angle nonzero sphere places its radius on Y', () => {
  const r = rng([1, 2, 3]),
    state = g.initializeGeneration(sphere(), 0, r);
  assert.deepEqual(state.matrix.slice(9), [0, 7, 0]);
  assert.equal(r.index, 3);
});
test('effectsRotation flag preserves full sampled generation matrix', () => {
  const p = sphere({ rotationX: range(0.7), rotationY: range(-0.3) });
  const a = g.initializeGeneration(p, 0, rng([1, 2, 3]));
  const b = g.initializeGeneration({ ...p, effectsRotation: true }, 0, rng([1, 2, 3]));
  assert.deepEqual(matrixBits(a), matrixBits(b));
  assert.equal(a.effectsRotation, false);
  assert.equal(b.effectsRotation, true);
});
test('circle numeric modes are random0/order1/reverse2', () => {
  const order = g.initializeGeneration(circle(), 5, rng([1, 2, 3]));
  const reverse = g.initializeGeneration(circle({ mode: 2 }), 5, rng([1, 2, 3]));
  const random = g.initializeGeneration(circle({ mode: 0 }), 5, rng([1, 2, 3, 0]));
  assert.equal(order.target, 1);
  assert.equal(reverse.target, 2);
  assert.equal(random.target, 0);
  assert.equal(order.angle, 1);
  assert.equal(reverse.angle, 2);
  assert.equal(random.angle, 0);
});
test('ordered circle wraps instance number and consumes only radius/start/end', () => {
  const r = rng([1, 2, 3]),
    state = g.initializeGeneration(circle(), 8, r);
  assert.equal(state.target, 0);
  assert.equal(state.angle, 0);
  assert.deepEqual(state.matrix.slice(9), [0, 7, 0]);
  assert.equal(r.index, 3);
});
test('circle random consumes radius/start/end then optional fourth selection', () => {
  const p = circle({
    mode: 0,
    radius: range(0, 32767),
    angleStart: range(0, 32767),
    angleEnd: range(0, 32767),
  });
  const r = rng([1, 2, 3, 16384]),
    state = g.initializeGeneration(p, 9, r);
  assert.equal(state.radius, 1);
  assert.equal(state.angleStart, 2);
  assert.equal(state.angleEnd, 3);
  assert.equal(state.target, 2);
  assert.equal(state.angle, 2.5);
  assert.equal(r.index, 4);
});
test('native-confirmed random upper endpoint decrements division not target', () => {
  const r = rng([1, 2, 3, 32767]),
    state = g.initializeGeneration(circle({ mode: 0 }), 0, r);
  assert.equal(state.target, 4);
  assert.equal(state.divisionClamped, 4);
  assert.equal(state.divisionUsed, 3);
  assert.equal(state.randomDraws, 4);
  assert.equal(r.index, 4);
  assert.ok(state.angle > 4);
  assert.ok(state.matrix.slice(9).some((v) => v !== 0));
});
test('circle divisions below one use source clamp before selection', () => {
  for (const division of [-7, 0, 1]) {
    const state = g.initializeGeneration(circle({ division }), 17, rng([1, 2, 3]));
    assert.equal(state.divisionClamped, 1);
    assert.equal(state.target, 0);
    assert.equal(state.divisionUsed, 1);
  }
});
test('random upper endpoint at division one errors after all four draws', () => {
  for (const division of [-7, 0, 1]) {
    const r = rng([1, 2, 3, 32767]);
    assert.throws(
      () => g.initializeGeneration(circle({ mode: 0, division }), 0, r),
      (e) => {
        assert.ok(e instanceof g.EffekseerGenerationError);
        assert.match(e.message, /endpoint branch.*1 to 0/);
        assert.equal(e.sampledState.target, 1);
        assert.equal(e.sampledState.divisionUsed, 0);
        assert.equal(e.sampledState.randomDraws, 4);
        return true;
      },
    );
    assert.equal(r.index, 4);
  }
});
test('division one random below upper endpoint remains finite and nonempty', () => {
  const r = rng([1, 2, 3, 32766]),
    state = g.initializeGeneration(circle({ mode: 0, division: 1 }), 0, r);
  assert.equal(state.target, 0);
  assert.equal(state.divisionUsed, 1);
  assert.deepEqual(state.matrix.slice(9), [0, 7, 0]);
  assert.equal(r.index, 4);
});
test('random selection float-to-int overflow errors after its actual draw', () => {
  const r = rng([1, 2, 3, 32767]);
  assert.throws(
    () => g.initializeGeneration(circle({ mode: 0, division: 2147483647 }), 0, r),
    /float-to-int/,
  );
  assert.equal(r.index, 4);
});
test('all five null-model generation modes preserve identity with zero draws', () => {
  for (let mode = 0; mode < 5; mode++) {
    const r = rng([]),
      state = g.initializeGeneration(model({ mode }), 0, r);
    assert.deepEqual(state.matrix, Array.from(identity43()));
    assert.equal(state.modelUnavailable, 'null-model');
    assert.equal(state.randomDraws, 0);
    assert.equal(r.index, 0);
  }
});
test('negative model index takes identity branch without model service use', () => {
  const r = rng([]),
    state = g.initializeGeneration(model({ index: -1 }), 0, r, { model: { mustNotBeUsed: true } });
  assert.equal(state.modelUnavailable, 'negative-index');
  assert.deepEqual(state.matrix, Array.from(identity43()));
  assert.equal(r.index, 0);
});
test('actual non-null model emission throws rather than masquerading as identity', () => {
  assert.throws(
    () => g.initializeGeneration(model(), 0, rng([]), { model: {} }),
    /non-null model emission is unimplemented/,
  );
});
test('null-model transform preserves a visible nonzero child point', () => {
  const nullModel = g.initializeGeneration(model(), 0, rng([]));
  const child = g.initializeGeneration(point(), 0, rng([1, 2, 3]));
  assert.deepEqual(Array.from(transformVector43(child.position, nullModel.matrix)), [7, 11, -13]);
});
test('unknown generation and operation names explicitly throw', () => {
  assert.throws(
    () => g.initializeGeneration({ type: 'future', effectsRotation: true }, 0, rng([])),
    /unimplemented type/,
  );
  assert.throws(
    () => g.initializeGeneration(circle({ mode: 3 }), 0, rng([])),
    /unimplemented operation/,
  );
  assert.throws(
    () => g.initializeGeneration(model({ mode: 5 }), 0, rng([])),
    /unimplemented operation/,
  );
});
test('caller supplies reader boolean and signed int32 fields', () => {
  assert.throws(() => g.initializeGeneration(point({ effectsRotation: 1 }), 0, rng([])), /boolean/);
  assert.throws(() => g.initializeGeneration(point(), 2147483648, rng([])), /signed int32/);
  assert.throws(
    () => g.initializeGeneration(circle({ division: 1.5 }), 0, rng([])),
    /signed int32/,
  );
});
test('one shared CRT stream crosses independent generation owners exactly', () => {
  const shared = crt(1),
    scratch = g.createGenerationScratch();
  const managerA = g.initializeGeneration(point(), 0, shared, { scratch });
  const managerB = g.initializeGeneration(circle({ mode: 0 }), 0, shared, { scratch });
  const secondA = g.initializeGeneration(sphere({ rotationX: range(0.7) }), 1, shared, { scratch });
  g.initializeGeneration(model(), 0, shared, { scratch });
  assert.equal(managerA.randomDraws + managerB.randomDraws + secondA.randomDraws, 10);
  assert.equal(shared.count, 10);
  assert.equal(shared.state, 3750785579);
  assert.equal(shared.nextInt(), 5705);
  assert.equal(shared.state, 373929026);
});
test('snapshot and fresh restore need no RNG and do not recompute cached matrix', () => {
  const r = rng([1, 2, 3]),
    state = g.initializeGeneration(
      sphere({ rotationX: range(0.7), rotationY: range(-0.3), effectsRotation: true }),
      5,
      r,
    );
  const snapshot = JSON.parse(JSON.stringify(g.snapshotGeneration(state))),
    restored = g.restoreGeneration(snapshot);
  assert.deepEqual(matrixBits(restored), matrixBits(state));
  assert.equal(restored.radius, state.radius);
  assert.equal(r.index, 3);
  assert.notEqual(restored.matrix, state.matrix);
  assert.notEqual(restored, state);
});
test('plain JSON snapshot preserves signed-zero matrix and sample bits', () => {
  const state = g.initializeGeneration(sphere(), 0, rng([1, 2, 3]));
  state.matrix[1] = -0;
  state.rotationX = -0;
  const restored = g.restoreGeneration(JSON.parse(JSON.stringify(g.snapshotGeneration(state))));
  assert.ok(Object.is(restored.matrix[1], -0));
  assert.ok(Object.is(restored.rotationX, -0));
});
test('all generation types round-trip explicit state and selection', () => {
  for (const state of [
    g.initializeGeneration(point(), 2, rng([1, 2, 3])),
    g.initializeGeneration(sphere(), 2, rng([1, 2, 3])),
    g.initializeGeneration(circle({ mode: 0 }), 2, rng([1, 2, 3, 32767])),
    g.initializeGeneration(model({ index: -1, mode: 4 }), 2, rng([])),
  ]) {
    const restored = g.restoreGeneration(JSON.parse(JSON.stringify(g.snapshotGeneration(state))));
    assert.deepEqual(g.snapshotGeneration(restored), g.snapshotGeneration(state));
  }
});
test('snapshot nonfinite float bits and unknown saved structure are errors', () => {
  const state = g.initializeGeneration(point(), 0, rng([1, 2, 3]));
  const badFloat = g.snapshotGeneration(state);
  badFloat.matrixBits[0] = 0x7f800000;
  assert.throws(() => g.restoreGeneration(badFloat), /nonfinite/);
  const unknown = g.snapshotGeneration(state);
  unknown.floatBitsByName.extra = 0;
  assert.throws(() => g.restoreGeneration(unknown), /unimplemented or missing/);
  const extraRoot = g.snapshotGeneration(state);
  extraRoot.legacy = true;
  assert.throws(() => g.restoreGeneration(extraRoot), /unimplemented or missing/);
});
test('invalid restored circle endpoint selection cannot hide zero denominator', () => {
  const snapshot = g.snapshotGeneration(
    g.initializeGeneration(circle({ mode: 0 }), 0, rng([1, 2, 3, 0])),
  );
  snapshot.selection.division = 1;
  snapshot.selection.divisionClamped = 1;
  snapshot.selection.target = 1;
  snapshot.selection.divisionUsed = 0;
  assert.throws(() => g.restoreGeneration(snapshot), /endpoint branch/);
});
test('reused scratch does not mutate already stored generation states', () => {
  const scratch = g.createGenerationScratch(),
    state = g.initializeGeneration(point(), 0, rng([1, 2, 3]), { scratch });
  const before = matrixBits(state);
  g.initializeGeneration(sphere({ rotationX: range(0.7) }), 1, rng([1, 2, 3]), { scratch });
  assert.deepEqual(matrixBits(state), before);
  const out = new Float32Array(12);
  assert.equal(g.copyGenerationMatrix(state, out), out);
  assert.deepEqual(Array.from(out), state.matrix);
});
test('overlapping scratch buffers are rejected before random consumption', () => {
  const scratch = g.createGenerationScratch();
  scratch.b = scratch.a;
  const r = rng([]);
  assert.throws(() => g.initializeGeneration(point(), 0, r, { scratch }), /overlapping/);
  assert.equal(r.index, 0);
});

const reference = JSON.parse(
  readFileSync(new URL('./fixtures/effekseer/generation-reference.json', import.meta.url), 'utf8'),
);
const sourceCases = new Map([
  ['point', [point({ location: { min: [1, -2, 3], max: [5, 6, 11] } }), 0, [0, 32767, 16384]]],
  [
    'sphere',
    [
      sphere({ radius: range(2, 7), rotationX: range(-1, 1), rotationY: range(-0.25, 0.75) }),
      5,
      [1, 16384, 32767],
    ],
  ],
  ['circle-order', [circle({ angleStart: range(0.3), angleEnd: range(2.5) }), 5, [1, 2, 3]]],
  [
    'circle-reverse',
    [circle({ mode: 2, angleStart: range(0.3), angleEnd: range(2.5) }), 5, [1, 2, 3]],
  ],
  [
    'circle-random-zero',
    [circle({ mode: 0, angleStart: range(0.3), angleEnd: range(2.5) }), 5, [1, 2, 3, 0]],
  ],
  [
    'circle-random-middle',
    [circle({ mode: 0, angleStart: range(0.3), angleEnd: range(2.5) }), 5, [1, 2, 3, 16384]],
  ],
  [
    'circle-random-max-div-decrement',
    [circle({ mode: 0, angleStart: range(0.3), angleEnd: range(2.5) }), 5, [1, 2, 3, 32767]],
  ],
  [
    'circle-clamp-negative-division',
    [circle({ division: -8, angleStart: range(0.3), angleEnd: range(2.5) }), 10, [1, 2, 3]],
  ],
  ['model-null-random', [model({ mode: 0 }), 17, []]],
  ['model-null-vertex', [model({ mode: 1 }), 17, []]],
  ['model-null-vertex-random', [model({ mode: 2 }), 17, []]],
  ['model-null-face', [model({ mode: 3 }), 17, []]],
  ['model-null-face-random', [model({ mode: 4 }), 17, []]],
  ['model-negative-index', [model({ index: -1, mode: 4 }), 17, []]],
]);
for (const expected of reference.cases) {
  test(
    `fixed public source reference ${expected.name}`,
    () => {
      assert.ok(sourceCases.has(expected.name));
      const [parameter, number, values] = sourceCases.get(expected.name),
        r = rng(values);
      const state = g.initializeGeneration(parameter, number, r);
      assert.deepEqual(matrixBits(state), expected.matrixBits);
      assert.equal(state.randomDraws, expected.draws);
      assert.equal(r.index, expected.draws);
    },
    'fixed-public-source-build-reference',
  );
}
assert.equal(reference.cases.length, sourceCases.size);
