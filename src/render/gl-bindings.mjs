// SPDX-License-Identifier: MPL-2.0
// Temporary physical WebGL capture. ParticlesGL remains the only resource owner;
// these handles are never part of a World checkpoint or a D3D shadow device.
const CAPABILITIES = [
  'BLEND',
  'CULL_FACE',
  'DEPTH_TEST',
  'SCISSOR_TEST',
  'STENCIL_TEST',
  'POLYGON_OFFSET_FILL',
  'DITHER',
];
const OPERATIONS = [
  ['blendEquationSeparate', ['BLEND_EQUATION_RGB', 'BLEND_EQUATION_ALPHA']],
  ['blendFuncSeparate', ['BLEND_SRC_RGB', 'BLEND_DST_RGB', 'BLEND_SRC_ALPHA', 'BLEND_DST_ALPHA']],
  ['depthFunc', ['DEPTH_FUNC']],
  ['depthMask', ['DEPTH_WRITEMASK']],
  ['clearDepth', ['DEPTH_CLEAR_VALUE']],
  ['clearStencil', ['STENCIL_CLEAR_VALUE']],
  ['frontFace', ['FRONT_FACE']],
  ['cullFace', ['CULL_FACE_MODE']],
  ['polygonOffset', ['POLYGON_OFFSET_FACTOR', 'POLYGON_OFFSET_UNITS']],
  ['stencilFuncSeparate', ['STENCIL_FUNC', 'STENCIL_REF', 'STENCIL_VALUE_MASK'], 'FRONT'],
  [
    'stencilFuncSeparate',
    ['STENCIL_BACK_FUNC', 'STENCIL_BACK_REF', 'STENCIL_BACK_VALUE_MASK'],
    'BACK',
  ],
  [
    'stencilOpSeparate',
    ['STENCIL_FAIL', 'STENCIL_PASS_DEPTH_FAIL', 'STENCIL_PASS_DEPTH_PASS'],
    'FRONT',
  ],
  [
    'stencilOpSeparate',
    ['STENCIL_BACK_FAIL', 'STENCIL_BACK_PASS_DEPTH_FAIL', 'STENCIL_BACK_PASS_DEPTH_PASS'],
    'BACK',
  ],
  ['stencilMaskSeparate', ['STENCIL_WRITEMASK'], 'FRONT'],
  ['stencilMaskSeparate', ['STENCIL_BACK_WRITEMASK'], 'BACK'],
];
const VECTORS = [
  ['viewport', 'VIEWPORT'],
  ['depthRange', 'DEPTH_RANGE'],
  ['scissor', 'SCISSOR_BOX'],
  ['blendColor', 'BLEND_COLOR'],
  ['colorMask', 'COLOR_WRITEMASK'],
  ['clearColor', 'COLOR_CLEAR_VALUE'],
];
const UNPACK = [
  'UNPACK_ALIGNMENT',
  'UNPACK_ROW_LENGTH',
  'UNPACK_IMAGE_HEIGHT',
  'UNPACK_SKIP_PIXELS',
  'UNPACK_SKIP_ROWS',
  'UNPACK_SKIP_IMAGES',
  'UNPACK_FLIP_Y_WEBGL',
  'UNPACK_PREMULTIPLY_ALPHA_WEBGL',
  'UNPACK_COLORSPACE_CONVERSION_WEBGL',
];

