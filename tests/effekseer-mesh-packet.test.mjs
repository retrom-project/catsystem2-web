// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EffekseerPackedMesh, multiply44 } from '../src/effekseer/mesh-packet.mjs';
import { SpriteRingGeometry } from '../src/effekseer/sprite-ring-geometry.mjs';
import { RibbonTrackGeometry } from '../src/effekseer/ribbon-track-geometry.mjs';
const I43 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  I44 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const opts = { camera: I44, projection: I44, viewport: [0, 0, 16, 16, 0, 1] };
const words = (values) => Array.from(new Uint32Array(Float32Array.from(values).buffer));
const fromWords = (values) => new Float32Array(Uint32Array.from(values).buffer);
const cases = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/matrix44-cases.json', import.meta.url)),
  ),
  reference = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/matrix44-reference.json', import.meta.url)),
  );
for (const c of cases)
  test('public-source Matrix44 ' + c.name, () => {
    const expected = reference.find((r) => r.name === c.name);
    assert.ok(expected);
    assert.deepEqual(
      words(multiply44(fromWords(c.left), fromWords(c.right), new Float32Array(16))),
      expected.bits,
    );
  });
function quad(count = 1) {
  const vertexCount = count * 4,
    indexCount = count * 6,
    positions = new Float32Array(vertexCount * 3),
    uv = new Float32Array(vertexCount * 2),
    colors = new Uint8Array(vertexCount * 4),
    indices = new Uint32Array(indexCount);
  for (let i = 0; i < count; i++) {
    positions.set([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], i * 12);
    uv.set([0.25, 0.5, 0.75, 0.5, 0.25, 1, 0.75, 1], i * 8);
    colors.set([255, 0, 128, 127, 11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 222, 255], i * 16);
    indices.set(
      [3, 1, 0, 3, 0, 2].map((x) => x + i * 4),
      i * 6,
    );
  }
  return {
    kind: 'sprite',
    coordinateSpace: 'world',
    positions,
    uv,
    colors,
    indices,
    vertexCount,
    indexCount,
  };
}
const ring = () => ({
  kind: 'ring',
  viewingAngle: 0,
  outerLocation: [2, 4],
  innerLocation: [1, -2],
  centerRatio: 0.5,
  colors: [
    [241, 61, 17, 223],
    [37, 211, 97, 149],
    [11, 43, 239, 71],
  ],
  uv: [0.25, 0.5, 0.5, 0.75],
});
test('packing retains source XYZ and exact original indices without CPU projection', () => {
  const input = quad(),
    owner = new EffekseerPackedMesh(),
    packet = owner.prepare(input, opts);
  assert.equal(packet.vertexCount, 4);
  assert.equal(packet.indexCount, 6);
  assert.deepEqual(Array.from(packet.indices.slice(0, 6)), [3, 1, 0, 3, 0, 2]);
  assert.deepEqual(Array.from(packet.vertices.slice(0, 4)), [-1, -1, 0, 1]);
  assert.equal(packet.vertices[4], 1);
  assert.equal(packet.vertices[5], 0);
  assert.equal(packet.vertices[6], Math.fround(128 / 255));
  assert.equal(packet.vertices[7], fromWords([0x3efeff00])[0]);
  assert.equal(packet.vertices[8], 0.25);
  assert.equal(packet.vertices[9], 0.5);
  assert.deepEqual(Array.from(packet.camera), I44);
  assert.deepEqual(Array.from(packet.projection), I44);
});
test('existing general quad split is rejected instead of silently changing the old diagonal', () => {
  const input = quad();
  input.indices.set([0, 1, 2, 1, 3, 2]);
  assert.throws(() => new EffekseerPackedMesh().prepare(input, opts), /diagonal/);
});
test('source reserved zero tail remains a complete uploaded quad range', () => {
  const b = new RibbonTrackGeometry(),
    out = {
      kind: 'ribbon',
      instanceCount: 2,
      positions: [-1, 1],
      colors: [
        [255, 0, 0, 255],
        [0, 255, 0, 127],
      ],
    };
  b.beginNode('ribbon', 3).beginGroup(2, [0.25, 0.5, 0.5, 0.75]);
  for (let i = 0; i < 2; i++)
    b.append([...I43.slice(0, 9), 0, i * 2, 0], { ...out, instanceIndex: i });
  b.endGroup();
  b.beginGroup(1).append(null, { kind: 'ribbon', instanceCount: 1, instanceIndex: 0 }).endGroup();
  const mesh = b.endNode(),
    packet = new EffekseerPackedMesh().prepare(mesh, opts);
  assert.equal(mesh.vertexCount, 8);
  assert.equal(mesh.cursorVertexCount, 4);
  assert.equal(packet.vertexCount, 8);
  assert.equal(packet.indexCount, 12);
  for (let i = 4; i < 8; i++) {
    assert.deepEqual(Array.from(packet.vertices.slice(i * 10, i * 10 + 4)), [0, 0, 0, 1]);
    assert.ok(packet.vertices.slice(i * 10 + 4, i * 10 + 10).every((x) => x === 0));
  }
});
test('Ring single keeps local positions and combines only the deferred camera constant', () => {
  const m = [...I43.slice(0, 9), 10, 20, 30],
    b = new SpriteRingGeometry();
  b.beginNode('ring', 1, { billboard: 2, vertexCount: 1 }).append(m, ring());
  const mesh = b.endNode(),
    before = words(mesh.positions),
    packet = new EffekseerPackedMesh().prepare(mesh, opts);
  assert.deepEqual(Array.from(packet.vertices.slice(0, 3)), [2, -0, 4]);
  assert.deepEqual(Array.from(packet.camera.slice(12, 16)), [10, 20, 30, 1]);
  assert.equal(packet.flushBefore, true);
  assert.equal(packet.flushAfter, true);
  assert.deepEqual(words(mesh.positions), before);
});
test('Ring multiple uploads the source bulk world positions without a second model transform', () => {
  const b = new SpriteRingGeometry();
  b.beginNode('ring', 2, { billboard: 2, vertexCount: 1 }).append(
    [...I43.slice(0, 9), 10, 20, 30],
    ring(),
  );
  const packet = new EffekseerPackedMesh().prepare(b.endNode(), opts);
  assert.deepEqual(Array.from(packet.vertices.slice(0, 3)), [12, 20, 34]);
  assert.deepEqual(Array.from(packet.camera), I44);
  assert.equal(packet.flushBefore, false);
  assert.equal(packet.flushAfter, false);
});
test('camera and projection are copied from the current caller without retaining mutable input views', () => {
  const camera = new Float32Array(I44),
    projection = new Float32Array(I44),
    owner = new EffekseerPackedMesh(),
    p = owner.prepare(quad(), { ...opts, camera, projection });
  camera[12] = 99;
  projection[0] = 99;
  assert.equal(p.camera[12], 0);
  assert.equal(p.projection[0], 1);
});
test('the typed packet guard accepts2000 quads independently of the unresolved original batch boundary', () => {
  const owner = new EffekseerPackedMesh(),
    p = owner.prepare(quad(2000), opts);
  assert.equal(p.vertexCount, 8000);
  assert.equal(p.indexCount, 12000);
  assert.equal(p.indices[11999], 7998);
  assert.throws(
    () => owner.prepare({ kind: 'sprite', vertexCount: 8004 }, opts),
    /verified upload range/,
  );
});
test('deferred local transform requires the actual Ring single-instance flush boundary', () => {
  const input = quad();
  input.coordinateSpace = 'local';
  input.deferredMatrix43 = I43;
  assert.throws(() => new EffekseerPackedMesh().prepare(input, opts), /Ring single/);
});
test('unknown types, malformed color and nonfinite camera fail without a substitute frame', () => {
  const owner = new EffekseerPackedMesh();
  assert.throws(() => owner.prepare({ ...quad(), kind: 'model' }, opts), /kind/);
  const camera = [...I44];
  camera[0] = Infinity;
  assert.throws(() => owner.prepare(quad(), { ...opts, camera }), /nonfinite/);
  const input = quad();
  input.colors = Array.from(input.colors);
  input.colors[3] = 256;
  assert.throws(() => owner.prepare(input, opts), /RGBA/);
  assert.throws(
    () => owner.prepare(quad(), { ...opts, viewport: [0, 0, 0, 16, 0, 1] }),
    /positive/,
  );
});
test('overlapping Matrix44 output is rejected before corrupting either input', () => {
  const storage = new Float32Array(33);
  storage.set(I44);
  const left = storage.subarray(0, 16),
    out = storage.subarray(1, 17),
    before = words(storage);
  assert.throws(() => multiply44(left, I44, out), /independent output/);
  assert.deepEqual(words(storage), before);
});
test('thirty warmed packing passes reuse typed buffers and the output object', () => {
  const input = quad(2),
    owner = new EffekseerPackedMesh(),
    p = owner.prepare(input, opts),
    vertices = p.vertices,
    indices = p.indices,
    Float = globalThis.Float32Array,
    Short = globalThis.Uint16Array;
  globalThis.Float32Array = new Proxy(Float, {
    construct() {
      throw new Error('new packed float storage');
    },
  });
  globalThis.Uint16Array = new Proxy(Short, {
    construct() {
      throw new Error('new packed index storage');
    },
  });
  try {
    for (let i = 0; i < 30; i++) {
      assert.equal(owner.prepare(input, opts), p);
      assert.equal(p.vertices, vertices);
      assert.equal(p.indices, indices);
    }
  } finally {
    globalThis.Float32Array = Float;
    globalThis.Uint16Array = Short;
  }
});

test('current viewport depth range is explicit and retained without replacement defaults', () => {
  const owner = new EffekseerPackedMesh(),
    p = owner.prepare(quad(), { ...opts, viewport: [3, 5, 20, 24, 0.25, 0.75] });
  assert.deepEqual(Array.from(p.viewport), [3, 5, 20, 24, 0.25, 0.75]);
  assert.throws(() => owner.prepare(quad(), { ...opts, viewport: [0, 0, 16, 16] }), /missing/);
  assert.throws(
    () => owner.prepare(quad(), { ...opts, viewport: [0, 0, 16, 16, 0.75, 0.25] }),
    /depth/,
  );
});

// Independent observed D3DCOLOR output, not values recomputed from the port.
const unorm = JSON.parse(
  await readFile(new URL('./fixtures/effekseer/gpu-unorm-reference.json', import.meta.url)),
);
for (const row of unorm.vertexSamples)
  test('measured D3DCOLOR byte' + row.byte, () => {
    const input = quad();
    for (let i = 0; i < 4; i++) input.colors[i * 4 + 3] = row.byte;
    const packet = new EffekseerPackedMesh().prepare(input, opts);
    assert.equal(words([packet.vertices[7]])[0], row.alphaBits);
  });
