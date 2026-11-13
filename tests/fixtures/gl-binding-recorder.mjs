// SPDX-License-Identifier: MPL-2.0
// Strict authored WebGL API boundary recorder, not a compiler, driver or pixel
// oracle. It models VAO-local ELEMENT/attribute state and global ARRAY state.
export function glBindingRecorder() {
  let nextEnum = 0x100000,
    nextObject = 1;
  const constants = new Map([
      ['TEXTURE0', 0x84c0],
      ['TEXTURE1', 0x84c1],
      ['NO_ERROR', 0],
      ['COLOR_BUFFER_BIT', 0x4000],
      ['DEPTH_BUFFER_BIT', 0x100],
      ['STENCIL_BUFFER_BIT', 0x400],
    ]),
    names = new Map(),
    calls = [],
    objects = new Set(),
    enabled = new Set(),
    parameters = new Map();
  const attrib = () => ({
    buffer: null,
    enabled: false,
    size: 4,
    type: gl.FLOAT,
    normalized: false,
    stride: 0,
    offset: 0,
    integer: false,
    divisor: 0,
  });
  const state = {
    lost: false,
    failVAO: false,
    vertexArray: null,
    arrayBuffer: null,
    program: null,
    drawFramebuffer: null,
    readFramebuffer: null,
    renderbuffer: null,
    activeUnit: 0,
    textures: new Array(8).fill(null),
    samplers: new Array(8).fill(null),
    generic: Array.from({ length: 3 }, () => [0, 0, 0, 1]),
    failRestore: false,
  };
  const vaos = new Map(),
    clone = (x) => (Array.isArray(x) || ArrayBuffer.isView(x) ? x.slice() : x);
  const object = (kind, extra = {}) => {
    const result = { kind, id: nextObject++, deleted: false, ...extra };
    objects.add(result);
    return result;
  };
  const valid = (value, kind) =>
    !state.lost && objects.has(value) && value.kind === kind && !value.deleted;
  const currentVAO = () => vaos.get(state.vertexArray);
  const uniformType = (name) =>
    ({
      float: gl.FLOAT,
      int: gl.INT,
      bool: gl.BOOL,
      sampler2D: gl.SAMPLER_2D,
      vec2: gl.FLOAT_VEC2,
      vec3: gl.FLOAT_VEC3,
      vec4: gl.FLOAT_VEC4,
      ivec2: gl.INT_VEC2,
      ivec3: gl.INT_VEC3,
      ivec4: gl.INT_VEC4,
      mat4: gl.FLOAT_MAT4,
    })[name];
  const uniformValue = (type, values) => {
    const count = Number(type.match(/\d/)?.[0] ?? 1),
      n = type === 'mat4' ? 16 : count;
    if (type === 'bool') return Boolean(values[0] ?? 0);
    if (n === 1) return Number(values[0] ?? 0);
    return type.startsWith('i')
      ? Int32Array.from({ length: n }, (_, i) => values[i] ?? 0)
      : Float32Array.from({ length: n }, (_, i) => values[i] ?? 0);
  };
  const faceValues = (face, front, back, values) => {
    if (face === gl.FRONT || face === gl.FRONT_AND_BACK)
      front.forEach((key, i) => parameters.set(gl[key], values[i]));
    if (face === gl.BACK || face === gl.FRONT_AND_BACK)
      back.forEach((key, i) => parameters.set(gl[key], values[i]));
  };
  const methods = {
    getExtension(name) {
      return name === 'WEBGL_lose_context'
        ? {
            loseContext() {
              state.lost = true;
            },
          }
        : null;
    },
    isContextLost: () => state.lost,
    createShader: (type) => object('Shader', { type }),
    shaderSource(shader, source) {
      shader.source = source;
    },
    compileShader(shader) {
      shader.compiled = typeof shader.source === 'string';
    },
    getShaderParameter(shader, name) {
      if (name !== gl.COMPILE_STATUS) throw new Error('Unexpected shader query');
      return shader.compiled;
    },
    getShaderInfoLog: () => 'recorder: no GLSL compiler',
    createProgram: () => object('Program', { shaders: [], uniforms: new Map() }),
    attachShader(program, shader) {
      program.shaders.push(shader);
    },
    linkProgram(program) {
      program.linked = program.shaders.length === 2 && program.shaders.every((s) => s.compiled);
      for (const shader of program.shaders)
        for (const [, type, name] of shader.source.matchAll(/uniform\s+(\w+)\s+(\w+)\s*;/g))
          if (!program.uniforms.has(name)) {
            const location = { program, name, type };
            program.uniforms.set(name, {
              name,
              type: uniformType(type),
              size: 1,
              location,
              value: uniformValue(type, []),
            });
          }
    },
    getProgramParameter(program, name) {
      if (name === gl.LINK_STATUS) return program.linked;
      if (name === gl.ACTIVE_UNIFORMS) return program.uniforms.size;
      throw new Error('Unexpected program query');
    },
    getProgramInfoLog: () => 'recorder: no GLSL compiler',
    getActiveUniform: (program, index) => [...program.uniforms.values()][index],
    getUniformLocation: (program, name) => program.uniforms.get(name)?.location ?? null,
    getUniform(program, location) {
      if (location.program !== program) throw new Error('Different uniform program');
      return clone(program.uniforms.get(location.name).value);
    },
    useProgram(program) {
      state.program = program;
    },
    createVertexArray() {
      if (state.failVAO) return null;
      const vao = object('VertexArray');
      vaos.set(vao, { element: null, attributes: Array.from({ length: 3 }, attrib) });
      return vao;
    },
    bindVertexArray(vao) {
      if (!vaos.has(vao)) throw new Error('Invalid VAO');
      state.vertexArray = vao;
    },
    createBuffer: () => object('Buffer'),
    bindBuffer(target, buffer) {
      if (target === gl.ARRAY_BUFFER) state.arrayBuffer = buffer;
      else if (target === gl.ELEMENT_ARRAY_BUFFER) currentVAO().element = buffer;
      else throw new Error('Unmodeled buffer target');
    },
    bufferData(target, data) {
      const buffer = target === gl.ARRAY_BUFFER ? state.arrayBuffer : currentVAO().element;
      if (!buffer) throw new Error('No bound buffer');
      buffer.bytes = typeof data === 'number' ? data : data.byteLength;
    },
    enableVertexAttribArray(index) {
      currentVAO().attributes[index].enabled = true;
    },
    disableVertexAttribArray(index) {
      currentVAO().attributes[index].enabled = false;
    },
    vertexAttribPointer(index, size, type, normalized, stride, offset) {
      if (!state.arrayBuffer)
        throw new Error('Cannot restore a null attribute buffer with a setter');
      Object.assign(currentVAO().attributes[index], {
        buffer: state.arrayBuffer,
        size,
        type,
        normalized,
        stride,
        offset,
        integer: false,
      });
    },
    vertexAttribIPointer(index, size, type, stride, offset) {
      methods.vertexAttribPointer(index, size, type, false, stride, offset);
      currentVAO().attributes[index].integer = true;
    },
    vertexAttribDivisor(index, divisor) {
      currentVAO().attributes[index].divisor = divisor;
    },
    vertexAttrib4fv(index, values) {
      state.generic[index] = Array.from(values);
    },
    createTexture: () => object('Texture', { parameters: new Map() }),
    activeTexture(unit) {
      state.activeUnit = unit - gl.TEXTURE0;
    },
    bindTexture(target, texture) {
      if (target !== gl.TEXTURE_2D) throw new Error('Unmodeled texture target');
      state.textures[state.activeUnit] = texture;
    },
    createSampler: () => object('Sampler'),
    bindSampler(unit, sampler) {
      state.samplers[unit] = sampler;
    },
    texImage2D(_target, _level, _internal, width, height) {
      Object.assign(state.textures[state.activeUnit], { width, height });
    },
    texParameteri(_target, id, value) {
      state.textures[state.activeUnit].parameters.set(id, value);
    },
    texParameterf(_target, id, value) {
      state.textures[state.activeUnit].parameters.set(id, value);
    },
    createFramebuffer: () => object('Framebuffer', { attachments: new Map() }),
    bindFramebuffer(target, framebuffer) {
      if (state.failRestore) throw new Error('retained framebuffer restore failure');
      if (target === gl.FRAMEBUFFER || target === gl.DRAW_FRAMEBUFFER)
        state.drawFramebuffer = framebuffer;
      if (target === gl.FRAMEBUFFER || target === gl.READ_FRAMEBUFFER)
        state.readFramebuffer = framebuffer;
    },
    framebufferTexture2D(_target, attachment, _kind, texture) {
      state.drawFramebuffer.attachments.set(attachment, texture);
    },
    createRenderbuffer: () => object('Renderbuffer'),
    bindRenderbuffer(_target, buffer) {
      state.renderbuffer = buffer;
    },
    renderbufferStorage(_target, format, width, height) {
      Object.assign(state.renderbuffer, { format, width, height });
    },
    framebufferRenderbuffer(_target, attachment, _kind, buffer) {
      state.drawFramebuffer.attachments.set(attachment, buffer);
    },
    checkFramebufferStatus() {
      const f = state.drawFramebuffer,
        color = f?.attachments.get(gl.COLOR_ATTACHMENT0),
        depth = f?.attachments.get(gl.DEPTH_STENCIL_ATTACHMENT);
      return color?.width > 0 && color.width === depth?.width && color.height === depth?.height
        ? gl.FRAMEBUFFER_COMPLETE
        : gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    },
    enable: (key) => enabled.add(key),
    disable: (key) => enabled.delete(key),
    isEnabled: (key) => enabled.has(key),
    getParameter(key) {
      if (key === gl.CURRENT_PROGRAM) return state.program;
      if (key === gl.VERTEX_ARRAY_BINDING) return state.vertexArray;
      if (key === gl.ARRAY_BUFFER_BINDING) return state.arrayBuffer;
      if (key === gl.ELEMENT_ARRAY_BUFFER_BINDING) return currentVAO().element;
      if (key === gl.DRAW_FRAMEBUFFER_BINDING || key === gl.FRAMEBUFFER_BINDING)
        return state.drawFramebuffer;
      if (key === gl.READ_FRAMEBUFFER_BINDING) return state.readFramebuffer;
      if (key === gl.RENDERBUFFER_BINDING) return state.renderbuffer;
      if (key === gl.ACTIVE_TEXTURE) return gl.TEXTURE0 + state.activeUnit;
      if (key === gl.TEXTURE_BINDING_2D) return state.textures[state.activeUnit];
      if (key === gl.SAMPLER_BINDING) return state.samplers[state.activeUnit];
      if (parameters.has(key)) return clone(parameters.get(key));
      throw new Error('Unmodeled GL parameter ' + names.get(key));
    },
    blendEquationSeparate(rgb, alpha) {
      parameters.set(gl.BLEND_EQUATION_RGB, rgb);
      parameters.set(gl.BLEND_EQUATION_ALPHA, alpha);
    },
    blendEquation(value) {
      methods.blendEquationSeparate(value, value);
    },
    blendFuncSeparate(src, dst, srcAlpha, dstAlpha) {
      [gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA].forEach(
        (key, i) => parameters.set(key, [src, dst, srcAlpha, dstAlpha][i]),
      );
    },
    blendFunc(src, dst) {
      methods.blendFuncSeparate(src, dst, src, dst);
    },
    depthFunc: (value) => parameters.set(gl.DEPTH_FUNC, value),
    depthMask: (value) => parameters.set(gl.DEPTH_WRITEMASK, value),
    frontFace: (value) => parameters.set(gl.FRONT_FACE, value),
    cullFace: (value) => parameters.set(gl.CULL_FACE_MODE, value),
    polygonOffset(factor, units) {
      parameters.set(gl.POLYGON_OFFSET_FACTOR, factor);
      parameters.set(gl.POLYGON_OFFSET_UNITS, units);
    },
    stencilFuncSeparate(face, ...values) {
      faceValues(
        face,
        ['STENCIL_FUNC', 'STENCIL_REF', 'STENCIL_VALUE_MASK'],
        ['STENCIL_BACK_FUNC', 'STENCIL_BACK_REF', 'STENCIL_BACK_VALUE_MASK'],
        values,
      );
    },
    stencilFunc(...values) {
      methods.stencilFuncSeparate(gl.FRONT_AND_BACK, ...values);
    },
    stencilMaskSeparate(face, value) {
      faceValues(face, ['STENCIL_WRITEMASK'], ['STENCIL_BACK_WRITEMASK'], [value]);
    },
    stencilMask(value) {
      methods.stencilMaskSeparate(gl.FRONT_AND_BACK, value);
    },
    stencilOpSeparate(face, ...values) {
      faceValues(
        face,
        ['STENCIL_FAIL', 'STENCIL_PASS_DEPTH_FAIL', 'STENCIL_PASS_DEPTH_PASS'],
        ['STENCIL_BACK_FAIL', 'STENCIL_BACK_PASS_DEPTH_FAIL', 'STENCIL_BACK_PASS_DEPTH_PASS'],
        values,
      );
    },
    stencilOp(...values) {
      methods.stencilOpSeparate(gl.FRONT_AND_BACK, ...values);
    },
    viewport: (...v) => parameters.set(gl.VIEWPORT, Int32Array.from(v)),
    depthRange: (...v) => parameters.set(gl.DEPTH_RANGE, Float32Array.from(v)),
    scissor: (...v) => parameters.set(gl.SCISSOR_BOX, Int32Array.from(v)),
    blendColor: (...v) => parameters.set(gl.BLEND_COLOR, Float32Array.from(v)),
    colorMask: (...v) => parameters.set(gl.COLOR_WRITEMASK, v),
    pixelStorei: (key, value) => parameters.set(key, value),
    clearDepth: (value) => parameters.set(gl.DEPTH_CLEAR_VALUE, value),
    clearStencil: (value) => parameters.set(gl.STENCIL_CLEAR_VALUE, value),
    clearColor: (...v) => parameters.set(gl.COLOR_CLEAR_VALUE, Float32Array.from(v)),
    clear() {},
    drawElements() {},
    drawArrays() {},
    getError: () => 0,
  };
  const gl = new Proxy(
    {},
    {
      get(_object, key) {
        if (typeof key !== 'string') return undefined;
        if (key.toUpperCase() === key) {
          if (!constants.has(key)) constants.set(key, nextEnum++);
          names.set(constants.get(key), key);
          return constants.get(key);
        }
        if (
          key.startsWith('is') &&
          ['Program', 'Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'VertexArray'].includes(
            key.slice(2),
          )
        )
          return (value) => valid(value, key.slice(2));
        if (key.startsWith('delete'))
          return (value) => {
            calls.push([key, value]);
            if (value) value.deleted = true;
          };
        if (key.startsWith('uniform'))
          return (location, ...args) => {
            if (state.program !== location.program)
              throw new Error('Uniform written with a different bound program');
            const input = key === 'uniformMatrix4fv' ? args[1] : args[0],
              values = Array.isArray(input) || ArrayBuffer.isView(input) ? input : args;
            location.program.uniforms.get(location.name).value = uniformValue(
              location.type,
              values,
            );
            calls.push([key, location, ...args]);
          };
        if (!methods[key]) throw new Error('Unmodeled GL method ' + key);
        return (...args) => {
          calls.push([key, ...args]);
          return methods[key](...args);
        };
      },
    },
  );
  vaos.set(null, { element: null, attributes: Array.from({ length: 3 }, attrib) });
  for (const name of [
    'BLEND_EQUATION_RGB',
    'BLEND_EQUATION_ALPHA',
    'BLEND_SRC_RGB',
    'BLEND_DST_RGB',
    'BLEND_SRC_ALPHA',
    'BLEND_DST_ALPHA',
    'DEPTH_FUNC',
    'DEPTH_WRITEMASK',
    'FRONT_FACE',
    'CULL_FACE_MODE',
    'POLYGON_OFFSET_FACTOR',
    'POLYGON_OFFSET_UNITS',
    'STENCIL_FUNC',
    'STENCIL_REF',
    'STENCIL_VALUE_MASK',
    'STENCIL_BACK_FUNC',
    'STENCIL_BACK_REF',
    'STENCIL_BACK_VALUE_MASK',
    'STENCIL_FAIL',
    'STENCIL_PASS_DEPTH_FAIL',
    'STENCIL_PASS_DEPTH_PASS',
    'STENCIL_BACK_FAIL',
    'STENCIL_BACK_PASS_DEPTH_FAIL',
    'STENCIL_BACK_PASS_DEPTH_PASS',
    'STENCIL_WRITEMASK',
    'STENCIL_BACK_WRITEMASK',
    'UNPACK_ALIGNMENT',
    'UNPACK_ROW_LENGTH',
    'UNPACK_IMAGE_HEIGHT',
    'UNPACK_SKIP_PIXELS',
    'UNPACK_SKIP_ROWS',
    'UNPACK_SKIP_IMAGES',
    'UNPACK_FLIP_Y_WEBGL',
    'UNPACK_PREMULTIPLY_ALPHA_WEBGL',
    'UNPACK_COLORSPACE_CONVERSION_WEBGL',
  ])
    parameters.set(gl[name], 0);
  methods.blendEquation(gl.FUNC_ADD);
  methods.blendFunc(gl.ONE, gl.ZERO);
  methods.depthFunc(gl.LESS);
  methods.depthMask(true);
  methods.frontFace(gl.CCW);
  methods.cullFace(gl.BACK);
  methods.stencilFunc(gl.ALWAYS, 0, 0xffffffff);
  methods.stencilMask(0xffffffff);
  methods.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  methods.clearDepth(1);
  methods.clearStencil(0);
  methods.clearColor(0, 0, 0, 0);
  parameters.set(gl.UNPACK_ALIGNMENT, 4);
  parameters.set(gl.UNPACK_FLIP_Y_WEBGL, false);
  parameters.set(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  parameters.set(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  methods.viewport(0, 0, 8, 6);
  methods.depthRange(0, 1);
  methods.scissor(0, 0, 8, 6);
  methods.blendColor(0, 0, 0, 0);
  methods.colorMask(true, true, true, true);
  return { gl, calls, objects, state, parameters, vaos, enabled };
}
