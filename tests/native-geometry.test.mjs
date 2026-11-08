// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectNativeTriangle,
  transformNativeTriangles,
  rectangleTriangles,
} from '../src/render/native-geometry.mjs';
import { MOTION_ABI, initialMotionObject, setMotionVector } from '../src/motion/abi.mjs';
import { translation } from '../src/motion/matrix.mjs';
const vertex = (x, y, z) => ({ x, y, z, color: 0xff112233, u: 0.25, v: 0.5 });

test('solid and textured native triangles retain distinct zero-z projection contracts', () => {
  const triangle = [vertex(100, 100, 0), vertex(200, 100, 500), vertex(100, 200, 0)],
    options = { width: 800, height: 600, position: [0, 0, 0], cameraNear: 1000, priority: 0 };
  const solid = projectNativeTriangle(triangle, options),
    textured = projectNativeTriangle(triangle, { ...options, textured: true });
  assert.equal(solid[0].w, 1);
  assert.equal(solid[2].w, 1);
  assert.equal(textured[0].w, Math.fround(1 / 1000));
  assert.equal(solid[1].x, 400);
  assert.equal(textured[1].x, 400);
  const flat = projectNativeTriangle(
    triangle.map((v) => ({ ...v, z: 0 })),
    { ...options, textured: true },
  );
  assert.deepEqual(
    flat.map((v) => v.w),
    [1, 1, 1],
  );
});

test('native graph base-z is drawing priority and scale precedes its explicit matrix', () => {
  const bytes = initialMotionObject(),
    view = new DataView(bytes.buffer);
  setMotionVector(bytes, MOTION_ABI.base, [5, 7, 9000]);
  setMotionVector(bytes, MOTION_ABI.pos, [10, 20, 30]);
  setMotionVector(bytes, MOTION_ABI.scale, [2, 3, 4]);
  translation(1, 2, 3).forEach((v, i) => view.setFloat32(MOTION_ABI.matrix + i * 4, v, true));
  const result = transformNativeTriangles(
    [[vertex(8, 11, 2), vertex(8, 11, 2), vertex(8, 11, 2)]],
    bytes,
  )[0][0];
  assert.deepEqual([result.x, result.y, result.z], [17, 34, 41]);
  assert.equal(result.color, 0xff112233);
});

test('native rectangle meshes retain signed extents and original triangle diagonals', () => {
  const triangles = rectangleTriangles({
    x: 20,
    y: 30,
    z: 4,
    width: -10,
    height: 50,
    colors: [1, 2, 3, 4],
  });
  assert.deepEqual(
    triangles.map((triangle) => triangle.map(({ x, y, color }) => [x, y, color])),
    [
      [
        [20, 30, 1],
        [10, 30, 2],
        [10, 80, 4],
      ],
      [
        [20, 30, 1],
        [20, 80, 3],
        [10, 80, 4],
      ],
    ],
  );
});
