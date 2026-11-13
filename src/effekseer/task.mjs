// SPDX-License-Identifier: MPL-2.0
// Real task-owned CPU state. Actual GPU submission is a separate required adapter.
import { nativeABI } from '../native/abi/index.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../native/engine-message.mjs';
import { EffekseerManagerLifecycle } from './manager-lifecycle.mjs';
import { createEffekseerInstanceOperations } from './instance-operations.mjs';
import { EffekseerRingCurrentState } from './ring-current-state.mjs';
import { EffekseerMeshBatch } from './mesh-batch.mjs';
import { rotationX43, multiply43, transformVector43 } from './math43.mjs';
import { identity44, perspectiveFovRH, lookAtRH } from './camera.mjs';

const f = Math.fround;
const bits = (word) => new Float32Array(new Uint32Array([word]).buffer)[0];
const finite = (values, size) =>
  values?.length === size &&
  Array.from(values).every((value) => typeof value === 'number' && Number.isFinite(f(value)));

export async function createEffekseerTask(world, record, options = {}) {
  if (!nativeABI(world.profile).capabilities.effekseerTask)
    throw new Error('The registered ABI has no Effekseer task capability');
  const task = new EffekseerTask(world, record);
  try {
    task.initialize(options);
    return task;
  } catch (error) {
    try {
      await task.close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Effekseer task creation failed');
    }
    throw error;
  }
}

