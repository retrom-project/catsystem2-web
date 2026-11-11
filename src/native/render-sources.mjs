// SPDX-License-Identifier: MPL-2.0
// VM record layouts stay per ABI. Resource identity and ownership live in JS.
import { openImage, HG3 } from '../formats/hg3.mjs';
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument, nativeDataMapped, nativeDataFormat } from './data-text.mjs';
import { loadImageOwner } from './image-owner-load.mjs';
import { RetainedAnimation } from './retained-animation.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export const NATIVE_RENDER_SOURCE_CONTRACTS = Object.freeze(
  [
    [0x2bf, 3, 1],
    [0x2c0, 2, 2],
    [0x2c2, 2, 1],
    [0x2c5, 2, 1],
  ].map(([id, words, control]) => Object.freeze({ id, words, control })),
);
export class NativeRenderSources {
  constructor(world) {
    this.world = world;
    this.handles = world.runtime.handles;
    this.handles.registerType('render-source', {
      snapshot: (source) => ({ ...source, animation: source.animation?.snapshot() ?? null }),
      restore: (source) => ({
        ...source,
        animation: source.animation && RetainedAnimation.restore(source.animation, world.random),
      }),
    });
  }
  get(handle) {
    return this.handles.get(handle, 'render-source');
  }
  create({ bitmap = 0, frames = [], program = null, children = [], bounds = null } = {}) {
    let animation = null;
    if (program?.length) {
      try {
        animation = new RetainedAnimation(program, this.world.random);
        animation.maxFrameKey = Math.max(0, ...frames.map((frame) => frame.key));
      } catch (error) {
        this.world.host?.nativeDiagnostic?.({ type: 'invalid-anm', error: error.message });
      }
    }
    const currentBitmap = bitmap || frames[0]?.bitmap || 0;
    return this.handles.add('render-source', {
      revision: 0,
      sourceBitmap: currentBitmap,
      bitmapRevision: currentBitmap
        ? this.world.graphics.images.get(currentBitmap).state.revision
        : -1,
      groupDirty: false,
      refs: 1,
      bitmap,
      frames,
      children,
      bounds,
      animation,
      selected: frames[0]?.key ?? 0,
      enabled: 0,
      outputCache: [0xffffffff, 255, 1, 0, 0],
      prefetchFrames: nativeABI(this.world.profile).graphics.retainedBytes > 208,
      hasProgram: Boolean(program?.length),
      startPending: frames.length > 0 && nativeABI(this.world.profile).graphics.retainedBytes > 208,
      baseAlpha: 255,
      baseShown: 0,
      position: [0, 0],
      base: [0, 0],
      rotation: 0,
      scale: [1, 1],
      mode: 0,
      aux: 0,
    });
  }
  retain(handle) {
    this.get(handle).refs++;
    return handle;
  }
  async release(handle, { destroy = false } = {}) {
    const source = this.get(handle);
    if (!destroy && --source.refs > 0) return;
    this.handles.release(handle, 'render-source');
    for (const child of source.children) await this.release(child);
    const bitmaps = new Set([source.bitmap, ...source.frames.map((frame) => frame.bitmap)]);
    for (const bitmap of bitmaps) if (bitmap) await this.world.graphics.images.release(bitmap);
  }
  bitmap(handle, { first = false, ordinal = null } = {}) {
    const source = this.get(handle);
    if (ordinal !== null) return source.frames[Math.max(0, ordinal | 0)]?.bitmap ?? 0;
    if (source.children.length) return source.bitmap;
    if (source.frames.length) {
      const frame =
        ordinal === null
          ? first
            ? source.frames[0]
            : source.frames.find((frame) => frame.key === source.selected)
          : source.frames[Math.max(0, ordinal | 0)];
      return frame?.bitmap ?? 0;
    }
    return source.bitmap;
  }
  async decode(bytes) {
    const image = await openImage(bytes),
      images = this.world.graphics.images,
      candidates =
        nativeABI(this.world.profile).graphics.preserveRGB24 || image instanceof HG3
          ? image.frames
          : image.frames.slice(0, 1),
      frames = [];
    try {
      for (const frame of candidates) {
        if (frames.some((f) => f.key === frame.id >>> 0)) continue;
        await image.decode(frame);
        frames.push({ key: frame.id >>> 0, bitmap: images.addDecoded(image, frame) });
      }
      frames.sort((a, b) => a.key - b.key);
      if (!frames.length) return 0;
      return frames.length === 1
        ? this.create({ bitmap: frames[0].bitmap })
        : this.create({ frames });
    } catch (error) {
      for (const frame of frames) await images.release(frame.bitmap);
      throw error;
    }
  }
  async load(name, task) {
    const owners = this.world.imageOwners,
      owner = await loadImageOwner(owners, name, task, { describeLayers: true });
    if (!owner) return [];
    const record = owners.get(owner),
      layers = record.layers ?? [{ bitmap: record.bitmap, program: null }],
      outputs = [];
    this.handles.release(owner, 'image-owner');
    const used = new Set(
      layers.flatMap((layer) => [
        layer.bitmap,
        ...(layer.animation?.frames ?? []).map((f) => f.bitmap),
      ]),
    );
    if (record.bitmap && !used.has(record.bitmap))
      await this.world.graphics.images.release(record.bitmap);
    for (const layer of layers) {
      if (layer.animation)
        outputs.push({
          tag: 2,
          handle: this.create({
            frames: layer.animation.frames,
            program: layer.program,
            bounds: layer.animation.bounds,
          }),
          name: layer.name,
        });
      else if (layer.bitmap) outputs.push({ tag: 1, handle: layer.bitmap, name: layer.name });
    }
    return outputs;
  }
  async withBitmapOperation(handle, operation, name) {
    if (this.handles.records.get(handle)?.type !== 'bitmap')
      throw new Error(`Unknown or released bitmap ${name} input ${handle}`);
    return operation(this.world.graphics.images.get(handle));
  }
  async apply(id, args, machine, task, scheduler) {
    const a = (i) => nativeDataArgument(args, machine, i),
      images = this.world.graphics.images,
      layout = nativeABI(this.world.profile).graphics.renderSources,
      stride = layout.stride,
      value = (word) => nativeReply(1, word);
    if (id === 0x2bf) {
      const address = a(1) >>> 0,
        count = a(2) | 0;
      if (count <= 0 || !nativeDataMapped(machine, address)) return value(0);
      // Formatting precedes initialization because source/destination may alias.
      const bytes = nativeDataFormat(args, machine, this.world.runtime.services, 0),
        name = bytes ? new TextDecoder('shift_jis').decode(bytes) : '';
      for (let i = 0; i < count; i++) {
        machine.store(address + i * stride, 0);
        machine.store(address + i * stride + 4, 0);
      }
      const outputs = name ? await this.load(name, task) : [];
      for (const [i, output] of outputs.entries()) {
        const at = address + i * stride;
        machine.store(at, output.tag);
        machine.store(at + 4, output.handle);
        if (name.includes(',') && output.name) {
          const width = (stride - 8) / 64;
          if (width === 1) {
            const nameBytes = encodeCP932(output.name).subarray(0, 63);
            machine.bytes(at + 8, nameBytes.length).set(nameBytes);
            machine.store(at + 8 + nameBytes.length, 0, 1);
          } else {
            const text = output.name.slice(0, 63);
            for (let j = 0; j < text.length; j++)
              machine.store(at + 8 + j * 2, text.charCodeAt(j), 2);
            machine.store(at + 8 + text.length * 2, 0, 2);
          }
        }
      }
      return value(outputs.length);
    }
    if (id === 0x2c0) {
      const address = a(0) >>> 0;
      if (!nativeDataMapped(machine, address)) return nativeReply(2);
      const liveCount = () =>
        scheduler || (task.io?.native === id && task.io.pc === machine.pc)
          ? machine.load(machine.nativeArgumentBase + 4)
          : a(1) >>> 0;
      for (let i = 0; i < liveCount(); i++) {
        const at = address + i * stride,
          tag = machine.load(at),
          handle = machine.load(at + 4);
        if ((tag === 1 || tag === 2) && handle) {
          if (tag === 1) await images.release(handle);
          else await this.release(handle);
          machine.store(at + 4, 0);
        }
        machine.store(at, 0);
      }
      return nativeReply(2);
    }
    const handle = a(0) >>> 0;
    if (id === 0x2c5) return value(handle ? this.bitmap(handle, { ordinal: a(1) | 0 }) : 0);
    if (id === 0x2c2) {
      const address = a(1) >>> 0;
      if (!handle || !nativeDataMapped(machine, address)) return value(0);
      machine.bytes(address, 36).fill(0);
      const bitmap = this.bitmap(handle, { first: true });
      if (!bitmap) return value(0);
      const s = images.get(bitmap).state;
      [
        s.offsetX,
        s.offsetY,
        s.width,
        s.height,
        s.canvasWidth || s.width,
        s.canvasHeight || s.height,
        s.bpp,
        s.baseX,
        s.baseY,
      ].forEach((word, i) => machine.store(address + i * 4, word ?? 0));
      return value(1);
    }
    return undefined;
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeRenderSources(world) {
  const sources = (world.renderSources = new NativeRenderSources(world));
  world.registerNativeFeature('render-sources', (engine) => {
    engine.registerFeature('render-sources', sources);
    return sources;
  });
  for (const { id } of NATIVE_RENDER_SOURCE_CONTRACTS)
    world.runtime.register('main', id, (args, machine, task, scheduler) =>
      sources.apply(id, args, machine, task, scheduler),
    );
}
