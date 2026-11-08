// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { nativeParticleFixture } from '../fixtures/ppi-native-fixture.mjs';

test('nested native render targets restore the caller depth surface and reuse validated attachments', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(8, 8),
      target = gpu.createRenderTarget(8, 8),
      a = gpu.createDepthStencil(8, 8),
      b = gpu.createDepthStencil(8, 8),
      gl = gpu.gl,
      check = gl.checkFramebufferStatus.bind(gl);
    let checks = 0,
      outer = false,
      inner = false,
      restored = false;
    gl.checkFramebufferStatus = (...args) => {
      checks++;
      return check(...args);
    };
    const attachment = () =>
      gl.getFramebufferAttachmentParameter(
        gl.FRAMEBUFFER,
        gl.DEPTH_STENCIL_ATTACHMENT,
        gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
      );
    try {
      gpu.withRenderTarget(
        target,
        () => gpu.clear({ flags: 7, color: 0xff112233, depth: 0x3e800000, stencil: 37 }),
        { depthStencil: a },
      );
      const initial = checks;
      for (let i = 0; i < 32; i++) gpu.withRenderTarget(target, () => {}, { depthStencil: a });
      const repeated = checks;
      gpu.withRenderTarget(
        target,
        () => {
          outer = attachment() === a.texture;
          gpu.withRenderTarget(
            target,
            () => {
              inner = attachment() === b.texture;
              gpu.clear({ flags: 6, depth: 0x3f400000, stencil: 173 });
            },
            { depthStencil: b },
          );
          restored = attachment() === a.texture;
        },
        { depthStencil: a },
      );
      const nested = checks,
        aa = gpu.snapshotDepthStencil(a).bytes,
        bb = gpu.snapshotDepthStencil(b).bytes;
      return {
        initial,
        repeated,
        nested,
        outer,
        inner,
        restored,
        a: [...aa.slice(0, 4)],
        b: [...bb.slice(0, 4)],
        color: [...gpu.pixels(target).slice(0, 4)],
        error: gl.getError(),
      };
    } finally {
      gpu.close();
    }
  });
  expect(result.outer && result.inner && result.restored).toBe(true);
  expect(result.repeated).toBe(result.initial);
  expect(result.nested - result.repeated).toBe(2);
  expect(result.a[3]).toBe(37);
  expect(result.b[3]).toBe(173);
  const depth = (bytes) => (bytes[0] * 65536 + bytes[1] * 256 + bytes[2]) / 16777215;
  expect(Math.abs(depth(result.a) - 0.25)).toBeLessThan(0.000001);
  expect(Math.abs(depth(result.b) - 0.75)).toBeLessThan(0.000001);
  expect(result.color).toEqual([17, 34, 51, 255]);
  expect(result.error).toBe(0);
});

test('particle compositor preserves the destination and uses all six native blend factors', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs');
    const background = new OffscreenCanvas(8, 8),
      ctx = background.getContext('2d'),
      gpu = new ParticlesGL(8, 8),
      geometry = [
        {
          vertices: [
            [0, 0, 0, 0],
            [8, 0, 1, 0],
            [0, 8, 0, 1],
            [8, 8, 1, 1],
          ].map(([x, y, u, v]) => ({ x, y, z: 0.5, w: 1, color: 0xffffffff, u, v })),
        },
      ],
      texture = { width: 1, height: 1, rgba: new Uint8Array([64, 128, 192, 128]) };
    const read = (canvas) => {
      const out = new OffscreenCanvas(8, 8),
        target = out.getContext('2d');
      target.drawImage(canvas, 0, 0);
      return [...target.getImageData(3, 3, 1, 1).data];
    };
    try {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 8, 4);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 4, 8, 4);
      const copy = gpu.render([], texture, background);
      const out = new OffscreenCanvas(8, 8),
        other = out.getContext('2d');
      other.drawImage(copy, 0, 0);
      const top = [...other.getImageData(1, 1, 1, 1).data],
        bottom = [...other.getImageData(1, 6, 1, 1).data];
      const modes = [];
      for (let blendMode = 0; blendMode < 6; blendMode++) {
        ctx.fillStyle = 'rgb(32,64,96)';
        ctx.fillRect(0, 0, 8, 8);
        modes.push(read(gpu.render(geometry, texture, background, { blendMode })));
      }
      return { top, bottom, modes };
    } finally {
      gpu.close();
    }
  });
  expect(result.top).toEqual([255, 0, 0, 255]);
  expect(result.bottom).toEqual([0, 0, 255, 255]);
  const expected = [
    [48, 96, 144],
    [64, 128, 192],
    [80, 160, 240],
    [8, 32, 72],
    [56, 96, 120],
    [40, 96, 168],
  ];
  for (let mode = 0; mode < 6; mode++)
    for (let channel = 0; channel < 3; channel++)
      expect(
        Math.abs(result.modes[mode][channel] - expected[mode][channel]),
        `mode ${mode}, channel ${channel}`,
      ).toBeLessThanOrEqual(1);
});

