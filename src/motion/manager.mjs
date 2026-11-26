// SPDX-License-Identifier: MPL-2.0
import { MotionInstance } from './instance.mjs';
import { MOTION_ABI, initialMotionObject } from './abi.mjs';
import { ParticleRandom } from '../ppi/random.mjs';
import { nativeABI } from '../native/abi/index.mjs';
import { roundX87Single } from '../ppi/x87.mjs';
import { bitsFloat, floatBits } from '../kcs/vm.mjs';

const f = Math.fround;
export class MotionManager {
  get speed() {
    return bitsFloat(this.speedWord);
  }
  set speed(value) {
    this.speedWord = floatBits(value);
  }
  constructor({
    profile,
    base = initialMotionObject(),
    speed = 1,
    random = new ParticleRandom(),
    calculations,
    loadScript = null,
    onDebug = null,
  } = {}) {
    if (!(base instanceof Uint8Array) || base.length !== MOTION_ABI.objectSize)
      throw new TypeError('A MOT manager requires a 0x90-byte base KX2 object');
    this.profile = profile;
    this.elapsedUsesX87 = profile && nativeABI(profile).motion?.elapsedUsesX87;
    this.recordStartsUninitialized =
      profile && nativeABI(profile).motion?.recordStartsUninitialized;
    this.base = base.slice();
    this.working = base.slice();
    this.baseKnown = null;
    this.workingKnown =
      profile && nativeABI(profile).motion?.workingStartsUninitialized
        ? new Uint8Array(MOTION_ABI.objectSize)
        : null;
    this.speed = f(speed);
    this.random = random;
    this.calculations = calculations;
    this.loadScript = loadScript;
    this.onDebug = onDebug;
    this.records = new Map();
    this.nextHandle = 1;
    this.flags = 0;
    this.lastProcessed = false;
  }
  setBank(working, bytes, known = null) {
    if (bytes.length !== MOTION_ABI.objectSize || (known && known.length !== bytes.length))
      throw new Error('Invalid MOT manager bank size');
    (working ? this.working : this.base).set(bytes);
    this[working ? 'workingKnown' : 'baseKnown'] = known?.includes(0) ? known.slice() : null;
  }
  copyBank(working, sourceWorking) {
    this.setBank(
      working,
      sourceWorking ? this.working : this.base,
      sourceWorking ? this.workingKnown : this.baseKnown,
    );
  }
  readBank(working, offset = 0, length = MOTION_ABI.objectSize) {
    const known = working ? this.workingKnown : this.baseKnown;
    if (known?.subarray(offset, offset + length).includes(0))
      throw new Error(`Native MOT reads uninitialized ${working ? 'working' : 'base'} bytes`);
    return (working ? this.working : this.base).subarray(offset, offset + length);
  }
  add(script, { group = 0, startTick = 0, ...options } = {}) {
    const handle = this.nextHandle++;
    const instance = new MotionInstance(script, {
      flags: this.flags,
      ...options,
      profile: this.profile,
      random: this.random,
      calculations: this.calculations,
      onDebug: this.onDebug,
    });
    if (this.recordStartsUninitialized)
      instance.machine.setKnowledge(instance.shared, 0, 148, new Uint8Array(148));
    this.records.set(handle, { handle, group, startTick: startTick >>> 0, instance });
    return handle;
  }
  update(frame, deferStart = false, afterHandle = 0) {
    if (!Number.isInteger(frame) || frame < 0 || frame > 0xffffffff)
      throw new RangeError('MOT manager frame must be uint32');
    if (!afterHandle) this.copyBank(true, false);
    this.lastProcessed = false;
    for (const record of [...this.records.values()].sort((a, b) => a.handle - b.handle)) {
      if (record.handle <= afterHandle) continue;
      if (!record.startTick && frame !== 0xffffffff) {
        if (deferStart) continue;
        record.startTick = frame;
      }
      record.instance.setObject(this.working, this.workingKnown);
      const delta = (frame - record.startTick) | 0;
      const time = this.elapsedUsesX87
        ? roundX87Single(
            roundX87Single((delta < 0 ? f(delta + 2 ** 32) : delta) * this.speed) + 0.5,
          )
        : f(f(f(delta >>> 0) * this.speed) + 0.5);
      const elapsed = Math.trunc(time) >>> 0;
      record.instance.update(elapsed);
      this.lastProcessed = true;
      this.setBank(true, record.instance.object, record.instance.objectKnowledge());
    }
    return this.working;
  }
  finish(group) {
    this.copyBank(true, false);
    for (const record of [...this.records.values()].sort((a, b) => a.handle - b.handle)) {
      record.instance.setObject(this.working, this.workingKnown);
      if (group === undefined || record.group === group) record.instance.finish();
      this.setBank(true, record.instance.object, record.instance.objectKnowledge());
    }
    return this.working;
  }
  skip(group) {
    for (const record of this.records.values())
      if (group === undefined || record.group === group) record.instance.setSkip();
  }
  busy(group) {
    for (const record of this.records.values())
      if ((group === undefined || record.group === group) && record.instance.active) return true;
    return false;
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
  snapshot({ copySources = true } = {}) {
    const sources = new Map(),
      sourceFor = (source) => {
        if (!source) return null;
        if (!copySources) return source;
        if (!sources.has(source)) sources.set(source, source.slice());
        return sources.get(source);
      };
    return {
      profile: this.profile,
      base: this.base.slice(),
      working: this.working.slice(),
      baseKnown: this.baseKnown?.slice() ?? null,
      workingKnown: this.workingKnown?.slice() ?? null,
      speedWord: this.speedWord,
      flags: this.flags,
      nextHandle: this.nextHandle,
      random: this.random.snapshot(),
      records: [...this.records.values()].map((record) => ({
        handle: record.handle,
        group: record.group,
        startTick: record.startTick,
        script: record.instance.script.name,
        source: sourceFor(record.instance.script.source),
        instance: record.instance.snapshot(),
      })),
    };
  }
  async restore(state) {
    if (
      state.profile !== this.profile ||
      state.base?.length !== MOTION_ABI.objectSize ||
      state.working?.length !== MOTION_ABI.objectSize ||
      !Number.isInteger(state.speedWord) ||
      state.speedWord < 0 ||
      state.speedWord > 0xffffffff ||
      typeof this.loadScript !== 'function'
    )
      throw new Error('MOT manager checkpoint/profile/loader mismatch');
    for (const key of ['baseKnown', 'workingKnown'])
      if (
        state[key] !== null &&
        (!(state[key] instanceof Uint8Array) ||
          state[key].length !== MOTION_ABI.objectSize ||
          state[key].some((value) => value !== 0 && value !== 1))
      )
        throw new Error('Invalid MOT manager bank knowledge');
    const records = new Map(),
      sources = new Map();
    for (const record of state.records) {
      if (record.source !== null && !(record.source instanceof Uint8Array))
        throw new Error('Invalid MOT record source');
      let scripts = sources.get(record.source);
      if (!scripts) sources.set(record.source, (scripts = new Map()));
      if (!scripts.has(record.script))
        scripts.set(record.script, this.loadScript(record.script, record.source));
      const script = await scripts.get(record.script);
      const instance = new MotionInstance(script, {
        profile: this.profile,
        random: this.random,
        calculations: this.calculations,
        onDebug: this.onDebug,
      });
      instance.restore(record.instance);
      records.set(record.handle, { ...record, instance });
    }
    this.setBank(false, state.base, state.baseKnown);
    this.setBank(true, state.working, state.workingKnown);
    this.speedWord = state.speedWord;
    this.flags = state.flags;
    this.nextHandle = state.nextHandle;
    this.random.restore(state.random);
    this.records = records;
  }
}
