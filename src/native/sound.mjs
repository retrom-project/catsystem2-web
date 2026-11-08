// SPDX-License-Identifier: MPL-2.0
// Sound task 5EA210/5EB670/5EABC0. The 64 device banks are shared by all
// sound tasks; each task owns its own 140-byte control and auxiliary records.
import { bitsFloat, floatBits, nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import {
  nativeSoundPan,
  nativeSoundPanPosition,
  nativeSoundPositionPan,
  nativeSoundDecoderQuery,
} from './sound-values.mjs';
import { lowerSoundName } from './sound-config.mjs';
import { readLoopPoints } from './loop-points.mjs';

const f = Math.fround;
const cvtt = (n) =>
  Number.isFinite(n) && n >= -2147483648 && n < 2147483648 ? Math.trunc(n) | 0 : -2147483648;
const get32 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
const put32 = (bytes, offset, n) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, n >>> 0, true);
const basename = (name) => name.replaceAll('\\', '/').split('/').at(-1);
const stem = (name) => basename(name).replace(/\.[^.]*$/, '');
const replaceExtension = (name, extension) => name.replace(/(?:\.[^./\\]*)?$/, `.${extension}`);
const decoded = (bytes) => new TextDecoder('shift_jis').decode(bytes);

export class NativeSoundPacket {
  constructor(words = [], size = Math.max(64, words.length * 4)) {
    this.data = new Uint8Array(size);
    words.forEach((word, i) => this.store(i * 4, word));
  }
  load(address) {
    return get32(this.data, address);
  }
  store(address, word) {
    put32(this.data, address, word);
  }
  bytes(address, size) {
    if (address < 0 || address + size > this.data.length)
      throw new Error('Native sound packet bounds');
    return this.data.subarray(address, address + size);
  }
  string(address) {
    const bytes = this.data.subarray(address),
      end = bytes.indexOf(0);
    if (end < 0) throw new Error('Unterminated native sound packet string');
    return decoded(bytes.subarray(0, end));
  }
  writeString(text, address) {
    const bytes = encodeCP932(text);
    this.bytes(address, bytes.length + 1).set([...bytes, 0]);
  }
}

// Float members and integer members share one word layout in the original.
export const NATIVE_SOUND_CONTROL = Object.freeze({
  bytes: 140,
  volume: 0,
  pan: 4,
  currentVolume: 8,
  currentPan: 12,
  flags: 16,
  targetVolume: 20,
  targetPan: 24,
  volumeRemaining: 28,
  panRemaining: 32,
  lastFrame: 48,
  releasePending: 52,
  stopPending: 56,
  pausePending: 60,
  autoRelease: 64,
  endAfterPlayback: 68,
  tagMap: 72,
  hasPLV: 80,
  plvHeader: 84,
  plvCount: 88,
  plvStep: 92,
  plvData: 96,
  wallStart: 100,
  lastTimeFrame: 104,
  elapsedFrames: 108,
  lpb: 112,
  lpbSize: 116,
  lv: 120,
  lvSize: 124,
  crossfade: 128,
  crossfadeMilliseconds: 132,
  linkedBank: 136,
});
const C = NATIVE_SOUND_CONTROL;

class SoundControl {
  constructor(volume = 100, pan = 0) {
    this.data = new Uint8Array(C.bytes);
    this.float(C.volume, volume);
    this.float(C.pan, pan);
    this.float(C.currentVolume, volume);
    this.float(C.currentPan, pan);
    this.word(C.wallStart, -1);
    this.word(C.linkedBank, -1);
    this.tags = new Map();
    this.tagHandle = 0;
    this.plv = null;
    this.lpb = null;
    this.lv = null;
    this.loopStart = 0n;
    this.loopEnd = -1n;
  }
  word(at, value) {
    if (value !== undefined) put32(this.data, at, value);
    return get32(this.data, at);
  }
  float(at, value) {
    if (value !== undefined) this.word(at, floatBits(value));
    return bitsFloat(this.word(at));
  }
  resetAux() {
    this.plv = this.lpb = this.lv = null;
    for (const at of [
      C.hasPLV,
      C.plvHeader,
      C.plvCount,
      C.plvStep,
      C.plvData,
      C.lpb,
      C.lpbSize,
      C.lv,
      C.lvSize,
    ])
      this.word(at, 0);
    this.word(C.wallStart, -1);
  }
  snapshot() {
    return {
      data: this.data.slice(),
      tags: [...this.tags],
      tagHandle: this.tagHandle,
      plv: this.plv?.slice() ?? null,
      lpb: this.lpb?.slice() ?? null,
      lv: this.lv?.slice() ?? null,
      loopStart: this.loopStart,
      loopEnd: this.loopEnd,
    };
  }
  restore(state, handles) {
    if (state.data?.length !== C.bytes) throw new Error('Native sound control checkpoint size');
    this.data.set(state.data);
    this.tagHandle = state.tagHandle;
    this.tags = this.tagHandle ? handles.get(this.tagHandle, 'sound-tags') : new Map(state.tags);
    this.plv = state.plv?.slice() ?? null;
    this.lpb = state.lpb?.slice() ?? null;
    this.lv = state.lv?.slice() ?? null;
    this.loopStart = BigInt(state.loopStart);
    this.loopEnd = BigInt(state.loopEnd);
  }
}

