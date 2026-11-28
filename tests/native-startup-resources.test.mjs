// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CatSystem2 } from '../src/engine.mjs';
import { nativeABI, validateABI } from '../src/native/abi/index.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { NativeMT19937, ParticleRandom } from '../src/ppi/random.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { nativeStartupCode, nativeStartupSeed } from '../src/native/startup-author.mjs';
import { findNativeStartupResource } from '../src/native/startup-resources.mjs';
import { parseNativeXML, findNativeXML } from '../src/native/xml.mjs';
import { NativeXMLNode } from '../src/native/xml-node.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
  saveStartupPreferences,
  startupXML,
  startupVersionImage,
  authoredStartupResources,
} from './fixtures/ordinary-startup.mjs';

const vectors = JSON.parse(
    await readFile(new URL('./fixtures/startup-blowfish/vectors.json', import.meta.url)),
  ),
  crcVectors = JSON.parse(
    await readFile(new URL('./fixtures/startup-author-crc.json', import.meta.url)),
  ),
  vector = (name) => vectors.authored.find((entry) => entry.name === name),
  bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex')),
  cipher = (name) => bytes(vector(name).cipherLEHex),
  key = (name) => Uint8Array.from(bytes(vector(name).keyHex), (v) => v ^ 0xcd),
  now = Date.UTC(2026, 10, 13, 2, 3, 4, 567),
  clockSeed = nativeStartupSeed({ utcNow: () => now }),
  sdkCompare = (profile) =>
    nativeABI(profile).startup.verification.comparison === 'open-cs2-literal';

async function run(t, profile, { code, resources = [], files = {}, before, after, reject } = {}) {
  const environment = startupEnvironment();
  let player,
    opens = 0;
  try {
    t.mock.method(Date, 'now', () => now);
    const game = await ordinaryStartupGame(profile, {
      sound: false,
      startup: code === undefined ? '' : `<APP><v_code>${code}</v_code></APP>`,
      files: {
        'authored.exe': startupVersionImage(nativeABI(profile).engineVersion, resources),
        ...files,
      },
    });
    player = new CatSystem2({
      game,
      canvas: new StartupCanvas(),
      audioContext: { currentTime: 0, close: async () => {} },
      nativeProfile: profile,
      randomSeed: 77,
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          opens++;
          throw new Error('Unexpected PE execution');
        },
      },
    });
    await authoredStartupResources(player, game);
    await before?.(player, game);
    if (reject) {
      await assert.rejects(player.initialize(), reject);
      assert.equal(player.world.frame, 0);
      assert.equal(player.world.root, undefined);
    } else {
      await player.initialize();
      assert.equal(player.world.frame, 1);
      assert.equal(player.world.runtime.variableBank(player.world.main, false).get(7), 0x12345678);
      assert.equal(player.world.configuration.authorMode, 0);
    }
    assert.equal(opens, 0);
    assert.equal(player.world.nativeEngine, undefined);
    await after?.(player, game);
    return { game, random: player.world.random.snapshot() };
  } finally {
    await player?.dispose();
    environment.restore();
  }
}

