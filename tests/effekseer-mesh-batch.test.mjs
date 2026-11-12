// SPDX-License-Identifier: MPL-2.0
// Real current-state CPU/byte batch to shared StageRenderer GL recorder only.
// This file does not observe actual GPU raster/pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EffekseerResources } from '../src/effekseer/resources.mjs';
import { EffekseerEffectLoads } from '../src/effekseer/effect-loads.mjs';
import { EffekseerManagerLifecycle } from '../src/effekseer/manager-lifecycle.mjs';
import { createEffekseerInstanceOperations } from '../src/effekseer/instance-operations.mjs';
import { LogicalCRTThreads } from '../src/effekseer/crt-threads.mjs';
import { EffekseerMeshBatch } from '../src/effekseer/mesh-batch.mjs';
import { EffekseerStandardBatch } from '../src/effekseer/standard-batch.mjs';
import { EffekseerPackedMesh } from '../src/effekseer/mesh-packet.mjs';
import { PNG } from '../src/formats/png.mjs';
import { setup as setupDevice } from './fixtures/effekseer/gpu-seam.mjs';
import { batchEffect, I } from './fixtures/effekseer/batch-authored.mjs';
const image = await readFile(new URL('./fixtures/effekseer/authored-spark.png', import.meta.url));
const drawFlags = { hasCurrentEffect: true, depthStencilEnabled: true };
const bits = (v) => Array.from(new Uint32Array(Float32Array.from(v).buffer));
async function setup({ nodes = [{}], colorPaths = [], files = null, saved = null } = {}) {
  const data = files ?? new Map([['effect', batchEffect({ nodes, colorPaths })]]),
    resources = new EffekseerResources({
      resolveCategory: (n, c) => c + '/' + n,
      roundTripCP932: (n) => n,
      readNative: async (n) =>
        n.startsWith('efk/')
          ? (data.get(n.slice(4)) ?? null)
          : n === 'efktex/spark.png'
            ? image
            : null,
      identify: (b) => createHash('sha256').update(b).digest('hex'),
      decodeTexture: async (b) => {
        const png = new PNG(b);
        return { width: png.width, height: png.height, rgba: await png.decode() };
      },
    }),
    loads = new EffekseerEffectLoads({ resources }),
    threads = new LogicalCRTThreads();
  if (saved) {
    await resources.restore(saved.resources);
    loads.restore(saved.loads);
    threads.restore(saved.threads);
  } else threads.create('authored.caller');
  const manager = new EffekseerManagerLifecycle({
      resources: loads,
      threads,
      instanceOperations: createEffekseerInstanceOperations(),
    }),
    device = setupDevice(),
    packets = [],
    submit = device.stage.drawEffekseer;
  device.stage.drawEffekseer = function (p, frame, options) {
    packets.push({
      vertices: bits(p.vertices.subarray(0, p.vertexCount * 10)),
      indices: Array.from(p.indices.subarray(0, p.indexCount)),
      camera: bits(p.camera),
      projection: bits(p.projection),
      viewport: Array.from(p.viewport),
      frame,
      token: device.bindings.get('texture0')?.id ?? null,
    });
    return submit.call(this, p, frame, options);
  };
  const makePass = () =>
      new EffekseerMeshBatch({
        stage: device.stage,
        loads,
        device: device.view,
        getCamera: () => I,
        getProjection: () => I,
        getViewport: () => device.viewport,
        bindNormalPipeline({ device, frame, textureToken }) {
          device.setBinding('vertexShader', 'EFKnormalVS');
          device.setBinding('pixelShader', frame ? 'EFKtexturePS' : 'EFKnoTexturePS');
          device.setBinding('vertexDeclaration', 'EFKnormalDecl');
          device.setBinding('texture0', textureToken);
        },
      }),
    pass = makePass();
  if (saved) {
    manager.restore(saved.manager);
    pass.restore(saved.pass);
  }
  return {
    data,
    resources,
    loads,
    threads,
    manager,
    device,
    pass,
    packets,
    makePass,
    async play(name = 'effect', position = [0, 0, 0.5]) {
      const load = await loads.load(name),
        handle = manager.play(load.id, position, 'authored.caller');
      loads.release(load.id);
      return { load, handle };
    },
    tick(n = 2) {
      for (let i = 0; i < n; i++) manager.update('authored.caller');
    },
    snapshot() {
      return structuredClone({
        resources: resources.snapshot(),
        loads: loads.snapshot(),
        threads: threads.snapshot(),
        manager: manager.snapshot(),
        pass: pass.snapshot(),
      });
    },
    close() {
      pass.close();
      manager.close();
      loads.close();
      resources.close();
      threads.close();
    },
  };
}
function devicePrior(s) {
  return { states: [...s.device.context.states], bindings: new Map(s.device.bindings) };
}
function deviceSame(s, p) {
  assert.deepEqual([...s.device.context.states], p.states);
  assert.deepEqual(s.device.bindings, p.bindings);
}
test('two real manager nodes coalesce into one byte/GPU-recorder submission', async () => {
  const s = await setup({ nodes: [{ position: [-0.25, 0, 0] }, { position: [0.25, 0, 0] }] });
  try {
    await s.play();
    s.tick();
    const random = s.threads.snapshot(),
      prior = devicePrior(s),
      ages = [...s.manager.instances.values()].map((i) => [i.id, i.age]),
      r = { ...s.pass.draw(s.manager, drawFlags) };
    assert.equal(r.instances, 2);
    assert.equal(r.drawCalls, 1);
    assert.equal(r.vertexCount, 8);
    assert.equal(r.indexCount, 12);
    assert.equal(s.packets.length, 1);
    assert.equal(s.pass.batch.state.culling, 2);
    assert.deepEqual(s.packets[0].indices, [3, 1, 0, 3, 0, 2, 7, 5, 4, 7, 4, 6]);
    assert.deepEqual(s.threads.snapshot(), random);
    assert.deepEqual(
      [...s.manager.instances.values()].map((i) => [i.id, i.age]),
      ages,
    );
    deviceSame(s, prior);
  } finally {
    s.close();
  }
});
test('distinct FILE tokens force two submissions even with one shared decoded texture', async () => {
  const s = await setup({ nodes: [{ textureIndex: 0 }], colorPaths: ['spark.png'] });
  try {
    const a = await s.play(),
      b = await s.play();
    s.tick();
    assert.equal(a.load.textures.color[0].frame, b.load.textures.color[0].frame);
    assert.notEqual(a.load.textures.color[0].token, b.load.textures.color[0].token);
    const r = s.pass.draw(s.manager, drawFlags);
    assert.equal(r.drawCalls, 2);
    assert.deepEqual(
      s.packets.map((p) => p.token),
      [1, 2],
    );
    assert.equal(s.packets[0].frame, s.packets[1].frame);
  } finally {
    s.close();
  }
});
test('positive single Ring executes reset/deferred full-matrix/flush before a later normal node', async () => {
  const s = await setup({
    nodes: [
      { position: [-0.25, 0, 0] },
      { kind: 'ring', position: [0.25, 0, 0] },
      { position: [0.5, 0, 0] },
    ],
  });
  try {
    await s.play();
    s.tick();
    const r = s.pass.draw(s.manager, drawFlags);
    assert.equal(r.drawCalls, 3);
    assert.equal(s.packets.length, 3);
    assert.deepEqual(
      s.packets.map((p) => p.indices.length),
      [6, 96, 6],
    );
    assert.equal(s.pass.ring.matrix[12], 0.25);
    assert.equal(s.pass.ring.matrix[14], 0.5);
    assert.equal(new Float32Array(Uint32Array.from(s.packets[1].camera).buffer)[12], 0.25);
    assert.deepEqual(s.packets[0].camera, bits(I));
    assert.deepEqual(s.packets[2].camera, bits(I));
    assert.equal(s.pass.batch.byteLength, 0);
    assert.equal(s.pass.batch.active, false);
  } finally {
    s.close();
  }
});
test('count1 Ribbon and Track leave current batch material/reservation unchanged', async () => {
  for (const kind of ['ribbon', 'track']) {
    const s = await setup({ nodes: [{}, { kind, count: 1, blend: 2 }, {}] });
    try {
      await s.play();
      s.tick();
      const r = s.pass.draw(s.manager, drawFlags);
      assert.equal(r.instances, 3);
      assert.equal(r.drawCalls, 1);
      assert.equal(r.reservedVertices, 8);
      assert.equal(s.packets[0].indices.length, 12);
    } finally {
      s.close();
    }
  }
});
test('zero-submission single Ring protocol retains reserved zero tail and prior current matrix', async () => {
  const s = await setup({ nodes: [{}, { kind: 'ring', position: [0.25, 0, 0] }, {}] });
  try {
    await s.play();
    s.tick();
    s.pass.draw(s.manager, drawFlags);
    const matrix = s.pass.ring.snapshot();
    s.packets.length = 0;
    // Authored renderer-protocol suppression, not a claimed SKFE9/FES input.
    const suppressed = {
        instances: s.manager.instances,
        draw: (v) =>
          s.manager.draw({
            ...v,
            instance: (input) => {
              if (input.node.type !== 'ring') v.instance(input);
            },
          }),
      },
      r = s.pass.draw(suppressed, drawFlags);
    assert.equal(r.drawCalls, 2);
    assert.deepEqual(
      s.packets.map((p) => p.indices.length),
      [6, 102],
    );
    assert.deepEqual(s.pass.ring.snapshot(), matrix);
    const tail = s.packets[1].vertices;
    for (let i = 0; i < 64; i++)
      assert.deepEqual(tail.slice(i * 10, i * 10 + 8), bits([0, 0, 0, 1, 0, 0, 0, 0]));
  } finally {
    s.close();
  }
});
test('null-background single Ring still updates current matrix and color state without a draw', async () => {
  const s = await setup({ nodes: [{ kind: 'ring', distortion: true, position: [0.25, 0.5, 0] }] });
  try {
    await s.play();
    s.tick();
    const before = s.threads.snapshot(),
      r = s.pass.draw(s.manager, drawFlags);
    assert.equal(r.distortionNodes, 1);
    assert.equal(r.instances, 1);
    assert.equal(r.drawCalls, 0);
    assert.equal(s.pass.ring.matrix[12], 0.25);
    assert.equal(s.pass.ring.matrix[13], 0.5);
    assert.equal(s.pass.batch.cursor, 0);
    assert.equal(s.pass.batch.byteLength, 0);
    assert.deepEqual(s.threads.snapshot(), before);
  } finally {
    s.close();
  }
});
test('unloaded current-Effect gate does not start renderer/depth work or advance old live instances', async () => {
  const s = await setup();
  try {
    await s.play();
    s.tick();
    const before = s.manager.snapshot(),
      random = s.threads.snapshot(),
      prior = s.device.calls.length,
      r = s.pass.draw(s.manager, { ...drawFlags, hasCurrentEffect: false });
    assert.equal(r.suppressedByCurrentEffect, true);
    assert.equal(s.device.calls.length, prior);
    assert.deepEqual(s.manager.snapshot(), before);
    assert.deepEqual(s.threads.snapshot(), random);
    s.tick();
    assert.notDeepEqual(s.manager.snapshot(), before);
  } finally {
    s.close();
  }
});
test('fresh settled full-current restore reproduces nonempty batch order and later CPU/RNG sequence', async () => {
  const a = await setup({
    nodes: [{}, { kind: 'ring', position: [0.25, 0, 0] }, { kind: 'ribbon' }],
  });
  let b;
  try {
    await a.play();
    a.tick(4);
    a.pass.draw(a.manager, drawFlags);
    const saved = a.snapshot();
    b = await setup({ files: a.data, saved });
    assert.deepEqual(b.snapshot(), saved);
    for (let i = 0; i < 3; i++) {
      a.packets.length = 0;
      b.packets.length = 0;
      const random = a.threads.snapshot();
      a.pass.draw(a.manager, drawFlags);
      b.pass.draw(b.manager, drawFlags);
      assert.ok(a.packets.length);
      assert.deepEqual(b.packets, a.packets);
      assert.deepEqual(a.threads.snapshot(), random);
      assert.deepEqual(b.threads.snapshot(), random);
      assert.deepEqual(b.pass.snapshot(), a.pass.snapshot());
      a.tick();
      b.tick();
      assert.deepEqual(b.manager.snapshot(), a.manager.snapshot());
      assert.deepEqual(b.threads.snapshot(), a.threads.snapshot());
    }
  } finally {
    b?.close();
    a.close();
  }
});
test('abort discards only pending bytes, retaining previous draw/cursor and settled empty state', () => {
  const draws = [],
    batch = new EffekseerStandardBatch({
      prepare() {},
      draw: (p) => draws.push(p.indexCount),
      finish() {},
      camera: () => I,
      projection: () => I,
    }),
    state = {
      depthTest: true,
      depthWrite: false,
      distortion: false,
      distortionIntensity: 1,
      alphaBlend: 0,
      culling: 0,
      filter: 0,
      wrap: 1,
      texture: null,
    };
  batch.begin();
  batch.updateState(state);
  batch.reserve(4);
  batch.flush();
  const cursor = batch.cursor;
  batch.reserve(8);
  batch.abort();
  assert.deepEqual(draws, [6]);
  assert.equal(batch.cursor, cursor);
  assert.equal(batch.byteLength, 0);
  assert.deepEqual(batch.snapshot(), { ringCursor: cursor });
  assert.throws(() => batch.abort(), /active/);
});
test('fault after old flush never submits partial new cache and restores12states/5bindings', async () => {
  const s = await setup({ nodes: [{}, { blend: 2 }] });
  try {
    await s.play();
    s.tick();
    const prior = devicePrior(s),
      random = s.threads.snapshot(),
      injected = {
        instances: s.manager.instances,
        draw: (v) =>
          s.manager.draw({
            ...v,
            beginNode: (input) => {
              v.beginNode(input);
              if (input.node.id === 2) throw new Error('Authored node failure');
            },
          }),
      };
    assert.throws(() => s.pass.draw(injected, drawFlags), /Authored node failure/);
    assert.equal(s.packets.length, 1);
    assert.equal(s.pass.batch.cursor, 96);
    assert.equal(s.pass.batch.byteLength, 0);
    assert.equal(s.pass.batch.active, false);
    deviceSame(s, prior);
    assert.deepEqual(s.threads.snapshot(), random);
    assert.throws(() => s.pass.snapshot(), /faulted/);
    assert.throws(() => s.pass.draw(s.manager, drawFlags), /faulted/);
    // A failed cleanup remains visible; an earlier draw failure is retained too.
    for (const withPriorFailure of [false, true]) {
      const other = s.makePass(),
        end = other.scope.end.bind(other.scope);
      other.scope.end = () => {
        end();
        throw new Error('Authored cleanup failure');
      };
      try {
        assert.throws(
          () => other.draw(withPriorFailure ? injected : s.manager, drawFlags),
          (error) =>
            withPriorFailure
              ? error instanceof AggregateError &&
                error.errors[0].message === 'Authored node failure' &&
                error.errors[1].message === 'Authored cleanup failure'
              : error.message === 'Authored cleanup failure',
        );
        assert.throws(() => other.snapshot(), /faulted/);
        deviceSame(s, prior);
      } finally {
        other.close();
      }
    }
  } finally {
    s.close();
  }
});
test('unsafe2001 combined quads error after preparation while an earlier real flush remains', async () => {
  const s = await setup({
    nodes: [{ blend: 2 }, {}, { kind: 'ring', count: 2, interval: 0, segments: 500 }],
  });
  try {
    await s.play();
    s.tick();
    const prior = devicePrior(s),
      random = s.threads.snapshot();
    assert.throws(
      () => s.pass.draw(s.manager, drawFlags),
      (error) => error.code === 'EFFEKSEER_UNSAFE_INDEX_DOMAIN',
    );
    assert.equal(s.packets.length, 1);
    assert.equal(s.pass.batch.cursor, 192192);
    assert.equal(s.pass.batch.active, false);
    assert.equal(s.pass.batch.byteLength, 0);
    deviceSame(s, prior);
    assert.deepEqual(s.threads.snapshot(), random);
  } finally {
    s.close();
  }
});
test('3334 Ring request follows original byte precheck, retaining prior and later valid draws/current matrix', async () => {
  const s = await setup({
    nodes: [{}, { kind: 'ring', segments: 1667, position: [0.25, 0, 0] }, {}],
  });
  try {
    await s.play();
    s.tick();
    const r = s.pass.draw(s.manager, drawFlags);
    assert.equal(r.drawCalls, 2);
    assert.deepEqual(
      s.packets.map((p) => p.indices.length),
      [6, 6],
    );
    assert.equal(s.pass.ring.matrix[12], 0.25);
    assert.equal(s.pass.batch.cursor, 192);
    assert.equal(s.pass.batch.byteLength, 0);
  } finally {
    s.close();
  }
});
test('normal24 byte packing preserves XYZ/BGRA/UV and calibrated D3DCOLOR float bits', () => {
  const bytes = new Uint8Array(96),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) {
    for (let axis = 0; axis < 3; axis++)
      view.setFloat32(i * 24 + axis * 4, [0.25, -0, 0.5][axis], true);
    bytes.set([128, 0, 255, 127], i * 24 + 12);
    view.setFloat32(i * 24 + 16, 0.25, true);
    view.setFloat32(i * 24 + 20, 0.75, true);
  }
  const owner = new EffekseerPackedMesh(),
    batch = { bytes, byteLength: 96, vertexCount: 4, indexCount: 6, camera: I, projection: I },
    options = { viewport: [0, 0, 64, 48, 0, 1] },
    p = owner.prepareBatch(batch, options);
  assert.deepEqual(Array.from(p.vertices.subarray(0, 4)), [0.25, -0, 0.5, 1]);
  assert.equal(bits([p.vertices[7]])[0], 0x3efeff00);
  assert.deepEqual(Array.from(p.indices.subarray(0, 6)), [3, 1, 0, 3, 0, 2]);
  const storage = p.vertices,
    indices = p.indices,
    data = owner.batchData;
  for (let i = 0; i < 30; i++) {
    assert.equal(owner.prepareBatch(batch, options), p);
    assert.equal(p.vertices, storage);
    assert.equal(p.indices, indices);
    assert.equal(owner.batchData, data);
  }
  view.setFloat32(0, NaN, true);
  assert.throws(() => owner.prepareBatch(batch, options), /nonfinite/);
});
test('real manager2000 live sprites reach one legal12000-index GL-recorder call without new Play tokens', async () => {
  const s = await setup();
  try {
    const load = await s.loads.load('effect');
    for (let i = 0; i < 2000; i++)
      s.manager.play(load.id, [(i % 50) / 50, Math.floor(i / 50) / 40, 0.5], 'authored.caller');
    s.loads.release(load.id);
    s.tick();
    const random = s.threads.snapshot(),
      prior = devicePrior(s),
      r = s.pass.draw(s.manager, drawFlags);
    assert.equal(r.instances, 2000);
    assert.equal(r.drawCalls, 1);
    assert.equal(r.vertexCount, 8000);
    assert.equal(r.indexCount, 12000);
    assert.equal(s.packets.length, 1);
    assert.equal(s.packets[0].indices.at(-1), 7998);
    assert.equal(s.loads.nextID, 2);
    assert.equal(s.pass.batch.cursor, 192000);
    deviceSame(s, prior);
    assert.deepEqual(s.threads.snapshot(), random);
    const packed = s.pass.packed.vertices,
      geometry = s.pass.spriteRing.positions,
      cache = s.pass.batch.bytes,
      data = s.pass.byteData;
    s.pass.draw(s.manager, drawFlags);
    assert.equal(s.pass.packed.vertices, packed);
    assert.equal(s.pass.spriteRing.positions, geometry);
    assert.equal(s.pass.batch.bytes, cache);
    assert.equal(s.pass.byteData, data);
  } finally {
    s.close();
  }
});
