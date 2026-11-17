// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { KCSMachine, encodeCP932, readKCS, floatBits, bitsFloat } from '../src/kcs.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeMT19937 } from '../src/ppi/random.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { nativeABI, abiForEngineVersion } from '../src/native/abi/index.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NativeGraphics } from '../src/native/graphics.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeSoundPacket } from '../src/native/sound.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { nativeStartupCode } from '../src/native/startup-author.mjs';
import { kif, kcsProgram, memoryGame, hg3 } from './helpers.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  startupVersionImage,
} from './fixtures/ordinary-startup.mjs';
import { checkpointDifference } from './browser/checkpoint-observation.mjs';
import { AudioMixer } from '../src/audio.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { NativeDatabase } from '../src/native/database.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';

const versions = [
  ['2.6.1.63', 'rebellions-jp-engine-2.6.1.63', 203, 3],
  ['2.6.1.67', 'bokutomo-engine-2.6.1.67', 204, 4],
];
const bytes = (value) => encodeCP932(value);
const title = '$unreviewed$Raw title 日本語';

async function ownedGame(
  version,
  { scripts = [], texture = '', voiceExtra = '', code = 'owned-code' } = {},
) {
  const program = kcsProgram(
    [
      [37, 512],
      [37, 6200],
      [37, 6300],
      [37, 0],
      [43, 359, 16],
      [37, 10064],
      [43, 605, 4],
      [43, 465, 0],
      [59],
    ],
    [
      [10000, 'sysvoice'],
      [10032, 'other'],
      [10064, 'bgm01.ogg'],
      [10096, 'bgm'],
    ],
  );
  // Authored main-data capacity, independent of stack/code sizes.
  new DataView(program.buffer, program.byteOffset, program.byteLength).setUint32(32, 16384, true);
  const xml =
    '<APP><title>' +
    title +
    '</title>' +
    (code === null ? '' : '<v_code>' + code + '</v_code>') +
    '</APP>' +
    texture +
    '<SCREEN><width>64</width><height>48</height><v_width>128</v_width>' +
    '<v_height>96</v_height><fps>60</fps></SCREEN>' +
    '<SCRIPT><start>main.kcs</start></SCRIPT>' +
    '<INT><int00><name>kcs</name><int>scripts.int</int><ext>kcs</ext></int00>' +
    '<int01><name>fes</name><int>ui.int</int><ext>fes</ext></int01></INT>' +
    '<SOUNDGROUP><group00><id>17</id><type>bgm</type><min>0</min><max>31</max>' +
    '</group00></SOUNDGROUP>' +
    '<VOICE><vol><master>80</master><bgm>50</bgm></vol>' +
    '<v00><head>bgm</head><group>17</group>' +
    voiceExtra +
    '</v00></VOICE>';
  const entries = {
    'startup.xml': bytes(
      '<?xml version="1.0" encoding="shift_jis"?><document>' + xml + '</document>',
    ),
    'owned.exe': startupVersionImage(version),
    'scripts.int': kif([['main.kcs', program], ...scripts]),
    'ui.int': kif([['first.fes', bytes('/* owned empty START block */\n#START\n')]]),
  };
  const game = new GameFiles(
    new Map(Object.entries(entries).map(([name, data]) => [name, new BlobFile(new Blob([data]))])),
  );
  await game.open();
  return game;
}

function core(game, profile, attempted) {
  return new CatSystem2({
    game,
    nativeProfile: profile,
    canvas: new StartupCanvas(),
    audioContext: { currentTime: 0, close: async () => {} },
    randomSeed: 17,
    uiLanguage: 0x409,
    transitionalExe: {
      open() {
        attempted.cpu++;
        throw new Error('Owned old-version test forbids original execution');
      },
    },
  });
}

