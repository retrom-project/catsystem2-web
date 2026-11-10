// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { retainedRasterCases } from '../fixtures/retained-raster.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} retained asymmetric MASK/BTYPE/affine CPU pixels reach the real native plane GPU`, async ({
    page,
  }) => {
    test.skip(!process.env[variable], 'Requires a separately mounted frozen engine');
    const exe = await readFile(process.env[variable]);
    await page.route('**/test/engine.exe', (route) => route.fulfill({ body: exe }));
    await page.goto('/');
    const golden = JSON.parse(
        await readFile(new URL('../fixtures/native-retained-raster-golden.json', import.meta.url)),
      ),
      probes = retainedRasterCases().map((probe) => ({
        ...probe,
        source: { ...probe.source, rgba: [...probe.source.rgba] },
      }));
    const result = await page.evaluate(
      async ({ profile, golden, probes }) => {
        const [
            { NativeEngineProcess },
            { NativeGraphics, NativeGraphicTask },
            { NativeGraphicsPlatform },
            { NativeRetainedDraw },
            { NativeDrawTask },
            { NativeBitmap },
            { NativeHandles },
            { NativeConfiguration },
            { StageRenderer },
            { MOTION_ABI, setMotionVector },
          ] = await Promise.all([
            import('/src/native/engine-process.mjs'),
            import('/src/native/graphics.mjs'),
            import('/src/native/graphics-process.mjs'),
            import('/src/native/retained-draw.mjs'),
            import('/src/native/draw-task.mjs'),
            import('/src/native/image.mjs'),
            import('/src/native/handles.mjs'),
            import('/src/native/config.mjs'),
            import('/src/render/stage.mjs'),
            import('/src/motion/abi.mjs'),
          ]),
          bytes = new Uint8Array(await (await fetch('/test/engine.exe')).arrayBuffer()),
          engine = await NativeEngineProcess.open({ profile, bytes }),
          configuration = new NativeConfiguration({ profile }),
          width = 8,
          height = 7;
        configuration.fields.texture.size.set([8, 8]);
        configuration.fields.texture.grid.set([1, 1]);
        configuration.fields.texture.bppY.set([0, 1]);
        configuration.fields.texture.bpp = 32;
        configuration.fields.texture.areas.forEach((row, i) =>
          row.set(i ? [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff] : [0, 0, 1, 1]),
        );
        const world = {
          profile,
          game: { width, height },
          configuration,
          nativeEngine: engine,
          runtime: { handles: new NativeHandles() },
          base: () => ({ message: () => 0 }),
          getNativeFeature: async (name) => engine.features.get(name),
        };
        world.configuration.fields.texture.size.set([64, 64]);
        world.configuration.fields.texture.grid.set([1, 1]);
        world.configuration.fields.texture.bppY.set([1, 1]);
        world.configuration.fields.texture.areas[0].set([0, 0, 1, 1]);
        world.graphics = new NativeGraphics(world);
        new NativeGraphicsPlatform(engine, world);
        new NativeRetainedDraw(engine, world);
        const canvas = new OffscreenCanvas(width, height),
          renderer = {
            canvas,
            ctx: canvas.getContext('2d'),
            begin() {
              this.ctx.reset();
            },
          },
          stageRenderer = new StageRenderer(renderer),
          plane = new NativeGraphicTask(world.graphics, { id: 8 });
        world.graphics.tasks.set(8, plane);
        plane.makeGraph({ type: 1, width, height, vram: true });
        setMotionVector(plane.graph.kx2, MOTION_ABI.pos, [0, height, 0]);
        setMotionVector(plane.graph.kx2, MOTION_ABI.scale, [1, -1, 1]);
        plane.state.shown = true;
        plane.sync();
        const rows = [];
        try {
          for (const index of [0, 1, 4, 10, 14, 25, 39, 40, 41, 42]) {
            const probe = probes[index],
              draw = new NativeDrawTask(world.graphics, { id: 2 }),
              bitmap = world.graphics.images.create(width, height, 2),
              image = world.graphics.images.add(
                new NativeBitmap(world.graphics.images, {
                  ...probe.source,
                  rgba: Uint8ClampedArray.from(probe.source.rgba),
                }),
              );
            draw.state.renderer = {
              bitmap,
              width,
              height,
              items: [],
              clearColor: probe.clear,
              dirty: true,
              dirtyRects: [probe.area],
            };
            draw.state.offset = [0, 0];
            (await world.graphics.images.get(bitmap).pixels()).fill(19);
            const item = await draw.upsert(probe.item.key, { ...probe.item, image });
            item.layer = probe.item.layer;
            item.clip = [...probe.item.clip];
            draw.state.renderer.dirtyRects = [probe.area];
            try {
              await draw.render(null, true);
              await stageRenderer.render(world.graphics.stage, null);
              const pixels = stageRenderer.gpu.pixels(),
                expected = atob(golden.cases[index].cpu);
              let maxRGB = 0,
                maxAlpha = 0;
              for (let i = 0; i < pixels.length; i += 4) {
                const alpha = expected.charCodeAt(i + 3) / 255;
                for (let channel = 0; channel < 3; channel++)
                  maxRGB = Math.max(
                    maxRGB,
                    Math.abs(
                      pixels[i + channel] - Math.round(expected.charCodeAt(i + channel) * alpha),
                    ),
                  );
                maxAlpha = Math.max(
                  maxAlpha,
                  Math.abs(pixels[i + 3] - Math.round(255 * (1 - alpha + alpha * alpha))),
                );
              }
              rows.push({ name: probe.name, maxRGB, maxAlpha });
            } finally {
              await draw.close();
              await world.graphics.images.release(image);
            }
          }
          return rows;
        } finally {
          stageRenderer.dispose();
          await engine.close();
        }
      },
      { profile, golden, probes },
    );
    for (const row of result) {
      expect(row.maxRGB, JSON.stringify(row)).toBeLessThanOrEqual(1);
      expect(row.maxAlpha, JSON.stringify(row)).toBeLessThanOrEqual(1);
    }
  });

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} JS text engine consumes Canvas glyphs and reaches the shared GPU after a fresh process restore`, async ({
    page,
  }) => {
    test.skip(!process.env[variable], 'Requires a separately mounted frozen engine');
    const bytes = await readFile(process.env[variable]);
    await page.route('**/test/engine.exe', (route) => route.fulfill({ body: bytes }));
    await page.goto('/');
    const result = await page.evaluate(async (profile) => {
      const [
          { NativeEngineProcess },
          { NativeTextRuntime },
          { CanvasTextGlyphs },
          { ParticlesGL },
        ] = await Promise.all([
          import('/src/native/engine-process.mjs'),
          import('/src/native/text.mjs'),
          import('/src/render/native-text.mjs'),
          import('/src/render/particles-gl.mjs'),
        ]),
        bytes = new Uint8Array(await (await fetch('/test/engine.exe')).arrayBuffer()),
        open = async () => {
          const engine = await NativeEngineProcess.open({ profile, bytes }),
            runtime = new NativeTextRuntime(engine, {
              glyphs: new CanvasTextGlyphs(),
            });
          return { engine, runtime };
        },
        first = await open(),
        gpu = new ParticlesGL(256, 128);
      let second;
      try {
        const layout = await first.runtime.fesLayout(21);
        layout.apply('view', ['256', '128']);
        layout.apply('size', ['20']);
        layout.apply('frame', ['1']);
        layout.apply('font', ['AuthoredBrowserFont']);
        layout.apply('shadow', ['0', '0']);
        const writer = await first.runtime.create('cp932', layout.config());
        await writer.append('CatSystem2 web');
        await writer.parse();
        await writer.draw(1);
        await writer.draw(5);
        const saved = first.engine.snapshot(),
          early = writer.frame().rgba.filter((v, i) => i % 4 === 3 && v).length;
        await writer.append(' Glyphs: ABC 0123');
        await writer.parse();
        for (let frame = 6; frame <= 120; frame++) await writer.draw(frame);
        const frame = writer.frame(),
          expected = frame.rgba.slice(),
          records = writer.records().length,
          lineCount = await writer.lineCount();
        second = await open();
        second.engine.restore(saved);
        const fresh = second.runtime.get(writer.pointer);
        await fresh.append(' Glyphs: ABC 0123');
        await fresh.parse();
        for (let i = 6; i <= 120; i++) await fresh.draw(i);
        const restored = fresh.frame();
        if (restored.rgba.some((v, i) => v !== expected[i]))
          throw new Error('Canvas/native glyph continuation diverged after fresh restore');
        const vertex = (x, y, u, v) => ({ x, y, z: 0.5, w: 1, u, v, color: 0xffffffff }),
          a = vertex(-0.5, -0.5, 0, 0),
          b = vertex(255.5, -0.5, 1, 0),
          c = vertex(255.5, 127.5, 1, 1),
          d = vertex(-0.5, 127.5, 0, 1);
        gpu.beginFrame(0xff204060);
        gpu.drawGeometry([{ vertices: [a, b, c] }, { vertices: [a, d, c] }], frame, {
          blendMode: 0,
          drawType: 0,
        });
        const canvas = gpu.endFrame(),
          pixels = gpu.pixels();
        let maximumRGBDifference = 0,
          visible = 0;
        for (let i = 0; i < expected.length; i += 4) {
          const alpha = expected[i + 3] / 255;
          if (alpha) visible++;
          for (let channel = 0; channel < 3; channel++) {
            const color = Math.round(
              expected[i + channel] * alpha + [32, 64, 96][channel] * (1 - alpha),
            );
            maximumRGBDifference = Math.max(
              maximumRGBDifference,
              Math.abs(pixels[i + channel] - color),
            );
          }
        }
        const output = document.createElement('canvas');
        output.width = 256;
        output.height = 128;
        output.id = 'native-text';
        output.getContext('2d').drawImage(canvas, 0, 0);
        document.body.replaceChildren(output);
        return {
          early,
          visible,
          records,
          lineCount,
          maximumRGBDifference,
          remaining: await fresh.remaining(),
        };
      } finally {
        gpu.close();
        await second?.engine.close();
        await first.engine.close();
      }
    }, profile);
    expect(result.visible).toBeGreaterThan(100);
    expect(result.early).toBeLessThan(result.visible);
    expect(result.lineCount).toBeGreaterThanOrEqual(2);
    expect(result.records).toBeGreaterThan(10 * 88);
    expect(result.remaining).toBe(0);
    expect(result.maximumRGBDifference).toBeLessThanOrEqual(1);
    await page
      .locator('#native-text')
      .screenshot({ path: `.local/playwright-text/${profile}.png` });
  });
