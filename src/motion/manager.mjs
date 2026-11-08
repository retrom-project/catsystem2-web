// SPDX-License-Identifier: MPL-2.0
import { MotionInstance } from './instance.mjs';
import { MOTION_ABI, initialMotionObject } from './abi.mjs';
import { ParticleRandom } from '../ppi/random.mjs';

const f = Math.fround;
export class MotionManager {
  constructor({
    profile,
    base = initialMotionObject(),
    speed = 1,
    random = new ParticleRandom(),
    loadScript = null,
    onDebug = null,
  } = {}) {
    if (!(base instanceof Uint8Array) || base.length !== MOTION_ABI.objectSize)
      throw new TypeError('A MOT manager requires a 0x90-byte base KX2 object');
    this.profile = profile;
    this.base = base.slice();
    this.working = base.slice();
    this.speed = f(speed);
    this.random = random;
    this.loadScript = loadScript;
    this.onDebug = onDebug;
    this.records = new Map();
    this.nextHandle = 1;
    this.flags = 0;
    this.lastProcessed = false;
  }
  add(script, { group = 0, startTick = 0, ...options } = {}) {
    const handle = this.nextHandle++;
    const instance = new MotionInstance(script, {
      flags: this.flags,
      ...options,
      profile: this.profile,
      random: this.random,
      onDebug: this.onDebug,
    });
    this.records.set(handle, { handle, group, startTick: startTick >>> 0, instance });
    return handle;
  }
  update(frame, deferStart = false, afterHandle = 0) {
    if (!Number.isInteger(frame) || frame < 0 || frame > 0xffffffff)
      throw new RangeError('MOT manager frame must be uint32');
    if (!afterHandle) this.working.set(this.base);
    this.lastProcessed = false;
    for (const record of [...this.records.values()].sort((a, b) => a.handle - b.handle)) {
      if (record.handle <= afterHandle) continue;
      if (!record.startTick && frame !== 0xffffffff) {
        if (deferStart) continue;
        record.startTick = frame;
      }
      record.instance.object.set(this.working);
      const elapsed =
        Math.trunc(f(f(f((frame - record.startTick) >>> 0) * this.speed) + 0.5)) >>> 0;
      record.instance.update(elapsed);
      this.lastProcessed = true;
      this.working.set(record.instance.object);
    }
    return this.working;
  }
  finish(group) {
    this.working.set(this.base);
    for (const record of [...this.records.values()].sort((a, b) => a.handle - b.handle)) {
      record.instance.object.set(this.working);
      if (group === undefined || record.group === group) record.instance.finish();
      this.working.set(record.instance.object);
    }
    return this.working;
  }
  skip(group) {
    for (const record of this.records.values())
      if (group === undefined || record.group === group) record.instance.setSkip();
  }
  busy(group) {
    return [...this.records.values()].some(
      (record) => (group === undefined || record.group === group) && record.instance.active,
    );
  }
  remove(handle) {
    return this.records.delete(handle);
  }
  removeGroup(group) {
    for (const [handle, record] of this.records)
      if (record.group === group) this.records.delete(handle);
  }
  clear() {
    this.records.clear();
  }
  snapshot() {
    return {
      profile: this.profile,
      base: this.base.slice(),
      working: this.working.slice(),
      speed: this.speed,
      flags: this.flags,
      nextHandle: this.nextHandle,
      random: this.random.snapshot(),
      records: [...this.records.values()].map((record) => ({
        handle: record.handle,
        group: record.group,
        startTick: record.startTick,
        script: record.instance.script.name,
        instance: record.instance.snapshot(),
      })),
    };
  }
  async restore(state) {
    if (
      state.profile !== this.profile ||
      state.base?.length !== MOTION_ABI.objectSize ||
      state.working?.length !== MOTION_ABI.objectSize ||
      typeof this.loadScript !== 'function'
    )
      throw new Error('MOT manager checkpoint/profile/loader mismatch');
    const records = new Map();
    for (const record of state.records) {
      const script = await this.loadScript(record.script);
      const instance = new MotionInstance(script, {
        profile: this.profile,
        random: this.random,
        onDebug: this.onDebug,
      });
      instance.restore(record.instance);
      records.set(record.handle, { ...record, instance });
    }
    this.base.set(state.base);
    this.working.set(state.working);
    this.speed = f(state.speed);
    this.flags = state.flags;
    this.nextHandle = state.nextHandle;
    this.random.restore(state.random);
    this.records = records;
  }
}
