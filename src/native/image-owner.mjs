// SPDX-License-Identifier: MPL-2.0
// Logical image owners keep their bitmap state and automatic task lifetime in JS.
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { imageOwnerPixels } from './image-owner-pixels.mjs';
import { bitmapExpand } from './bitmap-pixels.mjs';
import { nativeDataArgument, nativeDataMapped } from './data-text.mjs';
const rows = [
  [0x2c6, 1, 1],
  [0x2c7, 1, 2],
  [0x2c8, 3, 2],
  [0x2c9, 4, 2],
  [0x2ca, 3, 2],
  [0x2cb, 3, 2],
  [0x2cc, 2, 2],
  [0x2cd, 3, 1],
  [0x2ce, 3, 1],
  [0x2cf, 3, 1],
  [0x2d0, 3, 1],
  [0x2d1, 1, 1],
  [0x2d2, 2, 2],
  [0x2d3, 2, 2],
  [0x2d4, 7, 1],
  [0x2d5, 2, 1],
  [0x2d6, 3, 2],
  [0x2d7, 2, 2],
  [0x2d8, 2, 2],
  [0x2d9, 2, 2],
  [0x2da, 3, 2],
  [0x2db, 13, 2],
  [0x2dc, 13, 2],
  [0x2dd, 2, 1],
  [0x2de, 10, 2],
  [0x2df, 10, 2],
  [0x2e0, 6, 2],
  [0x2e1, 2, 2],
];
export const NATIVE_IMAGE_OWNER_CONTRACTS = Object.freeze(
  rows.map(([id, words, control]) => Object.freeze({ id, words, control })),
);
export const NATIVE_IMAGE_OWNER_IDS = Object.freeze(rows.map(([id]) => id));
export const NATIVE_IMAGE_OWNER_JS_IDS = Object.freeze([
  ...rows.map(([id]) => id).filter((id) => id !== 0x2c6),
]);
export const nativeImageOwnerCodec = Object.freeze({
  snapshot: (value) => structuredClone(value),
  restore: (value) => structuredClone(value),
});

