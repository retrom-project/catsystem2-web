// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeSound,
  NativeSoundPacket,
  NATIVE_SOUND_CONTROL as C,
  nativeSound,
} from '../src/native/sound.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { floatBits } from '../src/kcs/vm.mjs';
import { parseXML } from '../src/xml.mjs';

const gameProfile = 'nekopara-vol3-engine-2.6.1.76',
  sdkProfile = 'sdk-4.01-engine-2.6.1.74';
function fixture(profile = gameProfile, files = new Map()) {
  const audio = {
    context: { currentTime: 1 },
    channels: new Map(),
    spatialCalls: [],
    async preload(file) {
      return file.startsWith('missing')
        ? null
        : {
            buffer: {},
            metadata: {
              codec: 'wav',
              channels: 1,
              bitsPerSample: 16,
              sampleRate: 44100,
              pcmBytes: 882000,
              sampleFrames: 441000,
              durationSeconds: 10,
            },
          };
    },
    async play(sound) {
      const channel = {
        ...structuredClone(sound),
        playing: !sound.paused && !sound.ended,
        paused: !!sound.paused,
        ended: !!sound.ended,
        offset: sound.offset || 0,
      };
      this.channels.set(sound.channel, channel);
      return channel;
    },
    stop(key) {
      this.channels.delete(key);
    },
    pause(key) {
      const channel = this.channels.get(key);
      if (channel) {
        channel.playing = false;
        channel.paused = true;
      }
    },
    refresh() {},
    setNativeSpatial(key, values) {
      this.spatialCalls.push([key, structuredClone(values)]);
    },
    setNativeLoop(key, values) {
      Object.assign(this.channels.get(key), values);
    },
    swapNativeBanks(a, b) {
      const first = this.channels.get(a),
        second = this.channels.get(b);
      this.channels.delete(a);
      this.channels.delete(b);
      if (first) {
        first.channel = b;
        this.channels.set(b, first);
      }
      if (second) {
        second.channel = a;
        this.channels.set(a, second);
      }
    },
    channelState(key, channel) {
      return { ...structuredClone(channel), channel: key };
    },
  };
  const configuration = new NativeConfiguration({
    profile,
    startup: parseXML(
      '<document><SOUND><use3d>1</use3d></SOUND><SOUNDGROUP><group00><id>5</id><type>voice</type><min>1</min><max>2</max></group00></SOUNDGROUP></document>',
    ),
  });
  const world = {
    profile,
    frame: 40,
    audio,
    configuration,
    soundConfiguration: null,
    root: 0,
    game: {
      async read(name) {
        return files.get(name) ?? null;
      },
    },
    runtime: { handles: new NativeHandles(), services: { format: (value) => value } },
    objects: {
      objects: new Map([[0, { implementation: { sound: 13 } }]]),
      machine() {
        throw new Error('Missing guest memory');
      },
    },
    base: () => ({ message: () => 0 }),
  };
  const sound = new NativeSound(world);
  world.sound = sound;
  const task = sound.create({ id: 13 });
  const send = (id, bank = 0, value = 0, payload = null) =>
    task.message(
      [100, profile === sdkProfile && id >= 179 && id <= 220 ? id - 2 : id, bank, value],
      payload ? { payload } : {},
    );
  const load = async (bank = 0, type = 1) => {
    const packet = new NativeSoundPacket([], 288);
    packet.store(0, bank);
    packet.writeString('a_line.wav', 12);
    packet.store(272, 1);
    return send(type === 1 ? 179 : 180, 0, 0, packet);
  };
  return { audio, world, sound, task, send, load };
}

test('both sound profiles preload without playing and keep their original bank limits', async () => {
  for (const profile of [sdkProfile, gameProfile]) {
    const { sound, task, audio, load, send } = fixture(profile);
    assert.equal(sound.bankCount, profile === sdkProfile ? 32 : 64);
    assert.equal(await load(), 1);
    assert.equal(audio.channels.size, 0);
    assert.equal(sound.device[0].loaded, true);
    assert.equal(await send(200), 441000);
    assert.equal(await send(182, 0, 1), 0);
    assert.equal(audio.channels.get('native:0').playing, true);
    assert.equal(task.controls[0].word(C.lastTimeFrame), profile === sdkProfile ? 40 : 0xffffffff);
    assert.equal(await send(185), 1);
    await send(183);
    assert.equal(await send(185), 0);
    await send(181);
    assert.equal(sound.device[0].loaded, false);
  }
});

