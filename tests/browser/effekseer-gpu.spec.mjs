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
