// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeGraphicsDevice } from '../src/native/graphics-device.mjs';
import { ParticlesGL } from '../src/render/particles-gl.mjs';
import { StageRenderer } from '../src/render/stage.mjs';
import { NativeScreenEffectRenderer } from '../src/native/screen-effect-render.mjs';
import { EmoteD3D9 } from '../oracle/m2-native-d3d.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import {
  setup as gpuFixture,
  draw as drawFixture,
  snapshots,
  material,
} from './fixtures/effekseer/gpu-seam.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const attachment = (overrides = {}) => ({
  kind: 'webgl',
  validate: () => true,
  rebuild() {},
  ...overrides,
});

test('device construction is detached and an explicit logical attachment can be ready', () => {
  const device = new NativeGraphicsDevice();
  assert.equal(device.status, 'detached');
  assert.equal(device.generation, 0);
  assert.throws(() => device.requireReady(), /detached/);
  const port = device.createLogical();
  assert.equal(device.status, 'ready');
  assert.equal(device.attachment, 'logical');
  assert.equal(device.generation, 1);
  device.close();
  device.close();
  port.lost();
  port.restored();
  assert.equal(device.status, 'closed');
  assert.equal(device.generation, 1);
  assert.throws(() => device.createLogical(), /closed/);
});

test('lost, not-reset, rebuilding and ready are distinct and rebuild is single-flight', async () => {
  const device = new NativeGraphicsDevice(),
    wait = deferred(),
    statuses = [];
  device.observe((d) => statuses.push([d.status, d.generation]));
  let calls = 0,
    valid = true;
  const port = device.attach(
    attachment({
      validate: () => valid,
      async rebuild() {
        calls++;
        await wait.promise;
        valid = true;
      },
    }),
  );
  valid = false;
  port.lost();
  assert.equal(device.ready, false);
  port.restored();
  assert.equal(device.status, 'not-reset');
  const pending = port.rebuild();
  assert.equal(device.rebuild(), pending);
  await Promise.resolve();
  assert.equal(device.status, 'rebuilding');
  assert.equal(device.generation, 1);
  assert.equal(calls, 1);
  wait.resolve();
  assert.equal(await pending, true);
  assert.equal(device.ready, true);
  assert.deepEqual(statuses, [
    ['not-reset', 0],
    ['ready', 1],
    ['lost', 1],
    ['not-reset', 1],
    ['rebuilding', 1],
    ['ready', 2],
  ]);
});

test('failed resource reconstruction stays not-reset and a real retry can succeed', async () => {
  const device = new NativeGraphicsDevice();
  let valid = false,
    builds = 0;
  const port = device.attach(
    attachment({
      validate: () => valid,
      rebuild() {
        if (++builds === 2) valid = true;
      },
    }),
  );
  await assert.rejects(port.rebuild(), /not reconstructed/);
  assert.equal(device.status, 'not-reset');
  assert.equal(device.generation, 0);
  assert.match(device.error.message, /not reconstructed/);
  assert.equal(await port.rebuild(), true);
  assert.equal(device.generation, 1);
  assert.equal(device.error, null);
});

test('a second loss while awaiting rebuild cannot publish ready', async () => {
  const device = new NativeGraphicsDevice(),
    wait = deferred();
  const port = device.attach(attachment({ rebuild: () => wait.promise }));
  port.lost();
  port.restored();
  const pending = port.rebuild();
  await Promise.resolve();
  port.lost();
  wait.resolve();
  assert.equal(await pending, false);
  assert.equal(device.status, 'lost');
  assert.equal(device.generation, 1);
});

test('owner close during reconstruction cannot publish a live generation', async () => {
  const device = new NativeGraphicsDevice(),
    wait = deferred();
  const port = device.attach(attachment({ rebuild: () => wait.promise }));
  port.lost();
  port.restored();
  const pending = port.rebuild();
  await Promise.resolve();
  device.close();
  wait.resolve();
  assert.equal(await pending, false);
  assert.equal(device.status, 'closed');
  assert.equal(device.generation, 1);
});

