// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioMixer } from '../src/audio.mjs';

function fixture() {
  const context = {
    currentTime: 0,
    state: 'running',
    sources: [],
    destination: {},
    decodeAudioData: async () => ({
      duration: 2,
      sampleRate: 60,
      numberOfChannels: 1,
      length: 120,
      getChannelData: () => new Float32Array(120).fill(0.25),
    }),
    createBufferSource() {
      const node = {
        loop: false,
        onended: null,
        stopped: false,
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
    createStereoPanner: () => ({ connect() {}, disconnect() {}, pan: { value: 0 } }),
    createChannelSplitter: () => ({ connect() {}, disconnect() {} }),
    createChannelMerger: () => ({ connect() {}, disconnect() {} }),
    createPanner: () => ({
      connect() {},
      disconnect() {},
      ...Object.fromEntries(
        ['positionX', 'positionY', 'positionZ'].map((key) => [
          key,
          {
            value: 0,
            setValueAtTime(value) {
              this.value = value;
            },
          },
        ]),
      ),
    }),
    advance(seconds) {
      this.currentTime += seconds;
      for (const node of this.sources)
        if (
          !node.stopped &&
          ((node.stopWhen !== undefined && this.currentTime >= node.stopWhen) ||
            (!node.loop && this.currentTime >= node.when + node.buffer.duration - node.offset))
        ) {
          node.stopped = true;
          node.onended?.();
        }
    },
    close() {
      this.state = 'closed';
    },
  };
  const game = {
    resolve: (name) => name,
    require: async () => new Uint8Array([1]),
    read: async () => null,
  };
  return { context, mixer: new AudioMixer(game, context) };
}
const command = (mixer, group, banks, verb, args = []) =>
  mixer.command({ group, banks, verb, args });

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
