// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioMixer } from '../src/audio.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_SOUND_CONTROL as C } from '../src/native/sound.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const sentinel = 0x13579bdf;
// Authored five-second mono PCM16 WAV. The decoder below reads these actual bytes.
function wav() {
  const bytes = new Uint8Array(80044),
    view = new DataView(bytes.buffer);
  const text = (at, s) => bytes.set(new TextEncoder().encode(s), at);
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, 80000, true);
  for (let i = 0; i < 40000; i++) view.setInt16(44 + i * 2, [0, 8192, -16384, 32767][i % 4], true);
  return bytes;
}
function audioContext() {
  return {
    currentTime: 0,
    state: 'running',
    destination: {},
    sources: [],
    decodes: [],
    async decodeAudioData(buffer) {
      const bytes = new Uint8Array(buffer),
        view = new DataView(buffer);
      assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
      assert.equal(view.getUint16(20, true), 1);
      assert.equal(view.getUint16(34, true), 16);
      const length = view.getUint32(40, true) / 2,
        rate = view.getUint32(24, true);
      const samples = Float32Array.from(
        { length },
        (_, i) => view.getInt16(44 + 2 * i, true) / 32768,
      );
      this.decodes.push(bytes.slice());
      return {
        length,
        sampleRate: rate,
        numberOfChannels: 1,
        duration: length / rate,
        getChannelData: () => samples,
      };
    },
    createBufferSource() {
      const node = {
        playbackRate: {
          value: 1,
          setValueAtTime(value) {
            this.value = value;
          },
        },
        connect() {},
        disconnect() {},
        start(when, offset) {
          this.when = when;
          this.offset = offset;
        },
        stop(when) {
          if (when === undefined) this.stopped = true;
          else this.stopWhen = when;
        },
      };
      this.sources.push(node);
      return node;
    },
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        setValueAtTime(value) {
          this.value = value;
        },
        setTargetAtTime(value) {
          this.value = value;
        },
      },
    }),
    createChannelSplitter: () => ({ connect() {}, disconnect() {} }),
    createChannelMerger: () => ({ connect() {}, disconnect() {} }),
    close() {
      this.state = 'closed';
    },
  };
}
const source = [
  'var sound = new CsSound(), alias = sound, ctorAlias = CsSound;',
  'var loaded = sound.load("cue.wav", "bgm"), played = sound.play(), stopped;',
  'function play(loop) { played = alias.play(loop); }',
  'function load(category) { loaded = sound.load("cue.wav", category); }',
  'function missing() { var absent = new CsSound(); absent.load("missing.wav", "bgm"); absent.play(); absent.stop(); }',
  'function stop() { stopped = alias.stop(); }',
  'function invalid() { sound.load("cue.wav", ""); }',
  'function GameLoop(frame) {}',
].join('\n');
function fixture(script = source, delayed = false) {
  const own = [37, [0x14, 64]],
    target = [37, [0x14, 68]],
    start = [[37, sentinel]];
  for (let group = 0; group < 4; group++)
    start.push(
      [37, group],
      [37, group],
      [37, group * 4],
      [37, group * 4 + 3],
      [37, 100],
      [43, 0x25a, 20],
    );
  start.push(
    [43, 0x44, 0],
    [38, 64],
    [37, 55],
    own,
    [37, 256],
    [43, 0x42, 12],
    [38, 68],
    target,
    own,
    [43, 0x3ce, 8],
    target,
    [37, 288],
    [43, 0x3cf, 8],
  );
  const idle = start.reduce((pc, op) => pc + 1 + (op.length - 1) * 5, 0),
    bytes = wav();
  const game = memoryGame({
    'main.kcs': kcsProgram(
      [...start, [43, 0x41, 0], [41, idle]],
      [
        [256, 'Owned sound JS'],
        [288, 'sound.js'],
      ],
    ),
    'sound.js': new TextEncoder().encode(script),
    'bgm/cue.wav': bytes,
  });
  game.resolveCategory = (name, category) => {
    const path = name === 'cue.wav' && category === 'sound' ? 'bgm/cue.wav' : name;
    return game.index.has(path) ? path : null;
  };
  game.nativeResources = { resolve: (name, category) => game.resolveCategory(name, category) };
  const configuration = new NativeConfiguration({ profile }),
    voice = new DataView(configuration.blocks[0].buffer);
  voice.setUint32(1397 * 4, 80, true);
  voice.setUint32(1398 * 4, 50, true);
  voice.setUint32(1399 * 4, 25, true);
  voice.setUint32(1400 * 4, 75, true);
  configuration.deriveVolumes();
  const context = audioContext(),
    audio = new AudioMixer(game, context),
    random = new ParticleRandom(19, 23);
  const world = new NativeWorld({
    game,
    profile,
    configuration,
    random,
    audio,
    images: {},
    host: {},
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: (name) => game.read(name), write: async () => true },
  });
  world.sound.master = 50;
  world.sound.volumeGroups.set(0, 50);
  const events = {
    reads: [],
    required: [],
    native: [],
    packets: [],
    replies: [],
    promises: [],
    original: 0,
  };
  const read = game.read,
    require = game.require,
    native = world.runtime.native,
    send = world.sendNativeEngine;
  let enter,
    release,
    pending = delayed;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    blocked = new Promise((resolve) => {
      release = resolve;
    });
  game.read = function (...args) {
    events.reads.push(args[0]);
    return read.apply(this, args);
  };
  game.require = function (...args) {
    events.required.push(args[0]);
    if (pending && args[0] === 'bgm/cue.wav') {
      pending = false;
      enter();
      return blocked.then(() => require.apply(this, args));
    }
    return require.apply(this, args);
  };
  world.ensureNativeEngine = () => {
    events.original++;
    throw new Error('normal CsSound attempted original CPU');
  };
  world.runtime.native = function (...args) {
    events.native.push(args[1]);
    return native.apply(this, args);
  };
  world.sendNativeEngine = function (...args) {
    const packet = {
      target: args[0],
      sender: args[1],
      id: args[2],
      w: args[3],
      l: args[4],
      flags: args[5]?.flags,
      bytes: args[5]?.payload?.data?.slice() ?? null,
    };
    events.packets.push(packet);
    const promise = send.apply(this, args);
    events.promises.push(promise);
    promise.then(
      (result) => events.replies.push({ packet, result }),
      () => {},
    );
    return promise;
  };
  return { world, game, audio, context, events, bytes, voice, entered, release };
}
function owner(world) {
  return world.objects.objects.get(world.resolveTaskID(world.main.machine.load(68), world.main.id));
}
function cell(world, name) {
  const vm = owner(world).implementation.machine;
  return vm.state.cells[vm.cell(0, name)];
}
function sound(world) {
  return world.runtime.handles.get(cell(world, 'sound').hostObject, 'javascript-sound');
}
async function invoke(world, name, args = []) {
  const implementation = owner(world).implementation,
    machine = implementation.machine;
  await implementation.drain(
    machine,
    machine.call(name, args, (...a) => implementation.host(...a)),
  );
}
function dataOnly(value, seen = new Set()) {
  assert.notEqual(typeof value, 'function');
  assert.equal(value instanceof Promise, false);
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const entry of value instanceof Map ? [...value].flat() : Object.values(value))
    dataOnly(entry, seen);
}
async function cleanup(f) {
  await f.world.close();
  assert.equal(f.audio.channels.size, 0);
  assert.equal(f.audio.pending.size, 0);
  assert.equal(
    f.world.sound.device.some((bank) => bank.loaded),
    false,
  );
  assert.equal(f.world.runtime.handles.records.size, 0);
  assert.equal(f.events.original, 0);
}