for (const [version, profile, soundTypeMessage, otherType] of versions) {
  test(
    'old ABI ' + version + ' owns first Core, configuration GCALLs, FES bank and cold lifecycle',
    async (t) => {
      const environment = startupEnvironment();
      const attempted = { cpu: 0, tick: 0, step: 0, command: 0, random: 0 };
      let source,
        fresh,
        primaryFailure,
        restoring = false;
      const cleanupErrors = [];
      const observe = (prototype, name, counter) => {
        const original = prototype[name];
        t.mock.method(prototype, name, function (...args) {
          if (restoring) attempted[counter]++;
          return original.apply(this, args);
        });
      };
      t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 17, 3, 4, 5));
      assert.equal(typeof NativeWorld.prototype.ensureNativeEngine, 'undefined');
      assert.equal(typeof NativeWorld.prototype.getNativeFeature, 'undefined');
      observe(NativeWorld.prototype, 'tick', 'tick');
      observe(NativeWorld.prototype, 'sendNativeEngine', 'command');
      observe(KCSMachine.prototype, 'step', 'step');
      observe(NativeMT19937.prototype, 'nextUint32', 'random');
      try {
        source = core(await ownedGame(version), profile, attempted);
        await source.initialize();
        const world = source.world,
          main = world.main,
          machine = main.machine;
        assert.equal(world.frame, 1);
        assert.equal(world.nativeEngine, undefined);
        assert.equal(world.nativeEngineLoading, undefined);
        assert.equal(document.title, title);
        assert.deepEqual(
          [...world.objects.objects.values()].map((r) => r.kind),
          [1, 11, 13, 12],
        );
        assert.deepEqual(
          world.configuration.blocks.map((b) => b.byteLength),
          [5628, 60, 28, 12],
        );
        assert.deepEqual([...machine.bytes(512, 5628)], [...world.configuration.blocks[0]]);
        assert.deepEqual([...machine.bytes(6200, 60)], [...world.configuration.blocks[1]]);
        assert.deepEqual([...machine.bytes(6300, 28)], [...world.configuration.blocks[2]]);
        assert.deepEqual([machine.load(0), machine.load(4), machine.load(8)], [0x64ffffff, 1, 1]);
        assert.deepEqual(
          Array.from({ length: 15 }, (_, i) =>
            new DataView(world.configuration.blocks[1].buffer).getUint32(i * 4, true),
          ),
          [4, 4, 0, 15, 5, 1, 0, 1, 0, 100, 0, 0xffffffff, 0, 0, 0],
        );
        assert.equal(machine.pop(), world.configuration.authorMode);
        assert.equal(world.configuration.authorMode, 0);
        assert.equal(machine.pop(), 40);
        const sound = [...world.objects.objects.values()].find((r) => r.kind === 13);
        assert.equal(
          await world.sendNativeEngine(sound.nativeID, main.id, soundTypeMessage, 0, 10000),
          3,
        );
        assert.equal(
          await world.sendNativeEngine(sound.nativeID, main.id, soundTypeMessage, 0, 10032),
          otherType,
        );
        assert.equal(
          await world.sendNativeEngine(sound.nativeID, main.id, soundTypeMessage, 0, 10096),
          0,
        );

        // Actual FES task loader receives its calling Script's real shared bank.
        const parent = world.objects.objects.get(main.id);
        world.runtime.variableBank(parent).initialize(64);
        const strings = world.runtime.stringBank(parent);
        strings.set(7, '日本語');
        const fesID = await world.objects.create({ kind: 34, parent: main.id });
        const fes = world.objects.objects.get(fesID).implementation;
        await fes.initialize(parent.context.variableBank);
        assert.equal(await fes.loadSource('first'), true);
        const instance = fes.player.root;
        assert.deepEqual(
          [...instance.argumentBytes(bytes('raw$str7/leaf'))],
          [...bytes('raw日本語/leaf')],
        );
        assert.deepEqual([...instance.argumentBytes(bytes('$str99/leaf'))], [...bytes('/leaf')]);
        assert.deepEqual([...instance.expandMacros(bytes('"owned"'))], [...bytes('"owned"')]);
        instance.macros.set('OWNED', bytes('7'));
        assert.throws(
          () => instance.expandMacros(bytes('OWNED')),
          /unreviewed.*macro|macro.*unreviewed/i,
        );
        instance.macros.clear();
        assert.throws(
          () => world.globalStrings.get('$key$'),
          /unreviewed.*(language|translation)|(?:language|translation).*unreviewed/i,
        );
        assert.throws(
          () => world.window.languageAccelerators,
          /Unreviewed.*windowLanguageAccelerators/,
        );
        assert.throws(
          () => world.window.refreshLanguageMenu(),
          /Unreviewed.*windowLanguageAccelerators/,
        );
        const windowState = world.window.snapshot();
        await assert.rejects(world.window.broadcast(), /Unreviewed.*broadcast/);
        await assert.rejects(world.window.command(40096), /Unreviewed.*windowReturnTitle/);
        assert.deepEqual(world.window.snapshot(), windowState);
        assert.throws(
          () => world.runtime.native('main', 385, [0, 0, 0, 0], machine, main),
          /Unsupported|unrecovered/i,
        );
        assert.throws(
          () => world.runtime.native('main', 856, [0, 0, 0, 0, 0, 0, 0], machine, main),
          /Unsupported|unrecovered/i,
        );
        assert.equal(world.runtime.handlers.has('main:988'), false);
        assert.equal(world.runtime.handlers.has('main:989'), false);
        assert.throws(() => world.runtime.native('main', 988, [0, 0], machine, main), /outside/);
        assert.throws(
          () => world.runtime.register('missing-table', 1, () => {}),
          /Invalid native registration/,
        );
        assert.throws(
          () => world.runtime.register('main', 99999, () => {}),
          /Invalid native registration/,
        );
        assert.throws(
          () => world.fesSoundConfiguration.get(['volume', 'master']),
          /command is absent/,
        );
        assert.deepEqual(world.fesSoundConfiguration.tokens('volume master'), ['volume', 'master']);
        assert.throws(
          () => world.fesSoundConfiguration.tokens('volume "master"'),
          /Unreviewed.*allowQuotedFesNames/,
        );
        assert.throws(() => abiForEngineVersion('2.6.1.90'), /Unregistered/);
        assert.equal(nativeABI(profile).tables.main.entries[385].signature.argumentWords, 4);
        assert.equal(nativeABI(profile).tables.main.entries[856].signature.argumentWords, 7);
        const beforeControl = world.objects.objects.size;
        await assert.rejects(
          world.objects.create({ kind: 40, parent: main.id }),
          /Unreviewed.*controlResources/,
        );
        assert.equal(world.objects.objects.size, beforeControl);
        const checkpoint = await source.snapshot();
        fresh = core(await ownedGame(version), profile, attempted);
        restoring = true;
        await fresh.initialize({ checkpoint });
        restoring = false;
        assert.deepEqual(attempted, { cpu: 0, tick: 0, step: 0, command: 0, random: 0 });
        assert.equal(await checkpointDifference(await fresh.snapshot(), checkpoint), null);
        const freshFES = fresh.world.objects.objects.get(fesID).implementation;
        fresh.world.runtime.stringBank(fresh.world.main, false).set(7, 'fresh');
        assert.deepEqual(
          [...freshFES.player.root.argumentBytes(bytes('$str7'))],
          [...bytes('fresh')],
        );
        await source.dispose();
        assert.equal(world.closed, true);
        assert.equal(world.objects.objects.size, 0);
        strings.set(7, 'old');
        assert.deepEqual(
          [...freshFES.player.root.argumentBytes(bytes('$str7'))],
          [...bytes('fresh')],
        );
        assert.equal(fresh.world.closed, undefined);
      } catch (error) {
        primaryFailure = error;
      } finally {
        restoring = false;
        for (const instance of [fresh, source]) {
          try {
            await instance?.dispose();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        environment.restore();
      }
      if (primaryFailure || cleanupErrors.length)
        throw new AggregateError(
          (primaryFailure ? [primaryFailure, ...cleanupErrors] : cleanupErrors).flatMap(
            function leaves(error) {
              return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
            },
          ),
          'Owned old-version business and cleanup failures',
        );
    },
  );
}

test('old ABI Runtime binds only present slots and preserves unknown dispatch', () => {
  for (const [, profile] of versions) {
    const runtime = new NativeRuntime({ profile, read: async () => null });
    const tables = [...runtime.tables].map(([name, entries]) => [name, entries.length]);
    const callback = () => {
      throw new Error('Unknown dispatch must not invoke a bound handler');
    };
    assert.equal(runtime.register('main', 988, callback), false);
    assert.equal(runtime.handlers.has('main:988'), false);
    assert.deepEqual(
      [...runtime.tables].map(([name, entries]) => [name, entries.length]),
      tables,
    );
    for (const [table, id, handler] of [
      ['missing', 1, callback],
      ['main', -1, callback],
      ['main', 1.5, callback],
      ['main', 99999, callback],
      ['main', 988, null],
    ]) {
      assert.throws(() => runtime.register(table, id, handler), /Invalid native registration/);
      assert.equal(runtime.handlers.size, 0);
    }
    assert.equal(runtime.register('main', 359, callback), true);
    assert.throws(() => runtime.register('main', 359, () => {}), /Duplicate native registration/);
    assert.equal(runtime.handlers.get('main:359'), callback);
    const machine = { pc: 16, debug: null },
      task = { id: 1, name: 'owned-runtime-control' };
    for (const [id, words] of [
      [385, 4],
      [856, 7],
    ]) {
      assert.equal(runtime.register('main', id, callback), true);
      assert.throws(
        () => runtime.native('main', id, new Array(words).fill(0), machine, task),
        /Unsupported/,
      );
    }
    assert.throws(() => runtime.native('main', 988, [0, 0], machine, task), /outside/);
  }
});

const pageTexture =
  '<TEXTURE><size><x>8</x><y>8</y></size><vt><x>1</x><y>1</y></vt>' +
  '<area00><sx>0</sx><sy>0</sy><dx>1</dx><dy>1</dy></area00>' +
  '<bpp32y>0</bpp32y><bpp16y>1</bpp16y><filter_min>0</filter_min><filter_mag>1</filter_mag></TEXTURE>';

