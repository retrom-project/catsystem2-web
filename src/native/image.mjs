// SPDX-License-Identifier: MPL-2.0
import { originalView } from './original-adapter.mjs';
import { encodeSparseBytes, decodeSparseBytes } from './sparse-bytes.mjs';
import { NativeBitmapFactories } from './bitmap-factory.mjs';
import { nativeABI } from './abi/index.mjs';
import { nativeImagePathParts } from './image-file.mjs';
import { readNativeResource, nativeCategoryFilename } from './resource-file.mjs';
import { ImageStore, HG3 } from '../formats/hg3.mjs';
import { SceneImagePreparation } from './scene-image-preparation.mjs';
import { parseNativeInteger } from './standard.mjs';
import { blendPackedRow, packedBitmapWords } from './raster-kernel.mjs';
const f = Math.fround;
const retainedBackings = new WeakMap();
const typedArray = Object.getPrototypeOf(Uint8ClampedArray.prototype),
  ordinaryTypedProperties = new Map(
    ['buffer', 'byteOffset', 'length', 'set', 'subarray'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(typedArray, key),
    ]),
  ),
  resizableBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
function bitmapBlendWords(bytes) {
  if (!ArrayBuffer.isView(bytes) || Object.getPrototypeOf(bytes) !== Uint8ClampedArray.prototype)
    return null;
  for (const [key, original] of ordinaryTypedProperties) {
    const current = Object.getOwnPropertyDescriptor(typedArray, key);
    if (
      Object.hasOwn(bytes, key) ||
      Object.hasOwn(Uint8ClampedArray.prototype, key) ||
      current?.get !== original.get ||
      current?.value !== original.value
    )
      return null;
  }
  if (
    !(bytes.buffer instanceof ArrayBuffer) ||
    (resizableBuffer && Reflect.apply(resizableBuffer, bytes.buffer, []))
  )
    return null;
  return packedBitmapWords(bytes);
}
const pixelSlice = Object.getOwnPropertyDescriptor(typedArray, 'slice')?.value;
export function nativePublicationPixels(bytes) {
  return (
    !Object.hasOwn(bytes ?? {}, 'slice') &&
    !Object.hasOwn(Uint8ClampedArray.prototype, 'slice') &&
    Object.getOwnPropertyDescriptor(typedArray, 'slice')?.value === pixelSlice &&
    bitmapBlendWords(bytes) !== null
  );
}
const size = (width, height, empty = false) => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < (empty ? 0 : 1) ||
    height < (empty ? 0 : 1) ||
    width * height > 64 * 1024 * 1024
  )
    throw new Error(`Invalid native bitmap size ${width}×${height}`);
};
const intersect = (a, b) => {
  const rect = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  return rect[0] < rect[2] && rect[1] < rect[3] ? rect : [0, 0, 0, 0];
};

