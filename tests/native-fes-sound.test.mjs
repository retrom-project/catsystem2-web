// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeFESSound, NativeFESSoundState } from '../src/native/fes-sound.mjs';
import { NativeFESSoundTable } from '../src/native/fes-sound-table.mjs';
import { buildNativeFESMotion } from '../src/native/fes-motion.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';

function fixture(legacy = false) {
  const messages = [],
    starts = [],
    writes = [],
    strings = {},
    locals = {},
    values = { master: 70, category: 90, file: 60, play: 1, sysplay: 1 },
    world = {
      profile: legacy ? 'sdk-4.01-engine-2.6.1.74' : 'nekopara-vol3-engine-2.6.1.76',
      frame: 20,
      game: { resolveCategory: (name, category) => `${category}/${name}` },
      soundConfiguration: {
        loaded: true,
        get(field, selector) {
          if (field === 'mute') return 0;
          if (field === 'play' || field === 'sysplay') return values[field];
          return values[{ master: 'master', key: 'category', filename: 'file' }[selector.by]];
        },
      },
      sound: {
        legacy,
        now: () => 5000,
      },
      sendNativeEngine(target, sender, raw, bank, value, context) {
        assert.equal(target, 200);
        const id = legacy ? raw + 2 : raw;
        messages.push({ sender, id, bank, value, payload: context.payload?.data.slice() });
        return { 209: 2, 205: 3, 200: 136789, 185: 1 }[id] ?? NATIVE_UNWRITTEN_WORD;
      },
    },
    instance = {
      runtimeID: 100,
      player: { strings, nativeSoundTaskID: 200 },
      value: (value) => Number(value) | 0,
      text: (value) => String(value),
      setGlobal: (index, value) => writes.push([index, value]),
      setLocal: (index, value) => {
        locals[index] = value;
      },
      program: { subcommands: {} },
    },
    facade = new NativeFESSound(world, { onStart: (...args) => starts.push(args) });
  return { world, instance, facade, messages, starts, values, writes, strings, locals };
}
const object = (fields = {}) => ({
  type: 'SOUND',
  key: 'sound',
  channel: 2,
  file: 'a.ogg',
  ...fields,
});

test('FES sound loads and plays through its owner native task and allocated group bank', async () => {
  for (const legacy of [false, true]) {
    const { facade, instance, messages, starts } = fixture(legacy),
      sound = object({ group: 'grp' });
    facade.state(instance, sound).setVolume(50);
    facade.command(instance, sound, 'play', [], { index: 0 });
    const state = await facade.update(instance, sound);
    assert.deepEqual(
      messages.map(({ id, bank, value }) => [id, bank, value]),
      [
        [181, 2, 0],
        [209, 0, 0],
        [205, 0, 0],
        [200, 3, 0],
        [186, 3, 18],
        [189, 3, 0],
        [182, 3, 0],
      ],
    );
    assert.ok(messages.every((message) => message.sender === 100));
    const load = new DataView(messages[2].payload.buffer);
    assert.equal(load.getUint32(0, true), 2);
    assert.equal(load.getUint32(4, true), 2);
    assert.equal(load.getUint32(272, true), 1);
    assert.equal(state.get('bank'), 3);
    assert.equal(state.get('startClock'), 5000);
    assert.equal(starts[0][2], 20);
    assert.equal(await facade.busy(instance, sound), true);
    await facade.close(instance, sound);
    assert.equal(messages.at(-1).id, 181);
  }
});