for (const profile of startupProfiles) {
  test(`actual default V_CODE uses this registered ABI's comparison: ${profile}`, (t) =>
    run(t, profile, {
      code: sdkCompare(profile) ? 'open_cs2' : 'VC1',
      resources: [{ type: 'V_CODE', name: 'DATA', bytes: cipher('default-public-key') }],
    }));

  test(`actual default rejects mismatch even with a forged author setting: ${profile}`, (t) =>
    run(t, profile, {
      code: 'mismatch',
      resources: [{ type: 'V_CODE', name: 'DATA', bytes: cipher('default-public-key') }],
      before(player) {
        const original = player.createNativeWorld.bind(player);
        t.mock.method(player, 'createNativeWorld', (...args) => {
          const world = original(...args);
          world.configuration.authorMode = 1;
          return world;
        });
      },
      reject: /does not match startup v_code/,
    }));

  test(`absent V_CODE skips comparison while author resets the actual MT streams: ${profile}`, async (t) => {
    const { random } = await run(t, profile, { code: 'arbitrary' });
    const expectedSeed =
      nativeABI(profile).startup.resourceCheck === 'before-defaults' ? 77 : clockSeed;
    assert.deepEqual(random, new ParticleRandom(expectedSeed).snapshot());
  });

  for (const [code, accepts] of [
    ['', !sdkCompare(profile)],
    ['open_cs2', sdkCompare(profile)],
  ])
    test(`misaligned resource keeps zero output before ABI comparison, code=${JSON.stringify(code)}: ${profile}`, (t) =>
      run(t, profile, {
        code,
        resources: [{ type: 'V_CODE', name: 'DATA', bytes: new Uint8Array([1, 2, 3]) }],
        reject: accepts ? undefined : /does not match startup v_code/,
      }));

  for (const type of ['V_CODE', 'V_CODE2']) {
    test(`present ${type} size zero fails in actual default startup: ${profile}`, (t) =>
      run(t, profile, {
        resources: [{ type, name: 'DATA', bytes: new Uint8Array() }],
        reject: /startup resource has size zero/,
      }));
    test(`present ${type} invalid backing range fails in actual default startup: ${profile}`, (t) =>
      run(t, profile, {
        resources: [{ type, name: 'DATA', bytes: new Uint8Array([1]), dataRVA: 0xf0000000 }],
        reject: /startup resource read failed/,
      }));
  }

  for (const length of [0, 513])
    test(`KEY length ${length} keeps the public default key: ${profile}`, (t) =>
      run(t, profile, {
        code: sdkCompare(profile) ? 'open_cs2' : 'VC1',
        resources: [
          { type: 'KEY_CODE', name: 'KEY', bytes: new Uint8Array(length).fill(0xa5) },
          { type: 'V_CODE', name: 'DATA', bytes: cipher('default-public-key') },
        ],
      }));

  test(`optional KEY failed backing read keeps the default key: ${profile}`, (t) =>
    run(t, profile, {
      code: sdkCompare(profile) ? 'open_cs2' : 'VC1',
      resources: [
        { type: 'KEY_CODE', name: 'KEY', bytes: new Uint8Array([1]), dataRVA: 0xf0000000 },
        { type: 'V_CODE', name: 'DATA', bytes: cipher('default-public-key') },
      ],
    }));

  for (const [name, input, rejection] of [
    ['unsafe512', new Uint8Array(512), /size 512/],
    ['empty-after-xor', new Uint8Array([0xcd, 1]), /key is empty/],
  ])
    test(`KEY ${name} diagnoses original undefined input: ${profile}`, (t) =>
      run(t, profile, {
        resources: [{ type: 'KEY_CODE', name: 'KEY', bytes: input }],
        reject: rejection,
      }));

  for (const length of [1, 55, 56, 57, 71, 72, 73, 511])
    test(`KEY XOR/NUL schedule length ${length} uses independent C ciphertext: ${profile}`, (t) =>
      run(t, profile, {
        code: sdkCompare(profile) ? 'open_cs2' : '',
        resources: [
          { type: 'KEY_CODE', name: 'KEY', bytes: key(`key-${length}`) },
          { type: 'V_CODE', name: 'DATA', bytes: cipher(`key-${length}`) },
        ],
      }));

  test(`KEY uses first NUL after XOR, never raw resource length: ${profile}`, (t) =>
    run(t, profile, {
      code: sdkCompare(profile) ? 'open_cs2' : '',
      resources: [
        { type: 'KEY_CODE', name: 'KEY', bytes: key('nul-key-full') },
        { type: 'V_CODE', name: 'DATA', bytes: cipher('nul-key-prefix') },
      ],
    }));

  test(`no-NUL decrypted tail is data, not padding: ${profile}`, (t) =>
    run(t, profile, {
      code: sdkCompare(profile) ? 'open_cs2' : 'ABCDEFGH',
      resources: [
        { type: 'KEY_CODE', name: 'KEY', bytes: key('no-nul-terminator') },
        { type: 'V_CODE', name: 'DATA', bytes: cipher('no-nul-terminator') },
        { type: 'V_CODE2', name: 'DATA', bytes: new Uint8Array([3, 4, 5]) },
      ],
    }));

  for (const code of ['open_cs2', ' VC1 ', '猫'])
    test(`author uses exact ${JSON.stringify(code)} narrow bytes, integer32, then clocks/explicit at actual positions: ${profile}`, async (t) => {
      const events = [],
        encoding = nativeABI(profile).startup.verification.codeEncoding,
        crc = crcVectors.records.find((v) => v.code === code && v.encoding === encoding).crc;
      let owner;
      const seed = NativeMT19937.prototype.seed,
        draw = NativeMT19937.prototype.nextUint32,
        clock = NativeSystemClock.prototype.utcNow,
        identify = (stream) =>
          owner?.world &&
          (stream === owner.world.random.integer
            ? 'integer'
            : stream === owner.world.random.real
              ? 'real'
              : undefined);
      t.mock.method(NativeMT19937.prototype, 'seed', function (value) {
        const stream = identify(this);
        if (stream) events.push(['seed', stream, value >>> 0]);
        return seed.call(this, value);
      });
      t.mock.method(NativeMT19937.prototype, 'nextUint32', function () {
        const stream = identify(this);
        if (stream) events.push(['draw', stream]);
        return draw.call(this);
      });
      t.mock.method(NativeSystemClock.prototype, 'utcNow', function () {
        if (this === owner?.world?.clock) events.push(['clock']);
        return clock.call(this);
      });
      await run(t, profile, {
        code,
        before(player) {
          owner = player;
        },
      });
      const seeds = (value) => [
          ['seed', 'real', value],
          ['seed', 'integer', value],
        ],
        ctor = [['clock'], ...seeds(clockSeed), ...seeds(77)],
        author = [
          ...seeds(crc),
          ...Array.from({ length: 32 }, () => ['draw', 'integer']),
          ['clock'],
          ...seeds(clockSeed),
        ];
      assert.deepEqual(
        events,
        nativeABI(profile).startup.resourceCheck === 'before-defaults'
          ? [...author, ...ctor]
          : [...ctor, ...author],
      );
    });

  for (const location of ['loose', 'saved'])
    test(`existing ${location} invalid64byte credential reports false author after one read: ${profile}`, async (t) => {
      let credentialReads = 0;
      await run(t, profile, {
        files: location === 'loose' ? { 'cs2_debug_key.dat': new Uint8Array(64) } : {},
        async before(_player, game) {
          if (location === 'saved')
            await saveStartupPreferences(game, { 'cs2_debug_key.dat': new Uint8Array(64) });
          const read = NativeFileStorage.prototype.read;
          t.mock.method(NativeFileStorage.prototype, 'read', function (name) {
            if (name.toLowerCase().endsWith('cs2_debug_key.dat')) credentialReads++;
            return read.call(this, name);
          });
        },
      });
      assert.equal(credentialReads, 1);
    });

  test(`startup v_code original unsafe field boundary is explicit: ${profile}`, (t) =>
    run(t, profile, { code: 'A'.repeat(260), reject: /260-byte field/ }));
}

