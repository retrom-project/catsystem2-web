// SPDX-License-Identifier: MPL-2.0
// Native bitmap fields and CPU operations: 68BE00, 68C760, 68D450, 68D9E0.
import { encodeSparseBytes, decodeSparseBytes } from './sparse-bytes.mjs';
import { NativeBitmapFactories } from './bitmap-factory.mjs';
import { nativeABI } from './abi/index.mjs';
import { nativeImagePathParts } from './image-file.mjs';
import { readNativeResource, nativeCategoryFilename } from './resource-file.mjs';
import { ImageStore, HG3 } from '../formats/hg3.mjs';
const f = Math.fround;
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
  async pixels() {
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
  changed() {
    this.state.revision = (this.state.revision || 0) + 1;
    this.cachedFrame = null;
    this.canvas = null;
    return this.registry?.nativeMemory?.changed(this.dataHandle);
  }
  async frame() {
    if (
      this.dataHandle &&
      this.registry.nativeMemory?.refs.data.has(this.dataHandle) &&
      !this.registry.nativeMemory.isOwned?.(this.dataHandle)
    )
      await this.pixels();
    if (!this.cachedFrame || this.cachedFrame.revision !== this.state.revision)
      this.cachedFrame = {
        width: this.width,
        height: this.height,
        rgba: await this.pixels(),
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
    // 68EB30 / 68BA90 copy raw bitmap pixels and reset canvas/anchor/clip
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
    } = {},
  ) {
    // 6879D0 clips source and destination independently, then limits both to
    // the smaller extent. A negative destination does not advance the source.
    const sr = intersect([sx, sy, sx + width, sy + height], [0, 0, source.width, source.height]);
    const dr = intersect([dx, dy, dx + width, dy + height], [0, 0, this.width, this.height]);
    const count = Math.min(sr[2] - sr[0], dr[2] - dr[0]),
      rows = Math.min(sr[3] - sr[1], dr[3] - dr[1]);
    if (!count || !rows) return false;
    const dest = await this.pixels(),
      input = await source.pixels();
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
    await this.changed();
    return true;
  }
  async resize(width, height) {
    if (
      this.state.bpp !== 4 &&
      !(
        this.state.bpp === 3 &&
        nativeABI(this.registry.world.profile ?? this.registry.world.nativeEngine.profile).graphics
          .resizeRGB24
      )
    )
      return;
    size(width, height);
    const old = this.state,
      ratioX = f(f(width) / f(old.canvasWidth || old.width)),
      ratioY = f(f(height) / f(old.canvasHeight || old.height));
    const round = (value, ratio) => Math.trunc(f(f(f(value) * ratio) + 0.5));
    const nextWidth = round(old.width, ratioX),
      nextHeight = round(old.height, ratioY);
    size(nextWidth, nextHeight);
    const logical = await this.pixels(),
      physical = new Uint8ClampedArray(logical.length);
    for (let y = 0; y < old.height; y++)
      physical.set(
        logical.subarray(y * old.width * 4, (y + 1) * old.width * 4),
        (old.height - 1 - y) * old.width * 4,
      );
    const sampled = resampleBitmap(physical, old.width, old.height, nextWidth, nextHeight),
      pixels = new Uint8ClampedArray(sampled.length);
    for (let y = 0; y < nextHeight; y++)
      pixels.set(
        sampled.subarray(y * nextWidth * 4, (y + 1) * nextWidth * 4),
        (nextHeight - 1 - y) * nextWidth * 4,
      );
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

export function resampleBitmap(source, width, height, nextWidth, nextHeight, region = null) {
  size(width, height);
  size(nextWidth, nextHeight);
  if (!region && width === nextWidth && height === nextHeight) return new Uint8ClampedArray(source);
  const regionWidth = region?.width ?? width,
    regionHeight = region?.height ?? height;
  const output = new Uint8ClampedArray(nextWidth * nextHeight * 4);
  if (regionWidth > 4 * nextWidth || regionHeight > 4 * nextHeight) {
    const rx = f(f(regionWidth) / f(nextWidth)),
      ry = f(f(regionHeight) / f(nextHeight)),
      nx = Math.max(1, Math.trunc(rx)),
      ny = Math.max(1, Math.trunc(ry));
    for (let y = 0; y < nextHeight; y++)
      for (let x = 0; x < nextWidth; x++) {
        const sx = Math.trunc(f(f(x) * rx)),
          sy = Math.trunc(f(f(y) * ry));
        for (let c = 0; c < 4; c++) {
          let sum = 0,
            count = 0;
          for (let j = 0; j < ny; j++)
            for (let i = 0; i < nx; i++) {
              sum += source[((sy + j) * width + sx + i) * 4 + c];
              count++;
            }
          output[(y * nextWidth + x) * 4 + c] = Math.floor(sum / count);
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
      if (sx >= width || sy >= height) continue;
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
      for (let channel = 0; channel < 4; channel++)
        output[(y * nextWidth + x) * 4 + channel] =
          channel === 3 && source[a + 3] + source[b + 3] + source[c + 3] + source[d + 3] === 1020
            ? 255
            : (weights[0] * source[a + channel] +
                weights[1] * source[b + channel] +
                weights[2] * source[c + channel] +
                weights[3] * source[d + channel]) >>>
              15;
    }
  return output;
}

export class NativeImages {
  constructor(world) {
    this.world = world;
    this.assets = new Map();
    this.handles = world.runtime.handles;
    this.images =
      typeof world.images?.load === 'function' && !(world.images instanceof ImageStore)
        ? world.images
        : new ImageStore({
            ...world.game,
            resolveCategory: (file) => nativeCategoryFilename(world.game, file, 'image'),
            require: async (file) => {
              const bytes = await readNativeResource(world, file);
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
    return this.world.nativeEngine?.features.get('bitmap-memory');
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
  async importNative(wrapper, owner = null, { rowOrder } = {}) {
    if (!['top-down', 'bottom-up'].includes(rowOrder))
      throw new Error('Native bitmap import requires its pixel row order');
    const buffers = await this.world.getNativeFeature('data-buffers'),
      p = buffers.process,
      pointer = p.load(wrapper),
      width = p.load(pointer + 4),
      height = p.load(pointer + 8),
      data = p.load(pointer + 12),
      stride = p.load(pointer + 20),
      bpp = p.load(pointer + 24);
    size(width, height, true);
    if (![3, 4].includes(bpp) || stride < width * bpp)
      throw new Error(
        `Native decoded bitmap layout is unavailable: ${width}x${height}/${bpp}/${stride}`,
      );
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = p.read(
        data + (rowOrder === 'bottom-up' ? height - y - 1 : y) * stride,
        width * bpp,
      );
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4,
          src = x * bpp;
        rgba[at] = row[src + 2];
        rgba[at + 1] = row[src + 1];
        rgba[at + 2] = row[src];
        rgba[at + 3] = bpp === 4 ? row[src + 3] : 255;
      }
    }
    const handle = this.add(
      new NativeBitmap(this, {
        width,
        height,
        bpp: 4,
        rgba,
        canvasWidth: p.load(pointer + 28),
        canvasHeight: p.load(pointer + 32),
        offsetX: p.load(pointer + 36) | 0,
        offsetY: p.load(pointer + 40) | 0,
        baseX: p.load(pointer + 48) | 0,
        baseY: p.load(pointer + 52) | 0,
        clip: Array.from({ length: 4 }, (_, i) => p.load(pointer + 56 + i * 4) | 0),
        source: null,
        attributes: [],
        owner,
      }),
    );
    try {
      const memory =
        this.nativeMemory ||
        (this.world.nativeFeatureFactories?.has('bitmap-memory')
          ? await this.world.getNativeFeature('bitmap-memory')
          : null);
      if (memory) await memory.adopt(handle, pointer);
      await buffers.releaseBitmapPointer(wrapper);
    } catch (error) {
      await this.release(handle);
      throw error;
    }
    return handle;
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
    let state = this.assets.get(key);
    if (!state) {
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
        await image.decode(frame);
      } catch (error) {
        this.world.host?.nativeDiagnostic?.({ type: 'image-invalid', file, error: error.message });
        return 0;
      }
      state = this.decodedState(image, frame);
      this.assets.set(key, structuredClone(state));
      while (this.assets.size > 32) this.assets.delete(this.assets.keys().next().value);
    }
    const bitmap = new NativeBitmap(this, state, { owner });
    this.world.imageLoaded?.({ file, frameID: id, owner, native: 'image' });
    return this.add(bitmap);
  }
  decodedState(image, frame) {
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
      rgba: new Uint8ClampedArray(frame.rgba),
    };
  }
  addDecoded(image, frame) {
    return this.add(new NativeBitmap(this, this.decodedState(image, frame)));
  }
  async formattedLoad(text, owner) {
    let handle = 0;
    for (const token of text.split(' ').filter(Boolean)) {
      const { stem, extension } = nativeImagePathParts(token),
        match = /^(.*):([+-]?\d+)$/.exec(stem),
        next = await this.load(
          match ? match[1] + extension : token,
          match ? Number(match[2]) >>> 0 : 0,
          owner,
        );
      if (!handle) handle = next;
      else if (next) {
        const destination = this.get(handle),
          source = this.get(next);
        await destination.blit(source, {
          dx: source.state.offsetX - destination.state.offsetX,
          dy: source.state.offsetY - destination.state.offsetY,
        });
        await this.release(next);
      }
    }
    return handle;
  }
  async release(handle, options) {
    const bitmap = this.handles.release(handle, 'bitmap');
    this.world.nativeEngine?.features.get('graphics-platform')?.forgetImageHandle(handle);
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
    await this.world.nativeEngine?.features.get('bitmap-factories')?.disposeContext?.(owner);
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
