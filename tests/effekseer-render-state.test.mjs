// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nodeTest from 'node:test';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import * as r from '../src/effekseer/render-state.mjs';
import { floatBits } from '../src/effekseer/math43.mjs';

const test = (name, run) => nodeTest(name, run);
const roundTrip = async (value) => deserializeCheckpoint(await serializeCheckpoint(value));
function rng(values) {
  return {
    values,
    index: 0,
    nextInt() {
      assert.ok(this.index < this.values.length, 'unexpected random draw');
      return this.values[this.index++];
    },
  };
}
const at = (livingTime = 0, livedTime = 4, sequence = 1) => ({ livingTime, livedTime, sequence });
const fixed = (value) => ({ type: 'fixed', value });
const random = (value, max = value, mode = 0) => ({ type: 'random', mode, min: value, max });
const ease = (start = [84, 255, 255, 201], end = [168, 255, 127, 31], mode = 1) => ({
  type: 'easing',
  start: random(start, undefined, mode),
  end: random(end, undefined, mode),
  coefficients: [0, 0, 1],
});
function node(kind, changes = {}) {
  const texture = { fadeIn: null, fadeOut: null, uv: { type: 'default' } };
  const renderer = { type: kind, color: fixed([100, 150, 200, 201]) };
  if (kind === 'sprite' || kind === 'ribbon')
    Object.assign(renderer, {
      vertexColors: null,
      positions: kind === 'sprite' ? [-1, -2, 1, -2, -1, 2, 1, 2] : [-2, 3],
    });
  if (kind === 'ring')
    Object.assign(renderer, {
      viewingAngle: fixed(360),
      outerLocation: fixed([2, 1]),
      innerLocation: fixed([1, 0]),
      centerRatio: fixed(0.5),
      colors: [fixed([255, 20, 30, 201]), fixed([10, 255, 30, 201]), fixed([10, 20, 255, 201])],
    });
  if (kind === 'track')
    Object.assign(renderer, {
      sizes: [2, 3, 4],
      colors: Array.from({ length: 6 }, (_, i) => fixed([10 + i, 20 + i, 30 + i, 201])),
    });
  return { texture, renderer, ...changes };
}
function begin(n, group, count = 1, age = 0) {
  return r.beginRenderingGroup(n, group, { instanceCount: count, firstContext: at(age) });
}
const array = (value) => Array.from(value);
const bits = (value) => Array.from(value, floatBits);

