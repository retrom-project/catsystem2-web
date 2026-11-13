// SPDX-License-Identifier: MPL-2.0
// Actual ParticlesGL/GraphicsDevice classes against an explicit WebGL API
// recorder. No compiler, actual GL context, pixels or Task submission is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticlesGL, createD3DContext } from '../src/render/particles-gl.mjs';
import { glBindingRecorder } from './fixtures/gl-binding-recorder.mjs';
import { packet, triangle } from './fixtures/effekseer/gpu-seam.mjs';

async function withGPU(operation, configure = () => {}) {
  const original = globalThis.OffscreenCanvas,
    r = glBindingRecorder();
  let canvases = 0,
    gpu;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      canvases++;
    }
    getContext(name) {
      assert.equal(name, 'webgl2');
      return r.gl;
    }
    addEventListener() {}
    removeEventListener() {}
  };
  try {
    configure(r);
    gpu = new ParticlesGL(8, 6);
    return await operation({ ...r, gpu, canvasCount: () => canvases });
  } finally {
    gpu?.close();
    if (original === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = original;
  }
}
const copy = (value) => (Array.isArray(value) || ArrayBuffer.isView(value) ? value.slice() : value);
const observedUniforms = (program) =>
  [...program.uniforms].map(([name, u]) => [name, copy(u.value)]);
const vaoData = (r, vao) => {
  const value = r.vaos.get(vao);
  return { element: value.element, attributes: value.attributes.map((a) => ({ ...a })) };
};
function externalProgram(gl) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, 'uniform vec2 outside;'],
    [gl.FRAGMENT_SHADER, 'uniform bool outsideEnabled;'],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return program;
}
function draw(gpu) {
  const context = createD3DContext({ depthStencilEnabled: true });
  gpu.gl.activeTexture(gpu.gl.TEXTURE0);
  gpu.gl.bindSampler(0, null);
  gpu.drawGeometry(null, null, {
    state: context,
    context,
    effekseer: packet(1, [0, 0, 8, 6, 0, 1]),
  });
}
function inheritedBindings(r, vertexArray) {
  const { gl } = r,
    p = externalProgram(gl),
    array = gl.createBuffer(),
    element = gl.createBuffer();
  gl.useProgram(p);
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, array);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, element);
  gl.vertexAttrib4fv(0, [2, 3, 4, 5]);
  for (let unit = 0; unit < 4; unit++) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.bindSampler(unit, gl.createSampler());
  }
  gl.activeTexture(gl.TEXTURE0 + 5);
  gl.viewport(1, 2, 5, 3);
  gl.depthRange(0.25, 0.75);
  gl.scissor(2, 1, 4, 2);
  gl.blendEquationSeparate(gl.FUNC_SUBTRACT, gl.FUNC_REVERSE_SUBTRACT);
  gl.blendFuncSeparate(gl.DST_ALPHA, gl.SRC_ALPHA, gl.ONE, gl.ZERO);
  gl.depthFunc(gl.GREATER);
  gl.depthMask(false);
  gl.frontFace(gl.CW);
  gl.cullFace(gl.FRONT);
  gl.polygonOffset(2, 3);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.enable(gl.CULL_FACE);
  gl.stencilFuncSeparate(gl.FRONT, gl.NOTEQUAL, 3, 0x7f);
  gl.stencilFuncSeparate(gl.BACK, gl.LESS, 9, 0xf0);
  gl.stencilMaskSeparate(gl.FRONT, 0x17);
  gl.stencilMaskSeparate(gl.BACK, 0xe1);
  gl.stencilOpSeparate(gl.FRONT, gl.INCR, gl.REPLACE, gl.KEEP);
  gl.stencilOpSeparate(gl.BACK, gl.DECR, gl.INVERT, gl.ZERO);
  gl.clearDepth(0.5);
  gl.clearStencil(7);
  gl.clearColor(0.25, 0.5, 0.75, 1);
  return { p, array, element };
}

test('the one backend owns one VAO and its fixed layout, validates it and frees it once', async () => {
  await withGPU(async (r) => {
    const { gpu, gl } = r;
    assert.equal(r.canvasCount(), 1);
    assert.equal(gpu.graphicsDevice.attachment, 'webgl');
    assert.equal(gpu.graphicsDevice.ready, true);
    assert.equal(gpu.resourcesReady(), true);
    assert.equal(gl.isVertexArray(gpu.vertexArray), true);
    assert.equal(r.vaos.get(gpu.vertexArray).element, gpu.effekseerIndexBuffer);
    assert.deepEqual(
      r.vaos
        .get(gpu.vertexArray)
        .attributes.map((a) => [
          a.buffer,
          a.enabled,
          a.size,
          a.type,
          a.normalized,
          a.stride,
          a.offset,
          a.divisor,
        ]),
      [
        [gpu.buffer, true, 4, gl.FLOAT, false, 40, 0, 0],
        [gpu.buffer, true, 4, gl.FLOAT, false, 40, 16, 0],
        [gpu.buffer, true, 2, gl.FLOAT, false, 40, 32, 0],
      ],
    );
    assert.ok(r.vaos.get(null).attributes.every((a) => a.buffer === null && !a.enabled));
    const vao = gpu.vertexArray,
      token = gpu.createBindingCapture();
    assert.throws(() => gpu.captureBindings(token), /open renderer frame/);
    vao.deleted = true;
    assert.equal(gpu.resourcesReady(), false, 'VAO participates in real lifecycle validation');
    vao.deleted = false;
    gpu.close();
    gpu.close();
    assert.equal(
      r.calls.filter(([name, value]) => name === 'deleteVertexArray' && value === vao).length,
      1,
    );
    assert.equal(gpu.graphicsDevice.status, 'detached');
  });
});