export class NativeBitmap {
  constructor(registry, state, { dataHandle = 0, owner = state?.owner ?? null } = {}) {
    this.registry = registry;
    this.dataHandle = dataHandle;
    this.owner = owner;
    this._state = state ? structuredClone(state) : null;
    if (this._state) {
      delete this._state.owner;
      this._state.revision ??= 0;
    }
    this.cachedFrame = null;
    this.canvas = null;
    this.canvasDirty = false;
    this.canvasRevision = -1;
  }
  get state() {
    return this.dataHandle
      ? this.registry.handles.get(this.dataHandle, 'bitmap-data')
      : this._state;
  }
  set state(value) {
    if (this.dataHandle) {
      this.registry.handles.get(this.dataHandle, 'bitmap-data');
      if (!this.registry.nativeMemory?.replace(this.dataHandle, value))
        this.registry.handles.records.get(this.dataHandle).value = value;
    } else this._state = value;
  }
  get width() {
    return this.state.width;
  }
  get height() {
    return this.state.height;
  }
  retainedBacking() {
    const state = this.state,
      slot = retainedBackings.get(state),
      backing = slot?.current;
    if (
      this.canvasDirty ||
      !backing ||
      backing.borrowed ||
      backing.publishing ||
      Object.getOwnPropertyDescriptor(state, 'rgba')?.get !== slot.read
    )
      return null;
    return backing;
  }
  publishRetainedBacking(pixels) {
    const state = this.state,
      property = Object.getOwnPropertyDescriptor(state, 'rgba'),
      previous = retainedBackings.get(state),
      backing = { pixels, borrowed: false, publishing: false };
    if (previous && property?.get === previous.read) {
      previous.current = backing;
      return backing;
    }
    state.rgba = pixels;
    if (!property?.configurable || !property.writable) return null;
    // A fresh Draw allocation may be reused up to its first raw read, including
    // reads via another wrapper of the same data record or via a snapshot.
    const slot = {
      current: backing,
      read() {
        slot.current.borrowed = true;
        return slot.current.pixels;
      },
    };
    Object.defineProperty(state, 'rgba', {
      configurable: true,
      enumerable: property.enumerable,
      get: slot.read,
      set(value) {
        slot.current = { pixels: value, borrowed: true };
      },
    });
    retainedBackings.set(state, slot);
    return backing;
  }
  async pixels({ textPublication = null } = {}) {
    const text = this.registry?.world?.text;
    if (
      (text?.publications?.size || text?.flushingPublication) &&
      (!textPublication || textPublication !== text.flushingToken) &&
      this.registry.handles.records.get(this.registry.world.graphics.vramHandle)?.value
        .dataHandle === this.dataHandle
    )
      await text.flushPublications();
    if (
      this.dataHandle &&
      this.registry.nativeMemory?.refs.data.has(this.dataHandle) &&
      !this.registry.nativeMemory.isOwned?.(this.dataHandle)
    )
      return this.registry.nativeMemory.pixels(this.dataHandle);
    if (!this.state.rgba) {
      const { source, width, height } = this.state;
      if (source) {
        const image = await this.registry.images.load(source.file),
          frame = image.frame(source.id);
        if (!frame) throw new Error(`Native bitmap source ${source.file}:${source.id} disappeared`);
        await image.decode(frame);
        this.state.rgba = new Uint8ClampedArray(frame.rgba);
      } else this.state.rgba = new Uint8ClampedArray(width * height * 4);
    }
    return this.state.rgba;
  }
  async hasAlpha() {
    if (this.state.bpp <= 3) return false;
    if (!this.state.alphaHint) {
      const rgba = await this.pixels();
      this.state.alphaHint = rgba.some((word, index) => index % 4 === 3 && word !== 255) ? 2 : 1;
      await this.changed();
    }
    return this.state.alphaHint === 2;
  }
  changed(revisionSteps = 1) {
    for (let i = 0; i < revisionSteps; i++) this.state.revision = (this.state.revision || 0) + 1;
    this.cachedFrame = null;
    this.canvas = null;
    return this.registry?.nativeMemory?.changed(this.dataHandle);
  }
  async frame({ textPublication = null } = {}) {
    const text = this.registry?.world?.text;
    if (
      (text?.publications?.size || text?.flushingPublication) &&
      (!textPublication || textPublication !== text.flushingToken) &&
      this.registry.handles.records.get(this.registry.world.graphics.vramHandle)?.value
        .dataHandle === this.dataHandle
    )
      await text.flushPublications();
    if (
      this.dataHandle &&
      this.registry.nativeMemory?.refs.data.has(this.dataHandle) &&
      !this.registry.nativeMemory.isOwned?.(this.dataHandle)
    )
      await (textPublication ? this.pixels({ textPublication }) : this.pixels());
    if (!this.cachedFrame || this.cachedFrame.revision !== this.state.revision)
      this.cachedFrame = {
        width: this.width,
        height: this.height,
        rgba: await (textPublication ? this.pixels({ textPublication }) : this.pixels()),
        revision: this.state.revision,
      };
    return this.cachedFrame;
  }
  async context() {
    if (
      this.dataHandle &&
      this.registry.nativeMemory?.refs.data.has(this.dataHandle) &&
      !this.registry.nativeMemory.isOwned?.(this.dataHandle)
    )
      await this.pixels();
    if (!this.canvas || this.canvasRevision !== this.state.revision) {
      this.canvas = new OffscreenCanvas(this.width, this.height);
      const frame = await this.frame();
      if (frame.width && frame.height)
        this.canvas
          .getContext('2d')
          .putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
      this.canvasRevision = this.state.revision;
      this.canvasDirty = false;
      const context = this.canvas.getContext('2d');
      for (const name of [
        'clearRect',
        'fillRect',
        'strokeRect',
        'fill',
        'stroke',
        'drawImage',
        'putImageData',
        'fillText',
        'strokeText',
        'reset',
        'drawFocusIfNeeded',
      ]) {
        if (typeof context[name] !== 'function') continue;
        const draw = context[name].bind(context);
        context[name] = (...args) => {
          this.canvasDirty = true;
          return draw(...args);
        };
      }
    }
    return this.canvas.getContext('2d');
  }
  commitCanvas() {
    if (!this.canvas || !this.canvasDirty || this.canvasRevision !== this.state.revision) return;
    this.state.rgba =
      this.width && this.height
        ? this.canvas.getContext('2d').getImageData(0, 0, this.width, this.height).data
        : new Uint8ClampedArray();
    this.state.source = null;
    this.state.revision++;
    this.canvasRevision = this.state.revision;
    this.canvasDirty = false;
    this.cachedFrame = null;
  }
  clone() {
    this.commitCanvas();
    const source = this.state,
      state =
        this.width && this.height
          ? {
              ...source,
              canvasWidth: source.canvasWidth || this.width,
              canvasHeight: source.canvasHeight || this.height,
              clip: [0, 0, this.width, this.height],
            }
          : {
              width: this.width,
              height: this.height,
              bpp: source.bpp,
              canvasWidth: 0,
              canvasHeight: 0,
              offsetX: 0,
              offsetY: 0,
              baseX: 0,
              baseY: 0,
              clip: [0, 0, this.width, this.height],
              attributes: [],
              source: null,
              rgba: new Uint8ClampedArray(),
            };
    return new NativeBitmap(this.registry, state, { owner: this.owner });
  }
  async crop(left, top, width, height) {
    // Copy raw bitmap pixels and reset canvas, anchor and clip
    // metadata. The source clip rectangle does not limit the copy.
    if (left < 0 || top < 0)
      throw new RangeError('Native bitmap crop starts before the source bitmap');
    width = Math.min(width, this.width - left);
    height = Math.min(height, this.height - top);
    if (width <= 0 || height <= 0) return null;
    size(width, height);
    this.commitCanvas();
    const input = await this.pixels(),
      rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const at = ((top + y) * this.width + left) * 4;
      rgba.set(input.subarray(at, at + width * 4), y * width * 4);
    }
    return new NativeBitmap(
      this.registry,
      {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        offsetX: 0,
        offsetY: 0,
        baseX: 0,
        baseY: 0,
        bpp: this.state.bpp,
        clip: [0, 0, width, height],
        attributes: [],
        source: null,
        rgba,
      },
      { owner: this.owner },
    );
  }
  async fill(x, y, width, height, color) {
    const rect = intersect(
      [x | 0, y | 0, (x + width) | 0, (y + height) | 0],
      [0, 0, this.width, this.height],
    );
    if (rect[0] === rect[2] || rect[1] === rect[3]) return false;
    const rgba = await this.pixels(),
      value = [(color >>> 16) & 255, (color >>> 8) & 255, color & 255, color >>> 24];
    for (let row = rect[1]; row < rect[3]; row++)
      for (let column = rect[0]; column < rect[2]; column++)
        rgba.set(value, (row * this.width + column) * 4);
    this.state.source = null;
    await this.changed();
    return true;
  }
  async tone(red, green, blue) {
    if (this.state.bpp !== 4 || (red === 100 && green === 100 && blue === 100)) return;
    const table = [red, green, blue].map((percent) =>
      Uint8Array.from({ length: 256 }, (_, i) =>
        Math.min(255, Math.floor((Math.imul(i, percent) >>> 0) / 100)),
      ),
    );
    const rgba = await this.pixels();
    for (let i = 0; i < rgba.length; i += 4)
      for (let c = 0; c < 3; c++) rgba[i + c] = table[c][rgba[i + c]];
    this.state.source = null;
    await this.changed();
  }
  async blit(
    source,
    {
      dx = 0,
      dy = 0,
      sx = 0,
      sy = 0,
      width = source.width,
      height = source.height,
      copy = false,
      alpha = 255,
      flipY = false,
      textPublication = null,
      revisionSteps = 1,
    } = {},
  ) {
    // Clip source and destination independently, then limit both to
    // the smaller extent. A negative destination does not advance the source.
    const sr = intersect([sx, sy, sx + width, sy + height], [0, 0, source.width, source.height]);
    const dr = intersect([dx, dy, dx + width, dy + height], [0, 0, this.width, this.height]);
    const count = Math.min(sr[2] - sr[0], dr[2] - dr[0]),
      rows = Math.min(sr[3] - sr[1], dr[3] - dr[1]);
    if (!count || !rows) return false;
    const dest = await (textPublication ? this.pixels({ textPublication }) : this.pixels()),
      input = await (textPublication ? source.pixels({ textPublication }) : source.pixels());
    const data = source === this ? new Uint8ClampedArray(input) : input;
    const bulkCopy =
      copy &&
      (data.buffer !== dest.buffer ||
        data.byteOffset + data.byteLength <= dest.byteOffset ||
        dest.byteOffset + dest.byteLength <= data.byteOffset);
    for (let y = 0; y < rows; y++) {
      const sourceY = flipY ? source.height - 1 - (sr[1] + y) : sr[1] + y;
      const start = (sourceY * source.width + sr[0]) * 4,
        output = ((dr[1] + y) * this.width + dr[0]) * 4;
      if (bulkCopy) {
        dest.set(data.subarray(start, start + count * 4), output);
        continue;
      }
      if (!copy && dr[0] > 0 && dest.subarray(output - 4, output).every((v) => !v))
        dest.set([data[start], data[start + 1], data[start + 2], 0], output - 4);
      // Check after the live geometry/edge reads. Unknown pixel methods and
      // aliased or unusual storage keep their existing per-pixel call order.
      const outputWords = !copy && typeof alpha === 'number' ? bitmapBlendWords(dest) : null,
        inputWords = outputWords ? bitmapBlendWords(data) : null,
        packed = inputWords && outputWords.buffer !== inputWords.buffer && Number.isInteger(count);
      if (
        packed &&
        Number.isInteger(start) &&
        Number.isInteger(output) &&
        start % 4 === 0 &&
        output % 4 === 0 &&
        start >= 0 &&
        output >= 0 &&
        start + count * 4 <= data.length &&
        output + count * 4 <= dest.length
      )
        blendPackedRow(dest, output, data, start, count, outputWords, inputWords, alpha);
      else
        for (let x = 0; x < count; x++) {
          const src = start + x * 4,
            at = output + x * 4;
          if (copy) dest.set(data.subarray(src, src + 4), at);
          else blendBitmapPixel(dest, at, data, src, alpha);
        }
      if (
        !copy &&
        dr[0] + count < this.width &&
        dest.subarray(output + count * 4, output + count * 4 + 4).every((v) => !v)
      ) {
        const last = start + (count - 1) * 4;
        dest.set([data[last], data[last + 1], data[last + 2], 0], output + count * 4);
      }
    }
    this.state.source = null;
    await (textPublication ? this.changed(revisionSteps) : this.changed());
    return true;
  }
  async resize(width, height, { legacyCells = false } = {}) {
    const old = this.state;
    if (
      !legacyCells &&
      old.bpp !== 4 &&
      !(
        old.bpp === 3 &&
        nativeABI(this.registry.world.profile ?? originalView(this.registry.world, 'profile'))
          .graphics.resizeRGB24
      )
    )
      return;
    if (legacyCells && old.bpp === 1) return;
    size(width, height, legacyCells);
    const ratioX = f(
        f(width) / f(legacyCells ? old.canvasWidth >>> 0 : old.canvasWidth || old.width),
      ),
      ratioY = f(
        f(height) / f(legacyCells ? old.canvasHeight >>> 0 : old.canvasHeight || old.height),
      );
    const round = (value, ratio) => Math.trunc(f(f(f(value) * ratio) + 0.5));
    const nextWidth = legacyCells ? round(old.width, ratioX) >>> 0 : round(old.width, ratioX),
      nextHeight = legacyCells ? round(old.height, ratioY) >>> 0 : round(old.height, ratioY),
      empty = nextWidth === 0 || nextHeight === 0,
      cells = legacyCells && (old.width > 4 * nextWidth || old.height > 4 * nextHeight),
      sameSize = old.width === nextWidth && old.height === nextHeight;
    size(nextWidth, nextHeight, legacyCells);
    if (legacyCells) {
      if (![2, 3, 4].includes(old.bpp))
        throw new TypeError('Native bitmap resize requires a known packed layout');
      if (nextWidth > 0x7fffffff || nextHeight > 0x7fffffff)
        throw new RangeError('Native bitmap resize exceeds signed raster dimensions');
      if (cells && !empty && old.bpp === 3)
        throw new RangeError(
          'Legacy 24-bit bitmap source boundary is undefined for cell averaging',
        );
      if (
        cells &&
        !empty &&
        (old.width * nextWidth > 0x7fffffff || old.height * nextHeight > 0x7fffffff)
      )
        throw new RangeError('Native bitmap resize exceeds signed cell coordinates');
      if (old.bpp !== 4 && !sameSize && !cells) return;
      if (old.attributes?.length && (!Number.isFinite(ratioX) || !Number.isFinite(ratioY)))
        throw new RangeError('Native bitmap resize has undefined attribute coordinates');
      this.commitCanvas();
    }
    const pixels = new Uint8ClampedArray(nextWidth * nextHeight * 4);
    if (!empty && !(cells && old.bpp === 2)) {
      const logical = await this.pixels(),
        physical = new Uint8ClampedArray(logical.length);
      for (let y = 0; y < old.height; y++)
        physical.set(
          logical.subarray(y * old.width * 4, (y + 1) * old.width * 4),
          (old.height - 1 - y) * old.width * 4,
        );
      const sampled = cells
        ? averageBitmapCells(physical, old.width, old.height, nextWidth, nextHeight)
        : resampleBitmap(physical, old.width, old.height, nextWidth, nextHeight);
      for (let y = 0; y < nextHeight; y++)
        pixels.set(
          sampled.subarray(y * nextWidth * 4, (y + 1) * nextWidth * 4),
          (nextHeight - 1 - y) * nextWidth * 4,
        );
    }
    this.state = {
      ...old,
      width: nextWidth,
      height: nextHeight,
      rgba: pixels,
      source: null,
      canvasWidth: round(old.canvasWidth, ratioX) >>> 0,
      canvasHeight: round(old.canvasHeight, ratioY) >>> 0,
      offsetX: round(old.offsetX >>> 0, ratioX) >>> 0,
      offsetY: round(old.offsetY >>> 0, ratioY) >>> 0,
      baseX: round(old.baseX, ratioX) | 0,
      baseY: round(old.baseY, ratioY) | 0,
      clip: [0, 0, nextWidth, nextHeight],
      attributes: (old.attributes || []).map((attribute) => ({
        ...attribute,
        rect: attribute.rect.map((v, i) => Math.trunc(f(f(v) * (i & 1 ? ratioY : ratioX)))),
      })),
    };
    await this.changed();
  }
  snapshot() {
    this.commitCanvas();
    return structuredClone(this.state);
  }
}