test('a mapped FES sound reaches the native bank loader even when its file is absent', async () => {
  const { facade, instance, messages, world } = fixture(),
    sound = object({ file: 'preview-cue', group: 'effects', soundType: 2 });
  world.game.nativeResources = {
    resolve(name, category) {
      assert.equal(category, 'sound');
      return `effects.int/${name}.ogg`;
    },
  };
  world.game.resolveCategory = () => null;
  const send = world.sendNativeEngine;
  world.sendNativeEngine = function (target, sender, id, bank, value, context) {
    const reply = send.call(this, target, sender, id, bank, value, context);
    if (id === 205) return 0xffffffff;
    if (id === 200 || id === 185) return 0;
    return reply;
  };
  facade.command(instance, sound, 'play', [], { index: 0 });
  const state = await facade.update(instance, sound),
    load = messages.find(({ id }) => id === 205);
  assert.equal(
    new TextDecoder().decode(load.payload.subarray(12, load.payload.indexOf(0, 12))),
    'effects.int/preview-cue.ogg',
  );
  assert.equal(state.get('bank'), -1);
  assert.equal(state.get('pendingLoad'), 0);
  assert.equal(state.get('duration'), 0);
  assert.equal(state.get('playing'), 0);

  const decoderError = new Error('Audio decoder rejected the mounted bytes');
  const receive = world.sendNativeEngine;
  world.sendNativeEngine = function (target, sender, id, bank, value, context) {
    if (id === 205) throw decoderError;
    return receive.call(this, target, sender, id, bank, value, context);
  };
  state.load('malformed-cue');
  await assert.rejects(facade.update(instance, sound), (error) => error === decoderError);
  world.game.nativeResources.resolve = () => null;
  await assert.rejects(facade.update(instance, sound), /category has no mounted path/);
});

test('2.6.1.23 FES playback sends the original play and stop messages', async () => {
  const { world, instance, facade, messages, starts } = fixture();
  world.profile = 'grisaia-jp-engine-2.6.1.23';
  world.configuration = new NativeConfiguration({ profile: world.profile });
  world.soundConfiguration.loaded = false;
  world.sound.now = () => assert.fail('Unexpected FES sound start clock');

  const unassigned = object({ file: '', channel: null, soundType: 2 });
  const state = facade.state(instance, unassigned);
  facade.command(instance, unassigned, 'play', ['1'], { index: 0 });
  await facade.update(instance, unassigned);
  assert.deepEqual(messages.splice(0), [
    { sender: 100, id: 171, bank: 0xffffffff, value: 0, payload: undefined },
  ]);
  assert.equal(state.get('playing'), 0);
  assert.equal(state.get('stopping'), 1);
  assert.equal(state.get('pendingPlay'), 1);
  assert.equal(state.get('startClock'), -1);
  assert.deepEqual(starts, []);

  for (const active of [1, 0]) {
    const sound = object({ file: '', channel: 3 });
    const playback = facade.state(instance, sound);
    playback.set('active', active);
    facade.command(instance, sound, 'play', ['2', '1', '1'], { index: 0 });
    await facade.update(instance, sound);
    assert.deepEqual(
      messages.splice(0),
      active ? [{ sender: 100, id: 169, bank: 3, value: 2, payload: undefined }] : [],
    );
    assert.equal(playback.get('playing'), 1);
    assert.equal(playback.get('pendingPlay'), 0);
    assert.equal(playback.get('startClock'), -1);
    assert.deepEqual(starts.pop(), [instance, sound, world.frame]);
    facade.command(instance, sound, 'loop', ['4'], { index: 0 });
    await facade.update(instance, sound);
    assert.equal(playback.get('loopCount'), 4);
    assert.deepEqual(messages, []);
  }
});

test('SOUND and SNDTABLE respect indexed-only commands and real native type exclusions', () => {
  const { facade, instance, writes, strings, locals } = fixture(),
    sound = object({ enable: false }),
    state = facade.state(instance, sound);
  assert.equal(state.get('active'), 1);
  for (const verb of [
    'enable',
    'wipe',
    'pos',
    'getpos',
    'settbl',
    'loadlist',
    'loadlist2',
    'dispid',
  ])
    facade.command(instance, sound, verb, ['0', '5', '6']);
  assert.equal(state.get('active'), 1);
  assert.deepEqual(writes, []);
  facade.command(instance, sound, 'play', ['2'], { index: -1 });
  assert.equal(state.get('playing'), 0);
  facade.command(instance, sound, 'getid', ['7'], { index: 0, objectNameAddress: 0x1234 });
  assert.deepEqual(writes.pop(), [7, 0x1234]);
  assert.throws(() => facade.command(instance, sound, 'getid', [], { index: 0 }), /name address/);
  strings[0] = 'preserve string bank';
  locals[0] = 91;
  facade.command(instance, sound, 'getdiv', []);
  assert.equal(locals[0], 0);
  assert.equal(strings[0], 'preserve string bank');
});

