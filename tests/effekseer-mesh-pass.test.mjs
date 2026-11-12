// SPDX-License-Identifier: MPL-2.0
// Actual mounted resources/CPU/geometry -> GL command recorder; no GPU pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { LogicalCRTThreads } from '../src/effekseer/crt-threads.mjs';
import { setup, I } from './fixtures/effekseer/gpu-seam.mjs';
import { official, setupMounted, managerFor } from './fixtures/effekseer/mounted.mjs';
import { EffekseerMeshPass } from './fixtures/effekseer/mesh-pass.mjs';
function passFor(s, mounted) {
  const pipelines = {
    vertexShader: { id: 'sharedNormalVS' },
    pixelShaderTexture: { id: 'sharedTexturedPS' },
    pixelShaderNoTexture: { id: 'sharedDiffusePS' },
    vertexDeclaration: { id: 'sharedNormalDeclaration' },
  };
  return new EffekseerMeshPass({
    stage: s.stage,
    resources: mounted.resources,
    device: s.view,
    getCamera: () => I,
    getProjection: () => I,
    getViewport: () => s.viewport,
    bindNormalPipeline({ device, frame }) {
      device.setBinding('texture0', frame);
      device.setBinding('vertexShader', pipelines.vertexShader);
      device.setBinding(
        'pixelShader',
        frame ? pipelines.pixelShaderTexture : pipelines.pixelShaderNoTexture,
      );
      device.setBinding('vertexDeclaration', pipelines.vertexDeclaration);
    },
  });
}
function observe(s) {
  const packets = [],
    submit = s.gpu.submitEffekseer;
  s.gpu.submitEffekseer = function (packet, srgb) {
    packets.push({
      vertices: Array.from({ length: packet.vertexCount * 10 }, (_, i) => packet.vertices[i]),
      indices: Array.from({ length: packet.indexCount }, (_, i) => packet.indices[i]),
      camera: Array.from(packet.camera),
      projection: Array.from(packet.projection),
      viewport: Array.from(packet.viewport),
      flushBefore: packet.flushBefore,
      flushAfter: packet.flushAfter,
      states: [...s.context.states],
      samplers: [...s.context.samplers],
    });
    return submit.call(this, packet, srgb);
  };
  return packets;
}
for (const name of [...official, 'authored'])
  test(
    name +
      ': mounted CPU and typed geometry feed the current shared StageRenderer without advancing time/RNG',
    async () => {
      const m = await setupMounted(),
        asset = await m.resources.load(name),
        manager = managerFor(m),
        s = setup(),
        pass = passFor(s, m),
        packets = observe(s);
      try {
        manager.play(asset.id, [0, 0, 0], 'forced');
        let instances = 0,
          drawnNodes = 0,
          unavailable = 0;
        for (let i = 0; i < 12; i++) {
          manager.update('frame');
          const random = m.threads.snapshot(),
            ages = [...manager.instances.values()].map((x) => [x.id, x.age]),
            savedStates = [...s.context.states],
            savedBindings = new Map(s.bindings);
          const result = pass.draw(manager, { hasCurrentEffect: true, depthStencilEnabled: true });
          instances += result.instances;
          drawnNodes += result.drawnNodes;
          unavailable += result.modelNodes + result.distortionNodes;
          assert.deepEqual(m.threads.snapshot(), random);
          assert.deepEqual(
            [...manager.instances.values()].map((x) => [x.id, x.age]),
            ages,
          );
          assert.deepEqual([...s.context.states], savedStates);
          assert.deepEqual(s.bindings, savedBindings);
        }
        assert.ok(instances > 0, 'nonempty actual CPU instances required');
        if (name === 'block_simple') assert.ok(unavailable > 0);
        else if (name === 'Simple_Distortion') assert.ok(unavailable > 0);
        else {
          assert.ok(drawnNodes > 0, 'normal geometry must reach indexed submission');
          assert.ok(
            packets.some((p) => p.vertices.some((x, i) => i % 10 === 7 && x > 0)),
            'nonzero uploaded alpha required',
          );
          assert.ok(packets.some((p) => p.indices.length > 0));
        }
        assert.equal(s.calls.filter((c) => c.method === 'readPixels').length, 0);
      } finally {
        pass.close();
        manager.close();
        m.resources.release(asset.id);
        m.resources.close();
      }
    },
  );
