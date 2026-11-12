// SPDX-License-Identifier: MPL-2.0
// DIFIMAGE owns a retained JS owner-source, independently of a script's owner
// handle and the Draw entry. It does not borrow an ordinary IMAGE wrapper.
import { FESImages, initializeFESImage } from './fes-image-driver.mjs';
import { markFESObjectDirty } from './fes-common-model.mjs';
import { floatBits } from '../kcs.mjs';
import { bitmapColor } from './bitmap-pixels.mjs';

const f = Math.fround;
function requireDif(object) {
  if (object.nativeType !== 25) throw new TypeError('DIFIMAGE operation requires raw type25');
  if (!object.difImage) throw new Error('DIFIMAGE pure state is not initialized');
  return object.difImage;
}
export function initializeFESDifTail(object) {
  if (object.nativeType !== 25) throw new TypeError('DIFIMAGE initializer requires raw type25');
  object.difImage = {
    filePending: false,
    animationEnabled: 0,
    animationPending: false,
    captureRequest: null,
    filterPending: false,
  };
  return object;
}
export function initializeFESDifImage(object) {
  initializeFESImage(object);
  return initializeFESDifTail(object);
}
export function setFESDifImageFile(object, name) {
  const state = requireDif(object);
  object.file = String(name);
  // The reviewed FILE setter stores this request. The frozen DIF driver has
  // no FILE reader/load branch; it is not an IMAGE resource-reload request.
  state.filePending = true;
}
export function setFESDifImageFilter(object, value) {
  requireDif(object).filterPending = true;
  object.filterMode = value | 0;
}
export function setFESDifImageAnimation(object, value) {
  const state = requireDif(object);
  state.animationEnabled = value | 0;
  state.animationPending = true;
}
export function requestFESDifCapture(object, minimum = 0, maximum = 45000) {
  requireDif(object).captureRequest = { minimum: minimum >>> 0, maximum: maximum >>> 0 };
}

