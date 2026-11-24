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
    positionedWipeMask,
    blendWidth = width,
    blendHeight = height,
  },
  output,
) {
  const alpha = kind === 28 || kind === 31,
    extended = kind === 30 || kind === 31,
    placed = alpha || positionedWipeMask,
    [placeX, placeY] = placed ? maskOrigin : [0, 0],
    [maskX, maskY] = placed ? [0, 0] : maskOrigin;
  for (let y = 0; y < blendHeight; y++)
    for (let x = 0; x < blendWidth; x++) {
      const input = physicalPixel(
          source,
          sourceOrigin[0] + x + placeX,
          sourceOrigin[1] + y + placeY,
        ),
        target = ((height - 1 - y - placeY) * width + x + placeX) * 4,
        end =
          destination &&
          physicalPixel(
            destination,
            destinationOrigin[0] + x + placeX,
            destinationOrigin[1] + y + placeY,
          ),
        level = mask ? mask.rgba[physicalPixel(mask, x + maskX, y + maskY) + 2] : 0;
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
// Only the hidden RGB of fully transparent borrowed pixels is replaced.
export async function prepareAreaWipeSource(
  source,
  destination,
  sourceOrigin,
  destinationOrigin,
  [width, height] = [source.width, source.height],
) {
  const input = await source.pixels(),
    output = await destination.pixels();
  let changed = false;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
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

// The old receivers walk physical DWORD scanlines from each bitmap's origin.
export async function prepareLegacyAreaColors(
  source,
  target,
  [sx, sy],
  [dx, dy],
  [width, height],
  fade,
) {
  const input = await source.pixels(),
    output = await target.pixels(),
    firstSource = sy * source.width + sx,
    firstTarget = dy * target.width + dx,
    lastSource = firstSource + (height - 1) * source.width + width - 1;
  const pixelOffset = (image, index) =>
    physicalPixel(image, index % image.width, Math.floor(index / image.width));
  const invalid = () => new RangeError('Area effect RGB preparation exceeds its borrowed bitmap');
  if (lastSource >= input.length / 4) throw invalid();
  for (let y = 0; y < height; y++) {
    const from = firstSource + y * source.width,
      to = firstTarget + y * target.width;
    for (let x = 0; x < width; x++)
      if (to + x >= output.length / 4 && (fade || !input[pixelOffset(source, from + x) + 3]))
        throw invalid();
  }
  let sourceChanged = false,
    targetChanged = false;
  for (let y = 0; y < height; y++) {
    const from = firstSource + y * source.width,
      to = firstTarget + y * target.width;
    for (let x = 0; x < width; x++) {
      const a = pixelOffset(source, from + x),
        b = pixelOffset(target, to + x);
      if (!input[a + 3]) {
        input.set(output.subarray(b, b + 3), a);
        sourceChanged = true;
      } else if (fade && !output[b + 3]) {
        output.set(input.subarray(a, a + 3), b);
        targetChanged = true;
      }
    }
  }
  if (sourceChanged) {
    source.state.source = null;
    await source.changed();
  }
  if (targetChanged) {
    target.state.source = null;
    await target.changed();
  }
}
