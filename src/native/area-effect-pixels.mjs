// SPDX-License-Identifier: MPL-2.0
// CPU effects address bitmap storage rows, independently of logical image Y.
export function physicalPixel(frame, x, y) {
  return ((frame.height - 1 - y) * frame.width + x) * 4;
}
export function blendAreaPixels(
  {
    kind,
    source,
    destination,
    mask,
    sourceOrigin,
    destinationOrigin,
    maskOrigin,
    width,
    height,
    duration,
    blendDuration,
    elapsed,
    fadeIn,
    blendWidth = width,
    blendHeight = height,
  },
  output,
) {
  const alpha = kind === 28 || kind === 31,
    extended = kind === 30 || kind === 31;
  for (let y = 0; y < blendHeight; y++)
    for (let x = 0; x < blendWidth; x++) {
      const input = physicalPixel(
          source,
          sourceOrigin[0] + x + (alpha ? maskOrigin[0] : 0),
          sourceOrigin[1] + y + (alpha ? maskOrigin[1] : 0),
        ),
        target =
          ((height - 1 - y - (alpha ? maskOrigin[1] : 0)) * width +
            x +
            (alpha ? maskOrigin[0] : 0)) *
          4,
        end =
          destination &&
          physicalPixel(destination, destinationOrigin[0] + x, destinationOrigin[1] + y),
        level = mask
          ? mask.rgba[
              physicalPixel(
                mask,
                x + (alpha ? 0 : maskOrigin[0]),
                y + (alpha ? 0 : maskOrigin[1]),
              ) + 2
            ]
          : 0;
      let weight;
      if (kind === 27)
        weight = Math.min(256, Math.floor((Math.imul(elapsed, 256) >>> 0) / duration));
      else if (extended) {
        const delay = duration - Math.floor(Math.imul(duration, level) / 255);
        weight = Math.max(
          0,
          Math.min(256, Math.floor(Math.imul(elapsed - delay, 256) / blendDuration)),
        );
      } else
        weight = Math.max(
          0,
          Math.min(256, Math.floor((Math.imul(elapsed, 512) >>> 0) / duration) - 256 + level),
        );
      if (alpha) {
        const a = (source.rgba[input + 3] * weight) >> 8;
        output[target + 3] = fadeIn ? a : 255 - a;
      } else if (kind === 29) {
        const previous = level < 256 - Math.floor((Math.imul(elapsed, 256) >>> 0) / duration);
        output.set(
          previous
            ? source.rgba.subarray(input, input + 4)
            : destination.rgba.subarray(end, end + 4),
          target,
        );
      } else
        for (let c = 0; c < 4; c++)
          output[target + c] =
            (source.rgba[input + c] * (256 - weight) + destination.rgba[end + c] * weight) >> 8;
    }
}
// Wipe3 modifies only the RGB channels of fully transparent borrowed pixels.
export async function prepareAreaWipeSource(source, destination, sourceOrigin, destinationOrigin) {
  const input = await source.pixels(),
    output = await destination.pixels();
  let changed = false;
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const at = physicalPixel(source, sourceOrigin[0] + x, sourceOrigin[1] + y),
        target = physicalPixel(destination, destinationOrigin[0] + x, destinationOrigin[1] + y);
      if (
        at < 0 ||
        at + 3 >= input.length ||
        target < 0 ||
        target + 3 >= output.length ||
        input[at + 3]
      )
        continue;
      input.set(output.subarray(target, target + 3), at);
      changed = true;
    }
  if (changed) {
    source.state.source = null;
    await source.changed();
  }
}