test('PPI sampler address modes and deformed colored quads use supplied vertex data', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs');
    const background = new OffscreenCanvas(8, 8),
      ctx = background.getContext('2d'),
      gpu = new ParticlesGL(8, 8),
      texture = { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
    const read = (canvas) => {
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(canvas, 0, 0);
      return [...ctx.getImageData(3, 3, 1, 1).data];
    };
    const vertices = [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ].map(([x, y]) => ({ x, y, z: 0.5, w: 1, color: 0xffffffff, u: 1.25, v: 0.5 }));
    try {
      const address = [];
      for (let mode = 1; mode <= 5; mode++)
        address.push(
          read(
            gpu.render([{ vertices }], texture, background, {
              samplerStates: [
                [1, mode],
                [4, 0xff00ff00],
                [5, 1],
                [6, 1],
              ],
            }),
          ),
        );
      const quad = [
        {
          vertices: [
            [1, 1, 0xffff0000],
            [7, 0, 0xff00ff00],
            [0, 7, 0xff0000ff],
            [6, 6, 0xffffffff],
          ].map(([x, y, color]) => ({ x, y, z: 0.5, w: 1, color, u: 0, v: 0 })),
        },
      ];
      const white = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
      ctx.globalCompositeOperation = 'copy';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 8, 8);
      read(gpu.render(quad, white, background));
      return {
        address,
        middle: [...ctx.getImageData(3, 3, 1, 1).data],
        outside: [...ctx.getImageData(7, 7, 1, 1).data],
      };
    } finally {
      gpu.close();
    }
  });
  expect(result.address).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(result.middle[0]).toBeGreaterThan(0);
  expect(result.middle[1]).toBeGreaterThan(0);
  expect(result.middle[2]).toBeGreaterThan(0);
  expect(result.outside).toEqual([0, 0, 0, 255]);
});

test('an authored PE32 particle runs in the browser and restores a new process without reinitializing its private object', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (fixture) => {
      const [{ NativePPI }, { loadUnicorn }] = await Promise.all([
        import('/src/ppi/native.mjs'),
        import('/src/ppi/backend.mjs'),
      ]);
      const bytes = Uint8Array.from(fixture),
        options = {
          unicornFactory: loadUnicorn,
          name: 'authored.ppi',
          count: 1,
          width: 64,
          height: 32,
          screenWidth: 1280,
          screenHeight: 720,
          now: () => 0,
          epoch: 0,
        };
      const p = await NativePPI.open(bytes, options);
      let q;
      try {
        p.update(0);
        const state = p.snapshot();
        p.update(15);
        const expected = [...p.records()];
        q = await NativePPI.fromSnapshot(state, { ...options, readPlugin: async () => bytes });
        q.update(15);
        return {
          same: JSON.stringify(expected) === JSON.stringify([...q.records()]),
          count: q.particles()[0].disp,
          version: q.version,
        };
      } finally {
        q?.close();
        p.close();
      }
    },
    [...nativeParticleFixture()],
  );
  expect(result).toEqual({ same: true, count: 2, version: 0x20002 });
});

