// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { glBindingRecorder } from './fixtures/gl-binding-recorder.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NativeGraphicTask } from '../src/native/graphics.mjs';
import { NativeTexturePages } from '../src/native/texture-layout.mjs';
import { NativeTextTask, NativeNVTextTask } from '../src/native/text-task.mjs';
import { floatBits } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76',
  filename = 'assets.int/texture-caps.fes',
  ascii = (text) => new TextEncoder().encode(text);

// This API recorder has no rasterizer. Only explicit byte uploads are readable;
// draw/clear/copy invalidate knowledge instead of pretending their pixels are zero.
function recordedGL(maximum, queries, memory) {
  const api = glBindingRecorder(),
    gl = api.gl,
    known = new WeakMap(),
    colorTarget = () => api.state.drawFramebuffer?.attachments.get(gl.COLOR_ATTACHMENT0),
    invalidate = () => {
      const texture = colorTarget();
      if (texture) known.delete(texture);
    };
  return new Proxy(gl, {
    get(target, key) {
      if (key === 'getParameter')
        return (name) => {
          if (name === gl.MAX_TEXTURE_SIZE) {
            queries.push(maximum);
            return maximum;
          }
          return gl.getParameter(name);
        };
      if (key === 'texImage2D')
        return (...args) => {
          gl.texImage2D(...args);
          const texture = api.state.textures[api.state.activeUnit];
          known.delete(texture);
          if (args.length === 9 && ArrayBuffer.isView(args[8])) {
            assert.equal(args[0], gl.TEXTURE_2D);
            assert.equal(args[1], 0);
            assert.equal(args[2], gl.RGBA);
            assert.equal(args[5], 0);
            assert.equal(args[6], gl.RGBA);
            assert.equal(args[7], gl.UNSIGNED_BYTE);
            assert.equal(args[8].byteLength, args[3] * args[4] * 4);
            known.set(
              texture,
              new Uint8Array(args[8].buffer, args[8].byteOffset, args[8].byteLength).slice(),
            );
          }
        };
      if (key === 'texSubImage2D')
        return (kind, level, x, y, width, height, format, type, bytes, offset) => {
          const texture = api.state.textures[api.state.activeUnit];
          assert.ok(gl.isTexture(texture));
          assert.equal(kind, gl.TEXTURE_2D);
          assert.equal(level, 0);
          assert.equal(x, 0);
          assert.equal(y, 0);
          assert.equal(width, texture.width);
          assert.equal(height, texture.height);
          assert.equal(format, gl.RGBA);
          assert.equal(type, gl.UNSIGNED_BYTE);
          assert.ok(bytes instanceof Uint8Array || bytes instanceof Uint8ClampedArray);
          assert.equal(bytes.byteLength, width * height * 4);
          assert.equal(offset, 0);
          assert.equal(gl.getParameter(gl.UNPACK_ROW_LENGTH), width);
          known.set(
            texture,
            new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice(),
          );
          memory.push({ operation: key, width, height, bytes: bytes.byteLength });
        };
      if (key === 'readPixels')
        return (x, y, width, height, format, type, bytes) => {
          const texture = api.state.readFramebuffer?.attachments.get(gl.COLOR_ATTACHMENT0),
            content = texture && known.get(texture);
          assert.ok(gl.isTexture(texture));
          assert.equal(x, 0);
          assert.equal(y, 0);
          assert.equal(width, texture.width);
          assert.equal(height, texture.height);
          assert.equal(format, gl.RGBA);
          assert.equal(type, gl.UNSIGNED_BYTE);
          assert.ok(bytes instanceof Uint8Array);
          assert.equal(bytes.byteLength, width * height * 4);
          assert.ok(
            content,
            'readback requires an explicit known upload; rendered pixels are unknown',
          );
          bytes.set(content);
          memory.push({
            operation: key,
            width,
            height,
            bytes: bytes.byteLength,
            allZero: content.every((value) => value === 0),
          });
        };
      if (key === 'drawArrays' || key === 'drawElements' || key === 'clear')
        return (...args) => {
          if (key !== 'clear' || args[0] & gl.COLOR_BUFFER_BIT) invalidate();
          return gl[key](...args);
        };
      if (key === 'copyTexImage2D')
        return (...args) => {
          gl.copyTexImage2D(...args);
          known.delete(api.state.textures[api.state.activeUnit]);
        };
      return Reflect.get(target, key);
    },
  });
}

const shared = (offset) => [0x13, (0x80000000 + offset) >>> 0],
  move = kcsProgram([
    [21, shared(MOTION_ABI.pos), [7, floatBits(1)]],
    [21, shared(MOTION_ABI.pos + 4), [7, floatBits(2)]],
    [43, 38, 0],
    [59],
  ]);