test('normal SDK CsSound uses real PCM banks and live prederived volume without double master', async () => {
  const f = fixture();
  try {
    await f.world.initialize('main.kcs');
    const state = sound(f.world),
      task = f.world.sound.get(state.task),
      channel = f.audio.channels.get('native:0');
    assert.equal(state.bank, 0);
    assert.equal(f.world.objects.objects.get(state.task).kind, 13);
    assert.notEqual(f.world.nativeTaskID(state.task), state.bank);
    assert.deepEqual(cell(f.world, 'sound'), cell(f.world, 'alias'));
    assert.equal(cell(f.world, 'loaded'), undefined);
    assert.equal(cell(f.world, 'played'), undefined);
    assert.equal(f.world.main.machine.load(f.world.main.machine.sp - 4), sentinel);
    assert.equal(channel.bank, 0);
    assert.equal(channel.file, 'bgm/cue.wav');
    assert.equal(channel.loopCount, 1);
    assert.equal(channel.volume, 40);
    assert.equal(channel.volumeFactor, 25);
    assert.equal(
      channel.gain.gain.value,
      10 ** (-3322 / 2000),
      'native 10 percent is -3322 hundredths of a decibel',
    );
    assert.equal(f.world.sound.master, 50);
    assert.equal(f.context.decodes.length, 1);
    assert.deepEqual(f.context.decodes[0], f.bytes);
    assert.equal(f.audio.buffers.size, 1);
    const pcm = f.audio.pcmSources.get(channel.buffer);
    assert.deepEqual(pcm.pcm.subarray(0, 8), Uint8Array.from([0, 0, 0, 32, 0, 192, 255, 127]));
    assert.equal(pcm.pcm.length, 80000);
    assert.equal(channel.buffer.getChannelData(0)[2], -0.5);
    assert.equal(f.world.sound.device[0].sourceMode, 'stream');
    const sends = f.events.packets.filter((x) => x.sender === owner(f.world).id);
    const soundSends = sends.filter((x) => x.target === f.world.nativeTaskID(state.task));
    assert.deepEqual(
      soundSends.map((x) => [x.id, x.w, x.l, x.flags]),
      [
        [207, 0, 0, 0],
        [203, 0, 0, 0],
        [184, 0, 40, 0],
        [180, 0, 1, 0],
      ],
    );
    const descriptor = soundSends[1].bytes,
      expected = new Uint8Array(280),
      view = new DataView(expected.buffer);
    expected.set(new TextEncoder().encode('bgm/cue.wav\0'), 12);
    view.setUint32(272, 1, true);
    assert.deepEqual(descriptor, expected);
    assert.equal(descriptor.length, 280);
    assert.equal(f.events.replies.find((x) => x.packet === soundSends[1]).result, 0);
    assert.equal(
      sends.some((x) => x.target === 0 && x.id === 33 && x.flags === 0),
      true,
    );
    assert.equal(
      f.events.promises.every((x) => x instanceof Promise),
      true,
    );
    for (const loop of [0, 2, -2147483648]) {
      await invoke(f.world, 'play', [loop]);
      assert.equal(f.audio.channels.get('native:0').loopCount, loop >>> 0);
      assert.equal(f.events.packets.at(-1).l, loop >>> 0);
      assert.equal(cell(f.world, 'played'), undefined);
    }
    // All category aliases read the same canonical live flat authority, not the Sound tree.
    f.world.soundConfiguration.effectiveVolume = () => {
      throw new Error('CsSound used the hierarchical tree');
    };
    f.world.configuration.deriveVolumes = () => {
      throw new Error('CsSound rederived configuration');
    };
    for (const [category, volume] of [
      ['bgm', 40],
      ['se', 20],
      ['voice', 60],
      ['sysvoice', 60],
    ]) {
      await invoke(f.world, 'load', [category]);
      await invoke(f.world, 'play', [1]);
      const bank = sound(f.world).bank;
      assert.equal(f.world.sound.device[bank].volume, volume);
      const mute = category === 'bgm' ? 1403 : category === 'se' ? 1404 : 1405;
      f.voice.setUint32(mute * 4, 1, true);
      await invoke(f.world, 'play', [1]);
      assert.equal(f.world.sound.device[bank].volume, 0);
      f.voice.setUint32(mute * 4, 0, true);
    }
    f.voice.setUint32(1402 * 4, 1, true);
    await invoke(f.world, 'play', [1]);
    assert.equal(f.world.sound.device[sound(f.world).bank].volume, 0);
    f.voice.setUint32(1402 * 4, 0, true);
    // Signed IMUL/trunc must remain observable even with the default object volume100.
    f.voice.setUint32(2 * 4, 0x40000001, true);
    await invoke(f.world, 'play', [1]);
    assert.equal(f.events.packets.at(-2).l, 1);
    f.voice.setUint32(2 * 4, 60, true);
    await invoke(f.world, 'missing');
    const missing = f.events.replies.filter((x) => x.packet.id === 203).at(-1);
    assert.equal(missing.result, 0xffffffff);
    assert.equal(f.events.packets.at(-1).w, 0xffffffff);
    assert.equal(f.events.packets.at(-1).id, 182);
    assert.equal(f.events.packets.at(-1).l, 0);
    assert.equal(task.controls[0].word(C.autoRelease), 1);
    await assert.rejects(
      invoke(f.world, 'invalid'),
      /Unsupported JavaScript host import.*CsSound/s,
    );
  } finally {
    await cleanup(f);
  }
});