function averageBitmapCells(source, width, height, nextWidth, nextHeight) {
  const pixels = new Uint8ClampedArray(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y++) {
    const top = Math.floor((y * height) / nextHeight),
      bottom = Math.max(top + 1, Math.floor(((y + 1) * height) / nextHeight));
    for (let x = 0; x < nextWidth; x++) {
      const left = Math.floor((x * width) / nextWidth),
        right = Math.max(left + 1, Math.floor(((x + 1) * width) / nextWidth)),
        count = (right - left) * (bottom - top);
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let row = top; row < bottom; row++)
          for (let column = left; column < right; column++)
            sum = (sum + source[(row * width + column) * 4 + channel]) | 0;
        pixels[(y * nextWidth + x) * 4 + channel] = Math.trunc(sum / count) & 255;
      }
    }
  }
  return pixels;
}

export function blendBitmapPixel(destination, at, source, src, opacity = 255) {
  const alpha = (((source[src + 3] + 1) * (opacity & 65535)) >>> 8) & 255,
    oldAlpha = destination[at + 3];
  if (alpha === 0) {
    if (destination.subarray(at, at + 4).every((v) => !v))
      destination.set([source[src], source[src + 1], source[src + 2], alpha], at);
  } else if (alpha === 255 || oldAlpha === 0)
    destination.set([source[src], source[src + 1], source[src + 2], alpha], at);
  else if (oldAlpha === 255) {
    for (let c = 0; c < 3; c++)
      destination[at + c] += Math.imul(source[src + c] - destination[at + c], alpha) >> 8;
  } else {
    const overlap = Math.imul(alpha, oldAlpha) >> 8,
      srcOnly = Math.imul(256 - oldAlpha, alpha) >> 8;
    const destOnly = Math.imul(256 - alpha, oldAlpha) >> 8,
      total = (overlap + srcOnly + destOnly) | 1,
      reciprocal = Math.floor(65536 / total);
    for (let c = 0; c < 3; c++)
      destination[at + c] =
        (Math.imul(
          source[src + c] * (overlap + srcOnly) + destination[at + c] * destOnly,
          reciprocal,
        ) >>>
          16) &
        255;
    destination[at + 3] = total & 255;
  }
}