test('native sound fades preserve reciprocal remaining-frame interpolation and deferred cleanup', async () => {
  const { task, sound, load, send } = fixture();
  await load();
  await send(182, 0, 1);
  await send(188, 0, 3 << 16);
  await task.tick(41);
  assert.equal(sound.device[0].volume, 50);
  assert.equal(task.controls[0].float(C.volumeRemaining), 2);
  await task.tick(42);
  assert.equal(sound.device[0].volume, 0);
  await task.tick(43);
  assert.equal(task.controls[0].word(C.flags) & 1, 0);
  const control = task.controls[0];
  control.word(C.autoRelease, 1);
  await send(184);
  assert.equal(control.word(C.stopPending), 1);
  await task.tick(53);
  assert.equal(control.word(C.stopPending), 1);
  await task.tick(54);
  assert.equal(control.word(C.stopPending), 0);
  assert.equal(sound.device[0].loaded, true);
  assert.equal(sound.device[0].volume, 100);
});

test('sound groups choose unused, releasing, finishing, then first banks in the native order', async () => {
  const { task, sound } = fixture();
  assert.equal(task.groups.get(5).typeCode, 2);
  assert.equal(task.allocate(1, 2), 1);
  sound.device[1].loaded = true;
  assert.equal(task.allocate(1, 2), 2);
  sound.device[2].loaded = true;
  task.controls[2].word(C.endAfterPlayback, 1);
  assert.equal(task.allocate(1, 2), 2);
  assert.equal(sound.device[2].loaded, false);
  sound.device[2].loaded = true;
  task.controls[1].word(C.releasePending, 1);
  assert.equal(task.allocate(1, 2), 1);
});

test('crossfade completion swaps device banks and revisits the new bank during that frame', async () => {
  const { task, sound, audio, send, load } = fixture();
  await load();
  await send(182, 0, 1);
  const packet = new NativeSoundPacket([], 288);
  packet.store(0, 0);
  packet.writeString('b_line.wav', 12);
  packet.store(280, 1);
  packet.store(284, 3);
  assert.equal(await send(179, 0, 0, packet), 1);
  await send(182, 0, 1);
  const source = audio.channels.get('native:32');
  await task.tick(41);
  assert.equal(sound.device[32].volume, 50);
  await task.tick(42);
  await task.tick(43);
  assert.equal(task.controls[0].word(C.releasePending), 1);
  await task.tick(44);
  assert.equal(sound.device[0].file, 'b_line.wav');
  assert.equal(audio.channels.get('native:0'), source);
  assert.equal(sound.device[32].loaded, false);
  assert.equal(task.controls[0].word(C.lastTimeFrame), 44);
  assert.equal(task.controls[0].word(C.crossfade), 0);
});

test('loop points belong to each task and duplicate registration only changes the start', async () => {
  const { sound, task, load, send, audio } = fixture();
  task.loadLoopPointRecords([
    { file: 'A_LINE.WAV', start: 10n, end: 500n },
    { file: 'a_line.wav', start: 20n, end: 900n },
  ]);
  assert.deepEqual(task.loopPoints.get('a_line.wav'), {
    file: 'A_LINE.WAV',
    start: 20n,
    end: 500n,
  });
  assert.equal(sound.create({ id: 14 }).loopPoints.size, 0);
  await load();
  await send(182, 0, 0);
  assert.equal(audio.channels.get('native:0').loopStartFrame, 20n);
  assert.equal(audio.channels.get('native:0').loopEndFrame, 500n);
  await send(182, 0, 1);
  assert.equal(audio.channels.get('native:0').loopStartFrame, 0n);
  assert.equal(audio.channels.get('native:0').loopEndFrame, -1n);
});

