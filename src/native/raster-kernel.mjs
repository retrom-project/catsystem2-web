// SPDX-License-Identifier: MPL-2.0
// Draw raster coordinates use physical rows. NativeBitmap pixels use logical rows.
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { blendBitmapPixel } from './image.mjs';
import { affineBitmap } from './image-affine.mjs';

const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
const typedPixels = Object.getPrototypeOf(Uint8ClampedArray.prototype),
  pixelSet = typedPixels.set,
  pixelBuffer = Object.getOwnPropertyDescriptor(typedPixels, 'buffer').get,
  pixelOffset = Object.getOwnPropertyDescriptor(typedPixels, 'byteOffset').get,
  OwnedPixels = Uint8ClampedArray;

// A previously owned publication retains its original intrinsic byte sink.
// Ordinary bitmap providers keep their existing live method calls.
export function copyBitmapRow(destination, at, input, start, bytes, owned = false) {
  if (owned)
    Reflect.apply(pixelSet, destination, [
      new OwnedPixels(
        Reflect.apply(pixelBuffer, input, []),
        Reflect.apply(pixelOffset, input, []) + start,
        bytes,
      ),
      at,
    ]);
  else destination.set(input.subarray(start, start + bytes), at);
}

export function flipBitmapRows(bytes, width, height) {
  const output = new Uint8ClampedArray(bytes.length),
    row = width * 4;
  for (let y = 0; y < height; y++)
    output.set(bytes.subarray(y * row, (y + 1) * row), (height - y - 1) * row);
  return output;
}
function blendColor(source, destination, mode, affine) {
  if (mode === 1) return Math.min(255, source + destination);
  if (mode === 2) return (affine ? source * (destination + 1) : destination * (source + 1)) >> 8;
  if (mode === 3)
    return (
      source +
      destination -
      ((affine ? source * (destination + 1) : destination * (source + 1)) >> 8)
    );
  if (mode === 4)
    return destination < 128
      ? Math.trunc((2 * source * destination) / 255)
      : 2 * (source + destination - Math.trunc((source * destination) / 255)) - 255;
  if (mode === 5)
    return destination === 255
      ? 255
      : Math.min(255, Math.trunc((255 * source) / (255 - destination)));
  throw new Error(`Unsupported retained bitmap blend type ${mode}`);
}
function blendTypePixel(output, at, input, offset, opacity, mode, affine) {
  const alpha = (((input[offset + 3] + 1) * (opacity & 65535)) >>> 8) & 255,
    destinationAlpha = output[at + 3];
  if (!alpha) {
    if (!destinationAlpha) output.set([input[offset], input[offset + 1], input[offset + 2], 0], at);
    return;
  }
  let overlap = alpha * destinationAlpha,
    source = alpha * (256 - destinationAlpha),
    destination = destinationAlpha * (256 - alpha);
  if (!affine) {
    overlap >>= 8;
    source >>= 8;
    destination >>= 8;
  }
  const total = affine
      ? (overlap + source + destination) >>> 8
      : (overlap + source + destination) | 1,
    reciprocal = Math.floor(65536 / total);
  for (let channel = 0; channel < 3; channel++) {
    const a = input[offset + channel],
      b = output[at + channel],
      mixed = blendColor(a, b, mode, affine);
    output[at + channel] =
      (Math.imul(reciprocal, mixed * overlap + a * source + b * destination) >>>
        (affine ? 24 : 16)) &
      255;
  }
  output[at + 3] = total;
}
const emptyPixel = (pixels, at) =>
  !pixels[at] && !pixels[at + 1] && !pixels[at + 2] && !pixels[at + 3];

export function packedBitmapWords(bytes) {
  return littleEndian &&
    bytes instanceof Uint8ClampedArray &&
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset % 4 === 0 &&
    bytes.length % 4 === 0
    ? new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
    : null;
}

export function blendPackedRow(output, at, input, start, count, outputWords, inputWords, opacity) {
  const dst = at / 4,
    src = start / 4,
    fullyOpaque = opacity === 255,
    scale = opacity & 65535;
  for (let x = 0; x < count; x++) {
    const source = inputWords[src + x],
      target = outputWords[dst + x],
      color = fullyOpaque
        ? source
        : (source & 0x00ffffff) | (((((source >>> 24) + 1) * scale) >>> 8) << 24),
      alpha = color >>> 24;
    // A zero destination takes the source's RGB even when its alpha is zero.
    if (!target || alpha === 255 || (alpha && !(target >>> 24))) outputWords[dst + x] = color;
    else if (alpha) blendBitmapPixel(output, at + x * 4, input, start + x * 4, opacity);
  }
}

