// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESInstance } from '../src/fes/instance.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = new TextEncoder().encode(
  '#START\nreset_frame\n$50=_FRAME_\n$str30\n$51=_FRAME_\nreset_frame\n$53=_FRAME_\n$52=++$52\nnext IDLE\n#IDLE\n',
);

for (const profile of profiles) {
  test(`normal native FES frame inputs survive same-word333 and cold restore: ${profile}`, async (t) => {
    const world = await defaultFESWorld(profile, { 'screen.fes': source });
    let fresh;
    try {
      const h = await loadDefaultFES(world),
        bank = world.runtime.variableBank(world.main, false);
      world.runtime.stringBank(world.main).setBytes(30, new Uint8Array());
      bank.set(51, 0xffffffff);
      bank.set(52, 0);
      bank.set(53, 99);

      // The public native registry supplies this input. It is not World.frame
      // or a test mutation of the interpreter's clock/state.
      await world.objects.tick(17);
      assert.equal(world.objects.objects.get(h.id).effectiveFrame, 17);
      assert.equal(bank.get(50), 0);
      assert.equal(bank.get(52), 0);
      await world.sendEngine(h.id, world.main.id, 333);
      assert.equal(bank.get(52), 0, 'a forced update at the same input must not resume the guest');
      assert.equal(bank.get(51), 0xffffffff);
      assert.equal(h.instance.nativeFrameWord, 17);
      assert.equal(h.instance.frameOrigin, 17);
      assert.equal(h.instance.commandDelayUntil, 18);
      assert.equal(h.task.player.frameCount, 2, 'the diagnostic call count remains independent');

      const savedPlayer = structuredClone(h.task.player.snapshot()),
        checkpoint = structuredClone(world.snapshot()),
        random = structuredClone(world.random.snapshot()),
        reads = [];
      let restoring = false,
        restoreCommands = 0;
      const execute = FESInstance.prototype.execute;
      t.mock.method(FESInstance.prototype, 'execute', function (...args) {
        if (restoring) restoreCommands++;
        return execute.apply(this, args);
      });
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read;
      t.mock.method(fresh.game, 'read', function (name, ...args) {
        if (restoring) reads.push(name);
        return read.call(this, name, ...args);
      });
      restoring = true;
      try {
        await fresh.restore(checkpoint);
      } finally {
        restoring = false;
      }
      const nextTask = fresh.objects.objects.get(h.id).implementation,
        next = nextTask.player.root,
        nextBank = fresh.runtime.variableBank(fresh.main, false);
      assert.deepEqual(structuredClone(nextTask.player.snapshot()), savedPlayer);
      assert.equal(restoreCommands, 0);
      assert.deepEqual(
        reads.filter((name) => name.endsWith('.fes')),
        [],
      );
      assert.deepEqual(fresh.random.snapshot(), random);
      assert.equal(next.nativeFrameWord, 17);
      assert.equal(next.frameOrigin, 17);
      assert.notStrictEqual(
        next.nativeContext.nameBytes.buffer,
        h.instance.nativeContext.nameBytes.buffer,
      );

      await world.objects.tick(18);
      await fresh.objects.tick(18);
      for (const [task, words] of [
        [h.task, bank],
        [nextTask, nextBank],
      ]) {
        assert.equal(words.get(51), 1);
        assert.equal(words.get(52), 1);
        assert.equal(words.get(53), 0);
        assert.equal(task.player.root.nativeFrameWord, 18);
        assert.equal(task.player.root.frameOrigin, 18);
        assert.equal(task.player.root.commandDelayUntil, null);
        assert.equal(task.player.root.label, 'IDLE');
        assert.equal(task.player.frameCount, 3);
      }
      assert.deepEqual(
        structuredClone(nextTask.player.snapshot()),
        structuredClone(h.task.player.snapshot()),
      );
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}

import { fesNotificationMemory } from './fixtures/default-fes-world.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';

const waitBytes = (text) => new TextEncoder().encode(text);
const waitHeadSource = waitBytes(
  '#DEFINE\nCPLANE wait\nBUTTON other\n#OBJECT SIZE\nother 6,4\n#START\nwait getid 10\nwait delete\n$11=++$11\nnext NUMERIC\n#NUMERIC\nwait ++$20\n$12=++$12\nnext FRAME\n#FRAME\nreset_frame\nwait frame 3\n$13=++$13\nwait\n$14=++$14\nnext IDLE\n#IDLE\n#other.CHECK\nwait getid 21\nwait[++$23-1] getid 24\n$22=++$22\nbreak\n',
);

function waitNameAddress(world, instance, label, row, nameBytes) {
  return world.fesSources.context(instance.program.sourceKey, label, row, {
    bytes: instance.program.blocks[label][row],
    offset: 0,
    nameBytes,
  }).objectNameAddress;
}
async function restoreWaitWorld(t, profile, world, files) {
  const saved = structuredClone(world.snapshot()),
    before = world.fesSources.snapshot();
  let restoring = true,
    commands = 0,
    getters = 0;
  for (const [prototype, method] of [
    [FESInstance.prototype, 'execute'],
    [FESInstance.prototype, 'expandMacros'],
    [FESCoordinator.prototype, 'initialize'],
    [NativeStringBank.prototype, 'expandBytes'],
    [NativeScriptReplacements.prototype, 'apply'],
  ]) {
    const original = prototype[method];
    t.mock.method(prototype, method, function (...args) {
      if (restoring) commands++;
      return original.apply(this, args);
    });
  }
  const fresh = await defaultFESWorld(profile, files, { initialize: false }),
    read = fresh.game.read;
  t.mock.method(fresh.game, 'read', function (name, ...args) {
    if (restoring && name.endsWith('.fes')) getters++;
    return read.call(this, name, ...args);
  });
  try {
    await fresh.restore(saved);
  } catch (error) {
    await fresh.close();
    throw error;
  } finally {
    restoring = false;
  }
  assert.equal(commands, 0, 'cold wait restore must not replay FES, macros or resources');
  assert.equal(getters, 0, 'cold wait restore must not read a FES payload');
  assert.deepEqual(fresh.fesSources.snapshot(), before);
  assert.deepEqual(fresh.random.snapshot(), world.random.snapshot());
  return fresh;
}

for (const profile of profiles) {
  test(`normal common wait routes actual heads and owns input deadlines, frame origin and noarg tail: ${profile}`, async (t) => {
    const files = { 'wait-head.fes': waitHeadSource },
      world = await defaultFESWorld(profile, files);
    let fresh;
    try {
      const h = await loadDefaultFES(world, 'wait-head'),
        root = h.instance,
        words = world.runtime.variableBank(world.main, false),
        name = waitBytes('wait'),
        tuple = structuredClone(root.nativeContext),
        calls = [],
        original = root.runtime.command;
      t.mock.method(root.runtime, 'command', function (verb, selection, args, source) {
        calls.push({
          verb,
          selection: structuredClone(selection),
          current: structuredClone(root.nativeContext),
        });
        return original.call(this, verb, selection, args, source);
      });
      const eventAddress = waitNameAddress(world, root, 'other.CHECK', 0, name),
        secondAddress = waitNameAddress(world, root, 'other.CHECK', 1, name),
        mainAddress = waitNameAddress(world, root, 'START', 0, name),
        memory = fesNotificationMemory(waitBytes('CHECK'), waitBytes('other'), 0);
      await world.sendEngine(h.id, world.main.id, 337, 64, 0, { payload: memory });
      assert.equal(words.get(24), secondAddress);
      assert.equal(words.get(23), 1, 'the actual command-head index evaluates once');
      assert.equal(words.get(22), 1);
      assert.equal(
        words.get(21),
        eventAddress,
        'a real object named wait must win before the common binding',
      );
      assert.deepEqual(
        calls.map(({ verb, selection }) => [verb, selection.nameBytes, selection.index]),
        [
          ['getid', name, 0],
          ['getid', name, 0],
        ],
      );
      assert.ok(
        calls.every(({ current }) =>
          current.nameBytes.every((b, i) => b === waitBytes('other')[i]),
        ),
      );
      assert.deepEqual(root.nativeContext, tuple);
      assert.equal(memory.stringReads, 0);
      await world.objects.tick(20);
      assert.equal(words.get(10), mainAddress);
      assert.equal(words.get(11), 1);
      assert.equal(words.get(20), 1);
      assert.equal(words.get(12), 0);
      assert.equal(root.commandDelayUntil, 21);
      assert.equal(root.waitFrames, 0);
      await world.sendEngine(h.id, world.main.id, 333);
      assert.equal(words.get(20), 1, 'polling cannot replay the operand mutation');
      assert.equal(words.get(12), 0);
      fresh = await restoreWaitWorld(t, profile, world, files);
      const next = fresh.objects.objects.get(h.id).implementation.player.root,
        otherWords = fresh.runtime.variableBank(fresh.main, false);
      assert.deepEqual(next.player.snapshot(), root.player.snapshot());
      for (const currentWorld of [world, fresh]) await currentWorld.objects.tick(21);
      for (const instance of [root, next]) {
        assert.equal(instance.commandDelayUntil, -2);
        assert.equal(instance.frameOrigin, 21);
        assert.equal(instance.waitParameters.frameThreshold, 3);
      }
      assert.deepEqual([words.get(12), otherWords.get(12)], [1, 1]);
      for (const currentWorld of [world, fresh]) await currentWorld.objects.tick(23);
      assert.deepEqual([words.get(13), otherWords.get(13)], [0, 0]);
      for (const currentWorld of [world, fresh]) await currentWorld.objects.tick(24);
      assert.deepEqual([words.get(13), otherWords.get(13)], [1, 1]);
      assert.equal(root.commandDelayUntil, -1);
      for (const currentWorld of [world, fresh]) await currentWorld.objects.tick(25);
      assert.equal(root.commandDelayUntil, null);
      assert.deepEqual(
        [words.get(14), otherWords.get(14)],
        [0, 0],
        'noarg clear keeps this input at the frame tail',
      );
      for (const currentWorld of [world, fresh]) await currentWorld.objects.tick(26);
      assert.deepEqual([words.get(14), otherWords.get(14)], [1, 1]);
      await h.task.tick(-0);
      await fresh.objects.objects.get(h.id).implementation.tick(-0);
      assert.equal(Object.is(root.nativeFrameWord, -0), false);
      assert.equal(Object.is(next.nativeFrameWord, -0), false);
      assert.equal(root.nativeFrameWord, 0);
      assert.deepEqual(next.player.snapshot(), root.player.snapshot());
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}

import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
  startupXML,
} from './fixtures/ordinary-startup.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';

const waitSoundFilename = 'assets.int/common-wait-tag.fes',
  sampleRate = 8000,
  sampleCount = sampleRate * 2;
function waitTagRecord() {
  const bytes = new Uint8Array(24);
  bytes.set(waitBytes('hit'));
  new DataView(bytes.buffer).setUint32(20, 1000, true);
  return bytes;
}
function waitWave() {
  const bytes = new Uint8Array(44 + sampleCount * 2),
    view = new DataView(bytes.buffer);
  bytes.set(waitBytes('RIFF'), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(waitBytes('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(waitBytes('data'), 36);
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) view.setInt16(44 + index * 2, 8192, true);
  return bytes;
}
function waitAudioContext() {
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

async function waitSoundEnvironment(profile, source) {
  const scope = startupEnvironment();
  let player;
  const context = waitAudioContext();
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: true,
        files: {
          'sound.xml': startupXML(
            profile,
            '<MASTER><volume>100</volume><mastervol>100</mastervol><play>1</play><sysplay>1</sysplay><mute>0</mute></MASTER>' +
              '<PART><waitcue><head>cue</head><int>sound</int><volume>100</volume><mastervol>100</mastervol><play>1</play><sysplay>1</sysplay></waitcue></PART>',
          ),
          'assets/common-wait-tag.fes': source,
          'sounds/cue.wav': waitWave(),
          'sounds/cue.tag': waitTagRecord(),
        },
      }),
      startup = await template.require('startup.xml'),
      marker = waitBytes('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = waitBytes(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>' +
          '<int03><name>sound</name><int>sounds.int</int><ext>wav</ext><dir>sounds</dir></int03>' +
          '<int04><name>tag</name><int>sounds.int</int><ext>tag</ext><dir>sounds</dir></int04>',
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
          payload: { string: () => waitSoundFilename },
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

const waitNotify = (world, id, label) =>
  world.sendEngine(id, world.main.id, 337, 0, 0, {
    payload: fesLabelPayload(() => waitBytes(label)),
  });
function waitTagQueries(t, world) {
  const calls = [],
    service = world.fesSound,
    send = service.send;
  t.mock.method(service, 'send', function (owner, id, w = 0, l = 0, payload) {
    const call = [214, 215].includes(id)
      ? { id, bank: w, target: owner.player.nativeSoundTaskID, bytes: payload.data.slice() }
      : null;
    if (call) calls.push(call);
    const result = send.call(this, owner, id, w, l, payload);
    if (call)
      result.then(
        (value) => {
          call.value = value;
        },
        (error) => {
          call.error = error.message;
        },
      );
    return result;
  });
  return calls;
}
async function waitSoundRestore(t, h, profile) {
  const gpu = h.world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
  const checkpoint = await h.player.snapshot(),
    sources = h.world.fesSources.snapshot();
  let restoring = true,
    replays = 0,
    reads = 0;
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
      if (restoring) replays++;
      return original.apply(this, args);
    });
  }
  const file = h.game.lookup(waitSoundFilename).file,
    originalRead = file.read;
  t.mock.method(file, 'read', function (...args) {
    if (restoring) reads++;
    return originalRead.apply(this, args);
  });
  const context = waitAudioContext(),
    player = new CatSystem2({
      game: h.game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      audioContext: context,
      transitionalExe: {
        open() {
          throw new Error('No original common wait restore');
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
  assert.equal(replays, 0);
  assert.equal(reads, 0);
  assert.deepEqual(player.world.fesSources.snapshot(), sources);
  return { player, context };
}
const waitTagSource = waitBytes(
  '#DEFINE\nSOUND cue[2]\n#START\nwait 1000\n$40=++$40\nnext IDLE\n#IDLE\n#FRAME_TAG\nwait tag hit\n$45=++$45\nnext IDLE\n#CONFIGURE\ncue[0] channel 0\ncue[0] load cue\ncue[1] channel 0\ncue[1] load cue\nbreak\n#PLAY0\ncue[0] play 1 1 1\nbreak\n#PLAY1\ncue[1] play 1 1 1\nbreak\n#NESTED\ncall INNER\n$41=99\n#INNER\nwait frame 777\n$42=99\n#QUEUE\nwait tag hit\n$43=99\n#MISS\nwait tag absent\n$44=99\n#SAME\nif($46==0)\n$46=1\nnext SAME\nendif\n$47=++$47\nbreak\n#TRANSFER\nnext TRANSFERRED\n$48=99\n#TRANSFERRED\n$49=++$49\nnext IDLE\n',
);
for (const profile of profiles) {
  test(`normal common wait tag FIFO uses real Sound out words and survives cold restore: ${profile}`, async (t) => {
    const h = await waitSoundEnvironment(profile, waitTagSource);
    let restored;
    try {
      const root = await h.load(),
        savedTuple = structuredClone(root.nativeContext),
        random = h.world.random.snapshot();
      for (let index = 40; index < 50; index++) h.words.set(index, 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      const mainControl = root.commandDelayUntil;
      assert.equal(mainControl, (root.nativeFrameWord + 1000) >>> 0);
      await waitNotify(h.world, h.id, 'CONFIGURE');
      assert.equal(h.world.game.resolveCategory('cue', 'tag'), 'sounds.int/cue.tag');
      const [first, second] = [0, 1].map((index) =>
        root.collection.lookup(waitBytes('cue'), index),
      );
      await waitNotify(h.world, h.id, 'PLAY0');
      const firstStamp = h.world.fesSound.state(root, first).get('startClock') >>> 0;
      await h.world.tick();
      await waitNotify(h.world, h.id, 'PLAY1');
      const secondStamp = h.world.fesSound.state(root, second).get('startClock') >>> 0;
      assert.notEqual(firstStamp, secondStamp);
      assert.equal(h.world.sound.playing(0), true);
      await waitNotify(h.world, h.id, 'SAME');
      assert.equal(
        root.label,
        'START',
        'the comparison snapshot is the formatted event label, not the main label',
      );
      assert.equal(root.commandDelayUntil, mainControl);
      assert.equal(h.words.get(47), 1);
      await waitNotify(h.world, h.id, 'NESTED');
      assert.deepEqual(
        [h.words.get(41), h.words.get(42)],
        [0, 0],
        'a nonzero wait stops the entire nested event label',
      );
      assert.equal(
        root.waitParameters.frameThreshold,
        777,
        'event parameter writes survive tuple restoration',
      );
      assert.equal(
        root.commandDelayUntil,
        mainControl,
        'event return does not arm the main frame control',
      );
      await waitNotify(h.world, h.id, 'QUEUE');
      assert.equal(h.words.get(43), 0);
      assert.equal(root.waitParameters.frameThreshold, 0);
      assert.deepEqual(root.nativeContext, savedTuple);
      assert.equal(
        root.nativeQueuePending,
        false,
        'an event cannot borrow the frame deferred flag',
      );
      assert.equal(root.runtime.pendingRecords.length, 1);
      const queued = root.runtime.pendingRecords[0],
        tag = new Uint8Array(32);
      tag.set(waitBytes('hit'));
      assert.deepEqual(queued, { operation: 'wait-tag', tagBytes: tag });
      assert.notStrictEqual(queued.tagBytes.buffer, root.waitParameters.tagBytes.buffer);
      const dto = root.player.snapshot();
      restored = await waitSoundRestore(t, h, profile);
      const world = restored.player.world,
        next = world.objects.objects.get(h.id).implementation.player.root,
        words = world.runtime.variableBank(world.main, false),
        calls = waitTagQueries(t, h.world),
        freshCalls = waitTagQueries(t, world),
        origin = root.frameOrigin,
        now = h.world.sound.now(),
        sum = (firstStamp + 1000) >>> 0,
        delta = sum <= now ? 0 : (sum - now) >>> 0,
        expected = Math.floor((Math.imul(delta, 60) >>> 0) / 1000) >>> 0;
      assert.deepEqual(next.player.snapshot(), dto);
      assert.notStrictEqual(
        next.waitParameters.tagBytes.buffer,
        root.waitParameters.tagBytes.buffer,
      );
      assert.notStrictEqual(next.runtime.pendingRecords[0].tagBytes.buffer, queued.tagBytes.buffer);
      assert.deepEqual(calls, []);
      assert.deepEqual(freshCalls, []);
      for (const current of [h.world, world]) await current.sendEngine(h.id, current.main.id, 333);
      for (const list of [calls, freshCalls]) {
        assert.deepEqual(
          list.map(({ id, bank, value, bytes }) => [id, bank, value, bytes]),
          [
            [215, 0, 0, tag],
            [214, 0, 1000, tag],
          ],
        );
        assert.ok(list.every(({ target }) => target === h.task.soundTaskID));
      }
      assert.equal(root.runtime.pendingRecords.length, 0);
      assert.equal(next.runtime.pendingRecords.length, 0);
      assert.equal(queued.tagBytes, null, 'the popped payload is released once after its consumer');
      assert.equal(root.commandDelayUntil, -2);
      assert.equal(root.waitParameters.frameThreshold, expected);
      assert.equal(next.waitParameters.frameThreshold, expected);
      assert.equal(root.frameOrigin, origin);
      assert.equal(next.frameOrigin, origin);
      assert.deepEqual([h.words.get(40), words.get(40)], [0, 0]);
      for (const current of [h.world, world]) await current.sendEngine(h.id, current.main.id, 333);
      assert.deepEqual([h.words.get(40), words.get(40)], [0, 0]);
      const deadlineInput = (origin + expected) >>> 0;
      for (const current of [h.world, world]) await current.objects.tick(deadlineInput);
      assert.deepEqual([h.words.get(40), words.get(40)], [1, 1]);
      assert.equal(root.commandDelayUntil, null);
      assert.deepEqual(next.player.snapshot(), root.player.snapshot());
      assert.deepEqual(h.world.random.snapshot(), random);
      assert.deepEqual(world.random.snapshot(), random);
      const beforeFrameTag = calls.length,
        inputWord = root.nativeFrameWord;
      await h.world.sendEngine(h.id, h.world.main.id, 335, 0, 0, {
        payload: fesLabelPayload(() => waitBytes('FRAME_TAG')),
      });
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.equal(root.nativeFrameWord, inputWord);
      assert.equal(
        h.words.get(45),
        1,
        'frame TAG drains then re-enters at the identical input word',
      );
      assert.equal(root.nativeQueuePending, false);
      assert.deepEqual(root.runtime.pendingRecords, []);
      assert.deepEqual(
        calls.slice(beforeFrameTag).map(({ id }) => id),
        [215, 214],
      );
      await waitNotify(h.world, h.id, 'MISS');
      const beforeMissing = calls.length;
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(
        calls.slice(beforeMissing).map(({ id, value }) => [id, value]),
        [[215, 0xffffffff]],
      );
      assert.equal(root.commandDelayUntil, null);
      assert.equal(h.words.get(44), 0);
      await waitNotify(h.world, h.id, 'TRANSFER');
      assert.equal(root.label, 'TRANSFERRED');
      assert.deepEqual(root.suspended, [['TRANSFERRED', 0]]);
      assert.deepEqual([h.words.get(48), h.words.get(49)], [0, 0]);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.equal(h.words.get(49), 1);
      assert.equal(h.world.nativeEngine, undefined);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await restored?.player.dispose();
      await h.close();
    }
  });
}

test('Game common wait string and privateflag consume their real owners and signed bounds', async () => {
  const profile = profiles[1],
    source = waitBytes(
      '#DEFINE\nSTRING content\nSTRING8 utf\n#OBJECT SIZE\ncontent 40,16\nutf 40,16\n#START\nwait string content\n$30=++$30\nwait string utf\n$31=++$31\nwait privateflag 511\n$32=++$32\nwait privateflag -1\n$33=++$33\nwait privateflag 512\n$34=++$34\nnext IDLE\n#IDLE\n#TYPE\ncontent str hello\ncontent draw -1\nutf str world\nutf draw -1\nbreak\n#SKIP0\ncontent skip\nbreak\n#SKIP1\nutf skip\nbreak\n#FLAG\n\\511=1\nbreak\n',
    ),
    world = await defaultFESWorld(profile, { 'wait-extra.fes': source });
  try {
    const h = await loadDefaultFES(world, 'wait-extra'),
      root = h.instance,
      words = world.runtime.variableBank(world.main, false);
    await waitNotify(world, h.id, 'TYPE');
    const first = root.collection.lookup(waitBytes('content'), 0),
      second = root.collection.lookup(waitBytes('utf'), 0);
    assert.equal(first.nativeType, 21);
    assert.equal(second.nativeType, 37);
    assert.notEqual(root.runtime.strings.state(first).remaining, 0);
    assert.notEqual(root.runtime.strings.state(second).remaining, 0);
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(root.commandDelayUntil, -6);
    assert.deepEqual(root.waitParameters.reference, { nameBytes: waitBytes('content'), index: -1 });
    await waitNotify(world, h.id, 'SKIP0');
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(
      root.runtime.strings.state(first).remaining,
      0,
      'the real text owner has consumed finish before the next poll',
    );
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(30), 1);
    assert.equal(root.commandDelayUntil, -6);
    assert.deepEqual(root.waitParameters.reference, { nameBytes: waitBytes('utf'), index: -1 });
    await waitNotify(world, h.id, 'SKIP1');
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(root.runtime.strings.state(second).remaining, 0);
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(31), 1);
    assert.equal(root.commandDelayUntil, -7);
    assert.equal(root.waitParameters.privateIndex, 511);
    assert.equal(root.local(511), 0);
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(32), 0);
    await waitNotify(world, h.id, 'FLAG');
    assert.equal(root.local(511), 1);
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(32), 1);
    assert.equal(root.waitParameters.privateIndex, -1);
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(33), 1);
    assert.equal(root.waitParameters.privateIndex, 512);
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(34), 1);
    assert.equal(root.commandDelayUntil, null);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});

test('SDK common wait string and privateflag retain ordinary object fallback', async () => {
  const profile = profiles[0],
    source = waitBytes(
      '#DEFINE\nBUTTON string\nBUTTON privateflag\n#OBJECT SIZE\nstring 4,4\nprivateflag 4,4\n#START\nwait string\n$30=++$30\nwait privateflag\n$31=++$31\nstring delete\nprivateflag delete\nwait string\n$32=++$32\nnext IDLE\n#IDLE\n',
    ),
    world = await defaultFESWorld(profile, { 'wait-sdk.fes': source });
  try {
    const h = await loadDefaultFES(world, 'wait-sdk'),
      root = h.instance,
      words = world.runtime.variableBank(world.main, false);
    await world.objects.tick(10);
    assert.equal(root.commandDelayUntil, -4);
    assert.deepEqual(root.waitParameters.reference, { nameBytes: waitBytes('string'), index: -1 });
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(30), 1);
    assert.equal(root.commandDelayUntil, -4);
    assert.deepEqual(root.waitParameters.reference, {
      nameBytes: waitBytes('privateflag'),
      index: -1,
    });
    await world.sendEngine(h.id, world.main.id, 333);
    assert.equal(words.get(31), 1);
    assert.equal(words.get(32), 0);
    assert.equal(
      root.commandDelayUntil,
      11,
      'SDK missing string is ordinary numeric missing0 then min1',
    );
    await world.objects.tick(11);
    assert.equal(words.get(32), 1);
    assert.equal(root.commandDelayUntil, null);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});

// Native MOT skip regression: requests preserve the explicit strong stop API.
// Real root and descendant scripts consume requests during ordinary MOT updates.
import { kcsProgram as waitMotionKCS } from './helpers.mjs';
import { MOTION_ABI as waitMotionABI } from '../src/motion/abi.mjs';
import { MotionInstance as WaitMotionInstance } from '../src/motion/instance.mjs';

const waitMotionShared = (offset) => [0x13, (0x80000000 + offset) >>> 0];
const waitMotionFiles = () => ({
  'wait-motion.fes': waitBytes(`#DEFINE
CPLANE branch
CPLANE child
#OBJECT SIZE PARENT
branch 4,4 _TOPOBJ_[0]
child 4,4 branch[0]
#SUBCOMMAND
continue holdmot wait-motion-held :
oneshot endmot wait-motion-ended :
continue placemot wait-motion-placed p[0] : [0]
#START
_TOPOBJ_[0] holdmot
_TOPOBJ_[0] endmot
keyskip on force 1
wait 50
$40=++$40
_TOPOBJ_[0] ismot 41
_TOPOBJ_[0] holdmot
_TOPOBJ_[0] ismot 48
child[0] placemot 17
wait
$49=++$49
next IDLE
#IDLE
#branch.READBACK
branch[0] ismot 44
child[0] getpos 45
$50=++$50
break
`),
  // Real MOT guest instructions; HALT leaves the initial active word equal to1.
  'wait-motion-held.kcs': waitMotionKCS([[59]]),
  // This inactive record is retained because the same root also has a held one.
  'wait-motion-ended.kcs': waitMotionKCS([[21, waitMotionShared(waitMotionABI.active), 0], [59]]),
  'wait-motion-placed.kcs': waitMotionKCS([
    [21, waitMotionShared(waitMotionABI.pos), waitMotionShared(waitMotionABI.registers)],
    [59],
  ]),
});
function waitMotionState(runtime, object) {
  if (!object) return null;
  const target = runtime.targetFor(object, false);
  if (!target) return null;
  return {
    lastFrame: target.lastFrame,
    lastHandle: target.lastHandle,
    nextHandle: target.manager.nextHandle,
    flags: target.manager.flags,
    records: [...target.manager.records.values()].map(({ handle, instance }) => ({
      handle,
      active: instance.active,
      skip: instance.skip,
      shared: instance.shared.slice(),
      pc: instance.machine.pc,
      sp: instance.machine.sp,
      steps: instance.machine.steps,
    })),
    dto: structuredClone(target.snapshot()),
  };
}
function assertWaitMotionRequest(before, after) {
  assert.ok(before);
  assert.ok(after);
  assert.equal(after.lastFrame, before.lastFrame, 'request does not update a MOT frame');
  assert.equal(after.lastHandle, before.lastHandle);
  assert.equal(after.nextHandle, before.nextHandle);
  assert.equal(after.flags, before.flags, 'request does not change future-instance flags');
  assert.deepEqual(
    after.records.map(({ handle }) => handle),
    before.records.map(({ handle }) => handle),
    'request retains all current active and inactive records',
  );
  for (let at = 0; at < before.records.length; at++) {
    const prior = before.records[at],
      next = after.records[at],
      expected = prior.shared.slice();
    // Expected bytes are owned by the assertion, never written into the runtime.
    new DataView(expected.buffer).setInt32(waitMotionABI.skip, 1, true);
    assert.deepEqual(next.shared, expected, 'only the per-record skip word changes');
    assert.equal(next.active, prior.active);
    assert.equal(next.skip, true);
    assert.deepEqual([next.pc, next.sp, next.steps], [prior.pc, prior.sp, prior.steps]);
  }
}
function waitMotionOutput(args, output) {
  const expected = waitBytes(String(output));
  return (
    args[0] instanceof Uint8Array &&
    args[0].length === expected.length &&
    args[0].every((value, at) => value === expected[at])
  );
}

for (const profile of profiles) {
  test(`normal common wait requests real root and descendant MOT skip without force advancing: ${profile}`, async (t) => {
    const files = waitMotionFiles(),
      world = await defaultFESWorld(profile, files);
    let fresh;
    try {
      const h = await loadDefaultFES(world, 'wait-motion'),
        root = h.instance,
        runtime = root.runtime,
        words = world.runtime.variableBank(world.main, false),
        top = runtime.top,
        branch = runtime.collection.lookup(waitBytes('branch'), 0),
        child = runtime.collection.lookup(waitBytes('child'), 0),
        samples = { positive: [], noarg: [], later: [] },
        poll = runtime.pollWait,
        command = runtime.command;
      let stage = 'setup';
      t.mock.method(runtime, 'pollWait', function (...args) {
        const control = root.commandDelayUntil,
          selected = (stage === 'positive' && control > 0) || (stage === 'noarg' && control === -1),
          before = selected
            ? { top: waitMotionState(runtime, top), child: waitMotionState(runtime, child) }
            : null,
          result = poll.apply(this, args);
        if (selected) {
          const record = {
            control,
            before,
            after: { top: waitMotionState(runtime, top), child: waitMotionState(runtime, child) },
          };
          samples[stage === 'positive' ? 'positive' : 'noarg'].push(record);
        }
        return result; // Exact original Promise and rejection; no async wrapper.
      });
      t.mock.method(runtime, 'command', function (verb, selection, args, context) {
        if (verb === 'ismot' && waitMotionOutput(args, 48))
          samples.later.push(waitMotionState(runtime, top));
        return command.call(this, verb, selection, args, context);
      });

      await world.objects.tick(10);
      stage = 'positive';
      await world.objects.tick(11);
      stage = 'after-positive';
      // The child has no MOT yet at this first guest query. Both are real outputs.
      assert.equal(words.get(40), 1, 'the positive wait actually continued its guest stream');
      assert.equal(words.get(41), 1, 'skip request must not force-clear the busy implicit root');
      // No metadata/record assertion can mask that primary behavior red.
      assert.ok(top);
      assert.equal(top.nativeType, 0);
      assert.equal(branch.parentHandle, top.handle);
      assert.equal(child.parentHandle, branch.handle);
      assert.deepEqual(
        runtime.collection.graph.children().map(({ handle }) => handle),
        [top.handle],
      );
      assert.equal(samples.positive.length, 1);
      const first = samples.positive[0];
      assert.equal(first.before.child, null, 'first oracle has no busy descendant');
      assert.deepEqual(
        first.before.top.records.map(({ active }) => active),
        [true, false],
      );
      assertWaitMotionRequest(first.before.top, first.after.top);
      assert.equal(samples.later.length, 1);
      const present = new Set(first.before.top.records.map(({ handle }) => handle)),
        later = samples.later[0].records.filter(({ handle }) => !present.has(handle));
      assert.equal(later.length, 1, 'one actual later guest MOT command created a record');
      assert.equal(later[0].active, true);
      assert.equal(later[0].skip, false, 'observed before any subsequent wait request');
      assert.equal(words.get(48), 1);
      assert.equal(words.get(49), 0);
      assert.equal(root.commandDelayUntil, -1);

      stage = 'noarg';
      await world.objects.tick(12);
      stage = 'readback';
      assert.equal(samples.noarg.length, 1);
      assertWaitMotionRequest(samples.noarg[0].before.top, samples.noarg[0].after.top);
      assertWaitMotionRequest(samples.noarg[0].before.child, samples.noarg[0].after.child);
      assert.equal(root.commandDelayUntil, -1, 'busy noarg remains armed and tails this frame');
      assert.equal(words.get(49), 0);
      // Branch has no own target; its guest ismot is solely the real child subtree.
      assert.equal(runtime.targetFor(branch, false), undefined);
      const memory = fesNotificationMemory(waitBytes('READBACK'), waitBytes('branch'), 0);
      await world.sendEngine(h.id, world.main.id, 337, 64, 0, { payload: memory });
      assert.equal(words.get(50), 1, 'actual notification entry reached the child readback');
      assert.equal(words.get(44), 1, 'ismot recursively observes the busy child');
      assert.equal(words.get(45), 17, 'normal preceding MOT phase applies its authored register');
      assert.equal(memory.stringReads, 0);
      assert.equal(root.commandDelayUntil, -1);
      assert.equal(words.get(49), 0);
      const sameInput = {
        top: waitMotionState(runtime, top),
        child: waitMotionState(runtime, child),
      };
      await world.sendEngine(h.id, world.main.id, 333);
      assert.deepEqual(waitMotionState(runtime, top), sameInput.top);
      assert.deepEqual(waitMotionState(runtime, child), sameInput.child);
      assert.equal(words.get(49), 0);

      let restoring = false,
        motionRuns = 0;
      const run = WaitMotionInstance.prototype.run;
      t.mock.method(WaitMotionInstance.prototype, 'run', function (...args) {
        if (restoring) motionRuns++;
        return run.apply(this, args);
      });
      restoring = true;
      try {
        fresh = await restoreWaitWorld(t, profile, world, files);
      } finally {
        restoring = false;
      }
      const restored = fresh.objects.objects.get(h.id).implementation.player.root,
        nextRuntime = restored.runtime,
        nextTop = nextRuntime.top,
        nextChild = nextRuntime.collection.lookup(waitBytes('child'), 0),
        nextWords = fresh.runtime.variableBank(fresh.main, false);
      assert.equal(
        motionRuns,
        0,
        'cold restore only reloads immutable MOT code, never executes it',
      );
      assert.notStrictEqual(nextTop, top);
      assert.notStrictEqual(nextChild, child);
      assert.deepEqual(waitMotionState(nextRuntime, nextTop), waitMotionState(runtime, top));
      assert.deepEqual(waitMotionState(nextRuntime, nextChild), waitMotionState(runtime, child));
      assert.deepEqual(
        structuredClone(restored.player.snapshot()),
        structuredClone(root.player.snapshot()),
      );
      stage = 'continued';
      await world.objects.tick(13);
      await fresh.objects.tick(13);
      assert.equal(words.get(49), 0);
      assert.equal(nextWords.get(49), 0);
      assert.equal(root.commandDelayUntil, -1);
      assert.equal(restored.commandDelayUntil, -1);
      assert.deepEqual(waitMotionState(nextRuntime, nextTop), waitMotionState(runtime, top));
      assert.deepEqual(waitMotionState(nextRuntime, nextChild), waitMotionState(runtime, child));
      assert.deepEqual(
        structuredClone(restored.player.snapshot()),
        structuredClone(root.player.snapshot()),
      );
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