test('ordinary renderer groups initialize without random draws', () => {
  for (const kind of ['sprite', 'ribbon', 'ring', 'model']) {
    const q = rng([]);
    assert.equal(r.initializeGroup(node(kind), q).kind, kind);
    assert.equal(q.index, 0);
  }
});
test('fixed nonempty Sprite and Model colors are cached at initialization', () => {
  for (const kind of ['sprite', 'model']) {
    const q = rng([]),
      state = r.initializeInstance(node(kind), q, at());
    assert.deepEqual(state.current, [100, 150, 200, 201]);
    assert.equal(state.ready, true);
    assert.equal(q.index, 0);
  }
});
test('Sprite and Model HSVA easing initialize converted current with eight draws', () => {
  for (const kind of ['sprite', 'model']) {
    const n = node(kind);
    n.renderer.color = ease();
    const q = rng(new Array(8).fill(0)),
      state = r.initializeInstance(n, q, at());
    assert.deepEqual(state.current, [0, 255, 0, 201]);
    assert.equal(state.ready, true);
    assert.equal(q.index, 8);
  }
});
test('Ribbon easing initialization stores endpoints and explicit pending current', () => {
  const n = node('ribbon');
  n.renderer.color = ease();
  const q = rng(new Array(8).fill(0)),
    state = r.initializeInstance(n, q, at());
  assert.equal(state.current, null);
  assert.equal(state.ready, false);
  assert.equal(q.index, 8);
  assert.deepEqual(state.sampled.start, [84, 255, 255, 201]);
  const group = begin(n, r.initializeGroup(n, rng([])));
  assert.throws(
    () => r.renderColorEvaluation(n, state, at(), { group }),
    /zero-delta cache calculation/,
  );
});
test('Ribbon lazy Calculate(0) resolves current without RNG or age advancement', () => {
  const n = node('ribbon');
  n.renderer.color = ease();
  const q = rng(new Array(8).fill(0)),
    state = r.initializeInstance(n, q, at(0, 4, 0));
  r.updateCachedState(n, state, at(0, 4, 1));
  assert.deepEqual(state.current, [0, 255, 0, 201]);
  assert.equal(state.ready, true);
  assert.equal(state.cachedAt.livingTime, 0);
  assert.equal(q.index, 8);
});
test('pending Ribbon snapshot restores pending and never fabricates current', async () => {
  const n = node('ribbon');
  n.renderer.color = ease();
  const state = r.initializeInstance(n, rng(new Array(8).fill(0)), at());
  const restored = r.restoreRendererState(await roundTrip(r.snapshotRendererState(state)));
  assert.equal(restored.ready, false);
  assert.equal(restored.current, null);
  const group = begin(n, r.initializeGroup(n, rng([])));
  assert.throws(() => r.renderColorEvaluation(n, restored, at(), { group }), /pending|awaits/);
});
test('cached color age stays before age increment while fade and UV use render age', () => {
  const n = node('sprite');
  n.renderer.color = ease([0, 0, 0, 255], [200, 200, 200, 255], 0);
  n.texture.fadeIn = { frames: 2, coefficients: [0, 0, 1] };
  n.texture.uv = { type: 'scroll', rectangle: [0, 0, 1, 1], speed: [0.25, 0.5] };
  const state = r.initializeInstance(n, rng(new Array(8).fill(0)), at(0, 4));
  r.updateCachedState(n, state, at(1, 4));
  const out = r.renderColorEvaluation(n, state, at(2, 4));
  assert.deepEqual(array(out.allColor), [50, 50, 50, 255]);
  assert.equal(out.fadeAlpha, 1);
  assert.deepEqual(array(out.uv), [0.5, 1, 1, 1]);
  assert.equal(state.cachedAt.livingTime, 1);
});
test('Sprite preserves raw AllColor but vertex colors multiply then fade alpha', () => {
  const n = node('sprite');
  n.renderer.vertexColors = new Array(4).fill([255, 128, 64, 128]);
  n.texture.fadeIn = { frames: 2, coefficients: [0, 0, 1] };
  const state = r.initializeInstance(n, rng([]), at()),
    out = r.renderColorEvaluation(n, state, at(1));
  assert.deepEqual(array(out.allColor), [100, 150, 200, 201]);
  assert.deepEqual(array(out.colors[0]), [100, 75, 50, 50]);
  assert.deepEqual(array(out.positions), n.renderer.positions);
});
test('Model applies fade to AllColor while retaining full initialization', () => {
  const n = node('model');
  n.texture.fadeIn = { frames: 2, coefficients: [0, 0, 1] };
  const state = r.initializeInstance(n, rng([]), at()),
    out = r.renderColorEvaluation(n, state, at(1));
  assert.deepEqual(array(out.allColor), [100, 150, 200, 100]);
  n.renderer.color = random([100, 150, 200, 201]);
  const q = rng([1, 2, 3, 4]);
  r.initializeInstance(n, q, at());
  assert.equal(q.index, 4);
});
test('old state performs no parent-color inheritance multiplication', () => {
  const n = node('sprite'),
    state = r.initializeInstance(n, rng([]), at());
  const out = r.renderColorEvaluation(n, state, { ...at(), parentColor: [0, 0, 0, 0] });
  assert.deepEqual(array(out.allColor), [100, 150, 200, 201]);
});
test('Ring initialization leaves direct HSVA easing start unconverted', () => {
  const n = node('ring');
  n.renderer.colors[0] = ease();
  const q = rng(new Array(8).fill(0)),
    state = r.initializeInstance(n, q, at());
  assert.deepEqual(state.current.colors[0], [84, 255, 255, 201]);
  assert.equal(q.index, 8);
  r.updateCachedState(n, state, at());
  assert.deepEqual(state.current.colors[0], [0, 255, 0, 201]);
  assert.equal(q.index, 8);
});
test('Ring scalar location and color sampling retain ordered draws', () => {
  const n = node('ring'),
    range = { min: 0, max: 32767 },
    vector = { min: [0, 0], max: [32767, 32767] };
  Object.assign(n.renderer, {
    viewingAngle: { type: 'random', ...range },
    outerLocation: { type: 'pva', position: vector, velocity: vector, acceleration: vector },
    centerRatio: { type: 'random', ...range },
  });
  n.renderer.colors[0] = random([20, 30, 40, 50]);
  const q = rng(Array.from({ length: 12 }, (_, i) => i + 1)),
    state = r.initializeInstance(n, q, at());
  assert.equal(state.current.viewingAngle, 1);
  assert.deepEqual(state.current.outerLocation, [2, 3]);
  assert.deepEqual(state.sampled.outerLocation.velocity, [4, 5]);
  assert.deepEqual(state.sampled.outerLocation.acceleration, [6, 7]);
  assert.equal(state.current.centerRatio, 8);
  assert.equal(q.index, 12);
});
test('Ring update evaluates PVA/easing only at passed calculation time', () => {
  const n = node('ring'),
    rr = (v) => ({ min: v, max: v });
  n.renderer.outerLocation = {
    type: 'pva',
    position: rr([1, 2]),
    velocity: rr([3, 4]),
    acceleration: rr([2, 0]),
  };
  n.renderer.viewingAngle = {
    type: 'easing',
    start: rr(90),
    end: rr(270),
    coefficients: [0, 0, 1],
  };
  const q = rng(new Array(8).fill(0)),
    state = r.initializeInstance(n, q, at());
  r.updateCachedState(n, state, at(2));
  assert.deepEqual(state.current.outerLocation, [11, 10]);
  assert.equal(state.current.viewingAngle, 180);
  assert.equal(q.index, 8);
  const out = r.renderColorEvaluation(n, state, at(3));
  assert.deepEqual(array(out.outerLocation), [11, 10]);
  assert.equal(out.viewingAngle, 180);
  assert.equal(out.centerRatio, 0.5);
});
test('Ring fade changes alpha of all three cached colors', () => {
  const n = node('ring');
  n.texture.fadeIn = { frames: 2, coefficients: [0, 0, 1] };
  const state = r.initializeInstance(n, rng([]), at());
  const out = r.renderColorEvaluation(n, state, at(1));
  assert.deepEqual(
    out.colors.map((x) => x[3]),
    [100, 100, 100],
  );
  assert.deepEqual(
    state.current.colors.map((x) => x[3]),
    [201, 201, 201],
  );
});
test('Track colors sample per-group in L C R LM CM RM order', () => {
  const n = node('track');
  n.renderer.colors = Array.from({ length: 6 }, () => random([0, 0, 0, 255], [255, 0, 0, 255]));
  const q = rng([0, 4096, 8192, 16384, 24576, 32767].flatMap((x) => [x, 0, 0, 0])),
    group = r.initializeGroup(n, q);
  assert.deepEqual(
    group.colors.map((x) => x.value[0]),
    [0, 127, 31, 191, 63, 255],
  );
  assert.equal(q.index, 24);
  const noDraws = rng([]),
    state = r.initializeInstance(n, noDraws, at());
  r.updateCachedState(n, state, at(1));
  assert.equal(noDraws.index, 0);
});
test('Track uses each rendered instance integer time/life with group samples', () => {
  const n = node('track');
  n.renderer.colors = new Array(6).fill(ease([0, 0, 0, 255], [255, 255, 255, 255], 0));
  const group = begin(n, r.initializeGroup(n, rng(new Array(48).fill(0))), 2),
    state = r.initializeInstance(n, rng([]), at());
  const first = r.renderColorEvaluation(n, state, at(1.9, 3.9), { group });
  assert.deepEqual(array(first.colors[0]), [85, 85, 85, 255]);
  r.advanceRenderingGroup(group);
  const second = r.renderColorEvaluation(n, state, at(2.9, 3.9), { group });
  assert.deepEqual(array(second.colors[0]), [170, 170, 170, 255]);
});
test('Track does not apply ordinary fade or divide its unused fade parameters', () => {
  const n = node('track');
  n.texture.fadeIn = { frames: 8, coefficients: [0, 0, 1] };
  n.texture.fadeOut = { frames: 0, coefficients: [0, 0, 1] };
  const group = begin(n, r.initializeGroup(n, rng([]))),
    state = r.initializeInstance(n, rng([]), at());
  const out = r.renderColorEvaluation(n, state, at(20, 4), { group });
  assert.equal(out.fadeAlpha, 1);
  assert.equal(out.colors[0][3], 201);
  assert.deepEqual(array(out.sizes), [2, 3, 4]);
});
test('Ribbon and Track share first-instance UV, not each later instance UV', () => {
  for (const kind of ['ribbon', 'track']) {
    const n = node(kind);
    n.texture.uv = { type: 'scroll', rectangle: [0, 0, 1, 1], speed: [0.25, 0.5] };
    const group = begin(n, r.initializeGroup(n, rng([])), 2, 2),
      state = r.initializeInstance(n, rng([]), at());
    const first = r.renderColorEvaluation(n, state, at(2), { group });
    assert.deepEqual(array(first.uv), [0.5, 1, 1, 1]);
    r.advanceRenderingGroup(group);
    const second = r.renderColorEvaluation(n, state, at(6), { group });
    assert.deepEqual(array(second.uv), [0.5, 1, 1, 1]);
  }
});
test('Track BeginRenderingGroup copies sampled values as original node cache', () => {
  const n = node('track'),
    group = begin(n, r.initializeGroup(n, rng([]))),
    state = r.initializeInstance(n, rng([]), at());
  group.colors[0].value[0] = 99;
  group.sizes[0] = 99;
  const out = r.renderColorEvaluation(n, state, at(), { group });
  assert.equal(out.colors[0][0], 10);
  assert.equal(out.sizes[0], 2);
});
test('Fixed instance and Track group colors retain stored copies', () => {
  const n = node('sprite'),
    state = r.initializeInstance(n, rng([]), at());
  n.renderer.color.value[0] = 0;
  r.updateCachedState(n, state, at(1));
  assert.equal(state.current[0], 100);
  const t = node('track'),
    group = begin(t, r.initializeGroup(t, rng([])));
  t.renderer.colors[0].value[0] = 0;
  assert.equal(
    r.renderColorEvaluation(t, r.initializeInstance(t, rng([]), at()), at(), { group })
      .colors[0][0],
    10,
  );
});
test('ordinary fade uses strict boundaries and multiplies overlap without clamp', () => {
  const texture = {
    fadeIn: { frames: 8, coefficients: [0, 0, 1] },
    fadeOut: { frames: 8, coefficients: [0, 0, 1] },
  };
  assert.equal(r.evaluateFade(texture, at(4, 10)), 0.375);
  assert.equal(r.evaluateFade(texture, at(10, 10)), 0);
  assert.equal(r.evaluateFade(texture, at(12, 10)), -0.25);
});
test('UV default/fixed/scroll produce nonempty usable coordinates', () => {
  assert.deepEqual(array(r.evaluateUV({ type: 'default' }, 2)), [0, 0, 1, 1]);
  assert.deepEqual(
    array(r.evaluateUV({ type: 'fixed', rectangle: [0.25, 0.5, 0.25, 0.5] }, 2)),
    [0.25, 0.5, 0.25, 0.5],
  );
  assert.deepEqual(
    array(r.evaluateUV({ type: 'scroll', rectangle: [0, 0, 1, 1], speed: [0.25, -0.5] }, 2)),
    [0.5, -1, 1, 1],
  );
});
test('UV animation once/loop/reverse retain exact old segment endpoints', () => {
  const base = {
    type: 'animation',
    rectangle: [0, 0, 0.25, 0.5],
    frameLength: 2,
    countX: 2,
    countY: 2,
  };
  assert.deepEqual(array(r.evaluateUV({ ...base, loop: 0 }, 8)), [0.25, 0.5, 0.25, 0.5]);
  assert.deepEqual(array(r.evaluateUV({ ...base, loop: 1 }, 8)), [0, 0, 0.25, 0.5]);
  assert.deepEqual(array(r.evaluateUV({ ...base, loop: 2 }, 8)), [0.25, 0.5, 0.25, 0.5]);
  assert.deepEqual(array(r.evaluateUV({ ...base, loop: 2 }, 14)), [0, 0, 0.25, 0.5]);
});
test('UV zero divisor, integer overflow and unknown operations fail explicitly', () => {
  const uv = {
    type: 'animation',
    rectangle: [0, 0, 1, 1],
    frameLength: 0,
    countX: 2,
    countY: 2,
    loop: 0,
  };
  assert.throws(() => r.evaluateUV(uv, 0), /division/);
  assert.throws(() => r.evaluateUV({ ...uv, frameLength: 1, countX: 2147483647 }, 0), /int32/);
  assert.throws(() => r.evaluateUV({ type: 'future' }, 0), /unimplemented type/);
  assert.throws(
    () => r.evaluateUV({ ...uv, frameLength: 1, loop: 3 }, 0),
    /unimplemented operation/,
  );
});
test('curve color keeps offsets/current ready and updates without RNG', () => {
  const curve = {
    edgeStart: 0,
    edgeEnd: 0,
    offsets: { min: 5, max: 5 },
    offset: 0,
    length: 4,
    frequency: 4,
    keys: [10, 50],
    defaultValue: 255,
  };
  const n = node('sprite');
  n.renderer.color = { type: 'curve', curves: [curve, curve, curve, curve] };
  const q = rng([1, 2, 3, 4]),
    state = r.initializeInstance(n, q, at());
  assert.deepEqual(state.current, [15, 15, 15, 15]);
  r.updateCachedState(n, state, at(2));
  assert.deepEqual(state.current, [35, 35, 35, 35]);
  assert.equal(q.index, 4);
});
test('repeated color render is pure for cache, age, group index and RNG', () => {
  const n = node('ribbon'),
    group = begin(n, r.initializeGroup(n, rng([]))),
    q = rng([]),
    state = r.initializeInstance(n, q, at());
  const beforeState = r.snapshotRendererState(state),
    beforeGroup = r.snapshotRendererState(group);
  const a = r.renderColorEvaluation(n, state, at(2), { group }),
    b = r.renderColorEvaluation(n, state, at(2), { group });
  assert.deepEqual(a.colors, b.colors);
  assert.deepEqual(r.snapshotRendererState(state), beforeState);
  assert.deepEqual(r.snapshotRendererState(group), beforeGroup);
  assert.equal(q.index, 0);
});
test('every node state and group cache round-trip fresh with no initialization', async () => {
  for (const kind of ['sprite', 'ribbon', 'ring', 'model', 'track']) {
    const n = node(kind),
      group = begin(n, r.initializeGroup(n, rng([]))),
      state = r.initializeInstance(n, rng([]), at());
    const gs = await roundTrip(r.snapshotRendererState(group)),
      ss = await roundTrip(r.snapshotRendererState(state));
    const restoredGroup = r.restoreRendererState(gs),
      restoredState = r.restoreRendererState(ss);
    assert.deepEqual(
      r.renderColorEvaluation(n, restoredState, at(2), { group: restoredGroup }),
      r.renderColorEvaluation(n, state, at(2), { group }),
    );
    assert.notEqual(restoredState, state);
    assert.notEqual(restoredGroup, group);
  }
});
test('snapshot preserves signed zero and uint32 sequence values through the existing checkpoint serializer', async () => {
  for (const sequence of [0xffffffff, -1, -2147483648]) {
    const n = node('ring'),
      state = r.initializeInstance(n, rng([]), at(0, 4, sequence));
    state.current.outerLocation[1] = -0;
    const restored = r.restoreRendererState(await roundTrip(r.snapshotRendererState(state)));
    assert.ok(Object.is(restored.current.outerLocation[1], -0));
    assert.equal(restored.cachedAt.sequence, sequence >>> 0);
  }
});
test('snapshot rejects unreadable/nonfinite/unknown operation rather than replay', () => {
  assert.throws(() => r.restoreRendererState(['future']), /unimplemented/);
  assert.throws(
    () =>
      r.restoreRendererState({ scope: 'instance', kind: 'sprite', current: [Infinity, 0, 0, 0] }),
    /finite/,
  );
  assert.throws(
    () => r.snapshotRendererState({ scope: 'instance', kind: 'future' }),
    /unimplemented/,
  );
});
test('snapshot rejects unknown color sampling and unreadable cached current', () => {
  const state = r.initializeInstance(node('sprite'), rng([]), at());
  state.sampled.type = 'future';
  assert.throws(() => r.snapshotRendererState(state), /unimplemented color sample/);
  state.sampled.type = 'fixed';
  state.current = [256, 0, 0, 0];
  assert.throws(() => r.snapshotRendererState(state), /invalid uint8/);
});
test('explicit group render index never advances implicitly or beyond its count', () => {
  const n = node('ribbon'),
    group = begin(n, r.initializeGroup(n, rng([]))),
    state = r.initializeInstance(n, rng([]), at());
  assert.equal(r.renderColorEvaluation(n, state, at(), { group }).instanceIndex, 0);
  r.advanceRenderingGroup(group);
  assert.equal(group.draw.instanceIndex, 1);
  assert.throws(() => r.advanceRenderingGroup(group), /exceeds/);
  assert.throws(() => r.renderColorEvaluation(n, state, at(), { group }), /BeginRenderingGroup/);
});
test('output typed arrays can be reused across render evaluations', () => {
  for (const kind of ['sprite', 'ribbon', 'ring', 'model', 'track']) {
    const n = node(kind),
      state = r.initializeInstance(n, rng([]), at()),
      group = begin(n, r.initializeGroup(n, rng([]))),
      out = r.createRenderOutput(kind),
      buffers = [out.uv, out.allColor, ...out.colors];
    assert.equal(r.renderColorEvaluation(n, state, at(), { group, out }), out);
    assert.equal(r.renderColorEvaluation(n, state, at(1), { group, out }), out);
    assert.deepEqual([out.uv, out.allColor, ...out.colors], buffers);
  }
});

