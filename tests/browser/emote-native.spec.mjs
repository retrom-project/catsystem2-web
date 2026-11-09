// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { emotePSBFixture } from '../fixtures/emote-psb-fixture.mjs';
import { nativeM2Files, nativeM2Program } from '../fixtures/native-m2-fixture.mjs';
import { nativeLPB, nativeLipWAV } from '../fixtures/native-lip.mjs';
import { kcsProgram } from '../helpers.mjs';

test('native rectangle uploads use the original RGBA view and restore row layout through empty and failing transfers', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(17, 11),
      fresh = new ParticlesGL(17, 11),
      gl = gpu.gl,
      buffer = new Uint8Array(17 * 11 * 4 + 15).fill(0xa5),
      frame = { width: 17, height: 11, rgba: buffer.subarray(7, buffer.length - 8) },
      expected = Uint8Array.from({ length: frame.rgba.length }, (_, i) => (i * 173 + 23) & 255),
      target = gpu.createRenderTarget(17, 11, expected),
      rows = [],
      nativeSubImage = gl.texSubImage2D.bind(gl);
    let calls = [];
    gl.texSubImage2D = (...args) => {
      calls.push({
        sameView: args[8] === frame.rgba,
        offset: args[9],
        rowLength: gl.getParameter(gl.UNPACK_ROW_LENGTH),
        rectangle: args.slice(2, 6),
      });
      return nativeSubImage(...args);
    };
    try {
      for (const [n, rectangle] of [
        [9, 4, 3, 4],
        [0, 1, 17, 2],
        [2, 0, 1, 11],
        [0, 0, 17, 11],
        [17, 11, 0, 0],
        [0, 0, 0, 3],
      ].entries()) {
        frame.rgba.set(
          Uint8Array.from({ length: frame.rgba.length }, (_, i) => (i * 197 + 31 + n * 19) & 255),
        );
        const [x, y, width, height] = rectangle;
        for (let row = 0; row < height; row++) {
          const begin = ((y + row) * 17 + x) * 4;
          expected.set(frame.rgba.subarray(begin, begin + width * 4), begin);
        }
        calls = [];
        gpu.uploadRenderTarget(target, frame, rectangle);
        const pixels = gpu.pixels(target);
        rows.push({
          rectangle,
          samePixels: pixels.every((value, i) => value === expected[i]),
          rowLength: gl.getParameter(gl.UNPACK_ROW_LENGTH),
          calls,
          error: gl.getError(),
        });
      }
      let failed = false;
      gl.texSubImage2D = () => {
        throw new Error('authored upload interruption');
      };
      try {
        gpu.uploadRenderTarget(target, frame, [1, 2, 3, 4]);
      } catch (error) {
        failed = error.message === 'authored upload interruption';
      }
      const afterFailure = gl.getParameter(gl.UNPACK_ROW_LENGTH);
      gl.texSubImage2D = nativeSubImage;
      const restored = fresh.createRenderTarget(17, 11, gpu.pixels(target));
      fresh.uploadRenderTarget(restored, frame, [1, 2, 3, 4]);
      gpu.uploadRenderTarget(target, frame, [1, 2, 3, 4]);
      const a = gpu.pixels(target),
        b = fresh.pixels(restored),
        independent = a.every((value, i) => value === b[i]);
      fresh.destroyRenderTarget(restored);
      return {
        rows,
        failed,
        afterFailure,
        independent,
        canaries: [...buffer.subarray(0, 7), ...buffer.subarray(buffer.length - 8)],
        errors: [gl.getError(), fresh.gl.getError()],
      };
    } finally {
      gpu.destroyRenderTarget(target);
      gpu.close();
      fresh.close();
    }
  });
  for (const row of result.rows) {
    const [x, y, width, height] = row.rectangle;
    expect(row).toEqual({
      rectangle: row.rectangle,
      samePixels: true,
      rowLength: 0,
      error: 0,
      calls:
        width && height
          ? [{ sameView: true, offset: (y * 17 + x) * 4, rowLength: 17, rectangle: row.rectangle }]
          : [],
    });
  }
  expect(result.failed).toBe(true);
  expect(result.afterFailure).toBe(0);
  expect(result.independent).toBe(true);
  expect(result.canaries).toEqual(Array(15).fill(0xa5));
  expect(result.errors).toEqual([0, 0]);
});

test('native frame setup preserves retained color, depth and stencil until an original clear', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(4, 4),
      fresh = new ParticlesGL(4, 4);
    try {
      gpu.beginFrame(0xff102030);
      gpu.clear({ flags: 6, depth: 0x3e800000, stencil: 73 });
      const color = [...gpu.pixels()],
        depth = gpu.snapshotDepthStencil(gpu.primaryDepthStencil);
      gpu.endFrame();
      gpu.beginFrame(0xffaabbcc, { preserve: true });
      const retained = {
        color: [...gpu.pixels()],
        depth: gpu.snapshotDepthStencil(gpu.primaryDepthStencil),
      };
      gpu.endFrame();
      const ignored = new OffscreenCanvas(4, 4);
      ignored.getContext('2d').fillRect(0, 0, 4, 4);
      gpu.beginFrame(ignored, { preserve: true });
      const untouched = [...gpu.pixels()];
      gpu.presentTarget();
      const presentation = gpu.drawPresentation;
      let repeated = 0;
      gpu.drawPresentation = () => repeated++;
      gpu.endNativeFrame();
      const nativeClosed = !gpu.drawing && gpu.gl.getParameter(gpu.gl.FRAMEBUFFER_BINDING) === null;
      gpu.drawPresentation = presentation;
      fresh.restoreDepthStencil(fresh.primaryDepthStencil, depth);
      const restored = fresh.snapshotDepthStencil(fresh.primaryDepthStencil);
      gpu.beginFrame(0xffaabbcc);
      const cleared = {
        color: [...gpu.pixels().slice(0, 4)],
        depth: gpu.snapshotDepthStencil(gpu.primaryDepthStencil),
      };
      gpu.endFrame();
      return {
        color,
        depth,
        retained,
        untouched,
        restored,
        repeated,
        nativeClosed,
        cleared,
        error: gpu.gl.getError(),
        freshError: fresh.gl.getError(),
      };
    } finally {
      fresh.close();
      gpu.close();
    }
  });
  expect(result.retained).toEqual({ color: result.color, depth: result.depth });
  expect(result.untouched).toEqual(result.color);
  expect(result.restored).toEqual(result.depth);
  expect(result.repeated).toBe(0);
  expect(result.nativeClosed).toBe(true);
  expect(result.cleared.color).toEqual([170, 187, 204, 255]);
  expect(result.cleared.depth).not.toEqual(result.depth);
  expect(result.error).toBe(0);
  expect(result.freshError).toBe(0);
});