test('retired attachment callbacks cannot mutate a replacement attachment', () => {
  const device = new NativeGraphicsDevice(),
    first = device.attach(attachment());
  assert.throws(() => device.attach(attachment()), /already has/);
  first.retire();
  const second = device.createLogical();
  first.lost();
  first.restored();
  first.retire();
  assert.equal(second.current(), true);
  assert.equal(first.current(), false);
  assert.equal(device.status, 'ready');
  assert.equal(device.generation, 2);
});

test('reentrant reconstruction observers see the already-installed single flight', async () => {
  const device = new NativeGraphicsDevice();
  const port = device.attach(attachment());
  let reentrant;
  device.observe((d) => {
    if (d.status === 'rebuilding') reentrant = d.rebuild();
  });
  port.lost();
  port.restored();
  const pending = port.rebuild();
  await pending;
  assert.equal(reentrant, pending);
});

test('close from a not-reset observer cannot publish attachment ready', () => {
  const device = new NativeGraphicsDevice();
  device.observe((d) => {
    if (d.status === 'not-reset') d.close();
  });
  device.attach(attachment());
  assert.equal(device.status, 'closed');
  assert.equal(device.generation, 0);
});
test('close from a rebuilding observer does not invoke the resource provider', async () => {
  const device = new NativeGraphicsDevice();
  let calls = 0;
  const port = device.attach(
    attachment({
      rebuild() {
        calls++;
      },
    }),
  );
  device.observe((d) => {
    if (d.status === 'rebuilding') d.close();
  });
  port.lost();
  port.restored();
  assert.equal(await port.rebuild(), false);
  assert.equal(calls, 0);
  assert.equal(device.status, 'closed');
});

