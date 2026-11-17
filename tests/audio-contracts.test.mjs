// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioMixer } from '../src/audio.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { NativeSoundPacket } from '../src/native/sound.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { EmoteRuntime } from '../src/emote/runtime.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
  startupXML,
} from './fixtures/ordinary-startup.mjs';

import { audioFixture as fixture } from './fixtures/audio-context.mjs';
const command = (mixer, group, banks, verb, args = []) =>
  mixer.command({ group, banks, verb, args });

test('retained native voice completion exposes real metadata without extending playback', async () => {
  const environment = startupEnvironment(),
    { context } = fixture(),
    next = fixture();
  let core, cold;
  try {
    const game = await ordinaryStartupGame('nekopara-vol3-engine-2.6.1.76', {
      sound: false,
      files: { 'afile.wav': new Uint8Array([1]), 'high.wav': new Uint8Array([2]) },
    });
    core = new CatSystem2({
      game,
      canvas: new StartupCanvas(),
      audioContext: context,
      nativeProfile: 'nekopara-vol3-engine-2.6.1.76',
      transitionalExe: {
        open() {
          throw new Error('Unexpected original CPU');
        },
      },
    });
    await core.initialize();
    const sound = core.world.sound,
      control = sound.primary().controls[3];
    assert.equal(await sound.load(3, 'afile.wav', 1, 0, 'voice'), true);
    control.tags.set('cue', 1000);
    await sound.play(3, 1, control);
    context.advance(0.25);
    assert.equal(core.audio.voiceInfo().playing, true);
    const wait = await core.host.waitTag('cue', 0);
    assert.deepEqual(wait, { file: 'afile.wav', time: 1 });
    assert.equal(core.host.tagReady(wait), false);
    context.advance(2);
    const channel = sound.channel(3),
      completed = core.audio.voiceInfo();
    assert.equal(channel.ended, true);
    assert.equal(sound.device[3].loaded, true);
    assert.equal(completed.file, 'afile.wav');
    assert.equal(completed.playing, false);
    assert.equal(completed.time, 2);
    assert.equal(await core.host.waitTag('cue', 0), null);
    assert.equal(core.host.tagReady(wait), true);
    assert.equal(!completed.playing, true, 'The existing auto gate is ready, not held active');
    const emote = new EmoteRuntime(null, { actions: {} }, null),
      pose = {
        model: 'ca',
        face: {
          blinks: [],
          lips: [
            {
              digit: 0,
              code: 0,
              variable: 'mouth',
              levels: [0, 0, 1],
              low: 0,
              high: 100,
              flow: [],
            },
          ],
        },
        codes: [0],
        scaleX: 1,
        scaleY: 1,
        positionX: 0,
        positionY: 0,
        scaleOffsetX: 0,
        scaleOffsetY: 0,
      },
      stage = {
        actors: [{ model: 'authored', visible: true }],
        width: 64,
        height: 48,
        frame: 0,
        place: () => ({ alpha: 255, x: 0, y: 0, scaleX: 100, scaleY: 100 }),
      };
    emote.physics = false;
    emote.pose = () => pose;
    emote.states['0'] = { variables: {}, blinkStart: null, flow: null };
    emote.models.set('ca', {
      resting: () => ({ mouth: 0 }),
      selectorsFor() {},
      baseObject: 'root',
      baseMotion: 'idle',
      objects: { root: { idle: { layers: [], parameters: [], lastTime: 1 } } },
    });
    emote.levelsCache.set('afile.wav', new Float32Array(180).fill(0.5));
    assert.equal(emote.drawing(stage, 0, completed).variables.mouth, 0);
    const saved = core.audio.snapshot();
    cold = new AudioMixer(core.audio.game, next.context, { deferPlayback: true });
    await cold.restore(saved);
    assert.deepEqual(cold.snapshot(), saved);
    assert.equal(cold.voiceInfo().file, 'afile.wav');
    assert.equal(cold.voiceInfo().playing, false);
    cold.activate();
    assert.equal(next.context.sources.length, 0);
    await command(core.audio, 'pcm', [0], 'play', ['high.wav']);
    assert.equal(
      core.audio.voiceInfo().file,
      'high.wav',
      'Active high-level voice wins over completed native metadata',
    );
    context.advance(3);
    assert.equal(core.audio.voiceInfo().file, 'afile.wav');
    await sound.play(3, 1, control);
    context.advance(0.25);
    assert.equal(emote.drawing(stage, 0, core.audio.voiceInfo()).variables.mouth, 0.5);
    sound.pause(3);
    const paused = core.audio.voiceInfo();
    assert.equal(paused.file, 'afile.wav');
    assert.equal(paused.playing, false);
    assert.equal(paused.time, 0.25);
    assert.equal(emote.drawing(stage, 0, paused).variables.mouth, 0);
    await sound.replay(3);
    assert.equal(core.audio.voiceInfo().playing, true);
    sound.stop(3);
    assert.equal(core.audio.voiceInfo().file, 'afile.wav');
    assert.equal(core.audio.voiceInfo().playing, false);
    assert.equal(core.audio.voiceInfo().time, 0);
    assert.equal(emote.drawing(stage, 0, core.audio.voiceInfo()).variables.mouth, 0);
    sound.release(3);
    assert.deepEqual(core.audio.voiceInfo(), {});
    await core.dispose();
    core = null;
    assert.equal(cold.voiceInfo().file, 'afile.wav');
    assert.equal(cold.voiceInfo().playing, false);
  } finally {
    await cold?.dispose();
    await core?.dispose();
    environment.restore();
  }
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`native allocated voice follows its configured PART group without changing gain (${profile})`, async () => {
    const environment = startupEnvironment(),
      context = fixture().context,
      nextContext = fixture().context;
    let core, cold;
    try {
      const tag = new Uint8Array(24);
      tag.set(new TextEncoder().encode('cue'));
      new DataView(tag.buffer).setUint32(20, 1500, true);
      const game = await ordinaryStartupGame(profile, {
          startup: '<INT><int02><name>tag</name><ext>tag</ext></int02></INT>',
          files: {
            'ordinary-line.wav': new Uint8Array([1]),
            'ordinary-line.tag': tag,
            'other-track.wav': new Uint8Array([2]),
            'voice-spelled-effect.wav': new Uint8Array([3]),
            'sound.xml': startupXML(
              profile,
              `<MASTER><volume>0</volume><mute>1</mute></MASTER>
              <PART>
                <words><type>voice</type><group>97</group></words>
                <ambience><type>bgm</type><group>81</group></ambience>
                <effects><type>se</type><group>65</group></effects>
                <prompts><type>sysvoice</type><group>50</group></prompts>
              </PART>
              <SOUNDGROUP>
                <one><id>97</id><min>9</min><max>10</max></one>
                <two><id>81</id><min>4</min><max>4</max></two>
                <three><id>65</id><min>5</min><max>5</max></three>
                <four><id>50</id><min>6</min><max>6</max></four>
              </SOUNDGROUP>`,
            ),
          },
        }),
        make = (audioContext) =>
          new CatSystem2({
            game,
            canvas: new StartupCanvas(),
            audioContext,
            nativeProfile: profile,
            randomSeed: 17,
            transitionalExe: {
              open() {
                throw new Error('Unexpected original CPU');
              },
            },
          });
      core = make(context);
      await core.initialize();
      const send = (owner, id, w = 0, packet = null) =>
          owner.world.sound
            .primary()
            .message(
              [
                owner.world.nativeTaskID(owner.world.main.id),
                mapABIMessage(profile, 'sound', 'raw', id),
                w,
                0,
              ],
              packet ? { payload: packet } : {},
            ),
        load = async (owner, id, group, file) => {
          const packet = new NativeSoundPacket([], 288);
          packet.store(4, group);
          packet.store(8, group);
          packet.writeString(file, 12);
          return send(owner, id, 0, packet);
        };
      // SOUNDGROUP names and IDs are not voice enums. The PART relationship is explicit.
      assert.equal(core.world.sound.primary().groups.get(97).type, '');
      core.audio.setGroup('voice', 0);
      core.world.sound.master = 50;
      const bank = await load(core, 205, 97, 'ordinary-line.wav');
      assert.equal(bank, 9);
      core.world.sound.setVolume(bank, 50);
      await core.world.sound.play(bank, 1, core.world.sound.primary().controls[bank]);
      assert.equal(core.audio.voiceInfo().file, 'ordinary-line.wav');
      assert.deepEqual(core.audio.voiceInfo().tags, { cue: 1.5 });
      assert.equal(core.audio.voiceInfo().envelope[0], 0.25);
      assert.equal(core.audio.channels.get('native:9').group, 'native');
      assert.equal(core.audio.channels.get('native:9').nativeCategory, 'voice');
      // 50 * native factor 50 is 25 percent, or -2000 hundredths of a dB.
      const nativeVoice = core.audio.channels.get('native:9'),
        source = nativeVoice.source;
      assert.equal(nativeVoice.gain.gain.value, 0.1);
      await core.world.fesConfiguration.set('mute_master', 1);
      assert.equal(nativeVoice.gain.gain.value, 0);
      assert.equal(nativeVoice.source, source);
      context.advance(0.0625);
      assert.equal(core.audio.voiceInfo().time, 0.0625);
      await core.world.fesConfiguration.set('mute_master', 0);
      assert.equal(nativeVoice.gain.gain.value, 0.1);
      assert.equal(nativeVoice.source, source);
      core.world.sound.master = 0;
      core.world.sound.refresh(bank);
      assert.equal(core.audio.channels.get('native:9').gain.gain.value, 0.00001);
      core.world.sound.master = 50;
      core.world.sound.refresh(bank);
      for (const group of [81, 65, 50]) {
        const other = await load(core, 205, group, 'voice-spelled-effect.wav');
        await core.world.sound.play(other, 1, core.world.sound.primary().controls[other]);
        assert.equal(core.audio.voiceInfo().file, 'ordinary-line.wav');
      }
      assert.equal(await core.world.sound.load(20, 'voice-spelled-effect.wav', 1), true);
      await core.world.sound.play(20, 1, {});
      assert.equal(core.audio.voiceInfo().file, 'ordinary-line.wav');
      // Both explicit-group and type-selected allocation, for stream and static loads.
      for (const id of [206, 207, 208]) {
        const nextBank = await load(core, id, 97, 'ordinary-line.wav');
        await core.world.sound.play(nextBank, 1, core.world.sound.primary().controls[nextBank]);
        assert.equal(core.audio.channels.get(`native:${nextBank}`).nativeCategory, 'voice');
      }
      const high = await command(core.audio, 'pcm', [3], 'play', ['other-track.wav']);
      assert.equal(high.banks[0].bank, 3);
      assert.equal(core.audio.voiceInfo().file, 'other-track.wav');
      assert.equal(core.audio.channels.get('pcm:3').gain.gain.value, 0.00001);
      await core.world.sound.play(bank, 1, core.world.sound.primary().controls[bank]);
      assert.equal(core.audio.voiceInfo().file, 'ordinary-line.wav');
      context.advance(0.125);
      const saved = await core.snapshot(),
        replay = { step: 0, tick: 0, scheduler: 0, native: 0, random: 0 };
      cold = make(nextContext);
      const create = cold.createNativeWorld,
        step = cold.step;
      cold.step = function (...args) {
        replay.step++;
        return step.apply(this, args);
      };
      cold.createNativeWorld = function (...args) {
        const world = create.apply(this, args);
        for (const [object, name, field] of [
          [world, 'tick', 'tick'],
          [world.runtime.scheduler, 'execute', 'scheduler'],
          [world.runtime, 'native', 'native'],
          [world.random.integer, 'nextUint32', 'random'],
          [world.random.real, 'nextUint32', 'random'],
        ]) {
          const original = object[name];
          object[name] = function (...parameters) {
            replay[field]++;
            return original.apply(this, parameters);
          };
        }
        return world;
      };
      await cold.initialize({ checkpoint: saved });
      assert.deepEqual(await cold.snapshot(), saved);
      assert.deepEqual(replay, { step: 0, tick: 0, scheduler: 0, native: 0, random: 0 });
      assert.equal(cold.audio.voiceInfo().file, 'ordinary-line.wav');
      assert.deepEqual(cold.audio.voiceInfo().tags, { cue: 1.5 });
      assert.equal(cold.audio.voiceInfo().time, 0.125);
      assert.equal(
        nextContext.sources.length,
        saved.audio.channels.filter((channel) => !channel.paused && !channel.ended).length,
      );
      await core.dispose();
      core = null;
      assert.equal(cold.audio.voiceInfo().file, 'ordinary-line.wav');
      await cold.world.sound.play(bank, 1, cold.world.sound.primary().controls[bank]);
      assert.equal(cold.audio.channels.get('native:9').sequence, saved.audio.sequence);
      assert.equal(cold.audio.voiceInfo().time, 0);
      assert.equal(cold.audio.channels.get('native:9').gain.gain.value, 0.1);
    } finally {
      await cold?.dispose();
      await core?.dispose();
      environment.restore();
    }
  });
}

