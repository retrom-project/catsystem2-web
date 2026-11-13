// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
  startupXML,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  filename = 'assets.int/wait-sound-reference.fes',
  sampleRate = 8000,
  sampleCount = sampleRate * 2;

// Actual PCM source bytes, with the existing audio-contracts AudioContext seam.
function wave() {
  const bytes = new Uint8Array(44 + sampleCount * 2),
    view = new DataView(bytes.buffer);
  bytes.set(ascii('RIFF'), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(ascii('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(ascii('data'), 36);
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) view.setInt16(44 + index * 2, 8192, true);
  return bytes;
}
function audioContext() {
  return {
    currentTime: 0,
    state: 'running',
    sources: [],
    destination: {},
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 44 + sampleCount * 2);
      return {
        duration: 2,
        sampleRate,
        numberOfChannels: 1,
        length: sampleCount,
        getChannelData: () => new Float32Array(sampleCount).fill(0.25),
      };
    },
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
}

async function environment(profile, source) {
  const scope = startupEnvironment();
  let player;
  const context = audioContext();
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: true,
        files: {
          'sound.xml': startupXML(
            profile,
            '<MASTER><volume>100</volume><mastervol>100</mastervol><play>1</play><sysplay>1</sysplay><mute>0</mute></MASTER>' +
              '<PART><waitcue><head>cue</head><int>sound</int><volume>100</volume><mastervol>100</mastervol><play>1</play><sysplay>1</sysplay></waitcue></PART>',
          ),
          'assets/wait-sound-reference.fes': source,
          'sounds/cue.wav': wave(),
        },
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>' +
          '<int03><name>sound</name><int>sounds.int</int><ext>wav</ext><dir>sounds</dir></int03>',
      ),
      bytes = new Uint8Array(startup.length + mount.length);
    assert.ok(at >= 0);
    bytes.set(startup.subarray(0, at));
    bytes.set(mount, at);
    bytes.set(startup.subarray(at), at + mount.length);
    const input = new Map(template.input);
    input.set('startup.xml', new BlobFile(new Blob([bytes])));
    const game = new GameFiles(input);
    await game.open();
    player = new CatSystem2({
      game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      randomSeed: 77,
      audioContext: context,
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          throw new Error('Sound wait identity must not open the original');
        },
      },
    });
    await player.initialize();
    const world = player.world,
      parent = world.main;
    assert.equal(world.frame, 1);
    assert.equal(world.runtime.variableBank(parent, false).get(7), 0x12345678);
    world.runtime.stringBank(parent);
    const id = await world.objects.create({ kind: 34, parent: parent.id }),
      surface = await world.objects.create({ kind: 15, parent: parent.id });
    await world.sendEngine(surface, parent.id, 279, 64, 48);
    await world.sendEngine(surface, parent.id, 283);
    await world.sendEngine(id, parent.id, 331, 0, parent.context.variableBank);
    await world.sendEngine(id, parent.id, 334, 0, world.nativeTaskID(surface));
    const task = world.objects.objects.get(id).implementation;
    assert.equal(world.objects.objects.get(id).context.stringBank, parent.context.stringBank);
    return {
      player,
      context,
      world,
      game,
      id,
      task,
      strings: world.runtime.stringBank(parent),
      words: world.runtime.variableBank(parent, false),
      async load() {
        await world.sendEngine(id, parent.id, 332, 0, 0, {
          payload: { string: () => filename },
        });
        assert.ok(task.player.root.runtime instanceof FESCoordinator);
        return task.player.root;
      },
      async close() {
        try {
          await player.dispose();
        } finally {
          scope.restore();
        }
      },
    };
  } catch (error) {
    try {
      await player?.dispose();
    } finally {
      scope.restore();
    }
    throw error;
  }
}

