// SPDX-License-Identifier: MPL-2.0
// Authored default-entry expectations from complete original static branches.
// No original executable or substituted native expression oracle is used here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { defaultFESWorld, loadDefaultFES, profiles } from './fixtures/default-fes-world.mjs';
import { NativeSoundConfiguration } from '../src/native/sound-config.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  hex = (bytes) => Buffer.from(bytes).toString('hex'),
  max = 0xffffffff,
  // These are real untempered MT input words, not replacement RNG outputs.
  // The max endpoint is shared with the public random-cases fixture.
  maxWord = 0x12dd9bb3,
  treeXML = `<document><MASTER><id>100</id><sysplay>1</sysplay></MASTER><PART>
<zero><id>0</id><sysplay>1</sysplay><part>
 <child><id>0</id><sysplay>1</sysplay></child>
 <two><id>2</id><sysplay>2</sysplay><part><leaf><id>3</id><sysplay>1</sysplay></leaf></part></two>
 <minus><id>-1</id><sysplay>1</sysplay></minus><off><id>5</id><sysplay>0</sysplay></off>
</part></zero>
<duplicate><id>0</id><sysplay>0</sysplay></duplicate>
<seven><id>7</id><sysplay>-1</sysplay><part><off><id>3</id><sysplay>0</sysplay></off></part></seven>
<one><id>1</id><sysplay>1</sysplay><part><two><id>2</id><sysplay>1</sysplay></two></part></one>
<minus><id>-1</id><sysplay>1</sysplay></minus><off><id>9</id><sysplay>0</sysplay></off>
<nonone><id>10</id><sysplay>2</sysplay></nonone></PART></document>`;
function tree(profile, { loaded = true, empty = false } = {}) {
  return new NativeSoundConfiguration({
    profile,
    loaded,
    ...(empty ? {} : { document: parseXML(treeXML) }),
  });
}
function arm(world, words = [maxWord, 0, 0, 0]) {
  world.random.integer.words.fill(0);
  world.random.integer.words.set(words);
  world.random.integer.index = 0;
  return world.random.real.snapshot();
}
function voices(world, rows) {
  const fields = world.configuration.fields;
  fields.systemVoice.fill(0);
  for (const [id, flag, name = 'v'] of rows) {
    fields.systemVoice.set(ascii(name), id * 32);
    fields.sysplay[id] = flag;
  }
}
function expectedWords(before, changes = {}) {
  const result = [...before];
  for (const [index, value] of Object.entries(changes)) result[Number(index)] = value >>> 0;
  return result;
}
async function screen(t, profile, blocks, sound = tree(profile)) {
  const source = ascii(
      '#START\nnext IDLE\n#IDLE\n' +
        Object.entries(blocks)
          .map(([name, commands]) => '#' + name + '\n' + commands + '\nbreak\n')
          .join(''),
    ),
    world = await defaultFESWorld(profile, { 'screen.fes': source }, { soundConfiguration: sound });
  t.after(() => world.close());
  for (const method of ['sound', 'soundCommand', 'nativeMovie', 'nativeWindowAction'])
    world.host[method] = () =>
      assert.fail('Selection started an external/audio operation: ' + method);
  const h = await loadDefaultFES(world);
  assert.ok(h.instance.runtime instanceof FESCoordinator);
  assert.equal(world.soundConfiguration, sound);
  assert.equal(world.runtime.services.soundConfiguration, sound);
  await h.task.tick();
  const record = world.objects.objects.get(world.main.id),
    bank = world.runtime.variableBank(record),
    strings = world.runtime.stringBank(record);
  bank.dirty = false;
  return { ...h, world, bank, strings, source, testContext: t };
}
function trace(h, { suffix = false, sink = true, buffer = false } = {}) {
  const { world, instance, bank } = h,
    events = [],
    returned = [],
    real = world.random.real.snapshot(),
    counts = {
      command: 0,
      returned: 0,
      rejected: 0,
      argument: 0,
      bank: 0,
      SCRIPT: 0,
      eval: 0,
      write: 0,
      rng: 0,
      debug: 0,
      resource: 0,
    };
  h.testContext?.after(() =>
    h.testContext.diagnostic(
      'system voice provider counts: ' +
        JSON.stringify({
          profile: world.profile,
          context: h.traceLabel ?? 'ordinary World',
          ...counts,
        }),
    ),
  );
  let active = false;
  for (const [target, method, kind] of [
    [h.strings, 'expandBytes', 'bank'],
    [world.configuration.scriptReplacements, 'apply', 'SCRIPT'],
    [instance, 'value', 'eval'],
    [instance, 'setGlobal', 'write'],
    [world.random, 'rand', 'rng'],
  ]) {
    const original = target[method].bind(target);
    target[method] = (...args) => {
      if (active) counts[kind]++;
      if (active && kind !== 'rng')
        events.push([kind, ...args.map((v) => (v instanceof Uint8Array ? hex(v) : v))]);
      const result = original(...args);
      if (active && kind === 'rng') events.push(['rng', result]);
      return result;
    };
  }
  const argument = instance.argumentBytes.bind(instance);
  instance.argumentBytes = (...args) => {
    if (active) counts.argument++;
    const result = argument(...args),
      bytes =
        buffer || suffix
          ? Buffer.concat([Buffer.from(result), ...(suffix ? [Buffer.from('\0++$10')] : [])])
          : result;
    returned.push({ bytes, before: hex(bytes) });
    return bytes;
  };
  if (sink)
    world.host.nativeDebugOutput = function (bytes) {
      assert.equal(this, world.host);
      assert.equal(bytes.constructor, Uint8Array);
      assert.equal(typeof bytes.then, 'undefined');
      if (active) counts.debug++;
      if (active) events.push(['debug', hex(bytes)]);
    };
  const command = instance.runtime.systemVoiceCommand.bind(instance.runtime);
  const read = world.game.read.bind(world.game);
  world.game.read = (...args) => {
    if (active) counts.resource++;
    return read(...args);
  };
  instance.runtime.systemVoiceCommand = (...args) => {
    active = true;
    counts.command++;
    const records = instance.runtime.pendingRecords.length,
      pending = instance.player.pending.size;
    try {
      const value = command(...args);
      assert.equal(typeof value, 'number');
      assert.equal(value, 0);
      events.push(['return', args[0], value]);
      counts.returned++;
      assert.equal(instance.runtime.pendingRecords.length, records);
      assert.equal(instance.player.pending.size, pending);
      return value;
    } catch (error) {
      counts.rejected++;
      throw error;
    } finally {
      active = false;
    }
  };
  return {
    events,
    clear: () => (events.length = 0),
    writes: () => events.filter(([kind]) => kind === 'write'),
    draws: () => events.filter(([kind]) => kind === 'rng'),
    debug: () => events.filter(([kind]) => kind === 'debug'),
    unchanged: () => {
      for (const record of returned) assert.equal(hex(record.bytes), record.before);
      assert.equal(world.nativeEngine, undefined);
      assert.deepEqual(world.random.real.snapshot(), real);
      assert.deepEqual(instance.player.debugLogs, []);
      assert.equal(bank.capacity, 64);
      assert.equal(counts.resource, 0);
    },
  };
}
const operand = (source, expanded = source, value = expanded) => [
    ['bank', hex(ascii(source))],
    ['SCRIPT', hex(ascii(expanded))],
    ...(value === '' ? [] : [['eval', value]]),
  ],
  log = (name, value) => ['debug', hex(ascii('select ' + name + ' ' + value))];

