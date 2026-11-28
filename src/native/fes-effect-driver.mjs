// SPDX-License-Identifier: MPL-2.0
// The typed coordinator supplies collection/MOT/events; resources use World JS services.
import { FESEffectModel, fesEffectClock } from './fes-effect-model.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { copyFESBitmapRectangle } from './fes-bitmap.mjs';

const types = new Set([7, 8, 26, 27, 30, 31, 32]);
export class FESWorldEffects {
  constructor(world, instance, hooks = {}) {
    Object.assign(this, { world, instance, hooks });
    this.model = new FESEffectModel(this.services());
  }
  need(name) {
    const operation = this.hooks[name];
    if (typeof operation !== 'function')
      throw new Error(`FES World effect coordinator ${name} is missing`);
    return operation;
  }
  supports(object) {
    return types.has(object.nativeType);
  }
  object(identity) {
    for (const object of this.instance.objects) if (object.handle === identity) return object;
    throw new Error(`FES effect semantic object ${identity} is absent`);
  }
  initialize(object, options = {}) {
    if (!this.supports(object)) throw new TypeError('Expected a supported FES effect object');
    if (object.deleted) throw new Error('Cannot initialize a deleted FES effect object');
    return (
      this.model.entries.get(object.handle) ??
      this.model.declare({
        identity: object.handle,
        name: object.baseName,
        type: object.nativeType,
        parent: object.parentHandle ?? null,
        ...options,
      })
    );
  }
  state(object) {
    return this.model.entries.get(object.handle) ?? null;
  }
  drawing() {
    const taskID = this.instance.player.surface,
      draw = this.world.graphics.drawTasks.get(taskID);
    return draw?.state.renderer
      ? { taskId: taskID, bitmap: draw.state.renderer.bitmap, offset: draw.state.offset }
      : null;
  }
  clock() {
    const owner = this.world.objects.objects.get(this.instance.runtimeID);
    if (!owner) throw new Error('FES effect owner World task is absent');
    return fesEffectClock(owner);
  }
  async send(taskID, message, l = 0, payload = null) {
    if (!this.world.objects.objects.has(taskID))
      throw new Error(`FES effect World target ${taskID} is absent`);
    const context = payload ? { payload } : {},
      result = await this.world.sendEngine(taskID, this.instance.runtimeID, message, 0, l, context);
    if (!context.nativeRouted || context.nativeUnhandled)
      throw new Error(`FES effect World target ${taskID} did not handle ${message}`);
    return result;
  }
  async mask(name) {
    const cache = this.need('cacheFor')(this.instance);
    if (!cache?.load) throw new Error('FES effects require the owning task image cache');
    const expanded = this.instance.player.expand ? this.instance.player.expand(name) : name,
      handle = await cache.load(expanded, 0);
    if (!handle) return 0;
    try {
      const bitmap = this.world.graphics.images.get(handle);
      if (bitmap.state.bpp === 3) {
        const pixels = await bitmap.pixels();
        for (let at = 3; at < pixels.length; at += 4) pixels[at] = 255;
        bitmap.state.bpp = 4;
        await bitmap.changed();
      }
      return handle;
    } catch (error) {
      await this.world.graphics.images.release(handle);
      throw error;
    }
  }
  services() {
    const self = this,
      { world, instance } = this;
    return {
      packet: (words) => new NativeGraphicsPacket(words),
      objectExists: (name) =>
        instance.objects.some((o) => !o.deleted && o.baseName === name && (o.index ?? 0) === 0),
      async createObject(spec) {
        const object = await self.need('createObject')(spec);
        if (
          !object ||
          object.deleted ||
          !self.supports(object) ||
          object.nativeType !== spec.type ||
          !instance.objects.includes(object)
        )
          throw new Error('FES effect creation did not return its live collection object');
        return object.handle;
      },
      addDummyMotion: (effect, spec) =>
        self.need('addDummyMotion')(self.object(effect.identity), spec),
      queueWipeRecord: (effect, words) =>
        self.need('queueWipeRecord')(self.object(effect.identity), words),
      clearMotion: (effect) => self.need('clearMotion')(self.object(effect.identity)),
      busy: (effect) => self.need('motionBusy')(self.object(effect.identity)),
      deleteObject: (identity) => self.need('deleteObject')(self.object(identity)),
      plane(identity) {
        const object = instance.objects.find((candidate) => candidate.handle === identity);
        if (!object) return null;
        return {
          nativeType: object.nativeType,
          deleted: object.deleted,
          vram: [object.vramX, object.vramY],
          size: [object.width, object.height],
          beforeCount: object.beforeCount,
          currentCount: object.currentCount,
        };
      },
      drawing: () => self.drawing(),
      loadMask: (name) => self.mask(name),
      snapshotBitmap: (handle, rectangle) =>
        copyFESBitmapRectangle(world.graphics.images, handle, rectangle, instance.runtimeID),
      releaseBitmap: (handle) => world.graphics.images.release(handle),
      requireBitmap: (handle) => world.graphics.images.get(handle),
      createTask: (kind, name) =>
        world.objects.create({
          kind,
          name,
          parent: instance.runtimeID,
          creator: instance.runtimeID,
        }),
      rebindTask(id, kind) {
        const task = world.objects.objects.get(id);
        if (!task || task.kind !== kind || task.parent !== instance.runtimeID)
          throw new Error(
            `FES effect checkpoint child ${id} is absent or has a different owner/kind`,
          );
      },
      send: (id, message, l, payload) => self.send(id, message, l, payload),
      hasView: () => world.graphics.view.active,
      prepareCaptures: (count) => world.screenEffects.rendering.prepare(count),
      capture: (slot, minimum, maximum) =>
        world.screenEffects.rendering.capture(slot, minimum, maximum),
      notify: (name) => self.need('notify')(name),
      maskOutputs: (sleeping) => self.need('maskOutputs')(sleeping),
      flushDraw: () => {
        const draw = self.drawing();
        if (!draw) throw new Error('FES effect wake requires its live Draw surface');
        return self.send(draw.taskId, 292);
      },
    };
  }
  screenCommand(verb, args, expressions) {
    return this.model.screenCommand(verb, args, expressions);
  }
  areaCommand(verb, target, args, { referenceIndex, ...expressions } = {}) {
    if (
      !Number.isInteger(referenceIndex) ||
      referenceIndex < -0x80000000 ||
      referenceIndex > 0x7fffffff
    )
      throw new RangeError('FES area command requires its parsed int32 reference index');
    const semantic = target
      ? { ...target, identity: target.handle, index: referenceIndex }
      : target;
    return this.model.areaCommand(verb, semantic, args, expressions);
  }
  async update(object, { restoring = false } = {}) {
    if (restoring) {
      const state = this.state(object);
      if (!state) return;
      if (state.taskId) this.model.need('rebindTask')(state.taskId, state.taskKind);
      return;
    }
    if (object.deleted && !this.state(object)) return;
    const effect = this.state(object) ?? this.initialize(object);
    if (object.deleted) this.model.markDeleted(effect);
    if (effect.phase === 'unallocated') await this.model.allocate(effect);
    await this.model.visit(effect, this.clock());
  }
  close(object) {
    const effect = this.state(object);
    if (effect) this.model.markDeleted(effect);
  }
  async collectDeleted() {
    for (const effect of this.model.entries.values())
      if (effect.deleted) await this.model.cleanup(effect);
  }
  snapshot() {
    return this.model.snapshot();
  }
  restore(state) {
    this.model.restore(state);
  }
}
