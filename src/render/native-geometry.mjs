// SPDX-License-Identifier: MPL-2.0
// Graph transforms/projection: native 682610, 682830, 67DBD0, 67DDD0.
import { identity, multiply, scaling, transform, rotation } from '../motion/matrix.mjs';
import { multiplyNativeMatrix, transformNativeVector } from '../ppi/native-projection-math.mjs';
import { roundX87Single } from '../ppi/x87.mjs';
import { MOTION_ABI, motionVector } from '../motion/abi.mjs';
const f = Math.fround;

export function rectangleTriangles({ x = 0, y = 0, z = 0, width, height, colors = [0xffffffff] }) {
  const vertices = [
    [x, y],
    [f(x + width), y],
    [x, f(y + height)],
    [f(x + width), f(y + height)],
  ].map(([vx, vy], i) => ({ x: vx, y: vy, z, color: colors[i] ?? colors[0], u: 0, v: 0 }));
  return [
    [vertices[0], vertices[1], vertices[3]],
    [vertices[0], vertices[2], vertices[3]],
  ];
}

export function transformNativeTriangles(
  triangles,
  bytes,
  { colorOverride = false, useEuler = false, scalarPrecision = false } = {},
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    base = motionVector(bytes, MOTION_ABI.base),
    pos = motionVector(bytes, MOTION_ABI.pos),
    scale = motionVector(bytes, MOTION_ABI.scale);
  let matrix = Array.from({ length: 16 }, (_, i) =>
    view.getFloat32(MOTION_ABI.matrix + i * 4, true),
  );
  if (useEuler) {
    matrix = identity();
    motionVector(bytes, MOTION_ABI.rotation).forEach((angle, i) => {
      matrix = multiply(matrix, rotation(['x', 'y', 'z'][i], angle));
    });
  }
  const combined = scalarPrecision
      ? multiplyNativeMatrix(scaling(...scale), matrix, roundX87Single)
      : multiply(scaling(...scale), matrix),
    color = view.getUint32(MOTION_ABI.color, true);
  return triangles.map((triangle) =>
    triangle.map((vertex) => {
      const input = [f(vertex.x - base[0]), f(vertex.y - base[1]), vertex.z, 1],
        p = scalarPrecision
          ? transformNativeVector(input, combined, roundX87Single)
          : transform(input, combined);
      return {
        ...vertex,
        x: f(p[0] + pos[0]),
        y: f(p[1] + pos[1]),
        z: f(p[2] + pos[2]),
        color: colorOverride ? color : vertex.color,
      };
    }),
  );
}

export function projectNativeTriangle(
  triangle,
  {
    textured = false,
    enabled = true,
    forcePerspective = false,
    priority = 0,
    position = [0, 0, 0],
    coordMode = 0,
    width,
    height,
    cameraNear = 1000,
    screenMatrix = identity(),
    screenShift = [0, 0],
  } = {},
) {
  const origin =
    coordMode === 0 ? position : coordMode === 1 ? [f(width * 0.5), f(height * 0.5), 0] : [0, 0, 0];
  const near = f(f(65000 - f(priority)) - f(cameraNear)),
    perspective = enabled && (!textured || triangle.some((v) => v.z !== 0));
  return triangle.map((vertex) => {
    const depth = f(65000 - f(vertex.z + f(priority)));
    let p;
    if (perspective && (forcePerspective || textured || vertex.z !== 0)) {
      const denominator = depth === near ? 1 : f(depth - near),
        scale = Math.max(0, f(f(cameraNear) / denominator));
      p = [
        f(f(f(vertex.x - origin[0]) * scale) + origin[0]),
        f(f(f(vertex.y - origin[1]) * scale) + origin[1]),
        f(depth * f(1 / 65000)),
        f(f(vertex.w ?? 1) * f(1 / denominator)),
      ];
    } else p = [vertex.x, vertex.y, f(depth * f(1 / 65000)), vertex.w ?? 1];
    p = transform(p, screenMatrix);
    return {
      ...vertex,
      x: f(p[0] + screenShift[0]),
      y: f(p[1] + screenShift[1]),
      z: p[2],
      w: p[3],
    };
  });
}

