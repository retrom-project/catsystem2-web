// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMotionObject, MOTION_ABI, setMotionVector } from '../src/motion/abi.mjs';
import {
  rectangleTriangles,
  transformNativeTriangles,
  nativeVertexBounds,
} from '../src/render/native-geometry.mjs';
import { nativeMeshGeometry } from '../src/native/mesh.mjs';
import { divideNativeTriangles, nativeDivisionLayout } from '../src/native/divided-model.mjs';
import {
  nativeTexturedGeometry,
  nativeTexturedPageBounds,
} from '../src/render/native-textured-geometry.mjs';

function fixture() {
  return {
    graph: {
      type: 1,
      vram: true,
      width: 47,
      height: 31,
      kx2: initialMotionObject(),
      textureTransform: initialMotionObject(),
      matrixExplicit: false,
      textureMatrixExplicit: false,
    },
    state: { colorOverride: 0, coordMode: 0 },
    projection: { width: 1280, height: 720 },
    layout: { configurationSize: [16, 16], grid: [4, 3] },
  };
}

// The uncached source transform/division/projection composition. The division
// kernel also has independent original-engine polygon/UV golden fixtures.
function uncached({ graph, state, projection, layout }, includesPage = null) {
  const source = graph.textureTransform.slice(),
    sourcePosition = new DataView(source.buffer, source.byteOffset, source.byteLength),
    object = new DataView(graph.kx2.buffer, graph.kx2.byteOffset, graph.kx2.byteLength),
    position = Array.from({ length: 3 }, (_, index) =>
      Math.fround(
        sourcePosition.getFloat32(MOTION_ABI.pos + index * 4, true) +
          object.getFloat32(MOTION_ABI.vram + index * 4, true),
      ),
    );
  setMotionVector(source, MOTION_ABI.pos, position);
  const triangles = transformNativeTriangles(graph.triangles || rectangleTriangles(graph), source, {
      useEuler: !graph.textureMatrixExplicit,
    }),
    division = nativeDivisionLayout(
      layout.configurationSize,
      layout.grid,
      layout.textureCaps?.guardBand,
    ),
    divided = {
      ...graph,
      mesh: divideNativeTriangles(triangles, division, position, includesPage),
    };
  return nativeMeshGeometry(divided, state, projection);
}
const draw = ({ graph, state, projection, layout }, deform) =>
  nativeTexturedGeometry(graph, state, projection, layout, deform);
const check = (input) => {
  const expected = uncached(input);
  assert.deepEqual(draw(input), expected);
  assert.deepEqual(draw(input), expected);
  return expected;
};

test('repeated source clips keep output and deformation records independently owned', () => {
  const input = fixture(),
    expected = check(input);
  assert.ok(expected.length > 20);
  const first = draw(input),
    second = draw(input);
  first[0].vertices[0].x = 10000;
  first[0].textureID = -1;
  first.splice(1);
  assert.deepEqual(second, expected);
  assert.deepEqual(draw(input), expected);
  const visits = [];
  draw(input, (graph, vertices, id) => {
    visits.push(id);
    // The deformation callback sees only this invocation's divided records.
    graph.mesh[0].vertices[0].x = -20000;
    return vertices;
  });
  assert.equal(visits.length, expected.length);
  assert.deepEqual(draw(input), expected);
  assert.deepEqual(draw(structuredClone(input)), expected);
});

test('live source vertices, transforms, offsets and same-buffer views invalidate XY clips', () => {
  const input = fixture(),
    { graph } = input;
  check(input);
  for (const [offset, value] of [
    [MOTION_ABI.pos, [4.25, 2.5, 0]],
    [MOTION_ABI.rotation, [0, 0, 0.17]],
    [MOTION_ABI.scale, [0.75, 1.125, 1]],
  ]) {
    setMotionVector(graph.textureTransform, offset, value);
    check(input);
  }
  setMotionVector(graph.kx2, MOTION_ABI.vram, [12.5, -3.75, 0]);
  check(input);
  const buffer = new ArrayBuffer(2 * MOTION_ABI.objectSize + 11),
    a = new Uint8Array(buffer, 3, MOTION_ABI.objectSize),
    b = new Uint8Array(buffer, MOTION_ABI.objectSize + 7, MOTION_ABI.objectSize);
  a.set(graph.textureTransform);
  b.set(initialMotionObject());
  setMotionVector(b, MOTION_ABI.pos, [7.125, 3.875, 0]);
  graph.textureTransform = a;
  check(input);
  graph.textureTransform = b;
  check(input);
  setMotionVector(b, MOTION_ABI.scale, [1.25, 0.5, 1]);
  check(input);
  graph.kx2 = a;
  check(input);
  graph.triangles = rectangleTriangles(graph);
  check(input);
  graph.triangles[0][1].x = Math.fround(graph.triangles[0][1].x - 4.25);
  check(input);
  graph.triangles[1][2].y = Math.fround(graph.triangles[1][2].y + 7.5);
  check(input);
  graph.textureMatrixExplicit = true;
  check(input);
  new DataView(b.buffer, b.byteOffset, b.byteLength).setFloat32(MOTION_ABI.matrix, 0.625, true);
  check(input);
});