// The linked program, rather than a semantic VS/PS/FVF label, supplies its actual
// active locations and types. This fixed backend has scalar/vector/mat4 uniforms.
export function describeGLUniforms(gl, program) {
  const methods = new Map([
    [gl.FLOAT, 'uniform1f'],
    [gl.INT, 'uniform1i'],
    [gl.BOOL, 'uniform1i'],
    [gl.SAMPLER_2D, 'uniform1i'],
    [gl.FLOAT_VEC2, 'uniform2fv'],
    [gl.FLOAT_VEC3, 'uniform3fv'],
    [gl.FLOAT_VEC4, 'uniform4fv'],
    [gl.INT_VEC2, 'uniform2iv'],
    [gl.INT_VEC3, 'uniform3iv'],
    [gl.INT_VEC4, 'uniform4iv'],
    [gl.FLOAT_MAT4, 'uniformMatrix4fv'],
  ]);
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  if (!Number.isInteger(count) || count < 0)
    throw new Error('Linked GL uniform metadata is unavailable');
  return Array.from({ length: count }, (_, index) => {
    const info = gl.getActiveUniform(program, index),
      method = info && methods.get(info.type),
      location = info && gl.getUniformLocation(program, info.name);
    if (!method || info.size !== 1 || location === null)
      throw new Error('Unimplemented shared GL uniform type or array');
    return { location, method };
  });
}
export function createGLBindingCapture(gpu) {
  if (!gpu.graphicsDevice) throw new Error('Physical GL capture requires its shared device owner');
  return {
    owner: gpu,
    active: false,
    uniforms: [],
    textures: new Array(4),
    samplers: new Array(4),
    capabilities: new Array(CAPABILITIES.length),
    operations: OPERATIONS.map(([, names]) => new Array(names.length)),
    vectors: new Array(VECTORS.length),
    unpack: new Array(UNPACK.length),
  };
}
function releaseCapture(capture) {
  capture.active = false;
  capture.device = capture.backendProgram = capture.program = capture.vertexArray = null;
  capture.arrayBuffer = capture.elementArrayBuffer = null;
  capture.drawFramebuffer = capture.readFramebuffer = capture.renderbuffer = null;
  capture.textures.fill(null);
  capture.samplers.fill(null);
}
function requireCapture(gpu, capture, active) {
  if (!capture || capture.owner !== gpu || capture.active !== active)
    throw new Error('Physical GL binding capture has a different owner or pass state');
}
export function captureGLBindings(gpu, capture) {
  requireCapture(gpu, capture, false);
  gpu.requireDevice();
  if (!gpu.drawing) throw new Error('Physical GL capture requires an open renderer frame');
  try {
    const gl = gpu.gl;
    capture.device = gpu.graphicsDevice;
    capture.generation = capture.device.generation;
    capture.backendProgram = gpu.program;
    capture.program = gl.getParameter(gl.CURRENT_PROGRAM);
    capture.vertexArray = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    capture.arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    capture.elementArrayBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
    capture.drawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    capture.readFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    capture.renderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
    capture.activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    try {
      for (let unit = 0; unit < 4; unit++) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        capture.textures[unit] = gl.getParameter(gl.TEXTURE_BINDING_2D);
        capture.samplers[unit] = gl.getParameter(gl.SAMPLER_BINDING);
      }
    } finally {
      gl.activeTexture(capture.activeTexture);
    }
    for (let i = 0; i < CAPABILITIES.length; i++)
      capture.capabilities[i] = gl.isEnabled(gl[CAPABILITIES[i]]);
    for (let i = 0; i < OPERATIONS.length; i++)
      OPERATIONS[i][1].forEach((name, j) => {
        capture.operations[i][j] = gl.getParameter(gl[name]);
      });
    for (let i = 0; i < VECTORS.length; i++)
      capture.vectors[i] = gl.getParameter(gl[VECTORS[i][1]]);
    for (let i = 0; i < UNPACK.length; i++) capture.unpack[i] = gl.getParameter(gl[UNPACK[i]]);
    capture.uniforms.length = gpu.bindingUniforms.length;
    for (let i = 0; i < gpu.bindingUniforms.length; i++)
      capture.uniforms[i] = gl.getUniform(gpu.program, gpu.bindingUniforms[i].location);
    if (gl.isContextLost()) {
      gpu.noticeLoss();
      throw new Error('Graphics context was lost during physical binding capture');
    }
    capture.active = true;
    return capture;
  } catch (error) {
    releaseCapture(capture);
    throw error;
  }
}
export function restoreGLBindings(gpu, capture) {
  requireCapture(gpu, capture, true);
  const gl = gpu.gl;
  try {
    if (gpu.closed) return false;
    if (gl.isContextLost()) {
      gpu.noticeLoss();
      return false;
    }
    // A lost/rebuilt/retired owner cannot receive an old generation's handles.
    if (
      gpu.graphicsDevice !== capture.device ||
      capture.device.generation !== capture.generation ||
      !capture.device.ready
    )
      return false;
    if (gpu.program !== capture.backendProgram)
      throw new Error('GL program changed within a shared device generation');
    gl.useProgram(gpu.program);
    for (let i = 0; i < gpu.bindingUniforms.length; i++) {
      const { location, method } = gpu.bindingUniforms[i],
        value = capture.uniforms[i];
      if (method === 'uniformMatrix4fv') gl[method](location, false, value);
      else gl[method](location, value);
    }
    // Attribute pointers remain isolated in the backend VAO. The entry VAO
    // may itself be that VAO, so its captured ELEMENT binding needs an explicit
    // restore after selection; null attribute pointers need no setter.
    gl.bindVertexArray(capture.vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, capture.elementArrayBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, capture.arrayBuffer);
    for (let unit = 0; unit < 4; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, capture.textures[unit]);
      gl.bindSampler(unit, capture.samplers[unit]);
    }
    gl.activeTexture(capture.activeTexture);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, capture.drawFramebuffer);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, capture.readFramebuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, capture.renderbuffer);
    for (let i = 0; i < CAPABILITIES.length; i++) {
      if (capture.capabilities[i]) gl.enable(gl[CAPABILITIES[i]]);
      else gl.disable(gl[CAPABILITIES[i]]);
    }
    for (let i = 0; i < OPERATIONS.length; i++) {
      const [method, , face] = OPERATIONS[i],
        args = capture.operations[i];
      if (face) gl[method](gl[face], ...args);
      else gl[method](...args);
    }
    for (let i = 0; i < VECTORS.length; i++) gl[VECTORS[i][0]](...capture.vectors[i]);
    for (let i = 0; i < UNPACK.length; i++) gl.pixelStorei(gl[UNPACK[i]], capture.unpack[i]);
    gl.useProgram(capture.program);
    return true;
  } finally {
    releaseCapture(capture);
  }
}