async function open({ size, maximum, sourceX, grid = [1, 1], profile: selectedProfile = profile }) {
  const scope = startupEnvironment(),
    queries = [],
    memory = [],
    Canvas = class extends StartupCanvas {
      getContext(type) {
        if (type !== 'webgl2') {
          const context = super.getContext(type);
          context.reset ??= () => {};
          context.drawImage ??= () => {};
          return context;
        }
        return (this.gl ??= recordedGL(maximum, queries, memory));
      }
    };
  let player;
  try {
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: Canvas });
    const source = ascii(`#MACRO
WIDTH 4
#DEFINE
PLANE texture
#OBJECT SIZE POS BASE VRAM PRI DISP
texture 4,2 8,9,0 0,0 ${sourceX},1 10 1
#START
texture size WIDTH 2
$50=++$50
wait 1
next IDLE
#IDLE
break
next IDLE
#SIZE
texture size 2 2
break
#DELETE
texture delete
break
`),
      template = await ordinaryStartupGame(selectedProfile, {
        sound: false,
        startup: `<TEXTURE><size><x>${size[0]}</x><y>${size[1]}</y></size>
<vt><x>${grid[0]}</x><y>${grid[1]}</y></vt><area00><sx>0</sx><sy>0</sy><dx>${grid[0]}</dx><dy>${grid[1]}</dy></area00>
<bpp32y>0</bpp32y><bpp16y>${grid[1]}</bpp16y></TEXTURE>`,
        files: { 'assets/texture-caps.fes': source, 'motions/move.kcs': move },
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>' +
          '<int03><name>mot</name><int>motions.int</int><ext>kcs</ext><dir>motions</dir></int03>',
      ),
      bytes = new Uint8Array(startup.length + mount.length);
    assert.ok(at >= 0);
    bytes.set(startup.subarray(0, at));
    bytes.set(mount, at);
    bytes.set(startup.subarray(at), at + mount.length);
    const input = new Map(template.input);
    input.set('startup.xml', new BlobFile(new Blob([bytes])));
    const game = new GameFiles(input);
    await game.open();
    const options = {
      game,
      nativeProfile: selectedProfile,
      canvas: new Canvas(),
      randomSeed: 77,
      audioContext: { currentTime: 0, close: async () => {} },
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          throw new Error('Texture caps must use the default implementation');
        },
      },
    };
    player = new CatSystem2(options);
    await player.initialize();
    const world = player.world,
      parent = world.main,
      words = world.runtime.variableBank(parent, false);
    assert.equal(world.frame, 1);
    assert.equal(words.get(7), 0x12345678, 'actual ENTRY startup completed');
    assert.equal(words.capacity, 64);
    assert.ok([50].every((index) => index >= 0 && index < words.capacity));
    world.runtime.stringBank(parent);
    const id = await world.objects.create({ kind: 34, parent: parent.id }),
      surface = await world.objects.create({ kind: 15, parent: parent.id });
    await world.sendEngine(surface, parent.id, 279, 64, 48);
    await world.sendEngine(surface, parent.id, 283);
    await world.sendEngine(id, parent.id, 331, 0, parent.context.variableBank);
    await world.sendEngine(id, parent.id, 334, 0, world.nativeTaskID(surface));
    await world.sendEngine(id, parent.id, 332, 0, 0, { payload: { string: () => filename } });
    const task = world.objects.objects.get(id).implementation;
    assert.ok(task.player.root.runtime instanceof FESCoordinator);
    await world.sendEngine(id, parent.id, 333);
    const instance = task.player.root,
      object = instance.collection.lookup('texture', 0),
      plane = world.graphics.get(object.nativeTaskID);
    assert.equal(object.nativeType, 4);
    assert.equal(world.objects.objects.get(object.nativeTaskID).kind, 2);
    assert.equal(plane.graph.type, 1);
    assert.equal(plane.graph.vram, true);
    assert.notStrictEqual(plane.graph.kx2, plane.graph.textureTransform);
    assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.pos), [8, 9, 0]);
    assert.deepEqual(motionVector(plane.graph.textureTransform, MOTION_ABI.pos), [sourceX, 1, 0]);
    assert.equal(words.get(50), 1);
    return {
      player,
      world,
      options,
      Canvas,
      scope,
      queries,
      memory,
      id,
      instance,
      object,
      plane,
      words,
      async close() {
        try {
          await player.dispose();
        } finally {
          scope.restore();
        }
      },
    };
  } catch (error) {
    try {
      await player?.dispose();
    } finally {
      scope.restore();
    }
    throw error;
  }
}

const empty = [0, 0, 0, 0],
  initial = [7, 8, 12, 11],
  clipped = [7, 8, 10, 11],
  vector = (values) => new NativeGraphicsPacket(values.map(floatBits)),
  send = (h, task, id, w = 0, l = 0, payload = null) =>
    h.world.sendEngine(task.record.id, h.id, id, w, l, payload ? { payload } : {}),
  openCase = (selectedProfile = profile) =>
    open({ size: [8, 8], maximum: 4096, sourceX: 2, profile: selectedProfile }),
  notify = (h, label) =>
    h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
      payload: fesLabelPayload(() => label),
    });

function presentation(h) {
  const stage = h.world.stageRenderer,
    gpu = h.world.getNativeGPU(),
    present = stage.presentNative.bind(stage),
    draw = stage.drawItem.bind(stage),
    geometry = gpu.drawGeometry,
    texturePages = gpu.drawTexturePages,
    requests = [],
    draws = [];
  let status = 0,
    currentFrame = 0,
    active;
  stage.drawItem = async (...args) => {
    const before = active;
    active = args[2].p?.nativeTaskWorldID;
    try {
      return await draw(...args);
    } finally {
      active = before;
    }
  };
  const record = (items) => {
    if (active !== undefined)
      draws.push({ recordID: active, frame: currentFrame, geometry: structuredClone(items) });
  };
  gpu.drawGeometry = function (items, frame, options) {
    record(items);
    return geometry.call(this, items, frame, options);
  };
  gpu.drawTexturePages = function (pages, options) {
    for (const { triangles } of pages) record(triangles);
    return texturePages.call(this, pages, options);
  };
  stage.presentNative = (request) => {
    requests.push({
      dirtyRectangle: [...request.dirtyRectangle],
      dirtyQueryGates: request.dirtyQueryGates?.map((gate) => ({ ...gate })),
    });
    assert.equal(present(request), 0, 'the original full present executed');
    return status;
  };
  return {
    requests,
    draws,
    status(value) {
      status = value;
    },
    async render() {
      currentFrame++;
      return stage.render(h.world.graphics.stage);
    },
    geometry(task) {
      return draws
        .filter((item) => item.recordID === task.record.id && item.frame === currentFrame)
        .flatMap((item) => item.geometry);
    },
  };
}
function expectedClipped() {
  const z = Math.fround(64990 * Math.fround(1 / 65000)),
    v = (x, y) => ({
      x: 7.5 + x,
      y: 8.5 + y,
      z,
      w: 1,
      color: 0xffffffff,
      u: (6 + x) / 8,
      v: (1 + y) / 8,
    });
  return [
    [v(0, 0), v(2, 0), v(2, 1)],
    [v(0, 0), v(2, 1), v(2, 2)],
    [v(0, 0), v(2, 2), v(0, 2)],
  ].map((vertices) => ({ textureID: 0, vertices }));
}
function queryWithoutReplay(h, rendering) {
  const runtime = h.instance.runtime.snapshot(),
    rng = h.world.random.snapshot(),
    frame = h.world.frame,
    queries = h.queries.length,
    result = rendering.collectDirty();
  assert.deepEqual(h.instance.runtime.snapshot(), runtime);
  assert.deepEqual(h.world.random.snapshot(), rng);
  assert.equal(h.world.frame, frame);
  assert.equal(h.queries.length, queries, 'query cannot initialize or recapture texture caps');
  return result;
}