test('original D3D9 pixel golden verifies blends, RHW interpolation, sampler addressing and half texels', async ({
  page,
}) => {
  const fs = await import('node:fs/promises'),
    golden = JSON.parse(
      await fs.readFile(new URL('../fixtures/ppi-d3d9-golden.json', import.meta.url)),
    );
  await page.goto('/');
  const differences = await page.evaluate(async (golden) => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(8, 8),
      base = new OffscreenCanvas(8, 8),
      ctx = base.getContext('2d'),
      out = new OffscreenCanvas(8, 8),
      read = out.getContext('2d');
    const result = [];
    try {
      for (let mode = 0; mode < 15; mode++) {
        ctx.fillStyle = 'rgb(32,64,96)';
        ctx.fillRect(0, 0, 8, 8);
        const vertices = [
          [0, 0, 0, 0],
          [8, 0, 1, 0],
          [0, 8, 0, 1],
          [8, 8, 1, 1],
        ].map(([x, y, u, v], i) => ({
          x,
          y,
          z: 0.5,
          w: [6, 13, 14].includes(mode) ? [1, 0.5, 0.25, 0.125][i] : 1,
          color:
            mode < 6
              ? 0x804080c0
              : mode === 6
                ? [0xffff0000, 0xff00ff00, 0xff0000ff, 0xffffffff][i]
                : mode === 14
                  ? [0x00ffffff, 0x40ffffff, 0x80ffffff, 0xffffffff][i]
                  : 0xffffffff,
          u: mode >= 7 && mode <= 11 ? 1.25 : u,
          v: mode >= 7 && mode <= 11 ? 0.5 : v,
        }));
        const pixels =
          mode < 7 || mode === 14
            ? new Uint8Array([255, 255, 255, 255])
            : Uint8Array.from(
                Array.from({ length: 8 }, (_, i) =>
                  mode === 12
                    ? i === 0
                      ? [255, 0, 0, 255]
                      : [0, 0, 0, 255]
                    : mode === 13
                      ? [i * 36, i * 36, i * 36, 255]
                      : i < 4
                        ? [255, 0, 0, 255]
                        : [0, 0, 255, 255],
                ).flat(),
              );
        const frame = { width: pixels.length / 4, height: 1, rgba: pixels };
        const canvas = gpu.render([{ vertices }], frame, base, {
          blendMode: mode < 6 ? mode : 0,
          renderStates:
            mode >= 6
              ? [
                  [19, 2],
                  [20, 1],
                ]
              : [],
          samplerStates:
            mode >= 7 && mode <= 13
              ? [
                  [1, mode <= 11 ? mode - 6 : 2],
                  [2, 2],
                  [4, 0xff00ff00],
                  [5, mode === 12 ? 2 : 1],
                  [6, mode === 12 ? 2 : 1],
                ]
              : [],
        });
        read.globalCompositeOperation = 'copy';
        read.drawImage(canvas, 0, 0);
        const actual = gpu.pixels(),
          expected = atob(golden.cases[mode].rgbaBase64);
        let max = 0,
          count = 0,
          nearestTies = 0;
        const first = [];
        for (let i = 0; i < actual.length; i++) {
          const d = Math.abs(actual[i] - expected.charCodeAt(i));
          if (mode === 13 && d > 1 && i % 4 < 3) {
            const pixel = i >> 2,
              x = (pixel % 8) / 8,
              y = Math.floor(pixel / 8) / 8,
              q =
                x + y <= 1
                  ? 1 - x - y + x * 0.5 + y * 0.25
                  : (1 - x) * 0.25 + (1 - y) * 0.5 + (x + y - 1) * 0.125;
            const numerator = x + y <= 1 ? x * 0.5 : (1 - y) * 0.5 + (x + y - 1) * 0.125,
              at = (numerator / q) * 8,
              k = Math.round(at);
            if (
              Math.abs(at - k) < 1e-6 &&
              [Math.max(0, k - 1) * 36, Math.min(7, k) * 36].includes(actual[i]) &&
              [Math.max(0, k - 1) * 36, Math.min(7, k) * 36].includes(expected.charCodeAt(i))
            ) {
              nearestTies++;
              continue;
            }
          }
          if (d) {
            count++;
            if (first.length < 12)
              first.push({ at: i, actual: actual[i], expected: expected.charCodeAt(i) });
          }
          max = Math.max(max, d);
        }
        result.push({ name: golden.cases[mode].name, max, count, nearestTies, first });
      }
      return result;
    } finally {
      gpu.close();
    }
  }, golden);
  for (const row of differences) expect(row.max, JSON.stringify(row)).toBeLessThanOrEqual(1);
});

