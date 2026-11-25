// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CatSystem2 } from '../src/engine.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { NativeMT19937, ParticleRandom } from '../src/ppi/random.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { StartupBlowfish } from '../src/native/startup-blowfish.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { nativeStartupSeed } from '../src/native/startup-author.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
  saveStartupPreferences,
  startupVersionImage,
  authoredStartupResources,
} from './fixtures/ordinary-startup.mjs';

const fixtures = JSON.parse(
    await readFile(new URL('./fixtures/startup-author-vectors.json', import.meta.url)),
  ),
  previous = JSON.parse(
    await readFile(new URL('./fixtures/startup-blowfish/vectors.json', import.meta.url)),
  ),
  row = (name) => fixtures.rows.find((entry) => entry.name === name),
  bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex')),
  credential = (name) => bytes(row(name).cipherLEHex),
  file = 'cs2_debug_key.dat',
  now = Date.UTC(2026, 10, 13, 2, 3, 4, 567),
  clockSeed = nativeStartupSeed({ utcNow: () => now }),
  sourceCache = new Map(),
  main = kif([
    [
      'main.kcs',
      kcsProgram([
        [37, 64],
        [43, 0xd1, 4],
        [37, 5],
        [43, 0x1d1, 0],
        [43, 0xd3, 8],
        [37, 7],
        [37, 0x12345678],
        [43, 0xd3, 8],
        [43, 0x41, 0],
        [59],
      ]),
    ],
  ]);

async function source(profile, codeHex) {
  const key = profile + ':' + codeHex;
  if (!sourceCache.has(key)) {
    const marker = 'VC3_AUTHORED_CODE',
      template = await ordinaryStartupGame(profile, {
        sound: false,
        startup: `<APP><v_code>${marker}</v_code></APP>`,
      }),
      input = await template.require('startup.xml'),
      needle = new TextEncoder().encode(marker),
      raw = bytes(codeHex),
      at = input.findIndex((_, start) => needle.every((value, i) => input[start + i] === value)),
      output = new Uint8Array(input.length - needle.length + raw.length);
    assert.ok(at >= 0);
    output.set(input.subarray(0, at));
    output.set(raw, at);
    output.set(input.subarray(at + needle.length), at + raw.length);
    sourceCache.set(key, output);
  }
  return sourceCache.get(key);
}
async function open(
  t,
  profile,
  {
    vector = 'ascii-A',
    input = credential(vector),
    mismatch = true,
    fault,
    saved,
    resources,
    expectedAuthor = 1,
    reject,
    authorAfterReject,
    inspect,
  } = {},
) {
  const environment = startupEnvironment();
  let player,
    restoring = false,
    opens = 0,
    reads = 0,
    sizes = 0;
  const events = [],
    draws = [],
    seeds = [],
    readStates = [];
  try {
    t.mock.method(Date, 'now', () => now);
    const game = await ordinaryStartupGame(profile, {
      sound: false,
      files: {
        'startup.xml': await source(profile, row(vector).codeHex),
        'scripts.int': main,
        'authored.exe': startupVersionImage(
          nativeABI(profile).engineVersion,
          resources ??
            (mismatch
              ? [
                  {
                    type: 'V_CODE',
                    name: 'DATA',
                    bytes: bytes(
                      previous.authored.find((entry) => entry.name === 'default-public-key')
                        .cipherLEHex,
                    ),
                  },
                ]
              : []),
        ),
        ...(input === null ? {} : { [file]: input }),
      },
    });
    if (saved) await saveStartupPreferences(game, { [file]: saved });
    const read = NativeFileStorage.prototype.read,
      size = NativeFileStorage.prototype.size,
      seed = NativeMT19937.prototype.seed,
      draw = NativeMT19937.prototype.nextUint32;
    t.mock.method(NativeFileStorage.prototype, 'size', function (name) {
      if (restoring) throw new Error('Restore must not open credential metadata');
      if (name === file) {
        sizes++;
        events.push('size');
        if (fault === 'metadata') return undefined;
      }
      return size.call(this, name);
    });
    t.mock.method(NativeFileStorage.prototype, 'read', function (name) {
      if (restoring) throw new Error('Restore must not read credentials');
      if (name === file) {
        reads++;
        events.push('read');
        // The read starts only after the original clock reset of both streams.
        readStates.push(player.world.random.snapshot());
        if (fault === 'io') throw new Error('authored file read error');
        if (fault === 'null') return null;
        if (fault === 'short') return new Uint8Array(63);
        if (fault === 'protocol') return 'not bytes';
      }
      return read.call(this, name);
    });
    t.mock.method(NativeMT19937.prototype, 'seed', function (value) {
      if (
        player?.world &&
        (this === player.world.random.integer || this === player.world.random.real)
      ) {
        seeds.push(value >>> 0);
        events.push('seed');
      }
      return seed.call(this, value);
    });
    t.mock.method(NativeMT19937.prototype, 'nextUint32', function () {
      if (restoring) throw new Error('Restore must not draw MT');
      const value = draw.call(this);
      if (player?.world && this === player.world.random.integer) {
        draws.push(value);
        events.push('draw');
      }
      return value;
    });
    if (fault === 'cipher')
      t.mock.method(StartupBlowfish.prototype, 'decryptInto', () => {
        throw new Error('authored cipher fault');
      });
    player = new CatSystem2({
      game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      randomSeed: 77,
      audioContext: { currentTime: 0, close: async () => {} },
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          opens++;
          throw new Error('Unexpected original process');
        },
      },
    });
    await authoredStartupResources(player, game);
    if (reject) {
      await assert.rejects(player.initialize(), reject);
      assert.equal(player.world.frame, 0);
      assert.equal(player.world.root, undefined);
      if (authorAfterReject !== undefined)
        assert.equal(player.world.configuration.authorMode, authorAfterReject);
    } else {
      await player.initialize();
      assert.equal(player.world.frame, 1);
      assert.equal(
        player.world.runtime.variableBank(player.world.main, false).get(5),
        expectedAuthor,
      );
      assert.equal(player.world.runtime.variableBank(player.world.main, false).get(7), 0x12345678);
      assert.equal(player.world.configuration.authorMode, expectedAuthor);
      assert.deepEqual(
        player.world.runtime.native(
          'main',
          0x1d1,
          [],
          player.world.main.machine,
          player.world.main,
          player.world.runtime.scheduler,
        ),
        { control: 1, value: expectedAuthor },
      );
    }
    assert.equal(opens, 0);
    assert.equal(player.world.nativeEngine, undefined);
    assert.deepEqual(draws, row(vector).words);
    assert.equal(readStates.length, reads);
    for (const state of readStates)
      assert.deepEqual(state, new ParticleRandom(clockSeed).snapshot());
    assert.equal(sizes, 1);
    assert.ok(events.indexOf('size') > events.lastIndexOf('draw'));
    assert.ok(seeds.includes(row(vector).crc));
    await inspect?.({
      player,
      game,
      reads,
      sizes,
      events,
      beginRestore() {
        restoring = true;
      },
    });
    return { reads };
  } finally {
    await player?.dispose();
    environment.restore();
  }
}

