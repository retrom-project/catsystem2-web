// SPDX-License-Identifier: MPL-2.0
// Node GL command recorder only. No shader compiler, GPU raster or pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setup,
  packet,
  triangle,
  draw,
  snapshots,
  material,
} from './fixtures/effekseer/gpu-seam.mjs';
import { EffekseerSharedDeviceView } from '../src/effekseer/shared-device-view.mjs';
import { EFFEKSEER_RESTORED_STATES } from '../src/effekseer/materials.mjs';
test('StageRenderer uses the already-open shared GPU and requires explicit current state', () => {
  const s = setup();
  assert.throws(() => s.stage.drawEffekseer(packet(), null), /current shared/);
  s.gpu.drawing = false;
  assert.throws(() => draw(s), /open StageRenderer/);
  assert.equal(s.calls.length, 0);
});
test('normal typed draw shares the current surface and depth without attachments or extra canvas', () => {
  const s = setup(),
    target = s.gpu.target,
    depth = target.depthStencil,
    p = packet();
  s.scope.begin().applyNormalMaterial(material());
  draw(s, p);
  assert.equal(s.gpu.target, target);
  assert.equal(target.depthStencil, depth);
  const [d] = snapshots(s);
  assert.equal(d.framebuffer, target.framebuffer);
  assert.deepEqual(d.args, ['TRIANGLES', 6, 'UNSIGNED_SHORT', 0]);
  assert.ok(
    !s.calls.some((c) =>
      [
        'framebufferTexture2D',
        'framebufferRenderbuffer',
        'readPixels',
        'createFramebuffer',
        'createRenderbuffer',
      ].includes(c.method),
    ),
  );
  const uploads = s.calls.filter((c) => c.method === 'bufferData');
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].args[1], p.vertices);
  assert.equal(uploads[0].args[4], 40);
  assert.equal(uploads[1].args[1], p.indices);
  assert.equal(uploads[1].args[4], 6);
  s.scope.end();
});
test('ordinary to EFK to ordinary retains all twelve original saved states and device cache', () => {
  const s = setup();
  s.gpu.drawGeometry(triangle, { id: 'ordinaryBefore' }, { context: s.context });
  s.context.states.set(7, 2);
  s.context.states.set(23, 5);
  s.context.states.set(25, 5);
  s.context.states.set(174, 1);
  s.context.states.set(52, 1);
  const saved = new Map(s.context.states),
    bindings = new Map(s.bindings),
    last = [s.context.lastDrawType, s.context.lastBlend];
  const fields = EFFEKSEER_RESTORED_STATES.map((n) => [n, s.view.getState(n)]);
  s.scope.begin().clearCurrentDepth(true);
  s.scope.applyNormalMaterial(material(0));
  draw(s);
  s.scope.end();
  assert.deepEqual(
    EFFEKSEER_RESTORED_STATES.map((n) => [n, s.view.getState(n)]),
    fields,
  );
  assert.deepEqual(s.bindings, bindings);
  assert.deepEqual([...s.context.states], [...saved]);
  assert.deepEqual([s.context.lastDrawType, s.context.lastBlend], last);
  s.gpu.drawGeometry(
    triangle,
    { id: 'ordinaryAfter' },
    { state: s.view.state, context: s.context },
  );
  const efk = snapshots(s)[0];
  assert.deepEqual(efk.uniforms.get('alphaFunction'), [5]);
  assert.deepEqual(efk.uniforms.get('alphaReference'), [
    new Float32Array(Uint32Array.of(0x3efefeff).buffer)[0],
  ]);
  assert.ok(efk.enabled.has('DEPTH_TEST'));
  assert.ok(efk.enabled.has('STENCIL_TEST'));
  assert.ok(efk.enabled.has('SCISSOR_TEST'));
  assert.deepEqual(
    s.calls.filter((c) => c.method === 'depthFunc').map((c) => c.args),
    [['LEQUAL'], ['GREATER'], ['GREATER']],
  );
  assert.deepEqual(s.uniforms.get('effekseerPass'), [0]);
  assert.equal(s.context.states.get(7), 2);
});
test('AlphaFunc, ZFunc and sampler inheritance are explicit rather than reset to a new material', () => {
  const s = setup();
  s.context.states.set(25, 2);
  s.context.states.set(23, 6);
  s.context.samplers.set(11, 1);
  s.context.samplers.set(4, 0x10203040);
  s.scope.begin().applyNormalMaterial(material(3, 1, 0));
  draw(s);
  s.scope.end();
  const [d] = snapshots(s);
  assert.deepEqual(d.uniforms.get('alphaFunction'), [2]);
  assert.deepEqual(d.uniforms.get('filters'), [2, 2]);
  assert.deepEqual(d.uniforms.get('addressMode'), [1, 1]);
  assert.deepEqual(d.uniforms.get('srgbTexture'), [1]);
  assert.equal(s.context.samplers.get(11), 1);
  assert.equal(s.context.samplers.get(4), 0x10203040);
  assert.equal(s.context.states.get(25), 2);
  assert.equal(s.context.states.get(23), 6);
  assert.equal(s.samplerStages.get(0), s.context.samplers);
  for (let stage = 1; stage < 4; stage++)
    assert.deepEqual(
      [...s.samplerStages.get(stage)],
      [
        [6, 1],
        [5, 1],
        [7, 0],
        [1, 3],
        [2, 3],
      ],
    );
  assert.deepEqual(
    [1, 2, 5, 6, 7].map((id) => s.context.samplers.get(id)),
    [1, 1, 2, 2, 2],
  );
});
test('depth prelude clears only current viewport depth and never color or stencil', () => {
  const s = setup(),
    target = s.gpu.target;
  s.scope.begin().clearCurrentDepth(true);
  s.scope.end();
  assert.deepEqual(
    s.calls.filter((c) => c.method === 'clear').map((c) => c.args),
    [[0x0100]],
  );
  assert.deepEqual(s.calls.find((c) => c.method === 'scissor').args, [3, 4, 24, 16]);
  assert.equal(s.calls.find((c) => c.method === 'bindFramebuffer').args[1], target.framebuffer);
  assert.equal(s.gpu.target, target);
  assert.equal(snapshots(s).length, 0);
});
test('empty manager with current effect still enters scope and depth prelude', () => {
  const s = setup(),
    states = [...s.context.states];
  s.scope.begin();
  s.scope.clearCurrentDepth(true);
  s.scope.end();
  assert.deepEqual([...s.context.states], states);
  assert.equal(s.calls.filter((c) => c.method === 'clear').length, 1);
  assert.equal(snapshots(s).length, 0);
  assert.equal(s.context.samplers.get(1), 3);
  assert.equal(s.samplerStages.size, 4);
});
test('disabled depth prelude emits no clear and does not touch the target', () => {
  const s = setup();
  s.scope.begin().clearCurrentDepth(false);
  s.scope.end();
  assert.equal(s.calls.length, 0);
});
test('typed path bypasses fixed-function texture-stage operations and preserves them for ordinary drawing', () => {
  const s = setup();
  s.context.stages.set(
    0,
    new Map([
      [1, 17],
      [2, 14],
    ]),
  );
  s.context.stages.set(
    2,
    new Map([
      [1, 4],
      [2, 2],
    ]),
  );
  const stages = structuredClone([...s.context.stages]);
  s.scope.begin();
  draw(s);
  s.scope.end();
  assert.equal(snapshots(s).length, 1);
  assert.deepEqual([...s.context.stages], stages);
  assert.throws(
    () => s.gpu.drawGeometry(triangle, { id: 'ordinary' }, { state: s.view.state }),
    /dependent texture sampling/,
  );
});
test('current viewport and depth range apply for EFK and prior GPU values restore after it', () => {
  const s = setup();
  s.state.viewport = [1, 2, 50, 40];
  s.state.depthRange = [0.1, 0.9];
  s.scope.begin();
  draw(s);
  s.scope.end();
  const [d] = snapshots(s);
  assert.deepEqual(d.viewport, [3, 4, 24, 16]);
  assert.deepEqual(d.depthRange, [0.25, 0.75]);
  assert.deepEqual(s.state.viewport, [1, 2, 50, 40]);
  assert.deepEqual(s.state.depthRange, [0.1, 0.9]);
});
test('draw failure restores viewport/depth and the original scope still restores all saved fields', () => {
  const s = setup(),
    states = [...s.context.states],
    bindings = new Map(s.bindings);
  s.state.failDraw = true;
  s.scope.begin();
  try {
    assert.throws(() => draw(s), /retained draw failure/);
  } finally {
    s.scope.end();
  }
  assert.deepEqual([...s.context.states], states);
  assert.deepEqual(s.bindings, bindings);
  assert.deepEqual(s.state.viewport, [0, 0, 64, 48]);
  assert.deepEqual(s.state.depthRange, [0, 1]);
});
test('sRGB target path keeps original indexed triangle order using GPU-local destination copies', () => {
  const s = setup();
  s.context.states.set(194, 1);
  s.scope.begin();
  draw(s);
  s.scope.end();
  assert.deepEqual(
    snapshots(s).map((c) => c.args),
    [
      ['TRIANGLES', 3, 'UNSIGNED_SHORT', 0],
      ['TRIANGLES', 3, 'UNSIGNED_SHORT', 6],
    ],
  );
  assert.equal(s.calls.filter((c) => c.method === 'copyTexImage2D').length, 2);
  assert.equal(s.calls.filter((c) => c.method === 'readPixels').length, 0);
  assert.equal(s.calls.filter((c) => c.method === 'bufferData').length, 2);
});
test('untextured normal path explicitly selects diffuse shader and reuses its white binding', () => {
  const s = setup();
  s.scope.begin();
  draw(s, packet(), null);
  const first = s.calls.find((c) => c.method === 'textureLookup').args[0];
  draw(s, packet(), null);
  s.scope.end();
  assert.deepEqual(
    snapshots(s).map((c) => c.uniforms.get('effekseerTextured')),
    [[0], [0]],
  );
  assert.equal(s.calls.filter((c) => c.method === 'textureLookup')[1].args[0], first);
});
test('fog or non-solid inherited branches fail before GL writes and retain actual state', () => {
  for (const [id, value] of [
    [28, 1],
    [8, 1],
    [8, 2],
  ]) {
    const s = setup();
    s.context.states.set(id, value);
    s.scope.begin();
    assert.throws(() => draw(s), /Unverified inherited/);
    assert.equal(s.context.states.get(id), value);
    assert.equal(s.calls.length, 0);
    s.scope.end();
  }
});
test('malformed typed range and missing shared state fail before any GL command', () => {
  const s = setup();
  s.scope.begin();
  const p = packet();
  p.indices[0] = 0;
  assert.throws(() => draw(s, p), /quad order/);
  assert.equal(s.calls.length, 0);
  const state = { ...s.view.state, states: new Map(s.context.states) };
  state.states.delete(25);
  assert.throws(() => s.stage.drawEffekseer(packet(), null, { state }), /state 25 is missing/);
  assert.equal(s.calls.length, 0);
  s.scope.end();
});
test('thirty warmed indexed submissions reuse typed storage without new typed arrays', () => {
  const s = setup(),
    p = packet(),
    Float = globalThis.Float32Array,
    Short = globalThis.Uint16Array;
  s.scope.begin();
  draw(s, p);
  globalThis.Float32Array = new Proxy(Float, {
    construct() {
      throw new Error('new float buffer');
    },
  });
  globalThis.Uint16Array = new Proxy(Short, {
    construct() {
      throw new Error('new index buffer');
    },
  });
  try {
    for (let i = 0; i < 30; i++) draw(s, p);
  } finally {
    globalThis.Float32Array = Float;
    globalThis.Uint16Array = Short;
    s.scope.end();
  }
  assert.equal(snapshots(s).length, 31);
  assert.ok(
    s.calls
      .filter((c) => c.method === 'bufferData')
      .every((c) => c.args[1] === p.vertices || c.args[1] === p.indices),
  );
});
test('shared view requires current owners and preserves raw D3DZB_USEW during restore', () => {
  const s = setup();
  assert.equal(s.view.state.states, s.context.states);
  assert.equal(s.view.state.samplers, s.context.samplers);
  s.context.states.set(7, 2);
  s.scope.begin();
  assert.equal(s.context.states.get(7), 0);
  s.scope.end();
  assert.equal(s.context.states.get(7), 2);
  assert.throws(() => new EffekseerSharedDeviceView({ context: s.context }), /bindings/);
  assert.throws(() => s.view.setState('unknown', 0), /Unknown/);
  assert.throws(() => s.view.setSampler(4, 'minFilter', 'point'), /original four/);
});