test('a shared frame retains native destination alpha and depth across separate draw submissions', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(8, 8),
      white = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
    const quad = (color, z = 0.5) => [
      {
        vertices: [
          [0, 0],
          [8, 0],
          [0, 8],
          [8, 8],
        ].map(([x, y]) => ({ x, y, z, w: 1, color, u: 0, v: 0 })),
      },
    ];
    const pixel = () => [...gpu.pixels().slice(108, 112)];
    try {
      gpu.beginFrame(0xff204060);
      gpu.drawGeometry(quad(0x804080c0), white);
      gpu.drawGeometry(quad(0x804080c0), white, {
        renderStates: [
          [19, 7],
          [20, 1],
        ],
      });
      gpu.endFrame();
      const alpha = pixel();
      gpu.beginFrame(0xff204060);
      gpu.drawGeometry(quad(0x804080c0), white, { blendMode: 4 });
      gpu.drawGeometry(quad(0x804080c0), white, {
        renderStates: [
          [19, 7],
          [20, 1],
        ],
      });
      gpu.endFrame();
      const zero = pixel();
      gpu.beginFrame(0xff000000);
      gpu.drawGeometry(quad(0xffff0000, 0.25), white, { renderStates: [[7, 1]] });
      gpu.drawGeometry(quad(0xff0000ff, 0.75), white, { renderStates: [[7, 1]] });
      gpu.endFrame();
      const depth = pixel();
      return { alpha, zero, depth };
    } finally {
      gpu.close();
    }
  });
  expect(result.alpha).toEqual([48, 96, 144, 96]);
  expect(result.zero).toEqual([0, 0, 0, 0]);
  expect(result.depth).toEqual([255, 0, 0, 255]);
});

test('native D3D9 fog and sRGB states retain gamma-correct blending and render-target alpha', async ({
  page,
}) => {
  const fs = await import('node:fs/promises'),
    golden = JSON.parse(
      await fs.readFile(new URL('../fixtures/ppi-d3d9-golden.json', import.meta.url)),
    );
  await page.goto('/');
  const differences = await page.evaluate(async (cases) => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      gpu = new ParticlesGL(8, 8);
    try {
      return cases.map(({ name, probe, rgbaBase64, hardwareDependent, lineEndpointCoverage }) => {
        gpu.beginFrame(probe.clear);
        for (const draw of probe.draws)
          gpu.drawGeometry(
            [{ vertices: draw.vertices }],
            { ...draw.texture, rgba: new Uint8Array(draw.texture.rgba) },
            draw,
          );
        gpu.endFrame();
        const actual = gpu.pixels(),
          expected = atob(rgbaBase64);
        let max = 0;
        const mean = [0, 0, 0, 0];
        const first = [];
        for (let i = 0; i < actual.length; i++) {
          const d = Math.abs(actual[i] - expected.charCodeAt(i));
          mean[i % 4] += (actual[i] - expected.charCodeAt(i)) / 64;
          if (lineEndpointCoverage && d > 1) {
            const pixel = i >> 2,
              x = pixel % 8,
              y = Math.floor(pixel / 8),
              antialiased = probe.draws[0].renderStates.some(([id, v]) => id === 176 && v);
            if (
              probe.draws[0].vertices.some(
                (v) => Math.hypot(v.x - x, v.y - y) <= (antialiased ? 1 : 0),
              )
            )
              continue;
          }
          max = Math.max(max, d);
          if (d > 1 && first.length < 8)
            first.push({ at: i, actual: actual[i], expected: expected.charCodeAt(i) });
        }
        return { name, max, first, mean, hardwareDependent };
      });
    } finally {
      gpu.close();
    }
  }, golden.cases.slice(15));
  for (const row of differences) {
    if (row.hardwareDependent) {
      // AF is a device capability with implementation-dependent filter kernels.
      // Both independent backends must retain the periodic texture's energy;
      // point/bilinear substitution changes red from ~63 to ~128 for this probe.
      for (const channel of row.mean)
        expect(Math.abs(channel), JSON.stringify(row)).toBeLessThanOrEqual(3);
    } else expect.soft(row.max, JSON.stringify(row)).toBeLessThanOrEqual(1);
  }
});