for (const [name, selectedProfile] of [
  ['Game', profile],
  ['SDK', 'sdk-4.01-engine-2.6.1.74'],
])
  test(`${name} ordinary PLANE query clears source dirtiness while derived bounds wait for a successful present`, async () => {
    const h = await openCase(selectedProfile),
      p = presentation(h),
      t = h.plane,
      g = t.graph,
      r = h.world.screenEffects.rendering;
    try {
      await p.render();
      // First semantic red is missing actual presentation damage, not a new field.
      assert.deepEqual(p.requests.at(-1).dirtyRectangle, initial);
      assert.deepEqual(g.cachedBounds, initial);
      assert.equal(g.sourceBoundsDirty, false);
      assert.equal(g.boundsDirty, false);
      assert.equal(p.geometry(t).length, 2);
      const presentations = p.requests.length,
        draws = p.draws.length;
      await p.render();
      assert.equal(p.requests.length, presentations + 1);
      assert.ok(p.draws.length > draws, 'page-only gate keeps real drawing and full presentation');
      assert.deepEqual(p.requests.at(-1).dirtyQueryGates, []);
      assert.equal(Object.hasOwn(t.snapshot().graph, 'boundsGate'), false);
      assert.equal(Object.hasOwn(t.snapshot().graph, 'dirtyQueryGates'), false);
      assert.deepEqual([...r.dirtyPrevious], empty);

      await send(h, t, 59, 1, 0xffffffff);
      assert.equal(g.sourceBoundsDirty, false);
      assert.equal(
        g.boundsDirty,
        true,
        'native color setter marks derived even for identical inputs',
      );
      assert.deepEqual(queryWithoutReplay(h, r), initial);
      await p.render();
      await p.render();
      assert.deepEqual([...r.dirtyPrevious], empty);

      await send(h, t, 51, 1, 0, vector([6, 1, 0]));
      assert.equal(g.sourceBoundsDirty, true);
      assert.equal(g.boundsDirty, false);
      assert.deepEqual(queryWithoutReplay(h, r), initial);
      assert.equal(g.sourceBoundsDirty, false, 'query clears source immediately');
      assert.equal(g.boundsDirty, true, 'query only promotes derived');
      assert.deepEqual(g.cachedBounds, clipped);
      assert.deepEqual(queryWithoutReplay(h, r), initial);
      p.status(-1);
      await p.render();
      assert.deepEqual(p.geometry(t), expectedClipped());
      assert.deepEqual(p.requests.at(-1).dirtyRectangle, initial);
      assert.deepEqual([...r.dirtyCurrent], initial);
      assert.deepEqual(g.cachedBounds, clipped);
      assert.equal(g.boundsDirty, true);
      const paused = { requests: p.requests.length, draws: p.draws.length, state: t.snapshot() };
      h.world.graphics.view.configure({ paused: true });
      await p.render();
      assert.equal(p.requests.length, paused.requests);
      assert.equal(p.draws.length, paused.draws);
      assert.deepEqual(t.snapshot(), paused.state);
      h.world.graphics.view.configure({ paused: false });
      p.status(0);
      await p.render();
      assert.equal(g.sourceBoundsDirty, false);
      assert.equal(g.boundsDirty, false);
      assert.deepEqual(g.cachedBounds, clipped);
      assert.deepEqual([...r.dirtyCurrent], empty);
      assert.deepEqual([...r.dirtyPrevious], initial);

      await send(h, t, 51, 0, 0, vector([8, 9, 1]));
      const count = p.requests.length;
      await p.render();
      assert.equal(p.requests.length, count + 1);
      assert.equal(
        p.geometry(t).length,
        3,
        'unreviewed 3D still executes the actual complete draw',
      );
      assert.ok(
        p.requests
          .at(-1)
          .dirtyQueryGates.some(
            (gate) => gate.recordID === t.record.id && gate.reason === 'geometry-domain-unreviewed',
          ),
      );
      assert.deepEqual(g.cachedBounds, clipped, 'unproved geometry cannot overwrite FC');
      assert.equal(g.boundsDirty, false, 'successful present still retires selected derived F8');
      assert.notStrictEqual(g.textureTransform, g.kx2);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.close();
    }
  });