export function resampleBitmap(
  source,
  width,
  height,
  nextWidth,
  nextHeight,
  region = null,
  target = null,
) {
  size(width, height);
  size(nextWidth, nextHeight);
  if (!region && !target && width === nextWidth && height === nextHeight)
    return new Uint8ClampedArray(source);
  const regionWidth = region?.width ?? width,
    regionHeight = region?.height ?? height;
  const output = target?.pixels ?? new Uint8ClampedArray(nextWidth * nextHeight * 4),
    outputWidth = target?.width ?? nextWidth,
    outputOffset = target ? target.y * outputWidth + target.x : 0,
    packed = target?.bpp === 2;
  if (regionWidth > 4 * nextWidth || regionHeight > 4 * nextHeight) {
    const bounded = region?.boundedSource,
      originX = bounded ? region.x : 0,
      originY = bounded ? region.y : 0;
    if (
      bounded &&
      (originX < 0 ||
        originY < 0 ||
        regionWidth <= 0 ||
        regionHeight <= 0 ||
        originX + regionWidth > width ||
        originY + regionHeight > height)
    )
      throw new RangeError('Legacy glyph averaging requires a crop fully inside its atlas');
    // The old glyph reducer consumes integer crop origins and advances each
    // cell to its next truncated endpoint, including the last partial cell.
    const rx = f(f(regionWidth) / f(nextWidth)),
      ry = f(f(regionHeight) / f(nextHeight)),
      nx = Math.max(1, Math.trunc(rx)),
      ny = Math.max(1, Math.trunc(ry));
    for (let y = 0; y < nextHeight; y++)
      for (let x = 0; x < nextWidth; x++) {
        const x0 = Math.trunc(f(f(x) * rx)),
          y0 = Math.trunc(f(f(y) * ry)),
          sx = originX + x0,
          sy = originY + y0,
          columns = bounded ? Math.max(1, Math.trunc(f(f(x + 1) * rx)) - x0) : nx,
          rows = bounded ? Math.max(1, Math.trunc(f(f(y + 1) * ry)) - y0) : ny;
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let j = 0; j < rows; j++)
            for (let i = 0; i < columns; i++) sum += source[((sy + j) * width + sx + i) * 4 + c];
          const channel = Math.floor(sum / (columns * rows));
          output[(outputOffset + y * outputWidth + x) * 4 + c] = packed
            ? (channel >>> 4) * 17
            : channel;
        }
      }
    return output;
  }
  const stepX = Math.trunc((regionWidth << 15) / nextWidth),
    stepY = Math.trunc((regionHeight << 15) / nextHeight);
  for (let y = 0; y < nextHeight; y++)
    for (let x = 0; x < nextWidth; x++) {
      const fx = Math.imul(x, stepX) + (region?.x ?? 0),
        fy = Math.imul(y, stepY) + (region?.y ?? 0),
        sx = fx >> 15,
        sy = fy >> 15;
      if (sx >= width || sy >= height || (region?.boundedSource && (sx < 0 || sy < 0))) continue;
      const a = (sy * width + sx) * 4,
        b = sx < width - 1 ? a + 4 : a;
      const c = sy < height - 1 ? a + width * 4 : a,
        d = sx < width - 1 && sy < height - 1 ? c + 4 : a;
      if (!(source[a + 3] + source[b + 3] + source[c + 3] + source[d + 3])) continue;
      const tx = fx & 32767,
        ty = fy & 32767;
      const weights = [
        Math.imul(32768 - tx, 32768 - ty) >> 15,
        Math.imul(tx, 32768 - ty) >> 15,
        Math.imul(ty, 32768 - tx) >> 15,
        Math.imul(tx, ty) >> 15,
      ];
      for (let channel = 0; channel < 4; channel++) {
        const value =
          channel === 3 && source[a + 3] + source[b + 3] + source[c + 3] + source[d + 3] === 1020
            ? 255
            : (weights[0] * source[a + channel] +
                weights[1] * source[b + channel] +
                weights[2] * source[c + channel] +
                weights[3] * source[d + channel]) >>>
              15;
        output[(outputOffset + y * outputWidth + x) * 4 + channel] = packed
          ? (value >>> 4) * 17
          : value;
      }
    }
  return output;
}