test('native presentation copies asymmetric targets without closing or resizing the active frame', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(4, 4),
      colors = [
        [255, 0, 0, 17],
        [0, 0, 255, 34],
        [0, 255, 0, 51],
        [255, 255, 0, 68],
        [0, 255, 255, 85],
        [255, 0, 255, 102],
      ],
      bytes = Uint8Array.from(colors.flat()),
      target = gpu.createRenderTarget(2, 3, bytes),
      depth = gpu.createDepthStencil(2, 3, 80),
      gl = gpu.gl;
    try {
      gpu.beginFrame(0);
      let output, intact, continued, source, retained;
      await gpu.withRenderTargetAsync(
        target,
        async () => {
          gpu.clear({ flags: 2, depth: 0x3f800000 });
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gpu.primaryTarget.framebuffer);
          await Promise.resolve();
          const canvas = gpu.presentTarget(target);
          output = [...canvas.getContext('2d').getImageData(0, 0, 2, 3).data];
          intact =
            gpu.drawing &&
            gpu.activeTarget === target &&
            gpu.canvas.width === 4 &&
            gpu.canvas.height === 4 &&
            target.depthStencil === depth &&
            gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === target.framebuffer &&
            gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === gpu.primaryTarget.framebuffer;
          source = [...gpu.pixels(target)];
          gpu.clear({ flags: 1, color: 0xff0a0b0c });
          continued = [...gpu.pixels(target).slice(0, 4)];
          retained = [...canvas.getContext('2d').getImageData(0, 0, 2, 3).data];
        },
        { depthStencil: depth },
      );
      gpu.clear({ flags: 1, color: 0xff102030 });
      const canvas = gpu.endFrame(),
        copy = new OffscreenCanvas(4, 4);
      copy.getContext('2d').drawImage(canvas, 0, 0);
      return {
        output,
        intact,
        continued,
        source,
        retained,
        final: [...copy.getContext('2d').getImageData(0, 0, 1, 1).data],
        error: gl.getError(),
      };
    } finally {
      gpu.destroyRenderTarget(target);
      gpu.destroyDepthStencil(depth);
      gpu.close();
    }
  });
  const colors = [
      [255, 0, 0, 17],
      [0, 0, 255, 34],
      [0, 255, 0, 51],
      [255, 255, 0, 68],
      [0, 255, 255, 85],
      [255, 0, 255, 102],
    ],
    opaque = colors.map(([r, g, b]) => [r, g, b, 255]).flat();
  expect(result).toEqual({
    output: opaque,
    intact: true,
    continued: [10, 11, 12, 255],
    source: colors.flat(),
    retained: opaque,
    final: [16, 32, 48, 255],
    error: 0,
  });
});

test('async native graph drawing holds the current render target through nested guest calls and errors', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const [{ loadUnicorn }, { PE32Process }, { EmoteD3D9 }, { ParticlesGL }] = await Promise.all([
        import('/src/ppi/backend.mjs'),
        import('/src/ppi/pe32.mjs'),
        import('/src/emote/native-d3d.mjs'),
        import('/src/render/particles-gl.mjs'),
      ]),
      p = new PE32Process(await loadUnicorn()),
      gpu = new ParticlesGL(8, 8),
      d = new EmoteD3D9(p, { width: 8, height: 8 }).attachGPU(gpu),
      out = p.allocate(4, true),
      inner = p.allocate(8, true),
      outer = p.allocate(16, true),
      word = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
    try {
      d.createSurface({ width: 8, height: 8, format: 21, usage: 1, pool: 0 }, out);
      const pointer = p.load(out),
        target = d.gpuTarget(pointer),
        originalContext = { authored: true };
      d.renderTargets.set(0, pointer);
      d.depthStencil = 0;
      gpu.frameContext = originalContext;
      p.write(inner, [0xb8, 41, 0, 0, 0, 0xc3]);
      let before, after;
      const trap = p.trap('authored async native graph', 0, () =>
        d.hostDraw(async (g) => {
          before = g.activeTarget === target && g.frameContext === d.context;
          const value = await p.callFromHost(inner);
          await Promise.resolve();
          after = g.activeTarget === target && g.frameContext === d.context;
          g.clear({ flags: 1, color: 0x11332211 });
          return value;
        }),
      );
      p.write(outer, [0xe8, ...word(trap - outer - 5), 0xc3]);
      const value = await p.callAsync(outer),
        rgba = [...gpu.pixels(target).slice(0, 4)];
      let caught = false;
      try {
        await d.hostDraw(async (g) => {
          await g.withRenderTargetAsync(g.primaryTarget, async () => {
            await Promise.resolve();
            throw new Error('authored GPU failure');
          });
        });
      } catch (error) {
        caught = error.message === 'authored GPU failure';
      }
      return {
        value,
        before,
        after,
        rgba,
        caught,
        restored: gpu.activeTarget == null && gpu.frameContext === originalContext && !gpu.drawing,
        dirty: d.objects.get(pointer).dirty,
        error: gpu.gl.getError(),
      };
    } finally {
      d.close();
      p.close();
      gpu.close();
    }
  });
  expect(result).toEqual({
    value: 41,
    before: true,
    after: true,
    rgba: [51, 34, 17, 17],
    caught: true,
    restored: true,
    dirty: true,
    error: 0,
  });
});

