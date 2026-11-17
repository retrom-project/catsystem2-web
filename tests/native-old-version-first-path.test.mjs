// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { KCSMachine, encodeCP932 } from '../src/kcs.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeMT19937 } from '../src/ppi/random.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { nativeABI, abiForEngineVersion } from '../src/native/abi/index.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NativeGraphics } from '../src/native/graphics.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeSoundPacket } from '../src/native/sound.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { nativeStartupCode } from '../src/native/startup-author.mjs';
import { kif, kcsProgram, memoryGame } from './helpers.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  startupVersionImage,
} from './fixtures/ordinary-startup.mjs';
import { checkpointDifference } from './browser/checkpoint-observation.mjs';

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