export class NativeImages {
  constructor(world) {
    this.world = world;
    this.assets = new Map();
    this.handles = world.runtime.handles;
    this.scenePreparation = new SceneImagePreparation(this);
    const readMounted = (hit) => this.scenePreparation.read(hit);
    this.images =
      typeof world.images?.load === 'function' && !(world.images instanceof ImageStore)
        ? world.images
        : new ImageStore({
            ...world.game,
            resolveCategory: (file) => nativeCategoryFilename(world.game, file, 'image'),
            require: async (file) => {
              const bytes = await readNativeResource(world, file, 3, undefined, readMounted);
              if (bytes === null) throw new Error('Missing image resource: ' + file);
              return bytes;
            },
          });
    this.handles.registerType('bitmap-data', {
      snapshot: (state) => {
        // A bitmap's backing resource precedes its wrapper in handle order.
        // Commit its matching canvas before encoding that one shared resource.
        for (const { type, value } of this.handles.records.values())
          if (type === 'bitmap' && value.state === state) value.commitCanvas();
        const native = this.nativeMemory?.snapshotState(state);
        return (
          native || {
            ...state,
            rgba: state.rgba == null ? state.rgba : encodeSparseBytes(state.rgba),
          }
        );
      },
      restore: (state) => {
        size(state.width, state.height, true);
        if (state.rgba == null) return state;
        if (state.rgba.length !== state.width * state.height * 4)
          throw new Error('Native bitmap checkpoint pixels do not match its dimensions');
        return { ...state, rgba: new Uint8ClampedArray(decodeSparseBytes(state.rgba).buffer) };
      },
    });
    this.handles.registerType('bitmap', {
      snapshot: (bitmap) => {
        return { dataHandle: bitmap.dataHandle, owner: bitmap.owner };
      },
      restore: ({ dataHandle, owner }) => new NativeBitmap(this, null, { dataHandle, owner }),
    });
  }
  get nativeMemory() {
    return originalView(this.world, 'bitmapMemory');
  }
  get(handle) {
    return this.handles.get(handle, 'bitmap');
  }
  add(bitmap) {
    if (!bitmap.dataHandle) {
      bitmap.dataHandle = this.handles.add('bitmap-data', bitmap._state);
      bitmap._state = null;
    }
    const handle = this.handles.add('bitmap', bitmap);
    this.nativeMemory?.addAlias(handle, bitmap.dataHandle);
    return handle;
  }
  alias(handle, owner = null) {
    const bitmap = this.get(handle);
    return this.add(new NativeBitmap(this, null, { dataHandle: bitmap.dataHandle, owner }));
  }
  create(width, height, owner = null) {
    size(width, height, true);
    return this.add(
      new NativeBitmap(this, {
        width,
        height,
        canvasWidth: 0,
        canvasHeight: 0,
        offsetX: 0,
        offsetY: 0,
        baseX: 0,
        baseY: 0,
        bpp: 4,
        clip: [0, 0, width, height],
        attributes: [],
        source: null,
        rgba: null,
        owner,
      }),
    );
  }