test('the shared native device creates a lockable XRGB/D16 back buffer and restores a fresh GPU', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const [{ loadUnicorn }, { PE32Process }, { EmoteD3D9 }, { ParticlesGL }] = await Promise.all([
        import('/src/ppi/backend.mjs'),
        import('/src/ppi/pe32.mjs'),
        import('/src/emote/native-d3d.mjs'),
        import('/src/render/particles-gl.mjs'),
      ]),
      unicorn = await loadUnicorn(),
      first = new PE32Process(unicorn),
      second = new PE32Process(unicorn),
      gpu = new ParticlesGL(8, 8),
      freshGPU = new ParticlesGL(8, 8),
      d = new EmoteD3D9(first, { width: 8, height: 8 }).attachGPU(gpu),
      fresh = new EmoteD3D9(second, { width: 8, height: 8 }).attachGPU(freshGPU),
      invoke = (p, object, slot, args = []) =>
        p.call(p.load(p.load(object) + slot * 4), [object, ...args]),
      pp = first.allocate(56, true),
      out = first.allocate(16, true),
      data = first.allocate(60, true),
      rectangle = first.allocate(16, true);
    try {
      [8, 8, 22, 1, 0, 0, 3, 1, 1, 1, 80, 1, 0, 0].forEach((word, i) =>
        first.store(pp + i * 4, word),
      );
      const created = invoke(first, d.d3d, 16, [0, 1, 1, 0x24, pp, out]);
      if (created) throw new Error('Native device creation failed ' + created.toString(16));
      invoke(first, d.device, 43, [0, 0, 3, 0x11ff0000, 0x3f800000, 0]);
      const initial = [...gpu.pixels().slice(0, 4)];
      invoke(first, d.device, 57, [27, 0]);
      invoke(first, d.device, 89, [0x44]);
      const view = new DataView(new ArrayBuffer(60));
      [
        [-0.5, -0.5],
        [7.5, -0.5],
        [-0.5, 7.5],
      ].forEach(([x, y], i) => {
        [x, y, 0.5, 1].forEach((n, k) => view.setFloat32(i * 20 + k * 4, n, true));
        view.setUint32(i * 20 + 16, 0x2200ff00, true);
      });
      first.write(data, new Uint8Array(view.buffer));
      invoke(first, d.device, 83, [4, 1, data, 20]);
      const drawn = [...gpu.pixels().slice(0, 4)];
      invoke(first, d.device, 18, [0, 0, 0, out]);
      const surface = first.load(out);
      invoke(first, surface, 13, [out, 0, 16]);
      const locked = [...first.read(first.load(out + 4), 4)];
      invoke(first, surface, 14);
      [6, 6, 7, 7].forEach((n, i) => first.store(rectangle + i * 4, n));
      invoke(first, surface, 13, [out, rectangle, 0]);
      first.write(first.load(out + 4), [255, 0, 0, 0]);
      invoke(first, surface, 14);
      const bytes = gpu.pixels(),
        saved = d.snapshot(),
        memory = first.snapshot();
      second.restore(memory);
      fresh.restore(saved);
      const restored = freshGPU.pixels(),
        before = gpu.pixels(),
        depth = gpu.snapshotDepthStencil(d.depthTarget(d.backDepth)),
        freshDepth = freshGPU.snapshotDepthStencil(fresh.depthTarget(fresh.backDepth));
      invoke(second, fresh.device, 43, [0, 0, 1, 0xff000000, 0x3f800000, 0]);
      return {
        created,
        initial,
        drawn,
        locked,
        patched: [...bytes.slice((6 * 8 + 6) * 4, (6 * 8 + 7) * 4)],
        same: [...restored].every((n, i) => n === bytes[i]),
        independent: [...gpu.pixels()].every((n, i) => n === before[i]),
        depth: [...depth.bytes].every((n, i) => n === freshDepth.bytes[i]),
        depthFormat: fresh.objects.get(fresh.backDepth).format,
        errors: [gpu.gl.getError(), freshGPU.gl.getError()],
      };
    } finally {
      fresh.close();
      d.close();
      second.close();
      first.close();
      freshGPU.close();
      gpu.close();
    }
  });
  expect(result).toEqual({
    created: 0,
    initial: [255, 0, 0, 255],
    drawn: [0, 255, 0, 255],
    locked: [0, 255, 0, 255],
    patched: [0, 0, 255, 255],
    same: true,
    independent: true,
    depth: true,
    depthFormat: 80,
    errors: [0, 0],
  });
});