export class NativeImageOwners {
  constructor(world) {
    this.world = world;
  }
  get(handle) {
    return this.world.runtime.handles.get(handle, 'image-owner');
  }
  add(bitmap, owner, info) {
    return this.world.runtime.handles.add('image-owner', { bitmap, owner, info, layers: null });
  }
  async projection() {
    return this.world.getNativeFeature('image-owner-projection');
  }
  async materialize(handle) {
    return (await this.projection()).prepare(handle);
  }
  pointer(handle) {
    if (!handle) return 0;
    return this.world.nativeEngine.features.get('image-owner-projection').pointer(handle);
  }
  async release(handle) {
    const record = this.get(handle);
    await this.world.nativeEngine?.features.get('image-owner-projection')?.releaseModel(handle);
    this.world.runtime.handles.release(handle, 'image-owner');
    const handles = new Set([
      record.bitmap,
      ...(record.layers ?? []).flatMap((layer) => [
        layer.bitmap,
        ...(layer.animation?.frames ?? []).map((f) => f.bitmap),
      ]),
    ]);
    for (const handle of handles) if (handle) await this.world.graphics.images.release(handle);
  }
  async releaseOwner(owner) {
    for (const [handle, record] of [...this.world.runtime.handles.records])
      if (record.type === 'image-owner' && record.value.owner === owner) await this.release(handle);
  }
  async apply(id, args, machine, task) {
    if (!NATIVE_IMAGE_OWNER_IDS.includes(id)) return undefined;
    const argument = (index) => nativeDataArgument(args, machine, index),
      value = (word) => nativeReply(1, word),
      done = () => nativeReply(2),
      first = argument(0) >>> 0,
      images = this.world.graphics.images;
    if (id === 0x2dd) {
      const height = argument(1) >>> 0,
        bitmap = images.create(first, height);
      return value(this.add(bitmap, task.id, [first, height, first, height, 0, 0, 0, 0, 4, 1, 1]));
    }
    if (id === 0x2c6) {
      if (!nativeDataMapped(machine, first)) return value(0);
      return value(await (await this.projection()).load(args, machine, task));
    }
    if (id === 0x2d5 && (!first || !argument(1))) return value(1);
    if (![0x2c7, 0x2c8, 0x2ca, 0x2cb, 0x2cd, 0x2ce, 0x2cf, 0x2d0, 0x2d1, 0x2d2].includes(id))
      return imageOwnerPixels(this, id, argument, machine, task);
    if (id === 0x2c7) {
      if (first) await this.release(first);
      return done();
    }
    const query = new Map([
        [0x2c8, ['width', 'height']],
        [0x2ca, ['canvasWidth', 'canvasHeight']],
        [0x2cb, ['offsetX', 'offsetY']],
        [0x2cd, ['baseX', 'baseY']],
      ]),
      setters = new Map([
        [0x2ce, ['canvasWidth', 'canvasHeight']],
        [0x2cf, ['offsetX', 'offsetY']],
        [0x2d0, ['baseX', 'baseY']],
      ]);
    if (query.has(id)) {
      if (!first) return id === 0x2cd ? value(1) : done();
      const record = this.get(first);
      if (!record.bitmap) return id === 0x2cd ? value(0) : done();
      const state = images.get(record.bitmap).state;
      const words = query.get(id).map((key) => state[key] ?? 0);
      if (id === 0x2ca) {
        words[0] ||= state.width;
        words[1] ||= state.height;
      }
      words.forEach((word, index) => machine.store(argument(index + 1), word));
      return id === 0x2cd ? value(1) : done();
    }
    if (setters.has(id)) {
      if (!first) return value(1);
      const record = this.get(first);
      if (!record.bitmap) return value(0);
      const bitmap = images.get(record.bitmap);
      setters.get(id).forEach((key, index) => {
        bitmap.state[key] = argument(index + 1) | 0;
      });
      await bitmap.changed();
      return value(1);
    }
    if (id === 0x2d1) {
      if (!first) return value(NATIVE_RESULT_SENTINEL);
      const record = this.get(first);
      return value(
        record.bitmap ? Number(await images.get(record.bitmap).hasAlpha()) : NATIVE_RESULT_SENTINEL,
      );
    }
    if (id === 0x2d2) {
      if (first) {
        const record = this.get(first);
        if (record.bitmap) {
          const bitmap = images.get(record.bitmap);
          bitmap.state.alphaHint = Number(argument(1) !== 0) + 1;
          await bitmap.changed();
        }
      }
      return done();
    }
  }
  expand(bitmap, x, y) {
    return bitmapExpand(bitmap, x, x, y, y);
  }
  async rebuild(record) {
    const images = this.world.graphics.images;
    for (const layer of record.layers)
      if (layer.animation) {
        const frame = layer.animation.frames.find(
          (f) => f.key === layer.animation.selected && f.bitmap,
        );
        if (frame) {
          const state = images.get(frame.bitmap).state;
          layer.animation.bounds.baseX = state.baseX;
          layer.animation.bounds.baseY = state.baseY;
        }
      }
    const sources = record.layers.map((layer) =>
      layer.bitmap ? images.get(layer.bitmap) : layer.animation,
    );
    if (!sources.length) return;
    const states = sources.map((s) => s.state ?? s.bounds),
      left = Math.min(...states.map((s) => s.offsetX)),
      bottom = Math.min(...states.map((s) => s.offsetY)),
      right = Math.max(...states.map((s) => s.offsetX + s.width)),
      top = Math.max(...states.map((s) => s.offsetY + s.height));
    const metadata = {
      width: right - left,
      height: top - bottom,
      canvasWidth: Math.max(...states.map((s) => s.canvasWidth || s.width)),
      canvasHeight: Math.max(...states.map((s) => s.canvasHeight || s.height)),
      offsetX: left,
      offsetY: bottom,
      baseX: states[0].baseX,
      baseY: states[0].baseY,
    };
    const old = record.bitmap;
    if (record.layers.length === 1 && record.layers[0].bitmap)
      record.bitmap = record.layers[0].bitmap;
    else {
      record.bitmap = images.create(metadata.width, metadata.height);
      const output = images.get(record.bitmap);
      Object.assign(output.state, metadata);
      for (const layer of record.layers) {
        const input =
          layer.bitmap ||
          layer.animation?.frames.find((f) => f.key === layer.animation.selected)?.bitmap;
        if (!input) continue;
        const image = images.get(input),
          s = image.state;
        const f = Math.fround;
        const position = layer.bitmap
          ? [f((s.baseX - left) >>> 0), f((s.baseY - bottom) >>> 0)]
          : [f(f(s.baseX) - f(left >>> 0)), f(f(s.baseY) - f(bottom >>> 0))];
        const rawX = Math.trunc(f(position[0] - f(s.baseX))) + s.offsetX,
          rawY = Math.trunc(f(position[1] - f(s.baseY))) + s.offsetY;
        const sx = Math.max(0, -rawX),
          sy = Math.max(0, -rawY),
          dx = Math.max(0, rawX),
          dy = Math.max(0, rawY),
          width = Math.min(image.width - sx, output.width - dx),
          height = Math.min(image.height - sy, output.height - dy);
        if (width > 0 && height > 0)
          await output.blit(image, {
            dx,
            dy: output.height - dy - height,
            sx,
            sy: image.height - sy - height,
            width,
            height,
            copy: s.bpp === 3,
          });
        if (!layer.bitmap) continue;
        const attrs = new Map(output.state.attributes.map((v) => [v.id, v]));
        for (const attr of s.attributes ?? []) attrs.set(attr.id, structuredClone(attr));
        output.state.attributes = [...attrs.values()].sort((a, b) => a.id - b.id);
      }
    }
    const state = images.get(record.bitmap).state;
    record.info = [
      metadata.width,
      metadata.height,
      metadata.canvasWidth,
      metadata.canvasHeight,
      left,
      bottom,
      metadata.baseX,
      metadata.baseY,
      state.bpp,
      1,
      record.info[10],
    ];
    if (
      old &&
      old !== record.bitmap &&
      !record.layers.some(
        (l) => l.bitmap === old || l.animation?.frames.some((f) => f.bitmap === old),
      )
    )
      await images.release(old);
    record.rebuild = (record.rebuild ?? 0) + 1;
  }
  async close() {
    for (const [handle, record] of [...this.world.runtime.handles.records])
      if (record.type === 'image-owner') await this.release(handle);
  }
  snapshot() {
    // The handles checkpoint owns the models and their bitmap references.
    return {};
  }
  restore() {}
}
export function installNativeImageOwners(world) {
  const owners = new NativeImageOwners(world);
  world.imageOwners = owners;
  world.registerNativeFeature('image-owners', (engine) => {
    engine.registerFeature('image-owners', owners);
    return owners;
  });
  world.registerNativeFeature('image-owner-projection', async (engine) => {
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('data-buffers');
    await world.getNativeFeature('retained-draw');
    await world.getNativeFeature('graphics-platform');
    if (typeof engine.createImageOwnerProjection !== 'function')
      throw new Error('Image-owner projection requires the injected transitional EXE host');
    return engine.createImageOwnerProjection(world);
  });
  for (const id of NATIVE_IMAGE_OWNER_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      owners.apply(id, args, machine, task),
    );
}
