// SPDX-License-Identifier: MPL-2.0
import {
  identity,
  multiply,
  rotation,
  scaling,
  translation,
  transform,
} from '../motion/matrix.mjs';
import { readPPIRecord } from './abi.mjs';
const f = Math.fround;

// Produce the native pretransformed XYZRHW+DIFFUSE+UV triangle-strip records.
// The projection is not a conventional camera: z and reciprocal-w have distinct
// scales, and the original vertex w participates in texture interpolation.
export function projectParticle(
  particle,
  {
    width,
    height,
    priority = 0,
    alpha = 256,
    zShift = 0,
    screenMatrix = identity(),
    screenShift = [0, 0],
  } = {},
) {
  let matrix = scaling(...particle.scale);
  for (const [index, axis] of ['x', 'y', 'z'].entries())
    matrix = multiply(matrix, rotation(axis, particle.rot[index]));
  matrix = multiply(matrix, translation(...particle.pos));
  const halfX = (width >>> 0) >>> 1,
    halfY = (height >>> 0) >>> 1,
    near = f(f(65000 - f(priority)) - 1000);
  return particle.vertices.map((vertex) => {
    let position = transform(
      [
        f(vertex.x - particle.base[0]),
        f(vertex.y - particle.base[1]),
        f(vertex.z - particle.base[2]),
        vertex.w ?? 1,
      ],
      matrix,
    );
    const depth = f(65000 - f(position[2] + f(priority))),
      denominator = depth === near ? 1 : f(depth - near),
      scale = Math.max(0, f(1000 / denominator));
    position = [
      f(f(f(position[0] - halfX) * scale) + halfX),
      f(f(f(position[1] - halfY) * scale) + halfY),
      f(depth * f(1 / 65000)),
      f(position[3] * f(1 / denominator)),
    ];
    position = transform(position, screenMatrix);
    position[0] = f(position[0] + screenShift[0]);
    position[1] = f(position[1] + screenShift[1]);
    position[2] = f(position[2] - zShift);
    const color = vertex.color >>> 0,
      opacity = (Math.imul(color >>> 24, alpha) >>> 8) & 255;
    return {
      x: position[0],
      y: position[1],
      z: position[2],
      w: position[3],
      color: ((color & 0xffffff) | (opacity << 24)) >>> 0,
      u: vertex.u,
      v: vertex.v,
    };
  });
}

export function scriptParticles(instance) {
  return Array.from({ length: instance.count }, (_, i) => ({
    vertices: instance.vertices(i),
    base: [...instance.bases.subarray(i * 4, i * 4 + 3)],
    pos: [...instance.positions.subarray(i * 4, i * 4 + 3)],
    rot: [...instance.rotations.subarray(i * 4, i * 4 + 3)],
    scale: [...instance.scales.subarray(i * 4, i * 4 + 3)],
    disp: instance.visibility[i],
  }));
}
export function ppiParticles(instance) {
  const bytes = instance.records();
  return Array.from({ length: instance.count }, (_, i) => readPPIRecord(bytes, i * 148));
}
export function particleGeometry(particles, options) {
  const shifts = options.zShifts || [];
  const order = particles
    .map((p, index) => ({
      index,
      depth: f(f(f(p.pos[2] + p.base[2]) + p.vertices[0].z) - f((shifts[index] || 0) * 65000)),
    }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index);
  // Native 5F5280 indexes the final shift by sorted rank, while sort depth uses
  // original particle index. Retain this observable asymmetry.
  return order.flatMap(({ index }, rank) =>
    particles[index].disp
      ? [
          {
            index,
            vertices: projectParticle(particles[index], { ...options, zShift: shifts[rank] || 0 }),
          },
        ]
      : [],
  );
}
