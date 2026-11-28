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

async function open({ size, maximum, sourceX, profile: selectedProfile = profile }) {
  const scope = startupEnvironment(),
    queries = [],
    memory = [],
    Canvas = class extends StartupCanvas {
      getContext(type) {
        if (type !== 'webgl2') return super.getContext(type);
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
`),
      template = await ordinaryStartupGame(selectedProfile, {
        sound: false,
        startup: `<TEXTURE><size><x>${size[0]}</x><y>${size[1]}</y></size>
<vt><x>1</x><y>1</y></vt><area00><sx>0</sx><sy>0</sy><dx>1</dx><dy>1</dy></area00>
<bpp32y>0</bpp32y><bpp16y>1</bpp16y></TEXTURE>`,
        files: { 'assets/texture-caps.fes': source },
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>',
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

async function draw(world, plane) {
  const gpu = world.getNativeGPU(),
    calls = [],
    original = gpu.drawTexturePages;
  gpu.drawTexturePages = function (pages, options) {
    for (const { triangles, frame } of pages)
      calls.push({ geometry: structuredClone(triangles), frame });
    return original.call(this, pages, options);
  };
  gpu.beginFrame();
  try {
    await plane.drawGPU(gpu);
  } finally {
    gpu.endFrame();
    gpu.drawTexturePages = original;
  }
  return calls;
}
function expected(sourceX, pageWidth) {
  const z = Math.fround(64990 * Math.fround(1 / 65000)),
    vertex = (x, y) => ({
      x: 7.5 + x,
      y: 8.5 + y,
      z,
      w: 1,
      color: 0xffffffff,
      u: Math.fround((sourceX + x) / pageWidth),
      v: (1 + y) / 8,
    });
  return [
    [vertex(0, 0), vertex(4, 0), vertex(4, 2)],
    [vertex(0, 0), vertex(4, 2), vertex(0, 2)],
  ];
}
function geometry(calls) {
  return calls
    .flatMap((call) => call.geometry)
    .map(({ textureID, vertices }) => ({ textureID, vertices }));
}

test('Game normal PLANE division uses the platform guard band across a source cell boundary', async () => {
  const h = await open({ size: [8, 8], maximum: 4096, sourceX: 2 });
  try {
    const before = h.instance.runtime.snapshot(),
      random = h.world.random.snapshot(),
      calls = await draw(h.world, h.plane),
      actual = geometry(calls);
    // This real draw assertion is the semantic red: old half-cells split the triangles.
    assert.deepEqual(
      actual,
      expected(2, 8).map((vertices) => ({ textureID: 0, vertices })),
    );
    assert.equal(calls.length, 1, 'adjacent triangles on one page share a submission');
    assert.equal(calls[0].frame, h.world.graphics.texturePages.frame(0));
    assert.deepEqual(h.world.graphics.texturePages.layout.textureCaps, {
      maximumTextureSize: 4096,
      guardBand: [-4096, -4096, 4096, 4096],
    });
    assert.deepEqual([...h.world.graphics.texturePages.layout.configurationSize], [8, 8]);
    assert.deepEqual(h.instance.runtime.snapshot(), before);
    assert.deepEqual(h.world.random.snapshot(), random);
    assert.equal(h.words.get(50), 1);
    assert.equal(h.world.nativeEngine, undefined);
  } finally {
    await h.close();
  }
});

test('Game normal PLANE clamps texture pages and preserves owned caps through a fresh checkpoint', async (t) => {
  const h = await open({ size: [8192, 8], maximum: 8192, sourceX: 4098 });
  let fresh;
  try {
    const initial = geometry(await draw(h.world, h.plane));
    // Old raw GL max produces page0. The registered virtual platform selects page1.
    assert.deepEqual(
      initial,
      expected(2, 4096).map((vertices) => ({ textureID: 1, vertices })),
    );
    const pages = h.world.graphics.texturePages,
      layout = pages.layout;
    assert.deepEqual([...layout.size], [4096, 8]);
    assert.deepEqual([...layout.configurationSize], [4096, 8]);
    assert.deepEqual([...layout.grid], [2, 1]);
    assert.deepEqual(layout.textureCaps, {
      maximumTextureSize: 4096,
      guardBand: [-4096, -4096, 4096, 4096],
    });
    // Configuration allocation is independent of max negotiation: explicitly allocate page1
    // through the existing 21E native after observing the real page-selection regression.
    h.world.configuration.fields.texture.areas[0].set([0, 0, 2, 1]);
    await h.world.runtime.native('main', 0x21e, [], h.world.main.machine, h.world.main);
    await h.world.graphics.fill(0, 0, 4096, 8, 0xff102030);
    await h.world.graphics.fill(4096, 0, 4096, 8, 0xff804020);
    const rendered = await draw(h.world, h.plane);
    assert.deepEqual(geometry(rendered), initial);
    assert.ok(rendered.every((call) => call.frame === pages.frame(1)));
    assert.deepEqual([...pages.frame(0).rgba.slice(0, 4)], [16, 32, 48, 255]);
    assert.deepEqual([...pages.frame(1).rgba.slice(0, 4)], [128, 64, 32, 255]);
    assert.equal(
      [...pages.pages.values()].reduce((total, page) => total + page.frame.rgba.byteLength, 0),
      262144,
    );
    const gpu = h.world.getNativeGPU(),
      { width, height } = gpu.primaryTarget;
    // Explicitly overwrite the primary target with a known blank API buffer before checkpoint.
    // This establishes only the recorder readback contract, never rasterized pixel correctness.
    gpu.uploadRenderTarget(gpu.primaryTarget, {
      width,
      height,
      rgba: new Uint8Array(width * height * 4),
    });
    const rng = h.world.random.snapshot(),
      runtime = h.instance.runtime.snapshot(),
      source = h.world.fesSources.snapshot(),
      checkpoint = await h.player.snapshot(),
      savedLayout = checkpoint.world.graphics.texturePages.layout,
      transforms = [h.plane.graph.kx2.slice(), h.plane.graph.textureTransform.slice()];
    assert.ok(h.memory.some((event) => event.operation === 'readPixels' && event.allZero));
    assert.deepEqual(savedLayout.textureCaps, layout.textureCaps);
    assert.notStrictEqual(savedLayout.textureCaps.guardBand, layout.textureCaps.guardBand);
    let restoring = true;
    for (const [prototype, method] of [
      [FESInstance.prototype, 'execute'],
      [FESInstance.prototype, 'expandMacros'],
      [FESCoordinator.prototype, 'initialize'],
      [NativeStringBank.prototype, 'expandBytes'],
      [NativeScriptReplacements.prototype, 'apply'],
    ]) {
      const original = prototype[method];
      t.mock.method(prototype, method, function (...args) {
        assert.equal(restoring, false, 'fresh must not replay ' + method);
        return original.apply(this, args);
      });
    }
    const file = h.world.game.lookup(filename).file,
      read = file.read;
    t.mock.method(file, 'read', function (...args) {
      assert.equal(restoring, false, 'fresh must not reopen FES source');
      return read.apply(this, args);
    });
    const queries = h.queries.length;
    const uploadsBeforeRestore = h.memory.filter(
      (event) => event.operation === 'texSubImage2D',
    ).length;
    fresh = new CatSystem2({ ...h.options, canvas: new h.Canvas() });
    try {
      await fresh.initialize({ checkpoint });
    } finally {
      restoring = false;
    }
    assert.equal(
      h.memory.filter((event) => event.operation === 'texSubImage2D').length,
      uploadsBeforeRestore + 1,
    );
    assert.equal(
      h.queries.length,
      queries,
      'fresh restores owned caps without querying GPU max again',
    );
    const w = fresh.world,
      task = w.objects.objects.get(h.id).implementation,
      object = task.player.root.collection.lookup('texture', 0),
      restored = w.graphics.get(object.nativeTaskID),
      restoredLayout = w.graphics.texturePages.layout;
    assert.deepEqual(restoredLayout, layout);
    assert.notStrictEqual(restoredLayout.textureCaps.guardBand, savedLayout.textureCaps.guardBand);
    assert.deepEqual([restored.graph.kx2, restored.graph.textureTransform], transforms);
    assert.notStrictEqual(restored.graph.kx2, restored.graph.textureTransform);
    assert.deepEqual(geometry(await draw(w, restored)), initial);
    assert.deepEqual([...w.graphics.texturePages.frame(1).rgba.slice(0, 4)], [128, 64, 32, 255]);
    assert.deepEqual(task.player.root.runtime.snapshot(), runtime);
    assert.deepEqual(w.fesSources.snapshot(), source);
    assert.deepEqual(w.random.snapshot(), rng);
    assert.equal(w.runtime.variableBank(w.main, false).get(50), 1);
    assert.equal(w.nativeEngine, undefined);
    layout.textureCaps.guardBand[0] = -2;
    assert.equal(
      restoredLayout.textureCaps.guardBand[0],
      -4096,
      'fresh owns independent cap bytes',
    );
  } finally {
    await fresh?.dispose();
    await h.close();
  }
});

test('SDK normal PLANE division uses the platform guard band across a source cell boundary', async () => {
  const h = await open({
    profile: 'sdk-4.01-engine-2.6.1.74',
    size: [8, 8],
    maximum: 4096,
    sourceX: 2,
  });
  try {
    assert.deepEqual(h.instance.collection.reference(h.object), {
      nameBytes: ascii('texture'),
      index: 0,
    });
    const before = h.instance.runtime.snapshot(),
      random = h.world.random.snapshot(),
      calls = await draw(h.world, h.plane),
      actual = geometry(calls);
    // This real draw assertion is the semantic red: old half-cells split the triangles.
    assert.deepEqual(
      actual,
      expected(2, 8).map((vertices) => ({ textureID: 0, vertices })),
    );
    assert.equal(calls.length, 1, 'adjacent triangles on one page share a submission');
    assert.equal(calls[0].frame, h.world.graphics.texturePages.frame(0));
    assert.deepEqual(h.world.graphics.texturePages.layout.textureCaps, {
      maximumTextureSize: 4096,
      guardBand: [-4096, -4096, 4096, 4096],
    });
    assert.deepEqual([...h.world.graphics.texturePages.layout.configurationSize], [8, 8]);
    assert.deepEqual(h.instance.runtime.snapshot(), before);
    assert.deepEqual(h.world.random.snapshot(), random);
    assert.equal(h.words.get(50), 1);
    assert.equal(h.world.nativeEngine, undefined);
  } finally {
    await h.close();
  }
});

test('SDK normal PLANE clamps texture pages and preserves owned caps through a fresh checkpoint', async (t) => {
  const h = await open({
    profile: 'sdk-4.01-engine-2.6.1.74',
    size: [8192, 8],
    maximum: 8192,
    sourceX: 4098,
  });
  let fresh;
  try {
    assert.deepEqual(h.instance.collection.reference(h.object), {
      nameBytes: ascii('texture'),
      index: 0,
    });
    const initial = geometry(await draw(h.world, h.plane));
    // Old raw GL max produces page0. The registered virtual platform selects page1.
    assert.deepEqual(
      initial,
      expected(2, 4096).map((vertices) => ({ textureID: 1, vertices })),
    );
    const pages = h.world.graphics.texturePages,
      layout = pages.layout;
    assert.deepEqual([...layout.size], [4096, 8]);
    assert.deepEqual([...layout.configurationSize], [4096, 8]);
    assert.deepEqual([...layout.grid], [2, 1]);
    assert.deepEqual(layout.textureCaps, {
      maximumTextureSize: 4096,
      guardBand: [-4096, -4096, 4096, 4096],
    });
    // Configuration allocation is independent of max negotiation: explicitly allocate page1
    // through the existing 21E native after observing the real page-selection regression.
    h.world.configuration.fields.texture.areas[0].set([0, 0, 2, 1]);
    await h.world.runtime.native('main', 0x21e, [], h.world.main.machine, h.world.main);
    await h.world.graphics.fill(0, 0, 4096, 8, 0xff102030);
    await h.world.graphics.fill(4096, 0, 4096, 8, 0xff804020);
    const rendered = await draw(h.world, h.plane);
    assert.deepEqual(geometry(rendered), initial);
    assert.ok(rendered.every((call) => call.frame === pages.frame(1)));
    assert.deepEqual([...pages.frame(0).rgba.slice(0, 4)], [16, 32, 48, 255]);
    assert.deepEqual([...pages.frame(1).rgba.slice(0, 4)], [128, 64, 32, 255]);
    assert.equal(
      [...pages.pages.values()].reduce((total, page) => total + page.frame.rgba.byteLength, 0),
      262144,
    );
    const gpu = h.world.getNativeGPU(),
      { width, height } = gpu.primaryTarget;
    // Explicitly overwrite the primary target with a known blank API buffer before checkpoint.
    // This establishes only the recorder readback contract, never rasterized pixel correctness.
    gpu.uploadRenderTarget(gpu.primaryTarget, {
      width,
      height,
      rgba: new Uint8Array(width * height * 4),
    });
    const rng = h.world.random.snapshot(),
      runtime = h.instance.runtime.snapshot(),
      source = h.world.fesSources.snapshot(),
      checkpoint = await h.player.snapshot(),
      savedLayout = checkpoint.world.graphics.texturePages.layout,
      transforms = [h.plane.graph.kx2.slice(), h.plane.graph.textureTransform.slice()];
    assert.ok(h.memory.some((event) => event.operation === 'readPixels' && event.allZero));
    assert.deepEqual(savedLayout.textureCaps, layout.textureCaps);
    assert.notStrictEqual(savedLayout.textureCaps.guardBand, layout.textureCaps.guardBand);
    let restoring = true;
    for (const [prototype, method] of [
      [FESInstance.prototype, 'execute'],
      [FESInstance.prototype, 'expandMacros'],
      [FESCoordinator.prototype, 'initialize'],
      [NativeStringBank.prototype, 'expandBytes'],
      [NativeScriptReplacements.prototype, 'apply'],
    ]) {
      const original = prototype[method];
      t.mock.method(prototype, method, function (...args) {
        assert.equal(restoring, false, 'fresh must not replay ' + method);
        return original.apply(this, args);
      });
    }
    const file = h.world.game.lookup(filename).file,
      read = file.read;
    t.mock.method(file, 'read', function (...args) {
      assert.equal(restoring, false, 'fresh must not reopen FES source');
      return read.apply(this, args);
    });
    const queries = h.queries.length;
    const uploadsBeforeRestore = h.memory.filter(
      (event) => event.operation === 'texSubImage2D',
    ).length;
    fresh = new CatSystem2({ ...h.options, canvas: new h.Canvas() });
    try {
      await fresh.initialize({ checkpoint });
    } finally {
      restoring = false;
    }
    assert.equal(
      h.memory.filter((event) => event.operation === 'texSubImage2D').length,
      uploadsBeforeRestore + 1,
    );
    assert.equal(
      h.queries.length,
      queries,
      'fresh restores owned caps without querying GPU max again',
    );
    const w = fresh.world,
      task = w.objects.objects.get(h.id).implementation,
      object = task.player.root.collection.lookup('texture', 0),
      restored = w.graphics.get(object.nativeTaskID),
      restoredLayout = w.graphics.texturePages.layout;
    assert.deepEqual(restoredLayout, layout);
    assert.notStrictEqual(restoredLayout.textureCaps.guardBand, savedLayout.textureCaps.guardBand);
    assert.deepEqual([restored.graph.kx2, restored.graph.textureTransform], transforms);
    assert.notStrictEqual(restored.graph.kx2, restored.graph.textureTransform);
    assert.deepEqual(geometry(await draw(w, restored)), initial);
    assert.deepEqual([...w.graphics.texturePages.frame(1).rgba.slice(0, 4)], [128, 64, 32, 255]);
    assert.deepEqual(task.player.root.runtime.snapshot(), runtime);
    assert.deepEqual(w.fesSources.snapshot(), source);
    assert.deepEqual(w.random.snapshot(), rng);
    assert.equal(w.runtime.variableBank(w.main, false).get(50), 1);
    assert.equal(w.nativeEngine, undefined);
    layout.textureCaps.guardBand[0] = -2;
    assert.equal(
      restoredLayout.textureCaps.guardBand[0],
      -4096,
      'fresh owns independent cap bytes',
    );
  } finally {
    await fresh?.dispose();
    await h.close();
  }
});