test('native voice classification follows legacy group types and retained banks, not numeric IDs', async () => {
  const environment = startupEnvironment(),
    context = fixture().context,
    profile = 'nekopara-vol3-engine-2.6.1.76';
  let core;
  try {
    const game = await ordinaryStartupGame(profile, {
      sound: false,
      files: {
        'spoken.wav': new Uint8Array([1]),
        'voice-spelled-effect.wav': new Uint8Array([2]),
      },
      startup:
        '<SOUNDGROUP><group00><id>99</id><type>voice</type><min>17</min><max>18</max></group00><group01><id>98</id><type>unclassified</type><min>4</min><max>4</max></group01></SOUNDGROUP>',
    });
    core = new CatSystem2({
      game,
      canvas: new StartupCanvas(),
      audioContext: context,
      nativeProfile: profile,
      transitionalExe: {
        open() {
          throw new Error('Unexpected original CPU');
        },
      },
    });
    await core.initialize();
    const task = core.world.sound.primary(),
      send = (id, w, l = 0, payload = null) =>
        task.message(
          [core.world.nativeTaskID(core.world.main.id), id, w, l],
          payload ? { payload } : {},
        ),
      load = async (group, file) => {
        const packet = new NativeSoundPacket([], 288);
        packet.store(4, group);
        packet.writeString(file, 12);
        return send(205, 0, 0, packet);
      };
    assert.equal(core.world.soundConfiguration.loaded, false);
    assert.equal(task.groups.get(99).typeCode, 2);
    const voice = await load(99, 'spoken.wav'),
      other = await load(98, 'voice-spelled-effect.wav');
    assert.equal(voice, 17);
    assert.equal(other, 4);
    await send(182, voice, 1);
    await send(182, other, 1);
    assert.equal(core.audio.voiceInfo().file, 'spoken.wav');
    assert.equal(core.audio.channels.get('native:4').nativeCategory, null);
    await send(223, voice, other);
    assert.equal(core.audio.channels.get('native:4').nativeCategory, 'voice');
    assert.equal(core.world.sound.device[4].category, 'voice');
    assert.equal(core.audio.channels.get('native:17').nativeCategory, null);
    assert.equal(core.audio.voiceInfo().file, 'spoken.wav');
    await send(203, 41, 0, new NativeSoundPacket([2, 20, 21, 100]));
    const dynamic = await load(41, 'spoken.wav');
    assert.equal(dynamic, 20);
    await send(182, dynamic, 1);
    assert.equal(core.audio.channels.get('native:20').nativeCategory, 'voice');
    await send(184, dynamic);
    assert.equal(core.audio.voiceInfo().file, 'spoken.wav');
    await send(181, dynamic);
    // The fade reaches zero in ten frames; the following bookkeeping releases it.
    for (let frame = 0; frame < 10; frame++) await task.tick(task.frame + 1);
    assert.equal(core.world.sound.device[20].category, 'voice');
    await task.tick(task.frame + 1);
    assert.equal(core.world.sound.device[20].category, null);
    assert.equal(core.audio.channels.has('native:20'), false);
    assert.equal(await core.world.sound.load(20, 'voice-spelled-effect.wav', 1), true);
    await core.world.sound.play(20, 1, {});
    assert.equal(core.audio.channels.get('native:20').nativeCategory, null);
    assert.equal(core.audio.voiceInfo().file, 'spoken.wav');
    const saved = core.world.sound.snapshot(),
      invalid = structuredClone(saved);
    invalid.device[0].category = 'unreviewed-role';
    await assert.rejects(core.world.sound.restore(invalid), /playback category/);
    assert.deepEqual(core.world.sound.snapshot(), saved);
    const inconsistent = structuredClone(saved);
    inconsistent.channels[4].nativeCategory = 'se';
    await assert.rejects(core.world.sound.restore(inconsistent), /playback category/);
    assert.deepEqual(core.world.sound.snapshot(), saved);
  } finally {
    await core?.dispose();
    environment.restore();
  }
});

