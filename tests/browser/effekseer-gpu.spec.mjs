// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

test('independent EFK typed GPU backend matches its frozen D3D programmable profile', async ({
  page,
}) => {
  const golden = JSON.parse(
    await readFile(new URL('../fixtures/effekseer/gpu-profile-reference.json', import.meta.url)),
  );
  const blocked = [];
  await page.route('**/*', async (route) => {
    // Exercise the backend without starting the unrelated application entry.
    if (route.request().isNavigationRequest() && new URL(route.request().url()).pathname === '/') {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>EFK GPU</title>',
      });
      return;
    }
    if (
      /\/oracle\/|\/native\/engine-process\.mjs|\/ppi\/(?:backend|backend-artifact)\.mjs|unicorn|\.(?:exe|dll)(?:$|\?)/i.test(
        route.request().url(),
      )
    ) {
      blocked.push(route.request().url());
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  const actual = await page.evaluate(async (data) => {
    const [{ StageRenderer }, { createD3DContext }, { EffekseerPackedMesh }] = await Promise.all([
      import('/src/render/stage.mjs'),
      import('/src/render/particles-gl.mjs'),
      import('/src/effekseer/mesh-packet.mjs'),
    ]);
    const Original = globalThis.OffscreenCanvas,
      random = Math.random;
    let canvases = 0;
    globalThis.OffscreenCanvas = new Proxy(Original, {
      construct(target, args, newTarget) {
        canvases++;
        return Reflect.construct(target, args, newTarget);
      },
    });
    Math.random = () => {
      throw new Error('EFK typed rendering requested an unowned RNG');
    };
    const stage = new StageRenderer({ canvas: { width: data.width, height: data.height } }),
      gpu = stage.gpu,
      packer = new EffekseerPackedMesh(),
      before = canvases,
      frames = [];
    try {
      const texture = { ...data.texture, rgba: Uint8Array.from(data.texture.rgba) };
      for (const c of data.cases) {
        const mesh = {
            kind: 'sprite',
            coordinateSpace: 'world',
            positions: Float32Array.from(data.geometry.positions),
            uv: Float32Array.from(data.geometry.uv),
            indices: Uint32Array.from(data.geometry.indices),
            colors: Uint8Array.from(Array.from({ length: 4 }, () => c.vertexRGBA).flat()),
            vertexCount: 4,
            indexCount: 6,
          },
          packet = packer.prepare(mesh, {
            camera: data.camera,
            projection: data.projection,
            viewport: data.viewport,
          }),
          state = createD3DContext({ depthStencilEnabled: true });
        for (const [id, value] of Object.entries({
          7: 1,
          8: 3,
          9: 2,
          14: 0,
          15: c.alphaEnable,
          19: 2,
          20: 1,
          22: 1,
          23: 4,
          24: c.alphaReference,
          25: c.alphaFunction,
          26: 0,
          27: 0,
          28: 0,
          52: 0,
          137: 0,
          141: 1,
          168: 15,
          171: 1,
          174: 0,
          194: 0,
          206: 0,
        }))
          state.states.set(Number(id), value);
        for (const [id, value] of Object.entries({ 1: 3, 2: 3, 5: 1, 6: 1, 7: 0, 11: 0 }))
          state.samplers.set(Number(id), value);
        gpu.beginFrame(0xff111d2b);
        gpu.clear({ flags: 2, depth: 0x3f800000, rectangles: [[8, 6, 40, 30]] });
        stage.drawEffekseer(packet, c.textured ? texture : null, { state });
        const rgba = Array.from(gpu.pixels()),
          error = gpu.gl.getError();
        gpu.endNativeFrame();
        frames.push({ name: c.name, rgba, error });
      }
      return {
        frames,
        canvasesBefore: before,
        canvasesAfter: canvases,
        bufferGrowths: packer.bufferGrowths,
      };
    } finally {
      stage.dispose();
      globalThis.OffscreenCanvas = Original;
      Math.random = random;
    }
  }, golden);
  expect(blocked).toEqual([]);
  expect(actual.canvasesBefore).toBe(3);
  expect(actual.canvasesAfter).toBe(3);
  expect(actual.bufferGrowths).toBe(1);
  expect(actual.frames).toHaveLength(golden.cases.length);
  for (const c of golden.cases) {
    const frame = actual.frames.find((x) => x.name === c.name),
      expected = inflateSync(Buffer.from(c.rgbaDeflate, 'base64'));
    expect(frame.error, c.name).toBe(0);
    expect(Buffer.from(frame.rgba), c.name).toEqual(expected);
    let changed = 0;
    for (let i = 0; i < frame.rgba.length; i += 4)
      if (frame.rgba.slice(i, i + 4).some((v, j) => v !== golden.clearRGBA[j])) changed++;
    expect(changed, c.name).toBe(c.changedPixels);
  }
});

import { createHash } from 'node:crypto';

const defaultReference = JSON.parse(
  await readFile(
    new URL('../fixtures/effekseer/default-world-four-reference.json', import.meta.url),
  ),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bootKCS = Buffer.from(defaultReference.bootKCSBase64, 'base64');
if (
  bootKCS.length !== defaultReference.bootKCSBytes ||
  digest(bootKCS) !== defaultReference.bootKCSSHA256
)
  throw new Error('Authored default World bootstrap differs from its reference');
for (const c of defaultReference.cases) {
  const effect = Buffer.from(c.efkBase64, 'base64');
  const expected = inflateSync(Buffer.from(c.rgbaDeflateBase64, 'base64'));
  if (
    effect.length !== c.efkBytes ||
    digest(effect) !== c.efkSHA256 ||
    expected.length !== c.RGBABytes ||
    digest(expected) !== c.RGBASHA256
  )
    throw new Error('Authored default World inputs differ: ' + c.kind);
}

const defaultTrailCacheFixtures = {
  ribbon: {
    kind: 'ribbon',
    effectSHA256: 'd5c92a68a70a07e4dc4b892b729ffeb0fda76eb637d64c5f0e6af1d1ba74f4e3',
    draw: { instanceCount: 3, instanceIndex: 3, uv: [0, 0, 1, 1] },
  },
  track: {
    kind: 'track',
    effectSHA256: '986b82bbc06faf280338d23ec8591803229daf9981d9babee05a1f8a1cc58a4c',
    draw: {
      instanceCount: 3,
      instanceIndex: 3,
      uv: [0, 0, 1, 1],
      colors: [
        { type: 'fixed', value: [0, 0, 255, 255] },
        { type: 'fixed', value: [0, 0, 255, 255] },
        { type: 'fixed', value: [0, 0, 255, 255] },
        { type: 'fixed', value: [0, 0, 255, 255] },
        { type: 'fixed', value: [0, 0, 255, 255] },
        { type: 'fixed', value: [0, 0, 255, 255] },
      ],
      sizes: [0.5, 0.5, 0.5],
    },
  },
};

async function exerciseDefaultWorld(data) {
  const evidence = { stage: 'import helper', frames: {}, reads: [] };
  globalThis.__defaultEFKProgress = evidence;
  const { makeDefaultWorld, loadDefaultEffect, floatPacket } = await import(
    '/tests/fixtures/effekseer/default-world-browser.mjs'
  );
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const encode = (v) =>
    JSON.stringify(v, (_key, x) => {
      if (ArrayBuffer.isView(x))
        return {
          type: x.constructor.name,
          bytes: Array.from(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)),
        };
      if (x instanceof Map) return { map: [...x] };
      if (x instanceof Set) return { set: [...x] };
      return Object.is(x, -0) ? { negativeZero: true } : x;
    });
  const same = (a, b, message) => check(encode(a) === encode(b), message);
  const words = (v) => Array.from(new Uint32Array(v.buffer, v.byteOffset, v.length));
  const population = (t) => {
    const instances = [...t.manager.instances.values()];
    const roots = instances.filter((i) => i.slot === null).length;
    return {
      capacity: t.manager.capacity,
      roots,
      nonRoots: instances.length - roots,
      occupiedPool: t.manager.capacity - t.manager.freeSlots.length,
      globalCount: [...t.manager.sets.values()].reduce((n, s) => n + s.global.count, 0),
    };
  };
  async function withoutReplay(world, action, allowRestoreReads = false) {
    const owners = [
      [world.game, 'require'],
      [world.effekseer, 'play'],
      [world.effekseer, 'update'],
      [world.random, 'rand'],
      [world.random, 'frand'],
      [world.random.integer, 'seed'],
      [world.random.real, 'seed'],
      [world.random.integer, 'nextUint32'],
      [world.random.real, 'nextUint32'],
    ];
    const saved = owners.map(([owner, name]) => [owner, name, owner[name]]);
    const random = Math.random,
      read = world.game.read;
    let readAttempts = 0,
      verifiedReads = 0;
    world.game.read = async (name) => {
      const observation = {
        phase: evidence.stage,
        name,
        attempt: evidence.reads.length + 1,
        allowed: false,
      };
      evidence.reads.push(observation);
      // Reserve this ordered quota before awaiting the source or its identity.
      const resource = data.restoreResources[readAttempts++];
      check(
        allowRestoreReads &&
          evidence.stage === 'fresh restore' &&
          resource &&
          name === resource.name,
        'Forbidden mounted read during ' + evidence.stage + ': ' + name,
      );
      const bytes = await read.call(world.game, name);
      check(
        bytes instanceof Uint8Array && bytes.byteLength === resource.bytes,
        'Restore source length changed: ' + name,
      );
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
        x.toString(16).padStart(2, '0'),
      ).join('');
      check(hash === resource.sha256, 'Restore source identity changed: ' + name);
      verifiedReads++;
      Object.assign(observation, { allowed: true, bytes: bytes.byteLength, sha256: hash });
      return bytes;
    };
    for (const [owner, name] of owners)
      owner[name] = () => {
        throw new Error('Restore/render replayed ' + name);
      };
    Math.random = () => {
      throw new Error('Restore/render requested unowned RNG');
    };
    try {
      const result = await action();
      if (allowRestoreReads) {
        check(
          readAttempts === 2 && verifiedReads === 2,
          'Fresh restore did not complete both read quotas',
        );
        evidence.restoreReadQuota = { attempts: readAttempts, verified: verifiedReads };
      }
      return result;
    } finally {
      world.game.read = read;
      for (const [owner, name, original] of saved) owner[name] = original;
      Math.random = random;
    }
  }
  function physical(gpu) {
    const gl = gpu.gl,
      ids = new WeakMap();
    let next = 1;
    const value = (v) => {
      if (ArrayBuffer.isView(v) || Array.isArray(v)) return Array.from(v);
      if (v && typeof v === 'object') {
        if (!ids.has(v)) ids.set(v, next++);
        return { object: v };
      }
      return v;
    };
    const take = () => {
      const names = [
        'CURRENT_PROGRAM',
        'VERTEX_ARRAY_BINDING',
        'ARRAY_BUFFER_BINDING',
        'ELEMENT_ARRAY_BUFFER_BINDING',
        'DRAW_FRAMEBUFFER_BINDING',
        'READ_FRAMEBUFFER_BINDING',
        'RENDERBUFFER_BINDING',
        'ACTIVE_TEXTURE',
        'VIEWPORT',
        'DEPTH_RANGE',
        'SCISSOR_BOX',
        'COLOR_WRITEMASK',
        'DEPTH_WRITEMASK',
        'DEPTH_FUNC',
        'BLEND_SRC_RGB',
        'BLEND_DST_RGB',
        'BLEND_SRC_ALPHA',
        'BLEND_DST_ALPHA',
        'BLEND_EQUATION_RGB',
        'BLEND_EQUATION_ALPHA',
        'BLEND_COLOR',
        'CULL_FACE_MODE',
        'FRONT_FACE',
      ];
      const result = Object.fromEntries(
        names.map((name) => [name, value(gl.getParameter(gl[name]))]),
      );
      result.enabled = [
        'BLEND',
        'DEPTH_TEST',
        'SCISSOR_TEST',
        'STENCIL_TEST',
        'CULL_FACE',
        'POLYGON_OFFSET_FILL',
      ].map((name) => [name, gl.isEnabled(gl[name])]);
      const active = gl.getParameter(gl.ACTIVE_TEXTURE);
      result.units = [];
      for (let i = 0; i < 4; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        result.units.push([
          value(gl.getParameter(gl.TEXTURE_BINDING_2D)),
          value(gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP)),
          value(gl.getParameter(gl.SAMPLER_BINDING)),
        ]);
      }
      gl.activeTexture(active);
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      result.uniforms = [];
      for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const info = gl.getActiveUniform(program, i);
        result.uniforms.push([
          info.name,
          value(gl.getUniform(program, gl.getUniformLocation(program, info.name))),
        ]);
      }
      return result;
    };
    // WebGL handles have no enumerable identity. Convert them through one
    // capture-local map after both observations, never through JSON {}.
    const stable = (v) => {
      if (Array.isArray(v)) return v.map(stable);
      if (v && typeof v === 'object' && Object.hasOwn(v, 'object')) return ids.get(v.object);
      if (v && typeof v === 'object')
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stable(x)]));
      return v;
    };
    return () => stable(take());
  }
  async function render(world, task, label) {
    evidence.stage = label + ' render';
    const stage = world.stageRenderer,
      gpu = stage.gpu,
      gl = gpu.gl;
    check(
      gpu.graphicsDevice === world.graphics.device &&
        stage.graphicsDevice === world.graphics.device,
      'Different World device',
    );
    const cpu = task.manager.snapshot(),
      crt = world.effekseer.threads.snapshot();
    const managerBefore = structuredClone(cpu);
    const trail = data.trailFixture;
    let expectedFirstDraw = null;
    if (trail) {
      check(
        (trail.kind === 'ribbon' || trail.kind === 'track') &&
          trail.effectSHA256 === data.restoreResources[1].sha256,
        'Trail cache expectation is not bound to the selected authored Effect',
      );
      const groups = cpu.groups.filter((group) => group.values?.kind === trail.kind);
      check(groups.length === 1, 'Authored trail group is not unique');
      const group = groups[0];
      same(
        {
          id: group.id,
          nodeID: group.nodeID,
          owner: group.owner,
          scope: group.values.scope,
          kind: group.values.kind,
          active: group.active,
          removing: group.removing,
        },
        {
          id: 2,
          nodeID: 1,
          owner: 1,
          scope: 'group',
          kind: trail.kind,
          active: [2, 3, 4],
          removing: [],
        },
        'Authored trail group identity changed',
      );
      if (trail.kind === 'track') {
        same(group.values.colors, trail.draw.colors, 'Track sampled colors changed');
        same(group.values.sizes, trail.draw.sizes, 'Track sampled sizes changed');
      }
      if (label === 'original') {
        same(group.values.draw, null, 'First authored trail draw already has a cache');
        expectedFirstDraw = structuredClone(cpu);
        expectedFirstDraw.groups.find((item) => item.id === 2).values.draw = structuredClone(
          trail.draw,
        );
      } else {
        check(label === 'restored', 'Unexpected authored trail draw phase');
        same(group.values.draw, trail.draw, 'Fresh trail did not preserve the exact draw cache');
      }
    }
    const mt = world.random.snapshot(),
      frame = world.frame;
    const states = [...world.graphics.d3dContext.states];
    const packets = [],
      indexed = [],
      uploads = [];
    const submit = stage.drawEffekseer,
      draw = gl.drawElements,
      buffer = gl.bufferData;
    gpu.beginFrame(data.clearARGB);
    gl.viewport(...data.viewport.slice(0, 4));
    gl.depthRange(...data.viewport.slice(4));
    const target = gpu.target,
      depth = target.depthStencil;
    check(target === gpu.primaryTarget && depth !== null, 'Not the current World target/depth');
    const capturePhysical = physical(gpu),
      before = capturePhysical();
    stage.drawEffekseer = function (packet, image, options) {
      packets.push({
        vertexCount: packet.vertexCount,
        indexCount: packet.indexCount,
        quadCount: packet.vertexCount / 4,
        cpuActiveBytes: task.meshBatch.batch.packet.byteLength,
        cpuCapacityBytes: task.meshBatch.batch.bytes.byteLength,
        vertexBytes: packet.vertexCount * packet.vertices.BYTES_PER_ELEMENT * 10,
        indexBytes: packet.indexCount * packet.indices.BYTES_PER_ELEMENT,
        indexStorage: packet.indices.constructor.name,
        cameraBits: words(packet.camera),
        projectionBits: words(packet.projection),
        viewport: Array.from(packet.viewport),
        sameContext: options.context === world.graphics.d3dContext,
        sameTarget: gpu.target === target && gpu.target.depthStencil === depth,
      });
      return submit.call(this, packet, image, options);
    };
    gl.drawElements = function (...args) {
      indexed.push(args);
      return draw.apply(this, args);
    };
    gl.bufferData = function (...args) {
      const data = args[1];
      if (ArrayBuffer.isView(data))
        uploads.push({
          target: args[0],
          storage: data.constructor.name,
          srcOffset: args[3] ?? 0,
          activeElements: args[4] ?? data.length,
          activeBytes: (args[4] ?? data.length) * data.BYTES_PER_ELEMENT,
          capacityBytes: data.byteLength,
        });
      return buffer.apply(this, args);
    };
    try {
      return await withoutReplay(world, async () => {
        const item = world.screenEffects.rendering
          .currentFrame()
          .items.find((x) => x.p?.nativeTaskWorldID === task.record.id);
        check(
          item?.p.nativeGraph === task.plane.graph && task.plane.graph.registrationEnabled === true,
          'Missing normal registered D6 callback',
        );
        await world.screenEffects.rendering.drawRange(170, 171);
        const physicalAfter = capturePhysical();
        const rgba = Array.from(gpu.pixels()),
          error = gl.getError();
        const managerAfter = structuredClone(task.manager.snapshot());
        const beforeJSON = encode(managerBefore),
          afterJSON = encode(managerAfter);
        check(
          new TextEncoder().encode(beforeJSON).byteLength <= 1048576 &&
            new TextEncoder().encode(afterJSON).byteLength <= 1048576,
          'Diagnostic manager snapshots exceed one MiB each',
        );
        const observed = {
          rgba,
          managerSnapshots: { before: JSON.parse(beforeJSON), after: JSON.parse(afterJSON) },
          packets,
          indexed,
          uploads,
          error,
          subpixelBits: gl.getParameter(gl.SUBPIXEL_BITS),
          stats: { ...task.meshBatch.result },
          population: population(task),
          taskCameraBits: words(task.camera),
          taskProjectionBits: words(task.projection),
          frame,
          physicalBefore: before,
          physicalAfter,
        };
        evidence.frames[label] = observed;
        same(physicalAfter, before, 'D6 leaked physical GPU state');
        same([...world.graphics.d3dContext.states], states, 'D6 leaked logical render states');
        check(
          gpu.target === target && gpu.target.depthStencil === depth,
          'D6 replaced target/depth',
        );
        check(error === 0, 'Actual GL draw failed: ' + error);
        if (expectedFirstDraw)
          same(
            task.manager.snapshot(),
            expectedFirstDraw,
            'First trail draw changed unexpected manager state',
          );
        else same(task.manager.snapshot(), cpu, 'Rendering advanced manager');
        same(world.effekseer.threads.snapshot(), crt, 'Rendering advanced CRT');
        same(world.random.snapshot(), mt, 'Rendering advanced MT');
        check(world.frame === frame, 'Rendering advanced World frame');
        check(
          task.meshBatch.ring === task.ring &&
            task.gpuBackend.gpu === gpu &&
            task.gpuBackend.stage === stage,
          'Different Task batch/Ring/GPU owner',
        );
        return Object.assign(observed, {
          physicalRestored: true,
          logicalStatesRestored: true,
          targetDepthShared: true,
        });
      });
    } finally {
      stage.drawEffekseer = submit;
      gl.drawElements = draw;
      gl.bufferData = buffer;
      if (gpu.drawing) gpu.endNativeFrame();
    }
  }
  const NativeCanvas = globalThis.OffscreenCanvas;
  let canvases = 0,
    world,
    fresh,
    failure,
    result;
  const cleanup = [];
  globalThis.OffscreenCanvas = new Proxy(NativeCanvas, {
    construct(target, args, newTarget) {
      canvases++;
      return Reflect.construct(target, args, newTarget);
    },
  });
  try {
    evidence.stage = 'construct original';
    world = await makeDefaultWorld(data, true);
    const plays = [],
      updates = [];
    const play = world.effekseer.play,
      update = world.effekseer.update;
    world.effekseer.play = function (...args) {
      plays.push({
        manager: args[1],
        position: Array.from(args[3]),
        owner: world.dispatchContext.executorID(args[0]),
      });
      return play.apply(this, args);
    };
    world.effekseer.update = function (...args) {
      updates.push({ manager: args[1], owner: world.dispatchContext.executorID(args[0]) });
      return update.apply(this, args);
    };
    const { sender, task } = await loadDefaultEffect(world);
    check(plays.length === 0 && updates.length === 0, 'FES setup replayed Play/Update');
    const initialFrame = world.frame;
    await world.withExecutor(world.effekseer.frameExecutor, async (executorEntry) => {
      await world.sendEngine(task.record.id, sender, 51, 0, 0, {
        executorEntry,
        payload: floatPacket(data.playPosition),
      });
      await world.sendEngine(task.record.id, sender, 571, 0, 0, { executorEntry });
    });
    for (let i = 0; i < data.normalWorldUpdateCount; i++) await world.tick();
    check(plays.length === 1 && plays[0].manager === task.manager, 'Not one actual Task Play');
    same(plays[0].position, data.playPosition, 'Different Play position');
    check(
      updates.length === 4 &&
        updates.every((x) => x.manager === task.manager && x.owner === plays[0].owner),
      'Not four updates on the same executor',
    );
    check(world.frame === initialFrame + 4, 'Unexpected normal World frame count');
    world.graphics.view.configure({
      virtualWidth: data.virtualView[0],
      virtualHeight: data.virtualView[1],
    });
    await world.withExecutor(world.effekseer.frameExecutor, (executorEntry) =>
      world.sendEngine(task.record.id, sender, 57, 0, 0, {
        executorEntry,
        payload: floatPacket(data.public57Bits, true),
      }),
    );
    check(!world.nativeEngine, 'Default World opened the original engine');
    evidence.setup = {
      plays: plays.map((x) => ({ position: x.position, owner: x.owner })),
      updates: updates.map((x) => ({ owner: x.owner })),
      frame: world.frame,
    };
    const before = canvases,
      original = await render(world, task, 'original'),
      after = canvases;
    const savedTask = task.snapshot(),
      savedCRT = world.effekseer.threads.snapshot();
    const savedMT = world.random.snapshot();
    evidence.stage = 'original snapshot';
    const checkpoint = await withoutReplay(world, async () => world.snapshot());
    evidence.stage = 'construct fresh';
    fresh = await makeDefaultWorld(data, false);
    check(
      fresh !== world &&
        fresh.stageRenderer !== world.stageRenderer &&
        fresh.stageRenderer.gpu !== world.stageRenderer.gpu &&
        fresh.graphics.device !== world.graphics.device,
      'Fresh World reused the old owners',
    );
    evidence.stage = 'fresh restore';
    await withoutReplay(fresh, async () => fresh.restore(structuredClone(checkpoint)), true);
    const restored = fresh.objects.objects.get(task.record.id).implementation;
    check(
      restored !== task && restored.manager !== task.manager && restored.gpuBackend === null,
      'Restore reused CPU owners or replayed a physical submission',
    );
    same(restored.snapshot(), savedTask, 'Fresh Task current bytes differ');
    same(fresh.effekseer.threads.snapshot(), savedCRT, 'Fresh CRT differs');
    same(fresh.random.snapshot(), savedMT, 'Fresh MT differs');
    const freshBefore = canvases,
      restoredFrame = await render(fresh, restored, 'restored');
    result = {
      original,
      restored: restoredFrame,
      freshIndependentOwners: true,
      canvases: { before, after, freshBefore, freshAfter: canvases },
      setup: evidence.setup,
      reads: evidence.reads,
      // Immutable mounted sources are revalidated; resource commands/state never replay.
      noResourceCommandStateReplay: true,
      noRenderSnapshotReads: true,
      restoreReadQuota: evidence.restoreReadQuota,
    };
  } catch (error) {
    failure = error;
  } finally {
    for (const w of [fresh, world])
      if (w) {
        try {
          await w.close({ flushFiles: false });
        } catch (error) {
          cleanup.push(error);
        }
      }
    globalThis.OffscreenCanvas = NativeCanvas;
  }
  if (failure) {
    if (cleanup.length) failure.cleanup = cleanup;
    throw failure;
  }
  if (cleanup.length) throw new AggregateError(cleanup, 'Default World cleanup failed');
  return result;
}

