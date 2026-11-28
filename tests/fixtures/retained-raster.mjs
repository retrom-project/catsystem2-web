// SPDX-License-Identifier: MPL-2.0
// Original artwork-free probes for the retained CPU renderer boundary.
export const RETAINED_RASTER_SIZE = [8, 7];
export function retainedRasterCases() {
  const source = (opaque = false) => ({
    width: 3,
    height: 4,
    bpp: 4,
    canvasWidth: 5,
    canvasHeight: 6,
    offsetX: 1,
    offsetY: 1,
    baseX: 0,
    baseY: 0,
    clip: [0, 0, 3, 4],
    attributes: [],
    source: null,
    rgba: Uint8ClampedArray.from(
      Array.from({ length: 12 }, (_, i) => [
        17 + (i % 3) * 80,
        13 + Math.floor(i / 3) * 59,
        213 - i * 11,
        opaque ? 255 : (37 + i * 19) % 256,
      ]).flat(),
    ),
  });
  const probes = [];
  for (const opaque of [false, true]) {
    for (const mode of [0, 1]) {
      for (const [family, values] of [
        ['normal', [0]],
        ['mask', [1, 2, 3, 4]],
        ['blendType', [1, 2, 3, 4, 5]],
      ]) {
        for (const value of values) {
          const image = source(opaque);
          image.mask = family === 'mask' ? value : 0;
          image.blendType = family === 'blendType' ? value : 0;
          probes.push({
            name: `${family}-${value}-${opaque ? 'opaque' : 'alpha'}-${mode ? 'affine' : 'integer'}`,
            source: image,
            clear: 0x806ba5d1,
            item: {
              key: 0x90001,
              layer: 3,
              position: [1, 0],
              base: [0, 0],
              rotation: mode ? 0.31 : 0,
              scale: mode ? [1.25, 0.85] : [1, 1],
              alpha: opaque ? 255 : 179,
              visible: true,
              mode,
              clip: [0, 0, 8, 7],
              aux: 0,
            },
            area: [0, 0, 8, 7],
          });
        }
      }
    }
  }
  for (const [name, patch, area] of [
    ['partial-clip', { clip: [2, 2, 5, 5] }, [1, 1, 7, 6]],
    ['negative-scale', { mode: 1, position: [5, 5], scale: [-1, -1] }, [0, 0, 8, 7]],
    ['anchor', { position: [4, 3], base: [2, 1] }, [0, 0, 8, 7]],
  ])
    probes.push({
      name,
      source: source(),
      clear: 0x806ba5d1,
      item: { ...probes[0].item, ...patch },
      area,
    });
  return probes;
}
