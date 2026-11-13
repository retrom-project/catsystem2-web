// SPDX-License-Identifier: MPL-2.0
// Borrowed D3D-state and physical-GL operations; no separate device or target owner.
import { d3dSamplerStages, setD3DSamplerState } from '../render/particles-gl.mjs';
const STATES = Object.freeze({
  alphaBlendEnabled: [27, 'boolean'],
  blendOperation: [171, { add: 1, subtract: 2, reverseSubtract: 3, min: 4, max: 5 }],
  destinationBlend: [
    20,
    {
      zero: 1,
      one: 2,
      sourceColor: 3,
      inverseSourceColor: 4,
      sourceAlpha: 5,
      inverseSourceAlpha: 6,
    },
  ],
  sourceBlend: [
    19,
    {
      zero: 1,
      one: 2,
      sourceColor: 3,
      inverseSourceColor: 4,
      sourceAlpha: 5,
      inverseSourceAlpha: 6,
    },
  ],
  alphaReference: [24, 'number'],
  depthTestEnabled: [7, 'boolean'],
  depthWriteEnabled: [14, 'boolean'],
  alphaTestEnabled: [15, 'boolean'],
  culling: [22, { none: 1, clockwise: 2, counterClockwise: 3 }],
  colorVertex: [141, 'boolean'],
  lighting: [137, 'boolean'],
  shadeMode: [9, { flat: 1, gouraud: 2, phong: 3 }],
});
const SAMPLERS = Object.freeze({
  minFilter: [6, { point: 1, linear: 2 }],
  magFilter: [5, { point: 1, linear: 2 }],
  mipFilter: [7, { none: 0, point: 1, linear: 2 }],
  addressU: [1, { repeat: 1, clamp: 3 }],
  addressV: [2, { repeat: 1, clamp: 3 }],
});
const invalidations = new WeakSet();
export function isEffekseerDeviceInvalidation(error) {
  const path = new Set();
  const known = (value) => {
    if (value && invalidations.has(value)) return true;
    if (
      !(value instanceof AggregateError) ||
      !Array.isArray(value.errors) ||
      value.errors.length === 0 ||
      path.has(value)
    )
      return false;
    path.add(value);
    for (const leaf of value.errors) {
      if (!known(leaf)) {
        path.delete(value);
        return false;
      }
    }
    path.delete(value);
    return true;
  };
  return known(error);
}
function lifecycle(gpu, stamp) {
  if (gpu !== stamp.owner) return null;
  if (gpu.closed) return 'backend-closed';
  if (gpu.gl.isContextLost()) gpu.noticeLoss();
  if (gpu.graphicsDevice !== stamp.device) return 'device-retired';
  if (stamp.device.generation !== stamp.generation) return 'generation-changed';
  if (!stamp.device.ready) return stamp.device.status;
  return null;
}
function unavailable(reason) {
  const error = new Error('Effekseer physical graphics pass was invalidated: ' + reason);
  invalidations.add(error);
  return error;
}
function rawValue(value, spec) {
  // Saved raw values must restore verbatim, including D3DZB_USEW=2.
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) return value >>> 0;
  if (spec === 'boolean' && typeof value === 'boolean') return Number(value);
  if (spec && typeof spec === 'object' && Object.hasOwn(spec, value)) return spec[value];
  throw new Error('Invalid Effekseer shared semantic state value');
}
function field(table, name) {
  if (!Object.hasOwn(table, name)) throw new Error('Unknown Effekseer shared device field ' + name);
  return table[name];
}
export class EffekseerSharedDeviceView {
  constructor({ context, gpu, viewport } = {}) {
    if (
      !(context?.states instanceof Map) ||
      !(context?.samplers instanceof Map) ||
      !(context?.stages instanceof Map)
    )
      throw new TypeError('Current complete D3D context is required');
    d3dSamplerStages(context);
    for (const [id] of Object.values(STATES))
      if (!context.states.has(id)) throw new Error('Current D3D state is missing ' + id);
    for (const [name, owner, method] of [
      ...[
        'clear',
        'createBindingCapture',
        'captureBindings',
        'restoreBindings',
        'requireDevice',
        'bindVertexLayout',
      ].map((name) => ['gpu', gpu, name]),
    ])
      if (typeof owner?.[method] !== 'function')
        throw new TypeError('Shared Effekseer ' + name + '.' + method + ' operation is required');
    if (typeof viewport !== 'function')
      throw new TypeError('Current shared viewport getter is required');
    Object.assign(this, { context, gpu, viewport });
    this.state = { states: context.states, samplers: context.samplers, stages: context.stages };
    // Reuse the Clear rectangle and its containing list across calls.
    this.clearRectangle = [0, 0, 0, 0];
    this.clearRectangles = [this.clearRectangle];
  }
  getState(name) {
    return this.context.states.get(field(STATES, name)[0]);
  }
  setState(name, value) {
    const [id, spec] = field(STATES, name);
    this.context.states.set(id, rawValue(value, spec));
  }
  assertEntry() {
    this.gpu.requireDevice();
    if (!this.gpu.drawing)
      throw new Error('Effekseer physical entry requires an open renderer frame');
  }
  createBindingCapture() {
    return this.gpu.createBindingCapture();
  }
  captureBindings(capture) {
    return this.gpu.captureBindings(capture);
  }
  assertCapture(capture) {
    if (!capture || !capture.active || capture.owner !== this.gpu)
      throw new Error('Effekseer physical pass requires its active capture');
    const reason = lifecycle(this.gpu, capture);
    if (reason) throw unavailable(reason);
  }
  restoreBindings(capture) {
    if (!capture || !capture.active || capture.owner !== this.gpu)
      throw new Error('Effekseer physical restore requires its active capture');
    const stamp = { owner: capture.owner, device: capture.device, generation: capture.generation };
    // No GL exception is reclassified. Only a false return with an actual
    // captured-owner lifecycle explanation receives the private brand.
    const restored = this.gpu.restoreBindings(capture);
    if (restored === false) {
      const reason = lifecycle(this.gpu, stamp);
      if (reason) throw unavailable(reason);
      throw new Error('Physical GL restoration returned false without lifecycle evidence');
    }
    return restored;
  }
  beginNormalPipeline(capture = null) {
    if (capture) this.assertCapture(capture);
    else this.gpu.requireDevice();
    const gpu = this.gpu,
      gl = gpu.gl;
    gpu.bindVertexLayout();
    gl.useProgram(gpu.program);
    for (let unit = 0; unit < 4; unit++) gl.bindSampler(unit, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  setSampler(stage, name, value) {
    if (!Number.isInteger(stage) || stage < 0 || stage > 3)
      throw new Error('Effekseer sampler stage outside original four');
    const [id, spec] = field(SAMPLERS, name);
    setD3DSamplerState(this.context, stage, id, rawValue(value, spec));
  }
  clearDepth(depth) {
    if (depth !== 1) throw new Error('Unverified Effekseer task depth clear value');
    const viewport = this.viewport(),
      rectangle = this.clearRectangle;
    if (
      !viewport ||
      viewport.length !== 6 ||
      !viewport.every(Number.isFinite) ||
      viewport[2] <= 0 ||
      viewport[3] <= 0
    )
      throw new Error('Current shared viewport is required for depth clear');
    rectangle[0] = viewport[0];
    rectangle[1] = viewport[1];
    rectangle[2] = viewport[0] + viewport[2];
    rectangle[3] = viewport[1] + viewport[3];
    this.gpu.clear({ flags: 2, depth: 0x3f800000, rectangles: this.clearRectangles });
  }
}