test('native PART group classification leaves absent and conflicting roles unclassified', async () => {
  const environment = startupEnvironment(),
    context = fixture().context,
    profile = 'nekopara-vol3-engine-2.6.1.76';
  let core;
  try {
    const game = await ordinaryStartupGame(profile, {
      files: {
        'voice-spelled-effect.wav': new Uint8Array([1]),
        'sound.xml': startupXML(
          profile,
          `<PART><words><type>voice</type><group>97</group></words>
          <other><type>bgm</type><group>97</group></other>
          <parallelVoice><type>voice</type><group>72</group></parallelVoice>
          <parallelUnknown><type>custom</type><group>72</group></parallelUnknown>
          <explicitVoice><type>voice</type><group>3</group></explicitVoice>
          <ancestor><type>voice</type><group>91</group><part>
            <speaker><type>custom-speaker</type><part><variant><type>custom-variant</type></variant></part></speaker>
          </part></ancestor>
          <conflict><type>voice</type><group>92</group><part>
            <effect><type>se</type></effect>
          </part></conflict></PART>
          <SOUNDGROUP><one><id>97</id><min>9</min><max>9</max></one>
          <two><id>2</id><min>3</min><max>3</max></two>
          <three><id>72</id><min>4</min><max>4</max></three>
          <four><id>3</id><type>custom</type><min>5</min><max>5</max></four>
          <five><id>91</id><min>6</min><max>6</max></five>
          <six><id>92</id><min>7</min><max>7</max></six></SOUNDGROUP>`,
        ),
      },
    });
    core = new CatSystem2({
      game,
      canvas: new StartupCanvas(),
      audioContext: context,
      nativeProfile: profile,
      transitionalExe: {
        open() {
          throw new Error('Unexpected original CPU');
        },
      },
    });
    await core.initialize();
    const task = core.world.sound.primary();
    for (const group of [97, 2, 72, 3, 92]) {
      const packet = new NativeSoundPacket([], 288);
      packet.store(4, group);
      packet.writeString('voice-spelled-effect.wav', 12);
      const bank = await task.message([core.world.nativeTaskID(core.world.main.id), 205, 0, 0], {
        payload: packet,
      });
      await core.world.sound.play(bank, 1, task.controls[bank]);
      assert.equal(core.audio.channels.get(`native:${bank}`).nativeCategory, null);
      assert.deepEqual(core.audio.voiceInfo(), {});
    }
    const packet = new NativeSoundPacket([], 288);
    packet.store(4, 91);
    packet.writeString('voice-spelled-effect.wav', 12);
    const bank = await task.message([core.world.nativeTaskID(core.world.main.id), 205, 0, 0], {
      payload: packet,
    });
    await core.world.sound.play(bank, 1, task.controls[bank]);
    assert.equal(core.audio.channels.get(`native:${bank}`).nativeCategory, 'voice');
    assert.equal(core.audio.voiceInfo().file, 'voice-spelled-effect.wav');
  } finally {
    await core?.dispose();
    environment.restore();
  }
});

