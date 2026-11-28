// SPDX-License-Identifier: MPL-2.0
import { initialParticle } from '../../src/ppi/abi.mjs';
import { particleDepthOrder } from '../../src/ppi/geometry.mjs';
export function projectionInput() {
  const quad = initialParticle(23, 31).vertices;
  let state = 1;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32 - 0.5,
    vector = (range) => Array.from({ length: 3 }, () => Math.fround(next() * range));
  const particles = Array.from({ length: 128 }, (_, i) => ({
    base: vector(20),
    pos: vector(1900),
    rot: i % 3 ? vector(70) : [0, -0, 0],
    scale: vector(6),
    disp: Number(i % 13 !== 0),
    vertices: quad.map((vertex) => {
      const [x, y, z] = vector(160);
      return { ...vertex, x, y, z, w: Math.fround(4 * next()), color: 0xa7123456 };
    }),
  }));
  particles[0] = {
    ...initialParticle(4, 4),
    base: [0, 0, 0],
    pos: [0, 0, 1000],
    rot: [0, -0, 2 ** -149],
    scale: [2 ** -149, 2 ** 126, 1],
    disp: 1,
    vertices: quad.map((vertex, i) => ({ ...vertex, x: i - 2, y: i * 2 ** -149, w: -0 })),
  };
  particles[1] = {
    ...initialParticle(0, 0),
    base: [-0, 0, -0],
    pos: [-0, -0, -0],
    rot: [-0, 0, -0],
    scale: [-0, -0, -0],
    disp: 1,
    vertices: quad.map((vertex, i) => ({ ...vertex, x: -0, y: -0, z: -0, w: i - 2 })),
  };
  const options = {
    width: 321,
    height: 241,
    priority: 3000,
    alpha: 195,
    zShifts: new Float32Array(particles.map((_, i) => ((i % 5) - 2) / 65536)),
    screenMatrix: [1, 0.25, 0, 0, -0.125, 1, 0, 0, 0, 0, 0.75, 0.25, 2.5, 1, 0, 1],
    screenShift: [-0.25, 1.125],
  };
  const order = particleDepthOrder(particles, options.zShifts).flatMap(({ index }, rank) =>
    particles[index].disp
      ? [{ index, particle: particles[index], zShift: options.zShifts[rank] }]
      : [],
  );
  return { particles, options, order };
}