test('provider validation that closes its owner cannot publish ready', async () => {
  const device = new NativeGraphicsDevice();
  let validatingRebuild = false;
  const port = device.attach(
    attachment({
      validate() {
        if (validatingRebuild) device.close();
        return true;
      },
      rebuild() {
        validatingRebuild = true;
      },
    }),
  );
  port.lost();
  port.restored();
  assert.equal(await port.rebuild(), false);
  assert.equal(device.status, 'closed');
  assert.equal(device.generation, 1);
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`ordinary World ${profile} shares one explicit logical device without an EXE`, async () => {
    const world = await dataWorld(profile);
    try {
      const device = world.graphics.device,
        random = world.random.snapshot();
      assert.equal(device, world.stageRenderer.graphicsDevice);
      assert.equal(device.status, 'detached');
      assert.equal(world.stageRenderer.gpu, undefined);
      const context = world.graphics.d3dContext;
      world.graphics.createLogicalDevice();
      assert.equal(device.attachment, 'logical');
      assert.equal(device.status, 'ready');
      assert.equal(world.graphics.d3dContext, context);
      assert.deepEqual(world.random.snapshot(), random);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
    assert.equal(world.graphics.device.status, 'closed');
  });
}

// These command-recorder cases exercise content guards, not GPU pixels.
function recorder() {
  const gpu = Object.create(ParticlesGL.prototype),
    calls = [];
  gpu.gl = new Proxy(
    { COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2, STENCIL_BUFFER_BIT: 4, isContextLost: () => false },
    {
      get: (object, key) =>
        object[key] ??
        ((...args) => {
          calls.push([key, ...args]);
        }),
    },
  );
  gpu.primaryTarget = {
    owner: gpu,
    width: 4,
    height: 4,
    contentValid: false,
    depthStencil: { owner: gpu, width: 4, height: 4, format: 75, validMask: 0 },
  };
  gpu.drawing = true;
  return { gpu, calls, target: gpu.primaryTarget, depth: gpu.primaryTarget.depthStencil };
}
test('partial clear does not define an invalid color/depth/stencil target', () => {
  const { gpu, target, depth } = recorder();
  gpu.clear({ flags: 7, rectangles: [[0, 0, 2, 4]] });
  assert.equal(target.contentValid, false);
  assert.equal(depth.validMask, 0);
  assert.throws(() => gpu.requireTargetContent(target), /undefined/);
  assert.throws(() => gpu.requireDepthContent(depth, 2), /undefined/);
  gpu.clear({ flags: 2 });
  assert.equal(depth.validMask, 2);
  assert.throws(() => gpu.requireDepthContent(depth, 6), /undefined/);
  gpu.clear({ flags: 5, rectangles: [[0, 0, 4, 4]] });
  assert.equal(target.contentValid, true);
  assert.equal(depth.validMask, 6);
});
test('a clear of a smaller color target cannot define its larger depth attachment', () => {
  const { gpu, target, depth } = recorder();
  depth.width = depth.height = 8;
  gpu.clear({ flags: 7 });
  assert.equal(target.contentValid, true);
  assert.equal(depth.validMask, 0);
});
test('partial upload does not define the unfilled target; a full owned source can define it', () => {
  const { gpu, target } = recorder(),
    frame = { width: 4, height: 4, rgba: new Uint8Array(64) };
  gpu.uploadRenderTarget(target, frame, [0, 0, 4, 2]);
  assert.equal(target.contentValid, false);
  assert.throws(() => gpu.uploadRenderTarget(target, frame, [0, 0, 5, 4]), /invalid/);
  assert.equal(target.contentValid, false);
  gpu.uploadRenderTarget(target, frame);
  assert.equal(target.contentValid, true);
});
test('invalid target reads and sampling stop before accessing old handles', () => {
  const { gpu, target, calls } = recorder();
  assert.throws(() => gpu.pixels(target), /undefined/);
  assert.throws(() => gpu.texture({ nativeTarget: target }), /undefined/);
  assert.throws(() => gpu.drawPresentation(target), /undefined/);
  assert.equal(calls.length, 0);
});
test('the real D3D syncSurface early return rejects a known invalid target even when dirty=false', () => {
  const { gpu, target, calls } = recorder(),
    adapter = Object.create(EmoteD3D9.prototype);
  Object.assign(adapter, { gpu, backbuffer: 1, gpuTargets: new Map([[2, target]]) });
  assert.throws(() => adapter.syncSurface(2, { pointer: 2, dirty: false }), /undefined/);
  assert.equal(calls.length, 0);
  target.contentValid = true;
  adapter.syncSurface(2, { pointer: 2, dirty: false });
  assert.equal(calls.length, 0);
});

test('validity: a target needs explicit true rather than absent or coercible metadata', () => {
  const { gpu, target } = recorder();
  delete target.contentValid;
  assert.throws(() => gpu.requireTargetContent(target), /undefined/);
  for (const value of [undefined, null, false, 0, 1, 'true']) {
    target.contentValid = value;
    assert.throws(() => gpu.requireTargetContent(target), /undefined/);
  }
  target.contentValid = true;
  assert.doesNotThrow(() => gpu.requireTargetContent(target));
});
test('validity: a read from an attached depth object needs an explicit valid mask', () => {
  const { gpu, depth } = recorder();
  delete depth.validMask;
  assert.throws(() => gpu.requireDepthContent(depth, 2), /undefined/);
  for (const value of [undefined, null, '6', 6.5, -1, -2, 8, 0x100000006]) {
    depth.validMask = value;
    assert.throws(() => gpu.requireDepthContent(depth, 2), /undefined/);
  }
});
test('validity: all canonical mask combinations retain the earlier acceptance rule', () => {
  const { gpu, depth } = recorder();
  for (const value of [0, 2, 4, 6])
    for (const required of [0, 2, 4, 6]) {
      depth.validMask = value;
      if ((value & required) === required)
        assert.doesNotThrow(() => gpu.requireDepthContent(depth, required));
      else assert.throws(() => gpu.requireDepthContent(depth, required), /undefined/);
    }
});
test('validity: no-read calls and real depth-free geometry do not require an attachment', () => {
  const { gpu } = recorder();
  assert.doesNotThrow(() => gpu.requireDepthContent({}, 0));
  for (const absent of [null, undefined])
    for (const required of [0, 2, 4, 6])
      assert.doesNotThrow(() => gpu.requireDepthContent(absent, required));
  const s = gpuFixture();
  s.gpu.activeTarget.depthStencil = null;
  s.scope.begin().applyNormalMaterial(material());
  drawFixture(s);
  s.scope.end();
  assert.equal(snapshots(s).length, 1);
});

test('validity-components: depth-only formats require depth bits and do not require absent stencil', () => {
  const { gpu, depth } = recorder();
  for (const format of [77, 80]) {
    depth.format = format;
    depth.validMask = 2;
    assert.doesNotThrow(() => gpu.requireDepthContent(depth, 6));
    assert.doesNotThrow(() => gpu.requireDepthContent(depth, 4));
    depth.validMask = 6;
    assert.doesNotThrow(() => gpu.requireDepthContent(depth, 6));
    depth.validMask = 0;
    assert.doesNotThrow(() => gpu.requireDepthContent(depth, 4));
    assert.throws(() => gpu.requireDepthContent(depth, 2), /undefined/);
    assert.throws(() => gpu.requireDepthContent(depth, 6), /undefined/);
    delete depth.validMask;
    assert.doesNotThrow(() => gpu.requireDepthContent(depth, 4));
    assert.throws(() => gpu.requireDepthContent(depth, 2), /undefined/);
  }
  depth.format = 75;
  depth.validMask = 2;
  assert.throws(() => gpu.requireDepthContent(depth, 4), /undefined/);
  depth.validMask = 6;
  delete depth.format;
  assert.throws(() => gpu.requireDepthContent(depth, 2), /undefined/);
  assert.doesNotThrow(() => gpu.requireDepthContent(depth, 0));
});
test('validity-components: stencil-enabled typed drawing uses depth-only attachments without reading stencil', () => {
  for (const format of [77, 80]) {
    const s = gpuFixture();
    Object.assign(s.gpu.activeTarget.depthStencil, { format, validMask: 2 });
    s.scope.begin().applyNormalMaterial(material());
    s.context.states.set(52, 1);
    drawFixture(s);
    s.scope.end();
    const [call] = snapshots(s);
    assert.equal(snapshots(s).length, 1);
    assert.ok(call.enabled.has('DEPTH_TEST'));
    assert.ok(call.enabled.has('STENCIL_TEST'));
  }
});

// This recorder proves content ownership/definedness and GL calls, not pixels.
test('screen checkpoints restore undefined targets without reading or reviving old color storage', () => {
  const make = () => {
    const { gpu, target, calls } = recorder(),
      stage = new StageRenderer();
    stage.gpu = gpu;
    const renderer = new NativeScreenEffectRenderer({
      world: { stageRenderer: stage, getNativeGPU: () => gpu },
    });
    return { gpu, target, calls, renderer };
  };
  const source = make(),
    saved = structuredClone(source.renderer.snapshot());
  assert.deepEqual(saved.backbuffer, {
    width: 4,
    height: 4,
    contentValid: false,
    pixels: null,
  });
  assert.equal(source.calls.length, 0, 'undefined storage is not read or cleared');

  const fresh = make();
  fresh.renderer.restore(structuredClone(saved));
  assert.deepEqual(fresh.renderer.snapshot(), saved);
  assert.equal(fresh.target.contentValid, false);
  assert.throws(() => fresh.gpu.pixels(), /undefined/);
  assert.equal(fresh.calls.length, 0, 'fresh restore performs no GL read/upload/clear');

  fresh.gpu.uploadRenderTarget(fresh.target, {
    width: 4,
    height: 4,
    rgba: new Uint8Array(64).fill(73),
  });
  assert.equal(fresh.target.contentValid, true);
  fresh.calls.length = 0;
  fresh.renderer.restore(structuredClone(saved));
  assert.equal(fresh.target.contentValid, false, 'undefined replaces already-valid color storage');
  assert.throws(() => fresh.gpu.pixels(), /undefined/);
  assert.equal(fresh.calls.length, 0, 'invalidating old storage does not manufacture pixel values');

  source.gpu.uploadRenderTarget(source.target, {
    width: 4,
    height: 4,
    rgba: new Uint8Array(64),
  });
  const valid = structuredClone(source.renderer.snapshot());
  assert.equal(valid.backbuffer.contentValid, true);
  assert.equal(source.calls.filter(([name]) => name === 'readPixels').length, 1);
  fresh.renderer.restore(valid);
  assert.equal(fresh.target.contentValid, true);
  assert.equal(fresh.calls.filter(([name]) => name === 'texSubImage2D').length, 1);
  assert.deepEqual(fresh.renderer.snapshot(), valid);
});