test('Game ordinary PLANE color and lifecycle changes preserve separate bounds owners across fresh restore', async (testContext) => {
  const h = await openCase(),
    p = presentation(h),
    t = h.plane,
    g = t.graph,
    r = h.world.screenEffects.rendering;
  let fresh;
  try {
    // The second red also reaches the original real query result first.
    assert.deepEqual(queryWithoutReplay(h, r), initial);
    assert.deepEqual(g.cachedBounds, initial);
    await h.instance.runtime.motions.add(h.object, 'move');
    await h.world.sendEngine(h.id, h.world.main.id, 333);
    assert.deepEqual(motionVector(g.kx2, MOTION_ABI.pos), [1, 2, 0]);
    assert.equal(
      h.instance.runtime.motions.busy(h.object),
      false,
      'actual finite MOT exited through native38',
    );
    const prepare = r.prepareModels;
    r.prepareModels = async function () {
      await prepare.call(this);
      throw new Error('authored preparation failure');
    };
    try {
      await assert.rejects(p.render(), /authored preparation failure/);
    } finally {
      r.prepareModels = prepare;
      if (h.world.getNativeGPU().drawing) h.world.getNativeGPU().endNativeFrame();
    }
    assert.equal(p.requests.length, 0);
    assert.deepEqual(g.cachedBounds, [0, 1, 5, 4]);
    assert.equal(g.sourceBoundsDirty, false);
    assert.equal(g.boundsDirty, true);
    assert.deepEqual([...r.dirtyCurrent], [0, 1, 12, 11]);
    assert.deepEqual([...r.dirtyPrevious], empty);
    assert.equal(r.busy, 0);
    assert.equal(r.frame, null);
    assert.equal(
      h.world.stageRenderer.frameDepth,
      null,
      'preparation failure occurs before creating a depth target',
    );
    const gpu = h.world.getNativeGPU(),
      { width, height } = gpu.primaryTarget;
    gpu.uploadRenderTarget(gpu.primaryTarget, {
      width,
      height,
      rgba: new Uint8Array(width * height * 4),
    });
    assert.equal(Object.hasOwn(r.snapshot(), 'dirtyQueryGates'), false);
    const state = t.snapshot(),
      runtime = h.instance.runtime.snapshot(),
      rng = h.world.random.snapshot(),
      sources = h.world.fesSources.snapshot(),
      checkpoint = await h.player.snapshot();
    let restoring = true;
    for (const [prototype, method] of [
      [FESInstance.prototype, 'execute'],
      [FESInstance.prototype, 'expandMacros'],
      [FESCoordinator.prototype, 'initialize'],
      [NativeStringBank.prototype, 'expandBytes'],
      [NativeScriptReplacements.prototype, 'apply'],
      [Object.getPrototypeOf(r), 'collectDirty'],
    ]) {
      const original = prototype[method];
      testContext.mock.method(prototype, method, function (...args) {
        assert.equal(restoring, false, 'fresh cannot replay ' + method);
        return original.apply(this, args);
      });
    }
    const file = h.world.game.lookup(filename).file,
      read = file.read;
    testContext.mock.method(file, 'read', function (...args) {
      assert.equal(restoring, false, 'fresh cannot reopen the source');
      return read.apply(this, args);
    });
    fresh = new CatSystem2({ ...h.options, canvas: new h.Canvas() });
    try {
      await fresh.initialize({ checkpoint });
    } finally {
      restoring = false;
    }
    const f = { ...h, world: fresh.world, player: fresh },
      restoredTask = f.world.graphics.get(t.record.id),
      instance = f.world.objects.objects.get(h.id).implementation.player.root,
      rr = f.world.screenEffects.rendering,
      pp = presentation(f),
      gg = restoredTask.graph;
    f.instance = instance;
    assert.deepEqual(restoredTask.snapshot(), state);
    assert.notStrictEqual(gg.kx2, gg.textureTransform);
    assert.notStrictEqual(gg.cachedBounds, state.graph.cachedBounds);
    assert.deepEqual(
      rr.dirtyQueryGates,
      [],
      'transient diagnostics are recomputed, never restored',
    );
    assert.deepEqual([...rr.dirtyCurrent], [0, 1, 12, 11]);
    assert.deepEqual(instance.runtime.snapshot(), runtime);
    assert.deepEqual(f.world.fesSources.snapshot(), sources);
    assert.deepEqual(f.world.random.snapshot(), rng);
    await pp.render();
    assert.equal(pp.geometry(restoredTask).length, 2);
    assert.equal(gg.sourceBoundsDirty, false);
    assert.equal(gg.boundsDirty, false);
    assert.deepEqual(gg.cachedBounds, [0, 1, 5, 4]);
    assert.deepEqual(instance.runtime.snapshot(), runtime);
    await pp.render();
    assert.deepEqual(pp.requests.at(-1).dirtyQueryGates, []);
    assert.deepEqual([...rr.dirtyPrevious], empty);
    await send(f, restoredTask, 59, 1, 0xffffffff);
    assert.equal(gg.boundsDirty, true);
    assert.equal(gg.sourceBoundsDirty, false);
    await pp.render();
    await pp.render();

    const collect = rr.collectDirty,
      flags = [];
    rr.collectDirty = function () {
      flags.push(gg.registrationEnabled);
      return collect.call(this);
    };
    await send(f, restoredTask, 47, 0, 0);
    await send(f, restoredTask, 47, 0, 0);
    assert.deepEqual(flags, [true], 'same enable flag does not query again');
    await send(f, restoredTask, 51, 1, 0, vector([6, 1, 0]));
    assert.equal(gg.sourceBoundsDirty, true);
    await pp.render();
    assert.equal(
      gg.sourceBoundsDirty,
      true,
      'disabled source is not cleared by successful present',
    );
    assert.equal(gg.boundsDirty, false, 'success retires derived regardless of enabled');
    await send(f, restoredTask, 47, 0, 1);
    assert.equal(flags.at(-1), false);
    assert.equal(gg.sourceBoundsDirty, true);
    queryWithoutReplay(f, rr);
    assert.equal(gg.sourceBoundsDirty, false);
    assert.deepEqual(gg.cachedBounds, [0, 1, 3, 4]);
    rr.collectDirty = collect;
    await pp.render();
    await pp.render();
    await send(f, restoredTask, 68);
    assert.equal(restoredTask.graph, null);
    assert.equal(gg.registrationEnabled, false);
    assert.deepEqual([...rr.dirtyCurrent], [0, 1, 3, 4]);
    await pp.render();
    await pp.render();

    const shape = (w, h) =>
      new NativeGraphicsPacket([0, 0, 0, floatBits(w), floatBits(h), 4, 1, 0xffffffff]);
    await send(f, restoredTask, 41, 0, 0, shape(4, 2));
    await send(f, restoredTask, 47, 0, 1);
    await send(f, restoredTask, 81, 0, 1);
    await pp.render();
    await pp.render();
    const beforeReplace = restoredTask.graph,
      trailOwner = restoredTask.trail;
    assert.deepEqual(beforeReplace.cachedBounds, [0, 0, 4, 2]);
    await send(f, restoredTask, 41, 0, 0, shape(3, 1));
    assert.equal(beforeReplace.registrationEnabled, false);
    assert.deepEqual([...rr.dirtyCurrent], [0, 0, 4, 2]);
    assert.strictEqual(restoredTask.trail, trailOwner, '41 does not add unload side effects');
    assert.equal(restoredTask.graph.style.blendMode, 1);
    assert.equal(restoredTask.graph.registrationEnabled, false);
    assert.deepEqual(restoredTask.graph.cachedBounds, empty);
    await send(f, restoredTask, 47, 0, 1);
    await pp.render();
    await pp.render();
    assert.deepEqual(restoredTask.graph.cachedBounds, [0, 0, 3, 1]);

    await notify(f, 'SIZE');
    assert.equal(restoredTask.graph, null);
    let next = f.world.graphics.get(instance.collection.lookup('texture', 0).nativeTaskID);
    assert.notEqual(next.record.id, restoredTask.record.id);
    assert.equal(next.graph.registrationEnabled, false);
    assert.equal(next.graph.sourceBoundsDirty, false);
    // SIZE sends41 then51,w0 for PLANE; that position writer marks derived F8, without59.
    assert.equal(next.graph.boundsDirty, true);
    assert.deepEqual(next.graph.cachedBounds, empty);
    assert.deepEqual([...rr.dirtyCurrent], [0, 0, 3, 1]);
    await send(f, next, 51, 0, 0, vector([4, 5, 0]));
    await send(f, next, 51, 1, 0, vector([2, 1, 0]));
    await send(f, next, 47, 0, 1);
    await pp.render();
    await pp.render();
    assert.deepEqual(next.graph.cachedBounds, [3, 4, 6, 7]);
    const erased = next.graph;
    await notify(f, 'DELETE');
    assert.equal(instance.collection.lookup('texture', 0), null);
    assert.equal(erased.registrationEnabled, false);
    assert.equal(next.graph, null);
    assert.deepEqual([...rr.dirtyCurrent], [3, 4, 6, 7]);
    assert.equal(f.world.runtime.variableBank(f.world.main, false).get(50), 1);
    assert.deepEqual(f.world.random.snapshot(), rng);
    assert.equal(f.world.nativeEngine, undefined);
  } finally {
    await fresh?.dispose();
    await h.close();
  }
});

