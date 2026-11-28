// SPDX-License-Identifier: MPL-2.0
// D7 producers lend image/ANM records to JS Draw. Removed with FES in phase 7.
import { NativeBitmap } from '../src/native/image.mjs';
import { RetainedAnimation } from '../src/native/retained-animation.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { bitsFloat, floatBits } from '../src/kcs.mjs';
const fields = {
  width: 4,
  height: 8,
  bpp: 24,
  canvasWidth: 28,
  canvasHeight: 32,
  offsetX: 36,
  offsetY: 40,
  alphaHint: 44,
  baseX: 48,
  baseY: 52,
  mask: 76,
  blendType: 84,
  imageMode: 88,
};
export class NativeFESDrawProjection {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.identities = new Map();
    this.nextIdentity = 1;
    this.sources = new Map();
    this.owners = new Map();
    this.bitmaps = new Map();
    this.detachFree = this.process.observeFree((pointer) => {
      for (const [address, record] of this.identities)
        if (record.base === pointer) this.identities.delete(address);
      this.sources.delete(pointer);
      this.owners.delete(pointer);
      this.bitmaps.delete(pointer);
    });
    engine.registerFeature('fes-draw-projection', this);
  }
  token(pointer) {
    if (!this.identities.has(pointer)) {
      const allocation = [...this.process.allocations].find(
        ([base, size]) => pointer >= base && pointer < base + size,
      );
      this.identities.set(pointer, { id: this.nextIdentity++, base: allocation?.[0] ?? pointer });
    }
    return this.identities.get(pointer).id;
  }
  identity(words) {
    const kind = words.slice(0, 4).findIndex(Boolean),
      pointer = words[kind];
    const data =
      kind === 0 ? this.process.load(pointer + 12) : kind === 1 ? this.process.load(pointer) : 0;
    return `${kind}:${this.token(pointer)}:${data ? this.token(data) : 0}`;
  }
  async refreshBitmap(pointer) {
    if (!this.bitmaps.has(pointer)) return;
    const alias = this.bitmap(pointer);
    await this.world.graphics.images.release(alias);
  }
  bitmap(pointer) {
    if (!pointer) return 0;
    const images = this.world.graphics.images,
      handles = images.handles,
      memory = this.engine.features.get('bitmap-memory');
    const owned = [...(memory?.refs.data ?? [])].find(
      ([id, record]) => record.pointer === pointer && handles.records.has(id) && memory.isOwned(id),
    );
    if (owned) return images.add(new NativeBitmap(images, null, { dataHandle: owned[0] }));
    const state = this.engine.features.get('graphics-platform').logicalBitmap(pointer).state;
    for (const [key, offset] of Object.entries(fields))
      state[key] = ['offsetX', 'offsetY', 'baseX', 'baseY'].includes(key)
        ? this.process.load(pointer + offset) | 0
        : this.process.load(pointer + offset);
    state.attributes = memory?.attributes({ pointer }) ?? [];
    const previous = this.bitmaps.get(pointer);
    if (previous && handles.records.has(previous.data)) {
      const current = handles.get(previous.data, 'bitmap-data');
      state.revision = (current.revision + 1) >>> 0;
      Object.assign(current, state);
      previous.revision = state.revision;
      return images.add(new NativeBitmap(images, null, { dataHandle: previous.data }));
    }
    const handle = images.add(new NativeBitmap(images, state)),
      bitmap = images.get(handle);
    this.bitmaps.set(pointer, { data: bitmap.dataHandle, revision: bitmap.state.revision });
    return handle;
  }
  wrapper(pointer) {
    return pointer ? this.bitmap(this.process.load(pointer)) : 0;
  }
  animation(pointer) {
    if (!pointer) return null;
    const p = this.process,
      count = p.load(pointer),
      array = p.load(pointer + 4),
      bytes = new Uint8Array(32 + count * 68),
      view = new DataView(bytes.buffer);
    view.setUint32(
      0,
      0x004d4e41 /* exe-address-check: non-address - little-endian ANM file signature */,
      true,
    );
    view.setUint32(4, p.load(pointer + 8), true);
    view.setUint32(8, count, true);
    bytes.set(p.read(array, count * 68), 32);
    const animation = new RetainedAnimation(bytes, this.world.random);
    Object.assign(animation, {
      startFrame: p.load(pointer + 12),
      duration: p.load(pointer + 16),
      pc: p.load(pointer + 20) | 0,
      baseFrame: p.load(pointer + 24),
      maxFrameKey: p.load(pointer + 28),
      speed: bitsFloat(p.load(pointer + 292)),
      output: Object.fromEntries(
        ['frame', 'alpha', 'display', 'x', 'y'].map((key, i) => [
          key,
          ['x', 'y'].includes(key)
            ? p.load(pointer + 296 + i * 4) | 0
            : p.load(pointer + 296 + i * 4),
        ]),
      ),
    });
    animation.registers.set(Array.from({ length: 64 }, (_, i) => p.load(pointer + 32 + i * 4)));
    return animation;
  }
  async retained(pointer) {
    const cached = this.sources.get(pointer),
      resources = this.world.renderSources;
    if (cached && this.world.runtime.handles.records.has(cached.handle))
      return resources.retain(cached.handle);
    const p = this.process,
      frames = [],
      map = p.load(pointer + 60),
      hasPending = nativeABI(this.engine.profile).graphics.retainedBytes > 208;
    if (map) {
      const head = p.load(map),
        stack = [],
        seen = new Set();
      let node = p.load(head + 4);
      while (stack.length || node !== head) {
        while (node !== head) {
          if (seen.has(node)) throw new Error('FES source frame map contains a cycle');
          seen.add(node);
          stack.push(node);
          node = p.load(node);
        }
        node = stack.pop();
        if (hasPending && p.load(node + 24)) {
          const workers = this.engine.features.get('engine-workers');
          for (const [handle, worker] of workers?.threads ?? [])
            if (worker.kind === 'image' && worker.owner === pointer && !worker.completed)
              await workers.step(handle);
          if (p.load(node + 24))
            throw new Error('FES source frame is still pending at the producer boundary');
        }
        const wrapper = p.load(node + 20);
        frames.push({ key: p.load(node + 16), bitmap: this.wrapper(wrapper), wrapper });
        node = p.load(node + 8);
      }
    }
    const handle = resources.create({
        bitmap: frames.length ? 0 : this.wrapper(p.load(pointer + 8)),
        frames: frames.map(({ key, bitmap }) => ({ key, bitmap })),
      }),
      source = resources.get(handle),
      nested = p.load(pointer + 160);
    Object.assign(source, {
      animation: this.animation(p.load(pointer + 72)),
      selected: p.load(pointer + 76),
      outputCache: Array.from({ length: 5 }, (_, i) => p.load(pointer + 84 + i * 4)),
      enabled: p.load(pointer + 80),
      startPending: hasPending && Boolean(p.load(pointer + 208)),
      baseAlpha: p.load(pointer + 28),
      baseShown: p.load(pointer + 36),
      clip: Array.from({ length: 4 }, (_, i) => p.load(pointer + 40 + i * 4) | 0),
      position: [108, 112].map((o) => bitsFloat(p.load(pointer + o))),
      base: [128, 132].map((o) => bitsFloat(p.load(pointer + o))),
      rotation: bitsFloat(p.load(pointer + 116)),
      scale: [120, 124].map((o) => bitsFloat(p.load(pointer + o))),
      mode: p.load(pointer + 104),
      aux: p.load(pointer + 192),
    });
    if (nested) {
      const child = await this.owner(nested),
        group = resources.get(child);
      source.bitmap = group.bitmap ? this.world.graphics.images.alias(group.bitmap) : 0;
      source.children = group.children.map((h) => resources.retain(h));
      await resources.release(child);
    }
    this.sources.set(pointer, {
      handle,
      frames: frames.map(({ key, wrapper }) => ({ key, wrapper })),
    });
    return handle;
  }
  async owner(pointer) {
    const cached = this.owners.get(pointer),
      resources = this.world.renderSources;
    if (cached && this.world.runtime.handles.records.has(cached)) return resources.retain(cached);
    const original = [...(this.engine.refs.imageOwners?.models ?? [])].find(
      ([handle, model]) =>
        model.pointer === pointer && this.world.runtime.handles.records.has(handle),
    );
    if (original) {
      const handle = this.world.retainedDraw.fromOwner(original[0]);
      this.owners.set(pointer, handle);
      return handle;
    }
    const p = this.process,
      vector = p.load(pointer + 16),
      children = [];
    if (vector)
      for (let at = p.load(vector); at < p.load(vector + 4); at += 20) {
        let child;
        if (p.load(at + 4)) child = resources.create({ bitmap: this.wrapper(p.load(at + 4)) });
        else if (p.load(at + 16)) child = await this.retained(p.load(at + 16));
        else child = resources.create();
        const source = resources.get(child),
          data = p.load(at + 8),
          size = p.load(at + 12);
        if (data && size && !source.animation)
          source.animation = new RetainedAnimation(p.read(data, size), this.world.random);
        source.hasProgram = Boolean(data && size);
        source.baseShown = 1;
        children.push(child);
      }
    const handle = resources.create({ bitmap: this.wrapper(p.load(pointer + 12)), children });
    this.owners.set(pointer, handle);
    return handle;
  }
  async importSource(words) {
    if (words[0]) return this.world.renderSources.create({ bitmap: this.bitmap(words[0]) });
    if (words[1]) {
      const p = this.process;
      return this.world.renderSources.decode(p.read(p.load(words[1]), p.load(words[1] + 4)));
    }
    if (words[2]) return this.retained(words[2]);
    if (words[3]) return this.owner(words[3]);
    return 0;
  }
  publish() {
    const p = this.process,
      handles = this.world.runtime.handles;
    for (const [pointer, record] of this.sources) {
      if (!handles.records.has(record.handle) || !p.allocations.has(pointer)) continue;
      const source = this.world.renderSources.get(record.handle),
        animation = source.animation,
        raw = p.load(pointer + 72);
      p.store(pointer + 76, source.selected);
      p.store(pointer + 80, source.enabled);
      if (source.prefetchFrames) p.store(pointer + 208, Number(source.startPending));
      const selected = record.frames.find((frame) => frame.key === source.selected);
      if (selected && selected.wrapper !== p.load(pointer + 8)) {
        const previous = p.load(pointer + 8),
          offset = nativeABI(this.engine.profile).graphics.renderSources.bytes - 4;
        if (previous) {
          const refs = p.load(previous + offset);
          if (refs < 2)
            throw new Error('FES frame replacement lost its map-owned wrapper reference');
          p.store(previous + offset, refs - 1);
        }
        if (selected.wrapper)
          p.store(selected.wrapper + offset, p.load(selected.wrapper + offset) + 1);
        p.store(pointer + 8, selected.wrapper);
      }
      if (!animation || !raw) continue;
      [
        animation.startFrame,
        animation.duration,
        animation.pc,
        animation.baseFrame,
        animation.maxFrameKey,
      ].forEach((word, i) => p.store(raw + 12 + i * 4, word));
      animation.registers.forEach((word, i) => p.store(raw + 32 + i * 4, word));
      p.store(raw + 292, floatBits(animation.speed));
      Object.values(animation.output).forEach((word, i) => {
        p.store(raw + 296 + i * 4, word);
        p.store(pointer + 84 + i * 4, word);
      });
    }
    for (const [pointer, record] of this.bitmaps) {
      const state = handles.records.get(record.data)?.value;
      if (!state || record.revision === state.revision || !p.allocations.has(pointer)) continue;
      const memory = this.engine.features.get('bitmap-memory');
      memory.writePixels({ pointer }, state.rgba);
      for (const [key, offset] of Object.entries(fields))
        p.store(pointer + offset, state[key] ?? 0);
      record.revision = state.revision;
    }
  }
  beforeCall() {
    this.publish();
  }
  afterCall() {
    const p = this.process,
      handles = this.world.runtime.handles;
    for (const [pointer, record] of this.sources) {
      if (!handles.records.has(record.handle) || !p.allocations.has(pointer)) continue;
      const source = this.world.renderSources.get(record.handle);
      const alpha = p.load(pointer + 28),
        shown = p.load(pointer + 36),
        clip = Array.from({ length: 4 }, (_, i) => p.load(pointer + 40 + i * 4) | 0);
      if (
        alpha !== source.baseAlpha ||
        shown !== source.baseShown ||
        clip.some((word, i) => word !== source.clip?.[i])
      )
        source.dirty = true;
      source.baseAlpha = alpha;
      source.baseShown = shown;
      source.enabled = p.load(pointer + 80);
      const selected = p.load(pointer + 76),
        cache = Array.from({ length: 5 }, (_, i) => p.load(pointer + 84 + i * 4));
      if (selected !== source.selected || cache.some((word, i) => word !== source.outputCache?.[i]))
        source.dirty = true;
      source.selected = selected;
      source.outputCache = cache;
      source.clip = clip;
      const raw = p.load(pointer + 72);
      if (raw && source.animation) {
        const a = source.animation;
        [a.startFrame, a.duration, a.pc, a.baseFrame, a.maxFrameKey] = [12, 16, 20, 24, 28].map(
          (o) => p.load(raw + o),
        );
        a.pc |= 0;
        a.registers.set(Array.from({ length: 64 }, (_, i) => p.load(raw + 32 + i * 4)));
        a.speed = bitsFloat(p.load(raw + 292));
        ['frame', 'alpha', 'display', 'x', 'y'].forEach(
          (key, i) => (a.output[key] = p.load(raw + 296 + i * 4)),
        );
        a.output.x |= 0;
        a.output.y |= 0;
      }
    }
  }
  snapshot() {
    return structuredClone({
      nextIdentity: this.nextIdentity,
      identities: [...this.identities],
      sources: [...this.sources],
      owners: [...this.owners],
      bitmaps: [...this.bitmaps],
    });
  }
  restore(state) {
    this.nextIdentity = state.nextIdentity;
    this.identities = new Map(state.identities);
    this.sources = new Map(state.sources);
    this.owners = new Map(state.owners);
    this.bitmaps = new Map(state.bitmaps);
  }
  close() {
    this.detachFree();
  }
}
