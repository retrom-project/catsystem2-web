// SPDX-License-Identifier: MPL-2.0
// Pure JS unit checks and fixed public-source numerical references.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nodeTest from 'node:test';
import * as n from '../src/effekseer/numerical.mjs';
import * as m from '../src/effekseer/math43.mjs';

const test = (name, run) => nodeTest(name, run);
function rng(values) {
  return {
    values: [...values],
    index: 0,
    nextInt() {
      assert.ok(this.index < this.values.length, 'unexpected additional random draw');
      return this.values[this.index++];
    },
  };
}
const asArray = (value) => Array.from(value);
const bits = (values) => Array.from(values, m.floatBits);
const equalBits = (values, expected) => assert.deepEqual(bits(values), expected);
const range = (min, max = min) => ({ min, max });
const vectorRange = (min, max = min) => ({ min, max });
const constantColor = (rgba) => ({ type: 'fixed', value: rgba });
const randomColor = (min, max = min, mode = 0) => ({ type: 'random', min, max, mode });
function curve(overrides = {}) {
  return {
    edgeStart: 0,
    edgeEnd: 0,
    offsets: range(0),
    offset: 0,
    length: 8,
    frequency: 4,
    keys: [0, 40, 80],
    defaultValue: 0,
    ...overrides,
  };
}

