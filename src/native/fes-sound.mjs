// SPDX-License-Identifier: MPL-2.0
// Sound object 74C550/74C700..74CDB0 and FES driver 662B50; SDK 532540.
// The adapter sends the native task protocol and shares its hardware banks.
import { mapABIMessage } from './abi/messages.mjs';
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeSoundPacket } from './sound.mjs';
import { nativeLegacySoundIndex, nativeLegacySoundGroup } from './sound-values.mjs';
import { lowerSoundName } from './sound-config.mjs';
import { MotionTarget } from '../motion/target.mjs';
import { motionDefinition, motionRegisters } from '../motion/definitions.mjs';
import { MOTION_ABI } from '../motion/abi.mjs';
import { FES_BUILTIN_VERBS } from '../fes/object.mjs';
import { NativeFESSoundTable } from './fes-sound-table.mjs';
import { buildNativeFESMotion } from './fes-motion.mjs';
import { nativeEngineWord } from './engine-message.mjs';

// These original type switches exclude 9/10. They precede user SUBCOMMANDs.
const soundNoopVerbs = new Set(
  'enable disp draw wipe getpos copy size color noact settbl loadlist loadlist2 dispid ptype setnum setsave pos pl getpos2 setact page getsize ref clip lock exist max keypos attach getflag userfont tone tonetbl gettonetbl coordmode setanm anm keyblock layout str reset locator pos2 baseopt init param start apend apendmark clear isdraw isdrawmark skip refex setlog blockinfo linecolor blockcolor lineinfo endpos attr refparentpl mag userfontobj insert name redraw refcap filter pri linecnt getbase getoffset drag bmode mode getfile m2eff m2att m2fspeed m2prmscale m2body m2iner m2enable_blink m2enable_lip m2splay m2draw m2enable_eff strid get pathinfo getsavestr blur make remake getsavedate'.split(
    ' ',
  ),
);
const indexedOnly = new Set('getid play next rev repeat shuffle loop pause'.split(' '));
const gameExtensions = new Set('remake getsavedate pause crossfade'.split(' '));

const O = Object.freeze({
  dirty: 16,
  active: 20,
  bank: 304,
  loopCount: 308,
  systemVoice: 312,
  volume: 316,
  pan: 320,
  pendingLoad: 324,
  motionDelay: 40,
  playing: 328,
  stopping: 332,
  paused: 336,
  pendingPlay: 340,
  loopDirty: 344,
  pausePending: 348,
  position: 352,
  bypassVolume: 388,
  playOption: 392,
  duration: 428,
  forcePlay: 432,
  startClock: 436,
  pendingTags: 440,
  crossfade: 444,
  crossfadeFrames: 448,
});
const cvtt = (n) =>
  Number.isFinite(n) && n >= -2147483648 && n < 2147483648 ? Math.trunc(n) | 0 : -2147483648;
const percent = (a, b) => Math.trunc(Math.imul(a, b) / 100) | 0;
const signed = new Set(['bank', 'volume', 'pan', 'startClock']);
const readWord = (bytes, at) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