test('old ABI 605 preserves own filename pairs, directory precedence and finite scratch bounds', async () => {
  for (const [version, profile] of versions) {
    const environment = startupEnvironment(),
      attempted = { cpu: 0 };
    let source;
    try {
      const queryCode = kcsProgram([[37, 1024], [43, 605, 4], [59]]);
      source = core(
        await ownedGame(version, {
          scripts: [['gain.kcs', queryCode]],
          voiceExtra: '<int>pack</int>',
        }),
        profile,
        attempted,
      );
      await source.initialize();
      const world = source.world;
      const query = async (filename) => {
        const task = await world.spawnScript('gain.kcs');
        try {
          task.machine.bytes(1024, filename.length + 1).set(Uint8Array.from([...filename, 0]));
          assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
          return task.machine.pop();
        } finally {
          await world.objects.release(task.id);
        }
      };
      const before = world.configuration.snapshot();
      assert.equal(await query(bytes('BGM01.ogg')), 40);
      assert.equal(await query(bytes('PACK.KCS/nomatch.ogg')), 40);
      assert.equal(await query(bytes('nomatch.ogg')), 100);
      assert.equal(
        await query(bytes('/BGM01.ogg')),
        100,
        'separator at byte0 retains the full name',
      );
      assert.equal(
        await query(Uint8Array.of(0x81, 0x5c, 66, 71, 77, 48, 49)),
        40,
        'native basename scan observes the raw trail slash after pair-aware directory scan',
      );
      assert.equal(await query(bytes('bgm' + 'x'.repeat(252))), 40);
      const rawVoice = world.configuration.blocks[0],
        savedHead = rawVoice.slice(60, 100),
        savedArchive = rawVoice.slice(104, 136);
      rawVoice.fill(0, 60, 100);
      rawVoice.set(bytes('BGM'), 60);
      assert.equal(
        await query(bytes('bgm01.ogg')),
        100,
        'native lowercases the filename but compares the stored head as raw bytes',
      );
      rawVoice.set(savedHead, 60);
      rawVoice.fill(0, 104, 136);
      rawVoice.set([0x81, 0x61], 104);
      assert.equal(
        await query(Uint8Array.from([0x81, 0x41, 47, ...bytes('nomatch.ogg')])),
        40,
        'directory C-locale comparison folds ASCII bytes even inside a stored pair',
      );
      rawVoice.set(savedArchive, 104);
      if (version === '2.6.1.63')
        assert.equal(await query(Uint8Array.of(0xfa, 0x5c, 66, 71, 77, 48, 49)), 40);
      else
        await assert.rejects(
          query(Uint8Array.of(0xfa, 0x5c, 66, 71, 77, 48, 49)),
          /Unreviewed.*byte\/locale/,
        );
      assert.deepEqual(world.configuration.snapshot(), before);
      const xmlPrefix = bytes(
          '<?xml version="1.0" encoding="shift_jis"?><document><VOICE><v00><int>',
        ),
        xmlSuffix = bytes('</int></v00></VOICE></document>'),
        rawXML = Uint8Array.from([...xmlPrefix, 0xfa, 0x41, ...xmlSuffix]),
        ownConfiguration = new NativeConfiguration({
          profile,
          startup: parseNativeXML(rawXML, 'Shift_JIS'),
        });
      assert.deepEqual(
        Array.from(ownConfiguration.blocks[0].subarray(104, 107)),
        [0xfa, version === '2.6.1.63' ? 0x41 : 0x61, 0],
        'the real XML byte owner feeds that version archive-lower pair predicate',
      );
      const voice = new DataView(world.configuration.blocks[0].buffer);
      voice.setUint32(1402 * 4, 1, true);
      assert.equal(
        await query(Uint8Array.of(0x80)),
        0,
        'master mute precedes getter byte classification',
      );
      await assert.rejects(
        query(bytes('x'.repeat(256))),
        /255-byte CString/,
        'wrapper scratch boundary precedes the getter mute gate',
      );
      assert.equal(voice.getUint32(1402 * 4, true), 1);
      assert.equal(attempted.cpu, 0);
    } finally {
      await source?.dispose();
      environment.restore();
    }
  }
});

test('old ABI texture pages own dirty uploads and cold pixels without enabling bounds queries', async () => {
  for (const [version, profile] of versions) {
    const environment = startupEnvironment(),
      attempted = { cpu: 0 };
    let source, fresh;
    try {
      source = core(await ownedGame(version, { texture: pageTexture }), profile, attempted);
      await source.initialize();
      const graphics = source.world.graphics,
        pages = graphics.texturePages;
      assert.deepEqual(Array.from(pages.layout.size), [8, 8]);
      assert.deepEqual(Array.from(pages.dirtyFlags), [0]);
      assert.equal(nativeABI(profile).graphics.texturedBoundsQuery, null);
      assert.equal(graphics.d3dContext.samplers.get(5), 2);
      assert.equal(graphics.d3dContext.samplers.get(6), 1);
      const handle = graphics.images.create(2, 1),
        bitmap = graphics.images.get(handle);
      await bitmap.fill(0, 0, 2, 1, 0xff123456);
      await graphics.output(bitmap, [2, 1]);
      assert.deepEqual(Array.from(pages.dirtyFlags), [1]);
      assert.deepEqual(
        Array.from(pages.frame(0).rgba.slice(40, 48)),
        [18, 52, 86, 255, 18, 52, 86, 255],
      );
      pages.clear(2, 1, 1, 1);
      assert.deepEqual(
        Array.from(pages.frame(0).rgba.slice(40, 48)),
        [0, 0, 0, 0, 18, 52, 86, 255],
      );
      const checkpoint = await source.snapshot();
      fresh = core(await ownedGame(version, { texture: pageTexture }), profile, attempted);
      await fresh.initialize({ checkpoint });
      assert.equal(await checkpointDifference(await fresh.snapshot(), checkpoint), null);
      const restored = fresh.world.graphics.texturePages;
      assert.notEqual(restored, pages);
      assert.notEqual(restored.dirtyFlags.buffer, pages.dirtyFlags.buffer);
      assert.deepEqual(Array.from(restored.dirtyFlags), [1]);
      await source.dispose();
      assert.equal(pages.pages.size, 0);
      assert.deepEqual(
        Array.from(restored.frame(0).rgba.slice(40, 48)),
        [0, 0, 0, 0, 18, 52, 86, 255],
      );
      restored.clearDirty();
      assert.deepEqual(Array.from(restored.dirtyFlags), [0]);
      assert.equal(attempted.cpu, 0);
    } finally {
      await fresh?.dispose();
      await source?.dispose();
      environment.restore();
    }
  }
});

test('texture policy rejects a missing profile before initialization or owned-page restore mutation', async () => {
  const environment = startupEnvironment(),
    attempted = { cpu: 0 };
  let source;
  try {
    const [version, profile] = versions[0];
    source = core(await ownedGame(version, { texture: pageTexture }), profile, attempted);
    await source.initialize();
    const state = source.world.graphics.snapshot();
    let gpuQueries = 0;
    const configuration = new NativeConfiguration({ profile });
    const graphics = new NativeGraphics({
      game: { width: 64, height: 48 },
      configuration,
      runtime: new NativeRuntime({ profile, read: async () => null }),
      getNativeGPU() {
        gpuQueries++;
        throw new Error('No GPU query is allowed before policy validation');
      },
    });
    const beforeConfiguration = configuration.snapshot(),
      beforeGraphics = graphics.snapshot();
    assert.throws(() => graphics.initializeTextures(), /texture caps policy/);
    assert.equal(gpuQueries, 0);
    assert.deepEqual(configuration.snapshot(), beforeConfiguration);
    assert.deepEqual(graphics.snapshot(), beforeGraphics);
    assert.throws(() => graphics.restore(state), /texture caps policy/);
    assert.equal(gpuQueries, 0);
    assert.deepEqual(configuration.snapshot(), beforeConfiguration);
    assert.deepEqual(graphics.snapshot(), beforeGraphics);
    assert.equal(attempted.cpu, 0);
  } finally {
    await source?.dispose();
    environment.restore();
  }
});

