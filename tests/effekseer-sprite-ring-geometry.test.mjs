// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import nodeTest from 'node:test';
import {
  SpriteRingGeometry,
  EffekseerSpriteRingGeometryError,
} from '../src/effekseer/sprite-ring-geometry.mjs';
import { transformVector43 } from '../src/effekseer/math43.mjs';
import {
  initializeInstance,
  createRenderOutput,
  renderColorEvaluation,
  snapshotRendererState,
  restoreRendererState,
} from '../src/effekseer/render-state.mjs';
const cases = JSON.parse(
  await readFile(new URL('./fixtures/effekseer/sprite-ring-cases.json', import.meta.url), 'utf8'),
);
const reference = JSON.parse(
  await readFile(
    new URL('./fixtures/effekseer/sprite-ring-reference.json', import.meta.url),
    'utf8',
  ),
);
const test = (name, _type, fn) => nodeTest(name, fn);
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  CAMERA = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const COLOR = [
  [241, 61, 17, 223],
  [37, 211, 97, 149],
  [11, 43, 239, 71],
];
const matrix = (x, y, z) => [...I.slice(0, 9), x, y, z];
const bits = (values) => Array.from(new Uint32Array(Float32Array.from(values).buffer));
const prefix = (value, count) => Array.from(value).slice(0, count);
function buildCase(input, builder = new SpriteRingGeometry()) {
  builder.beginNode(input.kind, input.sourceCount, input.nodeParams);
  for (const instance of input.instances)
    builder.append(instance.matrix, { ...instance, kind: input.kind }, input.camera);
  return builder.endNode();
}
function output(mesh) {
  return {
    vertexCount: mesh.vertexCount,
    cursorVertexCount: mesh.cursorVertexCount,
    completedQuadCount: mesh.completedQuadCount,
    resetCount: mesh.flushBefore ? 1 : 0,
    positionsBits: bits(prefix(mesh.positions, mesh.vertexCount * 3)),
    uvBits: bits(prefix(mesh.uv, mesh.vertexCount * 2)),
    colors: prefix(mesh.colors, mesh.vertexCount * 4),
    indices: prefix(mesh.indices, mesh.indexCount),
    deferredMatrixBits: mesh.deferredMatrix43 ? bits(mesh.deferredMatrix43) : [],
  };
}
function error(field) {
  return (e) => e instanceof EffekseerSpriteRingGeometryError && e.field === field;
}
const simpleSprite = () => ({
  kind: 'sprite',
  positions: [-1, -1, 1, -1, -1, 1, 1, 1],
  colors: [
    [23, 47, 71, 211],
    [227, 199, 173, 83],
    [31, 151, 89, 239],
    [181, 61, 251, 127],
  ],
  uv: [0.25, 0.5, 0.5, 0.75],
});
const simpleRing = () => ({
  kind: 'ring',
  viewingAngle: 0,
  outerLocation: [2, 4],
  innerLocation: [1, -2],
  centerRatio: 0.5,
  colors: COLOR,
  uv: [0.25, 0.5, 0.5, 0.75],
});
for (const input of cases) {
  if (input.expectedUnsupported) {
    test('source-boundary:' + input.name, 'public-source-explicit-boundary', () => {
      assert.throws(() => buildCase(input), error(input.expectedUnsupported));
      const r = reference[input.name];
      assert.ok(
        [...r.positionsBits, ...r.deferredMatrixBits].some((x) => (x & 0x7f800000) === 0x7f800000),
      );
    });
  } else {
    test('public-source:' + input.name, 'public-source-exact-bits', () =>
      assert.deepEqual(output(buildCase(input)), reference[input.name]),
    );
  }
}
test('Fixed Sprite exact corner/color/UV and DX index order', 'exact-unit', () => {
  const b = new SpriteRingGeometry();
  b.beginNode('sprite', 1, { billboard: 2 }).append(matrix(3, 5, 7), simpleSprite());
  const m = b.endNode();
  assert.deepEqual(prefix(m.positions, 12), [2, 4, 7, 4, 4, 7, 2, 6, 7, 4, 6, 7]);
  assert.deepEqual(prefix(m.uv, 8), [0.25, 1.25, 0.75, 1.25, 0.25, 0.5, 0.75, 0.5]);
  assert.deepEqual(prefix(m.indices, 6), [3, 1, 0, 3, 0, 2]);
  assert.deepEqual(prefix(m.colors, 4), [23, 47, 71, 211]);
  assert.equal(m.coordinateSpace, 'world');
  assert.equal(m.deferredMatrix43, null);
  assert.equal(m.flushBefore, false);
});
test('Ring single keeps local vertices and owns its copied deferred matrix', 'exact-unit', () => {
  const b = new SpriteRingGeometry(),
    m = matrix(10, 20, 30);
  b.beginNode('ring', 1, { billboard: 2, vertexCount: 1 }).append(m, simpleRing());
  const out = b.endNode();
  assert.deepEqual(prefix(out.positions, 3), [2, -0, 4]);
  assert.deepEqual(prefix(out.deferredMatrix43, 12), m);
  assert.equal(out.coordinateSpace, 'local');
  assert.equal(out.flushBefore, true);
  assert.equal(out.flushAfter, true);
  m[9] = 999;
  assert.equal(out.deferredMatrix43[9], 10);
});
test('Ring node count rather than submitted count chooses CPU bake', 'exact-unit', () => {
  const b = new SpriteRingGeometry();
  b.beginNode('ring', 2, { billboard: 2, vertexCount: 1 }).append(matrix(10, 20, 30), simpleRing());
  const out = b.endNode();
  assert.deepEqual(prefix(out.positions, 3), [12, 20, 34]);
  assert.equal(out.coordinateSpace, 'world');
  assert.equal(out.deferredMatrix43, null);
  assert.equal(out.flushBefore, false);
  assert.equal(out.flushAfter, false);
  assert.equal(out.vertexCount, 16);
  assert.equal(out.cursorVertexCount, 8);
  assert.ok(out.colors.slice(32, 64).every((x) => x === 0));
});
test('Ring outer/center/inner colors and center seam copies', 'exact-unit', () => {
  const b = new SpriteRingGeometry();
  b.beginNode('ring', 1, { billboard: 2, vertexCount: 1 }).append(I, simpleRing());
  const out = b.endNode();
  assert.deepEqual(prefix(out.colors, 32), [
    ...COLOR[0],
    ...COLOR[1],
    ...COLOR[0],
    ...COLOR[1],
    ...COLOR[1],
    ...COLOR[2],
    ...COLOR[1],
    ...COLOR[2],
  ]);
  assert.deepEqual(prefix(out.positions, 6), [2, -0, 4, 1.5, -0, 1]);
  assert.deepEqual(
    prefix(out.uv, 16),
    [
      0.25, 0.5, 0.25, 0.875, 0.75, 0.5, 0.75, 0.875, 0.25, 0.875, 0.25, 1.25, 0.75, 0.875, 0.75,
      1.25,
    ],
  );
  assert.deepEqual(prefix(out.indices, 12), [3, 1, 0, 3, 0, 2, 7, 5, 4, 7, 4, 6]);
});
test(
  'full-circle local recurrence is not replaced by forced seam closure',
  'source-fact-unit',
  () => {
    const out = buildCase(cases.find((x) => x.name === 'ring-full-circle-step-recurrence')),
      last = (8 - 1) * 8 + 2;
    assert.notDeepEqual(
      bits(prefix(out.positions, 3)),
      bits(prefix(out.positions.slice(last * 3, last * 3 + 3), 3)),
    );
  },
);
test(
  'active bulk helper keeps a different operation tree from sequential Transform',
  'source-fact-unit',
  () => {
    const bulkCase = cases.find((x) => x.name === 'ring-bulk-paired-tree-cancellation');
    const localCase = { ...bulkCase, sourceCount: 1 },
      local = buildCase(localCase);
    const bulk = buildCase(bulkCase),
      point = new Float32Array(3),
      sequential = [];
    for (let i = 0; i < local.vertexCount; i++) {
      point.set(local.positions.subarray(i * 3, i * 3 + 3));
      transformVector43(point, localCase.instances[0].matrix, point);
      sequential.push(...point);
    }
    assert.equal(sequential[0], 0);
    assert.equal(bulk.positions[0], 1);
    assert.notDeepEqual(bits(sequential), bits(prefix(bulk.positions, local.vertexCount * 3)));
  },
);
test('Sprite traversal order remains the submitted order', 'exact-unit', () => {
  const b = new SpriteRingGeometry();
  b.beginNode('sprite', 2, { billboard: 2 });
  b.append(matrix(0, 8, 0), simpleSprite());
  b.append(matrix(0, -3, 0), simpleSprite());
  const out = b.endNode();
  assert.equal(out.positions[1], 7);
  assert.equal(out.positions[13], -4);
});
test('reserved Sprite tail is explicitly zero', 'exact-unit', () => {
  const out = buildCase(cases.find((x) => x.name === 'sprite-partial-reserved-zero-tail'));
  assert.equal(out.vertexCount, 12);
  assert.equal(out.cursorVertexCount, 4);
  assert.ok(out.colors.slice(16, 48).every((x) => x === 0));
  assert.ok(out.positions.slice(12, 36).every((x) => Object.is(x, 0)));
});
for (const name of ['sprite-mode3-two', 'ring-mode2-single-local', 'ring-mode3-multi-world']) {
  test('warm-zero-typed-allocation:' + name, 'buffer-reuse', () => {
    const input = cases.find((x) => x.name === name),
      b = new SpriteRingGeometry(),
      first = buildCase(input, b);
    const p = first.positions,
      u = first.uv,
      c = first.colors,
      ix = first.indices,
      d = first.deferredMatrix43;
    const F = globalThis.Float32Array,
      U8 = globalThis.Uint8Array,
      U32 = globalThis.Uint32Array;
    let allocations = 0;
    globalThis.Float32Array = class extends F {
      constructor(...args) {
        super(...args);
        allocations++;
      }
    };
    globalThis.Uint8Array = class extends U8 {
      constructor(...args) {
        super(...args);
        allocations++;
      }
    };
    globalThis.Uint32Array = class extends U32 {
      constructor(...args) {
        super(...args);
        allocations++;
      }
    };
    try {
      for (let i = 0; i < 30; i++) assert.equal(buildCase(input, b), first);
    } finally {
      globalThis.Float32Array = F;
      globalThis.Uint8Array = U8;
      globalThis.Uint32Array = U32;
    }
    assert.equal(allocations, 0);
    assert.equal(first.positions, p);
    assert.equal(first.uv, u);
    assert.equal(first.colors, c);
    assert.equal(first.indices, ix);
    assert.equal(first.deferredMatrix43, d);
  });
}
test('Ring single to multi to Sprite resets deferred and flush state', 'lifecycle-unit', () => {
  const b = new SpriteRingGeometry();
  const first = buildCase(
      cases.find((x) => x.name === 'ring-mode2-single-local'),
      b,
    ),
    storage = first.deferredMatrix43;
  const multi = buildCase(
    cases.find((x) => x.name === 'ring-mode2-multi-world'),
    b,
  );
  assert.equal(multi.deferredMatrix43, null);
  assert.equal(multi.flushBefore, false);
  assert.equal(multi.flushAfter, false);
  const sprite = buildCase(
    cases.find((x) => x.name === 'sprite-mode2-one'),
    b,
  );
  assert.equal(sprite.deferredMatrix43, null);
  assert.equal(sprite.coordinateSpace, 'world');
  const last = buildCase(
    cases.find((x) => x.name === 'ring-mode2-single-local'),
    b,
  );
  assert.equal(last.deferredMatrix43, storage);
});
test('reuse clears old nonzero positions in a later partial reservation', 'lifecycle-unit', () => {
  const b = new SpriteRingGeometry();
  buildCase(
    cases.find((x) => x.name === 'sprite-mode2-two'),
    b,
  );
  const input = structuredClone(cases.find((x) => x.name === 'sprite-mode2-two'));
  input.instances.pop();
  const out = buildCase(input, b);
  assert.ok(out.positions.slice(12, 24).every((x) => Object.is(x, 0)));
  assert.ok(out.colors.slice(16, 32).every((x) => x === 0));
});
for (const kind of ['sprite', 'ring']) {
  test('sealed CPU state fresh restore feeds ' + kind + ' without new RNG', 'adapter-unit', () => {
    let draws = 0;
    const rng = {
      nextInt() {
        draws++;
        return 16384;
      },
    };
    const random = (value) => ({ type: 'random', mode: 0, min: value, max: value });
    const renderer =
      kind === 'sprite'
        ? {
            type: 'sprite',
            billboard: 2,
            positions: [-1, -1, 1, -1, -1, 1, 1, 1],
            vertexColors: null,
            color: random([93, 127, 211, 229]),
          }
        : {
            type: 'ring',
            billboard: 2,
            vertexCount: 3,
            viewingAngle: { type: 'fixed', value: 240 },
            outerLocation: { type: 'fixed', value: [3.75, 0.5] },
            innerLocation: { type: 'fixed', value: [1.25, -0.75] },
            centerRatio: { type: 'fixed', value: 0.375 },
            colors: COLOR.map(random),
          };
    const node = {
      renderer,
      texture: {
        uv: { type: 'fixed', rectangle: [0.125, 0.25, 0.5, 0.75] },
        fadeIn: null,
        fadeOut: null,
      },
    };
    let state = initializeInstance(node, rng, { livingTime: 2, livedTime: 10, sequence: 1 });
    const before = draws,
      saved = snapshotRendererState(state);
    assert.equal(before, kind === 'sprite' ? 4 : 12);
    const run = (s) => {
      const b = new SpriteRingGeometry(),
        out = createRenderOutput(kind);
      renderColorEvaluation(node, s, { livingTime: 2, livedTime: 10, sequence: 1 }, { out });
      b.beginNode(kind, 1, renderer).append(matrix(3, 5, 7), out, CAMERA);
      return output(b.endNode());
    };
    const a = run(state);
    state = restoreRendererState(saved);
    assert.deepEqual(run(state), a);
    assert.equal(draws, before);
    assert.deepEqual(snapshotRendererState(state), saved);
    assert.ok(a.colors.some((x) => x !== 0));
    assert.ok(a.positionsBits.some((x) => x !== 0));
  });
}
test('no internal random call and no input mutation', 'lifecycle-unit', () => {
  const input = cases.find((x) => x.name === 'ring-mode3-multi-world'),
    saved = JSON.stringify(input),
    random = Math.random;
  Math.random = () => {
    throw Error('internal RNG');
  };
  try {
    buildCase(input);
  } finally {
    Math.random = random;
  }
  assert.equal(JSON.stringify(input), saved);
});
test('single Ring without a current matrix is a concrete pending error', 'error-boundary', () => {
  const b = new SpriteRingGeometry();
  b.beginNode('ring', 1, { billboard: 2, vertexCount: 3 });
  assert.throws(() => b.endNode(), error('ring.deferred-matrix-unset'));
});
test('zero ring division is rejected explicitly', 'error-boundary', () => {
  assert.throws(
    () => new SpriteRingGeometry().beginNode('ring', 1, { billboard: 2, vertexCount: 0 }),
    error('ring.vertexCount'),
  );
});
test('unknown billboard errors without normalizing it', 'error-boundary', () => {
  assert.throws(
    () => new SpriteRingGeometry().beginNode('sprite', 1, { billboard: 4 }),
    error('billboard'),
  );
});
test('model or distortion is not presented as normal geometry', 'error-boundary', () => {
  assert.throws(
    () => new SpriteRingGeometry().beginNode('model', 1, { billboard: 2 }),
    error('kind'),
  );
  assert.throws(
    () => new SpriteRingGeometry().beginNode('sprite', 1, { billboard: 2, distortion: true }),
    error('distortion'),
  );
});
test('capacity overflow errors rather than skips', 'error-boundary', () => {
  assert.throws(
    () =>
      new SpriteRingGeometry({ maxVertices: 8 }).beginNode('ring', 2, {
        billboard: 2,
        vertexCount: 1,
      }),
    error('capacity'),
  );
});
test('nonfinite ring values report their operation', 'error-boundary', () => {
  const b = new SpriteRingGeometry(),
    value = simpleRing();
  value.viewingAngle = Infinity;
  b.beginNode('ring', 1, { billboard: 2, vertexCount: 1 });
  assert.throws(() => b.append(I, value), error('ring.viewingAngle'));
});
test('malformed color does not clamp into support', 'error-boundary', () => {
  const b = new SpriteRingGeometry(),
    value = simpleSprite();
  value.colors[0][0] = 256;
  b.beginNode('sprite', 1, { billboard: 2 });
  assert.throws(() => b.append(I, value), error('color'));
});
test('node lifecycle and submission overflow error', 'error-boundary', () => {
  const b = new SpriteRingGeometry();
  assert.throws(() => b.append(I, simpleSprite()), error('append'));
  b.beginNode('sprite', 1, { billboard: 2 });
  assert.throws(() => b.beginNode('sprite', 1, { billboard: 2 }), error('beginNode'));
  b.append(I, simpleSprite());
  assert.throws(() => b.append(I, simpleSprite()), error('source-count'));
  b.endNode();
  assert.throws(() => b.endNode(), error('endNode'));
});