const deviceBank = () => ({
  file: '',
  loaded: false,
  metadata: null,
  sourceMode: 'stream',
  volume: 100,
  pan: 0,
  volumeGroup: 0,
  groupFactor: 100,
  loopCount: 1,
  loopStart: 0n,
  loopEnd: -1n,
  completionCount: 0,
  property: 0,
  nativeSpatial: {
    enabled: false,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    maximumDistance: 100,
    minimumDistance: 100,
    dopplerFactor: 1,
  },
});

export class NativeSound {
  constructor(world) {
    this.world = world;
    this.audio = world.audio;
    this.tasks = new Map();
    this.legacy = (world.profile || world.configuration.profile) === 'sdk-4.01-engine-2.6.1.74';
    this.bankCount = this.legacy ? 32 : 64;
    this.device = Array.from({ length: this.bankCount }, deviceBank);
    this.master = 100;
    this.volumeGroups = new Map();
    this.world.runtime.handles.registerType('sound-sidecar', {
      snapshot: (bytes) => bytes.slice(),
      restore: (bytes) => bytes.slice(),
    });
    this.world.runtime.handles.registerType('sound-tags', {
      snapshot: (tags) => [...tags],
      restore: (entries) => new Map(entries),
    });
  }
  key(bank) {
    return `native:${bank}`;
  }
  get(id) {
    return this.tasks.get(id >>> 0) ?? null;
  }
  primary(taskID = this.world.root) {
    const rootID = this.world.engineMessages?.closestTop(taskID)?.id ?? this.world.root;
    const base = this.world.objects.objects.get(rootID)?.implementation;
    return base ? this.get(base.sound) : null;
  }
  create(record) {
    const task = new NativeSoundTask(this, record);
    this.tasks.set(record.id, task);
    return task;
  }
  channel(bank) {
    return this.audio?.channels.get(this.key(bank)) ?? null;
  }
  now() {
    return (
      Math.trunc(
        this.audio?.context
          ? this.audio.context.currentTime * 1000
          : (this.world.frame * 1000) / 60,
      ) >>> 0
    );
  }
  frame() {
    return this.world.frame >>> 0;
  }
  playing(bank) {
    return !!this.channel(bank)?.playing;
  }
  factor(bank) {
    const device = this.device[bank];
    return (
      Math.trunc(Math.imul(this.master, this.volumeGroups.get(device.volumeGroup) ?? 100) / 100) | 0
    );
  }
  refresh(bank) {
    const channel = this.channel(bank),
      device = this.device[bank];
    if (!channel) return;
    channel.volume = device.volume;
    channel.volumeFactor = this.factor(bank);
    channel.pan = device.pan;
    if (typeof this.audio.setNativeSpatial !== 'function')
      throw new Error('Native spatial audio output service is unavailable');
    this.audio.setNativeSpatial(this.key(bank), { ...device.nativeSpatial, pan: device.pan });
    this.audio.refresh();
  }
  setVolume(bank, volume) {
    this.device[bank].volume = volume | 0;
    this.refresh(bank);
  }
  setPan(bank, pan) {
    this.device[bank].pan = nativeSoundPan(pan);
    if (this.device[bank].nativeSpatial.enabled)
      this.device[bank].nativeSpatial.position = nativeSoundPanPosition(pan);
    this.refresh(bank);
  }
  release(bank) {
    this.audio?.stop(this.key(bank));
    const device = this.device[bank];
    device.loaded = false;
    device.file = '';
    device.metadata = null;
  }
  stop(bank) {
    const channel = this.channel(bank);
    if (channel) {
      this.audio.pause(this.key(bank));
      channel.offset = 0;
      channel.paused = false;
      channel.ended = true;
    }
    this.device[bank].completionCount = 0;
  }
  pause(bank) {
    this.audio?.pause(this.key(bank));
  }
  async readAux(file, extension, category = 'sound') {
    const game = this.world.game,
      name = stem(file);
    if (game.resolveCategory) {
      const path = game.resolveCategory(name, category);
      return path ? game.read(replaceExtension(path, extension)) : null;
    }
    return game.read(`${name}.${extension}`);
  }
  async load(bank, file, type, decoderOption = 0) {
    if (bank < 0 || bank >= this.bankCount) return false;
    if (!this.audio?.preload) throw new Error('Native sound preload service is unavailable');
    this.release(bank);
    const device = this.device[bank],
      loaded = await this.audio.preload(file);
    if (!loaded) return false;
    device.file = file;
    device.loaded = true;
    device.metadata = structuredClone(loaded.metadata);
    device.sourceMode = type === 2 ? 'static' : 'stream';
    device.decoderOption = decoderOption >>> 0;
    // The native silently converts a short stream to a single static buffer.
    // 5D11C0: 8 * (averageBytesPerSecond / 2) >= decoded PCM bytes.
    const m = device.metadata;
    if (
      m.sampleRate &&
      m.channels &&
      m.bitsPerSample &&
      m.pcmBytes !== null &&
      m.pcmBytes !== undefined
    ) {
      const halfSecond = Math.floor((m.sampleRate * m.channels * (m.bitsPerSample >>> 3)) / 2);
      if (8 * halfSecond >= m.pcmBytes) device.sourceMode = 'static';
    }
    device.nativeSpatial.enabled =
      !!this.world.configuration.soundOptions.use3d && m.channels === 1;
    return true;
  }
  async play(bank, count, control) {
    const device = this.device[bank];
    if (!device.loaded) return false;
    const previous = this.channel(bank);
    // 5D1510 resets a playing buffer through Stop, while a paused buffer's
    // hardware cursor is retained when DirectSound Play is issued again.
    const offset = previous?.paused ? previous.offset : 0;
    device.loopCount = count >>> 0;
    device.completionCount = 0;
    device.loopStart = count === 1 ? 0n : control.loopStart;
    device.loopEnd = count === 1 ? -1n : control.loopEnd;
    const channel = await this.audio.play({
      channel: this.key(bank),
      bank,
      file: device.file,
      offset,
      group: 'native',
      volume: device.volume,
      volumeFactor: this.factor(bank),
      pan: device.pan,
      loopCount: device.loopCount,
      loopStartFrame: device.loopStart,
      loopEndFrame: device.loopEnd,
      sourceMode: device.sourceMode,
      nativeLevelProperty: device.property,
      nativeSpatial: structuredClone(device.nativeSpatial),
    });
    return !!channel;
  }
  async replay(bank) {
    return this.audio?.replay(this.key(bank));
  }
  async setLoop(bank, count, control) {
    const device = this.device[bank];
    device.loopCount = count >>> 0;
    device.loopStart = count === 1 ? 0n : control.loopStart;
    device.loopEnd = count === 1 ? -1n : control.loopEnd;
    if (!device.loaded) return;
    if (typeof this.audio.setNativeLoop !== 'function')
      throw new Error('Native sound loop-update service is unavailable');
    this.audio.setNativeLoop(this.key(bank), {
      loopCount: device.loopCount,
      loopStartFrame: device.loopStart,
      loopEndFrame: device.loopEnd,
    });
  }
  async swap(a, b) {
    const first = this.channel(a),
      second = this.channel(b);
    if (first || second) {
      if (typeof this.audio.swapNativeBanks !== 'function')
        throw new Error('Native audio bank-swap service is unavailable');
      this.audio.swapNativeBanks(this.key(a), this.key(b));
    }
    [this.device[a], this.device[b]] = [this.device[b], this.device[a]];
  }
  snapshot() {
    return {
      master: this.master,
      volumeGroups: [...this.volumeGroups],
      device: structuredClone(this.device),
      channels: this.device.map((_device, bank) => {
        const channel = this.channel(bank);
        return channel ? this.audio.channelState(this.key(bank), channel) : null;
      }),
    };
  }
  async restore(state) {
    if (state.device?.length !== this.bankCount || state.channels?.length !== this.bankCount)
      throw new Error('Native sound device checkpoint size');
    this.master = state.master;
    this.volumeGroups = new Map(state.volumeGroups);
    this.device = structuredClone(state.device);
    for (let bank = 0; bank < this.bankCount; bank++) {
      this.audio?.stop(this.key(bank));
      const device = this.device[bank];
      if (device.loaded) {
        const loaded = await this.audio.preload(device.file);
        if (!loaded) throw new Error(`Native checkpoint audio is missing: ${device.file}`);
      }
      if (state.channels[bank])
        await this.audio.play({
          ...state.channels[bank],
          volumeFactor: this.factor(bank),
          loopCount: device.loopCount,
          loopStartFrame: device.loopStart,
          loopEndFrame: device.loopEnd,
          sourceMode: device.sourceMode,
          nativeSpatial: device.nativeSpatial,
        });
    }
  }
}

