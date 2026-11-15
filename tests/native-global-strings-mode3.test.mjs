// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { parseXML } from '../src/xml.mjs';
import { kif } from './helpers.mjs';

const gameProfile = 'nekopara-vol3-engine-2.6.1.76';
const sdkProfile = 'sdk-4.01-engine-2.6.1.74';
const text = (value) => new TextEncoder().encode(value);
const table = (value) => text(`#OPTION#\r\n${value}\r\n`);
async function fixture(
  files,
  { archive = 'config.int', directory = 'config', profile = gameProfile } = {},
) {
  const startup = `<?xml version="1.0" encoding="UTF-8"?><document><INT><int00><name>config</name><int>${archive}</int><dir>${directory}</dir><ext>txt</ext></int00></INT><language><default>0</default><OPTTABLE>${archive}/gamelangtbl_%LANG_M%.txt</OPTTABLE><L00><code>1033</code><prefix>en</prefix><lang>English</lang></L00><L01><code>1041</code><prefix>jp</prefix><lang>Japanese</lang></L01></language></document>`;
  const reads = [],
    input = new Map();
  for (const [name, bytes] of Object.entries({ 'startup.xml': text(startup), ...files })) {
    const file = new BlobFile(new Blob([bytes])),
      read = file.read.bind(file);
    file.read = (at, count) => {
      reads.push([name, at, count]);
      return read(at, count);
    };
    input.set(name, file);
  }
  const game = new GameFiles(input);
  await game.open();
  const configuration = new NativeConfiguration({
      profile,
      startup: parseXML(startup),
      uiLanguage: 1033,
    }),
    random = new ParticleRandom(19, 23),
    world = new NativeWorld({
      profile,
      game,
      images: {},
      configuration,
      random,
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
      host: {},
    });
  world.ensureNativeEngine = () => assert.fail('language providers must not open an EXE');
  return { world, game, reads };
}

test('World GlobalStrings mode3 loads qualified loose options and retains missing-table and checkpoint semantics', async () => {
  const files = {
      'config.int': kif([['unrelated.txt', text('archive')]]),
      'config/gamelangtbl_en.txt': table('owned EN directory'),
      'language_en.txt': text('#UI#\r\nowned UI\r\n'),
    },
    worlds = [];
  try {
    const source = await fixture(files);
    worlds.push(source.world);
    assert.deepEqual(await source.world.globalStrings.initialize(), [true, true]);
    assert.equal(source.world.globalStrings.get('#OPTION#literal option'), 'owned EN directory');
    assert.equal(source.world.globalStrings.filenames.get(1), 'config.int/gamelangtbl_en.txt');
    assert.equal(await source.game.readLoose('config.int/gamelangtbl_en.txt'), null);
    assert.equal(await source.game.readArchive('config.int/gamelangtbl_en.txt'), null);
    const saved = structuredClone(source.world.globalStrings.snapshot()),
      fresh = await fixture(files);
    worlds.push(fresh.world);
    const readCount = fresh.reads.length;
    fresh.world.globalStrings.reload = () => assert.fail('language checkpoint replayed a reload');
    fresh.world.globalStrings.restore(saved);
    assert.deepEqual(fresh.world.globalStrings.snapshot(), saved);
    assert.equal(fresh.reads.length, readCount);
    const ui = structuredClone(source.world.globalStrings.tables.get(0));
    assert.equal(
      await source.world.globalStrings.reload(1, 'config.int/gamelangtbl_jp.txt'),
      false,
    );
    assert.equal(source.world.globalStrings.tables.has(1), false);
    assert.equal(source.world.globalStrings.filenames.has(1), false);
    assert.deepEqual(source.world.globalStrings.tables.get(0), ui);
    assert.equal(source.world.globalStrings.get('#OPTION#literal option'), 'literal option');
    assert.equal(fresh.world.globalStrings.get('#OPTION#literal option'), 'owned EN directory');
  } finally {
    for (const world of worlds) {
      assert.equal(world.nativeEngine, undefined);
      assert.equal(world.nativeEngineLoading, undefined);
      await world.close({ flushFiles: false });
    }
  }
});

test('World GlobalStrings preserves direct-first and mode3 update and row priority without SDK fallback', async () => {
  const worlds = [];
  try {
    const updated = await fixture({
      'config.int': kif([['gamelangtbl_en.txt', table('base archive')]]),
      'config/gamelangtbl_en.txt': table('base directory'),
      'language_en.txt': text('#UI#\r\nphysical direct\r\n'),
      'update10.int': kif([
        ['language_en.txt', text('#UI#\r\nupdate UI\r\n')],
        ['gamelangtbl_en.txt', table('update option')],
      ]),
    });
    worlds.push(updated.world);
    assert.deepEqual(await updated.world.globalStrings.initialize(), [true, true]);
    assert.equal(updated.world.globalStrings.get('#UI#literal UI'), 'physical direct');
    assert.equal(updated.world.globalStrings.get('#OPTION#literal option'), 'update option');
    const listed = await fixture(
      {
        'choices.lst': text('first/a.int\r\nsecond/b.int\r\n'),
        'a.int': kif([['gamelangtbl_en.txt', table('early archive')]]),
        'b.int': kif([['gamelangtbl_en.txt', table('late archive')]]),
        'first/unrelated.txt': text('directory exists'),
        'second/gamelangtbl_en.txt': table('late directory'),
      },
      { archive: 'choices.lst', directory: '' },
    );
    worlds.push(listed.world);
    assert.equal(
      await listed.world.globalStrings.reload(1, 'choices.lst/gamelangtbl_en.txt'),
      true,
    );
    assert.equal(listed.world.globalStrings.get('#OPTION#literal option'), 'early archive');
    assert.equal(
      await listed.world.globalStrings.reload(1, 'missing.int/gamelangtbl_en.txt'),
      false,
    );
    assert.equal(listed.world.globalStrings.get('#OPTION#literal option'), 'literal option');
    const sdk = await fixture(
      {
        'config.int': kif([['language.txt', text('$SDK$\r\narchive\r\n')]]),
        'update10.int': kif([['language.txt', text('$SDK$\r\nupdate\r\n')]]),
        'config/language.txt': text('$SDK$\r\ndirectory\r\n'),
      },
      { profile: sdkProfile },
    );
    worlds.push(sdk.world);
    const sdkReadCount = sdk.reads.length;
    assert.deepEqual(await sdk.world.globalStrings.initialize(), [false]);
    assert.equal(sdk.world.globalStrings.tables.size, 0);
    assert.equal(sdk.world.globalStrings.get('$SDK$literal SDK'), 'literal SDK');
    assert.equal(sdk.reads.length, sdkReadCount);
  } finally {
    for (const world of worlds) {
      assert.equal(world.nativeEngine, undefined);
      assert.equal(world.nativeEngineLoading, undefined);
      await world.close({ flushFiles: false });
    }
  }
});
