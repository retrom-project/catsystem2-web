// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';

test('shared Stage device restores real resources without reviving undefined target contents', async ({
  page,
}) => {
  const blocked = [];
  await page.route('**/*', async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Device lifecycle</title>',
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
  const result = await page.evaluate(async () => {
    const [
      { NativeWorld },
      { NativeConfiguration },
      { ParticleRandom },
      { MotionLibrary },
      { EmoteD3D9 },
      { snapshotD3DContext },
    ] = await Promise.all([
      import('/src/native/world.mjs'),
      import('/src/native/config.mjs'),
      import('/src/ppi/random.mjs'),
      import('/src/motion/library.mjs'),
      import('/oracle/m2-native-d3d.mjs'),
      import('/src/render/particles-gl.mjs'),
    ]);
    let assertions = 0;
    const check = (condition, message) => {
      assertions++;
      if (!condition) throw new Error(message);
    };
    const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message);
    const rejects = (call, message) => {
      let error;
      try {
        call();
      } catch (e) {
        error = e;
      }
      check(error && /undefined|lost/.test(error.message), message);
    };
    const game = {
        width: 4,
        height: 4,
        index: new Map(),
        has: () => false,
        names: () => [],
        read: async () => null,
      },
      profile = 'nekopara-vol3-engine-2.6.1.76',
      random = new ParticleRandom(),
      world = new NativeWorld({
        game,
        profile,
        host: {},
        images: {},
        random,
        motionLibrary: new MotionLibrary(game, { profile, random }),
        configuration: new NativeConfiguration({ profile }),
        storage: { read: async () => null, write: async () => true },
      }),
      stage = world.stageRenderer,
      device = world.graphics.device,
      statuses = [];
    world.ensureNativeEngine = () => {
      throw new Error('unexpected EXE startup');
    };
    const stop = device.observe((d) => statuses.push([d.status, d.generation]));
    check(
      device === stage.graphicsDevice && device.status === 'detached',
      'World must own one detached device',
    );
    stage.attach({ canvas: { width: 4, height: 4 } });
    const gpu = stage.gpu,
      gl = gpu.gl;
    try {
      check(gpu.graphicsDevice === device && device.ready, 'Stage must adopt actual same device');
      const cpu = Uint8Array.from(Array.from({ length: 16 }, () => [3, 5, 7, 11]).flat()),
        id = stage.createSurface(4, 4, cpu),
        auxID = stage.createSurface(4, 4, cpu),
        target = stage.surfaceTarget(id),
        aux = stage.surfaceTarget(auxID),
        depth = stage.surfaceDepth(id),
        managed = { width: 1, height: 1, rgba: Uint8Array.of(19, 37, 83, 129) },
        managedHandle = gpu.texture(managed);
      gpu.beginFrame(0xff000000);
      gpu.withRenderTarget(target, () => gpu.clear({ flags: 7, color: 0xff112233 }), {
        depthStencil: depth,
      });
      gpu.endNativeFrame();
      equal([...gpu.pixels(target).slice(0, 4)], [17, 34, 51, 255], 'pre-loss GPU producer');
      equal([...stage.surfaces.get(id).bytes], [...cpu], 'CPU shadow intentionally remains old');
      gpu.depthStateProgram();
      gpu.surfaceBlendProgram();
      const old = {
        program: gpu.program,
        buffer: gpu.buffer,
        index: gpu.effekseerIndexBuffer,
        framebuffer: gpu.framebuffer,
        renderbuffer: gpu.depthStencil,
        texture: target.texture,
        targetFBO: target.framebuffer,
        depth: depth.texture,
        depthProgram: gpu.depthProgram.program,
        blendProgram: gpu.blendProgram.program,
      };
      // Borrow the real adapter's read boundary without starting a native process.
      const sharedNativeD3D = Object.create(EmoteD3D9.prototype),
        shadow = { pointer: 2, dirty: false };
      Object.assign(sharedNativeD3D, { gpu, backbuffer: 1, gpuTargets: new Map([[2, target]]) });
      const context = world.graphics.d3dContext,
        contextBefore = snapshotD3DContext(context),
        randomBefore = random.snapshot(),
        crtBefore = world.effekseer.snapshot(),
        extension = gl.getExtension('WEBGL_lose_context');
      check(extension, 'required actual WebGL loss extension');
      const finishedBatch = gpu.beginNativeBatch();
      let continueScope;
      const scope = gpu.withRenderTargetAsync(
        target,
        () =>
          new Promise((yes) => {
            continueScope = yes;
          }),
        { depthStencil: depth },
      );
      const event = (name, trigger) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(name + ' timed out')), 3000);
          gpu.canvas.addEventListener(
            name,
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          trigger();
        });
      await event('webglcontextlost', () => extension.loseContext());
      check(
        device.status === 'lost' && device.generation === 1,
        'loss must not create a generation',
      );
      check(!target.contentValid && depth.validMask === 0, 'lost contents must be invalid');
      rejects(() => stage.surfacePixels(id), 'cannot read old shadow while device lost');
      rejects(
        () => sharedNativeD3D.syncSurface(2, shadow),
        'dirty=false cannot authorize stale shadow',
      );
      await event('webglcontextrestored', () => setTimeout(() => extension.restoreContext(), 0));
      await device.settled();
      check(device.ready && device.generation === 2, 'Ready only after successful reconstruction');
      equal(
        statuses,
        [
          ['not-reset', 0],
          ['ready', 1],
          ['lost', 1],
          ['not-reset', 1],
          ['rebuilding', 1],
          ['ready', 2],
        ],
        'observable lifecycle order',
      );
      continueScope();
      await scope;
      finishedBatch();
      check(!gpu.drawing && gpu.activeTarget == null, 'old async scope must not revive its frame');
      check(stage.gpu === gpu && sharedNativeD3D.gpu === gpu, 'GPU object retained by both owners');
      check(
        stage.surfaceTarget(id) === target &&
          sharedNativeD3D.gpuTargets.get(2) === target &&
          stage.surfaceDepth(id) === depth,
        'all old target/depth references are updated in place',
      );
      for (const [key, handle] of Object.entries({
        program: gpu.program,
        buffer: gpu.buffer,
        index: gpu.effekseerIndexBuffer,
        framebuffer: gpu.framebuffer,
        renderbuffer: gpu.depthStencil,
        texture: target.texture,
        targetFBO: target.framebuffer,
        depth: depth.texture,
        depthProgram: gpu.depthProgram.program,
        blendProgram: gpu.blendProgram.program,
      }))
        check(handle !== old[key], key + ' must be a rebuilt handle');
      check(
        gpu.textures.get(managed) !== managedHandle && gl.isTexture(gpu.textures.get(managed)),
        'managed texture really reuploaded',
      );
      check(gpu.resourcesReady(), 'real GL program/buffer/texture/framebuffer handles valid');
      check(
        !target.contentValid && !aux.contentValid && depth.validMask === 0,
        'volatile content must stay invalid even though device ready',
      );
      equal([...stage.surfaces.get(id).bytes], [...cpu], 'restoration did not invent CPU readback');
      rejects(() => gpu.texture({ nativeTarget: target }), 'undefined target cannot be sampled');
      rejects(() => gpu.snapshotDepthStencil(depth), 'undefined depth cannot be checkpointed');
      rejects(
        () => sharedNativeD3D.syncSurface(2, shadow),
        'ready device does not authorize an invalid target',
      );
      gpu.withRenderTarget(target, () => gpu.clear({ flags: 7, rectangles: [[0, 0, 2, 4]] }), {
        depthStencil: depth,
      });
      check(
        !target.contentValid && depth.validMask === 0,
        'partial clear cannot define whole target/depth',
      );
      const frame = { width: 4, height: 4, rgba: cpu };
      gpu.uploadRenderTarget(target, frame, [0, 0, 2, 4]);
      check(!target.contentValid, 'partial upload cannot define whole target');
      const vertices = [
          [-0.5, -0.5],
          [3.5, -0.5],
          [-0.5, 3.5],
        ].map(([x, y]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u: 0, v: 0 })),
        options = {
          renderStates: [
            [7, 0],
            [27, 0],
            [52, 0],
            [22, 1],
          ],
        };
      gpu.withRenderTarget(target, () => gpu.drawGeometry([{ vertices }], managed, options));
      check(!target.contentValid, 'ordinary partial draw cannot define whole target');
      rejects(
        () => stage.surfacePixels(id),
        'partial producers still cannot read unknown remainder',
      );
      gpu.withRenderTarget(target, () => gpu.clear({ flags: 7, color: 0xff112233 }), {
        depthStencil: depth,
      });
      check(
        target.contentValid && depth.validMask === 6,
        'full actual clear defines target and depth',
      );
      equal(
        [...stage.surfacePixels(id).slice(0, 4)],
        [17, 34, 51, 255],
        'full GPU producer usable after restoration',
      );
      check(
        gpu.snapshotDepthStencil(depth).bytes.length === 64,
        'full depth producer usable after restoration',
      );
      stage.writeSurface(auxID, cpu);
      equal([...gpu.pixels(aux)], [...cpu], 'full CPU producer can redefine restored storage');
      gpu.beginFrame(0xff000000);
      const quad = [
        ...vertices,
        ...[
          [3.5, -0.5],
          [3.5, 3.5],
          [-0.5, 3.5],
        ].map(([x, y]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u: 0, v: 0 })),
      ];
      gpu.drawGeometry([{ vertices: quad }], managed, options);
      equal(
        [...gpu.pixels().slice(0, 4)],
        [19, 37, 83, 129],
        'normal full frame samples actual managed data',
      );
      const output = new OffscreenCanvas(4, 4),
        ctx = output.getContext('2d');
      ctx.drawImage(gpu.endFrame(), 0, 0);
      equal(
        [...ctx.getImageData(0, 0, 1, 1).data],
        [19, 37, 83, 255],
        'post-loss full frame reaches presentation',
      );
      check(world.graphics.d3dContext === context, 'logical render state owner retained');
      equal(snapshotD3DContext(context), contextBefore, 'logical render state unchanged');
      equal(random.snapshot(), randomBefore, 'MT unchanged');
      equal(world.effekseer.snapshot(), crtBefore, 'EFK CRT unchanged');
      check(
        world.nativeEngine === undefined && gl.getError() === gl.NO_ERROR,
        'no EXE and no GL error',
      );
      return {
        assertions,
        statuses,
        generation: device.generation,
        managedRGBA: [...managed.rgba],
        nativeProcess: false,
      };
    } finally {
      stop();
      await world.close();
    }
  });
  test.info().annotations.push({ type: 'device-lifecycle', description: JSON.stringify(result) });
  expect(blocked).toEqual([]);
  expect(result.generation).toBe(2);
  expect(result.nativeProcess).toBe(false);
  expect(result.assertions).toBeGreaterThanOrEqual(40);
});

