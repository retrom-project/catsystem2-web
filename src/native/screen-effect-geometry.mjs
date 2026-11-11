// SPDX-License-Identifier: MPL-2.0
// Screen effects use their own stored-f32 projection and mesh ordering.
import { identity, rotation } from '../motion/matrix.mjs';
import { multiplyNativeMatrix, transformNativeVector } from '../ppi/native-projection-math.mjs';
import { roundX87Single } from '../ppi/x87.mjs';
const f = Math.fround,
  PI = f(Math.PI),
  TAU = f(2 * Math.PI);
const multiply = (left, right) => multiplyNativeMatrix(left, right, roundX87Single),
  transform = (vector, matrix) => transformNativeVector(vector, matrix, roundX87Single);
export function screenTextureSize(size) {
  let result = 1;
  while (result < size) result *= 2;
  return result;
}
const add = (a, b) => a.map((x, i) => f(x + b[i]));
const subtract = (a, b) => a.map((x, i) => f(x - b[i]));
function inverseZ([x, y, z, w], angle) {
  const c = f(Math.cos(f(angle))),
    s = f(Math.sin(f(angle)));
  return [f(f(x * c) + f(y * s)), f(f(y * c) - f(x * s)), z, w];
}
function inverseX([x, y, z, w], angle) {
  const c = f(Math.cos(f(angle))),
    s = f(Math.sin(f(angle)));
  return [x, f(f(y * c) + f(z * s)), f(f(z * c) - f(y * s)), w];
}
function mesh(width, height, gridWidth, gridHeight, broken = false, options = {}) {
  const [left, top, rightEdge, bottomEdge] = options.drawingRectangle ?? [0, 0, width, height];
  if (gridWidth <= 0 || gridHeight <= 0) throw new RangeError('Screen effect grid divides by zero');
  if (
    Math.ceil((rightEdge - left) / gridWidth) * Math.ceil((bottomEdge - top) / gridHeight) >
    262144
  )
    throw new RangeError('Screen effect mesh exceeds its resource limit');
  const textureWidth = options.textureWidth ?? width,
    textureHeight = options.textureHeight ?? height,
    cells = [];
  for (let y = top; y < bottomEdge; y += gridHeight)
    for (let x = left; x < rightEdge; x += gridWidth) {
      const right = broken ? x + gridWidth : Math.min(x + gridWidth, rightEdge),
        bottom = broken ? y + gridHeight : Math.min(y + gridHeight, bottomEdge),
        corners = [
          [x, y],
          [right, y],
          [x, bottom],
          [right, bottom],
        ].map(([px, py]) => ({
          x: f(px - 0.5),
          y: f(py - 0.5),
          u: f(px / textureWidth),
          v: f(py / textureHeight),
          color: 0xffffffff,
        })),
        order = broken
          ? [
              [0, 1, 2],
              [1, 2, 3],
            ]
          : [
              [0, 1, 2],
              [1, 3, 2],
            ];
      cells.push({ x, y, vertices: order.flatMap((ids) => ids.map((i) => ({ ...corners[i] }))) });
    }
  return cells;
}
function foldProjection([x, y, z, w], originZ) {
  let denominator = f(z - f(originZ - 2000));
  if (denominator === 0) denominator = 1;
  const matrix = identity();
  matrix[0] = matrix[5] = Math.max(0, f(2000 / denominator));
  matrix[10] = f(1 / 65000);
  matrix[15] = f(1 / denominator);
  return transform([x, y, z, w], matrix);
}
function breakProjection([x, y, z, w], width, height) {
  const depth = f(65000 - f(z + 32500));
  if (z === 0) return [x, y, f(depth * f(1 / 65000)), 1];
  let denominator = f(depth - 31500);
  if (denominator === 0) denominator = 1;
  const cx = f(width),
    cy = f(height),
    matrix = identity();
  matrix[0] = matrix[5] = Math.max(0, f(1000 / denominator));
  matrix[10] = f(1 / 65000);
  matrix[15] = f(1 / denominator);
  const output = transform([f(x - cx), f(y - cy), depth, w], matrix);
  output[0] = f(output[0] + cx);
  output[1] = f(output[1] + cy);
  return output;
}
const vertex = (source, p, color = source.color) => ({
  ...source,
  x: p[0],
  y: p[1],
  z: p[2],
  w: p[3],
  color: color >>> 0,
});
function distance(a, b) {
  const d = a.slice(0, 3).map((x, i) => f(x - b[i]));
  return f(Math.sqrt(f(f(f(d[1] * d[1]) + f(d[0] * d[0])) + f(d[2] * d[2]))));
}
export function breakShards(
  width,
  height,
  gridWidth,
  gridHeight,
  radialSpeed,
  angularSpeed,
  random,
  options = {},
) {
  const center = [f(width * 0.5), f(height * 0.5), 0, 0],
    diagonal = distance(center, [0, 0, 0, 0]),
    half = f(f(f(angularSpeed * 0.5) * PI) / 180),
    span = f(f(angularSpeed * PI) / 180),
    shards = [];
  for (const cell of mesh(width, height, gridWidth, gridHeight, true, options))
    for (let at = 0; at < 6; at += 3) {
      const source = cell.vertices.slice(at, at + 3),
        points = source.map((v) => [v.x, v.y, 0, 1]),
        pivot = [0, 0, 0, 0];
      for (let i = 0; i < 3; i++)
        pivot[i] = f(f(f(points[0][i] + points[1][i]) + points[2][i]) / 3);
      const centered = subtract(pivot, center),
        tilt = f(f(distance(pivot, center) / diagonal) * f(Math.PI / 4)),
        azimuth = f(Math.atan2(centered[0], -centered[1])),
        speed = f(random.frand() * radialSpeed),
        radial = multiply(multiply(identity(), rotation('x', tilt)), rotation('z', azimuth)),
        velocity = transform([0, 0, speed, 0], radial);
      velocity[2] = 0;
      const position = [...pivot];
      for (let i = 0; i < 3; i++) pivot[i] = f(centered[i] + center[i]);
      shards.push({
        source,
        points,
        pivot,
        position,
        velocity,
        omega: Array.from({ length: 3 }, () => f(half - roundX87Single(random.frand() * span))),
        matrix: identity(),
      });
    }
  return shards;
}
export function breakFrame(state, clock, width, height) {
  const elapsed = (Math.min(clock, state.end) - state.start) >>> 0,
    dt = f(elapsed - state.lastElapsed),
    alpha = 255 - Math.min(255, Math.floor(((255 * elapsed) >>> 0) / Math.max(state.duration, 1))),
    color = ((alpha << 24) | 0xffffff) >>> 0;
  const geometry = state.geometry.shards.map((shard) => {
    for (let i = 0; i < 3; i++)
      shard.matrix = multiply(shard.matrix, rotation(['x', 'y', 'z'][i], f(shard.omega[i] * dt)));
    for (let i = 0; i < 3; i++)
      shard.position[i] = f(shard.position[i] + f(shard.velocity[i] * dt));
    return {
      vertices: shard.points.map((p, i) =>
        vertex(
          shard.source[i],
          breakProjection(
            add(transform(subtract(p, shard.pivot), shard.matrix), shard.position),
            width,
            height,
          ),
          color,
        ),
      ),
    };
  });
  state.lastElapsed = elapsed;
  return geometry;
}
export function makePage(width, height, params) {
  let { radius } = params;
  const { axisAngle, curlAngle, currentWidth, windowedWidth } = params;
  radius = f(radius * f(currentWidth / windowedWidth));
  const cx = f(width * 0.5),
    cy = f(height * 0.5),
    source = mesh(width, height, 32, 32, false, params).flatMap((cell) => cell.vertices),
    local = source.map((v) => inverseZ([f(v.x - cx), f(v.y - cy), 0, 1], axisAngle)),
    length = f(radius * TAU),
    arc = f(f(curlAngle / TAU) * length);
  let minY = Infinity,
    maxY = -Infinity;
  for (const p of local) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { source, local, radius, axisAngle, curlAngle, length, arc, cx, cy, minY, maxY };
}
export function pageFrame(state, elapsed, duration, maximum) {
  const originZ = f(65000 - f(maximum + 1000)),
    ratio = f(f(Math.min(elapsed, duration)) / f(duration)),
    position = f(state.maxY + f(ratio * f(f(state.minY - state.radius) - state.maxY))),
    baseline = foldProjection([0, 0, originZ, 1], originZ),
    tailBase = subtract(inverseX([0, 0, state.radius, 0], state.curlAngle), [
      0,
      0,
      state.radius,
      0,
    ]),
    tailDirection = inverseX([0, 1, 0, 0], state.curlAngle),
    vertices = state.source.map((source, i) => {
      const [x, y] = state.local[i],
        d = f(y - position);
      // COMISS unordered follows the same baseline branch as y < position.
      if (!(y >= position)) return { ...source, z: baseline[2], w: baseline[3] };
      let p;
      if (d < state.arc) {
        const angle = f(f(f(d / state.length) * PI) * 2);
        p = add(inverseX([0, 0, state.radius, 0], angle), [
          x,
          position,
          f(originZ - state.radius),
          1,
        ]);
      } else
        p = add(
          add([x, position, originZ, 1], tailBase),
          tailDirection.map((q) => f(q * f(d - state.arc))),
        );
      p = inverseZ(foldProjection(p, originZ), -state.axisAngle);
      p[0] = f(p[0] + state.cx);
      p[1] = f(p[1] + state.cy);
      return vertex(source, p);
    });
  return Array.from({ length: vertices.length / 3 }, (_, i) => ({
    vertices: vertices.slice(i * 3, i * 3 + 3),
  }));
}
export function makeCube(width, height, params) {
  const ratio = f(params.currentWidth / params.windowedWidth),
    gridWidth = Math.trunc(f(f(params.gridWidth >>> 0) * ratio)) >>> 0,
    scaledGridHeight = Math.trunc(f(f(params.gridHeight >>> 0) * ratio)) >>> 0,
    gridHeight = params.gridHeightProduct
      ? Math.imul(scaledGridHeight, params.gridHeight) >>> 0
      : scaledGridHeight,
    band = f(params.band * ratio),
    phi = f(params.sweep + params.axis),
    cx = f(width * 0.5),
    cy = f(height * 0.5),
    originZ = f(65000 - f(params.maximum + 1000)),
    cells = mesh(width, height, gridWidth, gridHeight, false, params).map((cell) => {
      const center = inverseZ(
          [f(f(cell.x + f(gridWidth * 0.5)) - cx), f(f(cell.y + f(gridHeight * 0.5)) - cy), 0, 1],
          phi,
        ),
        local = cell.vertices.map((v) => inverseZ([f(v.x - cx), f(v.y - cy), 0, 1], phi)),
        initial = cell.vertices.map((v) => ({ ...v, z: 0, w: 1 }));
      return {
        ...cell,
        center,
        local,
        old: structuredClone(initial),
        next: structuredClone(initial),
      };
    });
  let minY = Infinity,
    maxY = -Infinity;
  for (const cell of cells) {
    if (cell.center[1] < minY) minY = cell.center[1];
    if (cell.center[1] > maxY) maxY = cell.center[1];
  }
  return { cells, cx, cy, originZ, band, phi, axis: params.axis, minY, maxY };
}
export function cubeFrame(state, elapsed, duration) {
  const ratio = f(f(Math.min(elapsed, duration)) / f(duration)),
    position = f(state.maxY + f(ratio * f(f(state.minY - state.band) - state.maxY))),
    baseline = foldProjection([0, 0, state.originZ, 1], state.originZ);
  for (const cell of state.cells) {
    const delta = f(cell.center[1] - position),
      angle = !(cell.center[1] >= position)
        ? 0
        : !(state.band > delta)
          ? PI
          : f(f(delta / state.band) * PI),
      front = angle < f(PI * 0.5),
      active = front ? cell.old : cell.next,
      inactive = front ? cell.next : cell.old,
      endpoint = angle === 0 || angle === PI,
      faceAngle = front ? angle : f(angle - PI);
    for (const v of inactive) v.color = 0;
    for (let i = 0; i < 6; i++) {
      let p;
      if (endpoint) p = [cell.vertices[i].x, cell.vertices[i].y, baseline[2], baseline[3]];
      else {
        const local = [
          f(cell.local[i][0] - cell.center[0]),
          f(cell.local[i][1] - cell.center[1]),
          f(cell.local[i][2] - cell.center[2]),
          1,
        ];
        p = inverseZ(inverseX(inverseZ(local, -state.axis), faceAngle), state.axis);
        p[2] = f(p[2] + state.originZ);
        p = foldProjection(p, state.originZ);
        p[0] = f(p[0] + cell.center[0]);
        p[1] = f(p[1] + cell.center[1]);
        p = inverseZ(p, -state.phi);
        p[0] = f(p[0] + state.cx);
        p[1] = f(p[1] + state.cy);
      }
      Object.assign(active[i], { x: p[0], y: p[1], z: p[2], w: p[3], color: 0xffffffff });
    }
  }
  const collect = (key) =>
    state.cells.flatMap((cell) => [
      { vertices: cell[key].slice(0, 3) },
      { vertices: cell[key].slice(3, 6) },
    ]);
  return { old: collect('old'), next: collect('next') };
}
