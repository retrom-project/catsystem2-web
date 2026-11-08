// SPDX-License-Identifier: MPL-2.0
// Graph transforms/projection: native 682610, 682830, 67DBD0, 67DDD0.
import { identity, multiply, scaling, transform, rotation } from '../motion/matrix.mjs';
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
  { colorOverride = false, useEuler = false } = {},
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
  const combined = multiply(scaling(...scale), matrix),
    color = view.getUint32(MOTION_ABI.color, true);
  return triangles.map((triangle) =>
    triangle.map((vertex) => {
      const p = transform([f(vertex.x - base[0]), f(vertex.y - base[1]), vertex.z, 1], combined);
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
    if (perspective && (textured || vertex.z !== 0)) {
      const denominator = depth === near ? 1 : f(depth - near),
        scale = Math.max(0, f(f(cameraNear) / denominator));
      p = [
        f(f(f(vertex.x - origin[0]) * scale) + origin[0]),
        f(f(f(vertex.y - origin[1]) * scale) + origin[1]),
        f(depth * f(1 / 65000)),
        f(1 / denominator),
      ];
    } else p = [vertex.x, vertex.y, f(depth * f(1 / 65000)), 1];
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

export function nativeGraphGeometry(graph, state, projection, texture = null) {
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
    useEuler: graph.matrixExplicit === false,
  });
  return working.map((triangle) => {
    const projected = projectNativeTriangle(triangle, {
      ...projection,
      textured,
      priority: motionVector(graph.kx2, MOTION_ABI.base)[2],
      position: motionVector(graph.kx2, MOTION_ABI.pos),
      coordMode: state.coordMode || 0,
    });
    return { vertices: [...projected, projected[2]] };
  });
}
