// SPDX-License-Identifier: MPL-2.0
import { identity, scaling } from '../motion/matrix.mjs';
import { roundX87Single } from './x87.mjs';

const f = Math.fround;
// Scalar D3DX MatrixMultiply and Vec4Transform in both reviewed executables.
const matrixOrders = [
  [3, 0, 2, 1],
  [1, 3, 2, 0],
  [3, 0, 2, 1],
  [3, 2, 0, 1],
  [3, 0, 1, 2],
  [2, 3, 1, 0],
  [1, 3, 0, 2],
  [1, 3, 2, 0],
  [3, 0, 1, 2],
  [3, 2, 1, 0],
  [1, 0, 3, 2],
  [3, 2, 1, 0],
  [3, 2, 0, 1],
  [3, 1, 2, 0],
  [2, 1, 0, 3],
  [3, 1, 0, 2],
];
const vectorOrders = [
  [3, 1, 2, 0],
  [3, 1, 0, 2],
];

const round53 = (value) => value;
const positiveZero = (value) => (value === 0 ? 0 : value);
function dot(left, right, row, column, [a, b, c, d], round) {
  const first = round(left[row + a] * right[column + a * 4]);
  const second = round(left[row + b] * right[column + b * 4]);
  const third = round(left[row + c] * right[column + c * 4]);
  const fourth = round(left[row + d] * right[column + d * 4]);
  return f(round(round(round(first + second) + third) + fourth));
}
function multiply(left, right, round) {
  const matrix = Array(16);
  for (let i = 0; i < 16; i++) matrix[i] = dot(left, right, i & ~3, i & 3, matrixOrders[i], round);
  return matrix;
}
function transform(vector, matrix, round) {
  return [
    dot(vector, matrix, 0, 0, vectorOrders[0], round),
    dot(vector, matrix, 0, 1, vectorOrders[1], round),
    dot(vector, matrix, 0, 2, vectorOrders[1], round),
    dot(vector, matrix, 0, 3, vectorOrders[1], round),
  ];
}
function rotation(axis, [cos, sin]) {
  const matrix = identity();
  if (axis === 0) [matrix[5], matrix[6], matrix[9], matrix[10]] = [cos, sin, -sin, cos];
  if (axis === 1) [matrix[0], matrix[2], matrix[8], matrix[10]] = [cos, -sin, sin, cos];
  if (axis === 2) [matrix[0], matrix[1], matrix[4], matrix[5]] = [cos, sin, -sin, cos];
  return matrix;
}

export function nativeParticleNear(priority) {
  return f(f(65000 - f(priority)) - 1000);
}

// The caller gates this path on the original scalar dispatch, nearest
// rounding and masked exceptions. Trigonometry uses the guest's FSINCOS.
export function projectNativeParticle(
  particle,
  { width, height, priority, alpha, zShift, screenMatrix, screenShift },
  sincos,
  precision,
) {
  const round = precision === 24 ? roundX87Single : round53,
    halfX = (width >>> 0) >>> 1,
    halfY = (height >>> 0) >>> 1,
    near = nativeParticleNear(priority);
  if (!particle.scale.every(Number.isFinite) || !particle.pos.every(Number.isFinite)) return null;
  // The original multiplies the scale by identity. Every stored zero in
  // this affine matrix has a positive zero term, including a -0 scale.
  let matrix = scaling(...particle.scale.map(positiveZero));
  for (let axis = 0; axis < 3; axis++) {
    if (particle.rot[axis])
      matrix = multiply(matrix, rotation(axis, sincos(particle.rot[axis])), round);
  }
  if (!matrix.every(Number.isFinite)) return null;
  // Multiplication by translation changes only the last row of this
  // affine matrix, whose preceding three entries are all positive zero.
  for (let axis = 0; axis < 3; axis++) matrix[12 + axis] = positiveZero(particle.pos[axis]);
  return particle.vertices.map((vertex) => {
    let position = transform(
      [
        f(vertex.x - particle.base[0]),
        f(vertex.y - particle.base[1]),
        f(vertex.z - particle.base[2]),
        vertex.w ?? 1,
      ],
      matrix,
      round,
    );
    position[2] = f(65000 - f(position[2] + f(priority)));
    position[0] = f(position[0] - halfX);
    position[1] = f(position[1] - halfY);
    const denominator = position[2] === near ? 1 : f(position[2] - near),
      scale = f(1000 / denominator),
      size = scale < 0 ? 0 : positiveZero(scale),
      perspective = scaling(size, size, f(1 / 65000));
    perspective[15] = positiveZero(f(1 / denominator));
    position = transform(position, perspective, round);
    position[0] = f(position[0] + halfX);
    position[1] = f(position[1] + halfY);
    position = transform(position, screenMatrix, round);
    const color = vertex.color >>> 0,
      opacity = (Math.imul(color >>> 24, alpha) >>> 8) & 255;
    return {
      x: f(screenShift[0] + position[0]),
      y: f(screenShift[1] + position[1]),
      z: f(position[2] - zShift),
      w: position[3],
      color: ((color & 0xffffff) | (opacity << 24)) >>> 0,
      u: vertex.u,
      v: vertex.v,
    };
  });
}