test('StageRenderer orders a real native plane and x86 particle task into one destination-alpha target', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (bytes) => {
      const { NativeObjects } = await import('/src/native/objects.mjs'),
        { NativeHandles } = await import('/src/native/handles.mjs'),
        { installNativeGraphics, nativeGraphics } = await import('/src/native/graphics.mjs'),
        { installNativeParticles, nativeParticles } = await import('/src/native/particles.mjs'),
        { StageRenderer } = await import('/src/render/stage.mjs'),
        { ParticleRandom } = await import('/src/ppi/random.mjs'),
        { KCSMachine, floatBits } = await import('/src/kcs.mjs'),
        { Binary } = await import('/src/binary.mjs');
      const objects = new NativeObjects(),
        canvas = new OffscreenCanvas(8, 8),
        image = { width: 8, height: 8, rgba: new Uint8Array(256).fill(255) },
        images = { frame: async () => image },
        world = {
          frame: 0,
          objects,
          images,
          random: new ParticleRandom(),
          host: {},
          game: {
            width: 8,
            height: 8,
            has: (name) => ['ptclpi/probe.ppi', 'image/quad.hg3'].includes(name),
            require: async () => new Uint8Array(bytes),
          },
          runtime: {
            handles: new NativeHandles(),
            register() {},
            services: { format: (address, current) => current.string(address) },
          },
          base: (record) => ({
            message: () => 0,
            snapshot: () => ({ id: record.id }),
            restore() {},
          }),
          input: { unregister() {} },
          nativeTaskID: (id) => id,
          resolveTaskID: (id) => id,
          sendNativeEngine: (target, sender, message, w, l, context) =>
            objects.objects.get(target).implementation.message([sender, message, w, l], context),
        };
      objects.register(0, (record) => world.base(record));
      installNativeGraphics(world);
      installNativeParticles(world);
      const placeholder = await objects.create({ kind: 0 }),
        plane = await objects.create({ kind: 2, parent: placeholder }),
        particle = await objects.create({ kind: 16, parent: placeholder }),
        machine = new KCSMachine({
          body: new Binary(new Uint8Array([59])),
          codeSize: 1,
          data: new Uint8Array(1024),
          stackSize: 256,
        }),
        sender = { id: 900 };
      machine.writeString('probe', 32);
      machine.writeString('quad', 64);
      await nativeGraphics(
        0x4f,
        [plane, floatBits(8), floatBits(8), 0x80204060],
        machine,
        sender,
        world,
      );
      await nativeParticles(
        0x2b5,
        [particle, 32, 64, 1, floatBits(10000), 128],
        machine,
        sender,
        world,
      );
      await nativeParticles(0x110, [particle], machine, sender, world);
      const bank = world.particles.get(particle).bank;
      bank.instance.renderStates.set(19, 7);
      bank.instance.renderStates.set(20, 1);
      world.frame = 1;
      await objects.tick(1);
      const renderer = {
          canvas,
          ctx: canvas.getContext('2d'),
          images,
          begin() {
            this.ctx.reset();
          },
        },
        emote = { prepare: async () => {}, drawing: () => null },
        stageRenderer = new StageRenderer(renderer, emote);
      try {
        await stageRenderer.render(world.graphics.stage, null, world.particles.drawItems());
        return {
          native: [...stageRenderer.gpu.pixels().slice(108, 112)],
          presented: [...renderer.ctx.getImageData(3, 3, 1, 1).data],
          items: world.particles.drawItems().length,
        };
      } finally {
        for (const id of [...objects.objects.keys()].reverse()) await objects.release(id);
        world.particles.close();
        stageRenderer.gpu.close();
      }
    },
    [...nativeParticleFixture({ color: 0x804080c0 })],
  );
  expect(result).toEqual({ native: [48, 96, 144, 96], presented: [48, 96, 144, 255], items: 1 });
});