function assertTextModelUnreviewed(task) {
  assert.ok(task instanceof NativeTextTask);
  assert.ok(task.plane instanceof NativeGraphicTask);
  assert.notStrictEqual(task.plane, task);
  assert.strictEqual(task.graphics.tasks.get(task.record.id), task);
  if (task.graph) {
    assert.equal(task.graph.type, 1);
    assert.equal(task.graph.vram, true);
    for (const field of ['boundsDirty', 'sourceBoundsDirty', 'cachedBounds'])
      assert.equal(Object.hasOwn(task.graph, field), false, 'text does not acquire ' + field);
  }
}

async function textCommonGraph(h, task, position) {
  await send(
    h,
    task,
    41,
    0,
    0,
    new NativeGraphicsPacket([0, 0, 0, floatBits(2), floatBits(2), 4, 1, 0xffffffff]),
  );
  await send(h, task, 51, 0, 0, vector(position));
  await send(h, task, 51, 1, 0, vector([0, 0, 0]));
  await send(h, task, 59, 1, 0xffffffff);
  // Common48 propagates display to the real composed plane. Text47 requires
  // a writer output; this case exercises the common graph, not glyph rendering.
  await send(h, task, 48, 0, 1);
  assert.equal(task.graph.registrationEnabled, true);
}