test('audio category and tag checkpoint preflight preserves the live owner on invalid data', async () => {
  const { mixer, context } = fixture();
  try {
    await mixer.play({
      channel: 'native:3',
      bank: 3,
      file: 'ordinary-line',
      group: 'native',
      nativeCategory: 'voice',
      tags: { cue: 1.5 },
    });
    const saved = mixer.snapshot(),
      channel = mixer.channels.get('native:3'),
      starts = context.sources.length;
    for (const mutate of [
      (value) => (value.nativeCategory = 'unreviewed-role'),
      (value) => (value.nativeCategory = undefined),
      (value) => (value.tags = new Map([['cue', 1.5]])),
      (value) => (value.tags = new Date(1500)),
      (value) => (value.tags = new Set([1.5])),
      (value) => (value.tags = []),
      (value) => (value.tags = null),
      (value) => (value.tags = { cue: NaN }),
      (value) => (value.tags = { cue: Infinity }),
      (value) => (value.tags = { cue: -1 }),
      (value) => (value.tags = { cue: 4294967.296 }),
      (value) => (value.tags = { cue: '1.5' }),
    ]) {
      const invalid = structuredClone(saved);
      mutate(invalid.channels[0]);
      await assert.rejects(mixer.restore(invalid), /playback category|voice tags/);
      assert.strictEqual(mixer.channels.get('native:3'), channel);
      assert.equal(context.sources.length, starts);
      assert.deepEqual(mixer.snapshot(), saved);
    }
  } finally {
    await mixer.dispose();
  }
});

