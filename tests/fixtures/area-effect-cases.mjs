// SPDX-License-Identifier: MPL-2.0
export async function authoredAreaBitmaps(world) {
  const handles = [];
  for (let image = 0; image < 3; image++) {
    const handle = world.graphics.images.create(8, 6, world.main.id),
      bitmap = world.graphics.images.get(handle),
      pixels = await bitmap.pixels();
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 8; x++) {
        pixels.set(
          image === 0
            ? [23 + x * 19, 61 + y * 23, 181 - x * 17, (x + y) % 3 ? 255 : 96]
            : image === 1
              ? [219 - x * 23, 31 + y * 13, 37 + x * 17, 225]
              : [71, 13, [0, 32, 64, 96, 128, 160, 192, 255][x], 255],
          (y * 8 + x) * 4,
        );
      }
    await bitmap.changed();
    handles.push(handle);
  }
  return handles;
}
export function recordAreaUploads(world) {
  const uploads = [];
  world.graphics.output = async (bitmap, offset, region) => {
    const frame = await bitmap.frame();
    uploads.push({
      width: frame.width,
      height: frame.height,
      offset: [...offset],
      region: region && [...region],
      pixels: [...frame.rgba],
    });
  };
  return uploads;
}
export function areaPixelParameters(probe, [source, destination, mask]) {
  const duration = probe.duration ?? 4,
    blend = probe.blendDuration ?? 2,
    from = [source, ...(probe.sourceOrigin ?? [0, 0])],
    to = [destination, ...(probe.destinationOrigin ?? [0, 0])],
    output = [4, 3],
    extent = probe.extent ?? ([27, 28, 31].includes(probe.kind) ? [8, 6] : [0, 0]),
    maskOrigin = probe.maskOrigin ?? [0, 0],
    fadeIn = probe.fadeIn ?? 0;
  const pair = [...from, ...to, mask, ...output, ...extent, ...maskOrigin],
    alpha = [...from, mask, ...output, ...extent, fadeIn, ...maskOrigin];
  const rows = {
    26: [duration, ...pair],
    27: [duration, ...from, ...to, ...output, ...extent],
    28: [duration, ...alpha],
    29: [duration, ...pair],
    30: [duration, blend, ...pair],
    31: [duration, blend, ...alpha],
  };
  return rows[probe.kind];
}
