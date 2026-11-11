import { installGraphicsOracle } from './graphics-oracle-world.mjs';
// SPDX-License-Identifier: MPL-2.0
import { createTextureMemoryWorld } from './texture-clear-fixture.mjs';

export async function exerciseTextureUpload(profile, files, stageRendererFactory) {
  const make = () => {
      const world = installGraphicsOracle(
        createTextureMemoryWorld(profile, files, stageRendererFactory),
      );
      world.configuration.fields.texture.areas[0].set([0, 0, 2, 2]);
      return world;
    },
    world = make(),
    indices = [0, 1, 48, 49, 48 * 104 - 1],
    checks = {},
    equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
  let fresh;
  try {
    await world.initialize('main.kcs');
    world.graphics.initializeTextures();
    const graphics = world.graphics,
      platform = await world.getNativeFeature('graphics-platform'),
      pages = graphics.texturePages,
      p = world.nativeEngine.process,
      d3d = world.nativeEngine.features.get('renderer').d3d,
      handle = graphics.images.create(80, 80),
      bitmap = graphics.images.get(handle),
      rgba = await bitmap.pixels(),
      nativeBytes = (owner, actual) => {
        const backend = owner.nativeEngine.features.get('renderer').d3d;
        return indices.map((index) => {
          const texture = backend.textureData(actual.texture(index));
          return owner.nativeEngine.process.read(texture.pixels, texture.pitch * texture.height);
        });
      };
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 80; x++)
        rgba.set(
          [(x * 29 + y * 7 + 3) & 255, (x * 3 + y * 43) & 255, (x ^ (y * 13)) & 255, 127],
          (y * 80 + x) * 4,
        );
    await bitmap.changed();
    bitmap.state.clip = [7, 9, 10, 12];
    const originalUpload = async (source, rectangle, destination) => {
      const frame = await source.frame();
      await platform.withBitmap(source, async (pointer) => {
        const data = p.load(pointer + 12),
          stride = p.load(pointer + 20),
          bytes = p.read(data, stride * frame.height);
        for (let y = 0; y < frame.height; y++)
          for (let x = 0; x < frame.width; x++) {
            const input = (y * frame.width + x) * 4,
              at = y * stride + x * 4;
            bytes.set(
              [
                frame.rgba[input + 2],
                frame.rgba[input + 1],
                frame.rgba[input],
                frame.rgba[input + 3],
              ],
              at,
            );
          }
        p.write(data, bytes);
        const [left, top, right, bottom] = rectangle;
        await platform.rawBitmapUpload(
          pointer,
          left,
          top,
          right - left,
          bottom - top,
          ...destination,
        );
      });
    };
    let count = 0;
    for (const [name, rectangle, origin] of [
      ['subset', [4, 3, 15, 10], [0, 0]],
      ['fourPages', [61, 60, 73, 71], [0, 0]],
      ['negative', [-3, -2, 8, 7], [0, 0]],
      ['sourceClip', [75, 76, 90, 92], [0, 0]],
      ['origin', [61, 60, 73, 71], [3, 5]],
      ['negativeOrigin', [-2, -3, 9, 10], [-4, -5]],
      ['missingPages', [128, 0, 140, 12], [128, 0]],
      ['empty', [4, 3, 4, 10], [0, 0]],
    ]) {
      bitmap.state.offsetX = origin[0];
      bitmap.state.offsetY = origin[1];
      await platform.clearBitmap(0, 0, 3072, 6656);
      await originalUpload(bitmap, rectangle, rectangle.slice(0, 2));
      const expected = nativeBytes(world, pages);
      await platform.clearBitmap(0, 0, 3072, 6656);
      await pages.upload(bitmap, rectangle);
      checks[name] = nativeBytes(world, pages).every((bytes, i) => equal(bytes, expected[i]));
      count++;
    }
    checks.originalCases = count === 8;
    bitmap.state.offsetX = bitmap.state.offsetY = 0;
    await platform.clearBitmap(0, 0, 3072, 6656);
    await originalUpload(bitmap, [0, 0, 80, 80], [2992, 6576]);
    const expected = nativeBytes(world, pages),
      ids = indices.map((index) => pages.texture(index)),
      transfer = platform.withBitmap,
      sizes = [];
    platform.withBitmap = function (source, ...args) {
      sizes.push([source.width, source.height]);
      if (source.width > 64 || source.height > 64)
        throw new Error('Native VRAM upload must transfer only an allocated-page intersection');
      return transfer.call(this, source, ...args);
    };
    try {
      await platform.clearBitmap(0, 0, 3072, 6656);
      await graphics.output(bitmap, [2992, 6576]);
      checks.highCoordinates = nativeBytes(world, pages).every((bytes, i) =>
        equal(bytes, expected[i]),
      );
      checks.bounded = sizes.length === 1 && equal(sizes[0], [64, 64]);
      sizes.length = 0;
      await pages.upload(graphics.images.get(graphics.vramHandle));
      checks.sparseWhole =
        sizes.length === indices.length &&
        nativeBytes(world, pages).every((bytes, i) => equal(bytes, expected[i]));
      checks.identity = indices.every((index, i) => pages.texture(index) === ids[i]);
      checks.missing = pages.texture(2) === 0 && pages.texture(48 * 103) === 0;
    } finally {
      platform.withBitmap = transfer;
    }
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    fresh.graphics.initializeTextures();
    checks.fresh = nativeBytes(fresh, fresh.graphics.texturePages).every((bytes, i) =>
      equal(bytes, expected[i]),
    );
    checks.freshIdentity = indices.every(
      (index, i) => fresh.graphics.texturePages.texture(index) === ids[i],
    );
    if (stageRendererFactory) {
      const sample = (owner, frame) => {
          const gpu = owner.getNativeGPU();
          gpu.beginFrame(0xffabcdef);
          gpu.drawGeometry(
            [
              {
                vertices: [
                  [0, 0],
                  [8, 0],
                  [0, 8],
                  [8, 8],
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
            frame,
            {
              renderStates: [
                [27, 0],
                [15, 0],
              ],
            },
          );
          gpu.endFrame();
          return gpu.pixels().slice((16 + 2) * 4, (16 + 3) * 4);
        },
        frame = pages.frame(indices[4]),
        expectedPixel = frame.rgba.subarray((64 + 2) * 4, (64 + 3) * 4);
      checks.gpu = equal(sample(world, frame), expectedPixel);
      checks.gpuFresh = equal(
        sample(fresh, fresh.graphics.texturePages.frame(indices[4])),
        expectedPixel,
      );
    }
    checks.formats = equal(
      ids.map((id) => d3d.textureData(id).format),
      [21, 21, 26, 26, 26],
    );
    return checks;
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