test('CST audio allocates independent PCM banks and reports actual completion', async () => {
  const { context, mixer } = fixture();
  const a = await command(mixer, 'pcm', null, 'play', ['voice-a']);
  const b = await command(mixer, 'pcm', null, 'play', ['voice-b']);
  assert.equal(a.banks[0].bank, 0);
  assert.equal(b.banks[0].bank, 1);
  assert.equal(mixer.channels.size, 2);
  assert.equal(mixer.voiceInfo().file, 'voice-b');
  context.advance(2.1);
  assert.equal(mixer.voiceInfo().playing, undefined);
  assert.deepEqual(
    mixer.events.map((event) => event.channel),
    ['pcm:0', 'pcm:1'],
  );
  const next = await command(mixer, 'pcm', null, 'play', ['voice-c']);
  assert.equal(next.banks[0].bank, 0);
});

test('native 3D position, distances and velocity drive output nodes and preserve a changing-rate playhead', async () => {
  const { mixer, context } = fixture(),
    key = 'native:0';
  context.decodeAudioData = async () => ({
    duration: 2,
    sampleRate: 8000,
    numberOfChannels: 1,
    length: 16000,
    getChannelData: () => new Float32Array(16000).fill(0.25),
  });
  await mixer.play({
    channel: key,
    file: 'moving',
    loopCount: 0,
    nativeSpatial: {
      enabled: true,
      position: [10, 20, 100],
      velocity: [0, 0, 0],
      minimumDistance: 50,
      maximumDistance: 200,
      dopplerFactor: 1,
    },
  });
  const c = mixer.channels.get(key);
  assert.deepEqual(
    [c.spatialNode.positionX.value, c.spatialNode.positionY.value, c.spatialNode.positionZ.value],
    [10, 20, -100],
  );
  assert.equal(c.spatialNode.refDistance, 50);
  assert.equal(c.spatialNode.maxDistance, 200);
  context.advance(0.5);
  mixer.setNativeSpatial(key, { position: [0, 0, 100], velocity: [0, 0, -171.65] });
  assert.equal(c.source.playbackRate.value, 2);
  context.advance(0.5);
  assert.equal(mixer.position(c), 1.5);
  mixer.pause(key);
  context.advance(3);
  await mixer.replay(key);
  assert.equal(c.source.playbackRate.value, 2);
  assert.equal(mixer.position(c), 1.5);
  context.advance(0.1);
  assert.ok(Math.abs(mixer.position(c) - 1.7) < 1e-10);
  mixer.setNativeSpatial(key, { dopplerFactor: 0 });
  assert.equal(c.source.playbackRate.value, 1);
});

test('native bank swap keeps live sources, their activity rings and their playheads', async () => {
  const { mixer, context } = fixture();
  await mixer.play({ channel: 'native:0', file: 'first', loopCount: 0 });
  await mixer.play({ channel: 'native:1', file: 'second', loopCount: 0 });
  const first = mixer.channels.get('native:0'),
    second = mixer.channels.get('native:1'),
    a = first.source,
    b = second.source;
  context.advance(0.75);
  mixer.swapNativeBanks('native:0', 'native:1');
  assert.equal(mixer.channels.get('native:1'), first);
  assert.equal(mixer.channels.get('native:0'), second);
  assert.equal(first.source, a);
  assert.equal(second.source, b);
  context.advance(0.25);
  mixer.pause('native:1');
  assert.equal(first.offset, 1);
  assert.equal(a.stopped, true);
  assert.equal(b.stopped, false);
});

test('native dynamic loop points keep 22050-Hz units and loop table duplicate records retain their first end', async () => {
  const { mixer } = fixture(),
    wav = new Uint8Array(44),
    view = new DataView(wav.buffer);
  wav.set(new TextEncoder().encode('RIFF'), 0);
  wav.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint32(24, 22050, true);
  wav.set(new TextEncoder().encode('data'), 36);
  mixer.game.require = async () => wav;
  mixer.loadLoopPoints(new TextEncoder().encode('music 22050 66150\r\nMUSIC 11025 88200\r\n'));
  assert.deepEqual(mixer.loopPoints.get('music'), { file: 'music', start: 11025n, end: 66150n });
  await mixer.play({ channel: 'native:0', file: 'music', loopCount: 0 });
  assert.equal(mixer.channels.get('native:0').loopStart, 5512 / 22050);
  mixer.setNativeLoop('native:0', { loopCount: 2, loopStartFrame: 22050n, loopEndFrame: 44100n });
  assert.equal(mixer.channels.get('native:0').source.loopStart, 1);
  assert.equal(mixer.channels.get('native:0').source.loopEnd, 2);
  const restored = fixture();
  restored.mixer.game.require = async () => wav;
  await restored.mixer.restore(structuredClone(mixer.snapshot()));
  assert.equal(restored.mixer.channels.get('native:0').source.loopStart, 1);
});

test('CST audio pause/replay preserves the playhead and cancels its detached source', async () => {
  const { context, mixer } = fixture();
  await command(mixer, 'bgm', [2], 'play', ['music']);
  const source = mixer.channels.get('bgm:2').source;
  assert.equal(source.loop, true);
  context.advance(0.75);
  await command(mixer, 'bgm', [2], 'pause');
  assert.equal(source.stopped, true);
  assert.equal(mixer.channels.get('bgm:2').paused, true);
  context.advance(5);
  await command(mixer, 'bgm', [2], 'replay');
  assert.equal(mixer.channels.get('bgm:2').source.offset, 0.75);
  context.advance(0.25);
  assert.equal(mixer.position(mixer.channels.get('bgm:2')), 1);
});

