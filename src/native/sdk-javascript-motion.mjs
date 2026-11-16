// SPDX-License-Identifier: MPL-2.0
import { MOTION_ABI, motionVector } from '../motion/abi.mjs';
import { readNativeResource } from './resource-file.mjs';

const files = ['mot.int/motMove.kcs', 'mot.int/pPos.kcs', 'mot.int/pDisp.kcs'];
const sources = new Map(files.map((file) => [file.toLowerCase().replace(/\.kcs$/, ''), file]));

// Object-local MOT managers share the existing registry/VM/cache. Subclasses
// project their own KX2 fields; neither Graph nor a separate busy flag runs MOT.
export class SDKJavaScriptMotions {
  constructor(world, owner) {
    this.world = world;
    this.owner = owner;
    this.closed = false;
  }
  motionRecord(object) {
    const record = this.world.runtime.handles.get(object.motion, 'motion-manager');
    if (record.owner !== this.motionOwner(object))
      throw new Error('JavaScript object motion owner mismatch');
    return record;
  }
  manager(object) {
    const record = this.motionRecord(object);
    if (!record.manager || record.pending)
      throw new Error('JavaScript object motion manager is not settled');
    return record.manager;
  }
  busy(object) {
    return object.motion === undefined ? false : this.manager(object).busy();
  }
  async update(object, frame) {
    this.checkOpen();
    if (!this.busy(object)) return;
    const manager = this.manager(object);
    await this.publish(object, manager.update(frame >>> 0));
    if (!manager.busy()) manager.clear();
  }
  async addMotion(object, file, registers, base) {
    this.checkOpen();
    const registry = this.world.runtime.services.motion,
      owner = this.motionOwner(object);
    if (object.motion !== undefined && !this.busy(object)) this.manager(object).base.set(base);
    const script = await registry.library.optional(file, {
      read: (name) => readNativeResource(this.world, name, 3),
    });
    this.checkOpen();
    if (
      this.motionOwner(object) !== owner ||
      !this.records().some(([, record]) => record.value === object)
    )
      throw new Error('JavaScript motion owner changed during I/O');
    if (script === null) return undefined;
    if (object.motion === undefined) {
      object.motion = registry.create(owner);
      this.manager(object).base.set(base);
    }
    this.manager(object).add(script, { registers });
    return undefined;
  }
  async completePose(object, operation, args) {
    // Both native setters update first, then sample omitted components. The
    // new pPos/pDisp record stays active until the next object update.
    await this.update(
      object,
      ((this.owner.effectiveFrame ?? 0) - (this.owner.pausedFrames ?? 0)) >>> 0,
    );
    const base = this.modelState(object);
    let registers, file;
    if (operation === 'setPos') {
      registers = motionVector(base, MOTION_ABI.pos);
      args.forEach((value, i) => {
        registers[i] = Math.fround(value);
      });
      file = files[1];
    } else if (operation === 'setDisp') {
      registers = [
        args.length
          ? Number(args[0])
          : new DataView(base.buffer, base.byteOffset, base.byteLength).getInt32(
              MOTION_ABI.display,
              true,
            ),
      ];
      file = files[2];
    } else throw new Error('Invalid JavaScript object pose continuation');
    return this.addMotion(object, file, registers, base);
  }
  async restoreMotions() {
    this.checkOpen();
    const seen = new Set(),
      registry = this.world.runtime.services.motion;
    for (const [, record] of this.records()) {
      const object = record.value;
      if (object.motion === undefined) continue;
      if (!Number.isSafeInteger(object.motion) || object.motion <= 0 || seen.has(object.motion))
        throw new Error('Invalid JavaScript object motion reference');
      seen.add(object.motion);
      const resource = this.motionRecord(object),
        state = resource.manager ? resource.manager.snapshot() : resource.state;
      if (!state || !Array.isArray(state.records))
        throw new Error('Invalid JavaScript object motion checkpoint');
      for (const key of new Set(state.records.map((entry) => entry.script))) {
        const file = sources.get(key);
        if (!file) throw new Error('Invalid JavaScript object motion script checkpoint');
        const script = await registry.library.optional(file, {
          read: (name) => readNativeResource(this.world, name, 3),
        });
        if (script === null) throw new Error('JavaScript object motion source is absent');
        this.checkOpen();
      }
      await registry.get(object.motion);
      this.checkOpen();
    }
  }
  releaseMotion(object) {
    if (object.motion === undefined) return;
    this.motionRecord(object).manager?.clear();
    this.world.runtime.services.motion.release(object.motion);
  }
}
