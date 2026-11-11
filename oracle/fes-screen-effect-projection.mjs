// SPDX-License-Identifier: MPL-2.0
// D7 owns the remaining view capture producer. Project its shared target
// descriptors and canonical D3D pixels at the existing FES transport boundary.
// Both reviewed ABIs have this same data layout. Removed with FES in phase7.
export class NativeFESScreenEffectProjection {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.bindings = [];
    this.importMask = async (pointer) =>
      (await world.getNativeFeature('fes-draw-projection')).bitmap(pointer);
    this.push = () => this.pushCaptures();
    this.release = () => this.releaseTargets();
    Object.assign(world.screenEffects, {
      importMask: this.importMask,
      projectCaptures: this.push,
      releaseProducerCaptures: this.release,
    });
    engine.registerFeature('fes-screen-effect-projection', this);
  }
  get rendering() {
    return this.world.screenEffects.rendering;
  }
  get device() {
    return this.engine.features.get('renderer').d3d;
  }
  get core() {
    return this.engine.features.get('graphics-platform').refs.renderer;
  }
  metadata() {
    return this.process.load(this.core + 1560);
  }
  targets() {
    const p = this.process,
      metadata = this.metadata();
    if (!metadata) return [];
    const count = p.load(metadata + 20),
      records = p.load(metadata + 12);
    if (count > this.world.configuration.fields.general.renderTargetCount)
      throw new Error('FES shared-target projection exceeds its configured limit');
    return Array.from({ length: count }, (_, i) => {
      const pointer = p.load(records + i * 24 + 20),
        texture = this.device.textureData(pointer);
      if (!texture) throw new Error('FES shared-target descriptor has no texture');
      return texture;
    });
  }
  releaseTargets() {
    const p = this.process,
      metadata = this.metadata();
    if (!metadata) return;
    for (const texture of this.targets()) this.device.release(texture);
    const depth = p.load(metadata + 16),
      records = p.load(metadata + 12);
    if (depth) this.device.release(this.device.objects.get(depth));
    p.free(records);
    p.free(metadata);
    p.store(this.core + 1560, 0);
    this.bindings = [];
  }
  allocateTargets(width, height, count) {
    const p = this.process,
      device = this.device,
      resources = [],
      metadata = p.allocate(24, true),
      records = count ? p.allocate(count * 24, true) : 0,
      output = p.allocate(4, true),
      createTexture = device.contracts('Device9')[23][2];
    let complete = false;
    try {
      [width, height, 21, records, 0, count].forEach((word, i) => p.store(metadata + i * 4, word));
      for (let i = 0; i < count; i++) {
        if (createTexture(null, [width, height, 1, 1, 21, 0, output, 0]))
          throw new Error('FES target texture allocation failed');
        const pointer = p.load(output),
          texture = device.textureData(pointer);
        resources.push(texture);
        [width, height, 1, 21, 0, pointer].forEach((word, j) =>
          p.store(records + i * 24 + j * 4, word),
        );
        if (device.contracts('Texture9')[18][2](texture, [0, output]))
          throw new Error('FES target surface allocation failed');
        device.release(device.objects.get(p.load(output)));
      }
      if (count) {
        if (
          device.createSurface(
            { width, height, format: this.world.stageRenderer.depthFormat, usage: 2, pool: 0 },
            output,
          )
        )
          throw new Error('FES target depth allocation failed');
        const depth = device.objects.get(p.load(output));
        resources.push(depth);
        p.store(metadata + 16, depth.pointer);
      }
      p.store(this.core + 1560, metadata);
      complete = true;
    } finally {
      p.free(output);
      if (!complete) {
        for (const resource of resources.reverse()) device.release(resource);
        p.free(records);
        p.free(metadata);
      }
    }
  }
  pushCaptures() {
    const stage = this.world.stageRenderer,
      ids = this.rendering.captures;
    if (!this.rendering.prepared) {
      this.releaseTargets();
      return;
    }
    const [width, height] = this.rendering.size(),
      first = ids.length ? stage.surfaces.get(ids[0]) : { width, height };
    let targets = this.targets();
    if (
      !this.metadata() ||
      targets.length !== ids.length ||
      targets.some((t) => t.width !== first.width || t.height !== first.height)
    ) {
      this.releaseTargets();
      this.allocateTargets(first.width, first.height, ids.length);
      targets = this.targets();
    }
    for (const [i, texture] of targets.entries()) {
      const id = ids[i],
        binding = this.bindings[i],
        surface = stage.surfaces.get(id);
      if (
        binding?.id === id &&
        binding.jsRevision === (surface.revision ?? 0) &&
        binding.surfaceID === texture.surfaceID
      )
        continue;
      this.device.storePixels(texture, stage.surfacePixels(id));
      texture.dirty = false;
      if (this.device.gpu && texture.surface)
        this.device.command({
          type: 'upload',
          target: texture.surface,
          rectangle: [0, 0, texture.width, texture.height],
          frame: this.device.frame(texture.pointer),
        });
      this.bindings[i] = {
        id,
        jsRevision: surface.revision ?? 0,
        surfaceID: texture.surfaceID,
        revision: texture.revision,
      };
    }
  }
  importCaptures() {
    const targets = this.targets(),
      r = this.rendering,
      stage = this.world.stageRenderer;
    if (!targets.length) {
      r.releaseCaptures({ producer: false });
      r.prepared = Boolean(this.metadata());
      this.bindings = [];
      return;
    }
    const replace =
      targets.length !== r.captures.length ||
      targets.some((texture, i) => {
        const id = r.captures[i],
          surface = id && stage.surfaces.get(id);
        return !surface || surface.width !== texture.width || surface.height !== texture.height;
      });
    if (replace) {
      r.releaseCaptures({ producer: false });
      r.captures = targets.map((t) => stage.createSurface(t.width, t.height));
    }
    r.prepared = true;
    for (const [i, texture] of targets.entries()) {
      if (texture.dirty) {
        if (!texture.surface) throw new Error('FES dirty target is missing its surface projection');
        if (!this.device.gpu) {
          if (r.currentFrame().items.length)
            throw new Error('A nonempty FES capture requires its GPU renderer');
          // The existing headless harness has an empty graph. Its capture
          // helper clears this target to transparent zero before traversal.
          this.device.storePixels(texture, new Uint8Array(texture.width * texture.height * 4));
          texture.dirty = false;
        } else this.device.syncSurface(texture.surface, this.device.surfaceData(texture.surface));
      }
      const binding = this.bindings[i],
        id = r.captures[i];
      if (
        !replace &&
        binding?.id === id &&
        binding.surfaceID === texture.surfaceID &&
        binding.revision === texture.revision
      )
        continue;
      stage.writeSurface(id, this.device.frame(texture.pointer).rgba);
      this.bindings[i] = {
        id,
        jsRevision: stage.surfaces.get(id).revision,
        surfaceID: texture.surfaceID,
        revision: texture.revision,
      };
    }
  }
  snapshot() {
    return { bindings: structuredClone(this.bindings) };
  }
  restore(state) {
    this.bindings = structuredClone(state.bindings);
  }
  close() {
    const effects = this.world.screenEffects;
    if (effects.importMask === this.importMask) effects.importMask = null;
    if (effects.projectCaptures === this.push) effects.projectCaptures = null;
    if (effects.releaseProducerCaptures === this.release) effects.releaseProducerCaptures = null;
  }
}