test('native sound tables select enabled records, stop at the end and preserve snapshot order', () => {
  const { facade, instance } = fixture(),
    sound = object({ type: 'SNDTABLE', soundCapacity: 5 }),
    state = facade.state(instance, sound),
    table = new NativeFESSoundTable(state);
  assert.equal(state.get('playOption'), 1);
  assert.throws(() => table.selectPosition(0), /uninitialized record/);
  for (let i = 0; i < 5; i++)
    facade.command(instance, sound, 'sndtbl', [String(i), `track${i}`, String(i % 2)]);
  facade.command(instance, sound, 'setid', ['0']);
  assert.equal(table.getID(), 1);
  assert.equal(state.filename, 'track1');
  facade.command(instance, sound, 'next', [], { index: 0 });
  assert.equal(table.getID(), 3);
  state.play(1);
  facade.command(instance, sound, 'next', [], { index: 0 });
  assert.equal(table.getID(), 3);
  assert.equal(state.get('playing'), 0);
  facade.command(instance, sound, 'repeat', ['1'], { index: 0 });
  facade.command(instance, sound, 'next', [], { index: 0 });
  assert.equal(table.getID(), 1);
  facade.command(instance, sound, 'rev', [], { index: 0 });
  assert.equal(table.getID(), 1);
  const restored = new NativeFESSoundState(structuredClone(sound)),
    restoredTable = new NativeFESSoundTable(restored);
  assert.equal(restoredTable.getID(), 1);
  restoredTable.next();
  assert.equal(restored.filename, 'track3');
  assert.throws(() => table.resize(2), /uninitialized new order/);
});

