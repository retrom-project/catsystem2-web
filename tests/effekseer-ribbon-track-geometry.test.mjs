// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import nodeTest from 'node:test';
import {
  RibbonTrackGeometry,
  EffekseerRibbonTrackGeometryError,
} from '../src/effekseer/ribbon-track-geometry.mjs';
import {
  initializeGroup,
  initializeInstance,
  beginRenderingGroup,
  createRenderOutput,
  renderColorEvaluation,
  advanceRenderingGroup,
  snapshotRendererState,
  restoreRendererState,
} from '../src/effekseer/render-state.mjs';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/effekseer/ribbon-track-cases.json', import.meta.url), 'utf8'),
);
const reference = JSON.parse(
  await readFile(
    new URL('./fixtures/effekseer/ribbon-track-reference.json', import.meta.url),
    'utf8',
  ),
);
const test = (name, _type, fn) => nodeTest(name, fn);
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const CAMERA = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const WHITE = [255, 255, 255, 255];
const COLORS = [WHITE, WHITE, WHITE, WHITE, WHITE, WHITE];
const matrix = (x, y, z) => [...I.slice(0, 9), x, y, z];
const positionsBits = (values, count) =>
  Array.from(new Uint32Array(Float32Array.from(Array.from(values).slice(0, count)).buffer));
