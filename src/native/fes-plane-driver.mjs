// SPDX-License-Identifier: MPL-2.0
// FES plane state owns the transforms; real SimplePlane children own graphs.
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { fesCoordinateParent, fesPlanePosition } from './fes-image-model.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { floatBits } from '../kcs.mjs';

const scratch = new WeakMap(),
  f = Math.fround;
function workspace(object) {
  let state = scratch.get(object);
  if (!state) {
    state = {
      path: [],
      position: new Float32Array(3),
      base: new Float32Array(3),
      scale: new Float32Array(3),
      matrix: new Float32Array(16),
      product: new Float32Array(16),
      packet: new NativeGraphicsPacket(),
      metadata: new Uint8Array(36),
    };
    state.metadataView = new DataView(state.metadata.buffer);
    scratch.set(object, state);
  }
  return state;
}
function multiply(out, left, right) {
  for (let index = 0; index < 16; index++) {
    const row = index >> 2,
      column = index & 3;
    out[index] = f(
      left[row * 4] * right[column] +
        left[row * 4 + 1] * right[column + 4] +
        left[row * 4 + 2] * right[column + 8] +
        left[row * 4 + 3] * right[column + 12],
    );
  }
}

// Borrowed buffers. Position accepts parent3/4/21; base/scale/matrix accept
// only parent4, and each ancestor's operations precede its child's.
export function fesPlaneRenderingState(instance, object) {
  const state = workspace(object),
    { path, base, scale, matrix, product } = state;
  state.position.set(fesPlanePosition(instance, object));
  path.length = 0;
  for (let current = object; current; ) {
    path.push(current);
    const parent = fesCoordinateParent(instance, current);
    current = parent?.nativeType === 4 ? parent : null;
  }
  base.fill(0);
  scale.fill(1);
  matrix.fill(0);
  for (let index = 0; index < 4; index++) matrix[index * 5] = 1;
  for (let at = path.length - 1; at >= 0; at--) {
    const current = path[at];
    base[0] = f(f(current.baseX) + base[0]);
    base[1] = f(f(current.baseY) + base[1]);
    base[2] = f(f(current.baseZ) + base[2]);
    scale[0] = f(f(current.scaleX) * scale[0]);
    scale[1] = f(f(current.scaleY) * scale[1]);
    scale[2] = f(f(current.scaleZ) * scale[2]);
    if (current.motionMatrix?.length !== 16)
      throw new TypeError('FES plane requires its typed 16-component matrix');
    multiply(product, matrix, current.motionMatrix);
    matrix.set(product);
  }
  return state;
}