export function rasterizeRetainedBitmap(
  output,
  width,
  height,
  pixels,
  state,
  item,
  region,
  {
    flipDestinationY = false,
    firstDestinationRow = 0,
    written = null,
    preserveTransparentRGB = true,
  } = {},
) {
  if (!item.visible || !item.alpha || !state.width || !state.height) return;
  const mask = state.mask ?? 0,
    blend = state.blendType ?? 0,
    hasAlpha =
      state.bpp === 4 &&
      (state.alphaHint === 2 ||
        (!state.alphaHint && pixels.some((v, i) => i % 4 === 3 && v !== 255))),
    copy = item.alpha === 255 && !hasAlpha,
    useBlend = Boolean(blend && !copy),
    clip = [
      Math.max(0, item.clip[0], region[0]),
      Math.max(0, item.clip[1], region[1]),
      Math.min(width, item.clip[2], region[2]),
      Math.min(height, item.clip[3], region[3]),
    ];
  if (item.mode) {
    // Both reviewed dispatch tables contain explicit empty handlers here.
    if (state.bpp !== 4 || (!blend && mask)) return;
    const input = flipBitmapRows(pixels, state.width, state.height);
    affineBitmap(output, width, height, input, state.width, state.height, {
      position: item.position,
      base: [Math.fround(item.base[0] - state.offsetX), Math.fround(item.base[1] - state.offsetY)],
      rotation: item.rotation,
      scale: item.scale,
      alpha: item.alpha,
      clip,
      flipDestinationY,
      firstDestinationRow,
      ...(blend || !preserveTransparentRGB
        ? {
            blendPixel: (out, at, source, offset, alpha) => {
              if (
                !preserveTransparentRGB &&
                !((((source[offset + 3] + 1) * (alpha & 65535)) >>> 8) & 255)
              )
                return;
              if (blend) blendTypePixel(out, at, source, offset, alpha, blend, true);
              else blendBitmapPixel(out, at, source, offset, alpha);
            },
          }
        : {}),
    });
    return;
  }
  const x =
      ((state.offsetX | 0) + truncateFloat32(item.position[0]) - truncateFloat32(item.base[0])) | 0,
    y =
      ((state.offsetY | 0) + truncateFloat32(item.position[1]) - truncateFloat32(item.base[1])) | 0,
    sourceClip = state.clip ?? [0, 0, state.width, state.height],
    area = [
      Math.max(clip[0], x + sourceClip[0]),
      Math.max(clip[1], y + sourceClip[1]),
      Math.min(clip[2], x + sourceClip[2]),
      Math.min(clip[3], y + sourceClip[3]),
    ];
  if (area[0] >= area[2] || area[1] >= area[3]) return;
  if (state.bpp === 3 && useBlend) return;
  const logicalRows =
      pixels instanceof Uint8ClampedArray &&
      pixels.buffer instanceof ArrayBuffer &&
      output?.buffer instanceof ArrayBuffer &&
      pixels.buffer !== output.buffer &&
      Number.isInteger(state.width) &&
      Number.isInteger(state.height) &&
      pixels.length === state.width * state.height * 4 &&
      area.every(Number.isInteger) &&
      area[0] >= x &&
      area[1] >= y &&
      area[2] <= x + state.width &&
      area[3] <= y + state.height,
    input = logicalRows ? pixels : flipBitmapRows(pixels, state.width, state.height),
    normal = !mask && !useBlend,
    firstOutputRow = (flipDestinationY ? height - area[3] : area[1]) - firstDestinationRow,
    endOutputRow = firstOutputRow + area[3] - area[1],
    packedBlend =
      preserveTransparentRGB &&
      logicalRows &&
      normal &&
      !copy &&
      littleEndian &&
      state.bpp === 4 &&
      output instanceof Uint8ClampedArray &&
      output.byteOffset % 4 === 0 &&
      input.byteOffset % 4 === 0 &&
      output.byteLength % 4 === 0 &&
      Number.isInteger(width) &&
      Number.isInteger(firstOutputRow) &&
      firstOutputRow >= 0 &&
      endOutputRow * width * 4 <= output.byteLength,
    outputWords = packedBlend
      ? new Uint32Array(output.buffer, output.byteOffset, output.length / 4)
      : null,
    inputWords = packedBlend
      ? new Uint32Array(input.buffer, input.byteOffset, input.length / 4)
      : null,
    count = area[2] - area[0],
    channel =
      state.bpp === 3
        ? [2, 1, 0][Math.min(2, Math.max(0, mask - 1))]
        : [2, 1, 0, 3][Math.min(3, Math.max(0, mask - 1))],
    copyToClear =
      written &&
      packedBlend &&
      item.alpha === 255 &&
      !written.some(
        ([left, top, right, bottom]) =>
          // The transparent RGB border may write one pixel past either side.
          area[0] <= right && left <= area[2] && area[1] < bottom && top < area[3],
      );
  written?.push(area);
  for (let row = area[1]; row < area[3]; row++) {
    const sourceY = logicalRows ? state.height - 1 - (row - y) : row - y,
      start = (sourceY * state.width + area[0] - x) * 4,
      destinationY = flipDestinationY ? height - 1 - row : row,
      at = ((destinationY - firstDestinationRow) * width + area[0]) * 4;
    if (normal && copy) {
      output.set(input.subarray(start, start + count * 4), at);
      continue;
    }
    if (normal && state.bpp === 3) {
      for (let column = 0; column < count; column++)
        output.set(
          [
            input[start + column * 4],
            input[start + column * 4 + 1],
            input[start + column * 4 + 2],
            255,
          ],
          at + column * 4,
        );
      continue;
    }
    if (preserveTransparentRGB && normal && area[0] > 0 && emptyPixel(output, at - 4))
      output.set([input[start], input[start + 1], input[start + 2], 0], at - 4);
    if (copyToClear) output.set(input.subarray(start, start + count * 4), at);
    else if (packedBlend)
      blendPackedRow(output, at, input, start, count, outputWords, inputWords, item.alpha);
    else
      for (let column = 0; column < count; column++) {
        const source = start + column * 4,
          destination = at + column * 4;
        if (useBlend) blendTypePixel(output, destination, input, source, item.alpha, blend, false);
        else if (mask)
          output[destination + 3] =
            (((output[destination + 3] + 1) * (input[source + channel] + 1) - 1) & 65535) >>> 8;
        else if (
          preserveTransparentRGB ||
          (((input[source + 3] + 1) * (item.alpha & 65535)) >>> 8) & 255
        )
          blendBitmapPixel(output, destination, input, source, item.alpha);
      }
    const end = at + count * 4,
      last = start + (count - 1) * 4;
    if (preserveTransparentRGB && normal && area[2] < width && emptyPixel(output, end))
      output.set([input[last], input[last + 1], input[last + 2], 0], end);
  }
}