function buildCase(input, builder = new RibbonTrackGeometry()) {
  builder.beginNode(input.kind, input.sourceCount, {
    viewpointDependent: input.viewpointDependent,
  });
  for (const group of input.groups) {
    builder.beginGroup(group.count, group.uv);
    for (let i = 0; i < group.instances.length; i++) {
      const instance = group.instances[i];
      builder.append(
        instance.matrix,
        { ...instance, kind: input.kind, instanceCount: group.count, instanceIndex: i },
        input.camera,
      );
    }
    builder.endGroup();
  }
  return builder.endNode();
}
function output(mesh) {
  return {
    vertexCount: mesh.vertexCount,
    cursorVertexCount: mesh.cursorVertexCount,
    completedSegmentQuadCount: mesh.completedSegmentQuadCount,
    positionsBits: positionsBits(mesh.positions, mesh.vertexCount * 3),
    uvBits: positionsBits(mesh.uv, mesh.vertexCount * 2),
    colors: Array.from(mesh.colors).slice(0, mesh.vertexCount * 4),
    indices: Array.from(mesh.indices).slice(0, mesh.indexCount),
  };
}
function error(field) {
  return (e) => e instanceof EffekseerRibbonTrackGeometryError && e.field === field;
}
function ribbon(index, count) {
  return {
    kind: 'ribbon',
    instanceIndex: index,
    instanceCount: count,
    positions: [-1, 1],
    colors: [
      [23, 47, 71, 211],
      [227, 199, 173, 83],
    ],
    uv: [9, 9, 9, 9],
  };
}
function track(index, count, sizes = [2, 6, 10], colors = COLORS) {
  return { kind: 'track', instanceIndex: index, instanceCount: count, sizes, colors };
}
for (const input of fixtures) {
  if (input.expectedUnsupported) {
    test('source-boundary:' + input.name, 'public-source-explicit-boundary', () => {
      assert.throws(() => buildCase(input), error(input.expectedUnsupported));
      assert.ok(reference[input.name].positionsBits.some((u) => (u & 0x7f800000) === 0x7f800000));
    });
  } else {
    test('public-source:' + input.name, 'public-source-exact-bits', () => {
      assert.deepEqual(output(buildCase(input)), reference[input.name]);
    });
  }
}
test('ribbon exact world positions, shear UV and original DX index order', 'exact-unit', () => {
  const builder = new RibbonTrackGeometry();
  builder.beginNode('ribbon', 2).beginGroup(2, [0.25, 0.5, 0.5, 1]);
  builder.append(I, ribbon(0, 2));
  builder.append(matrix(0, 2, 0), ribbon(1, 2));
  const mesh = builder.endGroup().endNode();
  assert.deepEqual(Array.from(mesh.positions).slice(0, 12), [-1, 0, 0, 1, 0, 0, -1, 2, 0, 1, 2, 0]);
  assert.deepEqual(Array.from(mesh.uv).slice(0, 8), [0.25, 0.5, 0.75, 1, 0.25, 1, 0.75, 1.5]);
  assert.deepEqual(Array.from(mesh.indices).slice(0, 6), [3, 1, 0, 3, 0, 2]);
  assert.deepEqual(Array.from(mesh.colors).slice(0, 8), [23, 47, 71, 211, 227, 199, 173, 83]);
});
test('middle ribbon section is copied to both adjacent quads', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('ribbon', 3).beginGroup(3, [0, 0, 1, 1]);
  for (let i = 0; i < 3; i++) b.append(matrix(0, i * 2, 0), ribbon(i, 3));
  const m = b.endGroup().endNode();
  for (const [x, y] of [
    [2, 4],
    [3, 5],
  ]) {
    assert.deepEqual(
      Array.from(m.positions).slice(x * 3, x * 3 + 3),
      Array.from(m.positions).slice(y * 3, y * 3 + 3),
    );
    assert.deepEqual(
      Array.from(m.uv).slice(x * 2, x * 2 + 2),
      Array.from(m.uv).slice(y * 2, y * 2 + 2),
    );
    assert.deepEqual(
      Array.from(m.colors).slice(x * 4, x * 4 + 4),
      Array.from(m.colors).slice(y * 4, y * 4 + 4),
    );
  }
  assert.equal(m.cursorVertexCount, 8);
  assert.equal(m.completedSegmentQuadCount, 2);
});
test('multiple groups reserve zero tail and reset their UV/index', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('ribbon', 4);
  for (let g = 0; g < 2; g++) {
    b.beginGroup(2, [g, 0.25, 1, 1]);
    for (let i = 0; i < 2; i++) b.append(matrix(g * 5, i, 0), ribbon(i, 2));
    b.endGroup();
  }
  const m = b.endNode();
  assert.equal(m.vertexCount, 12);
  assert.equal(m.cursorVertexCount, 8);
  assert.equal(m.quadCount, 3);
  assert.equal(m.completedSegmentQuadCount, 2);
  assert.ok(m.colors.slice(32, 48).every((x) => x === 0));
  assert.ok(m.positions.slice(24, 36).every((x) => Object.is(x, 0)));
  assert.deepEqual(Array.from(m.groupRanges).slice(0, 8), [0, 2, 2, 4, 4, 2, 2, 8]);
  assert.equal(m.uv[8], 1);
});
test('singleton groups do not access nonexistent matrix/color/UV', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('track', 2);
  for (let g = 0; g < 2; g++) {
    b.beginGroup(1);
    b.append(null, { kind: 'track', instanceCount: 1, instanceIndex: 0 });
    b.endGroup();
  }
  const m = b.endNode();
  assert.equal(m.vertexCount, 8);
  assert.equal(m.cursorVertexCount, 0);
  assert.ok(m.positions.every((x) => x === 0));
  assert.ok(m.colors.every((x) => x === 0));
});
test('partial Track retains raw sections until the actual last index', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('track', 4).beginGroup(4, [0, 0, 1, 1]);
  b.append(matrix(8, 9, 10), track(0, 4, [2, 10, 6]));
  b.append(matrix(11, 12, 13), track(1, 4, [2, 10, 6]));
  const m = b.endGroup().endNode();
  assert.equal(m.cursorVertexCount, 10);
  assert.equal(m.touchedVertexCount, 14);
  assert.equal(m.positions[0], -1);
  assert.equal(m.positions[6], -3);
  assert.deepEqual(Array.from(m.positions).slice(9, 12), [11, 12, 13]);
});
test('Track odd count floor boundary extrapolates/clamps colors', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('track', 3).beginGroup(3, [0, 0, 1, 1]);
  const c = [[0, 255, 0, 255], [255, 0, 255, 0], WHITE, WHITE, WHITE, WHITE];
  b.append(I, track(0, 3, [2, 2, 2], c));
  b.append(matrix(0, 1, 0), track(1, 3, [2, 2, 2], c));
  const m = b.endGroup().endNode();
  assert.equal(m.positions[6], -1);
  assert.deepEqual(Array.from(m.colors).slice(8, 12), [255, 0, 255, 0]);
});
test('Track UV is common v and does not reach one at final section', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('track', 4).beginGroup(4, [0.25, 0.5, 0.5, 0.75]);
  for (let i = 0; i < 4; i++) b.append(matrix(0, i, 0), track(i, 4, [0, 0, 0]), CAMERA);
  const m = b.endGroup().endNode();
  assert.deepEqual(Array.from(m.uv).slice(0, 4), [0.25, 0.5, 0.5, 0.5]);
  assert.equal(m.uv[22 * 2 + 1], 1.0625);
  assert.equal(m.uv[23 * 2], 0.75);
});
test('reversing caller order reverses geometry without a depth sort', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('ribbon', 2).beginGroup(2, [0, 0, 1, 1]);
  b.append(matrix(0, 7, 0), ribbon(0, 2));
  b.append(matrix(0, -3, 0), ribbon(1, 2));
  const m = b.endGroup().endNode();
  assert.equal(m.positions[1], 7);
  assert.equal(m.positions[7], -3);
});
test('Track ignores SRT rotation/scale and uses translations', 'exact-unit', () => {
  const original = structuredClone(
    fixtures.find((x) => x.name === 'track-ignores-rotation-scaling'),
  );
  const plain = structuredClone(original);
  for (const g of plain.groups)
    for (const instance of g.instances)
      instance.matrix = [...I.slice(0, 9), ...instance.matrix.slice(9)];
  assert.deepEqual(output(buildCase(original)), output(buildCase(plain)));
});
test('coincident centers collapse without an invented axis', 'exact-unit', () => {
  const m = buildCase(fixtures.find((x) => x.name === 'track-coincident-centers'));
  for (let i = 0; i < m.vertexCount; i++)
    assert.deepEqual(Array.from(m.positions).slice(i * 3, i * 3 + 3), [1, 2, 3]);
});
test(
  'warmed Ribbon typed buffers and output object are reused with zero typed allocations',
  'buffer-reuse',
  () => {
    const c = fixtures.find((x) => x.name === 'ribbon-affine3'),
      b = new RibbonTrackGeometry();
    const first = buildCase(c, b),
      p = first.positions,
      u = first.uv,
      v = first.colors,
      ix = first.indices,
      g = first.groupRanges;
    const F32 = globalThis.Float32Array,
      U8 = globalThis.Uint8Array,
      U32 = globalThis.Uint32Array;
    let allocations = 0;
    globalThis.Float32Array = class extends F32 {
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
      for (let i = 0; i < 30; i++) assert.equal(buildCase(c, b), first);
    } finally {
      globalThis.Float32Array = F32;
      globalThis.Uint8Array = U8;
      globalThis.Uint32Array = U32;
    }
    assert.equal(allocations, 0);
    assert.equal(first.positions, p);
    assert.equal(first.uv, u);
    assert.equal(first.colors, v);
    assert.equal(first.indices, ix);
    assert.equal(first.groupRanges, g);
  },
);
test('warmed Track facing pass uses no new typed arrays', 'buffer-reuse', () => {
  const c = fixtures.find((x) => x.name === 'track-odd5'),
    b = new RibbonTrackGeometry();
  const first = buildCase(c, b),
    p = first.positions,
    u = first.uv,
    v = first.colors,
    ix = first.indices;
  const F32 = globalThis.Float32Array,
    U8 = globalThis.Uint8Array,
    U32 = globalThis.Uint32Array;
  let allocations = 0;
  globalThis.Float32Array = class extends F32 {
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
    for (let i = 0; i < 30; i++) assert.equal(buildCase(c, b), first);
  } finally {
    globalThis.Float32Array = F32;
    globalThis.Uint8Array = U8;
    globalThis.Uint32Array = U32;
  }
  assert.equal(allocations, 0);
  assert.equal(first.positions, p);
  assert.equal(first.uv, u);
  assert.equal(first.colors, v);
  assert.equal(first.indices, ix);
});
test('a smaller frame clears previously filled reserved tail', 'exact-unit', () => {
  const b = new RibbonTrackGeometry();
  buildCase(
    fixtures.find((x) => x.name === 'ribbon-affine3'),
    b,
  );
  const m = buildCase(
    fixtures.find((x) => x.name === 'ribbon-singleton-groups-zero-reservation'),
    b,
  );
  assert.equal(m.vertexCount, 4);
  assert.ok(m.colors.slice(0, 16).every((x) => x === 0));
  assert.ok(m.positions.slice(0, 12).every((x) => Object.is(x, 0)));
});
test(
  'CPU-state output feeds geometry and fresh restored cache without reinitializing',
  'adapter-unit',
  () => {
    let draws = 0;
    const rng = {
      nextInt() {
        draws++;
        return 16384;
      },
    };
    const node = {
      renderer: {
        type: 'ribbon',
        viewpointDependent: false,
        positions: [-1, 1],
        vertexColors: null,
        color: { type: 'random', mode: 0, min: [93, 127, 211, 229], max: [93, 127, 211, 229] },
      },
      texture: {
        uv: { type: 'fixed', rectangle: [0.25, 0.5, 0.5, 1] },
        fadeIn: null,
        fadeOut: null,
      },
    };
    let group = initializeGroup(node, rng),
      state = initializeInstance(node, rng, { livingTime: 0, livedTime: 10, sequence: 1 });
    beginRenderingGroup(node, group, {
      instanceCount: 2,
      firstContext: { livingTime: 0, livedTime: 10, sequence: 1 },
    });
    const savedGroup = snapshotRendererState(group),
      savedState = snapshotRendererState(state),
      before = draws;
    assert.equal(before, 4); // Equal color bounds still consume four source CRT draws.
    const run = (g, s) => {
      const b = new RibbonTrackGeometry(),
        out = createRenderOutput('ribbon');
      b.beginNode('ribbon', 2).beginGroup(2, g.draw.uv);
      for (let i = 0; i < 2; i++) {
        renderColorEvaluation(
          node,
          s,
          { livingTime: 0, livedTime: 10, sequence: 1 },
          { group: g, out },
        );
        b.append(matrix(0, i * 2, 0), out);
        advanceRenderingGroup(g);
      }
      return output(b.endGroup().endNode());
    };
    const a = run(group, state);
    group = restoreRendererState(savedGroup);
    state = restoreRendererState(savedState);
    assert.deepEqual(run(group, state), a);
    assert.equal(draws, before);
    assert.ok(a.colors.some((x) => x !== 0));
    assert.ok(a.positionsBits.some((x) => x !== 0));
  },
);
test(
  'Track CPU group samples and fresh restored current state feed the geometry',
  'adapter-unit',
  () => {
    let draws = 0;
    const rng = {
      nextInt() {
        draws++;
        return 16384;
      },
    };
    const colors = [
      [5, 31, 77, 211],
      [239, 197, 151, 89],
      [17, 53, 101, 229],
      [223, 181, 139, 71],
      [29, 67, 113, 241],
      [199, 157, 127, 47],
    ];
    const node = {
      renderer: {
        type: 'track',
        sizes: [2, 6, 10],
        colors: colors.map((value) => ({ type: 'random', mode: 0, min: value, max: value })),
      },
      texture: {
        uv: { type: 'fixed', rectangle: [0.125, 0.25, 0.5, 0.75] },
        fadeIn: null,
        fadeOut: null,
      },
    };
    let group = initializeGroup(node, rng),
      state = initializeInstance(node, rng, { livingTime: 2.5, livedTime: 10, sequence: 1 });
    beginRenderingGroup(node, group, {
      instanceCount: 3,
      firstContext: { livingTime: 2.5, livedTime: 10, sequence: 1 },
    });
    const savedGroup = snapshotRendererState(group),
      savedState = snapshotRendererState(state),
      before = draws;
    assert.equal(before, 24);
    const run = (g, s) => {
      const b = new RibbonTrackGeometry(),
        out = createRenderOutput('track');
      b.beginNode('track', 3).beginGroup(3, g.draw.uv);
      for (let i = 0; i < 3; i++) {
        renderColorEvaluation(
          node,
          s,
          { livingTime: 2.5 + i, livedTime: 10, sequence: 1 },
          { group: g, out },
        );
        b.append(matrix(i, i * 2, -i), out, CAMERA);
        advanceRenderingGroup(g);
      }
      return output(b.endGroup().endNode());
    };
    const a = run(group, state);
    group = restoreRendererState(savedGroup);
    state = restoreRendererState(savedState);
    assert.deepEqual(run(group, state), a);
    assert.equal(draws, before);
    assert.ok(a.colors.some((x) => x !== 0));
  },
);
test('geometry does not call an internal random source', 'exact-unit', () => {
  const original = Math.random;
  Math.random = () => {
    throw Error('unexpected random draw');
  };
  try {
    buildCase(fixtures.find((x) => x.name === 'track-even4'));
  } finally {
    Math.random = original;
  }
});
test('unknown node type errors', 'error-boundary', () => {
  assert.throws(() => new RibbonTrackGeometry().beginNode('stripe', 3), error('kind'));
});
test('distortion is not passed off as ordinary geometry', 'error-boundary', () => {
  assert.throws(
    () => new RibbonTrackGeometry().beginNode('ribbon', 3, { distortion: true }),
    error('distortion'),
  );
});
test('oversized source reservation errors instead of silently skipping', 'error-boundary', () => {
  assert.throws(
    () => new RibbonTrackGeometry({ maxVertices: 4 }).beginNode('track', 2),
    error('capacity'),
  );
});
test('out-of-order indices error', 'error-boundary', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('ribbon', 2).beginGroup(2, [0, 0, 1, 1]);
  assert.throws(() => b.append(I, ribbon(1, 2)), error('instance-order'));
});
test('missing source first UV errors for nontrivial group', 'error-boundary', () => {
  assert.throws(
    () => new RibbonTrackGeometry().beginNode('ribbon', 2).beginGroup(2),
    error('group.firstUV'),
  );
});
test(
  'out-of-reservation old stale-cache branch errors before writing outside typed output',
  'error-boundary',
  () => {
    const b = new RibbonTrackGeometry();
    b.beginNode('track', 2).beginGroup(4, [0, 0, 1, 1]);
    b.append(I, track(0, 4));
    assert.throws(() => b.append(I, track(1, 4)), error('source-write-range'));
  },
);
test('invalid color does not clamp malformed input into support', 'error-boundary', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('ribbon', 2).beginGroup(2, [0, 0, 1, 1]);
  const out = ribbon(0, 2);
  out.colors[0][0] = 256;
  assert.throws(() => b.append(I, out), error('color'));
});
test('nonfinite affine input errors', 'error-boundary', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('ribbon', 2).beginGroup(2, [0, 0, 1, 1]);
  const m = [...I];
  m[0] = Infinity;
  assert.throws(() => b.append(m, ribbon(0, 2)), error('matrix43'));
});
test('end before group finish errors', 'error-boundary', () => {
  const b = new RibbonTrackGeometry();
  b.beginNode('ribbon', 2).beginGroup(2, [0, 0, 1, 1]);
  assert.throws(() => b.endNode(), error('endNode'));
});