test('old ABI 67 owns its absent APP default, explicit override and cold startup without inferring 63', async (t) => {
  const environment = startupEnvironment();
  const attempted = { cpu: 0, random: 0, tick: 0, step: 0 };
  let source,
    fresh,
    other,
    restoring = false,
    draws = 0;
  const next = NativeMT19937.prototype.nextUint32;
  t.mock.method(NativeMT19937.prototype, 'nextUint32', function (...args) {
    if (restoring) attempted.random++;
    else draws++;
    return next.apply(this, args);
  });
  for (const [prototype, name, counter] of [
    [NativeWorld.prototype, 'tick', 'tick'],
    [KCSMachine.prototype, 'step', 'step'],
  ]) {
    const original = prototype[name];
    t.mock.method(prototype, name, function (...args) {
      if (restoring) attempted[counter]++;
      return original.apply(this, args);
    });
  }
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 17, 3, 4, 5));
  try {
    const profile = 'bokutomo-engine-2.6.1.67';
    for (const code of [null, 'owned-explicit']) {
      const before = draws;
      source = core(await ownedGame('2.6.1.67', { code }), profile, attempted);
      await source.initialize();
      assert.deepEqual(
        [
          ...nativeStartupCode(
            source.world.startupDocument,
            nativeABI(profile).startup.verification,
          ),
        ],
        [...bytes(code === null ? 'open_cs2' : code)],
      );
      assert.equal(source.world.configuration.authorMode, 0);
      assert.equal(
        draws - before,
        32,
        'the original author producer runs before resource comparison',
      );
      const checkpoint = await source.snapshot();
      const oldWorld = source.world;
      await source.dispose();
      source = null;
      assert.equal(oldWorld.closed, true);
      assert.equal(oldWorld.objects.objects.size, 0);
      fresh = core(await ownedGame('2.6.1.67', { code }), profile, attempted);
      restoring = true;
      await fresh.initialize({ checkpoint });
      restoring = false;
      assert.equal(await checkpointDifference(await fresh.snapshot(), checkpoint), null);
      assert.deepEqual(attempted, { cpu: 0, random: 0, tick: 0, step: 0 });
      await fresh.dispose();
      fresh = null;
    }
    other = core(
      await ownedGame('2.6.1.63', { code: null }),
      'rebellions-jp-engine-2.6.1.63',
      attempted,
    );
    const before = draws;
    await other.initialize();
    assert.deepEqual(
      [
        ...nativeStartupCode(
          other.world.startupDocument,
          nativeABI(other.nativeProfile).startup.verification,
        ),
      ],
      [],
      '63 retains its independently reviewed empty default',
    );
    assert.equal(draws - before, 32);
    assert.deepEqual(
      nativeABI('rebellions-jp-engine-2.6.1.63').startup.verification.defaultCodeBytes,
      [],
    );
    assert.throws(
      () =>
        nativeStartupCode(null, nativeABI('nekopara-vol3-engine-2.6.1.76').startup.verification),
      /Startup code default is not reviewed/,
      'an unrelated unknown default is still refused at its actual consumer',
    );
    assert.deepEqual(attempted, { cpu: 0, random: 0, tick: 0, step: 0 });
  } finally {
    restoring = false;
    for (const instance of [other, fresh, source]) await instance?.dispose();
    environment.restore();
  }
});

test('old sound consumers reject unreviewed crossfade and do not invent elapsed tracking', async () => {
  const environment = startupEnvironment(),
    attempted = { cpu: 0 };
  try {
    for (const [version, profile] of versions) {
      const source = core(await ownedGame(version), profile, attempted);
      try {
        await source.initialize();
        const world = source.world,
          sound = world.sound.primary(world.main.id),
          controls = structuredClone(sound.snapshot().controls);
        assert.equal(nativeABI(profile).sound.completionFrame, null);
        if (version === '2.6.1.63') {
          const packet = new NativeSoundPacket([], 280);
          packet.store(0, 0);
          packet.writeString('owned.wav', 12);
          await assert.rejects(sound.load(packet, 1), /Unreviewed.*sound.crossfade/);
          assert.deepEqual(sound.snapshot().controls, controls);
        }
        await sound.tick(73);
        await sound.tick(77);
        assert.equal(sound.snapshot().frame, 77);
        assert.deepEqual(sound.snapshot().controls, controls);
        await assert.rejects(
          sound.message([world.main.nativeID, 219, 0, 0]),
          /Unmapped|unreviewed|unsupported/i,
        );
        assert.deepEqual(sound.snapshot().controls, controls);
        assert.equal(attempted.cpu, 0);
      } finally {
        await source.dispose();
      }
    }
  } finally {
    environment.restore();
  }
});