test('sound table shuffle consumes exactly 2000 shared integer values and reset preserves ID', () => {
  const sound = new NativeFESSoundState({ type: 'SNDTABLE' }),
    table = new NativeFESSoundTable(sound);
  table.resize(8);
  for (let i = 0; i < 8; i++) table.setRecord(i, `track${i}`, 1);
  let calls = 0,
    seed = 1234;
  table.shuffle(
    {
      rand: () => {
        calls++;
        return (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
      },
    },
    5,
  );
  assert.equal(calls, 2000);
  assert.equal(table.getID(), 5);
  assert.equal(sound.filename, '');
  table.resetOrder();
  assert.equal(table.getID(), 5);
  assert.deepEqual(Array.from(table.state.order), [0, 1, 2, 3, 4, 5, 6, 7]);
  const empty = new NativeFESSoundTable(new NativeFESSoundState({ type: 'SNDTABLE' }));
  empty.resize(0);
  assert.throws(() => empty.shuffle({ rand: () => 0 }, 0), /divides by zero/);
});

test('sndtag wait and remain use unsigned elapsed time and native 60Hz conversion', () => {
  const { facade, instance, world, writes } = fixture(),
    sound = object(),
    state = facade.state(instance, sound);
  state.state.tags = [['finish', 1800]];
  state.set('startClock', 4500);
  assert.equal(facade.command(instance, sound, 'sndtag', ['wait', 'finish'], { index: 0 }), 78);
  assert.equal(facade.command(instance, sound, 'sndtag', ['wait', 'finish'], { index: -1 }), 0);
  facade.command(instance, sound, 'sndtag', ['remain', 'finish', '12'], { index: 0 });
  assert.deepEqual(writes.pop(), [12, 78]);
  world.sound.now = () => 20;
  state.set('startClock', -20);
  assert.equal(facade.command(instance, sound, 'sndtag', ['wait', 'finish'], { index: 0 }), 105);
  facade.command(instance, sound, 'sndtag', ['init']);
  assert.equal(state.get('pendingTags'), 1);
});

test('SOUND KX2 starts zeroed and builtin motion parameters retain native source-address effects', () => {
  const state = new NativeFESSoundState({ type: 'SOUND' });
  state.setPan(-37);
  state.setVolume(258);
  const bytes = state.motionState(),
    view = new DataView(bytes.buffer);
  assert.equal(view.getFloat32(MOTION_ABI.pos, true), -37);
  assert.equal(bytes[MOTION_ABI.color + 3], 2);
  const expected = new Uint8Array(144);
  new DataView(expected.buffer).setFloat32(MOTION_ABI.pos, -37, true);
  expected[MOTION_ABI.color + 3] = 2;
  assert.deepEqual(bytes, expected);
  assert.deepEqual(
    buildNativeFESMotion('blend', [], bytes, Number, { plane: false, commandPointer: 0x12345678 }),
    {
      file: 'pColor',
      registers: [255, 52, 86, 120],
      group: 0,
      delay: 0,
    },
  );
  assert.throws(
    () => buildNativeFESMotion('blend', [], bytes, Number, { plane: false }),
    /source address/,
  );
  assert.deepEqual(buildNativeFESMotion('arc', ['-1'], bytes, Number, { delay: 7 }), {
    file: 'motArc',
    registers: [0, 0, 0, 0, 0, 0],
    group: 0,
    delay: 7,
  });
});

test('dynamic #OBJECT initialization applies only specified sound columns and queues loading', () => {
  const { facade, instance, messages } = fixture(),
    sound = object(),
    state = facade.state(instance, sound);
  state.set('pendingLoad', 0);
  sound.file = 'changed.ogg';
  sound.channel = 7;
  sound.soundBypassVolume = 1;
  facade.initialize(instance, sound, ['CHANNEL']);
  assert.equal(state.get('bank'), 7);
  assert.equal(state.filename, 'a.ogg');
  assert.equal(state.get('bypassVolume'), 0);
  facade.initialize(instance, sound, ['FILE', 'BLEND']);
  assert.equal(state.filename, 'changed.ogg');
  assert.equal(state.get('pendingLoad'), 1);
  assert.equal(state.get('bypassVolume'), 1);
  assert.equal(messages.length, 0);
});

test('the recovered native eligibility alias is preserved and uninitialized pause state is explicit', async () => {
  const { facade, instance, messages, values } = fixture(),
    sound = object({ group: 'grp' });
  values.play = 0;
  facade.command(instance, sound, 'play', [], { index: 0 });
  await facade.update(instance, sound);
  assert.ok(messages.some(({ id }) => id === 182));
  facade.command(instance, sound, 'pause', []);
  await assert.rejects(facade.update(instance, sound), /uninitialized stack eligibility/);
});

test('FES configuration notification marks sound dirty and preserves active motion', async () => {
  const { facade, instance, messages, values } = fixture(),
    sound = object(),
    state = facade.state(instance, sound);
  state.set('pendingPlay', 0);
  state.set('dirty', 0);
  state.state.motion = { authored: 'retained' };
  await facade.configurationChanged(instance, sound, () => true);
  assert.equal(state.get('dirty'), 1);
  assert.equal(state.get('pendingPlay'), 0);
  assert.deepEqual(state.state.motion, { authored: 'retained' });
  assert.equal(messages.at(-1).id, 185);
  values.play = 0;
  await facade.configurationChanged(instance, sound, () => true);
  assert.equal(state.get('pendingPlay'), 1);
  state.set('pendingPlay', 0);
  state.set('systemVoice', 1);
  const count = messages.length;
  await facade.configurationChanged(instance, sound, () => true);
  assert.equal(state.get('pendingPlay'), 0);
  assert.equal(messages.length, count);
});

test('legacy sndtag compares the original argument bytes without merging CP932 aliases', () => {
  for (const profile of ['bokutomo-engine-2.6.1.67', 'rebellions-jp-engine-2.6.1.63']) {
    const { facade, instance, world } = fixture(),
      sound = object();
    world.profile = profile;
    const state = facade.state(instance, sound);
    state.state.tags = [
      ['\xed\x40', 111],
      ['\xfa\x5c', 222],
    ];
    state.set('startClock', 5000);
    for (const [bytes, expected] of [
      [[0xed, 0x40], 6],
      [[0xfa, 0x5c], 13],
    ])
      assert.equal(
        facade.command(instance, sound, 'sndtag', ['wait', 'alias'], {
          index: 0,
          bytes: (i) => {
            assert.equal(i, 1);
            return Uint8Array.from(bytes);
          },
        }),
        expected,
      );
  }
});
