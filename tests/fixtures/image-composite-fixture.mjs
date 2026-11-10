// SPDX-License-Identifier: MPL-2.0
import { bitmapFactoryFixture } from './bitmap-factory-fixture.mjs';
import { NativeImageComposites } from '../../oracle/image-composite.mjs';
import { authoredHG3 } from './hg3.mjs';

export const IMAGE_COMPOSITE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    handler: 0x64c470,
    factory: 0x6746a0,
    wrapperBytes: 536,
    wrapperReferences: 532,
    cacheEnabled: 264,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    handler: 0x518fb0,
    factory: 0x54b790,
    wrapperBytes: 276,
    wrapperReferences: 272,
    cacheEnabled: 200,
  }),
});

export function imageCompositeFiles() {
  const pixels = (width, height, seed, alpha = 255) =>
      Uint8Array.from({ length: width * height * 4 }, (_, at) =>
        at % 4 === 3 ? alpha : (seed + at * 37) & 255,
      ),
    frames = [
      {
        id: 0,
        width: 3,
        height: 2,
        rgba: pixels(3, 2, 19),
        canvasWidth: 7,
        canvasHeight: 8,
        baseX: 2,
        baseY: 1,
      },
      {
        id: 0,
        width: 2,
        height: 3,
        rgba: pixels(2, 3, 57, 128),
        offsetX: 1,
        offsetY: 1,
        canvasWidth: 9,
        canvasHeight: 8,
        baseX: 2,
        baseY: 1,
      },
      {
        id: 0,
        width: 4,
        height: 1,
        rgba: pixels(4, 1, 91),
        bpp: 24,
        offsetX: -1,
        offsetY: 2,
        canvasWidth: 6,
        canvasHeight: 9,
        baseX: 1,
        baseY: 2,
      },
    ],
    files = new Map();
  for (const [index, frame] of frames.entries())
    files.set(`x_${'0'.repeat(index)}${index + 1}.hg3`, authoredHG3([frame]));
  files.set('single.hg3', authoredHG3(frames));
  files.set('rgb.hg3', authoredHG3([frames[2]]));
  files.set('abc_1.hg3', authoredHG3([frames[0]]));
  files.set('abc_02.hg3', authoredHG3([frames[1]]));
  // Game 6746A0 passes its three-byte narrow basename to wsprintfW("%s_").
  // These names are authored input for that original wide interpretation.
  files.set('\u6261c_1.hg3', files.get('abc_1.hg3'));
  files.set('\u6261c_02.hg3', files.get('abc_02.hg3'));
  files.set('missing.hg3', new Uint8Array());
  files.set('broken.hg3', Uint8Array.of(12, 34, 56, 78));
  return { files, frames };
}

export async function imageCompositeFixture(bytes, profile) {
  const f = await bitmapFactoryFixture(bytes, profile),
    authored = imageCompositeFiles(),
    requests = [];
  for (const [name, data] of authored.files) f.files.set(name, data);
  f.world.game.nativeResources = { resolve: (name) => name };
  f.world.game.read = async (name) => {
    requests.push(name);
    await Promise.resolve();
    return f.files.get(name) ?? f.files.get('@cat/image/' + name) ?? null;
  };
  const composites = new NativeImageComposites(f.engine, f.world);
  return {
    ...f,
    frames: authored.frames,
    requests,
    composites,
    layout: IMAGE_COMPOSITE_LAYOUTS[profile],
  };
}

export function originalBitmap(p, wrapper) {
  if (!wrapper) return null;
  const bitmap = p.load(wrapper),
    stride = p.load(bitmap + 20),
    height = p.load(bitmap + 8);
  return {
    wrapper,
    bitmap,
    metadata: p.read(bitmap, 92),
    pixels: p.read(p.load(bitmap + 12), stride * height),
  };
}