for (const profile of startupProfiles) {
  test(`valid64B author bypasses only comparison and real first KCS tick reads0x1d1: ${profile}`, (t) =>
    open(t, profile));
  test(`valid binary64 key with NUL before56 is not truncated: ${profile}`, (t) => {
    assert.ok(row('binary-key-zero').zeroKeyIndices.some((i) => i < 56));
    return open(t, profile, { vector: 'binary-key-zero' });
  });
  test(`empty startup code can still produce a valid64B author: ${profile}`, (t) =>
    open(t, profile, { vector: 'empty' }));
  test(`independently encrypted last-word mismatch does not bypass V_CODE: ${profile}`, (t) =>
    open(t, profile, {
      input: credential('ascii-A-wrong-last'),
      reject: /does not match startup v_code/,
    }));
  test(`invalid64B author with absent V_CODE starts normally with false native flag: ${profile}`, (t) =>
    open(t, profile, {
      input: credential('ascii-A-wrong-last'),
      mismatch: false,
      expectedAuthor: 0,
    }));
  for (const length of [null, 0, 63, 65])
    test(`credential size ${length === null ? 'absent' : length} is false without any content read: ${profile}`, async (t) => {
      const result = await open(t, profile, {
        input: length === null ? null : new Uint8Array(length),
        mismatch: false,
        expectedAuthor: 0,
      });
      assert.equal(result.reads, 0);
    });
  for (const fault of ['io', 'null', 'short'])
    test(`ordinary credential ${fault} read failure is false: ${profile}`, async (t) => {
      const result = await open(t, profile, { fault, mismatch: false, expectedAuthor: 0 });
      assert.equal(result.reads, 1);
    });
  for (const [fault, error] of [
    ['protocol', /file read requires bytes or null/],
    ['metadata', /invalid file length metadata/],
    ['cipher', /authored cipher fault/],
  ])
    test(`credential ${fault} protocol/program error propagates: ${profile}`, (t) =>
      open(t, profile, { fault, reject: error }));
  for (const type of ['V_CODE', 'V_CODE2'])
    test(`valid author does not bypass zero-size ${type} resource failure: ${profile}`, (t) =>
      open(t, profile, {
        resources: [{ type, name: 'DATA', bytes: new Uint8Array() }],
        reject: new RegExp(`${type}/DATA startup resource has size zero$`),
        authorAfterReject: 1,
      }));
  test(`saved valid credential overrides wrong-sized mounted input in the same namespace: ${profile}`, async (t) => {
    const result = await open(t, profile, {
      input: new Uint8Array(65),
      saved: credential('ascii-A'),
    });
    assert.equal(result.reads, 1);
  });
  test(`fresh valid-author checkpoint uses current flag without credential/RNG replay: ${profile}`, (t) =>
    open(t, profile, {
      async inspect({ player, game, beginRestore }) {
        player.random.rand();
        player.random.frand();
        const gpu = player.world.stageRenderer.gpu,
          { width, height } = gpu.primaryTarget;
        gpu.uploadRenderTarget(gpu.primaryTarget, {
          width,
          height,
          rgba: new Uint8Array(width * height * 4).fill(0x62),
        });
        const checkpoint = await player.snapshot();
        await saveStartupPreferences(game, { [file]: new Uint8Array(63) });
        beginRestore();
        t.mock.method(NativeSystemClock.prototype, 'utcNow', () => {
          throw new Error('Restore must not reseed MT');
        });
        const fresh = new CatSystem2({
          game,
          nativeProfile: profile,
          canvas: new StartupCanvas(),
          audioContext: { currentTime: 0, close: async () => {} },
          randomSeed: 99,
          transitionalExe: {
            open() {
              throw new Error('Unexpected original restore');
            },
          },
        });
        try {
          await fresh.initialize({ checkpoint });
          assert.equal(fresh.world.configuration.authorMode, 1);
          assert.equal(fresh.world.runtime.variableBank(fresh.world.main, false).get(5), 1);
          assert.deepEqual(fresh.random.snapshot(), checkpoint.world.random);
          assert.equal(fresh.world.frame, 1);
          assert.deepEqual(
            fresh.world.runtime.native(
              'main',
              0x1d1,
              [],
              fresh.world.main.machine,
              fresh.world.main,
              fresh.world.runtime.scheduler,
            ),
            { control: 1, value: 1 },
          );
        } finally {
          await fresh.dispose();
        }
      },
    }));
}

