// SPDX-License-Identifier: MPL-2.0
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';

// The virtual VRAM is 3072x6656 (over 64 MiB as RGBA), but only three
// 64x64 pages exist. Exercise the original clear through both KCS and host.
export async function exerciseTextureClear(profile, files, stageRendererFactory) {
  const make = () => {
      const names = [...files.keys()],
        game = {
          width: 16,
          height: 16,
          index: new Map(names.map((name) => [name, {}])),
          names: (ext) => names.filter((name) => name.endsWith('.' + ext)),
          has: (name) => files.has(name.toLowerCase()),
          read: async (name) => files.get(name.toLowerCase()) ?? null,
          async require(name) {
            const bytes = await this.read(name);
            if (bytes === null) throw new Error('Missing ' + name);
            return bytes;
          },
          resolveCategory(name, category) {
            const path = this.has(name) ? name : `@cat/${category}/${name}`;
            return this.has(path) ? path : null;
          },
          readCategory(name, category) {
            return this.read(this.resolveCategory(name, category));
          },
        },
        configuration = new NativeConfiguration({ profile }),
        texture = configuration.fields.texture,
        random = new ParticleRandom();
      Object.assign(configuration.screen, {
        width: 16,
        height: 16,
        currentWidth: 16,
        currentHeight: 16,
        virtualWidth: 16,
        virtualHeight: 16,
      });
      texture.size.set([64, 64]);
      texture.grid.set([48, 104]);
      texture.bppY.set([1, 1]);
      texture.bpp = 32;
      for (const area of texture.areas) area.fill(0xffffffff);
      texture.areas[0].set([0, 0, 2, 1]);
      texture.areas[1].set([47, 103, 1, 1]);
      const world = new NativeWorld({
        game,
        profile,
        configuration,
        random,
        images: {},
        host: {},
        motionLibrary: new MotionLibrary(game, { profile, random }),
        storage: { read: async () => null, write: async () => true },
      });
      if (stageRendererFactory) world.stageRenderer = stageRendererFactory();
      return world;
    },
    world = make(),
    checks = {},
    indices = [0, 1, 48 * 104 - 1],
    zero = (array) => array.every((value) => value === 0),
    equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
  let fresh;
  try {
    await world.initialize('main.kcs');
    world.graphics.initializeTextures();
    const graphics = world.graphics,
      platform = await world.getNativeFeature('graphics-platform'),
      pages = graphics.texturePages,
      d3d = world.nativeEngine.features.get('renderer').d3d,
      p = world.nativeEngine.process,
      ids = indices.map((index) => pages.texture(index)),
      handle = graphics.images.create(8, 4),
      source = graphics.images.get(handle);
    await source.fill(0, 0, 8, 4, 0x87314365);
    await platform.withBitmap(source, async (pointer) => {
      await platform.rawBitmapUpload(pointer, 0, 0, 8, 4, 60, 2);
      await platform.rawBitmapUpload(pointer, 0, 0, 8, 4, 47 * 64, 103 * 64);
    });
    const before = indices.map((index) => pages.frame(index).rgba.slice()),
      shadow = await graphics.ensureVRAM(16, 16);
    checks.ditherPixel = equal(before[2].subarray(0, 4), [51, 68, 119, 136]);
    const gpuPixel = (owner, page) => {
      const gpu = owner.getNativeGPU();
      gpu.beginFrame(0xffabcdef);
      gpu.drawGeometry(
        [
          {
            vertices: [
              [0, 0],
              [8, 0],
              [0, 4],
              [8, 4],
            ].map(([x, y]) => ({
              x: x - 0.5,
              y: y - 0.5,
              z: 0,
              w: 1,
              color: 0xffffffff,
              u: x / 64,
              v: y / 64,
            })),
          },
        ],
        page,
        {
          renderStates: [
            [27, 0],
            [15, 0],
          ],
        },
      );
      gpu.endFrame();
      return gpu.pixels().slice((16 + 2) * 4, (16 + 3) * 4);
    };
    if (stageRendererFactory) checks.gpuSeed = !zero(gpuPixel(world, pages.frame(indices[2])));
    await shadow.fill(0, 0, 16, 16, 0xff123456);
    const originalTransfer = platform.withBitmap,
      originalEnsure = graphics.ensureVRAM,
      call = (args) => world.runtime.native('main', 0x75, args, world.main.machine, world.main);
    platform.withBitmap = () => {
      throw new Error('A native page clear must not construct a temporary bitmap');
    };
    graphics.ensureVRAM = () => {
      throw new Error('A native page clear must not grow the CPU VRAM shadow');
    };
    try {
      await call([0, 62, 2, 4, 3, 0xffffffff]);
      checks.partial = indices.every((index, i) => {
        const actual = pages.frame(index).rgba,
          expected = before[i].slice();
        if (i < 2)
          for (let y = 2; y < 5; y++)
            for (let x = Math.max(0, 62 - i * 64); x < Math.min(64, 66 - i * 64); x++)
              expected.fill(0, (y * 64 + x) * 4, (y * 64 + x + 1) * 4);
        return equal(actual, expected);
      });
      const enabled = p.load(platform.refs.view + 52),
        unchanged = pages.frame(0).rgba.slice();
      p.store(platform.refs.view + 52, 0);
      try {
        checks.gate =
          (await platform.clearBitmap(0, 0, 3072, 6656)) === 0 &&
          equal(pages.frame(0).rgba, unchanged);
      } finally {
        p.store(platform.refs.view + 52, enabled);
      }
      await graphics.fill(1, 1, 2, 2);
      const pixels = await shadow.pixels();
      checks.shadow =
        shadow.width === 16 &&
        shadow.height === 16 &&
        zero(pixels.subarray((1 * 16 + 1) * 4, (1 * 16 + 3) * 4)) &&
        equal(pixels.subarray(0, 4), Uint8Array.of(0x12, 0x34, 0x56, 255));
      await call([0, 0, 0, 3072, 6656, 0xffffffff]);
      checks.cleared = indices.every((index) => zero(pages.frame(index).rgba));
      if (stageRendererFactory) checks.gpuClear = zero(gpuPixel(world, pages.frame(indices[2])));
      checks.shadowCleared = zero(await shadow.pixels());
      checks.identity = indices.every((index, i) => pages.texture(index) === ids[i]);
      checks.sparse = pages.texture(2) === 0 && pages.texture(48 * 103) === 0;
      checks.formats = equal(
        ids.map((id) => d3d.textureData(id).format),
        [21, 21, 26],
      );
    } finally {
      platform.withBitmap = originalTransfer;
      graphics.ensureVRAM = originalEnsure;
    }
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    fresh.graphics.initializeTextures();
    const restored = fresh.graphics.texturePages;
    checks.fresh = indices.every(
      (index, i) => restored.texture(index) === ids[i] && zero(restored.frame(index).rgba),
    );
    checks.freshSparse = restored.texture(2) === 0 && restored.texture(48 * 103) === 0;
    if (stageRendererFactory) checks.gpuFresh = zero(gpuPixel(fresh, restored.frame(indices[2])));
    const restoredPlatform = await fresh.getNativeFeature('graphics-platform'),
      restoredSource = fresh.graphics.images.get(handle);
    await restoredPlatform.withBitmap(restoredSource, (pointer) =>
      restoredPlatform.rawBitmapUpload(pointer, 0, 0, 8, 4, 47 * 64, 103 * 64),
    );
    checks.dither = equal(restored.frame(indices[2]).rgba, before[2]);
    await fresh.graphics.fill(0, 0, 3072, 6656);
    checks.freshClear = zero(restored.frame(indices[2]).rgba);
    return checks;
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
