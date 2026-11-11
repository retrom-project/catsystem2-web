// SPDX-License-Identifier: MPL-2.0
import { resampleBitmap } from './image.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { screenQuad } from './screen-effect-render.mjs';
const f = Math.fround;
export function shadeGeometry(width, height, textureWidth, textureHeight, radius) {
  const corners = screenQuad(width, height, textureWidth, textureHeight)[0].vertices,
    baseline = [0, 1, 2, 1, 3, 2].map((i) => corners[i]),
    quads = Array.from({ length: 49 }, (_, i) =>
      baseline.map((v) => (i < 48 ? { ...v } : { x: 0, y: 0, z: 0, w: 0, color: 0, u: 0, v: 0 })),
    );
  const slot = (x, y) => {
    const m = Math.max(Math.abs(x), Math.abs(y));
    if (!m) return 0;
    const offset = Math.abs(y) === m ? (x > 0 ? 5 * m - x : m + x) : y > 0 ? 3 * m + y : 7 * m - y;
    return 1 + 4 * m * (m - 1) + offset;
  };
  // The reviewed index function intentionally aliases several inputs. Keep
  // the accumulated positions and the untouched baseline slots verbatim.
  for (let y = -3; y <= 3; y++)
    for (let x = -3; x <= 3; x++)
      for (const vertex of quads[slot(x, y)]) {
        vertex.x = f(vertex.x + x);
        vertex.y = f(vertex.y + y);
      }
  if (radius !== undefined) {
    for (let y = -3; y <= 3; y++)
      for (let x = -3; x <= 3; x++) {
        const vertices = quads[slot(x, y)],
          first = vertices[0];
        let distance = f(Math.sqrt(f(f(first.x * first.x) + f(first.y * first.y))));
        if (!(distance < radius)) distance = radius;
        const alpha = truncateFloat32(f(f(f(radius - distance) * 255) / radius)) & 255;
        for (const vertex of vertices) vertex.color = ((alpha << 24) | 0xffffff) >>> 0;
      }
  }
  return quads.flatMap((vertices) => [
    { vertices: vertices.slice(0, 3) },
    { vertices: vertices.slice(3, 6) },
  ]);
}
export function mosaicCache(pixels, width, height, count, maximum, fade = false) {
  const cache = [{ time: 0, q: 1, width, height, pixels: pixels.slice(), alpha: 255 }],
    span = f(f(maximum | 0) - 1);
  for (let time = 1; time < count; time++) {
    const q = truncateFloat32(f(f(f(f(time) / f(count)) * span) + 1)) >>> 0,
      previous = cache.at(-1);
    if (!q) throw new RangeError('Screen mosaic block divides by zero');
    if (q === previous.q) continue;
    const nextWidth = Math.ceil(width / q) + 1,
      nextHeight = Math.ceil(height / q) + 1;
    cache.push({
      time,
      q,
      width: nextWidth,
      height: nextHeight,
      pixels: resampleBitmap(
        previous.pixels,
        previous.width,
        previous.height,
        nextWidth,
        nextHeight,
      ),
      alpha: fade ? 255 - truncateFloat32(f(f(f(time) / f(count)) * 255)) : 255,
    });
  }
  return cache;
}
export function appendMosaicHalf(cache, next, half) {
  const rows = next.map((row) => ({ ...row, slot: 1 }));
  for (let i = 0; i < rows.length >>> 1; i++) {
    const opposite = rows.length - i - 1,
      a = rows[i].time,
      b = rows[opposite].time;
    rows[i].time = b + half;
    rows[opposite].time = a + half;
  }
  // The unpaired middle time stays unchanged in the original odd-length path.
  return [...cache, ...rows.reverse()];
}
export function expandMosaic(pixels, sourceWidth, sourceHeight, width, height, q, linear) {
  if (linear) return resampleBitmap(pixels, sourceWidth, sourceHeight, width, height);
  const output = new Uint8ClampedArray(width * height * 4),
    half = q >>> 1;
  let y = 0;
  const row = (sourceY) => {
    let x = 0;
    const copy = (sourceX, count) => {
      const at = (sourceY * sourceWidth + sourceX) * 4;
      for (let n = 0; n < count && x < width; n++, x++)
        output.set([pixels[at], pixels[at + 1], pixels[at + 2], 255], (y * width + x) * 4);
    };
    copy(0, half);
    for (let i = 1; i < sourceWidth - 1 && x < width; i++) copy(i, q);
    copy(sourceWidth - 1, width - x);
    y++;
  };
  for (let i = 0; i < half && y < height; i++) row(0);
  for (let sourceY = 1; sourceY < sourceHeight - 1 && y < height; sourceY++)
    for (let repeat = 0; repeat < q && q * sourceY + repeat < height && y < height; repeat++)
      row(sourceY);
  while (y < height) row(sourceHeight - 1);
  return output;
}
export function selectMosaic(cache, elapsed, lastKey) {
  if (!cache.length) return null;
  if (lastKey === 0xffffffff) return cache[0];
  const next = cache.findIndex((row) => row.time > elapsed);
  return next < 0 ? null : cache[Math.max(0, next - 1)];
}