for (const [name, selectedProfile] of [
  ['Game', profile],
  ['SDK', 'sdk-4.01-engine-2.6.1.74'],
])
  test(`${name} mixed STRING and NVSTRING tasks keep ordinary PLANE bounds ownership separate`, async (testContext) => {
    const h = await open({ size: [8, 8], maximum: 4096, sourceX: 2, profile: selectedProfile });
    let fresh;
    try {
      const textIDs = [];
      for (const kind of [48, 49])
        textIDs.push(await h.world.objects.create({ kind, parent: h.world.main.id }));
      const string = h.world.graphics.get(textIDs[0]),
        nv = h.world.graphics.get(textIDs[1]),
        r = h.world.screenEffects.rendering;
      assert.ok(string instanceof NativeTextTask);
      assert.ok(nv instanceof NativeNVTextTask);
      assert.equal(string.graph, null);
      assert.equal(nv.graph, null);
      await textCommonGraph(h, nv, [2, 3, 0]);
      // R0 fails at the actual enabled-text collect branch, before any new
      // owner-field expectations or checkpoint assertions can conceal it.
      queryWithoutReplay(h, r);
      assertTextModelUnreviewed(nv);
      assertTextModelUnreviewed(string);
      assert.equal(nv.text.writer, null);
      assert.equal(string.text.writer, null);
      assert.deepEqual(
        r.dirtyQueryGates.filter((gate) => textIDs.includes(gate.recordID)),
        [{ recordID: nv.record.id, reason: 'textured-query-unreviewed' }],
      );
      assert.equal(h.world.stageRenderer.frameDepth, null);
      const gpu = h.world.getNativeGPU(),
        { width, height } = gpu.primaryTarget;
      // Known blank backing is only an API checkpoint contract; no raster
      // pixels are inferred, and the real fresh draw/present happens below.
      gpu.uploadRenderTarget(gpu.primaryTarget, {
        width,
        height,
        rgba: new Uint8Array(width * height * 4),
      });
      const before = [string.snapshot(), nv.snapshot()],
        planeBefore = h.plane.snapshot(),
        runtime = h.instance.runtime.snapshot(),
        sources = h.world.fesSources.snapshot(),
        rng = h.world.random.snapshot(),
        checkpoint = await h.player.snapshot();
      let restoring = true;
      for (const [prototype, method] of [
        [FESInstance.prototype, 'execute'],
        [FESInstance.prototype, 'expandMacros'],
        [FESCoordinator.prototype, 'initialize'],
        [NativeStringBank.prototype, 'expandBytes'],
        [NativeScriptReplacements.prototype, 'apply'],
        [Object.getPrototypeOf(r), 'collectDirty'],
      ]) {
        const original = prototype[method];
        testContext.mock.method(prototype, method, function (...args) {
          assert.equal(restoring, false, 'mixed fresh cannot replay ' + method);
          return original.apply(this, args);
        });
      }
      const file = h.world.game.lookup(filename).file,
        read = file.read;
      testContext.mock.method(file, 'read', function (...args) {
        assert.equal(restoring, false, 'mixed fresh cannot reopen the source');
        return read.apply(this, args);
      });
      fresh = new CatSystem2({ ...h.options, canvas: new h.Canvas() });
      try {
        await fresh.initialize({ checkpoint });
      } finally {
        restoring = false;
      }
      const f = { ...h, world: fresh.world, player: fresh },
        restored = textIDs.map((id) => f.world.graphics.get(id)),
        restoredPlane = f.world.graphics.get(h.plane.record.id),
        rr = f.world.screenEffects.rendering,
        pp = presentation(f);
      f.instance = f.world.objects.objects.get(h.id).implementation.player.root;
      assert.deepEqual(
        restored.map((task) => task.snapshot()),
        before,
      );
      assert.deepEqual(restoredPlane.snapshot(), planeBefore);
      assert.equal(restored[0].graph, null);
      assert.equal(restored[1].graph.registrationEnabled, true);
      restored.forEach(assertTextModelUnreviewed);
      assert.deepEqual(rr.dirtyQueryGates, []);
      assert.deepEqual(f.instance.runtime.snapshot(), runtime);
      assert.deepEqual(f.world.fesSources.snapshot(), sources);
      assert.deepEqual(f.world.random.snapshot(), rng);
      // Success visits both the graph-absent STRING and enabled NVSTRING in
      // the heterogeneous tasks map, while still drawing the ordinary PLANE.
      await pp.render();
      assert.equal(pp.requests.length, 1);
      assert.equal(pp.geometry(restoredPlane).length, 2);
      assert.equal(pp.geometry(restored[1]).length, 2);
      assert.deepEqual(
        restored.map((task) => task.snapshot()),
        before,
      );
      assert.equal(restoredPlane.graph.sourceBoundsDirty, false);
      assert.equal(restoredPlane.graph.boundsDirty, false);
      assert.deepEqual(restoredPlane.graph.cachedBounds, initial);
      await textCommonGraph(f, restored[0], [5, 6, 0]);
      const textBefore = restored.map((task) => task.snapshot());
      queryWithoutReplay(f, rr);
      assert.deepEqual(
        rr.dirtyQueryGates.filter((gate) => textIDs.includes(gate.recordID)),
        textIDs.map((recordID) => ({ recordID, reason: 'textured-query-unreviewed' })),
      );
      await pp.render();
      assert.equal(pp.requests.length, 2);
      for (const task of restored) {
        assertTextModelUnreviewed(task);
        assert.equal(pp.geometry(task).length, 2);
      }
      assert.deepEqual(
        restored.map((task) => task.snapshot()),
        textBefore,
      );
      assert.deepEqual(f.instance.runtime.snapshot(), runtime);
      assert.deepEqual(f.world.fesSources.snapshot(), sources);
      assert.deepEqual(f.world.random.snapshot(), rng);
      assert.equal(f.world.runtime.variableBank(f.world.main, false).get(50), 1);
      assert.equal(f.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });

const pageCase = (selectedProfile = profile) =>
    open({ size: [8, 8], maximum: 4096, sourceX: 6, grid: [3, 1], profile: selectedProfile }),
  pageZeroBounds = [7, 8, 10, 11],
  pageOneBounds = [9, 8, 12, 11],
  mainNative = (h, id, args) =>
    h.world.runtime.native('main', id, args, h.world.main.machine, h.world.main),
  clearPage = (h, index, id = 0x75) => mainNative(h, id, [0, index * 8, 1, 1, 1, 0]);

test('Game ordinary PLANE page-only bounds select dirty pages without changing model FC', async (testContext) => {
  const h = await pageCase(),
    p = presentation(h),
    t = h.plane,
    g = t.graph,
    pages = h.world.graphics.texturePages,
    r = h.world.screenEffects.rendering;
  let bitmapHandle;
  try {
    await p.render();
    await p.render();
    assert.deepEqual(g.cachedBounds, initial);
    assert.equal(g.sourceBoundsDirty, false);
    assert.equal(g.boundsDirty, false);
    const queryPage = testContext.mock.method(pages, 'isDirty');
    assert.deepEqual(queryWithoutReplay(h, r), empty);
    assert.equal(queryPage.mock.callCount(), 0, 'clean pages need no per-triangle query');
    queryPage.mock.restore();
    await clearPage(h, 1);
    // First red observes the actual page query, before any new-state assertion.
    assert.deepEqual(queryWithoutReplay(h, r), pageOneBounds);
    assert.ok(pages.dirtyFlags instanceof Uint32Array);
    assert.deepEqual([...pages.dirtyFlags], [0, 1, 0]);
    assert.deepEqual(g.cachedBounds, initial, 'page-only query neither unions nor overwrites FC');
    assert.deepEqual(queryWithoutReplay(h, r), pageOneBounds);
    assert.deepEqual([...pages.dirtyFlags], [0, 1, 0], 'query does not consume page flags');
    await clearPage(h, 2, 0x2e0);
    assert.deepEqual([...pages.dirtyFlags], [0, 1, 1]);
    assert.deepEqual(
      queryWithoutReplay(h, r),
      pageOneBounds,
      'unused page contributes no triangle',
    );
    p.status(-1);
    await p.render();
    assert.deepEqual(p.requests.at(-1).dirtyRectangle, pageOneBounds);
    assert.ok(p.geometry(t).some((item) => item.textureID === 0));
    assert.ok(p.geometry(t).some((item) => item.textureID === 1));
    assert.deepEqual([...pages.dirtyFlags], [0, 1, 1]);
    assert.deepEqual(g.cachedBounds, initial);
    const paused = { requests: p.requests.length, draws: p.draws.length, graph: t.snapshot() };
    h.world.graphics.view.configure({ paused: true });
    await p.render();
    assert.equal(p.requests.length, paused.requests);
    assert.equal(p.draws.length, paused.draws);
    assert.deepEqual(t.snapshot(), paused.graph);
    assert.deepEqual([...pages.dirtyFlags], [0, 1, 1]);
    h.world.graphics.view.configure({ paused: false });
    p.status(0);
    await p.render();
    assert.deepEqual([...pages.dirtyFlags], [0, 0, 0], 'success clears the unused index too');
    await p.render();

    bitmapHandle = h.world.graphics.images.create(1, 1);
    const bitmap = h.world.graphics.images.get(bitmapHandle);
    await bitmap.fill(0, 0, 1, 1, 0xff123456);
    const rgba = pages.frame(0).rgba;
    const originalSet = testContext.mock.method(rgba, 'set', () => {
      throw new Error('authored page upload failure');
    });
    try {
      await assert.rejects(h.world.graphics.output(bitmap, [6, 1]), /authored page upload failure/);
    } finally {
      originalSet.mock.restore();
    }
    assert.deepEqual(
      [...pages.dirtyFlags],
      [1, 0, 0],
      'the real copy failure cannot roll back mark1',
    );
    assert.deepEqual(queryWithoutReplay(h, r), pageZeroBounds);
    await h.world.graphics.output(bitmap, [6, 1]);
    assert.deepEqual([...rgba.slice((8 + 6) * 4, (8 + 6) * 4 + 4)], [18, 52, 86, 255]);
    assert.deepEqual(g.cachedBounds, initial);
    assert.equal(g.boundsDirty, false);
    assert.equal(g.sourceBoundsDirty, false);
    await p.render();
    await p.render();
    const originalFill = testContext.mock.method(pages.frame(2).rgba, 'fill', () => {
      throw new Error('authored page clear failure');
    });
    try {
      await assert.rejects(clearPage(h, 2), /authored page clear failure/);
    } finally {
      originalFill.mock.restore();
    }
    assert.deepEqual([...pages.dirtyFlags], [0, 0, 1]);
    assert.deepEqual(queryWithoutReplay(h, r), empty);
    await mainNative(h, 0x75, [0, 0, 0, 0, 1, 0]);
    await mainNative(h, 0x75, [0, 40, 0, 1, 1, 0]);
    assert.deepEqual([...pages.dirtyFlags], [0, 0, 1]);
    await p.render();
    assert.deepEqual([...pages.dirtyFlags], [0, 0, 0]);
    assert.equal(h.words.get(50), 1);
    assert.equal(h.world.nativeEngine, undefined);
  } finally {
    if (bitmapHandle) await h.world.graphics.images.release(bitmapHandle);
    await h.close();
  }
});

for (const [name, selectedProfile] of [
  ['Game', profile],
  ['SDK', 'sdk-4.01-engine-2.6.1.74'],
])
  test(`${name} page flags survive release and fresh restore until successful whole-grid presentation`, async (testContext) => {
    // This first world really presents before exercising F8=false and release.
    const first = await pageCase(selectedProfile);
    try {
      const p = presentation(first),
        t = first.plane,
        pages = first.world.graphics.texturePages,
        r = first.world.screenEffects.rendering;
      await p.render();
      await p.render();
      await clearPage(first, 1);
      await mainNative(first, 0x21d, [8, 0, 8, 8]);
      assert.equal(pages.pages.has(1), false);
      // The second red also reaches a real query before checking the new field.
      assert.deepEqual(queryWithoutReplay(first, r), pageOneBounds);
      assert.deepEqual([...pages.dirtyFlags], [0, 1, 0]);
      assert.equal(t.graph.boundsDirty, false);
      assert.deepEqual(t.graph.cachedBounds, initial);
      await mainNative(first, 0x21e, []);
      assert.equal(pages.pages.has(1), true);
      assert.equal(pages.frame(1).revision, 0);
      assert.deepEqual([...pages.dirtyFlags], [0, 1, 0], 'allocation preserves the existing flag');
      await p.render();
      assert.deepEqual([...pages.dirtyFlags], [0, 0, 0]);
    } finally {
      await first.close();
    }

    // This independent ENTRY has not drawn: its real depth target is absent.
    // The recorder can checkpoint explicit blank upload bytes, not raster depth.
    const h = await pageCase(selectedProfile);
    let fresh;
    try {
      const pages = h.world.graphics.texturePages,
        t = h.plane,
        r = h.world.screenEffects.rendering,
        bitmapHandle = h.world.graphics.images.create(1, 1),
        bitmap = h.world.graphics.images.get(bitmapHandle);
      await bitmap.fill(0, 0, 1, 1, 0xff123456);
      await h.world.graphics.output(bitmap, [6, 1]);
      await h.world.graphics.images.release(bitmapHandle);
      await clearPage(h, 1);
      await clearPage(h, 2);
      await mainNative(h, 0x21d, [8, 0, 8, 8]);
      await h.instance.runtime.motions.add(h.object, 'move');
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.equal(h.instance.runtime.motions.busy(h.object), false);
      assert.deepEqual(motionVector(t.graph.kx2, MOTION_ABI.pos), [1, 2, 0]);
      queryWithoutReplay(h, r);
      assert.equal(t.graph.sourceBoundsDirty, false);
      assert.equal(t.graph.boundsDirty, true);
      assert.deepEqual(t.graph.cachedBounds, [0, 1, 5, 4]);
      assert.deepEqual([...pages.dirtyFlags], [1, 1, 1]);
      assert.equal(h.world.stageRenderer.frameDepth, null);
      const gpu = h.world.getNativeGPU(),
        { width, height } = gpu.primaryTarget;
      gpu.uploadRenderTarget(gpu.primaryTarget, {
        width,
        height,
        rgba: new Uint8Array(width * height * 4),
      });
      const savedPages = pages.snapshot(),
        savedTask = t.snapshot(),
        runtime = h.instance.runtime.snapshot(),
        sources = h.world.fesSources.snapshot(),
        rng = h.world.random.snapshot(),
        checkpoint = await h.player.snapshot();
      assert.notStrictEqual(savedPages.dirtyFlags, pages.dirtyFlags);
      let restoring = true;
      for (const [prototype, method] of [
        [FESInstance.prototype, 'execute'],
        [FESInstance.prototype, 'expandMacros'],
        [FESCoordinator.prototype, 'initialize'],
        [NativeStringBank.prototype, 'expandBytes'],
        [NativeScriptReplacements.prototype, 'apply'],
        [NativeTexturePages.prototype, 'upload'],
        [Object.getPrototypeOf(r), 'collectDirty'],
      ]) {
        const original = prototype[method];
        testContext.mock.method(prototype, method, function (...args) {
          assert.equal(restoring, false, 'page fresh cannot replay ' + method);
          return original.apply(this, args);
        });
      }
      const source = h.world.game.lookup(filename).file,
        read = source.read;
      testContext.mock.method(source, 'read', function (...args) {
        assert.equal(restoring, false, 'page fresh cannot reopen source');
        return read.apply(this, args);
      });
      fresh = new CatSystem2({ ...h.options, canvas: new h.Canvas() });
      try {
        await fresh.initialize({ checkpoint });
      } finally {
        restoring = false;
      }
      const f = { ...h, player: fresh, world: fresh.world },
        restoredPages = f.world.graphics.texturePages,
        restoredTask = f.world.graphics.get(t.record.id),
        pp = presentation(f);
      f.instance = f.world.objects.objects.get(h.id).implementation.player.root;
      assert.deepEqual(restoredPages.snapshot(), savedPages);
      assert.notStrictEqual(restoredPages.dirtyFlags, pages.dirtyFlags);
      assert.notStrictEqual(restoredPages.dirtyFlags, savedPages.dirtyFlags);
      assert.equal(restoredPages.pages.has(1), false);
      assert.deepEqual(restoredTask.snapshot(), savedTask);
      assert.deepEqual(f.instance.runtime.snapshot(), runtime);
      assert.deepEqual(f.world.fesSources.snapshot(), sources);
      assert.deepEqual(f.world.random.snapshot(), rng);
      assert.deepEqual(
        [...restoredPages.frame(0).rgba.slice((8 + 6) * 4, (8 + 6) * 4 + 4)],
        [18, 52, 86, 255],
      );
      assert.deepEqual([...restoredPages.dirtyFlags], [1, 1, 1]);
      queryWithoutReplay(f, f.world.screenEffects.rendering);
      assert.deepEqual([...restoredPages.dirtyFlags], [1, 1, 1]);
      await mainNative(f, 0x21e, []);
      assert.equal(restoredPages.pages.has(1), true);
      assert.equal(restoredPages.frame(1).revision, 0);
      assert.deepEqual([...restoredPages.dirtyFlags], [1, 1, 1]);
      await pp.render();
      assert.equal(pp.requests.length, 1);
      assert.ok(pp.geometry(restoredTask).some((item) => item.textureID === 0));
      assert.ok(pp.geometry(restoredTask).some((item) => item.textureID === 1));
      assert.deepEqual([...restoredPages.dirtyFlags], [0, 0, 0]);
      assert.equal(restoredTask.graph.sourceBoundsDirty, false);
      assert.equal(restoredTask.graph.boundsDirty, false);
      assert.deepEqual(restoredTask.graph.cachedBounds, savedTask.graph.cachedBounds);
      assert.deepEqual(f.instance.runtime.snapshot(), runtime);
      assert.deepEqual(f.world.fesSources.snapshot(), sources);
      assert.deepEqual(f.world.random.snapshot(), rng);
      assert.equal(f.world.runtime.variableBank(f.world.main, false).get(50), 1);
      assert.equal(f.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