test('render-only with an unloaded current Effect suppresses GPU while retained old instances still update through their manager', async () => {
  const m = await setupMounted(),
    asset = await m.resources.load('authored'),
    manager = managerFor(m),
    s = setup(),
    pass = passFor(s, m);
  try {
    manager.play(asset.id, [0, 0, 0], 'frame');
    manager.update('frame');
    const before = m.threads.snapshot(),
      saved = manager.snapshot();
    assert.equal(
      pass.draw(manager, { hasCurrentEffect: false, depthStencilEnabled: true })
        .suppressedByCurrentEffect,
      true,
    );
    assert.deepEqual(m.threads.snapshot(), before);
    assert.deepEqual(manager.snapshot(), saved);
    assert.equal(s.calls.length, 0);
    manager.update('frame');
    assert.ok([...manager.instances.values()].some((x) => x.age > 0));
  } finally {
    pass.close();
    manager.close();
    m.resources.release(asset.id);
    m.resources.close();
  }
});
test('fresh full-current CPU restore produces the same nonempty typed submissions and subsequent update sequence', async () => {
  const first = await setupMounted(),
    asset = await first.resources.load('authored'),
    a = managerFor(first),
    left = setup(),
    leftPass = passFor(left, first),
    leftPackets = observe(left);
  let second, b, rightPass;
  try {
    a.play(asset.id, [-0, 1, 2], 'forced');
    a.play(asset.id, [3, 4, 5], 'frame');
    for (let i = 0; i < 3; i++) {
      a.update('frame');
      leftPass.draw(a, { hasCurrentEffect: true, depthStencilEnabled: true });
    }
    const saved = await deserializeCheckpoint(
      await serializeCheckpoint({
        resources: first.resources.snapshot(),
        threads: first.threads.snapshot(),
        manager: a.snapshot(),
      }),
    );
    second = await setupMounted();
    await second.resources.restore(saved.resources);
    second.threads = new LogicalCRTThreads();
    second.threads.restore(saved.threads);
    b = managerFor(second);
    b.restore(saved.manager);
    const right = setup(),
      rightPackets = observe(right);
    rightPass = passFor(right, second);
    assert.deepEqual(second.threads.snapshot(), first.threads.snapshot());
    assert.deepEqual(b.snapshot(), a.snapshot());
    for (let i = 0; i < 6; i++) {
      leftPackets.length = 0;
      rightPackets.length = 0;
      leftPass.draw(a, { hasCurrentEffect: true, depthStencilEnabled: true });
      rightPass.draw(b, { hasCurrentEffect: true, depthStencilEnabled: true });
      assert.deepEqual(rightPackets, leftPackets);
      assert.ok(rightPackets.length);
      assert.deepEqual(second.threads.snapshot(), first.threads.snapshot());
      a.update('frame');
      b.update('frame');
      assert.deepEqual(b.snapshot(), a.snapshot());
    }
  } finally {
    rightPass?.close();
    b?.close();
    second?.resources.close();
    leftPass.close();
    a.close();
    first.resources.release(asset.id);
    first.resources.close();
  }
});
test('mesh pass requires the real camera/projection/viewport/pipeline operations and never creates a fallback owner', () => {
  const s = setup();
  const pass = passFor(s, { resources: { get: () => ({ textures: { color: [] } }) } });
  assert.equal(pass.frameFor({ assetID: 1 }, { renderer: { textureIndex: -7 } }), null);
  assert.throws(
    () => pass.frameFor({ assetID: 1 }, { renderer: { textureIndex: 0 } }),
    /dependency table/,
  );
  pass.close();
  assert.throws(
    () => new EffekseerMeshPass({ stage: s.stage, resources: { get() {} }, device: s.view }),
    /bindNormalPipeline/,
  );
});
test('public four-type coverage is represented in actual mounted node data', async () => {
  const m = await setupMounted(),
    kinds = new Set(),
    assets = [];
  try {
    for (const name of official) {
      const asset = await m.resources.load(name);
      assets.push(asset);
      for (const node of asset.effect.nodes)
        if (node.type !== 'root' && node.type !== 'none') kinds.add(node.type);
    }
    for (const kind of ['sprite', 'ribbon', 'ring', 'track']) assert.ok(kinds.has(kind));
  } finally {
    for (const asset of assets) m.resources.release(asset.id);
    m.resources.close();
  }
});
