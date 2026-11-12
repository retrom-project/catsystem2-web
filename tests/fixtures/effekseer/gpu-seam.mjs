// SPDX-License-Identifier: MPL-2.0
// Node GL command recorder only. No shader compiler, GPU raster or pixels.
import { ParticlesGL, createD3DContext } from '../../../src/render/particles-gl.mjs';
import { StageRenderer } from '../../../src/render/stage.mjs';
import { EffekseerDeviceScope } from '../../../src/effekseer/materials.mjs';
import { EffekseerPackedMesh } from '../../../src/effekseer/mesh-packet.mjs';
import { EffekseerSharedDeviceView } from '../../../src/effekseer/shared-device-view.mjs';
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const material = (blend = 1, filter = 0, wrap = 1) => ({
  renderer: { alphaBlend: blend },
  texture: { zTest: true, zWrite: false, filter, wrap, distortion: false },
});
function recorder() {
  const calls = [],
    uniforms = new Map(),
    enabled = new Set(),
    state = { viewport: [0, 0, 64, 48], depthRange: [0, 1], framebuffer: null },
    buffers = new Map();
  let gl;
  const methods = {
    getParameter(key) {
      if (key === 'VIEWPORT') return [...state.viewport];
      if (key === 'DEPTH_RANGE') return [...state.depthRange];
      throw new Error('Unexpected query ' + key);
    },
    viewport(...args) {
      state.viewport = args;
    },
    depthRange(...args) {
      state.depthRange = args;
    },
    bindFramebuffer(_, value) {
      state.framebuffer = value;
    },
    bindBuffer(key, value) {
      buffers.set(key, value);
    },
    enable(key) {
      enabled.add(key);
    },
    disable(key) {
      enabled.delete(key);
    },
    drawElements(...args) {
      calls.push({
        method: 'drawElementsSnapshot',
        args,
        viewport: [...state.viewport],
        depthRange: [...state.depthRange],
        framebuffer: state.framebuffer,
        uniforms: new Map(uniforms),
        enabled: new Set(enabled),
      });
      if (state.failDraw) throw new Error('retained draw failure');
    },
    drawArrays(...args) {
      calls.push({
        method: 'drawArraysSnapshot',
        args,
        uniforms: new Map(uniforms),
        framebuffer: state.framebuffer,
      });
    },
  };
  const target = { COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100, STENCIL_BUFFER_BIT: 0x0400 };
  gl = new Proxy(target, {
    get(object, key) {
      if (Object.hasOwn(object, key)) return object[key];
      if (typeof key !== 'string') return undefined;
      if (key.toUpperCase() === key) return key;
      return (...args) => {
        calls.push({ method: key, args });
        if (key.startsWith('uniform'))
          uniforms.set(
            args[0],
            args.slice(1).map((x) => (ArrayBuffer.isView(x) ? Array.from(x) : x)),
          );
        return methods[key]?.(...args);
      };
    },
  });
  return { gl, calls, uniforms, state, buffers, enabled };
}
function setup() {
  const r = recorder(),
    gpu = Object.create(ParticlesGL.prototype),
    context = createD3DContext({ depthStencilEnabled: true });
  Object.assign(gpu, {
    gl: r.gl,
    drawing: true,
    canvas: { width: 64, height: 48 },
    primaryTarget: {
      framebuffer: { id: 'primary' },
      width: 64,
      height: 48,
      depthStencil: { id: 'primaryDepth' },
    },
    activeTarget: {
      framebuffer: { id: 'surface' },
      width: 32,
      height: 24,
      depthStencil: { id: 'surfaceDepth' },
    },
    program: { id: 'sharedProgram' },
    buffer: { id: 'sharedVertices' },
    effekseerIndexBuffer: { id: 'efkIndices' },
    destination: { id: 'destination' },
    uniform: new Proxy({}, { get: (_, key) => key }),
    frameContext: context,
    frameOpaqueTarget: false,
    anisotropy: null,
  });
  gpu.texture = (frame) => {
    r.calls.push({ method: 'textureLookup', args: [frame] });
    return frame;
  };
  const stage = Object.create(StageRenderer.prototype);
  stage.gpu = gpu;
  const bindings = new Map([
    ['vertexShader', { id: 'ordinaryVS' }],
    ['pixelShader', { id: 'ordinaryPS' }],
    ['vertexDeclaration', { id: 'ordinaryVD' }],
    ['texture0', { id: 'ordinaryTexture' }],
    ['fvf', 0x144],
  ]);
  const samplerStages = new Map([[0, context.samplers]]);
  const viewport = [3, 4, 24, 16, 0.25, 0.75];
  const view = new EffekseerSharedDeviceView({
    context,
    gpu,
    viewport: () => viewport,
    bindings: { get: (n) => bindings.get(n), set: (n, v) => bindings.set(n, v) },
    samplers: {
      set(stage, id, value) {
        if (!samplerStages.has(stage)) samplerStages.set(stage, new Map());
        samplerStages.get(stage).set(id, value);
      },
    },
  });
  const scope = new EffekseerDeviceScope(view);
  return { ...r, gpu, stage, context, view, scope, bindings, samplerStages, viewport };
}
function packet(quads = 1, viewport = [3, 4, 24, 16, 0.25, 0.75]) {
  const positions = new Float32Array(quads * 12),
    uv = new Float32Array(quads * 8),
    colors = new Uint8Array(quads * 16).fill(255),
    indices = new Uint32Array(quads * 6);
  for (let i = 0; i < quads; i++) {
    positions.set([-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5, 1, 1, 0.5], i * 12);
    indices.set(
      [3, 1, 0, 3, 0, 2].map((x) => x + i * 4),
      i * 6,
    );
  }
  return new EffekseerPackedMesh().prepare(
    {
      kind: 'sprite',
      coordinateSpace: 'world',
      positions,
      uv,
      colors,
      indices,
      vertexCount: quads * 4,
      indexCount: quads * 6,
    },
    { camera: I, projection: I, viewport },
  );
}
const triangle = [
  {
    vertices: [
      { x: 2, y: 2, z: 0.5, w: 1, color: 0xffffffff, u: 0, v: 0 },
      { x: 10, y: 2, z: 0.5, w: 1, color: 0xff0000ff, u: 1, v: 0 },
      { x: 2, y: 10, z: 0.5, w: 1, color: 0xff00ff00, u: 0, v: 1 },
    ],
  },
];
const draw = (s, p = packet(), frame = { id: 'effectTexture' }) =>
  s.stage.drawEffekseer(p, frame, { state: s.view.state, context: s.context });
const snapshots = (s) => s.calls.filter((c) => c.method === 'drawElementsSnapshot');

export { recorder, setup, packet, triangle, draw, snapshots, I, material };
