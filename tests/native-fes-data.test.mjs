// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

async function fixture(profile, source, extra = {}) {
  const contents = new Map([
      ['folder/Alpha.txt', Uint8Array.of(1)],
      ['folder/beta.dat', Uint8Array.of(2)],
      ['folder/subdir/gamma.txt', Uint8Array.of(3)],
      ['other.txt', Uint8Array.of(4)],
    ]),
    game = memoryGame({
      'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [43, 0x41, 0], [59]]),
      'data.fes': encodeCP932(source),
      'words.tsv': Uint8Array.from([
        ...encodeCP932('7\talpha\tbeta\r\n9\t"Hello, quoted"\t末尾\r\n-3\tnegative\tword\r\n25\t'),
        ...new TextEncoder().encode('日'),
        ...encodeCP932('\r\n26\t'),
        0xff,
        0xfe,
        ...encodeCP932('\r\n'),
      ]),
      ...extra,
    });
  game.width = 64;
  game.height = 48;
  game.resolveCategory = (name, category) => {
    const path = name.includes('.') ? name : `${name}.${category === 'fes' ? 'fes' : 'kcs'}`;
    return game.has(path) ? path : null;
  };
  game.readCategory = async (name, category) => {
    const path = game.resolveCategory(name, category);
    return path === null ? null : game.read(path);
  };
  game.requireCategory = async (name, category) => {
    const bytes = await game.readCategory(name, category);
    if (bytes === null) throw new Error(`Missing ${category} ${name}`);
    return bytes;
  };
  const random = new ParticleRandom();
  return new NativeWorld({
    game,
    profile,
    images: {},
    host: {},
    random,
    configuration: new NativeConfiguration({ profile }),
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: {
      read: async (name) => contents.get(name.replaceAll('\\', '/')) ?? null,
      write: async () => true,
      remove: async () => true,
      stat: async () => null,
      list: async () => [...contents].map(([name, bytes]) => ({ name, size: bytes.length })),
    },
  });
}
async function start(world) {
  world.root = await world.objects.create({ kind: 1, name: 'Authored Top', frameRate: 60 });
  await world.objects.create({ kind: 11, parent: world.root, name: 'Authored Input' });
  world.main = await world.spawnScript('main.kcs');
  await world.tick();
  const id = await world.objects.create({ kind: 34, parent: world.main.id }),
    task = world.objects.objects.get(id).implementation;
  await task.load('data', world.main);
  return task;
}

for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74']) {
  test(`${profile} JS STRTABLE parses rows and reads exact columns across a fresh World`, async () => {
    const source = `#DEFINE
STRTABLE table
#OBJECT FILE
table words.tsv
#START
table get 7 0 10 20
table get 9 0 11 21
table get 9 1 12 22
table get -3 0 13 23
next WAIT
#WAIT
#MISSING
table get 111 0 10 24
table get 7 2 11 25
#QUERY
table get 7 1 14 26
#RAW
table get 25 0 18 27
table get 26 0 19 28
`,
      world = await fixture(profile, source);
    let restored;
    try {
      const task = await start(world),
        object = task.player.root.byKey.get('table');
      assert.equal(object.nativeDataState.rows.length, 5);
      assert.equal(task.player.strings[10], undefined);
      await task.tick();
      assert.deepEqual(
        [20, 21, 22, 23].map((id) => task.player.globals[id]),
        [1, 1, 1, 1],
      );
      assert.deepEqual(
        [10, 11, 12, 13].map((id) => task.player.strings[id]),
        ['alpha', 'Hello, quoted', '末尾', 'negative'],
      );
      assert.deepEqual(
        [20, 21, 22, 23].map((id) => task.player.globals[id]),
        [1, 1, 1, 1],
      );
      await task.player.notify('MISSING');
      assert.deepEqual(
        [24, 25].map((id) => task.player.globals[id]),
        [0, 0],
      );
      assert.deepEqual(
        [10, 11].map((id) => task.player.strings[id]),
        ['alpha', 'Hello, quoted'],
      );
      await task.player.notify('RAW');
      const bank = world.runtime.handles.get(
        world.objects.objects.get(task.player.root.runtimeID).context.stringBank,
        'string-bank',
      );
      assert.deepEqual(bank.getBytes(18), new TextEncoder().encode('日'));
      assert.deepEqual(bank.getBytes(19), Uint8Array.of(0xff, 0xfe));
      assert.equal(task.player.unsupportedCommands.size, 0);
      assert.equal(Boolean(world.nativeEngine), false, 'data objects never construct the EXE host');
      restored = await fixture(profile, source);
      await restored.restore(world.snapshot());
      const candidate = restored.objects.objects.get(task.player.root.runtimeID).implementation;
      await candidate.player.notify('QUERY');
      assert.equal(candidate.player.strings[14], 'beta');
      assert.equal(candidate.player.globals[26], 1);
    } finally {
      await restored?.close();
      await world.close();
    }
  });
  test(`${profile} JS FILELIST enumerates native paths and preserves its map through restore`, async () => {
    const source = `#DEFINE
FILELIST files
FILELIST filtered
#START
files make folder *
files get count 30
files get name 31 15 0
files get fullpath 32 16 1
next WAIT
#WAIT
#MISSING
files get name 33 15 99
#QUERY
files get name 34 17 1
#FILTER
filtered make folder *.txt
filtered get count 35
#ADD
files make folder/subdir *
files get count 36
`,
      world = await fixture(profile, source);
    let restored;
    try {
      const task = await start(world);
      const patterns = [],
        find = world.findNativeFiles.bind(world);
      world.findNativeFiles = (pattern) => {
        patterns.push(pattern);
        return find(pattern);
      };
      await task.tick();
      assert.equal(task.player.globals[30], 3, JSON.stringify(patterns));
      assert.deepEqual(
        [31, 32].map((id) => task.player.globals[id]),
        [1, 1],
      );
      assert.equal(task.player.strings[15], 'Alpha.txt');
      assert.equal(task.player.strings[16], 'folder\\beta.dat');
      await task.player.notify('FILTER');
      assert.equal(task.player.globals[35], profile.startsWith('sdk-') ? 1 : 0);
      await task.player.notify('ADD');
      // JS excludes the original game engine's uninitialized pattern tail read.
      assert.equal(task.player.globals[36], 4);
      await task.player.notify('MISSING');
      assert.equal(task.player.globals[33], 0);
      assert.equal(task.player.strings[15], 'Alpha.txt');
      assert.equal(task.player.unsupportedCommands.size, 0);
      assert.equal(Boolean(world.nativeEngine), false, 'data objects never construct the EXE host');
      restored = await fixture(profile, source);
      await restored.restore(world.snapshot());
      const candidate = restored.objects.objects.get(task.player.root.runtimeID).implementation;
      await candidate.player.notify('QUERY');
      assert.equal(candidate.player.globals[34], 1);
      assert.equal(candidate.player.strings[17], 'beta.dat');
    } finally {
      await restored?.close();
      await world.close();
    }
  });
}
