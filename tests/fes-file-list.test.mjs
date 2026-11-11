// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeFESData } from '../src/native/fes-data.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { memoryGame } from './helpers.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const contents = new Map([
  ['folder/Alpha.txt', Uint8Array.of(1)],
  ['folder/beta.dat', Uint8Array.of(2)],
  ['folder/subdir/gamma.txt', Uint8Array.of(3)],
  ['other/alpha.txt', Uint8Array.of(4)],
  ['other/zeta.txt', Uint8Array.of(5)],
]);
async function fixture(profile, script = 'next WAIT') {
  const game = memoryGame({
      'data.fes': encodeCP932(`#DEFINE
FILELIST files
FILELIST filtered
FILELIST group[2]
#START
${script}
next WAIT
#WAIT
`),
    }),
    bank = new NativeVariableBank(),
    strings = new NativeStringBank(),
    runtime = new NativeRuntime({ profile, read: async () => null }),
    searches = [];
  bank.initialize(100);
  const variableBank = runtime.handles.add('variable-bank', bank),
    stringBank = runtime.handles.add('string-bank', strings),
    world = {
      profile,
      runtime,
      objects: { objects: new Map([[42, { context: { variableBank, stringBank } }]]) },
      storage: {
        async list() {
          return [...contents].map(([name, bytes]) => ({ name, size: bytes.length }));
        },
        async read(name) {
          return contents.get(name) ?? null;
        },
      },
      findNativeFiles(pattern) {
        searches.push(pattern);
        return NativeWorld.prototype.findNativeFiles.call(this, pattern);
      },
      getNativeFeature() {
        throw new Error('FILELIST must not request the EXE');
      },
    },
    service = new NativeFESData(world),
    player = new FESPlayer(
      game,
      {},
      {},
      runtime.bankView(variableBank),
      runtime.bankView(stringBank, 'string-bank'),
    );
  player.nativeData = service;
  await player.start('data');
  player.root.runtimeID = 42;
  return { player, service, bank, strings, searches, world, script };
}

test('FILELIST current token conversion is independent of history, ordering and repeated stars', async () => {
  for (const profile of profiles) {
    const histories = [[], ['*.txt'], ['*.dat', '*.txt'], ['*'], ['*.txt', '*', '*']];
    for (const history of histories) {
      const f = await fixture(profile);
      for (const pattern of history)
        await f.service.command(f.player.root, f.player.root.byKey.get('filtered'), 'make', [
          'folder',
          pattern,
        ]);
      await f.service.command(f.player.root, f.player.root.byKey.get('files'), 'make', [
        'folder',
        '*',
      ]);
      await f.service.command(f.player.root, f.player.root.byKey.get('files'), 'make', [
        'folder/subdir',
        '*',
      ]);
      await f.service.command(f.player.root, f.player.root.byKey.get('files'), 'get', [
        'count',
        '20',
      ]);
      assert.deepEqual(f.searches.slice(-2), ['folder\\*', 'folder/subdir\\*']);
      assert.equal(f.bank.get(20), 4);
    }
    const before = await fixture(profile, 'files make folder *\nfiltered make folder *.txt'),
      after = await fixture(profile, 'filtered make folder *.txt\nfiles make folder *');
    await before.player.step();
    await after.player.step();
    assert.deepEqual(
      before.player.root.byKey.get('files').nativeDataState,
      after.player.root.byKey.get('files').nativeDataState,
    );
    assert.equal(
      before.player.root.byKey.get('filtered').nativeDataState.entries.length,
      profile === profiles[0] ? 1 : 0,
    );
    assert.ok(before.searches.includes(profile === profiles[0] ? 'folder\\*.txt' : 'folder\\⸪硴t'));
  }
});

test('FILELIST accumulates basename keys, keeps the first full path and resumes indexed lookups after restore', async () => {
  for (const profile of profiles) {
    const f = await fixture(
      profile,
      `files make folder *
files make other *
files get count 20
files get fullpath 21 1 0
files get arbitrary-selector 22 2 1
files get name 23 1 99
`,
    );
    await f.player.step();
    assert.equal(f.bank.get(20), 4);
    assert.equal(f.strings.get(1), 'folder\\Alpha.txt');
    assert.equal(f.strings.get(2), 'beta.dat');
    assert.equal(f.bank.get(21), 1);
    assert.equal(f.bank.get(22), 1);
    assert.equal(f.bank.get(23), 0);
    const restored = await fixture(profile, f.script);
    await restored.player.restore(f.player.snapshot());
    restored.player.root.runtimeID = 42;
    await restored.service.command(
      restored.player.root,
      restored.player.root.byKey.get('files'),
      'get',
      ['fullpath', '24', '3', '3'],
    );
    assert.equal(restored.strings.get(3), 'other\\zeta.txt');
    assert.equal(restored.bank.get(24), 1);
    assert.deepEqual(restored.searches, [], 'restoration and queries do not enumerate again');
  }
});

test('FILELIST whole-group make is inert and native missing-output bank semantics stay explicit', async () => {
  for (const profile of profiles) {
    const f = await fixture(profile, 'group make folder *\ngroup[1] make folder *');
    await f.player.step();
    assert.equal(f.player.root.byKey.get('group[0]').nativeDataState.entries.length, 0);
    assert.equal(f.player.root.byKey.get('group[1]').nativeDataState.entries.length, 3);
    assert.deepEqual(f.searches, ['folder\\*']);
    f.bank.dirty = false;
    await f.service.command(f.player.root, f.player.root.byKey.get('group[1]'), 'get', [
      'name',
      '-1',
      '-1',
      '0',
    ]);
    assert.equal(f.strings.get(0xffffffff), 'Alpha.txt');
    assert.equal(f.bank.dirty, true);
    const defaults = await fixture(profile, 'files make folder\nfiles get count 20');
    await defaults.player.step();
    assert.equal(defaults.bank.get(20), profile === profiles[0] ? 3 : 0);
  }
});

test('FILELIST missing string-bank storage fails explicitly before reporting successful output', async () => {
  const f = await fixture(profiles[0], 'files make folder *');
  await f.player.step();
  f.world.objects.objects.get(42).context.stringBank = 0;
  f.bank.set(20, 17);
  await assert.rejects(
    f.service.command(f.player.root, f.player.root.byKey.get('files'), 'get', [
      'name',
      '20',
      '1',
      '0',
    ]),
    /FILELIST string result requires its string bank/,
  );
  assert.equal(f.bank.get(20), 17);
});