export class FESDifImages extends FESImages {
  constructor(world, { snapshotMotion, ...services } = {}) {
    super(world, services);
    this.snapshotMotion = snapshotMotion;
  }
  supports(object) {
    return object.nativeType === 25 || super.supports(object);
  }
  async refex(instance, object, handle) {
    requireDif(object);
    if (handle && typeof this.snapshotMotion !== 'function')
      throw new Error('DIFIMAGE refex requires its actual FES MOT snapshot owner');
    const resource = await this.initialize(instance, object);
    let source = 0,
      state = null,
      layered = false;
    if (handle) {
      const owner = this.world.imageOwners.get(handle);
      state = owner.bitmap ? this.world.graphics.images.get(owner.bitmap).state : null;
      // fromOwner retains the real bitmap data and every layer/ANM frame.
      // A released external handle cannot invalidate those independent refs.
      source =
        resource.ownerInput === handle && resource.source
          ? resource.source
          : this.world.retainedDraw.fromOwner(handle);
      layered = owner.layers !== null;
    }
    await this.replace(object, 0, source);
    resource.ownerInput = handle >>> 0;
    resource.ownerLayered = layered;
    if (state) {
      object.baseX = f(state.baseX);
      object.baseY = f(state.baseY);
      object.imageOriginX = f(state.offsetX);
      object.imageOriginY = f(state.offsetY);
    } else if (handle) {
      const info = this.world.imageOwners.get(handle).info;
      object.baseX = f(info[6] ?? 0);
      object.baseY = f(info[7] ?? 0);
      object.imageOriginX = f(info[4] ?? 0);
      object.imageOriginY = f(info[5] ?? 0);
    }
    markFESObjectDirty(instance, object);
    if (handle) await this.snapshotMotion(instance, object);
  }
  async capture(instance, object, request) {
    const rendering = this.world.screenEffects?.rendering;
    if (!rendering) throw new Error('DIFIMAGE refcap requires the real screen capture renderer');
    try {
      if (!rendering.prepare(1)) return false;
      if (!(await rendering.capture(0, f(request.minimum >>> 0), f(request.maximum >>> 0))))
        return false;
      const stage = this.world.stageRenderer,
        surface = stage.surfaces.get(rendering.captures[0]),
        input = stage.surfacePixels(rendering.captures[0]),
        [left, top, right, bottom] = this.world.graphics.view.drawingRectangle,
        width = (right - left) | 0,
        height = (bottom - top) | 0;
      if (left < 0 || top < 0 || right > surface.width || bottom > surface.height)
        throw new RangeError('DIFIMAGE capture viewport is outside its actual screen surface');
      const images = this.world.graphics.images,
        handle = images.create(width, height, instance.runtimeID);
      let source = 0;
      try {
        const bitmap = images.get(handle),
          output = await bitmap.pixels();
        for (let y = 0; y < height; y++)
          output.set(
            input.subarray(
              ((surface.height - top - y - 1) * surface.width + left) * 4,
              ((surface.height - top - y - 1) * surface.width + right) * 4,
            ),
            y * width * 4,
          );
        await bitmap.changed();
        source = await this.world.retainedDraw.fromBitmap(handle);
        await this.replace(object, 0, source);
        const resource = this.resource(object);
        resource.ownerInput = 0;
        resource.ownerLayered = false;
        source = 0;
        // Assigning the new owner changes BASE. Unlike refex's handler it does
        // not overwrite imageOrigin or force a MOT starting snapshot.
        object.baseX = object.baseY = 0;
        markFESObjectDirty(instance, object);
        return true;
      } finally {
        if (source) await this.world.renderSources.release(source);
        await images.release(handle);
      }
    } finally {
      // The original DIF capture releases the shared prepared targets even
      // when it reused an already prepared slot. D6 owns that shared state.
      rendering.releaseCaptures();
    }
  }
  async filter(object) {
    const r = this.resource(object),
      mode = object.filterMode | 0;
    if (!r.source || ![1, 2, 3].includes(mode)) return;
    const sources = this.world.renderSources,
      images = this.world.graphics.images,
      root = sources.get(r.source);
    await this.world.retainedDraw.composite(root);
    const pending = r.ownerLayered ? root.children : [r.source];
    for (const id of pending) {
      const source = sources.get(id);
      for (const handle of [source.bitmap, ...source.frames.map((frame) => frame.bitmap)]) {
        if (!handle) continue;
        // The original collection visits each layer/frame in declaration
        // order, including repeated aliases of the same bitmap data.
        await bitmapColor(images.get(handle), 'filter', mode);
      }
      source.revision++;
    }
    if (r.ownerLayered && root.children.length) root.groupDirty = true;
    root.revision++;
  }
  async publishDif(instance, object, draw, sleeping) {
    const r = this.resource(object);
    if (!draw || object.renderID === -1) return;
    const key = (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0;
    if (
      r.binding &&
      (r.binding.surface !== draw.record.id ||
        r.binding.key !== key ||
        r.binding.input !== r.source)
    )
      await this.removeBinding(object);
    if (!r.source) {
      await draw.remove(key);
      r.binding = null;
      return;
    }
    const s = this.workspace(object),
      fields = s.fields,
      plane = this.plane(instance, object, draw);
    fields.fill(0);
    fields[2] = r.source;
    // The DIF virtual driver reads local authored XY directly. Its PARENT
    // chain and imageOrigin participate in queries, not this draw position.
    fields[4] = floatBits(f(f(plane.x) + f(object.x)));
    fields[5] = floatBits(f(f(plane.y) + f(object.y)));
    fields[6] = floatBits(object.baseX);
    fields[7] = floatBits(object.baseY);
    fields[8] = floatBits(object.rotation);
    fields[9] = floatBits(object.scaleX);
    fields[10] = floatBits(object.scaleY);
    fields[11] = object.alpha >>> 0;
    fields[12] = sleeping ? 0 : object.displayValue >>> 0;
    fields[13] = object.coordinateMode >>> 0;
    await this.world.retainedDraw.bind(draw, key, fields);
    const left = plane.found ? plane.x : 0,
      top = plane.found ? plane.y : 0;
    [left, top, (left + plane.width) | 0, (top + plane.height) | 0].forEach((value, index) =>
      s.clip.store(index * 4, value),
    );
    await this.world.graphics.send(
      draw.record.id,
      instance.runtimeID,
      289,
      object.renderID,
      0,
      s.clip,
    );
    r.binding = { surface: draw.record.id, key, kind: 2, input: r.source };
  }
  async update(instance, object, options = {}) {
    if (object.nativeType !== 25) return super.update(instance, object, options);
    const state = requireDif(object);
    if (object.deleted) return this.close(object);
    if (options.restoring && !object.imageResource) return;
    if (!object.imageResource) await this.initialize(instance, object);
    const r = this.resource(object);
    if (options.restoring) {
      if (r.source) this.world.renderSources.get(r.source);
      return;
    }
    if (state.captureRequest !== null) {
      const request = state.captureRequest;
      state.captureRequest = null;
      await this.capture(instance, object, request);
    }
    if (state.filterPending) {
      state.filterPending = false;
      await this.filter(object);
    }
    const draw = this.draw(instance),
      sleeping = !!instance.player.nativeInput?.state.sleeping,
      nextKey = draw
        ? (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0
        : null,
      moved = !!r.binding && (r.binding.surface !== draw?.record.id || r.binding.key !== nextKey);
    if (moved && !draw) await this.removeBinding(object);
    if (object.dirty || moved) {
      await this.applyGeometry(instance, object, false);
      await this.publishDif(instance, object, draw, sleeping);
      object.dirty = object.sizeDirty = false;
    } else if (r.sleeping !== sleeping && r.binding) {
      await this.world.graphics.send(
        r.binding.surface,
        instance.runtimeID,
        287,
        object.renderID,
        Number(object.disp && !sleeping),
      );
    }
    if (state.animationPending) {
      state.animationPending = false;
      if (draw) {
        const key = (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0;
        await this.world.retainedDraw.enable(draw, key, Number(state.animationEnabled !== 0));
      }
    }
    if (object.priorityChanged && draw)
      await this.world.graphics.send(
        draw.record.id,
        instance.runtimeID,
        299,
        object.renderID,
        object.pri,
      );
    object.priorityChanged = false;
    r.sleeping = sleeping;
  }
}
