// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { CatSystem2 } from '../src/engine.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { nativeABIBehavior } from '../src/native/abi/index.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { audioFixture } from './fixtures/audio-context.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  startupXML,
  startupVersionImage,
} from './fixtures/ordinary-startup.mjs';
import { kcsProgram, kif } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  text = (value) => new TextEncoder().encode(value),
  loadedWord = (address) => [0x13, address],
  push = (...words) => words.map((word) => [37, word]),
  native = (id, ...words) => [...push(...words), [43, id, words.length * 4]],
  receive = (address) => [38, address];

async function gameFiles(files) {
  const game = new GameFiles(
    new Map(Object.entries(files).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))])),
  );
  await game.open();
  return game;
}

test('2.6.1.23 selects the loose startup and drives KCS, Draw and FES through a fresh Core', async () => {
  const startup = (entry, width, height) =>
      startupXML(
        profile,
        `<APP><title>Authored title</title></APP><SCRIPT><start>${entry}</start></SCRIPT>
        <SCREEN><width>${width}</width><height>${height}</height><v_width>${width}</v_width>
        <v_height>${height}</v_height><fps>60</fps></SCREEN>
        <INT><int00><name>kcs</name><int>kcs.int</int><ext>kcs</ext></int00>
        <int01><name>fes</name><int>fes.int</int><ext>fes</ext></int01>
        <int02><name>config</name><int>config.int</int><ext>xml</ext></int02></INT>`,
      ),
    width = 24,
    height = 28,
    owner = 32,
    draw = 36,
    fes = 40,
    xml = 44,
    enabled = 48,
    clock = 52,
    file = 56,
    entry = kcsProgram(
      [
        ...native(68),
        receive(owner),
        ...native(8, width, height),
        ...native(209, 64),
        ...native(590, 3320),
        receive(xml),
        ...native(592, loadedWord(xml), 3, 3384),
        receive(enabled),
        ...native(591, loadedWord(xml)),
        ...native(238, 0),
        receive(file),
        ...native(246, loadedWord(file)),
        ...native(117, 0, 0, 0, loadedWord(width), loadedWord(height), 0xff223355),
        ...native(66, 15, loadedWord(owner), 3450),
        receive(draw),
        ...native(256, loadedWord(draw), loadedWord(width), loadedWord(height)),
        ...native(260, loadedWord(draw), 0, 0),
        ...native(262, loadedWord(draw), 1),
        ...native(66, 34, loadedWord(owner), 3480),
        receive(fes),
        ...native(449, loadedWord(fes), loadedWord(draw)),
        ...native(447, loadedWord(fes), 3530),
        ...native(448, loadedWord(fes)),
        ...native(5),
        receive(clock),
        ...native(71, 3840),
        [59],
      ],
      [
        [3320, 'config.int/owned.xml'],
        [3384, 'video/enabled'],
        [3450, 'Authored draw'],
        [3480, 'Authored scene'],
        [3530, 'screen'],
      ],
    ),
    game = await gameFiles({
      'module.exe': startupVersionImage('2.6.1.23'),
      'config/startup.xml': startup('owned.kcs', 82, 54),
      'config.int': kif([
        ['startup.xml', startup('unused.kcs', 64, 48)],
        ['owned.xml', startupXML(profile, '<video><enabled>17</enabled></video>')],
      ]),
      'kcs.int': kif([['owned.kcs', entry]]),
      'fes.int': kif([
        ['screen.fes', text('#START\nreset_frame\nwait frame 3\n$11=7\nnext IDLE\n#IDLE\n')],
      ]),
    }),
    environment = startupEnvironment(),
    makeCore = () => {
      const { context } = audioFixture();
      return new CatSystem2({
        game,
        canvas: new StartupCanvas(),
        audioContext: context,
        randomSeed: 3,
        uiLanguage: 0x411,
      });
    };
  let core, fresh;
  try {
    core = makeCore();
    await core.initialize();
    const { world } = core,
      { main } = world,
      { machine } = main,
      bank = world.runtime.variableBank(main, false),
      fesID = world.resolveTaskID(machine.load(fes), main.id),
      drawID = world.resolveTaskID(machine.load(draw), main.id),
      scene = world.objects.objects.get(fesID).implementation;
    assert.equal(core.nativeProfile, profile);
    assert.equal(main.name, 'owned.kcs');
    assert.deepEqual([core.canvas.width, core.canvas.height], [82, 54]);
    assert.deepEqual([machine.load(width), machine.load(height)], [82, 54]);
    assert.equal(machine.load(enabled), 17);
    assert.equal(machine.load(clock), 1);
    assert.equal(scene.surface, drawID);
    assert.equal(scene.player.root.commandDelayUntil, -2);
    assert.equal(world.runtime.calls.get('main:447'), 1);
    assert.equal(world.runtime.calls.get('main:448'), 1);
    assert.equal(world.soundConfiguration.loaded, false);
    assert.throws(
      () => world.runtime.native('main', 629, [0, 0, 0], machine, main),
      UnsupportedKCSNative,
    );
    assert.throws(() => nativeABIBehavior(profile, 'sound.completionFrame'), /Unreviewed ABI/);

    await core.step(4);
    await world.graphics.drawTasks.get(drawID).render();
    assert.equal(bank.get(11), 7);
    assert.equal(scene.player.root.label, 'IDLE');
    const checkpoint = await core.snapshot();
    fresh = makeCore();
    await fresh.initialize({ checkpoint });
    assert.deepEqual(await fresh.snapshot(), checkpoint);
    await fresh.step();
    await fresh.world.graphics.drawTasks.get(drawID).render();
    assert.equal(fresh.world.frame, world.frame + 1);
  } finally {
    for (const player of [fresh, core]) {
      await player?.dispose();
      if (player?.world) {
        assert.equal(player.world.objects.objects.size, 0);
        assert.equal(player.world.runtime.handles.records.size, 0);
        assert.equal(player.audio.channels.size, 0);
        assert.equal(player.audio.context.state, 'closed');
      }
    }
    environment.restore();
  }
});