test('native pan updates 3D position and distance setter preserves its ignored first argument', async () => {
  const { sound, send, load } = fixture();
  await load();
  await send(182, 0, 1);
  await send(189, 0, 100);
  assert.deepEqual(sound.device[0].nativeSpatial.position, [1, 0, 0]);
  await send(192, 0, 0, new NativeSoundPacket([floatBits(7), floatBits(250)]));
  assert.equal(sound.device[0].nativeSpatial.maximumDistance, 250);
  assert.equal(sound.device[0].nativeSpatial.minimumDistance, 100);
  await send(193, 0, 0, new NativeSoundPacket([floatBits(2), floatBits(3), floatBits(4)]));
  assert.deepEqual(sound.device[0].nativeSpatial.position, [2, 3, 4]);
});

test('PLV, tag and sidecar resources preserve native clock units and live handles', async () => {
  const files = new Map(),
    tag = new NativeSoundPacket([], 24),
    plv = new NativeSoundPacket([0x4c5650, 20, 3, 100], 22);
  tag.writeString('entry', 0);
  tag.store(20, 1234);
  files.set('a_line.tag', tag.data);
  new DataView(plv.data.buffer).setUint16(16, 10, true);
  new DataView(plv.data.buffer).setUint16(18, 30, true);
  new DataView(plv.data.buffer).setUint16(20, 50, true);
  files.set('a_line.plv', plv.data);
  files.set('a_line.lpb', Uint8Array.of(1, 2, 3));
  const { sound, task, load, send, audio, world } = fixture(gameProfile, files);
  await load();
  await send(182, 0, 1);
  assert.equal(await send(212), 10);
  audio.context.currentTime = 1.21;
  assert.equal(await send(212), 50);
  assert.equal(await send(214, 0, 0, tag), 1234);
  const handle = await send(216);
  assert.equal(world.runtime.handles.get(handle, 'sound-tags'), task.controls[0].tags);
  assert.equal(await send(222), 1);
  const packet = new NativeSoundPacket();
  await send(220, 0, 0, packet);
  assert.deepEqual(
    world.runtime.handles.get(packet.load(0), 'sound-sidecar'),
    Uint8Array.of(1, 2, 3),
  );
  const hardware = sound.snapshot(),
    saved = task.snapshot(),
    handles = world.runtime.handles.snapshot();
  const restored = fixture();
  restored.world.runtime.handles.restore(handles);
  restored.task.restore(saved);
  await restored.sound.restore(hardware);
  assert.deepEqual(restored.task.snapshot(), saved);
  assert.equal(
    restored.task.controls[0].tags,
    restored.world.runtime.handles.get(handle, 'sound-tags'),
  );
  await send(181);
  assert.equal(world.runtime.handles.records.has(packet.load(0)), false);
});

test('main sound wrappers preserve ignored arguments, packed fades and void control replies', async () => {
  const { world, sound } = fixture();
  world.nativeTaskID = (id) => id;
  const machine = {
      nativeArgument() {
        throw new Error('Missing native argument');
      },
    },
    task = { id: 100 };
  assert.deepEqual(
    await nativeSound(0x9b, [0, 0x12345678, 'a_line.wav', 1], machine, task, world),
    { control: 1, value: 1 },
  );
  assert.deepEqual(await nativeSound(0xa1, [0, 70], machine, task, world), { control: 2 });
  assert.equal(sound.device[0].volume, 70);
  assert.deepEqual(await nativeSound(0xa2, [0], machine, task, world), { control: 1, value: 70 });
  await nativeSound(0xa3, [0, 100, 0x10003], machine, task, world);
  assert.equal(world.sound.primary().controls[0].float(C.volumeRemaining), 3);
  await assert.rejects(
    () => nativeSound(0x9b, [0, 0, 'a_line.wav', 9], machine, task, world),
    /uninitialized/,
  );
  assert.equal(await nativeSound(0x999, [], machine, task, world), undefined);
});