test('normal SDK CsSound restores shared bank aliases and real fade without guest replay or close theft', async () => {
  const first = fixture(),
    fresh = fixture(),
    late = fixture(source, true);
  try {
    await first.world.initialize('main.kcs');
    await first.world.tick();
    const checkpoint = structuredClone(first.world.snapshot());
    dataOnly(checkpoint);
    let rng = 0;
    for (const generator of [fresh.world.random.integer, fresh.world.random.real]) {
      const next = generator.nextUint32;
      generator.nextUint32 = function (...args) {
        rng++;
        return next.apply(this, args);
      };
    }
    await fresh.world.restore(structuredClone(checkpoint));
    assert.deepEqual(fresh.world.snapshot(), checkpoint, 'full settled DTO before any warm frame');
    assert.deepEqual(fresh.events.native, []);
    assert.deepEqual(fresh.events.packets, []);
    assert.equal(rng, 0);
    assert.deepEqual(fresh.events.reads, ['main.kcs']);
    assert.deepEqual(
      fresh.events.required,
      ['bgm/cue.wav'],
      'separate permitted immutable audio preload',
    );
    assert.deepEqual(cell(fresh.world, 'sound'), cell(fresh.world, 'alias'));
    assert.deepEqual(cell(fresh.world, 'ctorAlias'), { host: 'CsSound' });
    assert.notEqual(sound(first.world), sound(fresh.world));
    assert.notEqual(first.audio.channels.get('native:0'), fresh.audio.channels.get('native:0'));
    await invoke(fresh.world, 'stop');
    const record = sound(fresh.world),
      task = fresh.world.sound.get(record.task),
      control = task.controls[0];
    assert.equal(cell(fresh.world, 'stopped'), undefined);
    assert.equal(control.word(C.stopPending), 1);
    assert.equal(control.float(C.volumeRemaining), 10);
    assert.equal(fresh.events.packets.at(-1).id, 182);
    assert.equal(fresh.events.packets.at(-1).l, 0);
    assert.equal(first.world.sound.primary(first.world.main.id).controls[0].word(C.stopPending), 0);
    const halfway = fixture();
    try {
      for (let i = 0; i < 4; i++) await fresh.world.tick();
      assert.equal(control.float(C.volumeRemaining), 6);
      const dto = structuredClone(fresh.world.snapshot());
      await halfway.world.restore(structuredClone(dto));
      assert.deepEqual(halfway.world.snapshot(), dto);
      assert.deepEqual(halfway.events.native, []);
      assert.deepEqual(halfway.events.packets, []);
      const jsID = owner(fresh.world).id,
        globalTaskID = record.task;
      await fresh.world.objects.release(jsID);
      assert.equal(fresh.world.objects.objects.has(globalTaskID), true);
      assert.equal(fresh.world.sound.device[0].loaded, true);
      assert.equal(fresh.audio.channels.has('native:0'), true);
      assert.equal(
        [...fresh.world.runtime.handles.records.values()].some(
          (x) => x.type === 'javascript-sound',
        ),
        false,
      );
      for (let i = 0; i < 6; i++) {
        await fresh.world.tick();
        await halfway.world.tick();
      }
      assert.equal(control.float(C.volumeRemaining), 0);
      assert.equal(fresh.audio.channels.has('native:0'), true);
      await fresh.world.tick();
      await halfway.world.tick();
      for (const current of [fresh, halfway]) {
        const stopped = current.audio.channels.get('native:0');
        assert.equal(stopped.playing, false);
        assert.equal(stopped.ended, true);
        assert.equal(stopped.paused, false);
        assert.equal(stopped.offset, 0);
        assert.equal(stopped.source, null);
      }
      assert.equal(fresh.world.sound.device[0].loaded, true, 'stop preserves the shared bank');
      assert.equal(first.audio.channels.has('native:0'), true);
    } finally {
      await cleanup(halfway);
    }
    const initialization = late.world.initialize('main.kcs');
    await Promise.race([
      late.entered,
      initialization.then(() => {
        throw new Error('no actual pending WAV load');
      }),
    ]);
    const js = owner(late.world),
      implementation = js.implementation;
    assert.throws(() => late.world.snapshot(), /settled|pending|callback/);
    await late.world.objects.release(js.id);
    late.release();
    await assert.rejects(initialization, /owner is closed/);
    assert.equal(implementation.machine, null);
    assert.equal(late.world.objects.objects.has(js.id), false);
    assert.equal(
      [...late.world.runtime.handles.records.values()].some((x) => x.type === 'javascript-sound'),
      false,
    );
    assert.equal(
      late.world.sound.device[0].loaded,
      true,
      'global SoundTask may finish its own pending load',
    );
    assert.equal(late.audio.buffers.size, 1);
    assert.equal(late.audio.channels.size, 0);
    assert.equal(first.events.original + fresh.events.original + late.events.original, 0);
  } finally {
    late.release();
    await cleanup(first);
    await cleanup(fresh);
    await cleanup(late);
  }
});