export function nativeGraphGeometry(
  graph,
  state,
  projection,
  texture = null,
  deform = (vertices) => vertices,
) {
  const triangles = graph.triangles || rectangleTriangles(graph),
    vram = motionVector(graph.kx2, MOTION_ABI.vram);
  const textured = Boolean(texture),
    textureTriangles = graph.textureTransform
      ? transformNativeTriangles(triangles, graph.textureTransform, {
          useEuler: !graph.textureMatrixExplicit,
        })
      : triangles,
    withUV = triangles.map((triangle, index) =>
      triangle.map((vertex, i) => ({
        ...vertex,
        u: textured ? f(f(textureTriangles[index][i].x + vram[0]) / texture.width) : 0,
        v: textured ? f(f(textureTriangles[index][i].y + vram[1]) / texture.height) : 0,
      })),
    );
  const working = transformNativeTriangles(withUV, graph.kx2, {
    colorOverride: state.colorOverride,
    scalarPrecision: true,
    useEuler: graph.matrixExplicit === false,
  });
  return working.map((triangle, index) => {
    const projected = projectNativeTriangle(deform(triangle, index), {
      ...projection,
      textured,
      priority: motionVector(graph.kx2, MOTION_ABI.base)[2],
      position: motionVector(graph.kx2, MOTION_ABI.pos),
      coordMode: state.coordMode || 0,
    });
    return { vertices: [...projected, projected[2]] };
  });
}

// The cache belongs to the plain colored model, independently of whether
// its current transform/effect is inside the proven bounds calculation domain.
export const isNativeColoredModel = (graph) =>
  graph?.type === 2 && !graph.custom && !graph.callback;

export function supportsNativeColoredBounds(graph, state, projection) {
  if (
    !isNativeColoredModel(graph) ||
    graph.vertexEffectID !== undefined ||
    graph.triangles ||
    graph.movie ||
    graph.mesh ||
    graph.vram ||
    state.trail?.enabled ||
    state.trail?.graphs?.length ||
    !(graph.kx2 instanceof Uint8Array) ||
    graph.kx2.byteLength < MOTION_ABI.objectSize ||
    ![graph.x ?? 0, graph.y ?? 0, graph.z ?? 0, graph.width, graph.height].every(Number.isFinite) ||
    (graph.z ?? 0) !== 0 ||
    projection.screenMatrix?.length !== 16 ||
    !Array.from(projection.screenMatrix).every((n, i) => n === (i % 5 === 0 ? 1 : 0)) ||
    projection.screenShift?.length !== 2 ||
    !projection.screenShift.every((n) => n === 0)
  )
    return false;
  const position = motionVector(graph.kx2, MOTION_ABI.pos),
    base = motionVector(graph.kx2, MOTION_ABI.base),
    scale = motionVector(graph.kx2, MOTION_ABI.scale);
  if (![...position, ...base, ...scale].every(Number.isFinite) || position[2] !== 0) return false;
  if (graph.matrixExplicit === false) {
    const rotation = motionVector(graph.kx2, MOTION_ABI.rotation);
    return rotation.every(Number.isFinite) && rotation[0] === 0 && rotation[1] === 0;
  }
  const view = new DataView(graph.kx2.buffer, graph.kx2.byteOffset, graph.kx2.byteLength),
    matrix = Array.from({ length: 16 }, (_, i) => view.getFloat32(MOTION_ABI.matrix + i * 4, true));
  return (
    matrix.every(Number.isFinite) &&
    [2, 3, 6, 7, 8, 9, 11, 14].every((i) => matrix[i] === 0) &&
    matrix[15] === 1
  );
}

export function nativeVertexBounds(triangles) {
  const cvtt = (n) =>
    Number.isFinite(n) && n >= -0x80000000 && n < 0x80000000 ? Math.trunc(n) | 0 : -0x80000000;
  let bounds = null;
  for (const triangle of triangles)
    for (const vertex of triangle.vertices.slice(0, 3)) {
      const x = cvtt(f(vertex.x)),
        y = cvtt(f(vertex.y)),
        right = (x + 1) | 0,
        bottom = (y + 1) | 0;
      // UnionRect ignores an empty point RECT, including signed overflow.
      if (right <= x || bottom <= y) continue;
      bounds = bounds
        ? [
            Math.min(bounds[0], x),
            Math.min(bounds[1], y),
            Math.max(bounds[2], right),
            Math.max(bounds[3], bottom),
          ]
        : [x, y, right, bottom];
    }
  return bounds ?? [0, 0, 0, 0];
}

export function nativeColoredBounds(graph, state, projection) {
  if (!supportsNativeColoredBounds(graph, state, projection))
    throw new Error('Unsupported ordinary plane dirty bounds domain');
  // Use the real model's pure transform/projection phase, without drawGraph's
  // visibility/MOT/alpha gates, which may already have changed before a query.
  return nativeVertexBounds(nativeGraphGeometry(graph, state, projection));
}