test('layout, current output color/position and projection remain live after warm clips', () => {
  const input = fixture();
  check(input);
  input.layout.configurationSize[0] = 20;
  check(input);
  input.layout.grid[1] = 4;
  check(input);
  input.layout.textureCaps = { guardBand: [-2, -2, 2, 2] };
  check(input);
  input.graph.width = 56.125;
  input.graph.height = 37.75;
  check(input);
  const view = new DataView(input.graph.kx2.buffer);
  view.setUint32(MOTION_ABI.color, 0x7f123456, true);
  input.state.colorOverride = 1;
  setMotionVector(input.graph.kx2, MOTION_ABI.pos, [13.25, 8.5, 3]);
  check(input);
  input.projection.screenShift = [2.25, -4.5];
  input.projection.cameraNear = 300;
  input.state.coordMode = 1;
  check(input);
  input.layout.configurationSize[0] = 0;
  assert.throws(() => draw(input), /zero-sized cell/);
});

test('every dirty-page query runs in the original cell order, including changing answers', () => {
  const input = fixture();
  check(input);
  for (const pass of [0, 1, 2, 0]) {
    const expectedVisits = [],
      actualVisits = [],
      choose = (visits) => (id) => {
        visits.push(id);
        return (id + visits.length + pass) % 3 === 0;
      },
      expected = nativeVertexBounds(uncached(input, choose(expectedVisits))),
      actual = nativeTexturedPageBounds(input.graph, input.state, input.projection, {
        layout: input.layout,
        isDirty: choose(actualVisits),
      });
    assert.ok(expectedVisits.length > 20);
    assert.deepEqual(actualVisits, expectedVisits);
    assert.deepEqual(actual, expected);
  }
  check(input);
});

test('callback/accessor and oversized source shapes retain the uncached calculation', () => {
  const input = fixture();
  check(input);
  input.graph.callback = true;
  check(input);
  delete input.graph.callback;
  let callbacksRead = 0;
  Object.defineProperty(input.graph, 'callback', {
    configurable: true,
    enumerable: true,
    get() {
      callbacksRead++;
      return false;
    },
  });
  draw(input);
  // Only the existing divided graph spread reads this property.
  assert.equal(callbacksRead, 1);
  delete input.graph.callback;
  input.graph.triangles = Array.from({ length: 65 }, () => rectangleTriangles(input.graph)[0]);
  check(input);
  input.graph.triangles = rectangleTriangles(input.graph);
  check(input);
});

test('clip admission cap recomputes additional cells and preserves later small layouts', () => {
  const input = fixture();
  input.layout.configurationSize = [8, 8];
  input.layout.grid = [20, 20];
  input.graph.width = 160;
  input.graph.height = 160;
  check(input);
  input.layout.grid = [3, 3];
  input.graph.width = 20;
  input.graph.height = 20;
  check(input);
});

test('float32 cell boundaries and live source edits keep the uncached operation order', () => {
  const input = fixture(),
    edges = [-0, 0, 0.0000001, 7.9999995, 8, 8.000001, 15.999999, 16, 16.000002];
  let seed = 0x9157ac23;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < 128; index++) {
    input.graph.x = edges[index % edges.length];
    input.graph.y = edges[(index * 3) % edges.length];
    input.graph.width = Math.fround(1 + random() * 39);
    input.graph.height = Math.fround(1 + random() * 28);
    setMotionVector(input.graph.textureTransform, MOTION_ABI.pos, [
      Math.fround(random() * 12 - 6),
      Math.fround(random() * 12 - 6),
      0,
    ]);
    setMotionVector(input.graph.textureTransform, MOTION_ABI.rotation, [
      0,
      0,
      Math.fround(random() * 0.7),
    ]);
    check(input);
  }
});