test('metadata has uses saved precedence/loose index, including files with no timestamp, without reading', async () => {
  const environment = startupEnvironment();
  let storage;
  try {
    const game = await ordinaryStartupGame(startupProfiles[0], {
      files: { 'Untimed.dat': new Uint8Array([1]) },
    });
    storage = new NativeFileStorage(game, 'vc2-authored-has');
    await storage.open();
    game.read = () => {
      throw new Error('Metadata must not read file contents');
    };
    assert.equal(await storage.stat('untimed.dat'), null);
    assert.equal(storage.has('UNTIMED.DAT'), true);
    assert.equal(storage.has('absent.dat'), false);
    await storage.write('untimed.dat', new Uint8Array([2]));
    game.lookup = () => {
      throw new Error('Saved file takes precedence');
    };
    assert.equal(storage.has('untimed.dat'), true);
  } finally {
    storage?.close();
    environment.restore();
  }
});

test('resource language selection follows the existing neutral fallback and exact byte range', () => {
  const image = startupVersionImage('2.6.1.76', [
      { type: 'V_CODE2', name: 'DATA', bytes: new Uint8Array([7, 8]) },
    ]),
    record = findNativeStartupResource(image, 'V_CODE2', 'DATA', 0x409);
  assert.equal(record.size, 2);
  assert.deepEqual([...record.read()], [7, 8]);
  assert.equal(findNativeStartupResource(image, 'V_CODE2', 'OTHER'), null);
});