export class NativeSoundTask {
  constructor(sound, record) {
    this.sound = sound;
    this.world = sound.world;
    this.record = record;
    this.base = this.world.base(record);
    this.controls = sound.device.map((device) => new SoundControl(device.volume, device.pan));
    this.groups = new Map();
    this.loopPoints = new Map();
    this.frame = this.world.frame >>> 0;
    const tree = this.world.soundConfiguration;
    if (tree?.loaded) {
      tree.requireTree();
      for (const group of tree.groups.values())
        this.groups.set(group.id, { ...group, typeCode: group.id, volume: 100 });
    } else {
      for (const group of this.world.configuration.soundGroups)
        if (group.id !== -1 && !this.groups.has(group.id)) {
          const typeCode = ['bgm', 'se', 'voice', 'sysvoice'].indexOf(group.type.toLowerCase());
          this.groups.set(group.id, {
            ...group,
            typeCode: typeCode < 0 ? 4 : typeCode,
            volume: 100,
          });
        }
    }
  }
  valid(bank) {
    return bank >>> 0 < this.sound.bankCount;
  }
  loadLoopPointRecords(records) {
    for (const record of records) {
      if (record.end !== -1n && record.start >= record.end) continue;
      const key = lowerSoundName(record.file),
        previous = this.loopPoints.get(key);
      if (previous) previous.start = record.start;
      else this.loopPoints.set(key, { ...record });
    }
  }
  loadLoopPoints(bytes) {
    this.loadLoopPointRecords(readLoopPoints(bytes));
  }
  clearAux(bank) {
    const control = this.controls[bank],
      handles = this.world.runtime.handles;
    for (const offset of [C.lpb, C.lv]) {
      const handle = control.word(offset);
      if (handle) handles.release(handle, 'sound-sidecar');
    }
    control.resetAux();
  }
  select(bank, both = false) {
    if (!this.valid(bank)) return [];
    const linked = this.controls[bank].word(C.linkedBank) | 0;
    return both ? (linked === -1 ? [bank] : [bank, linked]) : [linked === -1 ? bank : linked];
  }
  memory(sender, context) {
    if (context.payload) return context.payload;
    const machine = this.world.objects.machine(context.nativeSenderWorldID ?? sender);
    if (!machine)
      throw new Error(`Sound task ${this.record.id} requires sender ${sender}'s memory`);
    return machine;
  }
  async auxiliaries(bank, filename) {
    const control = this.controls[bank];
    this.clearAux(bank);
    control.tags.clear();
    const tag = await this.sound.readAux(filename, 'tag', 'tag');
    if (tag && tag.length % 24 === 0)
      for (let at = 0; at < tag.length; at += 24) {
        const record = tag.subarray(at, at + 24),
          end = record.indexOf(0);
        if (end < 0 || end > 20) throw new Error('Native sound tag name runs past its record');
        const name = decoded(record.subarray(0, end));
        if (!control.tags.has(name)) control.tags.set(name, get32(record, 20));
      }
    const plv = await this.sound.readAux(filename, 'plv');
    if (plv && plv.length >= 16 && get32(plv, 0) === 0x4c5650) {
      const count = get32(plv, 8);
      if (16 + count * 2 > plv.length) throw new Error('Truncated native PLV values');
      control.word(C.hasPLV, 1);
      control.word(C.plvHeader, get32(plv, 4));
      control.word(C.plvCount, count);
      control.word(C.plvStep, get32(plv, 12));
      control.plv = plv.slice(16, 16 + count * 2);
    }
    control.lpb = (await this.sound.readAux(filename, 'lpb'))?.slice() ?? null;
    if (!control.lpb && !this.sound.legacy)
      control.lv = (await this.sound.readAux(filename, 'lv'))?.slice() ?? null;
    for (const [field, offset, lengthOffset] of [
      ['lpb', C.lpb, C.lpbSize],
      ['lv', C.lv, C.lvSize],
    ]) {
      const bytes = control[field];
      if (bytes) {
        control.word(offset, this.world.runtime.handles.add('sound-sidecar', bytes));
        control.word(lengthOffset, bytes.length);
      }
    }
  }
  async load(packet, type, allocated = false) {
    const bank = packet.load(0),
      crossfade = this.sound.legacy ? 0 : packet.load(280),
      target = bank + (crossfade ? 32 : 0);
    if (!this.valid(bank) || !this.valid(target)) return 0;
    const file = packet.string(12),
      loaded = await this.sound.load(target, file, type, packet.load(276));
    if (allocated && !loaded) return 0;
    const control = this.controls[target];
    control.word(C.flags, 0);
    control.word(C.autoRelease, Number(allocated));
    for (const at of [C.releasePending, C.stopPending, C.pausePending, C.endAfterPlayback])
      control.word(at, 0);
    control.word(C.crossfade, crossfade);
    control.word(C.crossfadeMilliseconds, packet.load(284));
    control.word(C.linkedBank, allocated && crossfade ? target : -1);
    if (crossfade && (!allocated || type !== 1)) this.controls[bank].word(C.linkedBank, target);
    control.loopStart = 0n;
    control.loopEnd = -1n;
    if (type === 1 && packet.load(272)) {
      const point = this.loopPoints.get(lowerSoundName(file));
      if (point) {
        control.loopStart = BigInt(point.start);
        control.loopEnd = BigInt(point.end);
      }
    }
    await this.auxiliaries(target, file);
    control.word(C.wallStart, -1);
    control.word(C.elapsedFrames, 0);
    return Number(loaded);
  }
  allocate(minimum, maximum) {
    const first = Math.max(0, Math.min(this.sound.bankCount, minimum | 0)),
      last = Math.max(0, Math.min(this.sound.bankCount, maximum | 0));
    const range = () => Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
    for (const bank of range())
      if (this.valid(bank) && !this.sound.device[bank].loaded) return bank;
    let bank = range().find(
      (index) => this.valid(index) && this.controls[index].word(C.releasePending),
    );
    bank ??= range().find(
      (index) => this.valid(index) && this.controls[index].word(C.endAfterPlayback),
    );
    bank ??= first;
    if (!this.valid(bank))
      throw new Error(`Native sound group writes outside bank table: ${first}..${last}`);
    this.sound.release(bank);
    const control = this.controls[bank];
    control.word(C.flags, 0);
    control.loopStart = 0n;
    for (const at of [C.releasePending, C.stopPending, C.pausePending, C.endAfterPlayback])
      control.word(at, 0);
    return bank;
  }
  clearControl(bank) {
    const control = this.controls[bank];
    for (const at of [
      C.flags,
      C.releasePending,
      C.stopPending,
      C.pausePending,
      C.endAfterPlayback,
      C.crossfade,
      C.crossfadeMilliseconds,
    ])
      control.word(at, 0);
    control.word(C.linkedBank, -1);
    this.clearAux(bank);
  }
  async finish(bank, release, clearCrossfade = true) {
    const control = this.controls[bank],
      linked = control.word(C.linkedBank) | 0;
    if (release) {
      this.sound.release(bank);
      control.loopStart = 0n;
    } else if (control.word(C.stopPending)) this.sound.stop(bank);
    else this.sound.pause(bank);
    this.clearControl(bank);
    this.sound.setVolume(bank, cvtt(control.float(C.volume)));
    if (linked !== -1) {
      await this.swap(bank, linked);
      if (clearCrossfade) {
        const replacement = this.controls[bank];
        replacement.word(C.crossfade, 0);
        replacement.word(C.crossfadeMilliseconds, 0);
        replacement.word(C.linkedBank, -1);
      }
    }
    return linked !== -1;
  }
  async swap(first, second) {
    if (!this.valid(first) || !this.valid(second))
      throw new Error('Native sound swap writes outside bank table');
    [this.controls[first], this.controls[second]] = [this.controls[second], this.controls[first]];
    await this.sound.swap(first, second);
  }
  async tick(frame) {
    this.frame = frame >>> 0;
    if (!this.sound.audio) return;
    let restarts = 0;
    for (let bank = 0; bank < this.sound.bankCount; bank++) {
      const control = this.controls[bank];
      const pending =
        control.word(C.releasePending) ||
        control.word(C.stopPending) ||
        control.word(C.pausePending);
      const fade = (current, target, remaining, flag, set, clearFlag = true) => {
        const left = f(control.float(remaining) - f((frame - control.word(C.lastFrame)) >>> 0));
        control.float(remaining, left);
        if (left > 0) {
          const next = f(
            control.float(current) + f(f(control.float(target) - control.float(current)) / left),
          );
          control.float(current, next);
          set(cvtt(next));
          control.word(C.lastFrame, frame);
        } else {
          control.float(current, control.float(target));
          set(cvtt(control.float(target)));
          if (clearFlag) control.word(C.flags, control.word(C.flags) & ~flag);
          if (clearFlag && flag === 1 && control.word(C.crossfade)) {
            if (bank < 32) throw new Error('Native sound crossfade targets before its bank table');
            const original = this.controls[bank - 32];
            original.word(C.releasePending, 1);
            original.float(C.volumeRemaining, 0);
          }
        }
      };
      if (!pending) {
        if (control.word(C.flags) & 1)
          fade(C.currentVolume, C.targetVolume, C.volumeRemaining, 1, (n) =>
            this.sound.setVolume(bank, n),
          );
        if (control.word(C.flags) & 2)
          fade(C.currentPan, C.targetPan, C.panRemaining, 2, (n) => this.sound.setPan(bank, n));
        if (!this.sound.legacy && control.word(C.lastTimeFrame) === 0xffffffff)
          control.word(C.lastTimeFrame, frame - 1);
        control.word(
          C.elapsedFrames,
          control.word(C.elapsedFrames) + ((frame - control.word(C.lastTimeFrame)) >>> 0),
        );
        control.word(C.lastTimeFrame, frame);
      } else if (control.float(C.volumeRemaining) > 0) {
        fade(
          C.currentVolume,
          C.targetVolume,
          C.volumeRemaining,
          1,
          (n) => this.sound.setVolume(bank, n),
          false,
        );
      } else if (await this.finish(bank, !!control.word(C.releasePending))) {
        if (++restarts > 1024) throw new Error('Native sound bank swaps did not settle');
        bank = -1;
        continue;
      }
      if (control.word(C.endAfterPlayback) && !this.sound.playing(bank)) {
        if (await this.finish(bank, true, false)) {
          if (++restarts > 1024) throw new Error('Native sound bank swaps did not settle');
          bank = -1;
        }
      }
    }
  }
  plvIndex(control) {
    const step = control.word(C.plvStep);
    if (!step) throw new Error('Native PLV clock divides by zero');
    return Math.floor(((this.sound.now() - control.word(C.wallStart)) >>> 0) / step);
  }
  async message(words, context = {}) {
    const [sender, rawID, w, l] = words,
      bank = w >>> 0;
    const id = this.sound.legacy && rawID >= 177 && rawID <= 218 ? rawID + 2 : rawID;
    if (this.sound.legacy && rawID >= 219) return this.base.message(words, context);
    if (!this.sound.audio) return 0;
    const memory = () => this.memory(sender, context);
    const selected = this.select(bank),
      both = this.select(bank, true);
    const readFloat = (address) => bitsFloat(memory().load(address));
    if (id === 19) return 1;
    if (id === 179 || id === 180) {
      if (!this.valid(bank)) return 0;
      return this.load(packetView(memory(), l), id === 179 ? 1 : 2);
    }
    if (id === 203) {
      if (!this.groups.has(bank))
        this.groups.set(bank, {
          id: bank,
          typeCode: memory().load(l),
          min: memory().load(l + 4) | 0,
          max: memory().load(l + 8) | 0,
          volume: memory().load(l + 12),
        });
      return 0;
    }
    if (id === 204) {
      this.groups.delete(bank);
      return 0;
    }
    if ([205, 206, 207, 208].includes(id)) {
      const packet = packetView(memory(), l);
      const group =
        id === 205 || id === 206
          ? this.groups.get(packet.load(4))
          : [...this.groups.values()]
              .sort((a, b) => a.id - b.id)
              .find((record) => record.typeCode === packet.load(8));
      if (!group) return 0xffffffff;
      const allocated = this.allocate(group.min, group.max);
      packet.store(0, allocated);
      return (await this.load(packet, id === 205 || id === 207 ? 1 : 2, true))
        ? allocated + (packet.load(280) ? 32 : 0)
        : 0xffffffff;
    }
    if (id === 194) {
      for (let i = 0; i < this.sound.bankCount; i++) {
        if (this.sound.playing(i)) this.sound.stop(i);
        this.sound.release(i);
        this.clearAux(i);
      }
      return 0;
    }
    if (id === 198) {
      const m = memory(),
        file = m.string(l),
        start = BigInt.asIntN(64, BigInt(m.load(l + 32)) | (BigInt(m.load(l + 36)) << 32n)),
        end = BigInt.asIntN(64, BigInt(m.load(l + 40)) | (BigInt(m.load(l + 44)) << 32n));
      if (end !== -1n && start >= end) return 0;
      this.loadLoopPointRecords([{ file, start, end }]);
      return 0;
    }
    if (id === 215) {
      const name = memory().string(l);
      return this.controls.findIndex((control) => control.tags.has(name)) >>> 0;
    }
    if (id === 209) {
      const name = memory().string(l);
      if (this.world.soundConfiguration?.loaded)
        return (
          [...this.world.soundConfiguration.groups.values()].find((group) => group.type === name)
            ?.id ?? 0
        );
      const code = ['bgm', 'se', 'voice', 'sysvoice'].indexOf(name.toLowerCase());
      return code < 0 ? 4 : code;
    }
    if (id === 214 && bank === 0xffffffff) {
      const name = memory().string(l);
      return this.controls.find((control) => control.tags.has(name))?.tags.get(name) ?? 0;
    }
    if (id === 223) {
      await this.swap(bank, l >>> 0);
      return 0;
    }
    if (!this.valid(bank)) {
      if (id === 197) memory().store(l, 0);
      return id === 219 ? 0xffffffff : 0;
    }
    const control = this.controls[selected[0]],
      device = this.sound.device[selected[0]];
    switch (id) {
      case 181:
      case 183:
      case 184: {
        for (const index of both) {
          const c = this.controls[index];
          if (c.word(C.autoRelease)) {
            if (id === 181 && (!this.sound.device[index].loaded || c.word(C.releasePending)))
              continue;
            c.word(C.releasePending, Number(id === 181));
            c.word(C.stopPending, Number(id === 184));
            c.word(C.pausePending, Number(id === 183));
            c.word(C.endAfterPlayback, 0);
            c.word(C.flags, 0);
            c.float(C.targetVolume, 0);
            c.float(C.currentVolume, f(this.sound.device[index].volume >>> 0));
            c.float(C.volumeRemaining, 10);
            c.word(C.lastFrame, this.frame);
          } else {
            if (id === 181) {
              this.sound.release(index);
              c.loopStart = 0n;
            } else if (id === 183) this.sound.pause(index);
            else this.sound.stop(index);
            c.word(C.flags, 0);
          }
          if (id === 181) {
            c.word(C.wallStart, -1);
            c.word(C.lastTimeFrame, 0);
            c.word(C.elapsedFrames, 0);
            this.clearAux(index);
          }
        }
        return 0;
      }
      case 182: {
        const index = selected[0],
          c = this.controls[index];
        if (c.word(C.crossfade)) {
          c.word(C.flags, c.word(C.flags) | 1);
          c.float(C.currentVolume, 0);
          c.float(C.targetVolume, c.float(C.volume));
          c.float(C.volumeRemaining, f(c.word(C.crossfadeMilliseconds)));
          c.word(C.lastFrame, this.frame);
          this.sound.setVolume(index, 0);
          const original = this.controls[bank];
          original.word(C.flags, original.word(C.flags) | 1);
          original.float(C.targetVolume, 0);
          original.float(C.currentVolume, original.float(C.volume));
          original.float(C.volumeRemaining, f(c.word(C.crossfadeMilliseconds)));
          original.word(C.lastFrame, this.frame);
        } else {
          c.word(C.flags, 0);
          this.sound.setVolume(index, cvtt(c.float(C.volume)));
        }
        await this.sound.play(index, l >>> 0, c);
        c.word(C.stopPending, 0);
        c.word(C.pausePending, 0);
        if (c.word(C.wallStart) === 0xffffffff) c.word(C.wallStart, this.sound.now());
        c.word(C.lastTimeFrame, this.sound.legacy ? this.frame : -1);
        return 0;
      }
      case 185:
        return Number(both.some((index) => this.sound.playing(index)));
      case 186:
        for (const index of selected) {
          this.sound.setVolume(index, l | 0);
          const c = this.controls[index];
          c.word(C.flags, c.word(C.flags) & ~1);
          c.float(C.volume, f(l | 0));
        }
        return 0;
      case 187:
        return device.volume >>> 0;
      case 188:
        control.word(C.flags, control.word(C.flags) | 1);
        control.float(C.targetVolume, f(l & 65535));
        control.float(C.currentVolume, f(device.volume >>> 0));
        control.float(C.volumeRemaining, f(l >>> 16));
        control.word(C.lastFrame, this.frame);
        return 0;
      case 189:
        this.sound.setPan(selected[0], l | 0);
        control.word(C.flags, control.word(C.flags) & ~2);
        return 0;
      case 190:
        return device.pan >>> 0;
      case 191:
        control.word(C.flags, control.word(C.flags) | 2);
        control.float(C.targetPan, f((l << 16) >> 16));
        control.float(C.currentPan, f(device.pan));
        control.float(C.panRemaining, f(l >>> 16));
        control.word(C.lastFrame, this.frame);
        return 0;
      case 192:
        device.nativeSpatial.maximumDistance = readFloat(l + 4);
        this.sound.refresh(selected[0]);
        return 0;
      case 193:
        device.nativeSpatial.position = [readFloat(l), readFloat(l + 4), readFloat(l + 8)];
        if (!device.nativeSpatial.enabled)
          device.pan = nativeSoundPositionPan(
            device.nativeSpatial.position[0],
            device.nativeSpatial.position[2],
          );
        this.sound.refresh(selected[0]);
        return 0;
      case 195:
        device.nativeSpatial.velocity = [readFloat(l), readFloat(l + 4), readFloat(l + 8)];
        this.sound.refresh(selected[0]);
        return 0;
      case 196:
        device.nativeSpatial.dopplerFactor = readFloat(l);
        this.sound.refresh(selected[0]);
        return 0;
      case 197:
        memory().store(l, control.word(C.flags) & 1);
        return 0;
      case 199:
        device.volumeGroup = l | 0;
        if (!this.sound.volumeGroups.has(l | 0)) this.sound.volumeGroups.set(l | 0, 100);
        this.sound.refresh(bank);
        return 0;
      case 200:
        return device.metadata ? nativeSoundDecoderQuery(device.metadata) : 0;
      case 201:
        return device.sourceMode === 'static'
          ? (this.sound.channel(selected[0])?.completionCount ?? device.completionCount) >>> 0
          : 0;
      case 202:
        return Number(BigInt.asUintN(32, device.loopStart));
      case 210:
        for (const index of both) {
          if (this.sound.playing(index)) this.controls[index].word(C.endAfterPlayback, 1);
          else {
            this.sound.release(index);
            this.clearControl(index);
            this.controls[index].loopStart = 0n;
          }
        }
        return 0;
      case 211:
        device.property = l >>> 0;
        if (this.sound.channel(selected[0])) {
          if (typeof this.sound.audio.setNativeLevelProperty !== 'function')
            throw new Error('Native decoded-audio level capture service is unavailable');
          this.sound.audio.setNativeLevelProperty(this.sound.key(selected[0]), device.property);
        }
        return 0;
      case 212:
        if (control.plv) {
          const at = this.plvIndex(control);
          return at < control.word(C.plvCount)
            ? new DataView(
                control.plv.buffer,
                control.plv.byteOffset,
                control.plv.byteLength,
              ).getUint16(at * 2, true)
            : 0;
        }
        if (typeof this.sound.audio.nativeLevel !== 'function')
          throw new Error('Native decoded-audio level service is unavailable');
        return this.sound.audio.nativeLevel(this.sound.key(selected[0]));
      case 213: {
        const m = memory(),
          dest = m.load(l),
          count = m.load(l + 4);
        if (control.plv) {
          if (!mapped(m, dest, 1)) return 80;
          const out = m.bytes(dest, count * 4);
          out.fill(0);
          let at = this.plvIndex(control),
            i = 0;
          const values = new DataView(
            control.plv.buffer,
            control.plv.byteOffset,
            control.plv.byteLength,
          );
          for (; i < count && at < control.word(C.plvCount); i++, at++)
            put32(out, i * 4, values.getUint16(at * 2, true));
          return i;
        }
        if (typeof this.sound.audio.nativeLevels !== 'function')
          throw new Error('Native decoded-audio level-array service is unavailable');
        if (!mapped(m, dest, 1)) return 80;
        const values = this.sound.audio.nativeLevels(
          this.sound.key(selected[0]),
          Math.min(80, count),
        );
        values.forEach((v, i) => m.store(dest + i * 4, v));
        return Math.min(80, count);
      }
      case 214:
        return control.tags.get(memory().string(l)) ?? 0;
      case 216:
        if (!control.tagHandle)
          control.tagHandle = this.world.runtime.handles.add('sound-tags', control.tags);
        return control.tagHandle;
      case 217:
        for (const index of both) {
          const c = this.controls[index];
          if (c.word(C.wallStart) === 0xffffffff) c.word(C.wallStart, this.sound.now());
        }
        return 0;
      case 218:
        await this.sound.setLoop(selected[0], l >>> 0, control);
        return 0;
      case 219:
        return control.word(C.releasePending) ||
          control.word(C.stopPending) ||
          control.word(C.pausePending)
          ? 0xffffffff
          : control.word(C.elapsedFrames);
      case 220:
        memory().store(l, control.word(C.lpb));
        memory().store(l + 4, control.word(C.lpbSize));
        return 0;
      case 221:
        memory().store(l, control.word(C.lv));
        memory().store(l + 4, control.word(C.lvSize));
        return 0;
      case 222:
        return Number(!!control.lpb || !!control.lv);
      default:
        return this.base.message(words, context);
    }
  }
  snapshot() {
    return {
      frame: this.frame,
      controls: this.controls.map((control) => control.snapshot()),
      groups: [...this.groups],
      loopPoints: [...this.loopPoints],
    };
  }
  restore(state) {
    if (state.controls?.length !== this.sound.bankCount)
      throw new Error('Native sound task checkpoint bank count');
    this.frame = state.frame;
    this.groups = new Map(structuredClone(state.groups));
    this.loopPoints = new Map(structuredClone(state.loopPoints));
    state.controls.forEach((c, i) => this.controls[i].restore(c, this.world.runtime.handles));
  }
  async close() {
    for (let i = 0; i < this.sound.bankCount; i++) {
      this.sound.release(i);
      this.clearAux(i);
      if (this.controls[i].tagHandle)
        this.world.runtime.handles.release(this.controls[i].tagHandle, 'sound-tags');
    }
    this.sound.tasks.delete(this.record.id);
  }
}