test('fixed float random range still consumes one draw', () => {
  const r = rng([1234]);
  assert.equal(n.sampleFloat(range(7), r), 7);
  assert.equal(r.index, 1);
});
test('fixed integer random range still consumes one draw', () => {
  const r = rng([1234]);
  assert.equal(n.sampleInt(range(-7), r), -7);
  assert.equal(r.index, 1);
});
test('random integer truncates before adding negative minimum', () => {
  assert.equal(n.sampleInt(range(-5, -1), rng([16383])), -4);
});
test('random integer reversed interval preserves signed truncation', () => {
  assert.equal(n.sampleInt(range(10, -10), rng([16383])), 1);
});
test('integer subtraction overflow is explicitly unsupported', () => {
  const r = rng([]);
  assert.throws(() => n.sampleInt(range(-2147483648, 2147483647), r), n.EffekseerNumericError);
  assert.equal(r.index, 0);
});
test('integer float conversion overflow is explicitly unsupported after draw', () => {
  const r = rng([32767]);
  assert.throws(() => n.sampleInt(range(0, 2147483647), r), n.EffekseerNumericError);
  assert.equal(r.index, 1);
});
test('random vector consumes XYZ even for zero component ranges', () => {
  const r = rng([1, 2, 3]);
  assert.deepEqual(asArray(n.sampleVector(vectorRange([0, 0, 0]), r)), [0, 0, 0]);
  assert.equal(r.index, 3);
});
test('RNG rejects invalid results instead of clamping', () => {
  for (const v of [-1, 32768, 1.5, NaN])
    assert.throws(() => n.sampleFloat(range(0, 1), rng([v])), n.EffekseerNumericError);
});
test('PVA exact integer analytical values', () => {
  assert.equal(n.evaluatePva(3, 4, 2, 5), 48);
  assert.deepEqual(asArray(n.evaluatePva([3, -1], [4, 2], [2, -2], 5)), [48, -16]);
});
test('easing exact polynomial endpoints and midpoint, no time clamp', () => {
  for (const [t, v] of [
    [0, 2],
    [0.5, 5],
    [1, 8],
    [2, 14],
  ])
    assert.equal(n.evaluateEasing(2, 8, [0, 0, 1], t), v);
});
test('PVA init uses position then velocity then acceleration XYZ', () => {
  const p = {
    type: 'pva',
    position: vectorRange([0, 0, 0], [32767, 32767, 32767]),
    velocity: vectorRange([0, 0, 0], [32767, 32767, 32767]),
    acceleration: vectorRange([0, 0, 0], [32767, 32767, 32767]),
  };
  const r = rng([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    s = n.initializeValue(p, r);
  assert.deepEqual(s, {
    type: 'pva',
    position: [1, 2, 3],
    velocity: [4, 5, 6],
    acceleration: [7, 8, 9],
  });
  assert.equal(r.index, 9);
});
test('axis-PVA initializes scalar PVA before unnormalized axis', () => {
  const p = {
    type: 'axis-pva',
    position: range(0, 32767),
    velocity: range(0, 32767),
    acceleration: range(0, 32767),
    axis: vectorRange([0, 0, 0], [32767, 32767, 32767]),
  };
  const r = rng([1, 2, 3, 4, 5, 6]),
    s = n.initializeValue(p, r);
  assert.deepEqual(s, {
    type: 'axis-pva',
    position: 1,
    velocity: 2,
    acceleration: 3,
    axis: [4, 5, 6],
  });
  assert.equal(r.index, 6);
});
test('axis-easing initializes scalar start/end before unnormalized axis', () => {
  const p = {
    type: 'axis-easing',
    easing: { start: range(0, 32767), end: range(0, 32767), coefficients: [0, 0, 1] },
    axis: vectorRange([0, 0, 0], [32767, 32767, 32767]),
  };
  const r = rng([1, 2, 3, 4, 5]),
    s = n.initializeValue(p, r);
  assert.deepEqual(s, { type: 'axis-easing', start: 1, end: 2, axis: [3, 4, 5] });
  assert.equal(r.index, 5);
});
test('None identities and fixed values draw zero, reuse output', () => {
  const r = rng([]),
    p = { type: 'none' },
    s = n.initializeValue(p, r),
    out = new Float32Array(3);
  assert.equal(n.evaluateValue(p, s, 0, 0, { identity: [1, 1, 1], out }), out);
  assert.deepEqual(asArray(out), [1, 1, 1]);
  assert.equal(r.index, 0);
  const fixed = { type: 'fixed', value: 17 };
  assert.equal(n.evaluateValue(fixed, n.initializeValue(fixed, r), 100, 0), 17);
});
test('explicit sampled state survives fresh JSON restore with no RNG or resampling', () => {
  const p = {
    type: 'easing',
    start: vectorRange([1, 2, 3]),
    end: vectorRange([5, 6, 7]),
    coefficients: [0, 0, 1],
  };
  const r = rng([0, 1, 2, 3, 4, 5]),
    state = n.initializeValue(p, r),
    restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(asArray(n.evaluateValue(p, restored, 2, 4)), [3, 4, 5]);
  assert.equal(r.index, 6);
});
test('unknown numeric operation and parameter/state mismatch throw', () => {
  assert.throws(() => n.initializeValue({ type: 'future' }, rng([])), n.EffekseerNumericError);
  assert.throws(
    () => n.evaluateValue({ type: 'fixed', value: 1 }, { type: 'none' }, 0, 1),
    n.EffekseerNumericError,
  );
});
test('empty curve defaults still sample one offset', () => {
  const c = curve({ keys: [], frequency: 0, defaultValue: 255 }),
    p = { type: 'curve', curves: [c] },
    r = rng([123]);
  assert.equal(n.evaluateCurve(c, -100), 255);
  const state = n.initializeValue(p, r);
  assert.deepEqual(state.offsets, [0]);
  assert.equal(r.index, 1);
});
test('FCurve constant edges and integer linear segments', () => {
  const c = curve();
  for (const [t, expected] of [
    [-5, 0],
    [0, 0],
    [1, 10],
    [4, 40],
    [7, 70],
    [8, 80],
    [9, 80],
  ])
    assert.equal(n.evaluateCurve(c, t), expected);
});
test('FCurve negative loop exact multiples choose the last endpoint', () => {
  const c = curve({ edgeStart: 1, edgeEnd: 1 });
  assert.equal(n.evaluateCurve(c, -8), 80);
  assert.equal(n.evaluateCurve(c, 16), 0);
  assert.equal(n.evaluateCurve(c, -1), 70);
});
test('FCurve inverse-loop is the old single-modulo rule', () => {
  const c = curve({ edgeStart: 2, edgeEnd: 2 });
  assert.equal(n.evaluateCurve(c, -9), 10);
  assert.equal(n.evaluateCurve(c, 17), 70);
  assert.equal(n.evaluateCurve(c, 16), 80);
});
test('FCurve shortened final span retains old frequency denominator', () => {
  const c = curve({ length: 6, keys: [0, 40, 60] });
  assert.equal(n.evaluateCurve(c, 5), 45);
  assert.equal(n.evaluateCurve(c, 6), 60);
});
test('FCurve missing next key and zero loop length throw', () => {
  assert.throws(() => n.evaluateCurve(curve({ keys: [0, 40], length: 8 }), 5), /missing segment/);
  assert.throws(
    () => n.evaluateCurve(curve({ keys: [1], length: 0, edgeStart: 1 }), -1),
    /zero length/,
  );
  assert.throws(() => n.evaluateCurve(curve({ frequency: 0 }), 0), /positive frequency/);
});
test('FCurve casts living time to int32 truncation before offset lookup', () => {
  const p = { type: 'curve', curves: [curve({ offsets: range(5) })] },
    r = rng([0]),
    s = n.initializeValue(p, r);
  assert.deepEqual(asArray(n.evaluateValue(p, s, 3.75, 8)), [35]);
  assert.equal(n.frameInt32(-3.75), -3);
  assert.throws(() => n.frameInt32(2147483648), n.EffekseerNumericError);
});
test('fixed color draws zero, random color draws RGBA even fixed', () => {
  const r0 = rng([]),
    p0 = constantColor([1, 2, 3, 4]);
  assert.deepEqual(asArray(n.evaluateColor(p0, n.initializeColor(p0, r0), 0, 0)), [1, 2, 3, 4]);
  const r = rng([0, 1, 2, 3]),
    p = randomColor([42, 255, 255, 77], undefined, 1),
    s = n.initializeColor(p, r);
  assert.deepEqual(s.value, [255, 255, 0, 77]);
  assert.equal(r.index, 4);
});
test('HSVA uses six 42-unit sectors and clamps hue 252..255', () => {
  const expected = [
    [255, 0, 0, 99],
    [255, 255, 0, 99],
    [0, 255, 0, 99],
    [0, 255, 255, 99],
    [0, 0, 255, 99],
    [255, 0, 255, 99],
  ];
  for (let i = 0; i < 6; i++)
    assert.deepEqual(asArray(n.hsvaToRgba([42 * i, 255, 255, 99])), expected[i]);
  for (const h of [252, 253, 254, 255])
    assert.deepEqual(asArray(n.hsvaToRgba([h, 255, 255, 99])), expected[0]);
});
test('easing stores direct HSV endpoints, converts after interpolation', () => {
  const p = {
    type: 'easing',
    start: { ...randomColor([0, 255, 255, 255]), mode: 1 },
    end: { ...randomColor([84, 255, 255, 255]), mode: 1 },
    coefficients: [0, 0, 1],
  };
  const r = rng(new Array(8).fill(0)),
    s = n.initializeColor(p, r);
  assert.deepEqual(s.start, [0, 255, 255, 255]);
  assert.deepEqual(s.end, [84, 255, 255, 255]);
  assert.deepEqual(
    asArray(n.evaluateColor(p, JSON.parse(JSON.stringify(s)), 1, 2)),
    [255, 255, 0, 255],
  );
  assert.equal(r.index, 8);
});
test('color easing clamps channels but scalar easing does not', () => {
  const p = {
      type: 'easing',
      start: randomColor([100, 20, 200, 255]),
      end: randomColor([200, 10, 100, 0]),
      coefficients: [0, 0, 1],
    },
    s = n.initializeColor(p, rng(new Array(8).fill(0)));
  assert.deepEqual(asArray(n.evaluateColor(p, s, 3, 1)), [255, 0, 0, 0]);
  assert.equal(n.evaluateEasing(100, 200, [0, 0, 1], 3), 400);
});
test('color easing rejects mismatched HSV/RGB modes and unknown modes', () => {
  const p = {
    type: 'easing',
    start: randomColor([0, 0, 0, 0]),
    end: randomColor([0, 0, 0, 0], undefined, 1),
    coefficients: [0, 0, 1],
  };
  assert.throws(() => n.initializeColor(p, rng([])), /modes differ/);
  assert.throws(() => n.sampleColor({ ...p.start, mode: 2 }, rng([])), /unimplemented mode/);
});
test('color curve consumes RGBA offsets and clamps, truncates each channel', () => {
  const p = {
    type: 'curve',
    curves: [
      curve({ keys: [], defaultValue: -5 }),
      curve({ keys: [], defaultValue: 20.9 }),
      curve({ keys: [], defaultValue: 300 }),
      curve({ keys: [], defaultValue: 255 }),
    ],
  };
  const r = rng([1, 2, 3, 4]),
    s = n.initializeColor(p, r),
    out = new Uint8Array(4);
  assert.equal(n.evaluateColor(p, s, 2, 3, out), out);
  assert.deepEqual(asArray(out), [0, 20, 255, 255]);
  assert.equal(r.index, 4);
});
test('color multiplication truncates uint8 and fade changes alpha only', () => {
  assert.deepEqual(
    asArray(n.multiplyColors([255, 128, 1, 200], [255, 128, 128, 128])),
    [255, 64, 0, 100],
  );
  assert.deepEqual(asArray(n.multiplyColorScalar([255, 128, 1, 200], 0.5)), [127, 64, 0, 100]);
  const c = new Uint8Array([10, 20, 30, 201]);
  assert.equal(n.fadeColorAlpha(c, 0.5, c), c);
  assert.deepEqual(asArray(c), [10, 20, 30, 100]);
});
test('undefined float-to-byte multiplication domain throws instead of clamp/wrap', () => {
  assert.throws(() => n.multiplyColorScalar([255, 0, 0, 0], 2), n.EffekseerNumericError);
});
test('float-to-byte checks the truncated value at representable boundaries', () => {
  assert.deepEqual(asArray(n.multiplyColorScalar([255, 0, 0, 0], 1.001)), [255, 0, 0, 0]);
  assert.deepEqual(asArray(n.multiplyColorScalar([1, 0, 0, 0], -0.5)), [0, 0, 0, 0]);
});
test('Track group sampling order maps source L C R LM CM RM to reader indexes', () => {
  const renderer = {
    colors: Array.from({ length: 6 }, () => randomColor([0, 0, 0, 0], [255, 0, 0, 0])),
  };
  const draws = [0, 4096, 8192, 16384, 24576, 32767].flatMap((x) => [x, 0, 0, 0]);
  const r = rng(draws),
    s = n.initializeTrackColors(renderer, r);
  assert.deepEqual(
    s.colors.map((x) => x.value[0]),
    [0, 127, 31, 191, 63, 255],
  );
  assert.equal(r.index, 24);
});
test('Ring initialization order preserves scalar/location/colors sequence', () => {
  const v = () => ({ type: 'random', ...range(0, 32767) });
  const renderer = {
    viewingAngle: v(),
    outerLocation: {
      type: 'pva',
      position: vectorRange([0, 0], [32767, 32767]),
      velocity: vectorRange([0, 0], [32767, 32767]),
      acceleration: vectorRange([0, 0], [32767, 32767]),
    },
    innerLocation: { type: 'fixed', value: [1, 2] },
    centerRatio: v(),
    colors: [randomColor([0, 0, 0, 0]), constantColor([1, 2, 3, 4]), constantColor([5, 6, 7, 8])],
  };
  const r = rng([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    s = n.initializeRingValues(renderer, r);
  assert.equal(s.viewingAngle.value, 1);
  assert.deepEqual(s.outerLocation.position, [2, 3]);
  assert.deepEqual(s.outerLocation.velocity, [4, 5]);
  assert.deepEqual(s.outerLocation.acceleration, [6, 7]);
  assert.equal(s.centerRatio.value, 8);
  assert.equal(r.index, 12);
});
test('zero-angle rotations have exact source orientation', () => {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  assert.deepEqual(asArray(m.identity43()), identity);
  assert.deepEqual(
    asArray(m.rotationX43(0)).map((v) => (v === 0 ? 0 : v)),
    identity,
  );
  assert.deepEqual(
    asArray(m.rotationZXY43(0, 0, 0)).map((v) => (v === 0 ? 0 : v)),
    identity,
  );
});
test('affine multiplication order is row-vector scale then translate', () => {
  const product = m.multiply43(m.scaling43(2, 3, 4), m.translation43(7, 11, -13));
  assert.deepEqual(asArray(m.transformVector43([1, 2, 3], product)), [9, 17, -1]);
});
test('Matrix43 multiply supports output aliasing left or right', () => {
  const a = m.scaling43(2, 3, 4),
    b = m.translation43(7, 11, -13),
    expected = m.multiply43(a, b);
  assert.equal(m.multiply43(a, b, a), a);
  assert.deepEqual(asArray(a), asArray(expected));
  const c = m.scaling43(2, 3, 4);
  assert.equal(m.multiply43(c, b, b), b);
  assert.deepEqual(asArray(b), asArray(expected));
});
test('axis matrix preserves a nonunit axis instead of normalizing it', () => {
  const matrix = m.rotationAxisSinCos43([2, 0, 0], 1, 0);
  assert.deepEqual(
    asArray(matrix).map((v) => (v === 0 ? 0 : v)),
    [4, 0, 0, 0, 0, 2, 0, -2, 0, 0, 0, 0],
  );
});
test('vector operations preserve aliasing, exact integer cross/dot', () => {
  assert.equal(m.vectorDot([1, 2, 3], [4, 5, 6]), 32);
  const a = new Float32Array([1, 2, 3]);
  assert.equal(m.vectorCross(a, [4, 5, 6], a), a);
  assert.deepEqual(asArray(a), [-3, 6, -3]);
  assert.deepEqual(asArray(m.vectorAdd([1, 2, 3], [4, 5, 6])), [5, 7, 9]);
  assert.deepEqual(asArray(m.vectorSub([1, 2, 3], [4, 5, 6])), [-3, -3, -3]);
  assert.deepEqual(asArray(m.vectorScale([1, 2, 3], 2)), [2, 4, 6]);
});
test('portable normalize zero vector is finite zero, no identity fallback', () => {
  assert.deepEqual(asArray(m.normalizeVector([0, 0, 0])), [0, 0, 0]);
});
test('setSRT and decomposition reuse buffers', () => {
  const out = new Float32Array(12),
    scratch = new Float32Array(12),
    scale = new Float32Array(3),
    rotation = new Float32Array(12);
  assert.equal(m.setSRT43([2, 3, 4], m.identity43(), [7, 11, -13], out, scratch), out);
  assert.equal(m.getScale43(out, scale), scale);
  assert.deepEqual(asArray(scale), [2, 3, 4]);
  assert.equal(m.getRotation43(out, rotation, scale), rotation);
  assert.deepEqual(asArray(rotation), asArray(m.identity43()));
  assert.throws(() => m.getRotation43(m.scaling43(0, 1, 1)), /zero-length row/);
});
test('nonfinite numeric input and angle int conversion overflow fail explicitly', () => {
  assert.throws(() => m.normalizeAngle(Infinity), n.EffekseerNumericError);
  assert.throws(() => m.normalizeAngle(1e20), n.EffekseerNumericError);
  assert.throws(() => n.evaluateEasing(0, 1, [0, 0, 1], Infinity), n.EffekseerNumericError);
});
test('nonfinite axis matrix result fails explicitly', () => {
  assert.throws(() => m.rotationAxisSinCos43([3e38, 0, 0], 1, 0), n.EffekseerNumericError);
});

// These checks compare exact float bits against functions extracted unchanged
// from fixed official source and compiled locally. They are not native tolerance
// calibration and keep their source-reference labels in the test names.
const ref = JSON.parse(
  readFileSync(new URL('./fixtures/effekseer/numerical-reference.json', import.meta.url), 'utf8'),
);
const sourceTest = (name, run) => test(name, run, 'public-source-build-reference');
sourceTest('source reference custom SinCos, including negative zero and angle wrap', () => {
  equalBits(
    [0, -0, 0.1, -0.7, 1.5707963, 3.1415927, -3.1415927, 9.2, 1000].flatMap((x) =>
      asArray(m.customSinCos(x)),
    ),
    ref.sincos,
  );
});
for (const [key, fn, angle] of [
  ['rotationX', m.rotationX43, 0.7],
  ['rotationY', m.rotationY43, -0.3],
  ['rotationZ', m.rotationZ43, 1.2],
])
  sourceTest(`source reference ${key}`, () => equalBits(fn(angle), ref[key]));
sourceTest('source reference RotationZXY', () =>
  equalBits(m.rotationZXY43(0.7, -0.3, 1.2), ref.rotationZXY),
);
sourceTest('source reference nonunit RotationAxis sine/cosine overload', () =>
  equalBits(m.rotationAxisSinCos43([2, -0.5, 1.25], 0.6, 0.8), ref.axisSinCos),
);
const sourceProduct = () =>
  m.multiply43(
    m.multiply43(m.scaling43(2, 3, 4), m.rotationZXY43(0.7, -0.3, 1.2)),
    m.translation43(7, 11, -13),
  );
sourceTest('source reference affine Multiple', () => equalBits(sourceProduct(), ref.product));
sourceTest('source reference GetScale', () => equalBits(m.getScale43(sourceProduct()), ref.scale));
sourceTest('source reference GetRotation', () =>
  equalBits(m.getRotation43(sourceProduct()), ref.rotationExtracted),
);
sourceTest('source reference portable two-Newton Normal', () => {
  const vectors = [
    [0, 0, 0],
    [1, 0, 0],
    [3, 4, 0],
    [1.125, -5.75, 2.3],
    [0.000001, 0.000002, -0.000003],
  ];
  equalBits(
    vectors.flatMap((v) => asArray(m.normalizeVector(v))),
    ref.normals,
  );
});
sourceTest('source reference Vector3D::Transform affine', () =>
  equalBits(m.transformVector43([1.125, -5.75, 2.3], sourceProduct()), ref.transformedVector),
);
sourceTest('source reference random_float with exact CRT-domain input sequence', () => {
  const r = rng([0, 1, 16383, 16384, 32766, 32767]);
  equalBits(
    Array.from({ length: 6 }, () => n.sampleFloat(range(-7.7, 12.3), r)),
    ref.randomFloat,
  );
});
sourceTest('source reference random_int with exact CRT-domain input sequence', () => {
  const r = rng([0, 1, 16383, 16384, 32766, 32767]);
  assert.deepEqual(
    Array.from({ length: 6 }, () => n.sampleInt(range(-31, 77), r)),
    ref.randomInt,
  );
});
sourceTest('source reference scalar easing including extrapolation', () =>
  equalBits(
    [-0.25, 0, 0.5, 1, 1.25].map((t) => n.evaluateEasing(-5.7, 23.9, [-1.2, 0.4, 1.8], t)),
    ref.easing,
  ),
);
sourceTest('source reference old HSVA sector conversion', () => {
  const hsvs = [0, 42, 84, 126, 168, 210, 251, 252, 255].map((h) => [h, 255, 255, 97]);
  hsvs.push([21, 127, 203, 97]);
  assert.deepEqual(
    hsvs.map((hsv) => asArray(n.hsvaToRgba(hsv))),
    ref.hsv,
  );
});
sourceTest('source reference HSVA easing with direct endpoints', () => {
  const p = {
    type: 'easing',
    start: { ...randomColor([210, 255, 255, 255]), mode: 1 },
    end: { ...randomColor([42, 0, 127, 31]), mode: 1 },
    coefficients: [0, 0, 1],
  };
  const s = n.initializeColor(p, rng(new Array(8).fill(0)));
  assert.deepEqual(
    [-0.25, 0, 0.5, 1, 1.25].map((t) => asArray(n.evaluateColor(p, s, t, 1))),
    ref.hsvEasing,
  );
});
sourceTest('source reference FCurve literal integer edge/segment implementation', () => {
  const c = curve({ keys: [0, 40, 60], length: 6, offset: 2, edgeStart: 1, edgeEnd: 2 });
  equalBits(
    [-12, -6, -4, 0, 2, 3, 6, 7, 8, 9, 14, 15, 20].map((frame) => n.evaluateCurve(c, frame)),
    ref.curve,
  );
});