export class NativeFESSoundState {
  constructor(object) {
    this.object = object;
    if (!object.nativeSoundState) {
      const data = new Uint8Array(452),
        view = new DataView(data.buffer);
      for (const [at, value] of [
        [O.active, 1],
        [O.bank, -1],
        [O.volume, 100],
        [O.startClock, -1],
      ])
        view.setUint32(at, value >>> 0, true);
      object.nativeSoundState = { data, tags: [], motion: null };
    }
    this.state = object.nativeSoundState;
    this.data = this.state.data;
    if (!(this.data instanceof Uint8Array) || this.data.length !== 452)
      throw new Error('Native FES sound checkpoint layout');
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  }
  get(name) {
    const at = O[name];
    if (at === undefined) throw new Error(`Unknown native FES sound field ${name}`);
    return signed.has(name) ? this.view.getInt32(at, true) : this.view.getUint32(at, true);
  }
  set(name, value, changed = false) {
    const previous = this.get(name);
    this.view.setUint32(O[name], value >>> 0, true);
    if (changed && previous !== this.get(name)) this.markChanged();
  }
  markChanged() {
    this.set('dirty', 1);
  }
  string(at) {
    let end = this.data.indexOf(0, at);
    if (end < 0) throw new Error('Native FES sound string lacks a terminator');
    return new TextDecoder('shift_jis').decode(this.data.subarray(at, end));
  }
  writeString(at, value) {
    const bytes = encodeCP932(value);
    if (at + bytes.length + 1 > this.data.length)
      throw new Error('Native FES sound string exceeds its mapped object');
    this.data.set(bytes, at);
    this.data[at + bytes.length] = 0;
  }
  get filename() {
    return this.string(44);
  }
  get group() {
    return this.string(396);
  }
  load(file, crossfade = 0, frames = 0) {
    this.writeString(44, file);
    this.set('crossfade', crossfade);
    this.set('crossfadeFrames', frames);
    this.set('pendingLoad', 1);
  }
  play(value) {
    this.set('playing', value);
    this.set('paused', 0);
    this.set('pendingPlay', 1);
    this.set('stopping', Number(!value));
    if (value) this.markChanged();
  }
  pause() {
    this.set('paused', 1);
    this.set('pausePending', 1);
  }
  loopCount() {
    this.set('loopDirty', 0);
    return this.get('loopCount');
  }
  setLoopCount(value) {
    if (this.get('loopCount') !== value >>> 0) {
      this.set('loopCount', value, true);
      this.set('loopDirty', 1);
    }
  }
  setBank(value) {
    this.set('bank', value, true);
  }
  setVolume(value) {
    this.set('volume', value, true);
  }
  setPan(value) {
    this.set('pan', value, true);
  }
  setGroup(value) {
    this.writeString(396, value);
  }
  setCrossfade(enable, frames) {
    this.set('crossfade', enable);
    this.set('crossfadeFrames', frames);
  }
  motionState() {
    const bytes = new Uint8Array(MOTION_ABI.objectSize),
      view = new DataView(bytes.buffer);
    view.setFloat32(MOTION_ABI.pos, Math.fround(this.get('pan')), true);
    bytes[MOTION_ABI.color + 3] = this.get('volume') & 255;
    return bytes;
  }
  applyMotion(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.setPan(cvtt(view.getFloat32(MOTION_ABI.pos, true)));
    this.setVolume(bytes[MOTION_ABI.color + 3]);
  }
}

function legacyCategory(configuration, filename) {
  const group = nativeLegacySoundGroup(configuration, filename);
  if (group === -1) return '';
  return configuration.soundGroups.find((entry) => entry.id === group)?.type ?? '';
}

