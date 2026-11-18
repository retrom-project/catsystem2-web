// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';

test('constant linear filtering matches mixed filters at clamped and mirrored edges', async ({
  page,
}) => {
  await page.goto('/');
  const cases = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs');
    const size = 16,
      gpu = new ParticlesGL(size, size);
    const draw = (frame, address, scale, mag, min) => {
      const vertices = [
        [-0.5, -0.5, -1.3, -1.7],
        [size - 0.5, -0.5, -1.3 + (scale * size) / frame.width, -1.7],
        [-0.5, size - 0.5, -1.3, -1.7 + (scale * size) / frame.height],
        [
          size - 0.5,
          size - 0.5,
          -1.3 + (scale * size) / frame.width,
          -1.7 + (scale * size) / frame.height,
        ],
      ].map(([x, y, u, v]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u, v }));
      gpu.beginFrame();
      gpu.drawGeometry([{ vertices }], frame, {
        renderStates: [
          [15, 0],
          [27, 0],
        ],
        samplerStates: [
          [1, address],
          [2, address],
          [5, mag],
          [6, min],
        ],
      });
      gpu.endNativeFrame();
      return gpu.pixels();
    };
    const result = [];
    try {
      for (const [width, height] of [
        [4, 8],
        [3, 5],
      ]) {
        const rgba = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 47 + 29) & 255);
        const frame = { width, height, rgba };
        for (const address of [2, 3]) {
          for (const [scale, mag, min] of [
            [0.75, 2, 1],
            [1.75, 1, 2],
          ]) {
            const actual = draw(frame, address, scale, 2, 2);
            const generic = draw(frame, address, scale, mag, min);
            result.push({
              width,
              height,
              address,
              scale,
              varying: new Set(actual).size > 16,
              equal: actual.every((value, i) => value === generic[i]),
            });
          }
        }
      }
      return result;
    } finally {
      gpu.close();
    }
  });
  expect(cases).toHaveLength(8);
  for (const result of cases) expect(result).toMatchObject({ varying: true, equal: true });
});

test('direct texture modulation matches the general texture stages and alpha boundaries', async ({
  page,
}) => {
  await page.goto('/');
  const cases = await page.evaluate(async () => {
    const { ParticlesGL, createD3DContext } = await import('/src/render/particles-gl.mjs');
    const gpu = new ParticlesGL(8, 8);
    const frame = {
      width: 2,
      height: 2,
      rgba: Uint8Array.of(221, 138, 97, 128, 217, 61, 25, 255, 93, 171, 6, 19, 141, 73, 212, 128),
    };
    const vertices = [
      [-0.5, -0.5, 0, 0],
      [7.5, -0.5, 1, 0],
      [-0.5, 7.5, 0, 1],
      [7.5, 7.5, 1, 1],
    ].map(([x, y, u, v]) => ({ x, y, z: 0, w: 1, color: 0xff8f7341, u, v }));
    const draw = (operation, comparison, useCurrent) => {
      const state = createD3DContext();
      state.states.set(15, Number(comparison !== 0));
      state.states.set(24, 128);
      state.states.set(25, comparison || 7);
      state.states.set(27, 0);
      state.samplers.set(5, 1);
      state.samplers.set(6, 1);
      // CURRENT and DIFFUSE both resolve to the vertex color at stage zero.
      state.stages.set(
        0,
        new Map([
          [1, operation],
          [2, 2],
          [3, Number(useCurrent)],
          [4, 4],
          [5, 2],
          [6, 0],
        ]),
      );
      gpu.beginFrame(0xff132137);
      gpu.drawGeometry([{ vertices }], frame, { state });
      gpu.endNativeFrame();
      return gpu.pixels();
    };
    try {
      return [4, 5].map((operation) => {
        const outcomes = [0, 5, 7].map((comparison) => {
          const direct = draw(operation, comparison, false);
          const generic = draw(operation, comparison, true);
          return {
            equal: direct.every((byte, index) => byte === generic[index]),
            pixels: direct.toHex(),
          };
        });
        return {
          equal: outcomes.every(({ equal }) => equal),
          differentAlphaCoverage: new Set(outcomes.map(({ pixels }) => pixels)).size === 3,
        };
      });
    } finally {
      gpu.close();
    }
  });
  expect(cases).toHaveLength(2);
  for (const result of cases) expect(result).toEqual({ equal: true, differentAlphaCoverage: true });
});