test('startup code uses native XML raw text, explicit narrow encoding, first NUL and byte length', () => {
  for (const profile of startupProfiles) {
    const abi = nativeABI(profile),
      node = parseNativeXML(
        startupXML(profile, '<APP><v_code> 猫 </v_code></APP>'),
        abi.xmlEncoding,
      ),
      code = nativeStartupCode(node, abi.startup.verification);
    assert.deepEqual(
      [...code],
      abi.startup.verification.codeEncoding === 'cp932'
        ? [32, 148, 76, 32]
        : [32, 231, 140, 171, 32],
    );
    // Authored current node bytes model the narrow getter's C terminator;
    // no mutation of a derived text view or claim of embedded-NUL XML syntax.
    const value = new NativeXMLNode('v_code', abi.xmlEncoding, new Uint8Array([65, 0, 66])),
      root = new NativeXMLNode('document', abi.xmlEncoding, new Uint8Array(), [
        new NativeXMLNode('APP', abi.xmlEncoding, new Uint8Array(), [value]),
      ]);
    assert.deepEqual([...nativeStartupCode(root, abi.startup.verification)], [65]);
  }
});

for (const profile of startupProfiles)
  test(`fresh actual default restore does not recheck resources/credential or replay author RNG: ${profile}`, async (t) => {
    const environment = startupEnvironment();
    let player, restored;
    try {
      t.mock.method(Date, 'now', () => now);
      const game = await ordinaryStartupGame(profile, {
          sound: false,
          startup: `<APP><v_code>${sdkCompare(profile) ? 'open_cs2' : 'VC1'}</v_code></APP>`,
          files: {
            'authored.exe': startupVersionImage(nativeABI(profile).engineVersion, [
              { type: 'V_CODE', name: 'DATA', bytes: cipher('default-public-key') },
            ]),
          },
        }),
        options = {
          game,
          canvas: new StartupCanvas(),
          audioContext: { currentTime: 0, close: async () => {} },
          nativeProfile: profile,
          randomSeed: 77,
          transitionalExe: {
            open() {
              throw new Error('Unexpected original restore');
            },
          },
        };
      player = new CatSystem2(options);
      await authoredStartupResources(player, game);
      await player.initialize();
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
      await saveStartupPreferences(game, { 'cs2_debug_key.dat': new Uint8Array(64) });
      const require = game.require.bind(game);
      t.mock.method(game, 'require', (name, ...args) => {
        assert.equal(name.endsWith('.exe'), false, 'Restore must not reread cipher resources');
        return require(name, ...args);
      });
      t.mock.method(NativeFileStorage.prototype, 'size', () => {
        throw new Error('Restore must not recheck credentials');
      });
      t.mock.method(NativeMT19937.prototype, 'nextUint32', () => {
        throw new Error('Restore must not repeat author draws');
      });
      restored = new CatSystem2({
        ...options,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
      });
      for (const stream of [restored.random.integer, restored.random.real])
        t.mock.method(stream, 'seed', () => {
          throw new Error('Restore must not reset author MT');
        });
      await restored.initialize({ checkpoint });
      assert.deepEqual(restored.random.snapshot(), checkpoint.world.random);
      assert.equal(restored.world.frame, 1);
      assert.equal(
        restored.world.runtime.variableBank(restored.world.main, false).get(7),
        0x12345678,
      );
      assert.equal(restored.world.nativeEngine, undefined);
    } finally {
      await restored?.dispose();
      await player?.dispose();
      environment.restore();
    }
  });

test('startup verification is explicit registered ABI data and rejects incomplete declarations', () => {
  assert.deepEqual(
    startupProfiles.map((profile) => nativeABI(profile).startup.verification),
    [
      {
        cipher: 'blowfish-le32',
        codeEncoding: 'cp932',
        comparison: 'open-cs2-literal',
        defaultCodeBytes: [111, 112, 101, 110, 95, 99, 115, 50],
      },
      { cipher: 'blowfish-le32', codeEncoding: 'utf8', comparison: 'decrypted-c-string' },
    ],
  );
  for (const profile of startupProfiles)
    for (const field of ['cipher', 'codeEncoding', 'comparison']) {
      const invalid = structuredClone(nativeABI(profile));
      delete invalid.startup.verification[field];
      assert.throws(() => validateABI(invalid), /Invalid ABI behavior data/);
    }
});