test('original E-mote DLL draws the authored model through the shared compositor', async ({
  page,
}) => {
  test.skip(!process.env.CATSYSTEM2_EMOTE_DLL, 'Requires a separately supplied E-mote driver');
  const bytes = await readFile(process.env.CATSYSTEM2_EMOTE_DLL);
  await page.route('**/test/emotedriver.dll', (route) => route.fulfill({ body: bytes }));
  await page.goto('/');
  const result = await page.evaluate(
    async (model) => {
      const [{ NativeEmoteDevice }, { ParticlesGL }] = await Promise.all([
        import('/src/emote/native-device.mjs'),
        import('/src/render/particles-gl.mjs'),
      ]);
      const before = performance.now(),
        d = await NativeEmoteDevice.open(
          new Uint8Array(await (await fetch('/test/emotedriver.dll')).arrayBuffer()),
          { width: 256, height: 256, now: () => 0, epoch: 0 },
        ),
        gpu = new ParticlesGL(256, 256);
      try {
        d.d3d.transforms.set(3, [2 / 256, 0, 0, 0, 0, -2 / 256, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]);
        d.d3d.transforms.set(256, [32, 0, 0, 0, 0, 32, 0, 0, 0, 0, 1, 0, 128, 128, 0, 1]);
        const p = await d.createPlayer(Uint8Array.from(model));
        p.show();
        p.update(1);
        const commands = p.collectDraw();
        gpu.beginFrame(0xff204060);
        d.d3d.replay(gpu, commands);
        gpu.endFrame();
        return {
          identity: d.identity,
          variables: p.variables(),
          draws: commands.length,
          pixels: [...gpu.pixels()],
          milliseconds: performance.now() - before,
        };
      } finally {
        gpu.close();
        d.close();
      }
    },
    [...emotePSBFixture()],
  );
  const native = JSON.parse(
    await readFile(new URL('../fixtures/native-emote-golden.json', import.meta.url), 'utf8'),
  );
  const expected = inflateSync(Buffer.from(native.frames[0].rgbaDeflate, 'base64'));
  let maximum = 0,
    changed = 0;
  for (let i = 0; i < expected.length; i++) {
    const difference = Math.abs(result.pixels[i] - expected[i]);
    maximum = Math.max(maximum, difference);
    if (difference) changed++;
  }
  expect(result.variables).toEqual(['pose']);
  expect(result.draws).toBe(1);
  console.log({ milliseconds: result.milliseconds, maximum, changed });
  expect(maximum).toBeLessThanOrEqual(1);
});

test('native render-target checkpoints preserve color, depth and every stencil bit', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(8, 8),
      white = { width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) },
      target = gpu.createRenderTarget(8, 8),
      depth = gpu.createDepthStencil(8, 8);
    const quad = (z, color) => ({
      vertices: [
        [0, 0],
        [8, 0],
        [0, 8],
        [8, 8],
      ].map(([x, y]) => ({ x, y, z, w: 1, u: 0, v: 0, color })),
    });
    try {
      gpu.withRenderTarget(
        target,
        () => {
          gpu.clear({ flags: 7, color: 0, depth: 0x3f800000, stencil: 0 });
          gpu.drawGeometry([quad(0.25, 0xffff0000)], white, {
            renderStates: [
              [7, 1],
              [14, 1],
              [23, 4],
              [52, 1],
              [56, 8],
              [57, 173],
              [55, 3],
              [59, 255],
              [22, 1],
              [27, 0],
            ],
          });
        },
        { depthStencil: depth },
      );
      const color = gpu.pixels(target),
        saved = gpu.snapshotDepthStencil(depth),
        copy = gpu.createRenderTarget(8, 8, color),
        restored = gpu.createDepthStencil(8, 8);
      gpu.restoreDepthStencil(restored, saved);
      gpu.withRenderTarget(
        copy,
        () => {
          gpu.drawGeometry([quad(0.5, 0xff0000ff)], white, {
            renderStates: [
              [7, 1],
              [14, 1],
              [23, 2],
              [52, 1],
              [56, 3],
              [57, 173],
              [55, 1],
              [22, 1],
              [27, 0],
            ],
          });
          gpu.drawGeometry([quad(0.1, 0xff00ff00)], white, {
            renderStates: [
              [7, 1],
              [14, 1],
              [23, 2],
              [52, 1],
              [56, 3],
              [57, 172],
              [55, 1],
              [22, 1],
              [27, 0],
            ],
          });
        },
        { depthStencil: restored },
      );
      return {
        color: [...color],
        after: [...gpu.pixels(copy)],
        depth: [...saved.bytes],
        again: [...gpu.snapshotDepthStencil(restored).bytes],
        error: gpu.gl.getError(),
      };
    } finally {
      gpu.close();
    }
  });
  expect(result.error).toBe(0);
  expect(result.after).toEqual(result.color);
  expect(result.again).toEqual(result.depth);
  expect(result.depth.filter((_, i) => i % 4 === 3)).toEqual(Array(64).fill(173));
  expect(result.color.slice(0, 4)).toEqual([255, 0, 0, 255]);
});

