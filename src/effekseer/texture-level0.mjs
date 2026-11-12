// SPDX-License-Identifier: MPL-2.0
// Existing single-level RGBA8 consumer-device contract; no mip/sRGB/color-key path.
export const EFFEKSEER_LEVEL0_PROFILE = Object.freeze({
  textureCaps: 5,
  maxWidth: 4096,
  maxHeight: 4096,
  maxAspectRatio: 4096,
  format: 21,
  pool: 1,
  usage: 0,
  levels: 1,
});

const f = Math.fround,
  normalizer = f(1 / 255),
  minimumWeight = f(0.00001),
  orderedDither = new Float32Array([
    0.96875, 0.46875, 0.84375, 0.34375, 0.21875, 0.71875, 0.09375, 0.59375, 0.78125, 0.28125,
    0.90625, 0.40625, 0.03125, 0.53125, 0.15625, 0.65625,
  ]),
  scratch = new Float32Array(1),
  scratchBits = new Uint32Array(scratch.buffer);

function towardsZero(value) {
  // The selected packer rounds both arithmetic operations toward zero at f32
  // precision. Integer truncation alone would retain a rounded-up intermediate.
  scratch[0] = value;
  if ((value > 0 && scratch[0] > value) || (value < 0 && scratch[0] < value)) scratchBits[0]--;
  return scratch[0];
}

function dimension(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x4000000)
    throw new RangeError('Effekseer decoded texture dimension is outside the RGBA8 domain');
  return value;
}

export function effekseerLevel0Dimensions(width, height, profile = EFFEKSEER_LEVEL0_PROFILE) {
  dimension(width);
  dimension(height);
  if (
    !profile ||
    Object.entries(EFFEKSEER_LEVEL0_PROFILE).some(([field, value]) => profile[field] !== value)
  )
    throw new Error('Unsupported Effekseer level0 device profile');
  const powerOfTwo = (value) => {
    let result = 1;
    while (result < value) result *= 2;
    return result;
  };
  return {
    width: Math.min(powerOfTwo(width), profile.maxWidth),
    height: Math.min(powerOfTwo(height), profile.maxHeight),
  };
}

// Each source cell has two integrated tent halves. Keep adjacent merge and
// contribution order, including repeated destination indices after edge wrap.
function contributions(sourceDimension, destinationDimension) {
  const ratio = f(destinationDimension / sourceDimension),
    halfWidth = f(0.5 / ratio),
    result = [];
  for (let source = 0; source < sourceDimension; source++) {
    const indices = [],
      weights = [];
    let previous = 0,
      weight = 0;
    const flush = () => {
      if (weight > minimumWeight) {
        indices.push(previous);
        weights.push(weight);
      }
    };
    for (let half = 0; half < 2; half++) {
      const center = f(f(source + half) - 0.5),
        begin = f(center * ratio),
        end = f(begin + ratio);
      for (let cell = Math.floor(begin); cell < end; cell++) {
        const mapped =
          cell < 0
            ? cell + destinationDimension
            : cell >= destinationDimension
              ? cell - destinationDimension
              : cell;
        if (mapped !== previous) {
          flush();
          previous = mapped;
          weight = 0;
        }
        const low = cell < begin ? begin : cell,
          high = f(cell + 1) > end ? end : f(cell + 1);
        let height = f(f(f(high + low) * halfWidth) - center);
        if (half) height = f(1 - height);
        weight = f(f(f(high - low) * height) + weight);
      }
    }
    flush();
    result.push({ indices: Int32Array.from(indices), weights: Float32Array.from(weights) });
  }
  return result;
}

function writeRow(row, y, width, output) {
  const reverse = y & 1;
  for (let step = 0; step < width; step++) {
    const x = reverse ? width - 1 - step : step,
      at = x * 4,
      target = (y * width + x) * 4,
      dither = orderedDither[(y & 3) * 4 + (step & 3)];
    for (let channel = 0; channel < 4; channel++) {
      const value = Math.min(1, Math.max(0, row[at + channel])),
        scaled = towardsZero(value * 255),
        word = Math.trunc(towardsZero(scaled + dither));
      output[target + channel] = Math.min(255, Math.max(0, word));
    }
  }
}

// Input is decoded straight RGBA8 (including PNG's Uint8ClampedArray). The
// result owns plain Uint8Array storage, with RGB beneath alpha zero preserved.
// Returned dimensions are physical storage dimensions, never a logical token.
export function convertEffekseerLevel0(
  { width, height, rgba },
  profile = EFFEKSEER_LEVEL0_PROFILE,
) {
  const destination = effekseerLevel0Dimensions(width, height, profile);
  if (
    !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) ||
    width * height > 64 * 1024 * 1024 ||
    rgba.length !== width * height * 4
  )
    throw new RangeError('Effekseer level0 requires a complete decoded RGBA8 image');
  if (width === destination.width && height === destination.height)
    return { ...destination, rgba: new Uint8Array(rgba) };

  const horizontal = contributions(width, destination.width),
    vertical = contributions(height, destination.height),
    remaining = new Uint32Array(destination.height),
    rows = new Array(destination.height),
    free = [],
    sourceRow = new Float32Array(width * 4),
    output = new Uint8Array(destination.width * destination.height * 4);
  for (const { indices } of vertical) for (const index of indices) remaining[index]++;

  for (let sourceY = 0; sourceY < height; sourceY++) {
    const ys = vertical[sourceY];
    for (const y of ys.indices)
      if (!rows[y]) {
        const row = free.pop() || new Float32Array(destination.width * 4);
        row.fill(0);
        rows[y] = row;
      }
    for (let i = 0; i < sourceRow.length; i++)
      sourceRow[i] = f(rgba[sourceY * width * 4 + i] * normalizer);

    for (let sourceX = 0; sourceX < width; sourceX++) {
      const xs = horizontal[sourceX],
        source = sourceX * 4;
      for (let yi = 0; yi < ys.indices.length; yi++) {
        const row = rows[ys.indices[yi]],
          yWeight = ys.weights[yi];
        for (let xi = 0; xi < xs.indices.length; xi++) {
          const at = xs.indices[xi] * 4,
            weight = f(xs.weights[xi] * yWeight);
          for (let channel = 0; channel < 4; channel++)
            row[at + channel] = f(f(weight * sourceRow[source + channel]) + row[at + channel]);
        }
      }
    }
    for (const y of ys.indices)
      if (--remaining[y] === 0) {
        writeRow(rows[y], y, destination.width, output);
        free.push(rows[y]);
        rows[y] = null;
      }
  }
  return { ...destination, rgba: output };
}