class EffekseerTask {
  constructor(world, record) {
    this.world = world;
    this.record = record;
    this.loads = world.effekseer.loads;
    this.manager = new EffekseerManagerLifecycle({
      resources: this.loads,
      threads: world.effekseer.threads,
      instanceOperations: createEffekseerInstanceOperations(),
      capacity: 2000,
    });
    this.currentEffect = null;
    this.lastHandle = 0;
    this.position = new Float32Array(3);
    this.camera = identity44();
    this.projection = identity44();
    this.ring = new EffekseerRingCurrentState();
    this.meshBatch = new EffekseerMeshBatch({
      loads: this.loads,
      ring: this.ring,
      getCamera: () => this.camera,
      getProjection: () => this.projection,
    });
    this.pendingReset = false;
    this.pending = 0;
    this.closed = false;
    this.closing = false;
    this.loading = null;
    this.closePending = null;
  }
  initialize({ restoring = false }) {
    if (!restoring) this.position.set(this.setCamera());
    const [width, height] = this.world.graphics.virtualSize();
    this.plane = this.world.graphics.customGraph(this.record, {
      width,
      height,
      drawGPU: (gpu) => this.drawGPU(gpu),
      queryDraw: () => this.queryDraw(),
    });
    this.world.effekseer.registerTask(this);
  }
  assertOpen() {
    if (this.closed || this.closing) throw new Error('Effekseer task is closed');
    this.manager.assertOpen();
  }
  setCamera(matrix) {
    const rotation = rotationX43(bits(0x3f91361e));
    let transform = rotation;
    if (matrix) {
      if (!finite(matrix, 16))
        throw new TypeError('Effekseer matrix requires16 finite float32 words');
      const affine = Float32Array.from([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14], (i) => matrix[i]);
      transform = multiply43(rotation, affine);
    }
    const eye = transformVector43([0, 0, 10], transform);
    const [width, height] = this.world.graphics.virtualSize();
    const projection = perspectiveFovRH(bits(0x3fc8f5c3), f(f(width) / f(height)), 1, 50);
    const camera = lookAtRH(eye, [0, 0, 0], [0, 1, 0]);
    this.projection.set(projection);
    this.camera.set(camera);
    return eye;
  }
  memory(sender, context) {
    return this.world.engineMessages.memory(sender, context);
  }
  readFloats(sender, context, address, count) {
    const memory = this.memory(sender, context);
    const values = Float32Array.from({ length: count }, (_, i) =>
      bits(memory.load(address + i * 4)),
    );
    if (!finite(values, count)) throw new TypeError('Effekseer input contains nonfinite float32');
    return values;
  }
  async message(words, context = {}, output) {
    this.assertOpen();
    const [sender, id, w, l] = words;
    const unwritten = () => (output ? NATIVE_UNWRITTEN_WORD : 0);
    if (id === 569 || id === 570) {
      if (this.pending) throw new Error('Effekseer FILE operations must be serialized');
      const previous = this.currentEffect;
      this.currentEffect = null;
      if (previous !== null) this.loads.release(previous);
      if (id === 569) {
        const memory = this.memory(sender, context);
        if (typeof memory?.string !== 'function')
          throw new Error('Effekseer FILE requires sender string memory');
        const name = memory.string(l);
        this.pending++;
        try {
          this.loading = this.loads.load(name);
          const load = await this.loading;
          if (this.closing) {
            if (load !== null) this.loads.release(load.id);
          } else this.currentEffect = load?.id ?? null;
        } finally {
          this.pending--;
          this.loading = null;
        }
      }
      return unwritten();
    }
    if (id === 571) {
      if (this.pending) throw new Error('Effekseer Play requires a settled FILE');
      if (this.currentEffect !== null)
        this.lastHandle = this.world.effekseer.play(
          context.executorEntry,
          this.manager,
          this.currentEffect,
          this.position,
        );
      return unwritten();
    }
    if (id === 572 || id === 573) {
      if (id === 573 && output) output.value = 0;
      if (this.currentEffect !== null) await this.manager.stop(this.lastHandle);
      return unwritten();
    }
    if (id === 51) {
      this.position.set(this.readFloats(sender, context, l, 3));
      await this.plane.broadcast(52, w, l, context);
      return unwritten();
    }
    if (id === 57) {
      this.setCamera(this.readFloats(sender, context, l, 16));
      await this.plane.broadcast(58, w, l, context);
      return unwritten();
    }
    if (id === 55 || id === 66) {
      await this.plane.broadcast(id === 55 ? 56 : 67, w, l, context);
      return unwritten();
    }
    if ([19, 59, 63].includes(id)) return unwritten();
    return this.plane.message(words, context);
  }
  onLostDevice() {
    // This leaf owns CPU Ring state only; no physical handles exist to release.
    this.ring.assertOpen();
  }
  onResetDevice() {
    // Physical reconstruction belongs to the shared device/W5 adapter.
    this.ring.assertOpen();
  }
  beforeDrawChildren(_frame, context = {}) {
    this.assertOpen();
    if (this.pending) throw new Error('Effekseer Update requires a settled FILE');
    if (this.pendingReset) {
      this.onResetDevice();
      this.pendingReset = false;
      return;
    }
    const status = this.world.graphics.device.status;
    if (status === 'not-reset') {
      this.onLostDevice();
      this.pendingReset = true;
      return;
    }
    if (status === 'lost') return;
    this.world.graphics.device.requireReady();
    this.world.effekseer.update(context.executorEntry, this.manager, 1);
  }
  drawGPU() {
    this.assertOpen();
    if (this.currentEffect === null || this.pendingReset) return 0;
    throw new Error('Effekseer kind61 GPU adapter is unimplemented');
  }
  queryDraw() {
    this.assertOpen();
    return Number(this.currentEffect !== null && !this.pendingReset);
  }
  references() {
    this.assertOpen();
    this.manager.assertOpen();
    const refs = this.currentEffect === null ? [] : [this.currentEffect];
    for (const map of [this.manager.sets, ...this.manager.removing])
      for (const set of map.values()) refs.push(set.assetID);
    return refs;
  }
  snapshot() {
    this.assertOpen();
    if (this.pending) throw new Error('Effekseer checkpoint requires a settled FILE');
    return {
      currentEffect: this.currentEffect,
      lastHandle: this.lastHandle,
      position: this.position.slice(),
      camera: this.camera.slice(),
      projection: this.projection.slice(),
      pendingReset: this.pendingReset,
      manager: this.manager.snapshot(),
      ring: this.ring.snapshot(),
      meshBatch: this.meshBatch.snapshot(),
      plane: this.plane.snapshot(),
    };
  }
  restore(saved) {
    this.assertOpen();
    if (
      !saved ||
      (saved.currentEffect !== null &&
        (!Number.isSafeInteger(saved.currentEffect) || saved.currentEffect < 1)) ||
      !Number.isInteger(saved.lastHandle) ||
      saved.lastHandle < -1 ||
      saved.lastHandle > 0x7fffffff ||
      !finite(saved.position, 3) ||
      !finite(saved.camera, 16) ||
      !finite(saved.projection, 16) ||
      typeof saved.pendingReset !== 'boolean'
    )
      throw new Error('Invalid Effekseer task checkpoint');
    if (saved.currentEffect !== null) this.loads.get(saved.currentEffect);
    this.manager.restore(saved.manager);
    this.ring.restore(saved.ring);
    this.meshBatch.restore(saved.meshBatch);
    this.plane.restore(saved.plane);
    this.currentEffect = saved.currentEffect;
    this.lastHandle = saved.lastHandle;
    this.position.set(saved.position);
    this.camera.set(saved.camera);
    this.projection.set(saved.projection);
    this.pendingReset = saved.pendingReset;
  }
  close() {
    if (this.closed) return Promise.resolve();
    if (this.closePending) return this.closePending;
    this.closing = true;
    this.closePending = this.finishClose();
    return this.closePending;
  }
  async finishClose() {
    const errors = [];
    if (this.loading)
      try {
        await this.loading;
      } catch (error) {
        errors.push(error);
      }
    const current = this.currentEffect;
    this.currentEffect = null;
    for (const operation of [
      () => current !== null && this.loads.release(current),
      () => this.manager.close(),
      () => this.meshBatch.close(),
      () => this.ring.close(),
      () => this.plane?.close(),
    ]) {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    }
    this.world.effekseer.releaseTask(this);
    this.closed = true;
    if (errors.length) throw new AggregateError(errors, 'Effekseer task cleanup failed');
  }
}
