// SPDX-License-Identifier: MPL-2.0
// Concrete FES, scene and sound objects share this driver. The adapter owns
// conversion to/from KX2; scripts always operate on the original 0x90 bytes.
import { MOTION_ABI, initialMotionObject, motionVector, setMotionVector } from './abi.mjs';

export class MotionTarget {
  constructor(library, { readState, writeState, speed = 1 }) {
    if (!library || typeof readState !== 'function' || typeof writeState !== 'function')
      throw new TypeError('MOT target requires a library and KX2 state adapter');
    this.library = library;
    this.readState = readState;
    this.writeState = writeState;
    this.manager = library.manager(readState(), speed);
    this.lastFrame = -1;
    this.lastHandle = 0;
  }
  state() {
    return this.readState();
  }
  async add(file, options = {}) {
    const script = await this.library.load(file);
    // Native object vtable[1] refreshes the base when there is no active motion.
    if (!this.manager.busy()) {
      this.manager.clear();
      this.manager.base.set(this.readState());
      this.lastFrame = -1;
      this.lastHandle = 0;
    }
    return this.manager.add(script, options);
  }
  update(frame) {
    if (!this.manager.busy()) return false;
    const afterHandle = this.lastFrame === frame ? this.lastHandle : 0;
    if (afterHandle && ![...this.manager.records.keys()].some((handle) => handle > afterHandle))
      return false;
    this.writeState(this.manager.update(frame, false, afterHandle));
    this.lastFrame = frame;
    this.lastHandle = this.manager.nextHandle - 1;
    // 748930 retires the entire driver only when its last active script exits.
    if (!this.manager.busy()) this.manager.clear();
    return true;
  }
  busy(group) {
    return this.manager.busy(group);
  }
  finish(group) {
    if (!this.manager.records.size) return;
    this.writeState(this.manager.finish(group));
  }
  stop(frame) {
    // 76BD50: mark all scripts skipped, update once, then remove all records.
    this.manager.skip();
    if (this.manager.records.size) this.writeState(this.manager.update(frame));
    this.manager.clear();
  }
  clear() {
    this.manager.clear();
  }
  snapshot() {
    return {
      manager: this.manager.snapshot(),
      lastFrame: this.lastFrame,
      lastHandle: this.lastHandle,
    };
  }
  async restore(state) {
    await this.manager.restore(state.manager);
    this.lastFrame = state.lastFrame;
    this.lastHandle = state.lastHandle;
    // The owner restores its current fields separately. Later object commands
    // can differ from the driver's cached output even while a motion is active.
    // Restoring the driver must not replay an earlier frame over those fields.
  }
}

// Object fields are retained for input/hit testing and Canvas rendering. The
// native matrix and vscale remain intact, including components Canvas cannot
// currently project. No width/height meaning is inferred for vscale.
export function objectMotionState(object, { scaleUnit = 1, visible = 'disp' } = {}) {
  const state = initialMotionObject(),
    view = new DataView(state.buffer);
  const fields = [
    [MOTION_ABI.vram, ['vramX', 'vramY', 'vramZ']],
    [MOTION_ABI.base, ['baseX', 'baseY', 'baseZ']],
    [MOTION_ABI.pos, ['x', 'y', 'z']],
    [MOTION_ABI.vscale, ['vscaleX', 'vscaleY', 'vscaleZ']],
  ];
  for (const [offset, keys] of fields)
    setMotionVector(
      state,
      offset,
      keys.map((key) => object[key] || 0),
    );
  setMotionVector(
    state,
    MOTION_ABI.scale,
    ['scaleX', 'scaleY', 'scaleZ'].map((key) => (object[key] ?? scaleUnit) / scaleUnit),
  );
  setMotionVector(
    state,
    MOTION_ABI.rotation,
    ['rotationX', 'rotationY', 'rotation'].map((key) => ((object[key] || 0) * Math.PI) / 180),
  );
  if (object.motionMatrix)
    object.motionMatrix.forEach((v, i) => view.setFloat32(MOTION_ABI.matrix + i * 4, v, true));
  view.setUint32(
    MOTION_ABI.color,
    (((object.alpha ?? 255) & 255) << 24) |
      ((object.color ?? object.motionColor ?? 0xffffff) & 0xffffff),
    true,
  );
  view.setInt32(MOTION_ABI.display, Number(object[visible] !== false), true);
  return state;
}

export function applyObjectMotionState(object, state, { scaleUnit = 1, visible = 'disp' } = {}) {
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
  for (const [offset, keys, factor] of [
    [MOTION_ABI.vram, ['vramX', 'vramY', 'vramZ'], 1],
    [MOTION_ABI.base, ['baseX', 'baseY', 'baseZ'], 1],
    [MOTION_ABI.pos, ['x', 'y', 'z'], 1],
    [MOTION_ABI.vscale, ['vscaleX', 'vscaleY', 'vscaleZ'], 1],
    [MOTION_ABI.scale, ['scaleX', 'scaleY', 'scaleZ'], scaleUnit],
    [MOTION_ABI.rotation, ['rotationX', 'rotationY', 'rotation'], 180 / Math.PI],
  ])
    motionVector(state, offset).forEach((value, i) => {
      object[keys[i]] = value * factor;
    });
  object.motionColor = view.getUint32(MOTION_ABI.color, true);
  object.alpha = object.motionColor >>> 24;
  object[visible] = view.getInt32(MOTION_ABI.display, true) !== 0;
  object.motionMatrix = Array.from({ length: 16 }, (_, i) =>
    view.getFloat32(MOTION_ABI.matrix + i * 4, true),
  );
}