test('wireframe coverage still modulates alpha for a diffuse texture product', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL, createD3DContext } = await import('/src/render/particles-gl.mjs');
    const gpu = new ParticlesGL(8, 8);
    const frame = { width: 1, height: 1, rgba: Uint8Array.of(211, 72, 38, 255) };
    const vertices = [
      [0.25, 1.5],
      [6.75, 3.6],
      [1.1, 6.45],
    ].map(([x, y]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u: 0, v: 0 }));
    const draw = (diffuse) => {
      const state = createD3DContext();
      state.states.set(8, 2);
      state.states.set(15, 0);
      state.states.set(27, 0);
      state.states.set(176, 1);
      state.stages.set(
        0,
        new Map([
          [1, 4],
          [2, 2],
          [3, diffuse],
          [4, 4],
          [5, 2],
          [6, 0],
        ]),
      );
      gpu.beginFrame();
      gpu.drawGeometry([{ vertices }], frame, { state });
      gpu.endNativeFrame();
      return gpu.pixels();
    };
    try {
      const diffuse = draw(0);
      const current = draw(1);
      return {
        antialiased: diffuse.some((byte, index) => index % 4 === 3 && byte > 0 && byte < 255),
        equal: diffuse.every((byte, index) => byte === current[index]),
      };
    } finally {
      gpu.close();
    }
  });
  expect(result).toEqual({ antialiased: true, equal: true });
});