  snapshotAssets() {
    return [...this.assets].map(([key, state]) => [
      key,
      { ...state, rgba: encodeSparseBytes(state.rgba) },
    ]);
  }
  restoreAssets(assets) {
    this.assets = new Map(
      assets.map(([key, state]) => [
        key,
        { ...state, rgba: new Uint8ClampedArray(decodeSparseBytes(state.rgba).buffer) },
      ]),
    );
  }
  async load(file, id = 0, owner = null) {
    const key = file.toLowerCase() + ':' + id;
    const cached = this.assets.get(key);
    let bitmap;
    if (cached) bitmap = new NativeBitmap(this, cached, { owner });
    else {
      const game = this.world.game,
        resolved = game.resolveCategory
          ? game.resolveCategory(file, 'image')
          : this.images instanceof ImageStore
            ? this.images.resolve(file)
            : file;
      if (!resolved) return 0;
      let image, frame;
      try {
        image = await this.images.load(file);
        frame = image.frame(id);
        if (!frame) return 0;
        this.scenePreparation.apply(image, frame);
        await image.decode(frame);
      } catch (error) {
        this.world.host?.nativeDiagnostic?.({ type: 'image-invalid', file, error: error.message });
        return 0;
      }
      const source = frame.rgba,
        state = this.decodedState(image, frame, source),
        ownsPixels =
          ArrayBuffer.isView(source) &&
          state.rgba.buffer instanceof ArrayBuffer &&
          state.rgba.buffer !== source.buffer,
        metadata = ownsPixels ? { ...state, rgba: null } : state,
        asset = structuredClone(metadata);
      // A decoded view produced its own allocation. A raw buffer can instead
      // form an aliased view and follows the original cloning path.
      if (ownsPixels) asset.rgba = state.rgba.slice();
      this.assets.set(key, asset);
      while (this.assets.size > 32) this.assets.delete(this.assets.keys().next().value);
      bitmap = new NativeBitmap(this, metadata, { owner });
      if (ownsPixels) bitmap.state.rgba = state.rgba;
    }
    this.world.imageLoaded?.({ file, frameID: id, owner, native: 'image' });
    return this.add(bitmap);
  }
  decodedState(image, frame, pixels = frame.rgba) {
    return {
      width: frame.width,
      height: frame.height,
      canvasWidth: frame.canvasWidth,
      canvasHeight: frame.canvasHeight,
      offsetX: frame.offsetX,
      offsetY: frame.offsetY,
      baseX: frame.baseX,
      baseY: frame.baseY,
      alphaHint: frame.alpha === undefined ? (frame.alphaHint ?? 0) : Number(frame.alpha) + 1,
      bpp:
        frame.bpp === 24 &&
        (!(image instanceof HG3) || nativeABI(this.world.profile).graphics.preserveRGB24)
          ? 3
          : 4,
      clip: [0, 0, frame.width, frame.height],
      attributes: frame.attributes ?? [],
      blendType: frame.blendType ?? 0,
      imageMode: frame.imageMode ?? 0,
      source: null,
      rgba: new Uint8ClampedArray(pixels),
    };
  }
  addDecoded(image, frame) {
    return this.add(new NativeBitmap(this, this.decodedState(image, frame)));
  }
  async formattedLoad(text, owner) {
    let handle = 0;
    const physical = nativeABI(this.world.profile).graphics.formattedBitmapPhysical;
    for (const token of text.split(' ').filter(Boolean)) {
      const { stem, extension } = nativeImagePathParts(token),
        match = (physical ? /^([^:]*):(.*)$/ : /^(.*):([+-]?\d+)$/).exec(stem),
        frame = match && (physical ? parseNativeInteger(match[2]) : Number(match[2])),
        next = await this.load(match ? match[1] + extension : token, (frame ?? 0) >>> 0, owner);
      if (!handle) handle = next;
      else if (next) {
        const destination = this.get(handle),
          source = this.get(next),
          x = source.state.offsetX - destination.state.offsetX,
          y = source.state.offsetY - destination.state.offsetY;
        try {
          if (physical) {
            const dx = Math.max(0, x),
              bottom = Math.max(0, y),
              height = Math.min(source.height, destination.height - bottom);
            if (
              x + source.width > 0 &&
              y + source.height > 0 &&
              dx < destination.width &&
              height > 0
            )
              await destination.blit(source, {
                dx,
                dy: destination.height - bottom - height,
                sy: source.height - height,
                height,
              });
          } else await destination.blit(source, { dx: x, dy: y });
        } finally {
          await this.release(next);
        }
      }
    }
    return handle;
  }
  async release(handle, options) {
    const bitmap = this.handles.release(handle, 'bitmap');
    originalView(this.world, 'forgetImage', handle);
    if (
      ![...this.handles.records.values()].some(
        (record) => record.type === 'bitmap' && record.value.dataHandle === bitmap.dataHandle,
      )
    )
      this.handles.release(bitmap.dataHandle, 'bitmap-data');
    await this.nativeMemory?.release(handle, options);
    return bitmap;
  }
  async releaseOwner(owner) {
    for (const [handle, resource] of this.handles.records)
      if (resource.type === 'bitmap' && resource.value.owner === owner) await this.release(handle);
    await originalView(this.world, 'disposeBitmapContext', owner);
  }
}

export const NATIVE_IMAGE_IDS = Object.freeze([0x6f, 0x70, 0x72, 0x75, 0x76, 0x77, 0x79, 0x7a]);
export async function nativeImage(id, args, machine, task, world) {
  if (!NATIVE_IMAGE_IDS.includes(id)) return undefined;
  if (id === 0x7a && world.bitmapOperations)
    return world.bitmapOperations.apply(id, args, machine, task);
  if (id === 0x7a) return undefined;
  return (world.bitmapFactories ?? new NativeBitmapFactories(world)).apply(id, args, machine, task);
}