function mapped(memory, address, count) {
  try {
    if (memory.region) memory.region(address, count);
    else memory.bytes(address, count);
    return true;
  } catch {
    return false;
  }
}
function packetView(memory, base) {
  return {
    load: (at) => memory.load(base + at),
    store: (at, value) => memory.store(base + at, value),
    string: (at) => memory.string(base + at),
  };
}

export const NATIVE_SOUND_IDS = Object.freeze([
  0x9b, 0x9c, 0x9d, 0x9e, 0x9f, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0x11c, 0x15b,
  0x15c, 0x15d, 0x239, 0x24b, 0x24c, 0x25a, 0x25b, 0x25c, 0x387, 0x3a7, 0x3a8,
]);
const reply = (value) => nativeReply(1, value >>> 0),
  done = () => nativeReply(2);

export async function nativeSound(id, args, machine, task, world) {
  if (!NATIVE_SOUND_IDS.includes(id)) return undefined;
  const sound = world.sound,
    receiver = sound.primary(task.id);
  if (!receiver) throw new Error('Native base task does not expose its sound task');
  const argument = (index) => (index < args.length ? args[index] : machine.nativeArgument(index));
  const send = (message, w = 0, l = 0, payload = null) =>
    receiver.message(
      [
        world.nativeTaskID(task.id),
        sound.legacy && message >= 179 && message <= 220 ? message - 2 : message,
        w >>> 0,
        l >>> 0,
      ],
      { ...(payload ? { payload } : {}), nativeSenderWorldID: task.id },
    );
  const simple = {
    0x9c: 181,
    0x9d: 182,
    0x9e: 183,
    0x9f: 184,
    0xa0: 185,
    0xa1: 186,
    0xa2: 187,
    0xa4: 189,
    0xa5: 190,
    0x239: 200,
    0x24b: 201,
  };
  if (simple[id]) {
    const result = await send(
      simple[id],
      argument(0),
      [0x9d, 0xa1, 0xa4].includes(id) ? argument(1) : 0,
    );
    return [0xa0, 0xa2, 0xa5, 0x239, 0x24b].includes(id) ? reply(result) : done();
  }
  if ([0x9b, 0x3a7, 0x25c, 0x3a8].includes(id)) {
    const allocated = id === 0x25c || id === 0x3a8,
      selector = argument(0),
      type = argument(allocated ? 4 : 3);
    if (type !== 1 && type !== 2)
      throw new Error('Native sound load leaves its result uninitialized for this load type');
    const name = world.runtime.services.format(argument(2), machine),
      file = world.game.resolveCategory ? world.game.resolveCategory(name, 'sound') : name;
    if (!file) return reply(allocated ? 0xffffffff : 0);
    const packet = new NativeSoundPacket([], 288);
    packet.store(allocated ? 4 : 0, selector);
    packet.writeString(file, 12);
    packet.store(272, Number(!(selector & 0xffff0000)));
    if (id === 0x3a7 || id === 0x3a8)
      packet.store(276, Number((BigInt(argument(allocated ? 5 : 4) >>> 0) * 1000n) / 60n));
    return reply(
      await send(
        allocated
          ? argument(3)
            ? type === 1
              ? 205
              : 206
            : type === 1
              ? 207
              : 208
          : type === 1
            ? 179
            : 180,
        0,
        0,
        packet,
      ),
    );
  }
  if (id === 0xa3 || id === 0xa6) {
    await send(
      id === 0xa3 ? 188 : 191,
      argument(0),
      (argument(1) & 65535) | ((argument(2) & 65535) << 16),
    );
    return done();
  }
  if ([0xa7, 0xa8, 0x15b, 0x15c].includes(id)) {
    const count = id === 0xa7 ? 2 : id === 0x15c ? 1 : 3;
    const packet = new NativeSoundPacket(Array.from({ length: count }, (_, i) => argument(i + 1)));
    await send(
      id === 0xa7 ? 192 : id === 0xa8 ? 193 : id === 0x15b ? 195 : 196,
      argument(0),
      0,
      packet,
    );
    return done();
  }
  if (id === 0x15d) {
    const packet = new NativeSoundPacket();
    await send(197, argument(0), 0, packet);
    return reply(packet.load(0));
  }
  if (id === 0x24c) {
    await send(202, argument(0));
    throw new Error('Original native 0x24C pushes an uninitialized result word');
  }
  if (id === 0x25a) {
    await send(
      203,
      argument(0),
      0,
      new NativeSoundPacket(Array.from({ length: 4 }, (_, i) => argument(i + 1))),
    );
    return done();
  }
  if (id === 0x25b) {
    await send(204, argument(0));
    return done();
  }
  if (id === 0x387) {
    const packet = new NativeSoundPacket([], 1024);
    packet.writeString(world.runtime.services.format(argument(1), machine), 0);
    return reply(await send(214, argument(0), 0, packet));
  }
  if (id === 0x11c) {
    const name = world.runtime.services.format(argument(1), machine),
      file = world.game.resolveCategory ? world.game.resolveCategory(name, 'sound') : name;
    return reply(Number(!!file && !!(await world.game.read(file))));
  }
  throw new Error(`Missing native sound wrapper ${id.toString(16)}`);
}

export function installNativeSound(world) {
  const sound = new NativeSound(world);
  world.sound = sound;
  world.runtime.services.sound = sound;
  world.objects.register(13, (record) => sound.create(record));
  for (const id of NATIVE_SOUND_IDS)
    if (id < world.runtime.tables.get('main').length)
      world.runtime.register('main', id, (args, machine, task) =>
        nativeSound(id, args, machine, task, world),
      );
  return sound;
}
