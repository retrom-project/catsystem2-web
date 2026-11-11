// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { emotePSBFixture } from '../fixtures/emote-psb-fixture.mjs';
import { emoteGeometryCases, emoteGeometryModel } from '../fixtures/emote-geometry-cases.mjs';

// Node covers layer/vertex arithmetic. This case requires an actual WebGL2
// context to verify StageRenderer texture ownership and fixed-function pixels.
test('JS E-mote StageRenderer pixels match the original Wine device oracle', async ({ page }) => {
  const golden = JSON.parse(
      await readFile(new URL('../fixtures/native-emote-golden.json', import.meta.url)),
    ),
    expected = inflateSync(Buffer.from(golden.frames[0].rgbaDeflate, 'base64'));
  await page.goto('/');
  const result = await page.evaluate(
    async ({ model, expected }) => {
      const [{ EmoteDocument }, { EmoteAnimation }, { EmoteGeometry }, { StageRenderer }] =
        await Promise.all([
          import('/src/emote/document.mjs'),
          import('/src/emote/animation.mjs'),
          import('/src/emote/geometry.mjs'),
          import('/src/render/stage.mjs'),
        ]);
      const document = await EmoteDocument.open(Uint8Array.from(model)),
        animation = new EmoteAnimation(document),
        geometry = new EmoteGeometry(document, animation),
        stage = new StageRenderer({ canvas: new OffscreenCanvas(256, 256) }),
        gpu = stage.gpu;
      try {
        animation.update(0);
        geometry.update();
        gpu.beginFrame(0xff204060);
        stage.drawEmote(geometry, {
          matrix: [0.25, 0, 0, 0, 0, -0.25, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        });
        const first = gpu.pixels(),
          storage = gpu.vertexData,
          meshBuffer = geometry.commands[0].bytes,
          texture = document.texture('tex', 'dot');
        gpu.endFrame();
        animation.update(120);
        geometry.update();
        gpu.beginFrame(0xff204060);
        stage.drawEmote(geometry, {
          matrix: [0.25, 0, 0, 0, 0, -0.25, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        });
        const second = gpu.pixels();
        gpu.endFrame();
        let maximum = 0,
          different = 0;
        for (let i = 0; i < first.length; i++) {
          maximum = Math.max(maximum, Math.abs(first[i] - expected[i]));
          if (first[i] !== second[i]) different++;
        }
        return {
          maximum,
          different,
          uploadReused: gpu.vertexData === storage,
          meshReused: geometry.commands[0].bytes === meshBuffer,
          textureReused: document.texture('tex', 'dot') === texture,
          error: gpu.gl.getError(),
          sample: [...first.slice((64 * 256 + 64) * 4, (64 * 256 + 64) * 4 + 4)],
        };
      } finally {
        stage.dispose();
      }
    },
    { model: [...emotePSBFixture()], expected: [...expected] },
  );
  // Existing D3D9 Wine golden permits one byte of sampler/blend rounding.
  expect(result.maximum).toBeLessThanOrEqual(1);
  expect(result.different).toBe(0);
  expect(result.uploadReused && result.meshReused && result.textureReused).toBe(true);
  expect(result.error).toBe(0);
  expect(result.sample).toEqual([32, 64, 96, 255]);
});

// Frozen original draw payloads exercise GPU-only alpha/stencil and chained
// texture stages. No private DLL or model is needed for this pixel regression.
test('JS E-mote materials and masks match frozen original draw pixels', async ({ page }) => {
  const helper = await readFile(new URL('../fixtures/emote-js-steps.mjs', import.meta.url), 'utf8');
  await page.route('**/test/emote-js-steps.mjs', (route) =>
    route.fulfill({ body: helper, contentType: 'text/javascript' }),
  );
  const golden = JSON.parse(
      await readFile(new URL('../fixtures/emote-geometry-golden.json', import.meta.url)),
    ),
    inputs = emoteGeometryCases().map((input) => ({
      name: input.name,
      steps: input.steps,
      model: [...emoteGeometryModel(input)],
    }));
  await page.goto('/');
  const result = await page.evaluate(
    async ({ inputs, golden }) => {
      const [
        { EmoteDocument },
        { EmoteAnimation },
        { EmoteGeometry },
        { StageRenderer },
        { ParticlesGL },
        { apply },
      ] = await Promise.all([
        import('/src/emote/document.mjs'),
        import('/src/emote/animation.mjs'),
        import('/src/emote/geometry.mjs'),
        import('/src/render/stage.mjs'),
        import('/src/render/particles-gl.mjs'),
        import('/test/emote-js-steps.mjs'),
      ]);
      const stage = new StageRenderer({ canvas: new OffscreenCanvas(64, 64) }),
        reference = new ParticlesGL(64, 64),
        failures = [];
      let comparisons = 0;
      try {
        for (const [n, input] of inputs.entries()) {
          const document = await EmoteDocument.open(Uint8Array.from(input.model)),
            animation = new EmoteAnimation(document),
            geometry = new EmoteGeometry(document, animation),
            texture = document.texture('tex', 'dot');
          for (const [i, step] of input.steps.entries()) {
            apply(animation, step);
            geometry.update();
            stage.gpu.beginFrame(0xff204060);
            stage.drawEmote(geometry);
            reference.beginFrame(0xff204060);
            reference.clear({ flags: 6, stencil: 0 });
            for (const draw of golden.cases[n].frames[i].draws) {
              const bytes = Uint8Array.from(draw.bytes.match(/../g), (value) =>
                  parseInt(value, 16),
                ),
                view = new DataView(bytes.buffer),
                vertices = Array.from({ length: bytes.length / draw.stride }, (_, at) => {
                  const offset = at * draw.stride,
                    f = Math.fround;
                  return {
                    x: f(f(view.getFloat32(offset, true) + 1) * 32),
                    y: f(f(1 - view.getFloat32(offset + 4, true)) * 32),
                    z: view.getFloat32(offset + 8, true),
                    w: 1,
                    color: view.getUint32(offset + 12, true),
                    u: view.getFloat32(offset + 16, true),
                    v: view.getFloat32(offset + 20, true),
                  };
                }),
                triangles = Array.from({ length: vertices.length - 2 }, (_, index) => ({
                  vertices:
                    index & 1
                      ? [vertices[index + 1], vertices[index], vertices[index + 2]]
                      : vertices.slice(index, index + 3),
                }));
              reference.drawGeometry(triangles, texture, {
                state: {
                  states: new Map(draw.state.states),
                  samplers: new Map(draw.state.samplers),
                  stages: new Map(draw.state.stages.map(([stage, data]) => [stage, new Map(data)])),
                },
              });
            }
            const actual = stage.gpu.pixels(),
              expected = reference.pixels();
            let maximum = 0;
            for (let at = 0; at < actual.length; at++)
              maximum = Math.max(maximum, Math.abs(actual[at] - expected[at]));
            if (maximum) failures.push({ name: input.name, frame: i, maximum });
            comparisons += actual.length;
            stage.gpu.endFrame();
            reference.endFrame();
          }
          for (const texture of document.textures.values()) {
            stage.gpu.releaseTextureFrame(texture);
            reference.releaseTextureFrame(texture);
          }
        }
        return { failures, comparisons, error: [stage.gpu.gl.getError(), reference.gl.getError()] };
      } finally {
        reference.close();
        stage.dispose();
      }
    },
    { inputs, golden },
  );
  expect(result.failures).toEqual([]);
  expect(result.comparisons).toBeGreaterThan(35 * 64 * 64 * 4);
  expect(result.error).toEqual([0, 0]);
});