test('default VAO null attributes and real global/program bindings survive typed submission and depth clear', async () => {
  await withGPU(async (r) => {
    const { gpu, gl } = r;
    gpu.beginFrame();
    const target = gpu.target,
      depth = target.depthStencil;
    const external = inheritedBindings(r, null),
      before = vaoData(r, null),
      parameters = new Map([...r.parameters].map(([k, v]) => [k, copy(v)])),
      uniforms = observedUniforms(gpu.program),
      generic = r.state.generic.map((v) => [...v]),
      enabled = new Set(r.enabled),
      textures = [...r.state.textures],
      samplers = [...r.state.samplers],
      drawFBO = r.state.drawFramebuffer,
      readFBO = r.state.readFramebuffer,
      renderbuffer = r.state.renderbuffer,
      capture = gpu.createBindingCapture(),
      arrays = [capture.textures, capture.samplers, capture.uniforms, capture.operations];
    assert.equal(gpu.captureBindings(capture), capture);
    assert.equal(r.state.activeUnit, 5, 'capture restores its temporary texture enumeration');
    draw(gpu);
    gpu.clear({ flags: 2, depth: 0x3f800000 });
    assert.ok(r.calls.some(([name, , count]) => name === 'drawElements' && count === 6));
    assert.equal(r.state.vertexArray, gpu.vertexArray);
    assert.deepEqual(
      vaoData(r, null),
      before,
      'external null pointers and ELEMENT record were never written',
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gl.createFramebuffer());
    gl.viewport(0, 0, 1, 1);
    gl.depthRange(0, 1);
    gl.scissor(0, 0, 1, 1);
    assert.equal(gpu.restoreBindings(capture), true);
    assert.equal(capture.active, false);
    assert.equal(capture.program, null);
    assert.equal(capture.device, null);
    assert.ok(capture.textures.every((value) => value === null));
    assert.ok(capture.samplers.every((value) => value === null));
    assert.equal(r.state.program, external.p);
    assert.equal(r.state.vertexArray, null);
    assert.equal(r.state.arrayBuffer, external.array);
    assert.equal(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING), external.element);
    assert.deepEqual(vaoData(r, null), before);
    assert.deepEqual(r.state.generic, generic);
    assert.deepEqual(r.parameters, parameters);
    assert.deepEqual(r.enabled, enabled);
    assert.deepEqual(r.state.textures, textures);
    assert.deepEqual(r.state.samplers, samplers);
    assert.equal(r.state.activeUnit, 5);
    assert.equal(r.state.drawFramebuffer, drawFBO);
    assert.equal(r.state.readFramebuffer, readFBO);
    assert.equal(r.state.renderbuffer, renderbuffer);
    assert.deepEqual(observedUniforms(gpu.program), uniforms);
    assert.equal(gpu.target, target);
    assert.equal(gpu.target.depthStencil, depth);
    gpu.captureBindings(capture);
    draw(gpu);
    gpu.restoreBindings(capture);
    arrays.forEach((array, i) =>
      assert.equal(
        array,
        [capture.textures, capture.samplers, capture.uniforms, capture.operations][i],
      ),
    );
    assert.equal(r.canvasCount(), 1);
  });
});

test('a nondefault integer/instanced external VAO and its ELEMENT buffer stay untouched', async () => {
  await withGPU(async (r) => {
    const { gpu, gl } = r;
    gpu.beginFrame();
    const externalVAO = gl.createVertexArray();
    inheritedBindings(r, externalVAO);
    gl.vertexAttribIPointer(0, 3, gl.INT, 12, 4);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribDivisor(0, 7);
    const before = vaoData(r, externalVAO),
      capture = gpu.createBindingCapture();
    gpu.captureBindings(capture);
    draw(gpu);
    assert.deepEqual(vaoData(r, externalVAO), before);
    gpu.restoreBindings(capture);
    assert.equal(r.state.vertexArray, externalVAO);
    assert.deepEqual(vaoData(r, externalVAO), before);
    const calls = r.calls.length;
    assert.throws(() => gpu.restoreBindings(capture), /owner or pass state/);
    assert.equal(r.calls.length, calls, 'an already-consumed capture issues no GL call');
    // The next ordinary path must select the same backend layout as EFK.
    gpu.drawGeometry(triangle, { width: 1, height: 1, rgba: new Uint8Array(4).fill(255) });
    assert.equal(r.state.vertexArray, gpu.vertexArray);
    assert.deepEqual(vaoData(r, externalVAO), before);
  });
});