async function freshCheckpoint(t, h, profile) {
  const gpu = h.world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  // Supply the fixture's known CPU frame for the existing checkpoint contract.
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
  const source = h.world.fesSources.snapshot(),
    checkpoint = await h.player.snapshot();
  let restoring = true;
  for (const [prototype, method] of [
    [FESInstance.prototype, 'execute'],
    [FESInstance.prototype, 'expandMacros'],
    [FESCoordinator.prototype, 'initialize'],
    [NativeStringBank.prototype, 'expandBytes'],
    [NativeScriptReplacements.prototype, 'apply'],
    [Object.getPrototypeOf(h.world.fesSound), 'command'],
  ]) {
    const original = prototype[method];
    t.mock.method(prototype, method, function (...args) {
      assert.equal(restoring, false, 'fresh restoration must not replay ' + method);
      return original.apply(this, args);
    });
  }
  const file = h.game.lookup(filename).file,
    read = file.read;
  t.mock.method(file, 'read', function (...args) {
    assert.equal(restoring, false, 'fresh restoration must not reopen the FES');
    return read.apply(this, args);
  });
  const restore = FESPlayer.prototype.restore;
  let waitRestores = 0;
  t.mock.method(FESPlayer.prototype, 'restore', async function (saved) {
    const result = await restore.call(this, saved);
    if (saved.root?.waitSound) {
      waitRestores++;
      assert.deepEqual(this.root.waitSound, saved.root.waitSound);
      assert.notStrictEqual(
        this.root.waitSound.nameBytes.buffer,
        saved.root.waitSound.nameBytes.buffer,
      );
    }
    return result;
  });
  const context = audioContext(),
    player = new CatSystem2({
      game: h.game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      audioContext: context,
      transitionalExe: {
        open() {
          throw new Error('No original wait-sound-reference restore');
        },
      },
    });
  try {
    await player.initialize({ checkpoint });
  } catch (error) {
    await player.dispose();
    throw error;
  } finally {
    restoring = false;
  }
  assert.equal(waitRestores, 1);
  assert.deepEqual(player.world.fesSources.snapshot(), source);
  assert.equal(player.world.nativeEngine, undefined);
  return { player, context };
}

const firstName = Uint8Array.of(114, 0x81),
  secondName = Uint8Array.of(114, 0x82),
  join = (...parts) => Uint8Array.from(parts.flatMap((bytes) => [...bytes])),
  target = join(firstName, ascii('[1]'));
function source() {
  const line = (name, command) => join(name, ascii('[1] ' + command + '\n'));
  return join(
    ascii(
      '#MACRO\nCAPTURE value\n#DEFINE\nBUTTON Choice\n#OBJECT SIZE DISP\nChoice 6,4 1\n#START\nwait 1\nnext WAIT\n#WAIT\nwait ',
    ),
    target,
    ascii('\n$50=++$50\nnext IDLE\n#IDLE\n#CONFIGURE\n'),
    line(firstName, 'channel 0'),
    line(firstName, 'load cue'),
    line(secondName, 'channel 1'),
    line(secondName, 'load cue'),
    ascii('break\n#PLAY_A\n'),
    line(firstName, 'play 1 1 1'),
    ascii('break\n#PLAY_B\n'),
    line(secondName, 'play 1 1 1'),
    ascii('break\n#STOP_A\n'),
    line(firstName, 'stop'),
    ascii('break\n#DELETE_A\n'),
    line(firstName, 'delete'),
    ascii('break\n#PING\n$51=++$51\nbreak\n#CANCEL\nnext IDLE\n'),
  );
}
const notify = (world, id, label) =>
  world.sendEngine(id, world.main.id, 337, 0, 0, {
    payload: fesLabelPayload(() => ascii(label)),
  });
function observeWait(t, instance) {
  const trace = [],
    queries = [],
    sends = [],
    elements = instance.elements,
    argument = instance.argumentBytes,
    service = instance.player.nativeSound,
    busy = service.busy,
    send = service.send,
    isTarget = (value) =>
      value instanceof Uint8Array &&
      value.length === target.length &&
      value.every((byte, index) => byte === target[index]);
  t.mock.method(instance, 'elements', function (token) {
    if (isTarget(token)) trace.push(['elements', token.slice()]);
    return elements.call(this, token);
  });
  t.mock.method(instance, 'argumentBytes', function (token) {
    if (isTarget(token)) trace.push(['getter', token.slice()]);
    return argument.call(this, token);
  });
  t.mock.method(service, 'busy', async function (owner, object) {
    queries.push(owner.collection.reference(object));
    return busy.call(this, owner, object);
  });
  t.mock.method(service, 'send', async function (owner, id, w = 0, l = 0, payload) {
    if (id === 185)
      sends.push({ sender: owner.runtimeID, target: owner.player.nativeSoundTaskID, bank: w });
    return send.call(this, owner, id, w, l, payload);
  });
  return { trace, queries, sends };
}
const expectedGetters = () =>
  Array.from({ length: 2 }, () => [
    ['elements', target],
    ['getter', target],
  ]).flat();