test('2.6.1.23 startup copies a formatted field, logs it and clears a bounded table', async () => {
  const index = 32,
    result = 36,
    field = 128,
    format = 256,
    table = 512,
    size = 3200,
    messages = [],
    program = kcsProgram(
      [
        ...native(14, field, format),
        receive(result),
        ...native(1, field),
        ...native(36, table, 0, size),
        [59],
      ],
      [[format, '項-%02d[G32]']],
    ),
    runtime = new NativeRuntime({
      profile,
      read: async () => program,
      services: { log: (message) => messages.push(message) },
    }),
    { machine } = await runtime.spawn('startup-fields.kcs');
  machine.store(index, 7);
  machine.bytes(field - 1, 9).fill(0xa5);
  machine.bytes(table - 1, size + 2).fill(0xa5);
  await runtime.tick();
  assert.equal(machine.halted, true);
  assert.equal(machine.sp, machine.floor);
  assert.equal(machine.load(result), field);
  assert.deepEqual([...machine.bytes(field - 1, 9)], [0xa5, ...encodeCP932('項-07'), 0, 0, 0xa5]);
  assert.deepEqual(messages, ['項-07']);
  assert.deepEqual(machine.bytes(table, size), new Uint8Array(size));
  assert.equal(machine.load(table - 1, 1), 0xa5);
  assert.equal(machine.load(table + size, 1), 0xa5);
});

test('2.6.1.23 CSS removal consumes two words and leaves the caller stack intact', async () => {
  const handle = 32,
    savedStackWord = 36,
    bytes = 128,
    tag = 0x81234567,
    other = 0x42424242,
    sentinel = 0xa1b2c3d4,
    program = kcsProgram([
      ...native(238, 7),
      receive(handle),
      ...native(244, loadedWord(handle), tag, 4, bytes),
      [45],
      ...native(244, loadedWord(handle), tag, 4, bytes + 4),
      [45],
      ...native(244, loadedWord(handle), other, 4, bytes + 8),
      [45],
      ...push(sentinel),
      ...native(469, 0, tag),
      ...native(469, loadedWord(handle), 0x11223344),
      ...native(469, loadedWord(handle), tag),
      receive(savedStackWord),
      [59],
    ]),
    runtime = new NativeRuntime({ profile, read: async () => program }),
    { machine } = await runtime.spawn('close-remove-entry.kcs');
  machine.bytes(bytes, 12).set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  await runtime.tick();

  assert.equal(machine.halted, true);
  assert.equal(machine.sp, machine.floor);
  assert.equal(machine.load(savedStackWord), sentinel);
  const file = runtime.handles.get(machine.load(handle), 'global-file');
  assert.equal(file.tag, 7);
  assert.equal(file.capacity, 0x80000 - 12);
  assert.deepEqual(
    file.records.map(({ id }) => id),
    [tag, other],
  );
  assert.deepEqual(file.read(tag), Uint8Array.of(5, 6, 7, 8));
  assert.deepEqual(file.read(other), Uint8Array.of(9, 10, 11, 12));
});

