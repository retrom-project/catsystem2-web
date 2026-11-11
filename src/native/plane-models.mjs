// SPDX-License-Identifier: MPL-2.0
// File-backed triangles and retained Plane history are renderer-owned JS data.
import { MOTION_ABI, motionVector, setMotionVector } from '../motion/abi.mjs';
import { multiply, rotation } from '../motion/matrix.mjs';
import { linearInterpolate } from '../ppi/numeric.mjs';
const f = Math.fround;
export function decodePlaneKX2(bytes) {
  if (bytes.length < 24) throw new RangeError('Truncated KX2 header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    count = view.getUint32(20, true);
  if (view.getUint32(0, true) !== 0x0032584b) throw new Error('Invalid KX2 signature');
  if (count > Math.floor((bytes.length - 24) / 48)) throw new RangeError('Truncated KX2 triangles');
  const rect = Array.from({ length: 4 }, (_, i) => view.getFloat32(4 + i * 4, true)),
    triangles = Array.from({ length: count }, (_, i) =>
      Array.from({ length: 3 }, (_, j) => {
        const at = 24 + i * 48 + j * 16;
        return {
          x: view.getFloat32(at, true),
          y: view.getFloat32(at + 4, true),
          z: view.getFloat32(at + 8, true),
          color: view.getUint32(at + 12, true),
        };
      }),
    );
  return {
    type: 6,
    rect,
    width: Math.abs(f(rect[2] - rect[0])),
    height: Math.abs(f(rect[3] - rect[1])),
    triangles,
    vram: true,
  };
}
function sample(graph) {
  const bytes = new Uint8Array(128),
    view = new DataView(bytes.buffer);
  for (const [at, offset] of [
    [12, MOTION_ABI.base],
    [28, MOTION_ABI.pos],
    [44, MOTION_ABI.scale],
  ])
    motionVector(graph.kx2, offset).forEach((n, i) => view.setFloat32(at + i * 4, n, true));
  bytes.set(graph.kx2.subarray(MOTION_ABI.matrix, MOTION_ABI.matrix + 64), 60);
  view.setUint32(8, new DataView(graph.kx2.buffer).getUint32(MOTION_ABI.display, true), true);
  view.setUint32(124, new DataView(graph.kx2.buffer).getUint32(MOTION_ABI.color, true), true);
  return bytes;
}
export class NativePlaneTrail {
  constructor(task) {
    this.task = task;
  }
  get state() {
    return this.task.state.trail;
  }
  close() {
    for (const graph of this.state?.graphs ?? []) this.task.graphics.graphs.delete(graph.nativeID);
    this.task.state.trail = null;
  }
  configure(words) {
    this.close();
    const task = this.task,
      source = task.graph;
    if (!words || !source) return;
    const mode = words[11] >>> 0,
      stride = mode === 1 ? 2 : mode >= 2 && mode <= 5 ? 1 : words[1] | 0,
      length = Math.imul(words[0], stride);
    if (length < 0 || length > 65535)
      throw new RangeError('Plane trail history exceeds its native ID range');
    const head = sample(source),
      history = [head],
      graphs = [],
      delta = words.slice(7, 11).map((word) => new Float32Array(Uint32Array.of(word).buffer)[0]);
    for (let i = 1; i <= length; i++) {
      const bytes = head.slice(),
        view = new DataView(bytes.buffer),
        previous = new DataView(history[i - 1].buffer),
        active = i % stride === 0,
        nativeID = ((task.record.nativeID << 16) | i) >>> 0;
      view.setUint32(0, Number(active), true);
      view.setUint32(8, 0, true);
      view.setUint32(4, active || mode ? nativeID : 0, true);
      for (let j = 0; j < 4; j++)
        view.setFloat32(28 + j * 4, f(previous.getFloat32(28 + j * 4, true) - delta[j]), true);
      history.push(bytes);
      if (active || mode) {
        const graph = structuredClone(source);
        Object.assign(graph, { nativeID, renderOrder: task.graphics.allocateRenderOrder() });
        new DataView(graph.kx2.buffer).setUint32(MOTION_ABI.display, 0, true);
        graphs.push(graph);
        task.graphics.graphs.set(nativeID, graph);
      }
    }
    task.state.trail = {
      words: words.slice(),
      mode,
      stride,
      length,
      history,
      graphs,
      delta,
      enabled: true,
    };
    if ((mode === 4 || mode === 5) && length) this.configureStrip();
    if (mode < 4) this.updateGraphs();
  }
  configureStrip() {
    const state = this.state,
      task = this.task,
      axis = state.mode === 4 ? 1 : 0,
      dimension = task.state.rect[axis + 2],
      integer = Math.trunc(dimension),
      strip = integer % 2 ? 1 : 2,
      half = Math.trunc(integer / 2) - (strip === 2 ? 1 : 0),
      original = motionVector(task.graph.textureTransform, MOTION_ABI.pos);
    state.strip = strip;
    for (const graph of state.graphs) {
      const last = (graph.nativeID & 65535) === state.length,
        position = original.slice();
      position[axis] = f(position[axis] + f(half + (last ? strip : 0)));
      setMotionVector(graph.textureTransform, MOTION_ABI.pos, position);
      if (!last) {
        const scale = [1, 1, 1];
        scale[axis] = f(strip / dimension);
        setMotionVector(graph.textureTransform, MOTION_ABI.scale, scale);
      }
    }
    const scale = [1, 1, 1];
    scale[axis] = f(f(dimension - f(half - strip)) / dimension);
    setMotionVector(task.graph.textureTransform, MOTION_ABI.scale, scale);
  }
  shift(bytes) {
    const state = this.state;
    if (!state?.enabled) return;
    for (let i = state.length; i > 0; i--) {
      const current = state.history[i],
        previous = state.history[i - 1],
        view = new DataView(current.buffer),
        from = new DataView(previous.buffer);
      current.set(previous.subarray(8), 8);
      for (let j = 0; j < 4; j++)
        view.setFloat32(28 + j * 4, f(from.getFloat32(28 + j * 4, true) + state.delta[j]), true);
    }
    state.history[0].set(bytes.subarray(8), 8);
    this.updateGraphs();
  }
  tick() {
    if (
      this.state &&
      this.task.graph &&
      this.task.state.shown &&
      !this.task.state.renderPaused &&
      new DataView(this.task.graph.kx2.buffer).getInt32(MOTION_ABI.display, true)
    )
      this.shift(sample(this.task.graph));
  }
  updateGraphs() {
    const state = this.state;
    if (!state) return;
    // The original receiver has no update branch for values above five.
    if (state.mode > 5) return;
    if ((state.mode === 4 || state.mode === 5) && state.length) {
      const head = new DataView(state.history[0].buffer),
        next = new DataView(state.history[1].buffer),
        angle = f(
          f(
            Math.atan2(
              f(next.getFloat32(32, true) - head.getFloat32(32, true)),
              f(next.getFloat32(28, true) - head.getFloat32(28, true)),
            ),
          ) - f(Math.PI / 2),
        ),
        matrix = Array.from({ length: 16 }, (_, j) => head.getFloat32(60 + j * 4, true));
      multiply(matrix, rotation('z', angle)).forEach((n, j) =>
        new DataView(this.task.graph.kx2.buffer).setFloat32(MOTION_ABI.matrix + j * 4, n, true),
      );
      this.task.graph.matrixExplicit = true;
    }
    for (const graph of state.graphs) {
      const i = graph.nativeID & 65535;
      if ((state.mode === 2 || state.mode === 3) && i === state.length) continue;
      const bytes = state.history[i],
        view = new DataView(bytes.buffer),
        vector = (at) => Array.from({ length: 3 }, (_, j) => view.getFloat32(at + j * 4, true)),
        base = vector(12),
        scale = vector(44);
      base[2] = f(base[2] + f(Math.imul(state.words[12], i)));
      if (state.mode >= 4) base[1] = i === state.length ? 0 : f(state.strip * 0.5);
      setMotionVector(graph.kx2, MOTION_ABI.base, base);
      setMotionVector(graph.kx2, MOTION_ABI.pos, vector(28));
      graph.kx2.set(bytes.subarray(60, 124), MOTION_ABI.matrix);
      graph.matrixExplicit = true;
      const targetScale = state.words
          .slice(3, 6)
          .map((word) => new Float32Array(Uint32Array.of(word).buffer)[0]),
        scaled = scale.map((v, j) =>
          linearInterpolate(
            v,
            state.mode ? targetScale[j] : f(v * targetScale[j]),
            0,
            state.length,
            i,
          ),
        );
      if (state.mode >= 2 || (state.mode === 1 && !(i % 2 === 0))) {
        const previous = new DataView(state.history[i - 1].buffer),
          next = new DataView(state.history[state.mode >= 4 ? i : i + 1].buffer),
          delta = Array.from({ length: 3 }, (_, j) =>
            f(next.getFloat32(28 + j * 4, true) - previous.getFloat32(28 + j * 4, true)),
          ),
          angle = f(f(Math.atan2(delta[1], delta[0])) - (state.mode >= 4 ? f(Math.PI / 2) : 0)),
          matrix = Array.from({ length: 16 }, (_, j) => view.getFloat32(60 + j * 4, true)),
          transformed = multiply(matrix, rotation('z', angle)),
          width = this.task.state.rect[2],
          squared = f(f(f(delta[0] * delta[0]) + f(delta[1] * delta[1])) + f(delta[2] * delta[2])),
          distance = f(Math.sqrt(squared)),
          length = state.mode === 2 ? f(distance * 0.5) : distance;
        transformed.forEach((n, j) =>
          new DataView(graph.kx2.buffer).setFloat32(MOTION_ABI.matrix + j * 4, n, true),
        );
        if (state.mode < 4) scaled[0] = f(f(width + length) / width);
        else if (i < state.length) {
          const after = new DataView(state.history[i + 1].buffer),
            span = Array.from({ length: 3 }, (_, j) =>
              f(after.getFloat32(28 + j * 4, true) - previous.getFloat32(28 + j * 4, true)),
            ),
            squaredSpan = f(f(f(span[0] * span[0]) + f(span[1] * span[1])) + f(span[2] * span[2]));
          scaled[1] = f(f(state.strip + f(Math.sqrt(squaredSpan))) / state.strip);
        }
      }
      setMotionVector(graph.kx2, MOTION_ABI.scale, scaled);
      const color = view.getUint32(124, true),
        alpha = Math.trunc(
          linearInterpolate(color >>> 24, f(state.words[2] >>> 0), 0, state.length, i),
        );
      new DataView(graph.kx2.buffer).setUint32(
        MOTION_ABI.color,
        (color & 0xffffff) | (alpha << 24),
        true,
      );
      graph.style = { ...this.task.state, trail: null, colorOverride: true };
      new DataView(graph.kx2.buffer).setUint32(MOTION_ABI.display, view.getUint32(8, true), true);
      graph.priority = base[2];
      this.task.graphics.graphs.set(graph.nativeID, graph);
    }
  }
  drawItems() {
    return (this.state?.graphs ?? []).map((graph) => ({
      type: 'plane',
      n: '@' + graph.nativeID,
      p: { nativeGraph: graph },
      priority: graph.priority,
      nativeRenderOrder: graph.renderOrder,
      drawGPU: (gpu) => this.task.drawGraph(gpu, graph, graph.style),
    }));
  }
}
