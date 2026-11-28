// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EffekseerRingCurrentState } from '../src/effekseer/ring-current-state.mjs';
import { SpriteRingGeometry } from '../src/effekseer/sprite-ring-geometry.mjs';

const identity = new Uint32Array([
  0x3f800000, 0, 0, 0, 0, 0x3f800000, 0, 0, 0, 0, 0x3f800000, 0, 0, 0, 0, 0x3f800000,
]);
const cases = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/sprite-ring-cases.json', import.meta.url)),
  ),
  matrixCases = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/matrix44-cases.json', import.meta.url)),
  ),
  matrixReferences = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/matrix44-reference.json', import.meta.url)),
  );
function build(input, builder) {
  builder.beginNode(input.kind, input.sourceCount, input.nodeParams);
  for (const instance of input.instances)
    builder.append(instance.matrix, { ...instance, kind: input.kind }, input.camera);
  return builder.endNode();
}
function preserveSingle(cache, mesh) {
  if (mesh.deferredMatrix43) cache.updateMatrix43(mesh.deferredMatrix43);
}
const bits = (values) => new Uint32Array(Float32Array.from(values).buffer),
  floats = (words) => new Float32Array(Uint32Array.from(words).buffer);

test('new renderer owns one complete identity Matrix44 rather than a per-node fallback', () => {
  const owner = new EffekseerRingCurrentState(),
    out = new Float32Array(16);
  assert.deepEqual(owner.snapshot().matrixWords, identity);
  assert.equal(owner.copyMatrix44(out), out);
  assert.deepEqual(new Uint32Array(out.buffer), identity);
  out.fill(7);
  assert.deepEqual(owner.snapshot().matrixWords, identity);
});
test('single Rendering replaces twelve components and preserves the current fourth column', () => {
  const saved = identity.slice(),
    columns = [3, 7, 11, 15],
    extra = [0x3f000000, 0x80000000, 0x3f400000, 0x40000000];
  columns.forEach((slot, i) => (saved[slot] = extra[i]));
  const owner = new EffekseerRingCurrentState();
  owner.restore({ matrixWords: saved });
  const m = [2, 0, 0, 0, 3, 0, 0, 0, 4, 5, 6, 7];
  owner.updateMatrix43(m);
  const result = owner.snapshot().matrixWords,
    expected = bits([2, 0, 0, 0.5, 0, 3, 0, -0, 0, 0, 4, 0.75, 5, 6, 7, 2]);
  assert.deepEqual(result, expected);
  saved.fill(0);
  m.fill(99);
  assert.deepEqual(owner.snapshot().matrixWords, expected);
});
test('real geometry single, bulk, empty single and next-frame empty retain the same owner matrix', () => {
  const owner = new EffekseerRingCurrentState(),
    builder = new SpriteRingGeometry(),
    single = cases.find((c) => c.name === 'ring-mode2-single-local'),
    bulk = cases.find((c) => c.name === 'ring-mode3-multi-world');
  const first = build(single, builder);
  preserveSingle(owner, first);
  const saved = owner.snapshot();
  assert.notDeepEqual(saved.matrixWords, identity);
  preserveSingle(owner, build(bulk, builder));
  assert.deepEqual(owner.snapshot(), saved);
  for (let frame = 0; frame < 2; frame++) {
    builder.beginNode('ring', 1, single.nodeParams);
    const empty = builder.endNode();
    assert.equal(empty.submittedInstanceCount, 0);
    assert.equal(empty.deferredMatrix43, null);
    assert.equal(empty.flushBefore, true);
    assert.equal(empty.flushAfter, false);
    preserveSingle(owner, empty);
    assert.deepEqual(owner.snapshot(), saved);
  }
});
test('fresh restore retains current words through an empty Ring without Play, history or random draws', () => {
  const owner = new EffekseerRingCurrentState(),
    builder = new SpriteRingGeometry(),
    input = cases.find((c) => c.name === 'ring-mode2-single-local');
  preserveSingle(owner, build(input, builder));
  const saved = owner.snapshot(),
    random = Math.random;
  Math.random = () => {
    throw new Error('Ring current-state restore sampled RNG');
  };
  try {
    const fresh = new EffekseerRingCurrentState();
    fresh.restore(saved);
    builder.beginNode('ring', 1, input.nodeParams);
    preserveSingle(fresh, builder.endNode());
    assert.deepEqual(fresh.snapshot(), saved);
  } finally {
    Math.random = random;
  }
});
test('snapshot and restore copy exact words including signed zero without sharing mutable buffers', () => {
  const owner = new EffekseerRingCurrentState(),
    source = identity.slice();
  source[3] = 0x80000000;
  owner.restore({ matrixWords: source });
  source.fill(1);
  const saved = owner.snapshot();
  assert.equal(saved.matrixWords[3], 0x80000000);
  saved.matrixWords.fill(2);
  assert.equal(owner.snapshot().matrixWords[3], 0x80000000);
});
test('an unsubmitted single does not need or read any persistent-matrix owner', () => {
  const builder = new SpriteRingGeometry();
  builder.beginNode('ring', 1, { billboard: 2, vertexCount: 5 });
  const mesh = builder.endNode();
  assert.equal(mesh.vertexCount, 40);
  assert.equal(mesh.indexCount, 60);
  assert.equal(mesh.cursorVertexCount, 0);
  assert.equal(mesh.completedQuadCount, 0);
  assert.equal(mesh.coordinateSpace, 'world');
  assert.equal(mesh.deferredMatrix43, null);
  assert.ok(mesh.positions.subarray(0, 120).every((x) => x === 0));
});
for (const input of matrixCases)
  test(
    'persistent Ring camera product uses frozen Matrix44 source reference: ' + input.name,
    () => {
      const owner = new EffekseerRingCurrentState(),
        out = new Float32Array(16);
      owner.restore({ matrixWords: Uint32Array.from(input.left) });
      assert.equal(owner.cameraMatrix(floats(input.right), out), out);
      assert.deepEqual(
        Array.from(new Uint32Array(out.buffer)),
        matrixReferences.find((r) => r.name === input.name).bits,
      );
    },
  );