for (const profile of startupProfiles) {
  test(`normal sound waits retain raw references through real playback and fresh: ${profile}`, async (t) => {
    const h = await environment(profile, source());
    let fresh;
    try {
      assert.equal(h.words.capacity, 64);
      assert.ok([50, 51].every((index) => index >= 0 && index < h.words.capacity));
      h.words.set(50, 0);
      h.words.set(51, 0);
      const root = await h.load(),
        collection = root.collection;
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(root.suspended, [['START', 1]]);
      // Real normal collection authors; this does not enable non-ASCII DEFINE/338.
      const [a0, a1] = collection.create('SOUND', firstName, 2),
        [b0, b1] = collection.create('SOUND', secondName, 2),
        reference = collection.reference(a1),
        rng = h.world.random.snapshot(),
        playerRandom = root.player.randomState;
      assert.equal(a0.key, b0.key);
      assert.equal(a1.key, b1.key);
      assert.notDeepEqual(firstName, secondName);
      assert.deepEqual([collection.reference(a0).index, reference.index], [0, 1]);
      await root.runtime.initializeResources();
      await root.runtime.resources.traverse();
      assert.equal(
        h.world.soundConfiguration.get('int', { by: 'filename', query: 'cue' }),
        'sound',
      );
      assert.equal(h.world.game.resolveCategory('cue', 'sound'), 'sounds.int/cue.wav');
      assert.equal(h.world.game.has('sounds.int/cue.wav'), true);
      await notify(h.world, h.id, 'CONFIGURE');
      const stateA = h.world.fesSound.state(root, a1),
        stateB = h.world.fesSound.state(root, b1),
        file = h.world.game.resolveCategory('cue', 'sound');
      assert.ok(file);
      assert.equal(stateA.filename, 'cue');
      assert.equal(stateB.filename, 'cue');
      assert.equal(stateA.get('bank'), 0);
      assert.equal(stateB.get('bank'), 1);
      assert.equal(h.world.sound.device[0].file, file);
      assert.equal(h.world.sound.device[1].file, file);
      assert.equal(root.player.nativeSound, h.world.fesSound);
      assert.equal(root.player.nativeSoundTaskID, h.task.soundTaskID);
      await notify(h.world, h.id, 'PLAY_A');
      assert.equal(h.world.sound.playing(0), true);
      assert.equal(h.world.sound.playing(1), false);
      assert.equal(h.player.audio.channelState('native:0', h.world.sound.channel(0)).file, file);
      assert.equal(typeof h.world.sound.channel(0).source.onended, 'function');
      const observed = observeWait(t, root);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(observed.trace, expectedGetters());
      assert.deepEqual(root.suspended, [['WAIT', 1]]);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.equal(
        h.words.get(50),
        0,
        'the playing raw A must stay waited even though decoded alias B is idle',
      );
      assert.deepEqual(root.waitSound, reference);
      assert.deepEqual(observed.queries, [reference]);
      assert.deepEqual(observed.sends, [{ sender: h.id, target: h.task.soundTaskID, bank: 0 }]);
      assert.deepEqual(observed.trace, expectedGetters());
      const waiting = root.waitSound;
      await notify(h.world, h.id, 'PING');
      assert.strictEqual(root.waitSound, waiting);
      assert.equal(h.words.get(51), 1);
      assert.deepEqual(root.suspended, [['WAIT', 1]]);
      h.context.advance(0.5);
      assert.equal(h.world.sound.playing(0), true);
      const savedWait = root.player.snapshot().root.waitSound;
      assert.deepEqual(savedWait, reference);
      assert.notStrictEqual(savedWait.nameBytes.buffer, root.waitSound.nameBytes.buffer);
      savedWait.nameBytes.fill(120);
      assert.deepEqual(root.waitSound, reference);
      fresh = await freshCheckpoint(t, h, profile);
      const next = fresh.player.world.objects.objects.get(h.id).implementation.player.root,
        nextWorld = fresh.player.world,
        words = nextWorld.runtime.variableBank(nextWorld.main, false),
        restoredA0 = next.collection.lookup(firstName, 0),
        restoredA1 = next.collection.lookup(firstName, 1),
        restoredB1 = next.collection.lookup(secondName, 1),
        resumed = observeWait(t, next);
      assert.deepEqual(resumed.trace, []);
      assert.deepEqual(next.waitSound, reference);
      assert.notStrictEqual(next.waitSound.nameBytes.buffer, root.waitSound.nameBytes.buffer);
      assert.deepEqual(next.suspended, [['WAIT', 1]]);
      assert.equal(words.get(50), 0);
      assert.equal(words.get(51), 1);
      assert.equal(nextWorld.sound.playing(0), true);
      assert.equal(nextWorld.sound.channel(0).source.offset, 0.5);
      assert.equal(fresh.context.sources.filter((node) => !node.stopped).length, 1);
      await nextWorld.sendEngine(h.id, nextWorld.main.id, 333);
      assert.equal(words.get(50), 0);
      assert.deepEqual(resumed.trace, []);
      assert.deepEqual(resumed.queries, [reference]);
      await notify(h.world, h.id, 'PLAY_B');
      assert.equal(h.world.sound.playing(1), true);
      h.context.advance(1.6);
      assert.equal(h.world.sound.channel(0).ended, true);
      assert.equal(h.world.sound.playing(0), false);
      assert.equal(h.world.sound.playing(1), true);
      assert.ok(
        h.player.audio.events.some(
          (event) => event.channel === 'native:0' && event.reason === 'ended',
        ),
      );
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.equal(root.waitSound, null);
      assert.equal(h.words.get(50), 1);
      assert.equal(root.label, 'IDLE');
      assert.equal(h.world.sound.playing(1), true);
      assert.deepEqual(observed.trace, expectedGetters());
      await notify(nextWorld, h.id, 'PLAY_B');
      assert.deepEqual(resumed.trace, []);
      await notify(nextWorld, h.id, 'STOP_A');
      assert.deepEqual(resumed.trace, [['getter', target]]);
      assert.equal(nextWorld.fesSound.state(next, restoredA1).get('playing'), 0);
      assert.equal(nextWorld.sound.playing(0), false);
      assert.equal(nextWorld.sound.playing(1), true);
      await nextWorld.sendEngine(h.id, nextWorld.main.id, 333);
      assert.equal(next.waitSound, null);
      assert.equal(words.get(50), 1);
      assert.equal(next.label, 'IDLE');
      assert.deepEqual(resumed.trace, [['getter', target]]);
      await notify(nextWorld, h.id, 'PLAY_A');
      assert.deepEqual(resumed.trace, [
        ['getter', target],
        ['getter', target],
      ]);
      await nextWorld.sendEngine(h.id, nextWorld.main.id, 335, 0, 0, {
        payload: fesLabelPayload(() => ascii('WAIT')),
      });
      assert.deepEqual(resumed.trace, [
        ['getter', target],
        ['getter', target],
      ]);
      await nextWorld.sendEngine(h.id, nextWorld.main.id, 333);
      assert.equal(nextWorld.sound.playing(0), true);
      assert.deepEqual(next.waitSound, reference);
      assert.deepEqual(next.suspended, [['WAIT', 1]]);
      assert.deepEqual(resumed.trace, [
        ['getter', target],
        ['getter', target],
        ...expectedGetters(),
      ]);
      await notify(nextWorld, h.id, 'DELETE_A');
      assert.deepEqual(resumed.trace, [
        ['getter', target],
        ['getter', target],
        ...expectedGetters(),
        ['getter', target],
      ]);
      assert.equal(next.collection.lookup(firstName, 1), null);
      assert.strictEqual(next.collection.lookup(firstName, 0), restoredA0);
      assert.strictEqual(next.collection.lookup(secondName, 1), restoredB1);
      const missingWait = next.waitSound;
      await assert.rejects(
        nextWorld.sendEngine(h.id, nextWorld.main.id, 333),
        /waiting sound object .* disappeared/,
      );
      assert.strictEqual(next.waitSound, missingWait);
      assert.equal(words.get(50), 1);
      assert.deepEqual(next.suspended, [['WAIT', 1]]);
      assert.deepEqual(resumed.trace, [
        ['getter', target],
        ['getter', target],
        ...expectedGetters(),
        ['getter', target],
      ]);
      await notify(nextWorld, h.id, 'CANCEL');
      assert.equal(next.waitSound, null);
      assert.equal(next.waitObjects, null);
      assert.equal(next.label, 'IDLE');
      assert.equal(words.get(50), 1);
      assert.equal(nextWorld.sound.playing(1), true);
      assert.deepEqual(resumed.trace, [
        ['getter', target],
        ['getter', target],
        ...expectedGetters(),
        ['getter', target],
      ]);
      assert.deepEqual(h.world.random.snapshot(), rng);
      assert.deepEqual(nextWorld.random.snapshot(), rng);
      assert.equal(root.player.randomState, playerRandom);
      assert.equal(next.player.randomState, playerRandom);
      assert.equal(h.world.nativeEngine, undefined);
      assert.equal(nextWorld.nativeEngine, undefined);
    } finally {
      await fresh?.player.dispose();
      await h.close();
    }
  });
}