test('ordinary Draw enable follows each own pending policy and preserves raw storage', async () => {
  const profiles = [
    ['bokutomo-engine-2.6.1.67', [0, 0, 1, 0]],
    ['sdk-4.01-engine-2.6.1.74', [1, 0, 0x80000005, 0x80000005]],
    ['nekopara-vol3-engine-2.6.1.76', [1, 0, 0x80000005, 0x80000005]],
    ['rebellions-jp-engine-2.6.1.63', null],
  ];
  for (const [profile, expected] of profiles) {
    const game = memoryGame({ 'empty.kcs': kcsProgram([[59]]) }),
      random = new ParticleRandom(),
      world = new NativeWorld({
        profile,
        game,
        images: {},
        host: {},
        configuration: new NativeConfiguration({ profile }),
        storage: { read: async () => null, write: async () => true },
        random,
        motionLibrary: new MotionLibrary(game, { profile, random }),
      });
    try {
      await world.initialize('empty.kcs');
      const id = await world.objects.create({ kind: 15, parent: world.root }),
        draw = world.graphics.drawTasks.get(id),
        send = (value) => world.sendEngine(id, world.main.id, 286, 0, value);
      assert.equal(draw.state.enabled >>> 0, 1);
      assert.equal(draw.state.pending >>> 0, 0);
      if (expected === null) {
        const before = structuredClone(draw.snapshot());
        await assert.rejects(send(1), /Unreviewed.*drawEnablePendingPolicy/);
        assert.deepEqual(draw.snapshot(), before);
        continue;
      }
      const words = [1, 0, 0x80000005, 0x80000005];
      for (let i = 0; i < words.length; i++) {
        await send(words[i]);
        assert.equal(draw.state.pending >>> 0, expected[i]);
        assert.equal(draw.state.enabled, words[i]);
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  }
});

const title67Profile = 'bokutomo-engine-2.6.1.67';
const title67Sentinel = 0x23456789;
const title67Call = (id, args, result) => [
  ...args.map((value) => [37, value]),
  [43, id, args.length * 4],
  ...(result === undefined ? [] : [[38, [0x13, result]]]),
];

test('67 first-title entry GCALLs preserve VM zero and real task identity', async () => {
  const environment = startupEnvironment(),
    attempted = { cpu: 0 },
    program = kcsProgram(
      [
        [37, title67Sentinel],
        ...title67Call(393, [0]),
        ...title67Call(8, [0, 4]),
        [37, [0x13, 0]],
        [38, [0x13, 8]],
        [37, [0x13, 4]],
        [38, [0x13, 12]],
        ...title67Call(13, [0, 10000], 16),
        ...title67Call(14, [64, 10032], 20),
        ...title67Call(36, [128, 0x5a, 8]),
        ...title67Call(209, [64]),
        ...title67Call(66, [2, [0x13, 144], 10064], 40),
        ...title67Call(79, [[0x13, 40], floatBits(4.5), floatBits(3.25), 0x80112233]),
        ...title67Call(88, [[0x13, 40], floatBits(23.5)]),
        ...title67Call(92, [[0x13, 40], 1]),
        ...title67Call(104, [[0x13, 40], 0, 0, 4, 3, 17, 0x81230005]),
        ...title67Call(105, [[0x13, 40], 0x81230001]),
        ...title67Call(848, [[0x13, 40], 0x80000005]),
        ...title67Call(849, [[0x13, 40], 1]),
        ...title67Call(66, [15, [0x13, 144], 10096], 44),
        ...title67Call(256, [[0x13, 44], 4, 3]),
        ...title67Call(260, [[0x13, 44], 1, 2]),
        ...title67Call(262, [[0x13, 44], 1]),
        ...title67Call(66, [34, [0x13, 144], 10128], 48),
        ...title67Call(449, [
          [0x13, 48],
          [0x13, 44],
        ]),
        ...title67Call(447, [[0x13, 48], 10160]),
        ...title67Call(448, [[0x13, 48]]),
        ...title67Call(452, [[0x13, 48]], 52),
        [37, 73],
        [38, [0x13, 56]],
        [59],
      ],
      [
        [10000, 'owned'],
        [10032, 'formatted'],
        [10064, 'entry plane'],
        [10096, 'entry draw'],
        [10128, 'entry FES'],
        [10160, 'first'],
      ],
    );
  new DataView(program.buffer).setUint32(32, 16384, true);
  let source;
  try {
    source = core(
      await ownedGame('2.6.1.67', {
        scripts: [
          ['entry-owned.kcs', program],
          [
            'entry-cleanup.kcs',
            kcsProgram([...[144, 148, 152].flatMap((at) => title67Call(67, [[0x13, at]])), [59]]),
          ],
        ],
      }),
      title67Profile,
      attempted,
    );
    await source.initialize();
    const world = source.world,
      id = await world.objects.create({ kind: 12, parent: world.main.id, name: 'entry caller' }),
      record = world.objects.objects.get(id);
    await record.implementation.loadScript('entry-owned.kcs');
    const task = record.implementation.task,
      machine = task.machine,
      initialSP = machine.sp;
    machine.store(144, record.nativeID);
    machine.bytes(160, 8).fill(0xa5);
    assert.strictEqual(world.runtime.scheduler.tasks.get(id), task);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.deepEqual([machine.load(8), machine.load(12)], [128, 96]);
    assert.equal(machine.string(0), 'owned');
    assert.equal(machine.load(16), 0, 'The real native result may be guest address zero');
    assert.equal(machine.string(64), 'formatted');
    assert.equal(machine.load(20), 64);
    assert.deepEqual([...machine.bytes(128, 8)], Array(8).fill(0x5a));
    assert.deepEqual([...machine.bytes(160, 8)], Array(8).fill(0xa5));
    assert.equal(machine.load(56), 73);
    for (const [at, kind, name] of [
      [40, 2, 'entry plane'],
      [44, 15, 'entry draw'],
      [48, 34, 'entry FES'],
    ]) {
      const child = [...world.objects.objects.values()].find((item) => item.name === name);
      assert.equal(child.kind, kind);
      assert.equal(child.parent, id);
      assert.equal(world.nativeTaskID(child.id), machine.load(at));
    }
    const plane = [...world.objects.objects.values()].find((item) => item.name === 'entry plane'),
      region = world.input.get(plane.id);
    assert.deepEqual(plane.implementation.state.bindArea, [0, 0, 4, 3]);
    assert.equal(region.enabled, 0x81230001);
    assert.equal(region.hoverEnabled, 0x80000005);
    assert.equal(machine.pop(), title67Sentinel);
    assert.equal(machine.sp, initialSP);
    const children = [machine.load(48), machine.load(44), machine.load(40)];
    await record.implementation.loadScript('entry-cleanup.kcs');
    const cleanup = record.implementation.task;
    children.forEach((value, index) => cleanup.machine.store(144 + index * 4, value));
    await world.runtime.scheduler.execute(cleanup);
    const childWorldIDs = children.map((nativeID) => world.resolveTaskID(nativeID, id));
    assert.ok(
      childWorldIDs.every((childID) => world.objects.objects.get(childID).destroyRequested),
    );
    await world.objects.tick(world.frame + 1);
    assert.ok(childWorldIDs.every((childID) => !world.objects.objects.has(childID)));

    const beforeStrictMessage = structuredClone(record.implementation.snapshot());
    await assert.rejects(
      world.sendEngine(id, world.main.id, 9),
      /Unreviewed.*messages.scriptBaseOnly/,
    );
    assert.deepEqual(record.implementation.snapshot(), beforeStrictMessage);
    assert.equal(attempted.cpu, 0);
    for (const nativeID of [385, 856])
      assert.equal(nativeABI(title67Profile).tables.main.entries[nativeID].status, 'unknown');
    assert.equal(
      nativeABI('rebellions-jp-engine-2.6.1.63').tables.main.entries[393].status,
      'unknown',
    );
  } finally {
    await source?.dispose();
    environment.restore();
  }
});

function title67Audio() {
  return {
    currentTime: 0,
    state: 'running',
    decodeAudioData: async () => ({
      duration: 2,
      sampleRate: 60,
      length: 120,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(120).fill(0.25),
    }),
    close: async () => {},
  };
}
function title67Wave() {
  const result = new Uint8Array(284),
    view = new DataView(result.buffer),
    text = new TextEncoder();
  for (const [offset, value] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ])
    result.set(text.encode(value), offset);
  for (const [offset, value] of [
    [4, 276],
    [16, 16],
    [24, 60],
    [28, 120],
    [40, 240],
  ])
    view.setUint32(offset, value, true);
  for (const [offset, value] of [
    [20, 1],
    [22, 1],
    [32, 2],
    [34, 16],
  ])
    view.setUint16(offset, value, true);
  for (let offset = 44; offset < result.length; offset += 2) view.setInt16(offset, 8192, true);
  return result;
}
async function title67World(files, storage = { read: async () => null, write: async () => true }) {
  const entries = {
      'startup.xml': bytes(
        '<?xml version="1.0" encoding="shift_jis"?><document><INT>' +
          ['kcs:kcs', 'fes:fes', 'image:hg3', 'bgm:wav', 'mot:kcs']
            .map((entry, index) => {
              const [name, ext] = entry.split(':');
              return (
                '<int0' +
                index +
                '><name>' +
                name +
                '</name><int>owned.int</int><ext>' +
                ext +
                '</ext></int0' +
                index +
                '>'
              );
            })
            .join('') +
          '</INT><VOICE><v00><head>bgm</head></v00></VOICE></document>',
      ),
      'owned.int': kif(
        Object.entries({
          'main.kcs': kcsProgram([[59]]),
          'empty.kcs': kcsProgram([[59]]),
          ...files,
        }),
      ),
    },
    game = new GameFiles(
      new Map(
        Object.entries(entries).map(([name, data]) => [name, new BlobFile(new Blob([data]))]),
      ),
    );
  await game.open();
  const random = new ParticleRandom(),
    audio = new AudioMixer(game, title67Audio(), { deferPlayback: true }),
    world = new NativeWorld({
      profile: title67Profile,
      game,
      random,
      audio,
      host: {},
      images: {},
      configuration: new NativeConfiguration({
        profile: title67Profile,
        startup: parseNativeXML(entries['startup.xml']),
      }),
      motionLibrary: new MotionLibrary(game, { profile: title67Profile, random }),
      storage,
    });
  return { world, audio };
}

test('67 Input cursor changes reach the Sound, Script and FES receivers', async (t) => {
  const { world, audio } = await title67World({
    'main.kcs': kcsProgram([
      [37, 512],
      [43, 71, 4],
      [37, 528],
      [43, 71, 4],
      [37, 544],
      [43, 71, 4],
      [59],
    ]),
  });
  try {
    const main = await world.initialize('main.kcs'),
      records = world.objects.objects,
      input = records.get(records.get(world.root).implementation.input),
      sound = world.sound.primary(main.id),
      fesID = await world.objects.create({ kind: 34, parent: main.id }),
      notices = [],
      envelopes = [],
      sender = input.nativeID;
    const observe = (receiver, owner) => {
      const message = receiver.message;
      t.mock.method(receiver, 'message', async function (words, context, output) {
        const result = await message.call(this, words, context, output);
        if (words[1] === 22)
          notices.push([owner, words, result, context.nativeUnhandled, context.flags]);
        return result;
      });
    };
    observe(sound, 'Sound');
    observe(records.get(main.id).implementation, 'Script');
    observe(records.get(fesID).implementation, 'FES');
    const send = world.sendNativeEngine;
    t.mock.method(world, 'sendNativeEngine', async function (...args) {
      const result = await send.apply(this, args);
      if (args[2] === 11) envelopes.push([args[0], args[1], args[3], result]);
      return result;
    });

    world.input.cursorAutoHide = 1;
    world.input.cursorHideFrames = 1;
    await input.implementation.tick(world.frame + 1);
    assert.equal(world.input.cursorVisible, false);
    assert.deepEqual(
      [512, 516, 520, 524].map((at) => main.machine.load(at)),
      [sender, 0xffff0014, 0, 0],
    );

    world.sound.audio = null;
    world.input.pointer(4, 5);
    await input.implementation.tick(world.frame + 2);
    assert.equal(world.input.cursorVisible, true);
    assert.deepEqual(
      [528, 532, 536, 540].map((at) => main.machine.load(at)),
      [sender, 0xffff0014, 0, 1],
    );
    assert.deepEqual(envelopes, [
      [0, input.id, 0, 1],
      [0, input.id, 0, 1],
    ]);
    assert.deepEqual(notices, [
      ['Sound', [sender, 22, 0, 0], NATIVE_UNWRITTEN_WORD, true, 0],
      ['Script', [sender, 22, 0, 0], 1, false, 0],
      ['FES', [sender, 22, 0, 0], NATIVE_UNWRITTEN_WORD, true, 0],
      ['Sound', [sender, 22, 0, 1], 0, false, 0],
      ['Script', [sender, 22, 0, 1], 1, false, 0],
      ['FES', [sender, 22, 0, 1], NATIVE_UNWRITTEN_WORD, true, 0],
    ]);
    await assert.rejects(
      world.engineMessages.dispatch(sound.record.id, input.id, 21),
      /Unreviewed ABI message .*\/sound\/canonical\/21/,
    );

    world.sound.audio = audio;
    assert.deepEqual(
      await world.engineMessages.dispatch(sound.record.id, input.id, 22, 0xffffffff, 0xffffffff),
      { routed: true, handled: false, result: NATIVE_UNWRITTEN_WORD },
    );
    const emptyScript = await world.objects.create({ kind: 12, parent: main.id });
    assert.deepEqual(await world.engineMessages.dispatch(emptyScript, input.id, 22, 0, 1), {
      routed: true,
      handled: true,
      result: NATIVE_UNWRITTEN_WORD,
    });
    await assert.rejects(
      world.engineMessages.dispatch(main.id, input.id, 9),
      /Unreviewed ABI behavior .*\/messages\.scriptBaseOnly/,
    );
  } finally {
    world.sound.audio = audio;
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('67 first-title models use real FES services and restore without warm replay', async (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 17, 3, 4, 5));
  const pixels = new Uint8Array(4 * 3 * 4);
  for (let at = 0; at < pixels.length; at += 4) pixels.set([64, 96, 128, 255], at);
  const files = {
      'atlas.hg3': hg3(4, 3, pixels),
      'mask.hg3': hg3(4, 3, pixels),
      'bgm_owned.wav': title67Wave(),
      'dummy.kcs': kcsProgram([
        [43, 38, 0],
        [44, 0, 0],
      ]),
      'models.fes': bytes(
        '#PRELOAD\natlas\n#DEFINE\nCPLANE overlay\nPLANE plane\nCIMAGE solid\nIMAGE image\nBUTTON button\nSOUND tone\n#OBJECT SIZE COLOR DISP PRI\noverlay 4,3 0xffffffff 0 90\n#OBJECT SIZE VRAM PRI DISP\nplane 4,3 0,0 10 1\n#OBJECT SIZE COLOR PL DISP PRI\nsolid 4,3 0xff112233 plane 1 11\n#OBJECT FILE ID.0 PL DISP PRI\nimage atlas 0 plane 1 12\n#OBJECT FILE ID.0 ID.1 ID.2 ID.3 PRI TYPE ENABLE DISP\nbutton atlas 0 0 0 0 30 1 0 0\n#OBJECT CHANNEL STYPE FILE\ntone 0 0 bgm_owned.wav\n#START\ntone[0] play 1\nwait 1\nplane wipe 1 mask\nwait\nnext WAIT\n#WAIT\n',
      ),
    },
    source = await title67World(files),
    sent = [];
  let fresh;
  const cleanupErrors = [];
  try {
    const world = source.world;
    await world.initialize('empty.kcs');
    world.runtime.variableBank(world.main).initialize(64);
    const drawID = await world.objects.create({ kind: 15, parent: world.main.id });
    await world.sendEngine(drawID, world.main.id, 279, 4, 3);
    await world.sendEngine(drawID, world.main.id, 283, 0, 0);
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      task = world.objects.objects.get(id).implementation;
    await task.initialize(world.main.context.variableBank);
    await world.sendEngine(id, world.main.id, 334, 0, world.nativeTaskID(drawID));
    const send = world.sendNativeEngine;
    world.sendNativeEngine = function (target, sender, message, w, l, context) {
      sent.push({
        target,
        sender,
        message,
        w,
        l,
        flags: context?.flags ?? 0,
        loadWords:
          message === 174 ? [0, 4, 8, 268, 272, 276].map((at) => context.payload.load(at)) : null,
      });
      return send.call(this, target, sender, message, w, l, context);
    };
    assert.equal(await task.loadSource('models.fes'), true);
    const effects = task.player.root.runtime.effects.model,
      declare = effects.declare;
    let wipes = 0;
    effects.declare = function (spec) {
      if (spec.type === 8) wipes++;
      return declare.call(this, spec);
    };
    for (let frame = 1; frame <= 12; frame++) await world.tick(frame);
    const instance = task.player.root,
      types = new Set(instance.objects.map((object) => object.nativeType));
    for (const type of [1, 2, 3, 4, 6, 9]) assert.ok(types.has(type));
    assert.equal(wipes, 1, 'One real type8 effect was declared by the selected wipe command');
    assert.equal(
      instance.runtime.effects.model.entries.size,
      0,
      'The actual WIPE child completed and was collected',
    );
    assert.ok(
      sent.some((packet) => packet.message === 174),
      'Own non-allocated Sound load opcode',
    );
    assert.ok(
      sent.some((packet) => packet.message === 177),
      'Own Sound play opcode',
    );
    const soundPackets = sent.filter((packet) => packet.target === task.player.nativeSoundTaskID);
    assert.ok(soundPackets.length > 0);
    assert.ok(soundPackets.every((packet) => packet.sender === id && packet.flags === 0));
    assert.deepEqual(
      soundPackets.find((packet) => packet.message === 174).loadWords,
      [0, 0, 0, 0, 1, 0],
    );
    const play = soundPackets.find((packet) => packet.message === 177);
    assert.deepEqual([play.w, play.l], [0, 1]);
    assert.ok([...source.audio.channels.values()].some((channel) => channel.playing));
    const state = world.snapshot(0),
      audioState = source.audio.snapshot(0);
    fresh = await title67World(files);
    let replay = 0;
    const native = NativeRuntime.prototype.native,
      step = KCSMachine.prototype.step;
    t.mock.method(NativeRuntime.prototype, 'native', function (...args) {
      replay++;
      return native.apply(this, args);
    });
    t.mock.method(KCSMachine.prototype, 'step', function (...args) {
      replay++;
      return step.apply(this, args);
    });
    await fresh.audio.restore(audioState);
    await fresh.world.restore(structuredClone(state));
    assert.equal(replay, 0);
    assert.equal(await checkpointDifference(fresh.world.snapshot(0), state), null);
    await world.close();
    assert.ok(
      [...fresh.audio.channels.values()].some((channel) => channel.playing),
      'Closing the old World preserves the fresh owner',
    );
  } finally {
    for (const owner of [fresh, source]) {
      try {
        await owner?.world.close();
        await owner?.audio.dispose();
      } catch (error) {
        cleanupErrors.push(error);
        t.diagnostic('Cleanup also rejected: ' + error.message);
      }
    }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Owned title fixture cleanup');
});

test('67 first-title motion runs own round linear triangle and clear contracts', async () => {
  const script = await readKCS(
      kcsProgram([
        [37, title67Sentinel],
        ...title67Call(17, [floatBits(127.5)], 512),
        ...title67Call(
          41,
          [floatBits(0), floatBits(255), floatBits(0), floatBits(30), floatBits(15)],
          516,
        ),
        ...title67Call(42, [floatBits(45), floatBits(180)], 520),
        ...title67Call(38, []),
        [59],
      ]),
    ),
    motion = new MotionInstance(script, { profile: title67Profile }),
    initialSP = motion.machine.sp;
  const result = motion.update(3);
  assert.equal(result.active, false);
  assert.equal(motion.machine.load(512), 128);
  assert.equal(bitsFloat(motion.machine.load(516)), 127.5);
  assert.equal(bitsFloat(motion.machine.load(520)), 1);
  assert.deepEqual(
    [...motion.calls],
    [
      [17, 1],
      [41, 1],
      [42, 1],
      [38, 1],
    ],
  );
  assert.equal(motion.machine.pop(), title67Sentinel);
  assert.equal(motion.machine.sp, initialSP);
});

const close67Program = (body, strings = [], dataSize = 16384) => {
  const program = kcsProgram(body, strings);
  new DataView(program.buffer, program.byteOffset, program.byteLength).setUint32(
    32,
    dataSize,
    true,
  );
  return program;
};
async function close67Caller(world, name) {
  const id = await world.objects.create({
      kind: 12,
      parent: world.main.id,
      name: 'owned close caller',
    }),
    implementation = world.objects.objects.get(id).implementation;
  await implementation.loadScript(name);
  return implementation.task;
}

test('67 close GCALLs persist real banks and raw database bytes through a cold owner', async (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 17, 3, 4, 5));
  const prefix = [
      ...title67Call(238, [0x81234567], 512),
      ...title67Call(244, [[0x13, 512], 16384, 4, 0], 516),
      ...title67Call(833, [300], 536),
    ],
    waitPC = (await readKCS(kcsProgram(prefix))).codeSize,
    program = close67Program(
      [
        ...prefix,
        [37, 384],
        [43, 71, 4],
        [39, waitPC],
        [37, title67Sentinel],
        ...title67Call(240, [[0x13, 512], 1024, [0x13, 56], 2, 3], 520),
        ...title67Call(469, [[0x13, 512], 16384]),
        ...title67Call(244, [[0x13, 512], 16384, 4, 0], 524),
        ...title67Call(277, [7, 128], 528),
        ...title67Call(872, [[0x13, 52], 0], 532),
        ...title67Call(
          872,
          [
            [0x13, 52],
            [0x13, 536],
          ],
          540,
        ),
        ...title67Call(835, [[0x13, 512], 0x10000001, [0x13, 532], [0x13, 536]], 544),
        ...title67Call(245, [[0x13, 512], 10000], 548),
        ...title67Call(834, [[0x13, 536]]),
        ...title67Call(246, [[0x13, 512]]),
        ...title67Call(870, [[0x13, 52]]),
        [59],
      ],
      [[10000, 'owned-close.css']],
    ),
    files = new SaveSlotFiles(),
    owned = { 'close-owned.kcs': program },
    source = await title67World(owned, files);
  let fresh,
    restoring = false;
  const warm = { native: 0, step: 0, tick: 0, random: 0 },
    observe = (prototype, name, counter) => {
      const original = prototype[name];
      t.mock.method(prototype, name, function (...args) {
        if (restoring) warm[counter]++;
        return original.apply(this, args);
      });
    };
  for (const [prototype, method, counter] of [
    [NativeRuntime.prototype, 'native', 'native'],
    [KCSMachine.prototype, 'step', 'step'],
    [NativeWorld.prototype, 'tick', 'tick'],
    [NativeMT19937.prototype, 'nextUint32', 'random'],
  ])
    if (typeof prototype[method] === 'function') observe(prototype, method, counter);
  try {
    await source.world.initialize('empty.kcs');
    const task = await close67Caller(source.world, 'close-owned.kcs'),
      machine = task.machine,
      initialSP = machine.sp,
      database = new NativeDatabase();
    database.records.set('owned', {
      name: bytes('owned'),
      flags: new Uint32Array([0x81234567, 0x40000000, 1]),
    });
    const databaseHandle = source.world.runtime.handles.add('database', database);
    machine.store(52, databaseHandle);
    machine.store(56, source.world.nativeTaskID(task.id));
    machine.bytes(0, 4).set([0xfe, 0xca, 0, 0x81]);
    const bank = source.world.runtime.variableBank(task);
    bank.initialize(8);
    [0x80000000, 0xdeadbeef, 0x7fc01234].forEach((word, i) => bank.set(2 + i, word));
    source.world.runtime.stringBank(task).set(7, '猫');
    await source.world.runtime.scheduler.execute(task);
    assert.equal(machine.waiting.kind, 'message');
    const fileHandle = machine.load(512),
      pointer = machine.load(536),
      memory = source.world.runtime.imageDataBuffers.process;
    memory.write(pointer, new Uint8Array(300).fill(0xa5));
    assert.equal(memory.load(pointer - 4), 1);
    assert.equal(memory.allocations.has(pointer - 4), true);
    const state = source.world.snapshot(0);
    fresh = await title67World(owned, files);
    restoring = true;
    await fresh.world.restore(structuredClone(state));
    restoring = false;
    assert.equal(await checkpointDifference(fresh.world.snapshot(0), state), null);
    assert.deepEqual(warm, { native: 0, step: 0, tick: 0, random: 0 });
    const restoredFile = fresh.world.runtime.handles.get(fileHandle, 'global-file');
    assert.notStrictEqual(
      restoredFile,
      source.world.runtime.handles.get(fileHandle, 'global-file'),
    );
    assert.notStrictEqual(fresh.world.runtime.imageDataBuffers.process.regions, memory.regions);
    const writes = [],
      write = files.write.bind(files);
    files.write = function (name, data, options) {
      const owner = writes.length ? fresh.world : source.world;
      const store = owner.runtime.imageDataBuffers.process;
      writes.push({ name, data: data.slice(), options, canary: store.read(pointer + 272, 28) });
      return write(name, data, options);
    };
    await source.world.close();
    assert.equal(source.world.closed, true);
    assert.equal(source.world.runtime.handles.records.size, 0);
    assert.equal(fresh.world.runtime.handles.get(fileHandle, 'global-file'), restoredFile);
    assert.equal(fresh.world.runtime.imageDataBuffers.process.load(pointer - 4), 1);
    assert.deepEqual(
      [520, 524, 528, 532, 540, 544, 548].map((at) => machine.load(at)),
      [1, 1, 1, 272, 272, 1, 1],
    );
    assert.equal(machine.string(128), '猫');
    assert.equal(machine.pop(), title67Sentinel);
    assert.equal(machine.sp, initialSP);
    const expectedDatabase = new Uint8Array(272),
      view = new DataView(expectedDatabase.buffer);
    view.setUint32(0, 1, true);
    expectedDatabase.set(bytes('owned'), 4);
    [0x81234567, 0x40000000, 1].forEach((word, i) => view.setUint32(260 + i * 4, word, true));
    const saved = await NativeGlobalFile.fromFile(writes[0].data);
    assert.equal(saved.tag, 0x81234567);
    assert.deepEqual(
      saved.records.map((row) => [row.id, row.bytes.length]),
      [
        [1024, 12],
        [16384, 4],
        [0x10000001, 272],
      ],
    );
    assert.deepEqual(
      Array.from(new Uint32Array(saved.read(1024).buffer)),
      [0x80000000, 0xdeadbeef, 0x7fc01234],
    );
    assert.deepEqual([...saved.read(16384)], [0xfe, 0xca, 0, 0x81]);
    assert.deepEqual(saved.read(0x10000001), expectedDatabase);
    assert.deepEqual([...writes[0].canary], Array(28).fill(0xa5));
    assert.deepEqual(writes[0].options, { updateModified: true });
    await fresh.world.close();
    assert.equal(fresh.world.runtime.handles.records.size, 0);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].data, writes[0].data);
  } finally {
    restoring = false;
    await fresh?.world.close();
    await fresh?.audio.dispose();
    await source.world.close();
    await source.audio.dispose();
  }
});