test('invalid Matrix43 update is rejected before mutating the current sixteen words', () => {
  const owner = new EffekseerRingCurrentState(),
    saved = owner.snapshot(),
    bad = new Float32Array(12);
  bad[11] = Infinity;
  assert.throws(() => owner.updateMatrix43(bad), /nonfinite/);
  assert.deepEqual(owner.snapshot(), saved);
  assert.throws(() => owner.updateMatrix43(new Float32Array(11)), /twelve/);
  assert.deepEqual(owner.snapshot(), saved);
});
test('restore requires a fresh owner and complete typed current-state checkpoint', () => {
  const owner = new EffekseerRingCurrentState();
  for (const saved of [
    null,
    { matrixWords: new Uint32Array(15) },
    { matrixWords: Array.from(identity) },
    { matrixWords: identity, elapsed: 0 },
  ])
    assert.throws(() => owner.restore(saved), /checkpoint/);
  owner.restore({ matrixWords: identity });
  assert.throws(() => owner.restore({ matrixWords: identity }), /fresh/);
});
test('closing retires this renderer cache while a new renderer receives a fresh identity', () => {
  const owner = new EffekseerRingCurrentState();
  owner.updateMatrix43([2, 0, 0, 0, 2, 0, 0, 0, 2, 3, 4, 5]);
  owner.close();
  owner.close();
  assert.throws(() => owner.snapshot(), /closed/);
  assert.throws(() => owner.copyMatrix44(new Float32Array(16)), /closed/);
  assert.throws(() => owner.cameraMatrix(new Float32Array(16), new Float32Array(16)), /closed/);
  assert.deepEqual(new EffekseerRingCurrentState().snapshot().matrixWords, identity);
});