test('ordered texture pages keep overlapping blends and the per-primitive sRGB path', async ({
  page,
}) => {
  await page.goto('/');
  const cases = await page.evaluate(async () => {
    const { ParticlesGL, createD3DContext } = await import('/src/render/particles-gl.mjs');
    const gpu = new ParticlesGL(5, 4);
    const draw = (left, right, rgba) => ({
      triangles: [
        {
          vertices: [
            [left - 0.5, -0.5, 0, 0],
            [right - 0.5, -0.5, 1, 0],
            [left - 0.5, 3.5, 0, 1],
            [right - 0.5, 3.5, 1, 1],
          ].map(([x, y, u, v]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u, v })),
        },
      ],
      frame: { width: 1, height: 1, rgba: Uint8Array.from(rgba) },
    });
    const pages = [draw(0, 4, [193, 7, 27, 173]), draw(1, 5, [11, 137, 233, 149])];
    const render = (draws, srgb, grouped) => {
      const context = createD3DContext();
      context.states.set(194, srgb);
      gpu.beginFrame(0xff191523);
      if (grouped) gpu.drawTexturePages(draws, { context });
      else
        for (const { triangles, frame } of draws) gpu.drawGeometry(triangles, frame, { context });
      gpu.endNativeFrame();
      return [...gpu.pixels()];
    };
    try {
      return [0, 1].map((srgb) => {
        const normal = render(pages, srgb, false);
        return {
          srgb,
          equal: render(pages, srgb, true).every((byte, index) => byte === normal[index]),
          ordered: render(pages.toReversed(), srgb, true).some(
            (byte, index) => byte !== normal[index],
          ),
        };
      });
    } finally {
      gpu.close();
    }
  });
  expect(cases).toEqual([
    { srgb: 0, equal: true, ordered: true },
    { srgb: 1, equal: true, ordered: true },
  ]);
});

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
      { CanvasRenderer },
      { snapshotD3DContext },
    ] = await Promise.all([
      import('/src/native/world.mjs'),
      import('/src/native/config.mjs'),
      import('/src/ppi/random.mjs'),
      import('/src/motion/library.mjs'),
      import('/src/render/canvas.mjs'),
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
    const output = document.createElement('canvas');
    output.width = output.height = 4;
    stage.attach(new CanvasRenderer(output));
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
        primaryDepth = gpu.createDepthStencil(4, 4, 80),
        managed = { width: 1, height: 1, rgba: Uint8Array.of(19, 37, 83, 129) },
        managedHandle = gpu.texture(managed);
      const checkPrimaryAttachments = () => {
        const status = gl.checkFramebufferStatus;
        let calls = 0;
        gl.checkFramebufferStatus = function (binding) {
          calls++;
          return status.call(this, binding);
        };
        try {
          for (let i = 0; i < 2; i++) {
            gpu.withRenderTarget(
              gpu.primaryTarget,
              () =>
                check(
                  gl.getFramebufferAttachmentParameter(
                    gl.FRAMEBUFFER,
                    gl.DEPTH_ATTACHMENT,
                    gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
                  ) === primaryDepth.texture,
                  'primary depth texture actually attached',
                ),
              { depthStencil: primaryDepth },
            );
            equal(calls, 2, 'validate both attachment pairs once in this device generation');
          }
        } finally {
          delete gl.checkFramebufferStatus;
        }
      };
      checkPrimaryAttachments();
      const incompleteDepth = gpu.createDepthStencil(0, 0, 80);
      try {
        for (let i = 0; i < 2; i++) {
          let error;
          try {
            gpu.withRenderTarget(gpu.primaryTarget, () => {}, { depthStencil: incompleteDepth });
          } catch (e) {
            error = e;
          }
          check(
            error?.message === 'Native render target/depth combination is incomplete',
            'incomplete attachments must fail on every attempt',
          );
        }
      } finally {
        gpu.destroyDepthStencil(incompleteDepth);
      }
      gpu.beginFrame(0xff000000);
      gpu.withRenderTarget(target, () => gpu.clear({ flags: 7, color: 0xff112233 }), {
        depthStencil: depth,
      });
      gpu.endNativeFrame();
      equal([...gpu.pixels(target).slice(0, 4)], [17, 34, 51, 255], 'pre-loss GPU producer');
      equal([...stage.surfaces.get(id).bytes], [...cpu], 'CPU shadow intentionally remains old');
      const surfaceFrame = stage.surfaceFrame(id);
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
        () => gpu.texture(surfaceFrame),
        'retaining a surface frame cannot authorize sampling during device loss',
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
      check(stage.gpu === gpu && stage.renderer.canvas === output, 'Stage output owner retained');
      check(
        stage.surfaceTarget(id) === target &&
          stage.surfaceFrame(id) === surfaceFrame &&
          surfaceFrame.nativeTarget === target &&
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
      checkPrimaryAttachments();
      check(
        !target.contentValid && !aux.contentValid && depth.validMask === 0,
        'volatile content must stay invalid even though device ready',
      );
      equal([...stage.surfaces.get(id).bytes], [...cpu], 'restoration did not invent CPU readback');
      rejects(() => gpu.texture(surfaceFrame), 'undefined target cannot be sampled');
      rejects(() => gpu.snapshotDepthStencil(depth), 'undefined depth cannot be checkpointed');
      rejects(() => stage.surfacePixels(id), 'ready device does not authorize an invalid target');
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
      stage.presentNative({ stageTarget: gpu.primaryTarget });
      check(
        gpu.presentationCanvas === undefined,
        'restored full-size target uses direct presentation',
      );
      gpu.endNativeFrame();
      stage.renderer.present();
      equal(
        [...stage.renderer.context.getImageData(0, 0, 1, 1).data],
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
          opaque = renderer.ctx.getImageData(0, 0, 4, 3).data,
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
        const reference = shadow.getImageData(0, 0, 4, 3).data,
          blit = gl.blitFramebuffer,
          presentTarget = gpu.presentTarget;
        let usedFallback = false;
        gl.blitFramebuffer = (...args) => {
          // Linear filtering with a depth blit produces INVALID_OPERATION.
          blit.call(gl, ...args.slice(0, 8), gl.DEPTH_BUFFER_BIT, gl.LINEAR);
        };
        gpu.presentTarget = function (target) {
          usedFallback = target === primary;
          return presentTarget.call(this, target);
        };
        try {
          stage.presentNative({ stageTarget: primary });
        } finally {
          delete gl.blitFramebuffer;
          delete gpu.presentTarget;
        }
        const fallbackExact = renderer.ctx
          .getImageData(0, 0, 4, 3)
          .data.every((value, index) => value === opaque[index]);
        stage.presentNative({ stageTarget: readTarget });
        const asymmetric =
          [...renderer.ctx.getImageData(0, 0, 1, 1).data].join() === '19,56,93,255' &&
          renderer.ctx.getImageData(2, 0, 1, 1).data[3] === 0 &&
          gpu.canvas.width === 4 &&
          gpu.canvas.height === 3 &&
          gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === primary.framebuffer &&
          gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === readTarget.framebuffer;
        return {
          direct,
          bindings,
          invalidOperationFallback: usedFallback && fallbackExact,
          asymmetric,
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
    invalidOperationFallback: true,
    asymmetric: true,
    originalCanvas: true,
    sourceExact: true,
    compositedExact: true,
    error: 0,
  });
});
