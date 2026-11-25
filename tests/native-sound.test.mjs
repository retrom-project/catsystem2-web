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
import { canonicalMessage } from '../src/native/control-task.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { BlobFile, GameFiles, RangeFile } from '../src/files.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { floatBits } from '../src/kcs/vm.mjs';
import { parseXML } from '../src/xml.mjs';

const gameProfile = 'nekopara-vol3-engine-2.6.1.76',
  sdkProfile = 'sdk-4.01-engine-2.6.1.74';
test('native sound sidecars revalidate the mounted range and selected cache before reuse', async () => {
  const reads = [],
    bytes = kif([['line.lv', [3, 4]]]),
    file = new RangeFile(bytes.length, (offset, count) => {
      reads.push([offset, count]);
      if (unavailable) throw new Error('sidecar could not be read');
      return bytes.slice(offset, offset + count);
    }),
    game = new GameFiles(new Map([['sounds.int', file]])),
    random = new ParticleRandom();
  let unavailable = false;
  await game.open();
  const world = new NativeWorld({
    game,
    profile: gameProfile,
    configuration: new NativeConfiguration({ profile: gameProfile }),
    random,
    motionLibrary: new MotionLibrary(game, { profile: gameProfile, random }),
    host: {},
    storage: {},
  });
  const name = 'sounds.int/line.lv',
    range = world.captureSoundRange(name),
    witness = { range, bytes: Uint8Array.of(3, 4) };
  try {
    assert.equal(world.captureSoundRange('sounds.int/missing.lv'), null);
    reads.length = 0;
    assert.strictEqual(await world.readPreparedSoundRange(name, witness), witness.bytes);
    assert.deepEqual(reads, []);
    game.applyStartup(null, game.nativeSearch);
    assert.deepEqual(await world.readPreparedSoundRange(name, witness), Uint8Array.of(3, 4));
    assert.deepEqual(reads, [[range.offset, 2]]);
    unavailable = true;
    await assert.rejects(world.readPreparedSoundRange(name, witness), /sidecar could not be read/);
    unavailable = false;
    await world.resourceCache.queue(name, 10);
    await world.resourceCache.start();
    await world.resourceCache.settle();
    assert.equal(world.captureSoundRange(name), undefined);
    unavailable = true;
    const cached = await world.readPreparedSoundRange(name, witness);
    assert.notStrictEqual(cached, witness.bytes);
    assert.deepEqual(cached, Uint8Array.of(3, 4));
  } finally {
    await world.close({ flushFiles: false });
  }
});

function fixture(profile = gameProfile, files = new Map()) {
  let clockValue = 1000;
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
    clock: new NativeSystemClock({ now: () => clockValue }),
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
  return {
    audio,
    world,
    sound,
    task,
    send,
    load,
    setClock: (value) => {
      clockValue = value;
    },
  };
}