test('full-size native presentation keeps the primary RGBA and existing 2D canvas', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import('/src/render/canvas.mjs'),
      { StageRenderer } = await import('/src/render/stage.mjs'),
      { NativeScreenCapture } = await import('/src/native/screen-capture.mjs'),
      canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    const renderer = new CanvasRenderer(canvas),
      stage = new StageRenderer(renderer),
      capture = new NativeScreenCapture({ stageRenderer: stage }),
      gpu = stage.gpu,
      gl = gpu.gl,
      primary = gpu.primaryTarget,
      rgba = Uint8Array.from({ length: 4 * 3 * 4 }, (_, index) => (index * 37 + 19) & 255),
      readTarget = gpu.createRenderTarget(2, 3, rgba.subarray(0, 2 * 3 * 4)),
      shadow = new OffscreenCanvas(4, 3).getContext('2d'),
      paint = (context) => {
        context.fillStyle = 'rgba(218, 3, 29, 0.5)';
        context.fillRect(1, 0, 2, 3);
        context.fillStyle = 'rgba(2, 165, 201, 0.3)';
        context.fillRect(0, 1, 3, 2);
      };
    try {
      gpu.beginFrame();
      const result = await gpu.withRenderTargetAsync(primary, async () => {
        gpu.uploadRenderTarget(primary, { width: 4, height: 3, rgba });
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readTarget.framebuffer);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(1, 1, 1, 1);
        stage.presentNative({ stageTarget: primary });
        const direct = gpu.presentationCanvas === undefined,
          bindings =
            gpu.drawing &&
            gpu.activeTarget === primary &&
            gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === primary.framebuffer &&
            gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === readTarget.framebuffer &&
            gl.isEnabled(gl.SCISSOR_TEST);
        paint(renderer.ctx);
        renderer.present();
        shadow.drawImage(gpu.presentTarget(primary), 0, 0);
        paint(shadow);
        const reference = shadow.getImageData(0, 0, 4, 3).data;
        return {
          direct,
          bindings,
          originalCanvas:
            renderer.canvas === canvas && renderer.context === canvas.getContext('2d'),
          sourceExact: capture.frame().rgba.every((value, index) => value === rgba[index]),
          compositedExact: renderer.context
            .getImageData(0, 0, 4, 3)
            .data.every((value, index) => value === reference[index]),
          error: gl.getError(),
        };
      });
      gpu.endNativeFrame();
      return result;
    } finally {
      gpu.destroyRenderTarget(readTarget);
      stage.dispose();
    }
  });
  expect(result).toEqual({
    direct: true,
    bindings: true,
    originalCanvas: true,
    sourceExact: true,
    compositedExact: true,
    error: 0,
  });
});