test('CST audio delay survives pausing before playback begins', async () => {
  const { context, mixer } = fixture();
  await command(mixer, 'se', [0], 'play', ['sound', '-50', '60']);
  context.advance(0.25);
  await command(mixer, 'se', [0], 'pause');
  assert.equal(mixer.channels.get('se:0').remainingDelay, 45);
  context.advance(2);
  await command(mixer, 'se', [0], 'replay');
  assert.equal(mixer.channels.get('se:0').scheduled, 3);
  assert.equal(mixer.position(mixer.channels.get('se:0')), 0);
  assert.equal(mixer.channels.get('se:0').panLeft.gain.value, 1);
  assert.equal(mixer.channels.get('se:0').panRight.gain.value, 10 ** (-1000 / 2000));
});

test('CST audio fade continues at volume zero; end resets the bank at its last frame', async () => {
  const { mixer } = fixture();
  await command(mixer, 'bgm', [0], 'play', ['music']);
  await command(mixer, 'bgm', [0], 'fade', ['60', '100', '0']);
  mixer.setFrame(30);
  assert.equal(mixer.channels.get('bgm:0').volume, 50);
  const saved = structuredClone(mixer.snapshot());
  const restored = fixture().mixer;
  await restored.restore(saved);
  restored.setFrame(60);
  assert.equal(restored.channels.get('bgm:0').volume, 0);
  assert.equal(restored.channels.get('bgm:0').playing, true);
  await command(restored, 'bgm', [0], 'vol', ['80']);
  await command(restored, 'bgm', [0], 'end');
  restored.setFrame(75);
  assert.equal(restored.channels.get('bgm:0').volume, 40);
  restored.setFrame(90);
  assert.equal(restored.channels.has('bgm:0'), false);
  assert.equal(restored.events.at(-1).reason, 'fade-ended');
});

test('CST volume before playback applies within its frame and expires after a wait', async () => {
  const { mixer } = fixture();
  mixer.setFrame(5);
  await command(mixer, 'se', null, 'vol', ['20']);
  await command(mixer, 'se', [0], 'play', ['a']);
  await command(mixer, 'se', [1], 'play', ['b']);
  assert.equal(mixer.channels.get('se:0').volume, 20);
  assert.equal(mixer.channels.get('se:1').volume, 20);
  mixer.setFrame(6);
  await command(mixer, 'se', [2], 'play', ['c']);
  assert.equal(mixer.channels.get('se:2').volume, 100);
  assert.equal((await command(mixer, 'se', [0], 'move', ['30', '100'])).handled, false);
});

test('audio uses the native DirectSound attenuation curve after integer configuration composition', async () => {
  const { mixer } = fixture();
  await command(mixer, 'se', [0], 'play', ['sound']);
  await command(mixer, 'se', [0], 'vol', ['50']);
  const c = mixer.channels.get('se:0');
  assert.equal(c.gain.gain.value, 10 ** (-1000 / 2000));
  mixer.soundConfiguration = { master: {}, effectiveVolume: () => 50 };
  mixer.refresh();
  assert.equal(c.gain.gain.value, 10 ** (-2000 / 2000));
  await command(mixer, 'se', [0], 'vol', ['0']);
  assert.equal(c.gain.gain.value, 0.00001);
});

test('audio reserves pending decode banks and preserves same-frame pause and volume commands', async () => {
  const { mixer, context } = fixture();
  let resolveDecode;
  const normalDecode = context.decodeAudioData;
  context.decodeAudioData = () =>
    new Promise((resolve) => {
      resolveDecode = resolve;
    });
  const pending = command(mixer, 'se', null, 'play', ['a']);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(mixer.channels.get('se:0').loading, true);
  await command(mixer, 'se', [0], 'pause');
  await command(mixer, 'se', [0], 'vol', ['50']);
  resolveDecode(await normalDecode());
  await pending;
  assert.equal(context.sources.length, 0);
  assert.equal(mixer.channels.get('se:0').paused, true);
  await command(mixer, 'se', [0], 'replay');
  assert.equal(context.sources.length, 1);
  assert.equal(mixer.channels.get('se:0').gain.gain.value, 10 ** (-1000 / 2000));
});

test('loop points retain the source sample rate across browser resampling and survive restore', async () => {
  const { mixer, context } = fixture();
  const wav = new Uint8Array(44),
    view = new DataView(wav.buffer);
  wav.set(new TextEncoder().encode('RIFF'), 0);
  wav.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint32(24, 22050, true);
  wav.set(new TextEncoder().encode('data'), 36);
  mixer.game.require = async () => wav;
  mixer.loadLoopPoints(new TextEncoder().encode('music 22050 66150\r\n'));
  await command(mixer, 'bgm', [0], 'play', ['music']);
  const c = mixer.channels.get('bgm:0');
  assert.equal(c.source.loopStart, 0.5);
  assert.equal(c.source.loopEnd, 1.5);
  context.advance(1.75);
  assert.equal(mixer.position(c), 0.75);
  await command(mixer, 'bgm', [0], 'pause');
  const saved = mixer.snapshot(),
    next = fixture();
  next.mixer.game.require = async () => wav;
  await next.mixer.restore(structuredClone(saved));
  assert.equal(next.mixer.channels.get('bgm:0').offset, 0.75);
  await command(next.mixer, 'bgm', [0], 'replay');
  assert.equal(next.mixer.channels.get('bgm:0').source.loopStart, 0.5);
});

