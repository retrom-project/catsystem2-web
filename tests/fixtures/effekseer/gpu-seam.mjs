// SPDX-License-Identifier: MPL-2.0
// Node GL command recorder only. No shader compiler, GPU raster or pixels.
import { ParticlesGL, createD3DContext } from '../../../src/render/particles-gl.mjs';
import { StageRenderer } from '../../../src/render/stage.mjs';
import { EffekseerDeviceScope } from '../../../src/effekseer/materials.mjs';
import { EffekseerPackedMesh } from '../../../src/effekseer/mesh-packet.mjs';
import { EffekseerSharedDeviceView } from '../../../src/effekseer/shared-device-view.mjs';
import { glBindingRecorder } from '../gl-binding-recorder.mjs';
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const material = (blend = 1, filter = 0, wrap = 1) => ({
  renderer: { alphaBlend: blend },
  texture: { zTest: true, zWrite: false, filter, wrap, distortion: false },
});
function recorder() {
  const model = glBindingRecorder(),
    calls = [],
    queries = [],
    uniforms = new Map();
  const enumArgs = (method, args) =>
    args.map((value, i) => {
      const enumIndex = [
        'enable',
        'disable',
        'depthFunc',
        'frontFace',
        'cullFace',
        'bindVertexArray',
      ].includes(method)
        ? i === 0
        : method === 'drawElements'
          ? i === 0 || i === 2
          : ['drawArrays', 'bindBuffer', 'bindFramebuffer', 'bindTexture'].includes(method)
            ? i === 0
            : false;
      return enumIndex ? (model.enumName(value) ?? value) : value;
    });
  const gl = new Proxy(model.gl, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (key === 'isContextLost') {
          queries.push('isContextLost');
          return value(...args);
        }
        if (key === 'drawElements' || key === 'drawArrays') {
          calls.push({
            method: key + 'Snapshot',
            args: enumArgs(key, args),
            viewport: Array.from(model.gl.getParameter(model.gl.VIEWPORT)),
            depthRange: Array.from(model.gl.getParameter(model.gl.DEPTH_RANGE)),
            framebuffer: model.state.drawFramebuffer,
            uniforms: new Map(uniforms),
            enabled: new Set([...model.enabled].map((v) => model.enumName(v))),
          });
          if (model.state.failDraw) throw new Error('retained draw failure');
        }
        const result = value(...args);
        calls.push({ method: key, args: enumArgs(key, args) });
        if (String(key).startsWith('uniform')) {
          const values = args.slice(1).map((x) => (ArrayBuffer.isView(x) ? Array.from(x) : x));
          if (key === 'uniform1i') values[0] = Number(values[0]);
          uniforms.set(args[0].name, values);
        }
        return result;
      };
    },
  });
  return { ...model, gl, calls, queries, uniforms };
}
function setup() {
  const r = recorder(),
    previous = globalThis.OffscreenCanvas;
  let gpu;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return r.gl;
    }
    addEventListener() {}
    removeEventListener() {}
  };
  try {
    gpu = new ParticlesGL(64, 48);
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
  const context = createD3DContext({ depthStencilEnabled: true }),
    stage = new StageRenderer(),
    viewport = [3, 4, 24, 16, 0.25, 0.75];
  stage.gpu = gpu;
  stage.bindGraphicsDevice(gpu.graphicsDevice);
  gpu.frameContext = context;
  gpu.beginFrame();
  const target = gpu.createRenderTarget(32, 24),
    depth = gpu.createDepthStencil(32, 24, 75);
  gpu.enterRenderTarget(target, depth);
  gpu.clear({ flags: 7 });
  // Authored prior GL viewport differs from the explicit native draw packet.
  r.gl.viewport(0, 0, 64, 48);
  r.gl.depthRange(0, 1);
  Object.defineProperties(r.state, {
    viewport: { get: () => Array.from(r.parameters.get(r.gl.VIEWPORT)) },
    depthRange: { get: () => Array.from(r.parameters.get(r.gl.DEPTH_RANGE)) },
  });
  gpu.texture = (frame) => {
    r.calls.push({ method: 'textureLookup', args: [frame] });
    return frame;
  };
  const view = new EffekseerSharedDeviceView({ context, gpu, viewport: () => viewport }),
    scope = new EffekseerDeviceScope(view),
    samplerStages = context.samplerStages;
  const physical = () => ({
    program: r.state.program,
    vertexArray: r.state.vertexArray,
    arrayBuffer: r.state.arrayBuffer,
    element: r.vaos.get(r.state.vertexArray).element,
    textures: [...r.state.textures],
    samplers: [...r.state.samplers],
    activeUnit: r.state.activeUnit,
    drawFramebuffer: r.state.drawFramebuffer,
    readFramebuffer: r.state.readFramebuffer,
    renderbuffer: r.state.renderbuffer,
    parameters: new Map(
      [...r.parameters].map(([k, v]) => [
        k,
        ArrayBuffer.isView(v) || Array.isArray(v) ? v.slice() : v,
      ]),
    ),
    enabled: new Set(r.enabled),
    uniforms: [...gpu.program.uniforms].map(([name, v]) => [
      name,
      ArrayBuffer.isView(v.value) ? v.value.slice() : v.value,
    ]),
  });
  r.calls.length = 0;
  r.queries.length = 0;
  return { ...r, gpu, stage, context, view, scope, samplerStages, viewport, physical };
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