test('SDK raw alias valid credential consumes actual source bytes', (t) =>
  open(t, startupProfiles[0], { vector: 'sdk-alias' }));
test('Game UTF8 valid credential consumes actual source bytes', (t) =>
  open(t, startupProfiles[1], { vector: 'game-utf8' }));

test('file length metadata distinguishes absent/zero/untimed/archive and saved precedence without contents', async () => {
  const environment = startupEnvironment();
  let storage;
  try {
    const game = await ordinaryStartupGame(startupProfiles[0], {
      files: {
        'empty.dat': new Uint8Array(),
        'loose.dat': new Uint8Array(65),
        'extra.int': kif([['archived.dat', new Uint8Array(64)]]),
      },
    });
    storage = new NativeFileStorage(game, 'vc3-authored-length');
    await storage.open();
    game.read = () => {
      throw new Error('Metadata must not read source bytes');
    };
    assert.equal(storage.size('missing.dat'), null);
    assert.equal(storage.size('EMPTY.DAT'), 0);
    assert.equal(await storage.stat('loose.dat'), null);
    assert.equal(storage.size('loose.dat'), 65);
    assert.equal(storage.size('archived.dat'), 64);
    await storage.write('loose.dat', new Uint8Array(64));
    game.lookup = () => {
      throw new Error('Saved metadata takes precedence');
    };
    assert.equal(storage.size('loose.dat'), 64);
  } finally {
    storage?.close();
    environment.restore();
  }
});
