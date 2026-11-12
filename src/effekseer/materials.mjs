// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// State transitions adapted from fixed Effekseer 1.23 RendererDX9.
// See ../../licenses/effekseer-MIT.txt. Shared semantic device view, no GPU owner.

export const EFFEKSEER_RESTORED_STATES = Object.freeze([
  'alphaBlendEnabled',
  'blendOperation',
  'destinationBlend',
  'sourceBlend',
  'alphaReference',
  'depthTestEnabled',
  'depthWriteEnabled',
  'alphaTestEnabled',
  'culling',
  'colorVertex',
  'lighting',
  'shadeMode',
]);
export const EFFEKSEER_RESTORED_BINDINGS = Object.freeze([
  'vertexShader',
  'pixelShader',
  'vertexDeclaration',
  'texture0',
  'fvf',
]);
const BLEND = Object.freeze([
  { enabled: false, operation: 'add', source: 'one', destination: 'zero', reference: 127 },
  {
    enabled: true,
    operation: 'add',
    source: 'sourceAlpha',
    destination: 'inverseSourceAlpha',
    reference: 0,
  },
  { enabled: true, operation: 'add', source: 'sourceAlpha', destination: 'one', reference: 0 },
  {
    enabled: true,
    operation: 'reverseSubtract',
    source: 'sourceAlpha',
    destination: 'one',
    reference: 0,
  },
  { enabled: true, operation: 'add', source: 'zero', destination: 'sourceColor', reference: 0 },
]);
const choice = (value, max, field) => {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(`Unimplemented Effekseer material ${field}: ${value}`);
  return value;
};
const boolean = (value, field) => {
  if (typeof value !== 'boolean') throw new Error(`Invalid Effekseer material ${field}`);
  return value;
};

// No default device or copied material context exists. This view must delegate
// to the current World-owned device states, bindings and four sampler stages.
export class EffekseerDeviceScope {
  constructor(device, { restoreStates = true } = {}) {
    for (const name of [
      'getState',
      'setState',
      'getBinding',
      'setBinding',
      'setSampler',
      'clearDepth',
    ])
      if (typeof device?.[name] !== 'function')
        throw new TypeError(`Effekseer shared device operation ${name} is required`);
    boolean(restoreStates, 'restoreStates');
    this.device = device;
    this.restoreStates = restoreStates;
    this.savedStates = new Array(EFFEKSEER_RESTORED_STATES.length);
    this.savedBindings = new Array(EFFEKSEER_RESTORED_BINDINGS.length);
    this.active = false;
    this.closed = false;
  }
  begin() {
    if (this.closed || this.active) throw new Error('Effekseer device scope is not fresh');
    const d = this.device;
    if (this.restoreStates) {
      for (let i = 0; i < EFFEKSEER_RESTORED_STATES.length; i++)
        this.savedStates[i] = d.getState(EFFEKSEER_RESTORED_STATES[i]);
      for (let i = 0; i < EFFEKSEER_RESTORED_BINDINGS.length; i++)
        this.savedBindings[i] = d.getBinding(EFFEKSEER_RESTORED_BINDINGS[i]);
    }
    this.active = true;
    d.setBinding('texture0', null);
    d.setBinding('fvf', 0);
    d.setState('colorVertex', true);
    d.setState('lighting', false);
    d.setState('shadeMode', 'gouraud');
    this.applyValues(false, false, 1, 0, 1);
    // Renderer Begin forces all four default sampler states, not only stage0.
    for (let stage = 1; stage < 4; stage++) this.sampler(stage, 0, 1);
    d.setState('alphaTestEnabled', true);
    d.setState('alphaBlendEnabled', true);
    return this;
  }
  assertActive() {
    if (!this.active || this.closed) throw new Error('Effekseer device scope is not active');
  }
  sampler(stage, filter, wrap) {
    const d = this.device,
      f = filter === 0 ? 'point' : 'linear',
      address = wrap === 0 ? 'repeat' : 'clamp';
    d.setSampler(stage, 'minFilter', f);
    d.setSampler(stage, 'magFilter', f);
    d.setSampler(stage, 'mipFilter', filter === 0 ? 'none' : 'linear');
    d.setSampler(stage, 'addressU', address);
    d.setSampler(stage, 'addressV', address);
  }
  applyValues(zTest, zWrite, blend, filter, wrap) {
    const d = this.device,
      b = BLEND[blend];
    d.setState('depthTestEnabled', zTest);
    d.setState('depthWriteEnabled', zWrite);
    d.setState('culling', 'none');
    d.setState('alphaBlendEnabled', b.enabled);
    d.setState('blendOperation', b.operation);
    d.setState('destinationBlend', b.destination);
    d.setState('sourceBlend', b.source);
    d.setState('alphaReference', b.reference);
    this.sampler(0, filter, wrap);
  }
  applyNormalMaterial(node) {
    this.assertActive();
    const texture = node?.texture,
      renderer = node?.renderer;
    if (!texture || !renderer) throw new TypeError('Effekseer node material is required');
    if (texture.distortion)
      throw new Error(
        'The original null-background branch must precede ordinary material submission',
      );
    // Legacy pre-v3 Sprite/Ribbon/Ring carry their blend and texture index in
    // the renderer block, not the later shared common block.
    const blend = choice(renderer.alphaBlend ?? texture.alphaBlend, 4, 'blend'),
      filter = choice(texture.filter, 1, 'filter'),
      wrap = choice(texture.wrap, 1, 'wrap'),
      zTest = boolean(texture.zTest, 'zTest'),
      zWrite = boolean(texture.zWrite, 'zWrite');
    this.applyValues(zTest, zWrite, blend, filter, wrap);
    return this;
  }
  // The original task calls its engine depth prelude after Renderer.Begin and
  // before Manager.Draw. Clear only the depth attachment of the CURRENT target.
  clearCurrentDepth(enabled) {
    this.assertActive();
    boolean(enabled, 'depthStencilEnabled');
    if (enabled) this.device.clearDepth(1);
  }
  end() {
    this.assertActive();
    const d = this.device;
    if (this.restoreStates) {
      for (let i = 0; i < EFFEKSEER_RESTORED_STATES.length; i++)
        d.setState(EFFEKSEER_RESTORED_STATES[i], this.savedStates[i]);
      for (let i = 0; i < EFFEKSEER_RESTORED_BINDINGS.length; i++)
        d.setBinding(EFFEKSEER_RESTORED_BINDINGS[i], this.savedBindings[i]);
    }
    this.active = false;
  }
  close() {
    if (this.closed) return;
    if (this.active) this.end();
    this.closed = true;
  }
}