test('lost, rebuilt and closed generations never rebind captured handles', async () => {
  await withGPU(async (r) => {
    const { gpu, gl } = r;
    gpu.beginFrame();
    const oldVAO = gpu.vertexArray,
      device = gpu.graphicsDevice,
      generation = device.generation,
      first = gpu.createBindingCapture(),
      second = gpu.createBindingCapture();
    gpu.captureBindings(first);
    gpu.captureBindings(second);
    r.state.lost = true;
    const writes = () =>
      r.calls.filter(([name]) => !name.startsWith('get') && name !== 'isContextLost').length;
    r.calls.length = 0;
    assert.equal(gpu.restoreBindings(first), false);
    assert.equal(writes(), 0);
    assert.equal(device.status, 'lost');
    for (const object of r.objects) object.deleted = true;
    r.state.lost = false;
    gpu.devicePort.restored();
    await gpu.devicePort.rebuild();
    assert.equal(gpu.graphicsDevice, device);
    assert.equal(device.generation, generation + 1);
    assert.notEqual(gpu.vertexArray, oldVAO);
    assert.equal(gl.isVertexArray(gpu.vertexArray), true);
    assert.equal(r.canvasCount(), 1, 'rebuild uses the same context and canvas');
    r.calls.length = 0;
    assert.equal(gpu.restoreBindings(second), false);
    assert.equal(writes(), 0);
    gpu.beginFrame();
    const last = gpu.createBindingCapture(),
      validPrevious = gpu.vertexArray;
    gpu.captureBindings(last);
    gpu.devicePort.restored();
    await gpu.devicePort.rebuild();
    assert.equal(
      validPrevious.deleted,
      true,
      'a successful rebuild retires a still-valid old layout',
    );
    assert.equal(
      r.calls.filter(([name, value]) => name === 'deleteVertexArray' && value === validPrevious)
        .length,
      1,
    );
    assert.equal(gpu.restoreBindings(last), false);
    gpu.beginFrame();
    const closing = gpu.createBindingCapture();
    gpu.captureBindings(closing);
    gpu.close();
    r.calls.length = 0;
    assert.equal(gpu.restoreBindings(closing), false);
    assert.equal(r.calls.length, 0);
  });
});

test('wrong ownership, overlapping capture and restore failure are explicit; failure cannot report restoration', async () => {
  await withGPU(async (r) => {
    const { gpu } = r;
    gpu.beginFrame();
    const capture = gpu.createBindingCapture();
    gpu.captureBindings(capture);
    assert.throws(() => gpu.captureBindings(capture), /owner or pass state/);
    assert.throws(() => gpu.restoreBindings({ ...capture, owner: {} }), /owner or pass state/);
    assert.equal(capture.active, true);
    r.state.failRestore = true;
    assert.throws(() => gpu.restoreBindings(capture), /retained framebuffer restore failure/);
    assert.equal(capture.active, false);
    assert.equal(capture.program, null);
    assert.ok(capture.textures.every((value) => value === null));
    assert.throws(() => gpu.restoreBindings(capture), /owner or pass state/);
  });
});

test('failed VAO allocation reports failure before default-VAO mutation and releases its new program', async () => {
  let boundary;
  await assert.rejects(
    withGPU(
      () => assert.fail('constructor must fail'),
      (r) => {
        boundary = r;
        r.state.failVAO = true;
      },
    ),
    /vertex layout allocation failed/,
  );
  assert.ok(boundary.vaos.get(null).attributes.every((a) => a.buffer === null && !a.enabled));
  assert.equal([...boundary.objects].filter((o) => o.kind === 'Program' && !o.deleted).length, 0);
  assert.equal(boundary.calls.filter(([name]) => name === 'createBuffer').length, 0);
});

test('captured owner VAO restores its inherited ELEMENT buffer after actual typed upload', async () => {
  await withGPU(async (r) => {
    const { gpu, gl } = r;
    gpu.beginFrame();
    const inheritedElement = gl.createBuffer(),
      vao = gpu.vertexArray;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, inheritedElement);
    const attributes = vaoData(r, vao).attributes,
      capture = gpu.createBindingCapture();
    gpu.captureBindings(capture);
    draw(gpu);
    assert.equal(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING), gpu.effekseerIndexBuffer);
    assert.equal(gpu.restoreBindings(capture), true);
    assert.equal(r.state.vertexArray, vao);
    assert.equal(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING), inheritedElement);
    assert.deepEqual(vaoData(r, vao).attributes, attributes);
  });
});