test('67 close results keep empty text and growth own while refusing an unwritten database result', async () => {
  const program = close67Program(
      [
        [37, title67Sentinel],
        ...title67Call(277, [8, 64], 512),
        ...title67Call(277, [9, 96], 516),
        ...title67Call(238, [99], 520),
        ...title67Call(244, [[0x13, 520], 1, 0x80001, 1024], 524),
        [59],
      ],
      [],
      0x82000,
    ),
    nullProgram = close67Program([...title67Call(872, [0, 0], 64), [59]]),
    source = await title67World({ 'limits.kcs': program, 'null-export.kcs': nullProgram });
  try {
    const world = source.world;
    await world.initialize('empty.kcs');
    const task = await close67Caller(world, 'limits.kcs'),
      machine = task.machine,
      initialSP = machine.sp;
    world.runtime.stringBank(task).set(8, '');
    machine.bytes(64, 8).fill(0xa5);
    machine.bytes(96, 8).fill(0xa5);
    machine.bytes(1024, 0x80001).fill(0x5a);
    await world.runtime.scheduler.execute(task);
    assert.deepEqual([machine.load(512), machine.load(516), machine.load(524)], [0, 0, 1]);
    assert.deepEqual([...machine.bytes(64, 3)], [0, 0xa5, 0xa5]);
    assert.deepEqual([...machine.bytes(96, 3)], [0, 0xa5, 0xa5]);
    const file = world.runtime.handles.get(machine.load(520), 'global-file');
    assert.equal(file.capacity, 0x100000);
    assert.equal(file.used, 0x80009);
    assert.equal(file.read(1).length, 0x80001);
    assert.equal(machine.pop(), title67Sentinel);
    assert.equal(machine.sp, initialSP);
    const empty = await close67Caller(world, 'null-export.kcs');
    empty.machine.store(64, 0xa5a5a5a5);
    const before = world.runtime.handles.snapshot();
    await assert.rejects(() => world.runtime.scheduler.execute(empty), /unwritten|uninitialized/);
    assert.equal(empty.machine.load(64), 0xa5a5a5a5);
    assert.deepEqual(world.runtime.handles.snapshot(), before);
    assert.equal(
      nativeABI('rebellions-jp-engine-2.6.1.63').tables.main.entries[238].status,
      'unknown',
    );
    for (const id of [239, 385, 856, 869, 871, 873])
      assert.equal(nativeABI(title67Profile).tables.main.entries[id].status, 'unknown');
  } finally {
    await source.world.close();
    await source.audio.dispose();
  }
});