export class FESPlaneDriver {
  constructor(world, { cacheFor } = {}) {
    if (typeof cacheFor !== 'function')
      throw new TypeError('FES plane requires the owning task image cache');
    Object.assign(this, { world, cacheFor });
    this.activeTasks = new WeakMap();
  }
  supports(object) {
    return object.nativeType === 3 || object.nativeType === 4;
  }
  initialize(_instance, object) {
    if (!this.supports(object)) throw new TypeError('Expected CPLANE or PLANE');
    // Creation and header application do not create a SimplePlane graph.
    return object;
  }
  packet(object, values) {
    const packet = workspace(object).packet;
    packet.data.fill(0);
    for (let index = 0; index < values.length; index++) packet.store(index * 4, values[index]);
    return packet;
  }
  taskID(object) {
    return this.activeTasks.has(object) ? this.activeTasks.get(object) : object.nativeTaskID;
  }
  send(instance, object, message, w = 0, l = 0, payload = null, flags = 1) {
    const taskID = this.taskID(object);
    if (taskID == null) return;
    return this.world.graphics.send(taskID, instance.runtimeID, message, w, l, payload, flags);
  }
  async metadata(instance, object, reference) {
    if (!reference) throw new Error('FES plane metadata request has no resource reference');
    const state = workspace(object),
      pointer = await this.cacheFor(instance).data(reference.name);
    state.metadata.fill(0);
    if (pointer)
      nativeImageMetadata(
        this.world.runtime.imageDataBuffers.data(pointer),
        reference.index >>> 0,
        false,
        state.metadata,
      );
    return state.metadataView;
  }
  async size(instance, object) {
    if (!object.sizePending) return;
    const metadata = await this.metadata(instance, object, object.sizeReference);
    object.width = metadata.getInt32(8, true);
    object.height = metadata.getInt32(12, true);
    // The original SIZE2 source remains active for every later size rebuild.
  }
  async update(instance, object, options = {}) {
    const had = this.activeTasks.has(object),
      previous = this.activeTasks.get(object);
    this.activeTasks.set(
      object,
      Object.hasOwn(options, 'previousTaskID') ? options.previousTaskID : object.nativeTaskID,
    );
    try {
      return await this.drive(instance, object, options);
    } finally {
      if (had) this.activeTasks.set(object, previous);
      else this.activeTasks.delete(object);
    }
  }
  async drive(instance, object, { restoring = false } = {}) {
    if (object.deleted) return this.close(object);
    this.initialize(instance, object);
    if (restoring) return;
    const state = workspace(object),
      sleeping = !!instance.player.nativeInput?.state.sleeping;
    if (object.sizeDirty) {
      if (object.nativeType === 3) await this.size(instance, object);
      if (this.taskID(object) != null)
        await this.world.objects.destroy(this.taskID(object), instance.runtimeID);
      object.nativeTaskID = await this.world.objects.create({
        kind: 2,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: 'FE Plane',
      });
      this.activeTasks.set(object, object.nativeTaskID);
      await this.send(instance, object, 84, 0, object.planeType, null, 0);
      if (object.nativeType === 4) await this.size(instance, object);
      await this.send(
        instance,
        object,
        object.nativeType === 3 ? 42 : 41,
        0,
        0,
        this.packet(object, [
          0,
          0,
          0,
          floatBits(f(object.width)),
          floatBits(f(object.height)),
          object.nativeType === 3 ? 32 : 4,
          1,
          object.nativeType === 3 ? object.color : 0xffffffff,
        ]),
        0,
      );
      if (object.nativeType === 4) {
        const position = fesPlanePosition(instance, object);
        await this.send(
          instance,
          object,
          51,
          0,
          0,
          this.packet(object, [
            floatBits(position[0]),
            floatBits(position[1]),
            floatBits(position[2]),
          ]),
        );
      }
      object.sizeDirty = false;
    }
    if (object.dirty) {
      if (object.positionPending) {
        object.positionPending = false;
        const metadata = await this.metadata(instance, object, object.positionReference);
        object.x = f(metadata.getInt32(0, true));
        object.y = f(metadata.getInt32(4, true));
      }
      const transform = fesPlaneRenderingState(instance, object);
      await this.send(
        instance,
        object,
        51,
        0,
        0,
        this.packet(object, [
          floatBits(transform.position[0]),
          floatBits(transform.position[1]),
          floatBits(transform.position[2]),
        ]),
      );
      await this.send(
        instance,
        object,
        49,
        0,
        0,
        this.packet(object, [
          floatBits(transform.base[0]),
          floatBits(transform.base[1]),
          floatBits(f(object.pri)),
        ]),
      );
      if (object.nativeType === 4) {
        const offset = instance.player.nativeDraw?.offset ?? [0, 0];
        await this.send(
          instance,
          object,
          51,
          1,
          0,
          this.packet(object, [
            floatBits(f((truncateFloat32(object.vramX) + offset[0]) | 0)),
            floatBits(f((truncateFloat32(object.vramY) + offset[1]) | 0)),
            floatBits(f(object.vramZ)),
          ]),
        );
      }
      await this.send(
        instance,
        object,
        66,
        0,
        0,
        this.packet(object, [
          floatBits(transform.scale[0]),
          floatBits(transform.scale[1]),
          floatBits(transform.scale[2]),
        ]),
      );
      const packet = state.packet;
      for (let index = 0; index < 16; index++)
        packet.store(index * 4, floatBits(transform.matrix[index]));
      await this.send(instance, object, 57, 0, 0, packet);
      await this.send(instance, object, 59, 1, object.color);
      await this.send(instance, object, 47, 0, Number(object.disp && !sleeping));
      await this.send(instance, object, 81, 0, object.blendMode);
      object.dirty = false;
      // SimplePlane86 is a separately proven empty branch; consume only its
      // authored pending request without inventing a file-backed graph.
      if (object.resourcePending) {
        object.resourcePending = false;
        await this.send(instance, object, 86);
      }
    } else if (
      (object.planeSleepMask !== undefined || sleeping) &&
      object.planeSleepMask !== sleeping
    )
      await this.send(instance, object, 47, 0, Number(object.disp && !sleeping));
    object.planeSleepMask = sleeping;
  }
  async close(object) {
    if (object.nativeTaskID == null) return;
    if (this.world.objects.objects.has(object.nativeTaskID))
      await this.world.objects.destroy(object.nativeTaskID);
    object.nativeTaskID = null;
  }
}
