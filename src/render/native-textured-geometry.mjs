// SPDX-License-Identifier: MPL-2.0
// The ordinary source/derived models share this actual division and projection.
import { MOTION_ABI, motionVector, setMotionVector } from '../motion/abi.mjs';
import {
  rectangleTriangles,
  transformNativeTriangles,
  nativeVertexBounds,
} from './native-geometry.mjs';
import {
  clipNativeTriangle,
  divideNativeTriangles,
  nativeDivisionLayout,
} from '../native/divided-model.mjs';
import { nativeMeshGeometry } from '../native/mesh.mjs';

// Model ownership is independent of the current bounds calculation domain.
export const isNativeTexturedModel = (graph) =>
  graph?.type === 1 && graph.vram === true && !graph.custom && !graph.callback;

// Derived XY clips only: source transforms still run before comparison, and
// division still queries each current dirty page and creates every output vertex.
// Weak keys keep this transient cache out of checkpoints and cold graph restores.
const divisionClips = new WeakMap(),
  MAX_CACHED_TRIANGLES = 64,
  MAX_CACHED_CLIPS = 1024;
function clipsFor(graph, triangles, division) {
  const prototype = Object.getPrototypeOf(graph);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (
    Object.getOwnPropertyDescriptor(graph, 'type')?.value !== 1 ||
    Object.getOwnPropertyDescriptor(graph, 'vram')?.value !== true
  )
    return undefined;
  for (const key of ['custom', 'callback', 'movie', 'vertexEffectID']) {
    const field = Object.getOwnPropertyDescriptor(graph, key);
    // Do not invoke a new accessor or infer a callback's effects from identity.
    if (
      field &&
      (!Object.hasOwn(field, 'value') ||
        (key === 'vertexEffectID' ? field.value !== undefined : field.value))
    )
      return undefined;
  }
  if (triangles.length > MAX_CACHED_TRIANGLES) return undefined;
  const values = [...division.pageSize, ...division.cellSize, ...division.cells];
  for (const triangle of triangles) {
    if (!Array.isArray(triangle) || triangle.length !== 3) return undefined;
    for (const vertex of triangle) {
      if (!vertex || typeof vertex !== 'object') return undefined;
      values.push(vertex.x, vertex.y);
    }
  }
  if (!values.every(Number.isFinite)) return undefined;
  let cached = divisionClips.get(graph);
  if (
    !cached ||
    cached.values.length !== values.length ||
    !values.every((value, index) => Object.is(value, cached.values[index]))
  ) {
    cached = { values, clips: triangles.map(() => new Map()), count: 0 };
    divisionClips.set(graph, cached);
  }
  return (triangle, rectangle, index) => {
    const clips = cached.clips[index],
      key = rectangle.join(',');
    let points = clips.get(key);
    if (!points) {
      points = clipNativeTriangle(triangle, rectangle);
      if (cached.count < MAX_CACHED_CLIPS) {
        clips.set(key, points);
        cached.count++;
      }
    }
    // divideNativeTriangles reads these points into fresh vertex records;
    // neither draw/deformation callbacks nor callers can mutate the cache.
    return points;
  };
}

function divideNativeModel(graph, layout, includesPage) {
  const source = graph.textureTransform.slice(),
    offset = motionVector(graph.kx2, MOTION_ABI.vram),
    position = motionVector(source, MOTION_ABI.pos).map((v, i) => Math.fround(v + offset[i]));
  setMotionVector(source, MOTION_ABI.pos, position);
  const division = nativeDivisionLayout(
      layout.configurationSize,
      layout.grid,
      layout.textureCaps?.guardBand,
    ),
    triangles = transformNativeTriangles(graph.triangles || rectangleTriangles(graph), source, {
      useEuler: !graph.textureMatrixExplicit,
    });
  return {
    ...graph,
    mesh: divideNativeTriangles(
      triangles,
      division,
      position,
      includesPage,
      clipsFor(graph, triangles, division),
    ),
  };
}

export function nativeTexturedGeometry(
  inputGraph,
  state,
  projection,
  layout,
  deform = (graph, vertices) => vertices,
) {
  const graph = inputGraph.mesh ? inputGraph : divideNativeModel(inputGraph, layout);
  return nativeMeshGeometry(graph, state, projection, (vertices, triangle) =>
    deform(graph, vertices, triangle),
  );
}

// Only approved plain model queries enter here. Unchanged texture pages
// cannot contribute damage, so clip and project only the dirty pages.
export function nativeTexturedPageBounds(graph, state, projection, pages) {
  const divided = divideNativeModel(graph, pages.layout, (id) => pages.isDirty(id));
  return nativeVertexBounds(nativeMeshGeometry(divided, state, projection));
}

function flatTransform(bytes, matrixExplicit) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < MOTION_ABI.objectSize) return false;
  const position = motionVector(bytes, MOTION_ABI.pos),
    base = motionVector(bytes, MOTION_ABI.base),
    scale = motionVector(bytes, MOTION_ABI.scale);
  if (![...position, ...base, ...scale].every(Number.isFinite) || position[2] !== 0) return false;
  if (matrixExplicit === false) {
    const rotation = motionVector(bytes, MOTION_ABI.rotation);
    return rotation.every(Number.isFinite) && rotation[0] === 0 && rotation[1] === 0;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    matrix = Array.from({ length: 16 }, (_, i) => view.getFloat32(MOTION_ABI.matrix + i * 4, true));
  return (
    matrix.every(Number.isFinite) &&
    [2, 3, 6, 7, 8, 9, 11, 14].every((i) => matrix[i] === 0) &&
    matrix[15] === 1
  );
}

export function supportsNativeTexturedBounds(graph, state, projection, layout) {
  return Boolean(
    isNativeTexturedModel(graph) &&
      graph.vertexEffectID === undefined &&
      !graph.triangles &&
      !graph.movie &&
      !graph.mesh &&
      !state.trail?.enabled &&
      !state.trail?.graphs?.length &&
      graph.kx2 !== graph.textureTransform &&
      flatTransform(graph.kx2, graph.matrixExplicit) &&
      flatTransform(graph.textureTransform, graph.textureMatrixExplicit) &&
      [graph.x ?? 0, graph.y ?? 0, graph.z ?? 0, graph.width, graph.height].every(
        Number.isFinite,
      ) &&
      (graph.z ?? 0) === 0 &&
      motionVector(graph.kx2, MOTION_ABI.vram).every(Number.isFinite) &&
      projection.screenMatrix?.length === 16 &&
      Array.from(projection.screenMatrix).every((n, i) => n === (i % 5 === 0 ? 1 : 0)) &&
      projection.screenShift?.length === 2 &&
      projection.screenShift.every((n) => n === 0) &&
      state.coordMode === 0 &&
      layout?.configurationSize?.length === 2 &&
      layout.configurationSize.every((n) => Number.isInteger(n) && n > 0) &&
      layout.grid?.length === 2 &&
      layout.grid.every((n) => Number.isInteger(n) && n > 0) &&
      layout.textureCaps?.guardBand?.length === 4 &&
      layout.textureCaps.guardBand.every(Number.isFinite),
  );
}

export function nativeTexturedBounds(graph, state, projection, layout) {
  if (!supportsNativeTexturedBounds(graph, state, projection, layout))
    throw new Error('Unsupported ordinary textured plane dirty bounds domain');
  // No allocation, GPU/page dirty query, draw visibility, alpha or MOT gates.
  return nativeVertexBounds(nativeTexturedGeometry(graph, state, projection, layout));
}