async function verifyM2Wrapper(page, variant, lip = false) {
  test.skip(
    !process.env.CATSYSTEM2_ENGINE_EXE || !process.env.CATSYSTEM2_EMOTE_DLL,
    'Requires separately supplied original engine and driver',
  );
  const engine = await readFile(process.env.CATSYSTEM2_ENGINE_EXE),
    driver = await readFile(process.env.CATSYSTEM2_EMOTE_DLL),
    files = nativeM2Files();
  if (lip) {
    files['authored.dif'] = new TextEncoder().encode(
      '#scale\n1 1\n#dif\n1 lip\n#pattern\n%1 1 base default\npose 0\n#clipper_default\n0 1 0.4 0.2 0.8 0.6 0 1\n#lip_table\n1 1 linear 0 5 0 1 2\n#lip_variable\n1 1 pose\n',
    );
    files['authored-voice.wav'] = nativeLipWAV();
    files['authored-voice.lpb'] = nativeLPB();
  }
  if (variant === 'psz') {
    const raw = files['authored.psb'],
      packed = deflateSync(raw),
      bytes = new Uint8Array(16 + packed.length),
      header = new DataView(bytes.buffer);
    bytes.set([80, 83, 90, 0]);
    header.setUint32(4, packed.length, true);
    header.setUint32(8, raw.length, true);
    bytes.set(packed, 16);
    delete files['authored.psb'];
    files['authored.psz'] = bytes;
  }
  files['main.kcs'] = kcsProgram([[59]]);
  files['panel.fes'] = new TextEncoder().encode(
    `#DEFINE\nM2PLANE actor\n#OBJECT FILE POS PRI DISP\nactor ${nativeM2Program} 0,0 50000 1\n#START\nactor m2body base\nactor m2eff 1\nnext WAIT\n#WAIT\n`,
  );
  await page.route('**/test/engine.exe', (route) => route.fulfill({ body: engine }));
  await page.route('**/test/emotedriver.dll', (route) => route.fulfill({ body: driver }));
  await page.goto('/');
  const result = await page.evaluate(
    async ({ files: entries, variant, program, lip }) => {
      const [
        { NativeWorld },
        { NativeConfiguration },
        { MotionLibrary },
        { ParticleRandom },
        { ImageStore },
        { StageRenderer },
        { CanvasRenderer },
        { NativeDictionary },
        { floatBits },
        { installNativeM2 },
        { AudioMixer },
        { NativeSoundPacket },
      ] = await Promise.all([
        import('/web/transitional-entry.mjs'),
        import('/src/native/config.mjs'),
        import('/src/motion/library.mjs'),
        import('/src/ppi/random.mjs'),
        import('/src/formats/hg3.mjs'),
        import('/src/render/stage.mjs'),
        import('/src/render/canvas.mjs'),
        import('/src/native/dictionary.mjs'),
        import('/src/kcs/vm.mjs'),
        import('/src/native/emote.mjs'),
        import('/src/audio.mjs'),
        import('/src/native/sound.mjs'),
      ]);
      const files = new Map(entries.map(([name, bytes]) => [name, Uint8Array.from(bytes)]));
      for (const name of ['engine.exe', 'emotedriver.dll'])
        files.set(name, new Uint8Array(await (await fetch('/test/' + name)).arrayBuffer()));
      const game = {
        width: 64,
        height: 64,
        index: new Map([...files.keys()].map((name) => [name, {}])),
        has: (name) => files.has(name.toLowerCase()),
        names: (extension) => [...files.keys()].filter((name) => name.endsWith('.' + extension)),
        read: async (name) => files.get(name.toLowerCase()) ?? null,
        async require(name) {
          const value = await this.read(name);
          if (!value) throw new Error('Missing authored resource ' + name);
          return value;
        },
        resolveCategory(name, category) {
          let file = name.toLowerCase().replaceAll('\\', '/');
          if (category === 'm2config')
            return ['m2view.cnf', 'authored.pfl', 'authored.dif'].includes(file) ? file : null;
          if (category === 'm2psb') file = /\.(psz|psb)$/.test(file) ? file : file + '.' + variant;
          else if (category === 'kcs') file = file.endsWith('.kcs') ? file : file + '.kcs';
          else if (category === 'fes') file = file.endsWith('.fes') ? file : file + '.fes';
          else if (category === 'sound') file = file.endsWith('.wav') ? file : file + '.wav';
          else return null;
          return files.has(file) ? file : null;
        },
        async readCategory(name, category) {
          const file = this.resolveCategory(name, category);
          return file === null ? null : this.read(file);
        },
        async requireCategory(name, category) {
          const value = await this.readCategory(name, category);
          if (!value) throw new Error('Missing authored category ' + category + '/' + name);
          return value;
        },
      };
      const profile = 'nekopara-vol3-engine-2.6.1.76',
        written = [],
        audioContexts = [],
        storageFiles = new Map(),
        make = () => {
          const configuration = new NativeConfiguration({ profile });
          for (const field of [
            'width',
            'height',
            'virtualWidth',
            'virtualHeight',
            'currentWidth',
            'currentHeight',
          ])
            configuration.setField('screen.' + field, 64);
          const images = new ImageStore(game),
            renderer = new CanvasRenderer(new OffscreenCanvas(64, 64), images),
            stageRenderer = new StageRenderer(renderer),
            random = new ParticleRandom(),
            audioContext = lip ? new AudioContext() : null,
            audio = audioContext && new AudioMixer(game, audioContext),
            world = new NativeWorld({
              game,
              profile,
              configuration,
              images,
              audio,
              random,
              motionLibrary: new MotionLibrary(game, { profile, random }),
              storage: {
                read: async (name) => storageFiles.get(name) ?? null,
                write: async (name, bytes) => {
                  storageFiles.set(name, bytes.slice());
                  written.push([name, bytes.length]);
                  return true;
                },
                stat: async () => null,
                remove: async () => true,
              },
              host: { nativeGPU: () => stageRenderer.gpu, nativeLog() {} },
            });
          world.stageRenderer = stageRenderer;
          if (audioContext) {
            audio.setMaster(0);
            audioContexts.push(audioContext);
          }
          if (!world.nativeFeatureFactories.has('m2')) installNativeM2(world);
          return world;
        },
        first = make();
      let second, failure;
      try {
        const start = performance.now();
        await first.initialize('main.kcs');
        const owner = await first.getNativeFeature('m2');
        await owner.initialize();
        const nativeFrames = [],
          manager = owner.process.load(0xb9bd94),
          source = owner.process.allocate(program.length + 1, true),
          d3d = owner.device.d3d,
          encode = (bytes) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
        owner.process.write(source, new TextEncoder().encode(program));
        try {
          await owner.engine.call(0x57d160, [123, 0], manager);
          const loaded = await owner.engine.call(0x57d270, [123, 0, source, 0], manager);
          if (loaded !== 1) throw new Error('Original authored M2 manager rejected the model');
          for (let frame = 0; frame < 4; frame++) {
            const draws = [];
            d3d.onDrawRaw = (draw) =>
              draws.push({
                ...draw,
                ...(draw.indices ? { indices: encode(draw.indices) } : {}),
                bytes: encode(draw.bytes),
              });
            const result = await owner.engine.call(0x57def0, [123, frame, 0, 0, 1], manager),
              texture = await owner.engine.call(0x57e200, [123], manager),
              object = d3d.objects.get(texture),
              target = d3d.gpuTargets.get(texture),
              pixels = target ? d3d.gpu.pixels(target) : d3d.frame(texture).rgba;
            nativeFrames.push({
              result,
              width: object.width,
              height: object.height,
              draws,
              pixels: [...pixels],
            });
          }
        } finally {
          d3d.onDrawRaw = undefined;
          owner.process.free(source);
        }
        const target = await first.objects.create({
            kind: 54,
            parent: first.root,
            name: 'Authored M2',
          }),
          nativeID = first.nativeTaskID(target),
          machine = first.main.machine;
        machine.writeString(program, 128);
        machine.writeString('pose', 256);
        machine.writeString('base', 384);
        const dictionary = new NativeDictionary();
        dictionary.set(new TextEncoder().encode('pose'), floatBits(3));
        const handle = first.runtime.handles.add('dictionary', dictionary),
          call = (id, args) =>
            first.runtime.native('main', id, args, machine, first.main, first.runtime.scheduler);
        const cases = [
            [906, [nativeID, 128, 0]],
            [907, [nativeID, 1]],
            [909, [nativeID]],
            [910, [nativeID, 0, 512, 516, 520]],
            [911, [nativeID, floatBits(3)]],
            [912, [nativeID, 256, floatBits(3)]],
            [913, [nativeID, handle]],
            [914, [nativeID, floatBits(3)]],
            [915, [nativeID, 256, floatBits(3)]],
            [916, [nativeID, handle]],
            [917, [nativeID, 384, 1]],
            [918, [nativeID, 1]],
            [919, [nativeID, 100, 100, 100]],
            [920, [nativeID, 256, floatBits(3)]],
            [921, [nativeID, handle]],
            [922, []],
            [923, []],
            [924, [nativeID, 1, 0]],
            [925, []],
            [926, [nativeID, 640]],
            [927, [nativeID, 1]],
            [928, [nativeID, 0]],
            [929, [nativeID, 384]],
            [931, [nativeID, 1]],
            [932, []],
            [933, []],
            [965, [nativeID, 256, 0, floatBits(3)]],
            [966, [nativeID, handle]],
            [1025, [nativeID, 0]],
            [1027, [nativeID, 384]],
            [1028, [nativeID, 384]],
            [1029, [nativeID, floatBits(32), floatBits(32)]],
            [1030, [nativeID, floatBits(32), floatBits(32), 0, 1024, 1280]],
            [1047, [nativeID]],
            [1048, [nativeID]],
            [930, [nativeID]],
            [908, [nativeID]],
          ],
          replies = [];
        for (const [id, args] of cases) {
          const reply = await call(id, args);
          replies.push([id, reply.control, reply.value]);
        }
        await call(906, [nativeID, 128, 0]);
        await first.sendNativeEngine(nativeID, first.main.id, 47, 0, 1);
        const record = first.objects.objects.get(target),
          pointer = first.graphics.get(target).pointer,
          p = owner.process;
        let lipState;
        if (lip) {
          const sound = first.sound.primary(first.root),
            packet = new NativeSoundPacket([], 288),
            loads = [],
            detach = p.beforeInstruction(
              0x5a1a90,
              'authored browser LPB parser observation',
              () => {
                loads.push(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0);
              },
            );
          try {
            await first.audio.unlock();
            packet.store(0, 0);
            packet.writeString('authored-voice', 12);
            packet.store(272, 1);
            if (!(await sound.load(packet, 1)))
              throw new Error('Authored PCM voice failed to load');
            if (!sound.controls[0].lpb || sound.controls[0].lv)
              throw new Error('LPB precedence differs');
            await first.sound.play(0, 1, sound.controls[0]);
            await call(924, [nativeID, 1, 0]);
            const oldSidecar = [...owner.sidecars.keys()][0];
            if (!(await sound.load(packet, 1))) throw new Error('Authored voice reload failed');
            await first.sound.play(0, 1, sound.controls[0]);
            await call(924, [nativeID, 1, 0]);
            lipState = {
              active: p.load(pointer + 948),
              audio: first.audio.context.state,
              samples: first.sound.device[0].metadata.sampleFrames,
              releasedOldCopy: !owner.sidecars.has(oldSidecar),
              classes: loads.map((address) => ({
                vtable: p.load(address),
                count: p.load(address + 60),
                values: [
                  ...new Uint32Array(p.read(p.load(address + 52), p.load(address + 60) * 4).buffer),
                ],
              })),
              copies: [...owner.sidecars.values()].map((address) => [
                ...p.read(address, files.get('authored-voice.lpb').length),
              ]),
            };
            if (!loads.length) throw new Error('Original LPB installer created no lip drivers');
          } finally {
            detach();
          }
        }
        const prefix = {
          fps: p.load(pointer + 72),
          parent: owner.taskMemory.worldID(p.load(pointer + 12)),
          expectedParent: record.parent,
        };
        const fes = await first.objects.create({
          kind: 34,
          parent: first.root,
          name: 'Authored FES',
        });
        await first.objects.objects.get(fes).implementation.load('panel.fes', first.main);
        const render = async (world) => {
          await world.tick();
          await world.stageRenderer.render(world.graphics.stage, 0);
          return world.stageRenderer.gpu.pixels();
        };
        const frames = [];
        for (let i = 0; i < 3; i++) frames.push([...(await render(first))]);
        const state = structuredClone(first.snapshot());
        const expected = await render(first);
        frames.push([...expected]);
        second = make();
        await second.restore(state);
        const restored = await render(second);
        let mismatch = 0,
          colored = 0;
        for (let i = 0; i < expected.length; i++) {
          if (expected[i] !== restored[i]) mismatch++;
          if (i % 4 !== 3 && expected[i]) colored++;
        }
        const object = second.objects.objects
          .get(fes)
          .implementation.player.root.byKey.get('actor');
        return {
          replies,
          lip: lipState,
          nativeFrames,
          frames,
          mismatch,
          colored,
          diagnostics: {
            calls: [...owner.device.d3d.calls],
            textures: [...owner.device.d3d.objects.values()]
              .filter((object) => object.kind === 'Texture9')
              .map((object) => [
                object.pointer,
                object.width,
                object.height,
                object.usage,
                object.revision,
              ]),
            task: [p.load(pointer + 888), p.load(pointer + 892), p.load(pointer + 904)],
          },
          prefix,
          fesKind: second.objects.objects.get(object.nativeTaskID).kind,
          milliseconds: performance.now() - start,
          written,
        };
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        await (async () => {
          const errors = [],
            describe = (error) => ({
              message: error.message,
              stack: error.stack,
              ...(error.errors ? { errors: error.errors.map(describe) } : {}),
              ...(error.cause ? { cause: describe(error.cause) } : {}),
            });
          for (const world of [second, first])
            try {
              await world?.close({ flushFiles: false });
            } catch (error) {
              errors.push(describe(error));
            }
          for (const context of audioContexts)
            try {
              await context.close();
            } catch (error) {
              errors.push(describe(error));
            }
          if (errors.length)
            throw new Error(
              JSON.stringify({ failure: failure && describe(failure), cleanup: errors }),
            );
        })();
      }
    },
    {
      files: Object.entries(files).map(([name, bytes]) => [name, [...bytes]]),
      variant,
      program: nativeM2Program,
      lip,
    },
  );
  expect(result.replies).toHaveLength(37);
  const golden = JSON.parse(
    await readFile(new URL('../fixtures/native-m2-golden.json', import.meta.url), 'utf8'),
  );
  for (let i = 0; !lip && i < result.nativeFrames.length; i++) {
    const actual = result.nativeFrames[i],
      expected = golden.variants[variant].frames[i],
      pixels = inflateSync(Buffer.from(expected.rgbaDeflate, 'base64'));
    expect(actual.result).toBe(expected.result);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(actual.draws).toEqual(expected.draws);
    let maximum = 0;
    for (let at = 0; at < pixels.length; at++)
      maximum = Math.max(maximum, Math.abs(pixels[at] - actual.pixels[at]));
    expect(maximum, `${variant} original wrapper frame ${i}`).toBeLessThanOrEqual(1);
  }
  expect(new Set(result.replies.map((row) => row[0])).size).toBe(37);
  expect(result.replies.find((row) => row[0] === 925).slice(1)).toEqual([1, 1]);
  expect(result.prefix).toEqual({
    fps: 60,
    parent: result.prefix.expectedParent,
    expectedParent: result.prefix.expectedParent,
  });
  expect(result.fesKind).toBe(54);
  if (lip) {
    const golden = JSON.parse(
      await readFile(new URL('../fixtures/native-lip-golden.json', import.meta.url), 'utf8'),
    );
    expect(result.lip.active).toBe(1);
    expect(result.lip.audio).toBe('running');
    expect(result.lip.samples).toBe(88200);
    expect(result.lip.releasedOldCopy).toBe(true);
    for (const entry of result.lip.classes) {
      expect(entry.vtable).toBe(0x9e4460);
      expect(entry.count).toBe(golden.lpb.count);
      expect(entry.values).toEqual(golden.lpb.values);
    }
    expect(result.lip.copies).toEqual([[...nativeLPB()]]);
  }
  if (!result.colored) console.log(result.diagnostics);
  expect(result.colored).toBeGreaterThan(0);
  expect(result.mismatch).toBe(0);
  expect(result.written.filter(([name]) => name === 'm2setting.xml').length).toBeGreaterThanOrEqual(
    3,
  );
  console.log({ variant, milliseconds: result.milliseconds, colored: result.colored });
  return result;
}