test('native finite loop counts, explicit points and paused restore keep the remaining playback duration', async () => {
  const { mixer, context } = fixture();
  await mixer.play({
    channel: 'native:2:0',
    file: 'music',
    volume: 100,
    volumeFactor: 100,
    loopCount: 3,
    loopStartFrame: 30n,
    loopEndFrame: 90n,
  });
  const c = mixer.channels.get('native:2:0');
  assert.equal(c.source.loopStart, 0.5);
  assert.equal(c.source.loopEnd, 1.5);
  assert.equal(c.source.stopWhen, 3.5);
  context.advance(1.75);
  mixer.pause('native:2:0');
  assert.equal(c.offset, 0.75);
  assert.equal(c.remainingDuration, 1.75);
  const next = fixture();
  await next.mixer.restore(structuredClone(mixer.snapshot()));
  await next.mixer.replay('native:2:0');
  assert.equal(next.mixer.channels.get('native:2:0').source.stopWhen, 1.75);
  next.context.advance(1.8);
  assert.equal(next.mixer.channels.get('native:2:0').ended, true);
});

test('audio checkpoint banks and cursor components share one context clock sample', async () => {
  const { context, mixer } = fixture();
  await mixer.play({ channel: 'native:0', file: 'first', loopCount: 1, offset: 0.25 });
  await mixer.play({ channel: 'native:1', file: 'second', loopCount: 1, offset: 0.125 });
  let reads = 0;
  Object.defineProperty(context, 'currentTime', {
    configurable: true,
    get: () => 0.375 + reads++ / 64,
  });
  const saved = mixer.snapshot();
  assert.equal(reads, 1, 'A checkpoint must sample the audio clock only once across all banks');
  for (const [index, offset, remaining] of [
    [0, 0.625, 1.375],
    [1, 0.5, 1.5],
  ]) {
    assert.equal(saved.channels[index].offset, offset);
    assert.equal(saved.channels[index].remainingDuration, remaining);
    assert.equal(saved.channels[index].pcmState.progress, offset);
  }
});

test('Core native-bank cold restore preserves complete playback chronology without guest execution', async () => {
  const environment = startupEnvironment(),
    oldContext = fixture().context,
    coldContext = fixture().context,
    profile = 'nekopara-vol3-engine-2.6.1.76';
  let core, cold;
  const play = AudioMixer.prototype.play,
    trace = [],
    owners = new Map();
  let restoring = false;
  AudioMixer.prototype.play = function (...args) {
    if (!restoring) return play.apply(this, args);
    if (!owners.has(this)) owners.set(this, owners.size);
    const entry = {
      owner: owners.get(this),
      bank: args[0].bank,
      beforeSequence: this.sequence,
      deferPlayback: this.deferPlayback,
    };
    trace.push(entry);
    const result = play.apply(this, args);
    result.then(() => {
      entry.afterSequence = this.sequence;
      entry.channels = this.channels.size;
    });
    return result;
  };
  try {
    const game = await ordinaryStartupGame(profile, {
      sound: false,
      files: { 'first.wav': new Uint8Array([1]), 'second.wav': new Uint8Array([2]) },
    });
    const make = (context) =>
      new CatSystem2({
        game,
        canvas: new StartupCanvas(),
        audioContext: context,
        nativeProfile: profile,
        randomSeed: 17,
        transitionalExe: {
          open() {
            throw new Error('Unexpected original CPU');
          },
        },
      });
    core = make(oldContext);
    await core.initialize();
    for (const [bank, file] of [
      [0, 'first.wav'],
      [16, 'second.wav'],
    ]) {
      assert.equal(await core.world.sound.load(bank, file, 1), true);
      assert.equal(await core.world.sound.play(bank, 1, {}), true);
    }
    // A later play in an existing bank must remain distinct from first insertion.
    assert.equal(await core.world.sound.play(0, 1, {}), true);
    core.world.sound.swap(0, 16);
    oldContext.advance(0.25);
    const saved = await core.snapshot();
    assert.deepEqual(
      saved.audio.channels.map((channel) => channel.channel),
      ['native:0', 'native:16'],
    );
    cold = make(coldContext);
    const create = cold.createNativeWorld,
      replay = { tick: 0, scheduler: 0, native: 0, random: 0 };
    cold.createNativeWorld = function (...args) {
      const world = create.apply(this, args);
      for (const [object, name, field] of [
        [world, 'tick', 'tick'],
        [world.runtime.scheduler, 'execute', 'scheduler'],
        [world.runtime, 'native', 'native'],
        [world.random.integer, 'nextUint32', 'random'],
        [world.random.real, 'nextUint32', 'random'],
      ]) {
        const original = object[name];
        object[name] = function (...parameters) {
          if (restoring) replay[field]++;
          return original.apply(this, parameters);
        };
      }
      return world;
    };
    restoring = true;
    try {
      await cold.initialize({ checkpoint: saved });
    } finally {
      restoring = false;
    }
    const current = await cold.snapshot();
    console.log(
      JSON.stringify({
        kind: 'owned-native-bank-cold-witness',
        savedSequence: saved.audio.sequence,
        currentSequence: current.audio.sequence,
        restoredBanks: [...cold.audio.channels.values()].map((channel) => channel.bank),
        sourceStarts: coldContext.sources.length,
        liveSources: coldContext.sources.filter((source) => !source.stopped).length,
        trace,
        replay,
      }),
    );
    assert.deepEqual(replay, { tick: 0, scheduler: 0, native: 0, random: 0 });
    assert.equal(coldContext.sources.length, 2);
    assert.equal(new Set(cold.audio.channels.keys()).size, 2);
    assert.deepEqual(current.world, saved.world);
    assert.deepEqual(current, saved);
    assert.equal(cold.audio.sequence, saved.audio.sequence);
    assert.deepEqual(
      [...cold.audio.channels.values()].map((channel) => channel.sequence),
      [1, 2],
    );
    assert.equal(await cold.world.sound.play(16, 1, {}), true);
    assert.equal(cold.audio.channels.get('native:16').sequence, saved.audio.sequence);
    assert.equal(cold.audio.sequence, saved.audio.sequence + 1);
    assert.equal(core.world.closed, undefined);
    await core.dispose();
    core = null;
    assert.equal(cold.world.closed, undefined);
    assert.equal(cold.audio.channels.size, 2);
  } finally {
    restoring = false;
    AudioMixer.prototype.play = play;
    await cold?.dispose();
    await core?.dispose();
    environment.restore();
  }
});

