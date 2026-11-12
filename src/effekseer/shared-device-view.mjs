// SPDX-License-Identifier: MPL-2.0
// Semantic view of one existing shared device. It owns no material/target state.
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
const BINDINGS = Object.freeze([
  'vertexShader',
  'pixelShader',
  'vertexDeclaration',
  'texture0',
  'fvf',
]);
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
  constructor({ context, bindings, samplers, gpu, viewport } = {}) {
    if (
      !(context?.states instanceof Map) ||
      !(context?.samplers instanceof Map) ||
      !(context?.stages instanceof Map)
    )
      throw new TypeError('Current complete D3D context is required');
    for (const [id] of Object.values(STATES))
      if (!context.states.has(id)) throw new Error('Current D3D state is missing ' + id);
    for (const [name, owner, method] of [
      ['bindings', bindings, 'get'],
      ['bindings', bindings, 'set'],
      ['samplers', samplers, 'set'],
      ['gpu', gpu, 'clear'],
    ])
      if (typeof owner?.[method] !== 'function')
        throw new TypeError('Shared Effekseer ' + name + '.' + method + ' operation is required');
    if (typeof viewport !== 'function')
      throw new TypeError('Current shared viewport getter is required');
    Object.assign(this, { context, bindings, samplers, gpu, viewport });
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
  getBinding(name) {
    if (!BINDINGS.includes(name)) throw new Error('Unknown Effekseer shared binding ' + name);
    return this.bindings.get(name);
  }
  setBinding(name, value) {
    if (!BINDINGS.includes(name)) throw new Error('Unknown Effekseer shared binding ' + name);
    this.bindings.set(name, value);
  }
  setSampler(stage, name, value) {
    if (!Number.isInteger(stage) || stage < 0 || stage > 3)
      throw new Error('Effekseer sampler stage outside original four');
    const [id, spec] = field(SAMPLERS, name);
    // Required owner operation updates its actual sampler stage; no shadow map.
    this.samplers.set(stage, id, rawValue(value, spec));
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