for (const profile of profiles) {
  test(`${profile} system voice missing destination has no reads, writes, random, output or queue`, async (t) => {
    const h = await screen(t, profile, { RUN: 'sysvoice\nsysvoiceex' }),
      real = arm(h.world),
      before = [...h.bank.words],
      x = trace(h);
    await h.task.player.notify('RUN');
    assert.deepEqual(x.events, [
      ['return', 'sysvoice', 0],
      ['return', 'sysvoiceex', 0],
    ]);
    assert.deepEqual([...h.bank.words], before);
    assert.equal(h.bank.dirty, false);
    assert.equal(h.world.random.integer.index, 0);
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} present empty destination and candidate are zero only in these frontends`, async (t) => {
    const h = await screen(t, profile, {
      BASIC: 'sysvoice $str1 $str1',
      TREE: 'sysvoiceex $str1 $str1',
    });
    voices(h.world, [[0, 1]]);
    h.strings.setBytes(1, new Uint8Array());
    h.instance.setGlobal(0, 99);
    const before = [...h.bank.words],
      real = arm(h.world),
      x = trace(h);
    assert.throws(() => h.instance.value(''), /Incomplete expression/);
    for (const [block, name, raw] of [
      ['BASIC', 'sysvoice', max],
      ['TREE', 'sysvoiceex', 0],
    ]) {
      x.clear();
      await h.task.player.notify(block);
      assert.deepEqual(x.events, [
        ...operand('$str1', '', ''),
        ...operand('$str1', '', ''),
        ['rng', raw],
        ['write', 0, 0],
        log(name, 0),
        ['return', name, 0],
      ]);
    }
    assert.deepEqual([...h.bank.words], expectedWords(before, { 0: 0 }));
    assert.equal(h.world.random.integer.index, 2);
    assert.deepEqual(h.world.random.real.snapshot(), real);
    assert.throws(() => h.instance.value(''), /Incomplete expression/);
    x.unchanged();
  });

  test(`${profile} basic default selection uses current nonempty names and nonzero flags in all48 ascending slots`, async (t) => {
    const h = await screen(t, profile, { RUN: 'sysvoice 20\nsysvoice 20\nsysvoice 20' });
    voices(h.world, [
      [0, 1],
      [1, 1, ''],
      [2, 0],
      [3, 2],
      [47, max],
    ]);
    const real = arm(h.world, [maxWord, 3, 2]),
      before = [...h.bank.words],
      x = trace(h);
    await h.task.player.notify('RUN');
    assert.deepEqual(x.writes(), [
      ['write', 20, 0],
      ['write', 20, 3],
      ['write', 20, 47],
    ]);
    assert.deepEqual(x.draws(), [
      ['rng', max],
      ['rng', 4194451],
      ['rng', 2],
    ]);
    assert.deepEqual([...h.bank.words], expectedWords(before, { 20: 47 }));
    assert.deepEqual(x.debug(), [log('sysvoice', 0), log('sysvoice', 3), log('sysvoice', 47)]);
    assert.equal(h.world.random.integer.index, 3);
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} basic provided candidates retain weight and exact bank SCRIPT numeric read order`, async (t) => {
    const h = await screen(t, profile, {
      RUN: 'sysvoice $str1 $str2 $str2 $str3 $str2 -1 48 ++$10',
    });
    voices(h.world, [
      [3, 2],
      [4, 1],
    ]);
    h.strings.setBytes(1, ascii('DEST'));
    h.strings.setBytes(2, ascii('X'));
    h.strings.setBytes(3, ascii('4'));
    h.world.configuration.scriptReplacements.add(ascii('DEST'), ascii('20'));
    h.world.configuration.scriptReplacements.add(ascii('X'), ascii('3'));
    h.instance.setGlobal(10, 47);
    const before = [...h.bank.words],
      real = arm(h.world),
      x = trace(h);
    await h.task.player.notify('RUN');
    assert.deepEqual(x.events, [
      ...operand('$str1', 'DEST', '20'),
      ...operand('$str2', 'X', '3'),
      ...operand('$str2', 'X', '3'),
      ...operand('$str3', '4'),
      ...operand('$str2', 'X', '3'),
      ...operand('-1'),
      ...operand('48'),
      ...operand('++$10'),
      ['write', 10, 48],
      ['rng', max],
      ['write', 20, 3],
      log('sysvoice', 3),
      ['return', 'sysvoice', 0],
    ]);
    assert.deepEqual([...h.bank.words], expectedWords(before, { 10: 48, 20: 3 }));
    assert.equal(h.world.random.integer.index, 1);
    assert.equal(h.world.random.rand(), 0, 'the next user sees the shared next integer');
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} basic empty candidates and uint32 output bounds preserve words; undefined buffer/stack overflow is refused`, async (t) => {
    const h = await screen(t, profile, {
      EMPTY: 'sysvoice 20 -1 48',
      INVALID: 'sysvoice -1 3\nsysvoice 64 3',
    });
    voices(h.world, [[3, 1]]);
    const real = arm(h.world),
      before = [...h.bank.words],
      x = trace(h);
    await h.task.player.notify('EMPTY');
    assert.deepEqual(x.draws(), []);
    assert.deepEqual(x.debug(), []);
    assert.deepEqual(x.writes(), [['write', 20, -1]]);
    const afterEmpty = expectedWords(before, { 20: -1 });
    h.bank.dirty = false;
    x.clear();
    await h.task.player.notify('INVALID');
    assert.deepEqual(x.writes(), [
      ['write', max, 3],
      ['write', 64, 3],
    ]);
    assert.deepEqual([...h.bank.words], afterEmpty);
    assert.equal(h.bank.dirty, true);
    assert.deepEqual(x.draws(), [
      ['rng', max],
      ['rng', 0],
    ]);
    assert.deepEqual(x.debug(), [log('sysvoice', 3), log('sysvoice', 3)]);
    h.strings.setBytes(4, ascii('0'.repeat(511)));
    x.clear();
    assert.deepEqual(h.instance.execute(ascii('sysvoice 20 $str4'), [], 0), {});
    assert.deepEqual(x.writes(), [['write', 20, -1]]);
    assert.deepEqual(x.draws(), []);
    h.strings.setBytes(4, ascii('0'.repeat(512)));
    x.clear();
    assert.throws(() => h.instance.execute(ascii('sysvoice 20 $str4'), [], 0), /512-byte/);
    assert.deepEqual(x.writes(), []);
    assert.deepEqual(x.draws(), []);
    x.clear();
    assert.throws(
      () => h.instance.execute(ascii('sysvoice 20 ' + '0'.repeat(512)), [], 0),
      /512-byte/,
    );
    assert.deepEqual(x.writes(), []);
    assert.deepEqual(x.draws(), []);
    assert.deepEqual(
      h.instance.execute(ascii('sysvoice 20 ' + Array(128).fill('3').join(' ')), [], 0),
      {},
    );
    x.clear();
    assert.throws(
      () => h.instance.execute(ascii('sysvoice 20 ' + Array(129).fill('3').join(' ')), [], 0),
      /stack capacity/,
    );
    assert.deepEqual(x.draws(), []);
    assert.deepEqual(x.debug(), []);
    assert.deepEqual(x.writes(), []);
    assert.deepEqual([...h.bank.words], expectedWords(before, { 20: 3 }));
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} destination aliases preserve every counter write before the final selection overwrite`, async (t) => {
    const h = await screen(t, profile, {
      BASIC: 'sysvoice ++$10 ++$10 ++$10 11',
      TREE: 'sysvoiceex ++$10 ++$10,++$10',
    });
    voices(h.world, [
      [11, 1],
      [12, 1],
    ]);
    arm(h.world);
    const x = trace(h);
    h.instance.setGlobal(10, 9);
    await h.task.player.notify('BASIC');
    assert.deepEqual(x.writes(), [
      ['write', 10, 10],
      ['write', 10, 11],
      ['write', 10, 12],
      ['write', 10, 11],
    ]);
    assert.equal(h.instance.global(10), 11);
    h.instance.setGlobal(10, 9);
    x.clear();
    await h.task.player.notify('TREE');
    assert.deepEqual(x.writes(), [
      ['write', 10, 10],
      ['write', 10, 11],
      ['write', 10, 12],
      ['write', 10, 12],
    ]);
    assert.equal(h.instance.global(10), 12);
    assert.deepEqual(x.draws(), [['rng', 0]]);
    x.unchanged();
  });

  test(`${profile} ex readiness is tested after destination and before any supplied path read`, async (t) => {
    const h = await screen(
      t,
      profile,
      { RUN: 'sysvoiceex ++$10 ++$10 $str99' },
      tree(profile, { loaded: false }),
    );
    h.instance.setGlobal(10, 9);
    const real = arm(h.world),
      before = [...h.bank.words],
      x = trace(h);
    assert.ok(h.world.soundConfiguration.master);
    await h.task.player.notify('RUN');
    assert.deepEqual(x.events, [
      ...operand('++$10'),
      ['write', 10, 10],
      ['write', 10, -1],
      ['return', 'sysvoiceex', 0],
    ]);
    assert.deepEqual([...h.bank.words], expectedWords(before, { 10: -1 }));
    assert.equal(h.world.random.integer.index, 0);
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} ex supplied paths use first matches, retained sibling levels and final nonzero current/default values`, async (t) => {
    const paths = ['0', '0,2', '0,5', '7', '7,3', '999,1,2', '0,999,2', '0,999', '9', '-1'],
      expected = [0, 2, -1, 7, -1, 2, 2, 999, -1, -1],
      h = await screen(t, profile, {
        RUN: paths.map((path) => 'sysvoiceex 20 ' + path).join('\n'),
      }),
      real = arm(h.world),
      before = [...h.bank.words],
      x = trace(h),
      sound = h.world.soundConfiguration,
      snapshot = sound.snapshot();
    assert.equal(sound.systemVoiceAtIDPath([999]), profile.startsWith('sdk-') ? -1 : 1);
    assert.equal(sound.systemVoiceAtIDPath([0, 999, 2]), 2);
    assert.deepEqual(sound.snapshot(), snapshot);
    await h.task.player.notify('RUN');
    assert.deepEqual(
      x.writes(),
      expected.map((value) => ['write', 20, value]),
    );
    assert.deepEqual(x.draws(), [['rng', max], ...Array.from({ length: 6 }, () => ['rng', 0])]);
    assert.deepEqual(
      x.debug(),
      [0, 2, 7, 2, 2, 999, -1].map((value) => log('sysvoiceex', value)),
    );
    assert.deepEqual([...h.bank.words], expectedWords(before, { 20: -1 }));
    assert.deepEqual(sound.snapshot(), snapshot);
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} ex comma bytes preserve empty components, one expansion and first NUL with Buffer results`, async (t) => {
    const h = await screen(t, profile, {
      EMPTY: 'sysvoiceex 20 $str1',
      SIDE: 'sysvoiceex 20 $str2',
    });
    const caller = Buffer.from(',0,,0,');
    h.strings.setBytes(1, caller);
    h.strings.setBytes(2, ascii('X'));
    h.world.configuration.scriptReplacements.add(ascii('X'), ascii('++$10,,++$10,'));
    h.instance.setGlobal(10, 9);
    arm(h.world);
    const before = [...h.bank.words],
      x = trace(h, { suffix: true });
    await h.task.player.notify('EMPTY');
    assert.deepEqual(x.events, [
      ...operand('20'),
      ...operand('$str1', ',0,,0,', '0'),
      ['eval', '0'],
      ['rng', max],
      ['write', 20, 0],
      log('sysvoiceex', 0),
      ['return', 'sysvoiceex', 0],
    ]);
    assert.equal(h.instance.global(10), 9);
    x.clear();
    await h.task.player.notify('SIDE');
    assert.deepEqual(x.events, [
      ...operand('20'),
      ...operand('$str2', 'X', ''),
      ['eval', '++$10'],
      ['write', 10, 10],
      ['eval', '++$10'],
      ['write', 10, 11],
      ['rng', 0],
      ['write', 20, 0],
      log('sysvoiceex', 0),
      ['return', 'sysvoiceex', 0],
    ]);
    assert.deepEqual([...h.bank.words], expectedWords(before, { 10: 11, 20: 0 }));
    assert.equal(caller.toString(), ',0,,0,');
    x.unchanged();
  });

  test(`${profile} ex default walk is PART preorder with strict current one, repeated IDs and no MASTER/type filter`, async (t) => {
    const h = await screen(t, profile, { RUN: 'sysvoiceex 20' }),
      sound = h.world.soundConfiguration,
      before = sound.snapshot(),
      real = arm(h.world),
      x = trace(h),
      ids = sound.systemVoiceCandidates();
    assert.deepEqual(ids, [0, 0, 3, -1, 1, 2, -1]);
    ids.length = 0;
    assert.deepEqual(sound.systemVoiceCandidates(), [0, 0, 3, -1, 1, 2, -1]);
    await h.task.player.notify('RUN');
    assert.deepEqual(x.draws(), [['rng', max]]);
    assert.deepEqual(x.writes(), [['write', 20, -1]]);
    assert.deepEqual(x.debug(), [log('sysvoiceex', -1)], 'a selected -1 is not an empty list');
    assert.deepEqual(sound.snapshot(), before);
    sound.parts[5].current.sysplay = 1;
    assert.deepEqual(sound.systemVoiceCandidates(), [0, 0, 3, -1, 1, 2, -1, 9]);
    assert.equal(sound.parts[5].defaults.sysplay, 0);
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} loaded sound without MASTER preserves explicit-path defaults and empty traversal without fabricating a tree`, async (t) => {
    const h = await screen(t, profile, { PROVIDED: 'sysvoiceex 20 444', ABSENT: 'sysvoiceex 21' }),
      sound = h.world.soundConfiguration,
      real = arm(h.world),
      before = [...h.bank.words],
      x = trace(h);
    // The existing sound-task constructor rejects invalid-tree startup. This
    // case proves the frontend's current-state branch through the one service.
    sound.restore(tree(profile, { empty: true }).snapshot());
    t.diagnostic(
      'Current invalid-tree state restored after valid startup; invalid-tree startup remains D8.',
    );
    assert.equal(sound.loaded, true);
    assert.equal(sound.master, null);
    assert.throws(() => sound.get('sysplay', { by: 'idPath', ids: [444] }), /not initialized/);
    assert.equal(sound.systemVoiceAtIDPath([]), profile.startsWith('sdk-') ? -1 : 1);
    await h.task.player.notify('PROVIDED');
    await h.task.player.notify('ABSENT');
    assert.deepEqual(x.writes(), [
      ['write', 20, 444],
      ['write', 21, -1],
    ]);
    assert.deepEqual(x.draws(), [['rng', max]]);
    assert.deepEqual(x.debug(), [log('sysvoiceex', 444)]);
    assert.deepEqual([...h.bank.words], expectedWords(before, { 20: 444, 21: -1 }));
    assert.equal(sound.master, null);
    assert.deepEqual(sound.parts, []);
    assert.deepEqual(h.world.random.real.snapshot(), real);
    x.unchanged();
  });

  test(`${profile} fresh serialized World restores only current selection inputs and shared RNG without replay or audio lifecycle`, async (t) => {
    const h = await screen(t, profile, {
      FIRST: 'sysvoice 20',
      NEXT: 'sysvoice 21\nsysvoiceex 22',
    });
    voices(h.world, [
      [3, 1],
      [8, 1],
    ]);
    const real = arm(h.world, [maxWord, 0, 2, maxWord]),
      x = trace(h, { sink: false });
    await h.task.player.notify('FIRST');
    assert.equal(h.instance.global(20), 8);
    assert.deepEqual(x.debug(), [], 'no installed debug sink is a valid selection path');
    h.world.configuration.fields.sysplay[3] = 0;
    const disable = (nodes) => {
      for (const node of nodes) {
        node.current.sysplay = 0;
        disable(node.children);
      }
    };
    disable(h.world.soundConfiguration.parts);
    h.world.soundConfiguration.parts[0].children[1].children[0].current.sysplay = 1;
    h.world.soundConfiguration.parts[6].current.sysplay = 1;
    const state = await deserializeCheckpoint(await serializeCheckpoint(h.world.snapshot())),
      fresh = await defaultFESWorld(profile, {}, { initialize: false }),
      reads = [],
      replay = [];
    t.after(() => fresh.close());
    fresh.host.nativeDebugOutput = (bytes) => replay.push(hex(bytes));
    for (const method of ['sound', 'soundCommand', 'nativeMovie', 'nativeWindowAction'])
      fresh.host[method] = () => assert.fail('Fresh selection invoked external/audio ' + method);
    const read = fresh.game.read.bind(fresh.game);
    fresh.game.read = async (name) => {
      assert.equal(name, 'case.kcs');
      const bytes = await read(name);
      reads.push({
        name,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      return bytes;
    };
    await fresh.restore(state);
    const task = fresh.objects.objects.get(h.id).implementation,
      instance = task.player.root,
      bank = fresh.runtime.variableBank(fresh.objects.objects.get(fresh.main.id)),
      strings = fresh.runtime.stringBank(fresh.objects.objects.get(fresh.main.id)),
      fx = trace({
        world: fresh,
        task,
        instance,
        bank,
        strings,
        testContext: t,
        traceLabel: 'fresh World',
      });
    assert.ok(instance.runtime instanceof FESCoordinator);
    assert.deepEqual(replay, []);
    assert.equal(fresh.random.integer.index, 1);
    assert.deepEqual(fresh.random.real.snapshot(), real);
    assert.deepEqual(fresh.soundConfiguration.systemVoiceCandidates(), [3, 10]);
    assert.equal(fresh.configuration.fields.sysplay[3], 0);
    await task.player.notify('NEXT');
    assert.deepEqual(fx.draws(), [
      ['rng', 0],
      ['rng', 2],
    ]);
    assert.deepEqual(fx.writes(), [
      ['write', 21, 8],
      ['write', 22, 3],
    ]);
    assert.deepEqual(fx.debug(), [log('sysvoice', 8), log('sysvoiceex', 3)]);
    assert.equal(instance.global(20), 8);
    assert.equal(fresh.random.rand(), max);
    assert.deepEqual(fresh.random.real.snapshot(), real);
    assert.deepEqual(
      reads.map(({ name }) => name),
      ['case.kcs'],
    );
    t.diagnostic('existing scheduler restore source read: ' + JSON.stringify(reads));
    const index = fresh.random.integer.index,
      events = [...fx.events];
    await fresh.objects.release(h.id);
    assert.throws(() => instance.execute(ascii('sysvoice 23'), [], 0), /owner is closed/);
    assert.equal(fresh.random.integer.index, index);
    assert.deepEqual(fx.events, events);
    assert.deepEqual(instance.runtime.pendingRecords, []);
    fx.unchanged();
    x.unchanged();
  });
}