for (const [profile, codeHex] of [
  [startupProfiles[0], 'fa40'],
  [startupProfiles[0], 'eeef'],
  [startupProfiles[1], 'e78cab'],
])
  test(`ordinary startup CRC reads native XML source bytes ${codeHex} without transcoding: ${profile}`, async (t) => {
    const marker = 'VC2_AUTHORED_RAW_CODE',
      template = await ordinaryStartupGame(profile, {
        sound: false,
        startup: `<APP><v_code>${marker}</v_code></APP>`,
      }),
      source = await template.require('startup.xml'),
      needle = new TextEncoder().encode(marker),
      raw = bytes(codeHex),
      at = source.findIndex((_, start) => needle.every((value, i) => source[start + i] === value));
    assert.ok(at >= 0);
    const document = new Uint8Array(source.length - needle.length + raw.length);
    document.set(source.subarray(0, at));
    document.set(raw, at);
    document.set(source.subarray(at + needle.length), at + raw.length);
    const encoding = nativeABI(profile).startup.verification.codeEncoding,
      expected = crcVectors.rawByteRecords.find(
        (record) => record.codeHex === codeHex && record.encoding === encoding,
      ),
      events = [];
    let owner;
    const seed = NativeMT19937.prototype.seed,
      draw = NativeMT19937.prototype.nextUint32,
      stream = (value) =>
        owner?.world &&
        (value === owner.world.random.integer
          ? 'integer'
          : value === owner.world.random.real
            ? 'real'
            : undefined);
    t.mock.method(NativeMT19937.prototype, 'seed', function (value) {
      const name = stream(this);
      if (name) events.push(['seed', name, value >>> 0]);
      return seed.call(this, value);
    });
    t.mock.method(NativeMT19937.prototype, 'nextUint32', function () {
      const name = stream(this);
      if (name) events.push(['draw', name]);
      return draw.call(this);
    });
    await run(t, profile, {
      files: { 'startup.xml': document },
      before(player) {
        owner = player;
      },
      after(player) {
        assert.deepEqual(
          nativeStartupCode(player.world.startupDocument, nativeABI(profile).startup.verification),
          raw,
        );
        assert.equal(
          findNativeXML(player.world.startupDocument, 'APP/v_code').text,
          new TextDecoder(nativeABI(profile).xmlEncoding).decode(raw),
        );
      },
    });
    const seeds = (value) => [
        ['seed', 'real', value],
        ['seed', 'integer', value],
      ],
      ctor = [...seeds(clockSeed), ...seeds(77)],
      author = [
        ...seeds(expected.crc),
        ...Array.from({ length: 32 }, () => ['draw', 'integer']),
        ...seeds(clockSeed),
      ];
    assert.deepEqual(
      events,
      nativeABI(profile).startup.resourceCheck === 'before-defaults'
        ? [...author, ...ctor]
        : [...ctor, ...author],
    );
    if (codeHex === 'fa40') {
      const canonical = crcVectors.rawByteRecords.find((record) => record.codeHex === 'eeef');
      assert.notEqual(expected.crc, canonical.crc);
      assert.equal(
        events.some((event) => event[0] === 'seed' && event[2] === canonical.crc),
        false,
      );
    }
  });