export class NativeFESSound {
  constructor(world, { onStart, uninitializedStackWord } = {}) {
    this.world = world;
    this.onStart = onStart;
    this.uninitializedStackWord = uninitializedStackWord;
    this.targets = new WeakMap();
  }
  state(instance, object) {
    const fresh = !object.nativeSoundState,
      state = new NativeFESSoundState(object);
    if (fresh) {
      if (object.soundBypassVolume !== undefined)
        state.set('bypassVolume', object.soundBypassVolume);
      if (object.channel !== null && object.channel !== undefined) state.setBank(object.channel);
      if (object.soundType !== null && object.soundType !== undefined)
        state.set('systemVoice', object.soundType, true);
      if (object.group) state.setGroup(object.group);
      const file = object.file ?? object.sound;
      if (file) state.load(file);
      if (object.type === 'SNDTABLE') {
        state.set('playOption', 1);
        const table = new NativeFESSoundTable(state);
        if (object.soundCapacity !== undefined) table.resize(object.soundCapacity);
      }
    }
    return state;
  }
  initialize(instance, object, columns) {
    const state = this.state(instance, object);
    for (const column of columns) {
      switch (column) {
        case 'FILE':
          state.load(object.file ?? object.sound ?? '');
          break;
        case 'STYPE':
          state.set('systemVoice', object.soundType, true);
          break;
        case 'CHANNEL':
          state.setBank(object.channel);
          break;
        case 'BLEND':
          state.set('bypassVolume', object.soundBypassVolume);
          break;
        case 'GROUP':
          state.setGroup(object.group ?? '');
          break;
        case 'SIZE':
          if (object.type === 'SNDTABLE')
            new NativeFESSoundTable(state).resize(object.soundCapacity);
          break;
      }
    }
  }
  target(instance, object) {
    let target = this.targets.get(object);
    if (target) return target;
    const state = this.state(instance, object);
    if (!this.world.motionLibrary) throw new Error('FES sound motion library is unavailable');
    target = new MotionTarget(this.world.motionLibrary, {
      readState: () => state.motionState(),
      writeState: (bytes) => state.applyMotion(bytes),
    });
    if (state.state.motion)
      throw new Error('Restore the native FES sound motion asynchronously before executing it');
    this.targets.set(object, target);
    return target;
  }
  async restore(instance, object) {
    const state = this.state(instance, object);
    if (state.state.motion) {
      const saved = state.state.motion;
      state.state.motion = null;
      const target = this.target(instance, object);
      await target.restore(saved);
      state.state.motion = target.snapshot();
    }
  }
  async send(instance, id, w = 0, l = 0, payload) {
    const sender = instance.runtimeID ?? instance.player?.root?.runtimeID;
    if (!Number.isSafeInteger(sender)) throw new Error('FES sound has no native task owner');
    const target = nativeEngineWord(instance.player.nativeSoundTaskID, 'FES sound task binding'),
      value = await this.world.sendNativeEngine(
        target,
        sender,
        mapABIMessage(this.world.profile, 'fesSound', 'raw', id),
        w >>> 0,
        l >>> 0,
        payload ? { payload } : {},
      );
    return [185, 200, 205, 209, 216].includes(id)
      ? nativeEngineWord(value, `FES sound message ${id}`)
      : value;
  }
  playFlag(state, system = false) {
    const tree = this.world.soundConfiguration;
    if (tree.loaded)
      return tree.get(system ? 'sysplay' : 'play', { by: 'filename', query: state.filename });
    const row = nativeLegacySoundIndex(this.world.configuration, state.filename);
    return row < 0 ? 0 : readWord(this.world.configuration.blocks[0], 20 + row * 116);
  }
  oldVolume(category) {
    const voice = this.world.configuration.blocks[0];
    if (readWord(voice, 5608)) return 0;
    const index = { bgm: 0, se: 1, voice: 2, sysvoice: 2 }[lowerSoundName(category)];
    return index === undefined
      ? 100
      : readWord(voice, 5612 + index * 4)
        ? 0
        : readWord(voice, index * 4) | 0;
  }
  oldMute(category) {
    const voice = this.world.configuration.blocks[0],
      index = { bgm: 0, se: 1, voice: 2, sysvoice: 2 }[lowerSoundName(category)];
    return !!readWord(voice, 5608) || (index !== undefined && !!readWord(voice, 5612 + index * 4));
  }
  mixedVolume(state, onTemporary) {
    const tree = this.world.soundConfiguration;
    if (state.get('bypassVolume'))
      return tree.loaded
        ? percent(
            state.get('volume'),
            tree.get('mute', { by: 'master' }) ? 0 : tree.get('volume', { by: 'master' }),
          )
        : this.oldMute(state.group)
          ? 0
          : state.get('volume');
    if (!tree.loaded)
      return percent(
        state.get('volume'),
        this.oldVolume(state.group || legacyCategory(this.world.configuration, state.filename)),
      );
    let volume = tree.get('volume', { by: 'master' });
    if (tree.get('mute', { by: 'master' })) return 0;
    if (state.group)
      volume = percent(volume, tree.get('volume', { by: 'key', query: state.group }));
    volume = percent(volume, tree.get('volume', { by: 'filename', query: state.filename }));
    // 662FD1 aliases the later playback-eligibility local with this temporary.
    onTemporary?.(volume);
    if (tree.get('mute', { by: 'filename', query: state.filename })) volume = 0;
    return percent(state.get('volume'), volume);
  }
  async configurationChanged(instance, object) {
    const state = this.state(instance, object);
    // FES MSG19: 7487A0 marks the object dirty; it does not reset its MOT.
    state.set('dirty', 1);
    if (state.get('systemVoice')) return;
    const eligible = state.get('forcePlay') | this.playFlag(state);
    const busy = await this.send(instance, 185, state.get('bank'), 0);
    if (!busy || !eligible) state.set('pendingPlay', 1); // 74C740
  }
  async destructionRequested(instance, object) {
    const bank = this.state(instance, object).get('bank');
    if (bank !== -1) await this.send(instance, 210, bank, 0);
  }
  async update(instance, object, { configurationDirty = false } = {}) {
    const state = this.state(instance, object),
      target = this.targets.get(object);
    if (target) {
      target.update(this.world.frame);
      state.state.motion = target.snapshot();
    }
    let bank = state.get('bank'),
      loaded = false;
    const send = (id, w = bank, l = 0, payload) => this.send(instance, id, w, l, payload);
    if (state.get('pendingLoad')) {
      if (state.filename) {
        const resolved = this.world.game.resolveCategory
          ? this.world.game.resolveCategory(state.filename, 'sound')
          : state.filename;
        if (!resolved) throw new Error(`FES sound category resource is missing: ${state.filename}`);
        if (bank !== -1 && !state.get('crossfade')) await send(181);
        const packet = new NativeSoundPacket([], 288);
        packet.store(0, bank);
        packet.writeString(resolved, 12);
        packet.store(272, 1);
        packet.store(280, state.get('crossfade'));
        packet.store(284, state.get('crossfadeFrames'));
        if (state.group) {
          const text = new NativeSoundPacket();
          text.writeString(state.group, 0);
          packet.store(4, await send(209, 0, 0, text));
          bank = (await send(205, 0, 0, packet)) | 0;
          state.setBank(bank);
        } else await send(179, 0, 0, packet);
        state.set('duration', await send(200));
      } else await send(181);
      state.set('pendingLoad', 0);
      loaded = true;
    }
    if (state.get('pendingTags')) {
      if (bank !== -1) {
        const handle = await send(216);
        if (handle) state.state.tags = [...this.world.runtime.handles.get(handle, 'sound-tags')];
      }
      state.set('pendingTags', 0);
    }
    let eligible;
    if (state.get('pendingPlay')) {
      const loopCount = state.loopCount(),
        ordinary = loopCount ? 1 : state.get('forcePlay') | this.playFlag(state);
      if (!state.get('playing') || !ordinary) {
        if (await send(185)) await send(184);
      }
      eligible = state.get('forcePlay') | this.playFlag(state, !!state.get('systemVoice'));
    }
    if (loaded || configurationDirty || state.get('dirty')) {
      if (state.filename) {
        await send(
          186,
          bank,
          this.mixedVolume(state, (temporary) => {
            eligible = temporary;
          }),
        );
        await send(189, bank, state.get('pan'));
      }
      state.set('dirty', 0);
    }
    if (state.get('pausePending')) {
      state.set('pausePending', 0);
      if (state.get('playing') && state.get('active')) {
        if (eligible === undefined) {
          if (typeof this.uninitializedStackWord !== 'function')
            throw new Error('Native FES pause reads an uninitialized stack eligibility word');
          eligible = this.uninitializedStackWord(instance, object);
        }
        if (eligible) await send(183);
      }
    }
    if (state.get('pendingPlay')) {
      if (state.get('playing') && eligible) {
        if (state.get('active')) await send(182, bank, state.loopCount());
        else await send(217);
        if (state.get('startClock') === -1) state.set('startClock', this.world.sound.now());
        this.onStart?.(instance, object, this.world.frame);
      } else if (state.get('playing')) {
        await send(184);
        await send(217);
        if (state.get('startClock') === -1) state.set('startClock', this.world.sound.now());
      } else if (state.get('stopping')) await send(184);
      state.set('pendingPlay', 0);
    }
    if (state.get('playing')) {
      if (bank === -1) state.play(0);
      else if (state.get('loopDirty')) await send(218, bank, state.loopCount());
    }
    return state;
  }
  async close(instance, object) {
    const state = this.state(instance, object);
    this.targets.get(object)?.clear();
    if (state.get('playOption') && state.get('bank') !== -1)
      await this.send(instance, 181, state.get('bank'));
  }
  async busy(instance, object) {
    const state = this.state(instance, object);
    return state.get('playing')
      ? Boolean(await this.send(instance, 185, state.get('bank')))
      : false;
  }
  command(instance, object, verb, args, context = {}) {
    const state = this.state(instance, object),
      value = (i, fallback = 0) =>
        args[i] === undefined ? fallback : instance.value(args[i], fallback),
      text = (i) => instance.text(args[i] ?? '');
    const isTable = object.type === 'SNDTABLE';
    if (!nativeABI(this.world.profile).sound.fesExtensions && gameExtensions.has(verb))
      return this.subcommand(instance, object, verb, args);
    if (context.index === -1 && indexedOnly.has(verb)) return;
    if (context.index === -1 && (verb === 'exist' || verb === 'max'))
      throw new RangeError(`Native FES ${verb} dereferences an invalid whole-group object`);
    if (soundNoopVerbs.has(verb)) return;
    switch (verb) {
      case 'load':
        if (object.type === 'SOUND')
          state.load(
            text(0),
            nativeABI(this.world.profile).sound.fesLoadParameters ? value(1, 0) : 0,
            nativeABI(this.world.profile).sound.fesLoadParameters ? value(2, 60) : 0,
          );
        return;
      case 'play':
        state.play(1);
        if (args[0] !== undefined) state.setLoopCount(value(0));
        state.set('playOption', value(1, 1));
        state.set('forcePlay', value(2, 0));
        return;
      case 'stop':
        this.targets.get(object)?.stop(0);
        state.play(0);
        return;
      case 'pause':
        state.pause();
        return;
      case 'loop':
        if (args[0] !== undefined) state.setLoopCount(value(0));
        return;
      case 'crossfade':
        state.setCrossfade(value(0), value(1));
        return;
      case 'channel':
        state.setBank(value(0));
        return;
      case 'stype':
        state.set('systemVoice', value(0), true);
        return;
      case 'blend':
        state.setVolume(value(0, 255));
        return this.addBuiltinMotion(instance, object, verb, args, context);
      case 'arc':
      case 'mcarc':
      case 'pend':
      case 'mcpend':
        return this.addBuiltinMotion(instance, object, verb, args, context);
      case 'setid':
        if (isTable) new NativeFESSoundTable(state).selectPosition(value(0));
        return;
      case 'getid':
        if (isTable) instance.setGlobal(value(0), new NativeFESSoundTable(state).getID());
        else {
          if (!Number.isInteger(context.objectNameAddress))
            throw new Error('Native FES SOUND getid returns its object-name address');
          instance.setGlobal(value(0), context.objectNameAddress >>> 0);
        }
        return;
      case 'sndtbl':
        if (isTable)
          new NativeFESSoundTable(state).setRecord(value(0), text(1), Number(value(2) !== 0));
        return;
      case 'next':
        if (isTable) new NativeFESSoundTable(state).next();
        return;
      case 'rev':
        if (isTable) new NativeFESSoundTable(state).reverse();
        return;
      case 'repeat':
        if (isTable) new NativeFESSoundTable(state).state.repeat = value(0) >>> 0;
        return;
      case 'shuffle':
        if (isTable) {
          const table = new NativeFESSoundTable(state);
          if (value(0)) table.shuffle(this.world.random, value(1));
          else table.resetOrder();
        }
        return;
      case 'sndtag': {
        const action = text(0);
        if (action === 'init') state.set('pendingTags', 1);
        if ((action !== 'wait' && action !== 'remain') || context.index === -1) return 0;
        if (args[1] === undefined || (action === 'remain' && args[2] === undefined)) return 0;
        const tag = state.state.tags.find(([name]) => name === text(1))?.[1] ?? 0,
          elapsed = (this.world.sound.now() - state.get('startClock')) >>> 0,
          frames = elapsed >= tag ? 0 : Math.floor((Math.imul(tag - elapsed, 60) >>> 0) / 1000);
        if (action === 'remain') {
          instance.setGlobal(value(2), frames);
          return 0;
        }
        return frames;
      }
      case 'enable':
        // 76AEA0 only accepts types 6/13/14/15; sound types 9/10 are ignored.
        return;
      case 'delay':
        state.set('motionDelay', value(0));
        return;
      case 'time': {
        const ms = state.get('duration'),
          minutes = Math.floor(ms / 60000),
          seconds = Math.floor((ms - minutes * 60000) / 1000),
          milliseconds = (ms - minutes * 60000 - seconds * 1000) >>> 0;
        for (const [i, n] of [minutes, seconds, milliseconds].entries())
          if (args[i] !== undefined && value(i) !== -1) instance.setGlobal(value(i), n);
        return;
      }
      case 'ismot':
        if (args[0] !== undefined) {
          const selected = context.index === -1 ? instance.elements(object.baseName) : [object];
          instance.setGlobal(
            value(0),
            Number(selected.some((entry) => this.targets.get(entry)?.busy())),
          );
        }
        return;
      case 'getdiv':
        // 777950/6119C0 write the FES numeric local bank through
        // 757BB0/5F5D40. Only NVSTRING objects supply a nonzero division.
        instance.setLocal(0, 0);
        return;
      case 'delete':
        object.deleted = true;
        return this.close(instance, object);
      default: {
        if (FES_BUILTIN_VERBS.has(verb))
          throw new Error(`Unrecovered native FES ${object.type} builtin ${verb}`);
        return this.subcommand(instance, object, verb, args);
      }
    }
  }
  addBuiltinMotion(instance, object, verb, args, context) {
    const state = this.state(instance, object),
      target = this.target(instance, object),
      spec = buildNativeFESMotion(
        verb,
        args,
        target.state(),
        (expression, current) => instance.value(expression, current),
        {
          sound: true,
          commandPointer: context.commandPointer,
          delay: state.get('motionDelay'),
        },
      );
    return target.add(spec.file, spec).then(() => {
      state.state.motion = target.snapshot();
    });
  }
  subcommand(instance, object, verb, args) {
    const raw = instance.program.subcommands[verb];
    if (!raw) throw new Error(`Unrecovered native FES sound command ${verb}`);
    const state = this.state(instance, object),
      target = this.target(instance, object),
      definition = motionDefinition(verb, raw),
      registers = motionRegisters(definition, args, target.state(), (expression, current) =>
        instance.value(expression, current),
      );
    return target
      .add(definition.file, { registers, group: 0, delay: state.get('motionDelay') })
      .then(() => {
        state.state.motion = target.snapshot();
      });
  }
}