const ref = JSON.parse(
  readFileSync(
    new URL('./fixtures/effekseer/render-state-reference.json', import.meta.url),
    'utf8',
  ),
);
function sourceTest(name, run) {
  test(name, run, 'fixed-public-source-build-reference');
}
sourceTest('public source Sprite and Model init immediately evaluate color', () => {
  for (const [kind, key] of [
    ['sprite', 'spriteInit'],
    ['model', 'modelInit'],
  ]) {
    const n = node(kind);
    n.renderer.color = ease();
    const q = rng(new Array(8).fill(0)),
      state = r.initializeInstance(n, q, at());
    assert.deepEqual(state.current, ref[key]);
    assert.equal(q.index, ref[key + 'Draws']);
  }
});
sourceTest('public source Sprite Update changes cached color at calculation age', () => {
  const n = node('sprite');
  n.renderer.color = ease();
  const state = r.initializeInstance(n, rng(new Array(8).fill(0)), at());
  r.updateCachedState(n, state, at(2));
  assert.deepEqual(state.current, ref.spriteUpdated);
});
sourceTest(
  'public source Ribbon init preserves preexisting sentinel then update sets color',
  () => {
    assert.deepEqual(ref.ribbonPreservedSentinel, [9, 8, 7, 6]);
    const n = node('ribbon');
    n.renderer.color = ease();
    const q = rng(new Array(8).fill(0)),
      state = r.initializeInstance(n, q, at());
    assert.equal(state.current, null);
    assert.equal(q.index, ref.ribbonInitDraws);
    r.updateCachedState(n, state, at());
    assert.deepEqual(state.current, ref.ribbonFirstUpdate);
  },
);
sourceTest('public source Ring init direct HSV then converted update', () => {
  const n = node('ring');
  n.renderer.colors[0] = ease();
  const q = rng(new Array(8).fill(0)),
    state = r.initializeInstance(n, q, at());
  assert.deepEqual(state.current.colors[0], ref.ringInitUnconverted);
  assert.equal(q.index, ref.ringInitDraws);
  r.updateCachedState(n, state, at());
  assert.deepEqual(state.current.colors[0], ref.ringUpdatedConverted);
});
sourceTest('public source Track SetValues consumes integer time and life', () => {
  const n = node('track');
  n.renderer.colors = new Array(6).fill(ease([0, 0, 0, 255], [255, 255, 255, 255], 0));
  const group = begin(n, r.initializeGroup(n, rng(new Array(48).fill(0)))),
    state = r.initializeInstance(n, rng([]), at());
  assert.deepEqual(
    array(r.renderColorEvaluation(n, state, at(1.9, 3.9), { group }).colors[0]),
    ref.trackIntTime,
  );
});
sourceTest('public source fade overlap and extrapolation exact float bits', () => {
  const texture = {
    fadeIn: { frames: 8, coefficients: [0, 0, 1] },
    fadeOut: { frames: 8, coefficients: [0, 0, 1] },
  };
  assert.deepEqual(
    [0, 2, 4, 5, 6, 8, 10, 11, 12].map((t) => floatBits(r.evaluateFade(texture, at(t, 10)))),
    ref.fadeBits,
  );
});
sourceTest('public source UV animation every loop and boundary exact float bits', () => {
  const actual = [];
  for (const loop of [0, 1, 2])
    for (const t of [0, 2, 4, 6, 8, 10, 14, 16, 18, -2])
      actual.push(
        bits(
          r.evaluateUV(
            {
              type: 'animation',
              rectangle: [0.1, 0.2, 0.25, 0.5],
              frameLength: 2,
              countX: 2,
              countY: 2,
              loop,
            },
            t,
          ),
        ),
      );
  assert.deepEqual(actual, ref.uvBits);
});
sourceTest('public source scrolling UV exact float bits', () => {
  assert.deepEqual(
    bits(
      r.evaluateUV({ type: 'scroll', rectangle: [0.1, 0.2, 0.25, 0.5], speed: [0.03, -0.07] }, 3.7),
    ),
    ref.scrollBits,
  );
});