function plvFile(values, step) {
  const file = new NativeSoundPacket([0x4c5650, 20, values.length, step], 16 + values.length * 2),
    view = new DataView(file.data.buffer);
  values.forEach((value, i) => view.setUint16(16 + i * 2, value, true));
  return file.data;
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

test('SDK allocated sound loads read the original 280-byte packet and play the returned bank', async () => {
  const { task, audio } = fixture(sdkProfile),
    group = new NativeSoundPacket([], 16),
    packet = new NativeSoundPacket([], 280),
    sendRaw = (id, w = 0, l = 0, payload) =>
      task.message([100, canonicalMessage(sdkProfile, 13, id), w, l], { payload });
  group.writeString('voice', 0);
  assert.equal(await sendRaw(207, 0, 0, group), 2);
  packet.store(4, 5);
  packet.writeString('authored.wav', 12);
  assert.equal(await sendRaw(203, 0, 0, packet), 1);
  assert.equal(packet.load(0), 1);
  assert.equal(task.controls[1].word(C.crossfadeMilliseconds), 0);
  await sendRaw(184, 1, 73);
  await sendRaw(180, 1, 2);
  assert.equal(audio.channels.get('native:1').volume, 73);
  assert.equal(audio.channels.get('native:1').loopCount, 2);
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
  const { sound, task, load, send, audio, world, setClock } = fixture(gameProfile, files);
  await load();
  await send(182, 0, 1);
  assert.equal(await send(212), 10);
  audio.context.currentTime = 1.21;
  assert.equal(await send(212), 10, 'media progress does not advance the PLV system clock');
  setClock(1210);
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

test('both PLV profiles follow the system clock at non-60 FPS with changing or absent AudioContext clocks', async () => {
  const values = Array.from({ length: 32 }, (_, i) => 100 + i);
  for (const profile of [gameProfile, sdkProfile])
    for (const fps of [24, 75, 144]) {
      const { world, audio, task, load, send } = fixture(
        profile,
        new Map([['a_line.plv', plvFile(values, 100)]]),
      );
      world.clock = new NativeSystemClock();
      world.configuration.screen.fps = fps;
      await load();
      await send(182, 0, 1);
      assert.equal(task.controls[0].word(C.wallStart), 0);
      for (let frame = 1; frame <= fps * 2; frame++) {
        world.clock.advance(fps);
        world.frame = frame;
        if (frame === fps) audio.context = null;
        else if (audio.context) audio.context.currentTime = 9000 + frame * 13;
        if ([1, fps - 1, fps, fps + 1, fps * 2].includes(frame)) {
          const index = Number((BigInt(frame) * 1000n) / BigInt(fps * 100));
          assert.equal(await send(212), values[index], `${profile}/${fps}fps/frame${frame}`);
        }
      }
    }
});

test('external PLV ticks preserve DWORD rollover and rebase after a fresh sound/clock restore independently of media offsets', async () => {
  const values = Array.from({ length: 12 }, (_, i) => 10 + i * 10),
    files = new Map([['a_line.plv', plvFile(values, 10)]]);
  for (const profile of [gameProfile, sdkProfile]) {
    const first = fixture(profile, files);
    first.setClock(0xfffffff0);
    await first.load();
    await first.send(182, 0, 1);
    first.audio.channels.get('native:0').offset = 3.25;
    assert.equal(first.task.controls[0].word(C.wallStart), 0xfffffff0);
    first.setClock(0x12);
    assert.equal(await first.send(212), 40, '34ms elapsed across the original DWORD wrap');
    const saved = {
        clock: structuredClone(first.world.clock.snapshot()),
        sound: first.sound.snapshot(),
        task: first.task.snapshot(),
        handles: first.world.runtime.handles.snapshot(),
      },
      fresh = fixture(profile, files);
    fresh.setClock(8000000);
    fresh.audio.context.currentTime = 200;
    fresh.world.frame = 999;
    fresh.world.clock.restore(saved.clock);
    fresh.world.runtime.handles.restore(saved.handles);
    fresh.task.restore(saved.task);
    await fresh.sound.restore(saved.sound);
    assert.equal(await fresh.send(212), 40);
    assert.equal(
      fresh.audio.channels.get('native:0').offset,
      3.25,
      'the saved media position is not derived from PLV ticks',
    );
    fresh.setClock(8000020);
    assert.equal(await fresh.send(212), 60);
    assert.equal(
      await first.send(212),
      40,
      'a restored clock does not advance its source instance',
    );
    fresh.audio.context.currentTime = 120000;
    assert.equal(await fresh.send(212), 60);
    assert.equal(fresh.task.controls[0].word(C.wallStart), 0xfffffff0);
  }
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

test('2.6.1.23 Main sound uses a bank word and a filename through its own Sound receiver', async (t) => {
  const { world, sound, task: receiver, audio } = fixture('grisaia-jp-engine-2.6.1.23'),
    task = { id: 100 },
    call = (id, args) => nativeSound(id, args, null, task, world),
    wire = [];
  world.nativeTaskID = (id) => id;
  const message = receiver.message;
  t.mock.method(receiver, 'message', function (words, context) {
    wire.push({ words, filename: context.payload?.string?.(0) });
    return Reflect.apply(message, this, [words, context]);
  });
  assert.deepEqual(await call(155, [7, 0xff, 'a_line.wav', 1]), { control: 1, value: 1 });
  assert.deepEqual(wire[0], { words: [100, 166, 7, 0], filename: 'a_line.wav' });
  assert.equal(sound.device[7].loaded, true);
  assert.equal(sound.device[0].loaded, false);
  assert.deepEqual(await call(157, [7, 1]), { control: 2 });
  assert.equal(audio.channels.get('native:7').playing, true);
  assert.deepEqual(await call(160, [7]), { control: 1, value: 1 });
  assert.deepEqual(await call(161, [7, 81]), { control: 2 });
  assert.deepEqual(await call(162, [7]), { control: 1, value: 81 });
  assert.deepEqual(await call(163, [7, 50, 0x10003]), { control: 2 });
  assert.equal(receiver.controls[7].float(C.volumeRemaining), 3);
  assert.deepEqual(await call(156, [7]), { control: 2 });
  assert.equal(sound.device[7].loaded, false);
  assert.deepEqual(await call(155, [3, 0, 'b_line.wav', 2]), { control: 1, value: 1 });
  assert.deepEqual(wire.at(-1), { words: [100, 167, 3, 0], filename: 'b_line.wav' });
});

test('2.6.1.23 Sound groups put the selector in W and the filename in L', async (t) => {
  const { world, sound, task: receiver } = fixture('grisaia-jp-engine-2.6.1.23'),
    task = { id: 100 },
    call = (id, args) => nativeSound(id, args, null, task, world),
    wire = [];
  world.nativeTaskID = (id) => id;
  const message = receiver.message;
  t.mock.method(receiver, 'message', function (words, context) {
    wire.push(words);
    return Reflect.apply(message, this, [words, context]);
  });
  assert.deepEqual(await call(347, [1, floatBits(2), floatBits(-3), floatBits(4)]), {
    control: 2,
  });
  assert.deepEqual(sound.device[1].nativeSpatial.velocity, [0, 0, 0]);
  assert.deepEqual(await call(604, [0x10002, 123, 'voice.wav', 0, 1]), {
    control: 1,
    value: 1,
  });
  assert.deepEqual(wire.at(-1), [100, 194, 0x10002, 0]);
  assert.equal(sound.device[1].file, 'voice.wav');
  assert.equal(sound.device[1].category, 'voice');
  assert.equal(receiver.controls[1].word(C.autoRelease), 1);
  assert.deepEqual(await call(347, [1, floatBits(2), floatBits(-3), floatBits(4)]), {
    control: 2,
  });
  assert.deepEqual(wire.at(-1), [100, 182, 1, 0]);
  assert.deepEqual(sound.device[1].nativeSpatial.velocity, [2, -3, 4]);
  await call(348, [1, floatBits(0.5)]);
  assert.deepEqual(wire.at(-1), [100, 183, 1, 0]);
  assert.equal(sound.device[1].nativeSpatial.dopplerFactor, 0.5);
  assert.deepEqual(await call(604, [2, 0, 'voice.wav', 0, 2]), {
    control: 1,
    value: 0xffffffff,
  });
  assert.deepEqual(wire.at(-1), [100, 195, 2, 0]);
  await call(602, [8, 1, 4, 6, 72]);
  assert.deepEqual(wire.at(-1), [100, 190, 8, 0]);
  assert.deepEqual(receiver.groups.get(8), { id: 8, typeCode: 1, min: 4, max: 6, volume: 72 });
  for (const [type, bank] of [
    [1, 4],
    [2, 5],
  ]) {
    assert.deepEqual(await call(604, [8, 0, 'se.wav', 1, type]), { control: 1, value: bank });
    assert.deepEqual(wire.at(-1), [100, 191 + type, 8, 0]);
    assert.equal(sound.device[bank].category, 'se');
  }
  await call(603, [8]);
  assert.deepEqual(wire.at(-1), [100, 191, 8, 0]);
  assert.equal(receiver.groups.has(8), false);
  assert.equal((await call(604, [8, 0, 'se.wav', 1, 1])).value, 0xffffffff);
});

for (const profile of [gameProfile, sdkProfile])
  test(`${profile} sound opens share only the same owner's successful mounted read in one tick`, async (t) => {
    const file = new BlobFile(
        new Blob([
          kif([
            ['a.ogg', [1, 2]],
            ['b.ogg', [3, 4]],
          ]),
        ]),
      ),
      game = new GameFiles(new Map([['sounds.int', file]]));
    await game.open();
    const random = new ParticleRandom(),
      world = new NativeWorld({
        game,
        profile,
        configuration: new NativeConfiguration({ profile }),
        random,
        motionLibrary: new MotionLibrary(game, { profile, random }),
        host: {},
        storage: {},
      }),
      task = { id: 1 },
      other = { id: 2 },
      source = 'sounds.int/a.ogg',
      sourceRead = BlobFile.prototype.read;
    world.runtime.scheduler.tasks.set(task.id, task);
    world.runtime.scheduler.tasks.set(other.id, other);
    let reads = 0,
      unavailable = true;
    t.mock.method(BlobFile.prototype, 'read', function (at, count) {
      reads++;
      if (unavailable) throw new Error('mounted range unavailable');
      return sourceRead.call(this, at, count);
    });
    try {
      world.processWindowMessages = async () => {
        await assert.rejects(world.canOpenSoundFile(source, task), /unavailable/);
        unavailable = false;
        assert.equal(await world.canOpenSoundFile(source, task), true);
        assert.equal(await world.canOpenSoundFile(source, task), true);
        assert.equal(reads, 2);
        assert.deepEqual(await world.game.read(source), Uint8Array.of(1, 2));
        assert.equal(reads, 3, 'ordinary callers still receive an independent read');
        assert.equal(await world.canOpenSoundFile(source, other), true);
        assert.equal(reads, 4, 'a different owner opens independently');
        game.applyStartup(null, game.nativeSearch);
        assert.equal(await world.canOpenSoundFile(source, other), true);
        assert.equal(reads, 5, 'remounting invalidates the prior open');
      };
      await world.tick();
      world.processWindowMessages = async () => {
        assert.equal(await world.canOpenSoundFile(source, other), true);
        assert.equal(reads, 6, 'a later tick opens independently');
      };
      await world.tick();
      await world.resourceCache.queue(source, 1);
      await world.resourceCache.start();
      await world.resourceCache.settle();
      assert.equal(reads, 7);
      unavailable = true;
      world.processWindowMessages = async () => {
        assert.equal(await world.canOpenSoundFile(source, other), true);
        assert.equal(reads, 7, 'the authored cache remains the first source');
      };
      await world.tick();
    } finally {
      await world.close({ flushFiles: false });
    }
  });

test('2.6.1.67 KCS Sound offset loads use the original timing packet and both group selectors', async (t) => {
  const profile = 'bokutomo-engine-2.6.1.67',
    calls = [
      [935, [7, 0xffffffff, 288, 1, 67]],
      [935, [8, 0, 288, 2, 1]],
      [936, [5, 0, 288, 1, 1, 19]],
      [936, [5, 0, 288, 1, 2, 23]],
      [936, [0x10005, 0, 288, 0, 1, 37]],
      [936, [0x10005, 0, 288, 0, 2, 41]],
      [936, [9, 0, 288, 1, 1, 15]],
    ],
    outputs = (index) => 80 + index * 4,
    world = await dataWorld(profile, {
      'あ_line.wav': Uint8Array.of(1, 2, 3),
      'offsets.kcs': kcsProgram(
        [
          ...calls.flatMap(([id, args], index) => [
            ...args.map((arg) => [37, arg]),
            [43, id, args.length * 4],
            [38, outputs(index)],
          ]),
          [59],
        ],
        [[288, 'あ_line.wav']],
      ),
    });
  t.after(() => world.close({ flushFiles: false }));
  world.sound.audio = fixture(profile).audio;
  const receiver = world.sound.primary(world.main.id),
    dispatch = receiver.message.bind(receiver),
    packets = [];
  receiver.groups.set(5, { id: 5, type: 'voice', typeCode: 2, min: 10, max: 11 });
  receiver.groups.set(2, { id: 2, type: 'bgm', typeCode: 0, min: 13, max: 14 });
  receiver.message = (words, context) => {
    const id = words[1];
    if ([174, 175, 200, 201, 202, 203].includes(id)) {
      const packet = context.payload;
      packets.push([
        id,
        packet.data.length,
        packet.load(4),
        packet.load(8),
        packet.load(272),
        packet.load(276),
      ]);
    }
    return dispatch(words, context);
  };
  const task = await world.spawnScript('offsets.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await world.runtime.scheduler.execute(task);
  assert.deepEqual(
    calls.map((_, index) => task.machine.load(outputs(index))),
    [1, 1, 10, 11, 13, 14, 0xffffffff],
  );
  assert.deepEqual(packets, [
    [174, 280, 0, 0, 1, 1116],
    [175, 280, 0, 0, 1, 16],
    [200, 280, 5, 0, 1, 316],
    [201, 280, 5, 0, 1, 383],
    [202, 280, 0x10005, 0, 0, 616],
    [203, 280, 0x10005, 0, 0, 683],
    [200, 280, 9, 0, 1, 250],
  ]);
  for (const [bank, mode, offset] of [
    [7, 'stream', 1116],
    [8, 'static', 16],
    [10, 'stream', 316],
    [11, 'static', 383],
    [13, 'stream', 616],
    [14, 'static', 683],
  ]) {
    const device = world.sound.device[bank];
    assert.equal(device.file, 'あ_line.wav');
    assert.equal(device.sourceMode, mode);
    assert.equal(device.decoderOption, offset);
  }
});

test('2.6.1.67 Sound GCALLs use compact load packets and control the actual Root bank', async (t) => {
  const profile = 'bokutomo-engine-2.6.1.67',
    program = (calls) =>
      kcsProgram(
        [
          [37, 0xa056f028],
          ...calls.flatMap(([id, args, destination]) => [
            ...args.map((arg) => [37, arg]),
            [43, id, args.length * 4],
            ...(destination === undefined ? [] : [[38, destination]]),
          ]),
          [59],
        ],
        [
          [288, 'あ_line.wav'],
          [320, 'missing.wav'],
        ],
      ),
    xyz = [7, ...[1.25, 2.5, 4.5].map(floatBits)],
    velocity = [7, ...[-1.5, 2.25, -3.5].map(floatBits)],
    range = [7, floatBits(8.25), floatBits(72.5)],
    world = await dataWorld(profile, {
      'あ_line.wav': Uint8Array.of(1, 2, 3),
      'sound-load.kcs': program([
        [155, [7, 0xffffffff, 288, 1], 80],
        [155, [8, 0, 288, 2], 84],
        [155, [9, 0, 320, 2], 88],
        [284, [0, 288], 92],
        [284, [0, 320], 96],
      ]),
      'sound-play.kcs': program([
        [349, [7], 92],
        [161, [7, 65]],
        [162, [7], 80],
        [164, [7, -34]],
        [165, [7], 84],
        [157, [7, 4]],
        [160, [7], 88],
        [163, [7, 83, 19]],
        [166, [7, -88, 28]],
        [349, [7], 96],
        [349, [0xffffffff], 100],
      ]),
      'sound-spatial.kcs': program([
        [167, range],
        [168, xyz],
        [347, velocity],
        [348, [7, floatBits(0.5)]],
      ]),
      'sound-pause.kcs': program([
        [158, [7]],
        [160, [7], 80],
        [157, [7, 1]],
        [159, [7]],
        [160, [7], 84],
      ]),
      'sound-invalid.kcs': program([[155, [7, 0, 288, 9], 80]]),
      'sound-release.kcs': program([
        [156, [7]],
        [156, [8]],
      ]),
    }),
    audio = fixture(profile).audio;
  t.after(() => world.close({ flushFiles: false }));
  world.sound.audio = audio;
  world.configuration.soundOptions.use3d = 1;
  const sound = world.sound,
    receiver = sound.primary(world.main.id),
    device = sound.device[7],
    control = receiver.controls[7],
    packets = [],
    spatialMessages = [],
    dispatch = receiver.message.bind(receiver),
    execute = async (name) => {
      const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
        floor = task.machine.sp;
      await world.runtime.scheduler.execute(task);
      assert.equal(task.machine.sp, floor + 4);
      assert.equal(task.machine.load(floor), 0xa056f028);
      return task.machine;
    };
  receiver.message = (words, context) => {
    if (words[1] === 174 || words[1] === 175)
      packets.push([words[1], words[2], context.payload.data.length, context.payload.load(272)]);
    if (words[1] >= 190 && words[1] <= 192) spatialMessages.push(words[1]);
    return dispatch(words, context);
  };
  await execute('sound-spatial.kcs');
  assert.deepEqual(device.nativeSpatial.position, [0, 0, 0]);
  assert.deepEqual(device.nativeSpatial.velocity, [0, 0, 0]);
  assert.equal(device.nativeSpatial.dopplerFactor, 1);
  assert.notEqual(device.nativeSpatial.maximumDistance, 72.5);
  const loaded = await execute('sound-load.kcs');
  assert.deepEqual(
    [80, 84, 88, 92, 96].map((at) => loaded.load(at)),
    [1, 1, 0, 1, 0],
  );
  assert.deepEqual(packets, [
    [174, 0, 280, 1],
    [175, 0, 280, 1],
    [175, 0, 280, 1],
  ]);
  assert.equal(device.file, 'あ_line.wav');
  assert.equal(device.sourceMode, 'stream');
  assert.equal(sound.device[8].sourceMode, 'static');
  assert.equal(device.decoderOption, 0);
  assert.equal(audio.channels.size, 0);
  const playing = await execute('sound-play.kcs');
  assert.deepEqual(
    [80, 84, 88, 92, 96, 100].map((at) => playing.load(at)),
    [65, 0xffffffde, 1, 0, 1, 0],
  );
  assert.equal(device.loopCount, 4);
  assert.equal(control.word(C.flags) & 3, 3);
  assert.equal(control.float(C.targetVolume), 83);
  assert.equal(control.float(C.targetPan), -88);
  assert.equal(control.float(C.volumeRemaining), 19);
  assert.equal(control.float(C.panRemaining), 28);
  await execute('sound-spatial.kcs');
  assert.equal(device.nativeSpatial.maximumDistance, 72.5);
  assert.deepEqual(device.nativeSpatial.position, [1.25, 2.5, 4.5]);
  assert.deepEqual(device.nativeSpatial.velocity, [-1.5, 2.25, -3.5]);
  assert.equal(device.nativeSpatial.dopplerFactor, 0.5);
  assert.deepEqual(spatialMessages, [190, 191, 192, 192, 192, 190, 191]);
  const paused = await execute('sound-pause.kcs');
  assert.deepEqual(
    [80, 84].map((at) => paused.load(at)),
    [0, 0],
  );
  assert.equal(sound.channel(7).offset, 0);
  await assert.rejects(() => execute('sound-invalid.kcs'), /result uninitialized/);
  await execute('sound-release.kcs');
  assert.equal(device.loaded, false);
  assert.equal(sound.device[8].loaded, false);
  assert.equal(audio.channels.size, 0);
});