test('2.6.1.23 configuration copies use the compact blocks and system voice bounds', async () => {
  const startup = parseNativeXML(
      startupXML(
        profile,
        `<VOICE><vol><master>80</master><bgm>50</bgm></vol>
         <v31><voice>Authored</voice><head>last</head><mastervol>73</mastervol><group>17</group></v31>
         <v32><voice>Outside the table</voice></v32></VOICE>
         <KEYCUSTOMIZE><key63><name>Last key</name></key63><key64><name>Outside</name></key64></KEYCUSTOMIZE>
         <SYSTEMVOICE><ch31><name>Last voice</name><play>5</play></ch31></SYSTEMVOICE>`,
      ),
      'Shift_JIS',
    ),
    configuration = new NativeConfiguration({ profile, startup }),
    sizes = [2856, 56, 28, 12],
    addresses = [64, 3000, 3100, 3200],
    lastVoice = 20 + 31 * 88,
    programs = new Map([
      ['read.kcs', kcsProgram([...native(359, ...addresses), [59]])],
      ['write.kcs', kcsProgram([...native(360, ...addresses.slice(0, 3)), [59]])],
      [
        'voice.kcs',
        kcsProgram([
          ...native(582, 31),
          receive(512),
          ...native(584, 31, 27),
          ...native(582, 32),
          receive(516),
          ...native(583),
          receive(520),
          [59],
        ]),
      ],
    ]),
    runtime = new NativeRuntime({
      profile,
      read: async (name) => programs.get(name),
      services: { configuration, random: { rand: () => 0xffffffff } },
    }),
    [voice, message, effect, window] = configuration.blocks;
  const read = await runtime.spawn('read.kcs');
  read.machine.bytes(0, 4096).fill(0xa5);
  await runtime.tick();
  assert.deepEqual(
    configuration.blocks.map(({ length }) => length),
    sizes,
  );
  for (const [index, address] of addresses.entries()) {
    assert.deepEqual(read.machine.bytes(address, sizes[index]), configuration.blocks[index]);
    assert.equal(read.machine.load(address - 1, 1), 0xa5);
    assert.equal(read.machine.load(address + sizes[index], 1), 0xa5);
  }
  const voiceWords = new DataView(voice.buffer);
  assert.equal(voiceWords.getUint32(lastVoice, true), 1);
  assert.equal(voiceWords.getUint32(lastVoice + 36, true), 73);
  assert.equal(voiceWords.getUint32(lastVoice + 52, true), 17);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => voiceWords.getUint32(2836 + index * 4, true)),
    [80, 50, 100, 100, 100],
  );

  const write = await runtime.spawn('write.kcs'),
    savedWindow = window.slice();
  sizes
    .slice(0, 3)
    .forEach((size, index) =>
      write.machine.bytes(addresses[index], size).set(configuration.blocks[index]),
    );
  write.machine.store(addresses[0] + lastVoice + 52, 42);
  write.machine.store(addresses[1] + 52, 11);
  write.machine.store(addresses[2] + 24, 13);
  await runtime.tick();
  assert.equal(voiceWords.getUint32(lastVoice + 52, true), 42);
  assert.equal(new DataView(message.buffer).getUint32(52, true), 11);
  assert.equal(new DataView(effect.buffer).getUint32(24, true), 13);
  assert.deepEqual(window, savedWindow);
  assert.equal(configuration.fields.data.length, 3992);
  assert.equal(configuration.keys.rows.length, 64);
  assert.equal(configuration.keys.rows[63].name, 'Last key');
  const { systemVoice, sysplay } = configuration.fields;
  assert.equal(systemVoice.length, 2176);
  assert.equal(sysplay.length, 32);
  sysplay.fill(0, 0, 31);
  const query = await runtime.spawn('voice.kcs');
  await runtime.tick();
  assert.deepEqual(
    [query.machine.load(512), query.machine.load(516), query.machine.load(520)],
    [5, 0, 31],
  );
  assert.equal(sysplay[31], 27);
  assert.equal(runtime.handles.records.size, 0);
});
