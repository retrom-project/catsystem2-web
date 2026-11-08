// SPDX-License-Identifier: MPL-2.0
// Main 1D2/1D3 and kc2DDivModel records. The 64-byte input is a texture ID
// followed by five columns of three floats; it is not a transformation matrix.
import { nativeReply } from '../kcs/vm.mjs';
import { MOTION_ABI, motionVector } from '../motion/abi.mjs';
import { identity, multiply, rotation, scaling, transform } from '../motion/matrix.mjs';
import { projectNativeTriangle } from '../render/native-geometry.mjs';

const f = Math.fround;
export const NATIVE_MESH_IDS = Object.freeze([0x1d2, 0x1d3]);

export function packNativeMesh(source, count) {
  if (!Number.isInteger(count) || count < 0 || count > 0x1ffffff)
    throw new RangeError('Native divided mesh record count is out of bounds');
  if (source.byteLength < count * 64) throw new RangeError('Truncated native divided mesh input');
  const bytes = new Uint8Array(count * 80),
    input = new DataView(source.buffer, source.byteOffset, source.byteLength),
    output = new DataView(bytes.buffer);
  for (let index = 0; index < count; index++) {
    output.setUint32(index * 80, index, true);
    output.setUint32(index * 80 + 4, input.getUint32(index * 64, true), true);
    for (let vertex = 0; vertex < 3; vertex++)
      for (const [field, column] of [
        [0, 0],
        [4, 1],
        [8, 2],
        [16, 3],
        [20, 4],
      ])
        output.setUint32(
          index * 80 + 8 + vertex * 24 + field,
          input.getUint32(index * 64 + 4 + column * 12 + vertex * 4, true),
          true,
        );
  }
  // Color words are not written by the original wrapper. The loading routine
  // immediately enables its uniform white color, independently of those words.
  return bytes;
}

export function decodeNativeMesh(bytes) {
  if (bytes.length % 80) throw new RangeError('Truncated native divided mesh records');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    records = [];
  for (let at = 0; at < bytes.length; at += 80)
    records.push({
      id: view.getUint32(at, true),
      textureID: view.getInt32(at + 4, true),
      vertices: Array.from({ length: 3 }, (_, i) => {
        const p = at + 8 + i * 24;
        return {
          x: view.getFloat32(p, true),
          y: view.getFloat32(p + 4, true),
          z: view.getFloat32(p + 8, true),
          color: view.getUint32(p + 12, true),
          u: view.getFloat32(p + 16, true),
          v: view.getFloat32(p + 20, true),
        };
      }),
    });
  return records;
}

export function transformNativeMesh(
  records,
  bytes,
  { matrixExplicit = false, colorOverride = true } = {},
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    base = motionVector(bytes, MOTION_ABI.base),
    position = motionVector(bytes, MOTION_ABI.pos),
    scale = motionVector(bytes, MOTION_ABI.scale),
    color = view.getUint32(MOTION_ABI.color, true);
  let matrix = matrixExplicit
    ? Array.from({ length: 16 }, (_, i) => view.getFloat32(MOTION_ABI.matrix + i * 4, true))
    : identity();
  if (!matrixExplicit)
    motionVector(bytes, MOTION_ABI.rotation).forEach((angle, i) => {
      matrix = multiply(matrix, rotation(['x', 'y', 'z'][i], angle));
    });
  matrix = multiply(scaling(...scale), matrix);
  return records.map((record) => ({
    ...record,
    vertices: record.vertices.map((vertex) => {
      const point = transform(
        [f(vertex.x - base[0]), f(vertex.y - base[1]), f(vertex.z + position[2]), 1],
        matrix,
      );
      return {
        ...vertex,
        x: f(f(position[0] + point[0]) - 0.5),
        y: f(f(position[1] + point[1]) - 0.5),
        z: point[2],
        color: colorOverride ? color : vertex.color,
      };
    }),
  }));
}

export function nativeMeshGeometry(graph, state, projection) {
  const records = transformNativeMesh(graph.mesh, graph.kx2, {
      matrixExplicit: graph.matrixExplicit,
      colorOverride: state.colorOverride,
    }),
    options = {
      ...projection,
      textured: true,
      priority: motionVector(graph.kx2, MOTION_ABI.base)[2],
      position: motionVector(graph.kx2, MOTION_ABI.pos),
      coordMode: state.coordMode,
    };
  return records.map((record) => ({
    textureID: record.textureID,
    vertices: projectNativeTriangle(record.vertices, options),
  }));
}

export async function nativeMesh(id, args, machine, task, world) {
  if (!NATIVE_MESH_IDS.includes(id)) return undefined;
  const count = id === 0x1d2 ? 2 : 3;
  if (args.length !== count)
    throw new Error(`Native mesh 0x${id.toString(16)} expects ${count} arguments`);
  if (args[0]) {
    if (id === 0x1d2) await world.sendNativeEngine(args[0], task.id, 82, 0, args[1]);
    else {
      const count = args[2] | 0;
      if (count < 0)
        throw new RangeError('Native divided mesh allocation overflows for a negative count');
      const bytes = packNativeMesh(machine.bytes(args[1], count * 64), count),
        view = new DataView(bytes.buffer),
        payload = {
          load: (at) => view.getUint32(at, true),
          bytes: (at, size) => bytes.subarray(at, at + size),
        };
      await world.sendNativeEngine(args[0], task.id, 83, count, 0, { payload });
    }
  }
  return nativeReply(2);
}

export function nativeMeshBounds(mesh) {
  const minimum = [f(1e8), f(1e8), f(1e8)],
    maximum = [f(-1e8), f(-1e8), f(-1e8)];
  for (const { vertices } of mesh)
    for (const vertex of vertices)
      for (const [i, field] of ['x', 'y', 'z'].entries()) {
        if (minimum[i] > vertex[field]) minimum[i] = vertex[field];
        if (maximum[i] < vertex[field]) maximum[i] = vertex[field];
      }
  return { minimum, maximum };
}
