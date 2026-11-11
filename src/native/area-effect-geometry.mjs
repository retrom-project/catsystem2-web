// SPDX-License-Identifier: MPL-2.0
import { bitsFloat } from '../kcs.mjs';
import { identity, rotation } from '../motion/matrix.mjs';
import { multiplyNativeMatrix, transformNativeVector } from '../ppi/native-projection-math.mjs';
import { roundX87Single } from '../ppi/x87.mjs';
import { projectNativeTriangle } from '../render/native-geometry.mjs';
const f = Math.fround,
  tau = f(Math.PI * 2),
  multiply = (a, b) => multiplyNativeMatrix(a, b, roundX87Single),
  transform = (a, b) => transformNativeVector(a, b, roundX87Single),
  fraction = (x) => x - Math.trunc(x);
export function rasterParameters(words, frameRate) {
  const converted = Boolean(words[1] & 0x80000000);
  return {
    graph: words[0],
    mode: words[1] & 0x7fffffff,
    amplitude: bitsFloat(words[2]),
    frequency: converted ? f(1 / bitsFloat(words[3])) : bitsFloat(words[3]),
    period: converted ? f(f(bitsFloat(words[4]) / 60) * f(frameRate)) : bitsFloat(words[4]),
    converted,
  };
}
export function rasterVertices(params, elapsed, step, vertices) {
  const axis = params.mode === 1 ? 'x' : 'y',
    input = params.mode === 1 ? 'y' : 'x',
    phase = f(f(fraction(f(f(f(elapsed) * f(step)) / params.period))) * tau);
  return vertices.map((v) => {
    const angle = params.converted
      ? f(f(f(fraction(f(v[input] * params.frequency))) * tau) + phase)
      : f(f(f(f(f(v[input] + f(elapsed)) % params.frequency) * f(Math.PI)) * 2) / params.frequency);
    return { ...v, [axis]: f(v[axis] + f(f(Math.sin(angle)) * params.amplitude)) };
  });
}
const distance = (a, b) => {
  const d = a.slice(0, 3).map((n, i) => f(n - b[i]));
  return f(Math.sqrt(f(f(f(d[1] * d[1]) + f(d[0] * d[0])) + f(d[2] * d[2]))));
};
export function glassShards(triangles, bounds, speed, random) {
  const center = [f(f(bounds[2] - bounds[0]) * 0.5), f(f(bounds[3] - bounds[1]) * 0.5), 0, 1],
    diagonal = distance(center, [0, 0, 0, 1]),
    half = f(f(5 * f(Math.PI)) / 180),
    span = f(f(10 * f(Math.PI)) / 180);
  return triangles.map((triangle) => {
    const pivot = [0, 1, 2].map((axis) =>
        f(f(f(triangle[0][axis] + triangle[1][axis]) + triangle[2][axis]) / 3),
      ),
      diagonalRatio = f(distance(pivot, center) / diagonal),
      angle = f(diagonalRatio * f(Math.PI / 4)),
      azimuth = f(Math.atan2(pivot[0], -pivot[1])),
      radial = multiply(multiply(identity(), rotation('x', angle)), rotation('z', azimuth)),
      velocity = transform([0, 0, f(random.frand() * speed), 0], radial);
    return {
      pivot: [...pivot, 0],
      position: [...pivot, 0],
      velocity,
      omega: Array.from({ length: 3 }, () => f(half - f(random.frand() * span))),
      matrix: identity(),
    };
  });
}
export function advanceGlass(shards, delta) {
  for (const shard of shards) {
    for (let i = 0; i < 3; i++)
      shard.matrix = multiply(
        shard.matrix,
        rotation(['x', 'y', 'z'][i], f(shard.omega[i] * delta)),
      );
    for (let i = 0; i < 3; i++)
      shard.position[i] = f(shard.position[i] + f(shard.velocity[i] * delta));
  }
}
export function glassVertices(shard, vertices) {
  if (!shard) throw new RangeError('Glass effect triangle exceeds its owned geometry');
  return vertices.map((v) => {
    const point = transform(
      [f(v.x - shard.pivot[0]), f(v.y - shard.pivot[1]), f(v.z - shard.pivot[2]), v.w ?? 1],
      shard.matrix,
    );
    return {
      ...v,
      x: f(point[0] + shard.position[0]),
      y: f(point[1] + shard.position[1]),
      z: f(point[2] + shard.position[2]),
      w: f(point[3] + shard.position[3]),
    };
  });
}
export function rainDrop(params, random, initial) {
  const y = f(f(random.frand() * params.height) * (initial ? -5 : -1)),
    x = f(random.frand() * params.width),
    z = f(f(random.frand() * params.depth) - f(params.depth * 0.5)),
    length = f(f(random.frand() * f(params.maxLength - params.minLength)) + params.minLength);
  return [
    { x, y: f(y - length), z, w: 1, color: params.color },
    { x, y, z, w: 1, color: params.color },
  ];
}
function rainCount(state) {
  const count = Math.min(state.rain.count, state.rain.capacity);
  if (count > state.drops.length)
    throw new RangeError('Rain count exceeds its allocated vertex storage');
  return count;
}
export function advanceRain(state, delta, random) {
  const speed = f(f(delta) * state.rain.speed);
  for (let i = 0; i < rainCount(state); i++) {
    for (const vertex of state.drops[i]) vertex.y = f(vertex.y + speed);
    if (state.drops[i][0].y > state.rain.height)
      state.drops[i] = rainDrop(state.rain, random, false);
  }
}
export function rainGeometry(state, projection) {
  return state.drops.slice(0, rainCount(state)).map((vertices) => ({
    vertices: projectNativeTriangle(
      vertices.map((v) => ({
        ...v,
        x: f(f(v.x - state.rainProjection.center[0]) + state.rainProjection.center[0]),
        y: f(f(v.y - state.rainProjection.center[1]) + state.rainProjection.center[1]),
        w: f(v.w + 1),
      })),
      {
        ...projection,
        textured: false,
        forcePerspective: true,
        priority: state.rainProjection.priority,
        position: [f(projection.width * 0.5), f(projection.height * 0.5), 0],
      },
    ),
  }));
}