for (const profile of startupProfiles)
  test(`cold Core startup restores pending device state while live restore retains its current owner: ${profile}`, async (t) => {
    const environment = startupEnvironment();
    let player,
      fresh,
      opens = 0,
      ticks = 0,
      calls = 0;
    try {
      const game = await ordinaryStartupGame(profile, { sound: false }),
        options = {
          game,
          canvas: new StartupCanvas(),
          audioContext: { currentTime: 0, close: async () => {} },
          nativeProfile: profile,
          randomSeed: 77,
          transitionalExe: {
            open() {
              opens++;
              throw new Error('Unexpected original input restore');
            },
          },
        };
      player = new CatSystem2(options);
      await player.initialize();
      player.touchContact(7, 20, 30, 'down');
      player.inputBindings.keyboard({ code: 'KeyA', keyCode: 65 }, true);
      const checkpoint = await player.snapshot();
      t.mock.method(NativeMT19937.prototype, 'nextUint32', () => {
        throw new Error('Input restore must not draw MT');
      });
      fresh = new CatSystem2({ ...options, canvas: new StartupCanvas() });
      const create = fresh.createNativeWorld;
      fresh.createNativeWorld = function (...args) {
        const world = create.apply(this, args),
          tick = world.tick,
          native = world.runtime.native;
        world.tick = function (...values) {
          ticks++;
          return tick.apply(this, values);
        };
        world.runtime.native = function (...values) {
          calls++;
          return native.apply(this, values);
        };
        return world;
      };
      await fresh.initialize({ checkpoint: structuredClone(checkpoint) });
      assert.deepEqual(await fresh.snapshot(), checkpoint);
      assert.notEqual(fresh.inputBindings.contacts, player.inputBindings.contacts);
      assert.equal(ticks, 0);
      assert.equal(calls, 0);
      fresh.touchContact(9, 21, 31, 'down');
      fresh.inputBindings.keyboard({ code: 'KeyB', keyCode: 66 }, true);
      const currentDevice = fresh.inputBindings.snapshot();
      await fresh.restore(structuredClone(checkpoint));
      assert.deepEqual(fresh.inputBindings.snapshot(), currentDevice);
      assert.deepEqual(await fresh.snapshot(), {
        ...checkpoint,
        world: { ...checkpoint.world, inputBindings: currentDevice },
      });
      assert.deepEqual(await player.snapshot(), checkpoint);
      assert.equal(ticks, 0);
      assert.equal(calls, 0);
      assert.equal(opens, 0);
    } finally {
      await fresh?.dispose();
      await player?.dispose();
      environment.restore();
    }
  });

for (const [profile, reviewedDefault] of [
  [startupProfiles[0], 'open_cs2'],
  [startupProfiles[1], null],
])
  test(`ordinary startup consumes only its own reviewed APP code default: ${profile}`, async () => {
    const environment = startupEnvironment();
    let player;
    let opens = 0;
    try {
      const game = await ordinaryStartupGame(profile, {
        sound: false,
        includeOwnedVerificationCode: false,
        files: {
          'authored-default.exe': startupVersionImage(nativeABI(profile).engineVersion, [
            { type: 'V_CODE', name: 'DATA', bytes: cipher('default-public-key') },
          ]),
        },
      });
      player = new CatSystem2({
        game,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        nativeProfile: profile,
        randomSeed: 77,
        transitionalExe: {
          open() {
            opens++;
            throw new Error('Missing APP code must not enter original CPU');
          },
        },
      });
      await authoredStartupResources(player, game, 'authored-default.exe');
      if (reviewedDefault === null)
        await assert.rejects(player.initialize(), /Startup code default is not reviewed/);
      else {
        await player.initialize();
        assert.equal(findNativeXML(player.world.startupDocument, 'APP/v_code'), null);
        assert.deepEqual(
          nativeStartupCode(player.world.startupDocument, nativeABI(profile).startup.verification),
          new TextEncoder().encode(reviewedDefault),
        );
        assert.equal(player.world.frame, 1);
        assert.equal(
          player.world.runtime.variableBank(player.world.main, false).get(7),
          0x12345678,
        );
      }
      assert.equal(opens, 0);
      const abi = nativeABI(profile),
        verification = abi.startup.verification;
      assert.deepEqual(
        nativeStartupCode(null, { ...verification, defaultCodeBytes: [] }),
        new Uint8Array(),
      );
      assert.deepEqual(
        [...nativeStartupCode(null, { ...verification, defaultCodeBytes: [0xfa, 0x40, 0, 66] })],
        [0xfa, 0x40],
        'reviewed defaults retain raw narrow aliases and the first NUL',
      );
      for (const bad of [null, false, 0, 'open_cs2', [-1], [256], [1.5]]) {
        const invalid = structuredClone(abi);
        invalid.startup.verification.defaultCodeBytes = bad;
        assert.throws(() => validateABI(invalid), /startup code default bytes/);
      }
    } finally {
      await player?.dispose();
      environment.restore();
    }
  });