test('restored voice chronology keeps the next real play newer than retained channels', async () => {
  const { mixer, context } = fixture(),
    next = fixture();
  let cold;
  try {
    await command(mixer, 'pcm', [0], 'play', ['voice-first']);
    await command(mixer, 'pcm', [1], 'play', ['voice-second']);
    await command(mixer, 'se', [0], 'play', ['discarded-effect']);
    mixer.stop('se:0');
    await command(mixer, 'pcm', [0], 'play', ['voice-latest']);
    context.advance(0.25);
    const saved = mixer.snapshot();
    assert.equal(saved.sequence, 4);
    assert.deepEqual(
      [...mixer.channels.values()].map((channel) => channel.sequence),
      [1, 3],
    );
    cold = new AudioMixer(mixer.game, next.context, { deferPlayback: true });
    await cold.restore(saved);
    assert.deepEqual(cold.snapshot(), saved);
    assert.equal(cold.voiceInfo().file, 'voice-latest');
    assert.equal(next.context.sources.length, 0);
    cold.activate();
    assert.equal(next.context.sources.length, 2);
    cold.activate();
    assert.equal(next.context.sources.length, 2);
    await command(cold, 'pcm', [2], 'play', ['voice-after-restore']);
    assert.equal(cold.voiceInfo().file, 'voice-after-restore');
    assert.equal(cold.channels.get('pcm:2').sequence, saved.sequence);
    assert.equal(cold.sequence, saved.sequence + 1);
    await mixer.dispose();
    assert.equal(cold.channels.size, 3);
    next.context.advance(0.125);
    assert.equal(cold.voiceInfo().time, 0.125);
  } finally {
    await cold?.dispose();
  }
});

test('Core cold audio keeps one checkpoint projection and resumes the actual source once', async () => {
  const environment = startupEnvironment(),
    { context } = fixture();
  let core;
  try {
    const game = await ordinaryStartupGame('sdk-4.01-engine-2.6.1.74', {
      sound: false,
      files: { 'cue.wav': new Uint8Array([1]) },
    });
    core = new CatSystem2({
      game,
      canvas: new StartupCanvas(),
      audioContext: context,
      nativeProfile: 'sdk-4.01-engine-2.6.1.74',
      randomSeed: 17,
      transitionalExe: {
        open() {
          throw new Error('Unexpected original CPU');
        },
      },
    });
    await core.initialize();
    const previous = core.world;
    assert.equal(await previous.sound.load(0, 'cue.wav', 1), true);
    assert.equal(await previous.sound.play(0, 1, {}), true);
    context.advance(0.375);
    const objectsSnapshot = previous.objects.snapshot;
    previous.objects.snapshot = function (...args) {
      context.advance(0.25);
      return objectsSnapshot.apply(this, args);
    };
    const saved = await core.snapshot(),
      native = saved.audio.channels.find((c) => c.channel === 'native:0');
    assert.deepEqual(
      native,
      saved.world.sound.channels[0],
      'Core and World must save the same actual bank cursor',
    );
    assert.equal(native.offset, 0.375);
    const starts = context.sources.length;
    await core.restore(saved);
    assert.equal(
      context.sources.length,
      starts + 1,
      'Staged decoding must not start an extra source',
    );
    assert.equal(core.world.frame, saved.world.frame);
    assert.notEqual(core.world, previous);
    assert.equal(previous.closed, true);
    assert.deepEqual(core.world.snapshot(), saved.world);
    assert.equal(core.audio.channels.get('native:0').source.offset, native.offset);
    context.advance(0.125);
    const live = core.audio.channelState('native:0', core.audio.channels.get('native:0'));
    assert.equal(live.offset, 0.5, 'Real playback must continue on the media clock after restore');
    assert.equal(live.remainingDuration, native.remainingDuration - 0.125);
    // Seek owns the real source and PCM origin; snapshot sampling must not pin it.
    await core.audio.seek('native:0', 0.75);
    const channel = core.audio.channels.get('native:0'),
      seeked = core.audio.channelState('native:0', channel);
    assert.equal(channel.source.offset, 0.75);
    assert.equal(seeked.offset, 0.75);
    assert.equal(seeked.remainingDuration, 1.25);
    assert.equal(seeked.pcmState.origin, 0.75);
    assert.equal(seeked.pcmState.progress, 0);
    context.advance(0.125);
    core.audio.pause('native:0');
    const paused = core.audio.snapshot();
    assert.equal(paused.channels[0].offset, 0.875);
    assert.equal(paused.channels[0].remainingDuration, 1.125);
    context.advance(0.25);
    assert.deepEqual(core.audio.snapshot(), paused);
    await core.audio.replay('native:0');
    assert.equal(core.audio.channels.get('native:0'), channel);
    context.advance(0.125);
    const resumed = core.audio.snapshot().channels[0];
    assert.equal(resumed.offset, 1);
    assert.equal(resumed.remainingDuration, 1);
  } finally {
    await core?.dispose();
    environment.restore();
  }
});