for (const c of defaultReference.cases) {
  const trailFixture = defaultTrailCacheFixtures[c.kind] ?? null;
  if (trailFixture && trailFixture.effectSHA256 !== c.efkSHA256)
    throw new Error('Trail cache fixture identity changed: ' + c.kind);
  test(
    'default FES ' + c.kind + ' submits through its World GPU and a true fresh World',
    async ({ page }, testInfo) => {
      const blocked = [];
      await page.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (request.isNavigationRequest() && url.pathname === '/') {
          await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Default EFK World</title>',
          });
          return;
        }
        if (
          /\/oracle\/|\/native\/engine-process\.mjs|\/ppi\/(?:backend|backend-artifact)\.mjs|unicorn|\.(?:exe|dll|ppi)(?:$|\?)/i.test(
            url.href,
          ) ||
          /(?:^|\/)(?:cs2_debug_key\.dat|[^/]*\.key)(?:$|\?)/i.test(url.pathname)
        ) {
          blocked.push(url.href);
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.goto('/');
      async function preserve(value) {
        await testInfo.attach('default-' + c.kind + '-evidence', {
          body: Buffer.from(JSON.stringify({ value, blocked })),
          contentType: 'application/json',
        });
        const frames =
          value?.frames ?? (value ? { original: value.original, restored: value.restored } : {});
        for (const [name, frame] of Object.entries(frames))
          if (frame?.rgba)
            await testInfo.attach('default-' + c.kind + '-' + name + '-rgba', {
              body: Buffer.from(frame.rgba),
              contentType: 'application/octet-stream',
            });
      }
      let actual;
      try {
        actual = await page.evaluate(exerciseDefaultWorld, {
          profile: defaultReference.profile,
          canvas: defaultReference.canvas,
          virtualView: defaultReference.virtualView,
          viewport: defaultReference.viewport,
          clearARGB: defaultReference.clearARGB,
          playPosition: defaultReference.playPosition,
          public57Bits: defaultReference.public57Bits,
          normalWorldUpdateCount: defaultReference.normalWorldUpdateCount,
          trailFixture,
          restoreResources: [
            {
              name: 'case.kcs',
              bytes: defaultReference.bootKCSBytes,
              sha256: defaultReference.bootKCSSHA256,
            },
            { name: 'scene.efk', bytes: c.efkBytes, sha256: c.efkSHA256 },
          ],
          files: {
            'case.kcs': Array.from(bootKCS),
            'screen.fes': Array.from(new TextEncoder().encode(defaultReference.fesSource)),
            'scene.efk': Array.from(Buffer.from(c.efkBase64, 'base64')),
          },
        });
      } catch (error) {
        const partial = await page
          .evaluate(() => globalThis.__defaultEFKProgress ?? null)
          .catch(() => null);
        await preserve(partial);
        throw error;
      }
      await preserve(actual);
      expect(blocked).toEqual([]);
      expect(actual.freshIndependentOwners).toBe(true);
      expect(actual.noResourceCommandStateReplay && actual.noRenderSnapshotReads).toBe(true);
      expect(actual.restoreReadQuota).toEqual({ attempts: 2, verified: 2 });
      expect(actual.reads).toEqual([
        {
          phase: 'fresh restore',
          name: 'case.kcs',
          attempt: 1,
          allowed: true,
          bytes: defaultReference.bootKCSBytes,
          sha256: defaultReference.bootKCSSHA256,
        },
        {
          phase: 'fresh restore',
          name: 'scene.efk',
          attempt: 2,
          allowed: true,
          bytes: c.efkBytes,
          sha256: c.efkSHA256,
        },
      ]);
      expect(actual.canvases).toEqual({ before: 3, after: 3, freshBefore: 6, freshAfter: 6 });
      const expected = inflateSync(Buffer.from(c.rgbaDeflateBase64, 'base64'));
      for (const frame of [actual.original, actual.restored]) {
        expect(frame.subpixelBits).toBeGreaterThanOrEqual(4);
        expect(frame.subpixelBits).toBeLessThanOrEqual(12);
        expect(frame.population).toEqual(c.population);
        expect(frame.stats).toMatchObject(c.expected);
        expect(frame.packets).toHaveLength(1);
        const packet = frame.packets[0];
        expect(packet).toMatchObject({
          vertexCount: c.expected.vertexCount,
          indexCount: c.expected.indexCount,
          vertexBytes: c.expected.vertexCount * 40,
          indexBytes: c.expected.indexCount * 2,
          indexStorage: 'Uint16Array',
          sameContext: true,
          sameTarget: true,
          quadCount: c.quadCount,
          cpuActiveBytes: c.expected.vertexCount * 24,
        });
        expect(packet.cameraBits).toEqual(c.expectedPacketCameraBits);
        expect(packet.projectionBits).toEqual(defaultReference.TaskProjectionBits);
        expect(packet.viewport).toEqual(defaultReference.viewport);
        expect(frame.taskCameraBits).toEqual(defaultReference.TaskCameraBits);
        expect(frame.taskProjectionBits).toEqual(defaultReference.TaskProjectionBits);
        expect(packet.cpuCapacityBytes).toBeGreaterThanOrEqual(packet.cpuActiveBytes);
        expect(frame.indexed).toEqual([[4, c.expected.indexCount, 5123, 0]]);
        const vertices = frame.uploads.filter((x) => x.target === 34962);
        const indices = frame.uploads.filter((x) => x.target === 34963);
        expect(vertices).toHaveLength(1);
        expect(indices).toHaveLength(1);
        expect(vertices[0]).toMatchObject({
          storage: 'Float32Array',
          srcOffset: 0,
          activeElements: c.expected.vertexCount * 10,
          activeBytes: c.expected.vertexCount * 40,
        });
        expect(indices[0]).toMatchObject({
          storage: 'Uint16Array',
          srcOffset: 0,
          activeElements: c.expected.indexCount,
          activeBytes: c.expected.indexCount * 2,
        });
        expect(vertices[0].capacityBytes).toBeGreaterThanOrEqual(vertices[0].activeBytes);
        expect(indices[0].capacityBytes).toBeGreaterThanOrEqual(indices[0].activeBytes);
        expect(
          frame.physicalRestored && frame.logicalStatesRestored && frame.targetDepthShared,
        ).toBe(true);
        const rgba = Buffer.from(frame.rgba);
        expect(digest(rgba)).toBe(c.RGBASHA256);
        expect(rgba).toEqual(expected);
        let changed = 0;
        for (let i = 0; i < rgba.length; i += 4)
          if (!rgba.subarray(i, i + 4).equals(Buffer.from(defaultReference.clearRGBA))) changed++;
        expect(changed).toBe(c.changedPixels);
      }
      expect(actual.restored.rgba).toEqual(actual.original.rgba);
      expect(actual.restored.frame).toBe(actual.original.frame);
    },
  );
}