test('original M2 PSB and PSZ wrappers, 37 natives, FES task and fresh World checkpoints', async ({
  page,
}) => {
  const psb = await verifyM2Wrapper(page, 'psb'),
    psz = await verifyM2Wrapper(page, 'psz');
  expect(psz.frames).toEqual(psb.frames);
  expect(psz.replies).toEqual(psb.replies);
});

test('original LPB installation consumes actual PCM media and preserves its native drivers across a World checkpoint', async ({
  page,
}) => {
  await verifyM2Wrapper(page, 'psb', true);
});

test('native D3D9 line lists and strips match pinned device coverage and restore the GPU', async ({
  page,
}) => {
  const golden = JSON.parse(
    await readFile(new URL('../fixtures/native-d3d9-lines-golden.json', import.meta.url)),
  );
  await page.goto('/');
  const result = await page.evaluate(async (golden) => {
    const [{ loadUnicorn }, { PE32Process }, { EmoteD3D9 }, { ParticlesGL }] = await Promise.all([
        import('/src/ppi/backend.mjs'),
        import('/src/ppi/pe32.mjs'),
        import('/src/emote/native-d3d.mjs'),
        import('/src/render/particles-gl.mjs'),
      ]),
      unicorn = await loadUnicorn(),
      p = new PE32Process(unicorn),
      second = new PE32Process(unicorn),
      gpu = new ParticlesGL(8, 8),
      freshGPU = new ParticlesGL(8, 8),
      d = new EmoteD3D9(p, { width: 8, height: 8 }).attachGPU(gpu),
      fresh = new EmoteD3D9(second, { width: 8, height: 8 }).attachGPU(freshGPU),
      scratch = p.allocate(64, true),
      vertices = p.allocate(16 * 20, true),
      indices = p.allocate(16 * 4, true),
      full = [0, 0, 8, 8],
      same = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
      invoke = (p, object, slot, args = []) => {
        const value = p.call(p.load(p.load(object) + slot * 4), [object, ...args]);
        if (value) throw new Error('Native D3D9 slot ' + slot + ' returned ' + value.toString(16));
      },
      device = (slot, args) => invoke(p, d.device, slot, args),
      words = (values) => values.forEach((value, i) => p.store(scratch + 4 * i, value)),
      viewport = (rect) => {
        words([...rect, 0, 0x3f800000]);
        device(47, [scratch]);
      };
    try {
      words([8, 8, 21, 1, 0, 0, 1, 1, 1, 1, 75, 1, 0, 0x80000000]);
      invoke(p, d.d3d, 16, [0, 1, 1, 0x22, scratch, scratch + 56]);
      device(89, [68]);
      device(67, [0, 4, 4]);
      const failures = [];
      let comparisons = 0,
        exact = 0,
        rawMatches = 0,
        replayMatches = 0;
      for (const { name, probe, rgbaBase64, channelRounding = 0 } of golden.cases) {
        d.commands.length = 0;
        viewport(full);
        device(57, [194, 0]);
        device(43, [0, 0, 7, probe.clear, 0x3f800000, 0]);
        device(41);
        for (const draw of probe.draws) {
          for (const [id, value] of [...golden.lineRenderStates, ...(draw.states ?? [])])
            device(57, [id, value]);
          viewport(draw.viewport ?? full);
          words(draw.scissor ?? full);
          device(75, [scratch]);
          const bytes = new Uint8Array(draw.vertices.length * 20),
            data = new DataView(bytes.buffer),
            indexed = Boolean(draw.indexFormat),
            slot = indexed ? 84 : 83;
          draw.vertices.forEach(([x, y, z, w, color], i) => {
            [x, y, z, w].forEach((n, j) => data.setFloat32(i * 20 + 4 * j, n, true));
            data.setUint32(i * 20 + 16, color, true);
          });
          p.write(vertices, bytes);
          const indexBytes = indexed
            ? new Uint8Array(
                (draw.indexFormat === 101
                  ? Uint16Array.from(draw.indices)
                  : Uint32Array.from(draw.indices)
                ).buffer,
              )
            : null;
          if (indexBytes) p.write(indices, indexBytes);
          d.onDrawRaw = (raw) => {
            if (
              raw.slot !== slot ||
              raw.type !== draw.primitive ||
              raw.count !== draw.count ||
              raw.fvf !== 68 ||
              raw.stride !== 20 ||
              !same(raw.bytes, bytes) ||
              (indexed && !same(raw.indices, indexBytes))
            )
              throw new Error('The native line payload changed in ' + name);
            rawMatches++;
          };
          device(
            slot,
            indexed
              ? [
                  draw.primitive,
                  draw.minimum,
                  draw.vertexCount,
                  draw.count,
                  indices,
                  draw.indexFormat,
                  vertices,
                  20,
                ]
              : [draw.primitive, draw.count, vertices, 20],
          );
          if (!same(p.read(vertices, bytes.length), bytes))
            throw new Error('The native line draw wrote its source vertices');
        }
        device(42);
        const actual = gpu.pixels(d.gpuTarget(d.backbuffer)),
          expected = Uint8Array.from(atob(rgbaBase64), (byte) => byte.charCodeAt(0)),
          background = [probe.clear >>> 16, probe.clear >>> 8, probe.clear, probe.clear >>> 24].map(
            (word) => word & 255,
          );
        let maximum = 0,
          coverage = true;
        for (let i = 0; i < actual.length; i += 4) {
          const a = actual.subarray(i, i + 4),
            b = expected.subarray(i, i + 4);
          if (same(a, background) !== same(b, background)) coverage = false;
          for (let j = 0; j < 4; j++) maximum = Math.max(maximum, Math.abs(a[j] - b[j]));
        }
        if (maximum > channelRounding || !coverage) failures.push({ name, maximum, coverage });
        if (name === 'viewport' || name === 'line-strip') {
          freshGPU.beginFrame();
          d.replay(freshGPU);
          if (same(freshGPU.pixels(), actual)) replayMatches++;
          freshGPU.endNativeFrame();
        }
        comparisons += actual.length;
        if (!maximum) exact++;
      }
      d.onDrawRaw = undefined;
      const before = gpu.pixels(d.gpuTarget(d.backbuffer));
      second.restore(p.snapshot());
      fresh.restore(d.snapshot());
      const restored = same(freshGPU.pixels(fresh.gpuTarget(fresh.backbuffer)), before);
      invoke(second, fresh.device, 43, [0, 0, 1, 0xff000000, 0x3f800000, 0]);
      return {
        failures,
        comparisons,
        rawMatches,
        replayMatches,
        exact,
        restored,
        independent: same(gpu.pixels(d.gpuTarget(d.backbuffer)), before),
        errors: [gpu.gl.getError(), freshGPU.gl.getError()],
      };
    } finally {
      fresh.close();
      d.close();
      second.close();
      p.close();
      freshGPU.close();
      gpu.close();
    }
  }, golden);
  expect(result.failures).toEqual([]);
  expect(result.comparisons).toBe(126 * 8 * 8 * 4);
  expect(result.rawMatches).toBe(127);
  expect(result.replayMatches).toBe(2);
  expect(result.exact).toBeGreaterThanOrEqual(
    golden.cases.filter((row) => !row.channelRounding).length,
  );
  expect(result.restored).toBe(true);
  expect(result.independent).toBe(true);
  expect(result.errors).toEqual([0, 0]);
});
