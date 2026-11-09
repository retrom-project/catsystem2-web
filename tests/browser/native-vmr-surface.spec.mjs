// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expectedVMRFrame, profiles } from '../fixtures/native-vmr-surface.mjs';

for (const [name, variable] of profiles)
  test(`${name} original VMR presenter writes the shared GPU texture and a fresh decoder frame`, async ({
    page,
  }) => {
    test.skip(!process.env[variable], 'Requires the corresponding frozen engine');
    const exe = await readFile(process.env[variable]);
    const fixture = await readFile(new URL('../fixtures/native-vmr-surface.mjs', import.meta.url));
    await page.route('**/test/engine.exe', (route) => route.fulfill({ body: exe }));
    await page.route('**/tests/fixtures/native-vmr-surface.mjs', (route) =>
      route.fulfill({ body: fixture, contentType: 'text/javascript' }),
    );
    await page.goto('/');
    const result = await page.evaluate(async (name) => {
      const [{ probeVMRSurface, profiles }, { ParticlesGL }] = await Promise.all([
          import('/tests/fixtures/native-vmr-surface.mjs'),
          import('/src/render/particles-gl.mjs'),
        ]),
        bytes = new Uint8Array(await (await fetch('/test/engine.exe')).arrayBuffer()),
        gpu = new ParticlesGL(4, 4),
        fresh = new ParticlesGL(4, 4);
      try {
        return {
          ...(await probeVMRSurface(
            profiles.find(([profile]) => profile === name),
            bytes,
            gpu,
            fresh,
          )),
          errors: [gpu.gl.getError(), fresh.gl.getError()],
        };
      } finally {
        fresh.close();
        gpu.close();
      }
    }, name);
    expect(result).toMatchObject({
      constructed: true,
      originalSlot: true,
      destroyed: true,
      calls: [2, 2, 1, 1],
      errors: [0, 0],
    });
    expect(result.texture.gpu).toEqual(expectedVMRFrame(21));
    expect(result.texture.bytes).toEqual(result.texture.gpu);
    expect(result.restored.gpu).toEqual(result.texture.gpu);
    expect(result.restored.bytes).toEqual(result.restored.gpu);
    expect(result.plain.gpu).toEqual(expectedVMRFrame(22));
    expect(result.plain.bytes).toEqual(result.plain.gpu);
    expect(result.freshPlain).toEqual(result.plain);
  });

test('StretchRect copies a live GPU rectangle and keeps the target pixels outside it', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const [{ loadUnicorn }, { PE32Process }, { EmoteD3D9 }, { ParticlesGL }] = await Promise.all([
      import('/src/ppi/backend.mjs'),
      import('/src/ppi/pe32.mjs'),
      import('/src/emote/native-d3d.mjs'),
      import('/src/render/particles-gl.mjs'),
    ]);
    const p = new PE32Process(await loadUnicorn()),
      gpu = new ParticlesGL(4, 4),
      d = new EmoteD3D9(p, { width: 4, height: 4 }).attachGPU(gpu),
      out = p.allocate(32, true),
      invoke = (object, slot, ...args) =>
        p.call(p.load(p.load(object) + slot * 4), [object, ...args]),
      make = (format) => {
        if (invoke(d.device, 28, 4, 4, format, 0, 0, 0, out, 0))
          throw new Error('Authored render target creation failed');
        return p.load(out);
      };
    try {
      const source = make(22),
        dest = make(21),
        set = (pointer) => invoke(d.device, 37, 0, pointer),
        clear = (color) => invoke(d.device, 43, 0, 0, 1, color, 0x3f800000, 0);
      set(source);
      clear(0x11316293);
      set(dest);
      clear(0x29653300);
      [0, 1, 1, 3, 1, 0, 3, 2].forEach((word, i) => p.store(out + 4 * i, word));
      const viewport = [...d.viewport],
        target = d.renderTargets.get(0),
        depth = d.depthStencil,
        status = invoke(d.device, 34, source, out, dest, out + 16, 1);
      return {
        status,
        source: [...gpu.pixels(d.gpuTarget(source))],
        dest: [...gpu.pixels(d.gpuTarget(dest))],
        guest: [...d.frame(dest).rgba],
        viewport: d.viewport.every((word, i) => word === viewport[i]),
        routing: d.renderTargets.get(0) === target && d.depthStencil === depth,
        error: gpu.gl.getError(),
      };
    } finally {
      d.close();
      p.close();
      gpu.close();
    }
  });
  const source = new Array(16).fill([0x31, 0x62, 0x93, 255]).flat(),
    dest = Array.from({ length: 16 }, (_, index) =>
      [1, 2, 5, 6].includes(index) ? [0x31, 0x62, 0x93, 255] : [0x65, 0x33, 0x00, 0x29],
    ).flat();
  expect(result).toEqual({
    status: 0,
    source,
    dest,
    guest: dest,
    viewport: true,
    routing: true,
    error: 0,
  });
});
