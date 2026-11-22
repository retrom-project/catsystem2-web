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
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
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
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { NativeDatabase } from '../src/native/database.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';
import { compiledDatabase } from './fixtures/compiled-database-data.mjs';

const versions = [
  ['2.6.1.63', 'rebellions-jp-engine-2.6.1.63', 203, 3],
  ['2.6.1.67', 'bokutomo-engine-2.6.1.67', 204, 4],
];
const bytes = (value) => encodeCP932(value);
const title = '$unreviewed$Raw title 日本語';

async function ownedGame(
  version,
  { scripts = [], texture = '', voiceExtra = '', code = 'owned-code', flagCount } = {},
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
    (flagCount === undefined ? '' : '<GAME><flag><max>' + flagCount + '</max></flag></GAME>') +
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
        if (version === '2.6.1.63')
          assert.deepEqual(instance.expandMacros(bytes('OWNED')), bytes('7'));
        else
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
        const historySave = () => world.runtime.native('main', 385, [0, 0, 0, 0], machine, main);
        if (version === '2.6.1.63') assert.deepEqual(historySave(), { control: 1, value: 0 });
        else assert.throws(historySave, /Unsupported|unrecovered/i);
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
  for (const [version, profile] of versions) {
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
    const unknown = [[856, 7]];
    if (version === '2.6.1.67') unknown.push([385, 4]);
    for (const [id, words] of unknown) {
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

test('old sound ticks preserve state with unreviewed elapsed tracking', async () => {
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
    ['rebellions-jp-engine-2.6.1.63', [0, 0, 1, 0]],
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

test('63 startup GCALLs read the clock, configuration and viewport before a Script wait', async () => {
  const environment = startupEnvironment(),
    attempted = { cpu: 0 },
    version = '2.6.1.63',
    profile = 'rebellions-jp-engine-2.6.1.63',
    sentinel = 0x12345678,
    capacity = 1032,
    program = kcsProgram(
      [
        [37, sentinel],
        [37, 0],
        [43, 393, 4],
        [37, 512],
        [37, 516],
        [43, 8, 8],
        [43, 5, 0],
        [38, [0x13, 536]],
        [37, 1],
        [37, 7],
        [37, 540],
        [37, 544],
        [43, 790, 16],
        [38, [0x13, 548]],
        [37, 0],
        [37, 0xffffffff],
        [37, 540],
        [37, 544],
        [43, 790, 16],
        [38, [0x13, 552]],
        [37, 556],
        [37, 560],
        [43, 739, 8],
        [43, 741, 0],
        [38, [0x13, 568]],
        [37, 0xc0ffee01],
        [43, 908, 4],
        [37, 0xc0ffee01],
        [37, 0xc0ffee02],
        [43, 926, 8],
        [43, 925, 0],
        [38, [0x13, 572]],
        [37, 600],
        [37, 800],
        [43, 15, 8],
        [38, [0x13, 564]],
        [37, 0],
        [37, 768],
        [43, 13, 8],
        [38, [0x13, 520]],
        [43, 68, 0],
        [38, [0x13, 524]],
        [43, 789, 0],
        [38, [0x13, 528]],
        [37, [0x13, 528]],
        [43, 209, 4],
        [37, capacity - 1],
        [37, 93],
        [43, 211, 8],
        [38, [0x13, 532]],
        [37, 576],
        [43, 71, 4],
        [59],
      ],
      [
        [768, 'owned'],
        [800, '尾'],
      ],
    );
  let source;
  try {
    source = core(
      await ownedGame(version, { flagCount: capacity, scripts: [['entry63.kcs', program]] }),
      profile,
      attempted,
    );
    await source.initialize();
    const world = source.world,
      task = await world.spawnScript('entry63.kcs'),
      machine = task.machine;
    world.configuration.variableRanges.global.set([41, 7], 14);
    world.configuration.screen.multiWindowPosition = 3;
    world.graphics.view.configure({
      virtualWidth: 800,
      virtualHeight: 600,
      clientWidth: 1600,
      clientHeight: 900,
      deviceOffset: [20.75, -11.25],
      deviceScale: 1.5,
      windowShift: [3, -2],
    });
    machine.bytes(0, 8).fill(0xa5);
    machine.bytes(600, 8).fill(0xa5);
    machine.writeString('古', 600);
    await world.tick();

    assert.equal(world.menu.get(0x77), false);
    assert.deepEqual([machine.load(512), machine.load(516)], world.graphics.virtualSize());
    assert.equal(machine.load(536), world.frame);
    assert.deepEqual(
      [540, 544, 548, 552].map((at) => machine.load(at)),
      [41, 7, 1, 0],
    );
    assert.deepEqual([machine.load(556) | 0, machine.load(560) | 0], [4, -3]);
    assert.equal(machine.load(568), 0);
    assert.equal(machine.load(572), 0);
    world.configuration.screen.fullscreen = 1;
    try {
      assert.deepEqual(world.runtime.native('main', 741, [], machine, task), {
        control: 1,
        value: 3,
      });
    } finally {
      world.configuration.screen.fullscreen = 0;
    }
    assert.equal(machine.load(564), 600);
    assert.deepEqual([...machine.bytes(600, 7)], [...bytes('古尾'), 0, 0, 0xa5]);
    assert.deepEqual(world.runtime.native('main', 16, [600, 800], machine, task), {
      control: 1,
      value: 600,
    });
    assert.deepEqual([...machine.bytes(600, 8)], [...bytes('古尾尾'), 0, 0]);
    assert.deepEqual(world.runtime.native('main', 47, [600], machine, task), {
      control: 1,
      value: 3,
    });
    machine.bytes(608, 5).set([0xa1, 0x41, 0x81, 0x39, 0]);
    assert.deepEqual(world.runtime.native('main', 47, [608], machine, task), {
      control: 1,
      value: 3,
    });
    const { name, signature } = nativeABI(profile).tables.main.entries[5];
    assert.equal(name, 'task.clock');
    assert.equal(signature.argumentWords, 0);
    assert.deepEqual(signature.controlCodes, [1]);
    assert.equal(signature.resultWritten, true);
    const copied = [...bytes('owned'), 0, 0, 0xa5];
    assert.deepEqual([...machine.bytes(0, 8)], copied);
    assert.throws(
      () => world.runtime.native('main', 13, [0, 0xffffffff], machine, task),
      /KCS memory ffffffff/,
    );
    assert.deepEqual([...machine.bytes(0, 8)], copied);
    assert.deepEqual(
      [520, 524, 528, 532].map((at) => machine.load(at)),
      [0, world.nativeTaskID(task.id), capacity, sentinel],
    );

    const bank = world.runtime.variableBank(task, false);
    assert.equal(bank.capacity, capacity);
    assert.equal(bank.get(0), 0);
    assert.equal(bank.get(capacity - 1), 93);
    assert.equal(bank.dirty, true);
    bank.dirty = false;
    assert.deepEqual(world.runtime.native('main', 211, [capacity, 12], machine, task), {
      control: 2,
    });
    assert.equal(bank.get(capacity), 0);
    assert.equal(bank.get(capacity - 1), 93);
    assert.equal(bank.dirty, true);

    assert.equal(machine.waiting.address, 576);
    const words = [1, 0xffff0001, 0, 93];
    assert.deepEqual(await world.runtime.scheduler.send(task.id, words), {
      accepted: true,
      result: 0,
      message: words,
    });
    assert.deepEqual(
      [576, 580, 584, 588].map((at) => machine.load(at)),
      words,
    );
    assert.equal(attempted.cpu, 0);
  } finally {
    try {
      await source?.dispose();
    } finally {
      environment.restore();
    }
  }
});

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
      nativeABI('rebellions-jp-engine-2.6.1.63').tables.main.entries[629].status,
      'unknown',
    );
  } finally {
    await source?.dispose();
    environment.restore();
  }
});

function oldTitleAudio() {
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
async function oldTitleWorld(
  files,
  storage = { read: async () => null, write: async () => true },
  profile = title67Profile,
) {
  const entries = {
      'startup.xml': bytes(
        '<?xml version="1.0" encoding="shift_jis"?><document><INT>' +
          ['kcs:kcs', 'fes:fes', 'image:hg3', 'bgm:wav', 'mot:kcs', 'ptcl:kcs']
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
    audio = new AudioMixer(game, oldTitleAudio(), { deferPlayback: true }),
    world = new NativeWorld({
      profile,
      game,
      random,
      audio,
      host: {},
      images: {},
      configuration: new NativeConfiguration({
        profile,
        startup: parseNativeXML(entries['startup.xml']),
      }),
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage,
    });
  return { world, audio };
}

test('63 Script owns and persists its CG registrations and releases the restored handle', async () => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    gallery = [0x13, 512],
    globalFile = [0x13, 516],
    mark = 7,
    list = new Uint8Array(12 + 72 + 64),
    view = new DataView(list.buffer);
  view.setInt32(4, 3, true);
  view.setUint32(8, 1, true);
  list.set(bytes('Opening'), 16);
  view.setUint32(80, 1, true);
  list.set(bytes('shot,2,4'), 84);
  const files = {
    'sample-cg.dat': list,
    'cg63.kcs': kcsProgram(
      [
        [43, 419, 0],
        [38, gallery],
        [37, gallery],
        [37, 1024],
        [43, 458, 8],
        [37, gallery],
        [37, 1056],
        [43, 458, 8],
        [37, gallery],
        [37, 3],
        [37, 1088],
        [43, 459, 12],
        [37, gallery],
        [37, 1120],
        [43, 422, 8],
        [37, gallery],
        [37, 1152],
        [43, 423, 8],
        [38, [0x13, 520]],
        [37, globalFile],
        [37, mark],
        [37, gallery],
        [43, 424, 12],
        [38, [0x13, 524]],
        [37, gallery],
        [43, 421, 4],
        [37, gallery],
        [37, 1184],
        [43, 423, 8],
        [38, [0x13, 528]],
        [37, globalFile],
        [37, mark],
        [37, gallery],
        [43, 425, 12],
        [38, [0x13, 532]],
        [37, gallery],
        [37, 1184],
        [43, 423, 8],
        [38, [0x13, 536]],
        [37, 576],
        [43, 71, 4],
        [37, gallery],
        [43, 420, 4],
        [59],
      ],
      [
        [1024, 'owned.int/sample-cg.dat'],
        [1056, 'owned.int/missing.dat'],
        [1088, 'opening'],
        [1120, 'heroL,02,3'],
        [1152, 'hero,02,3'],
        [1184, 'shot,2,4'],
      ],
    ),
  };
  let fresh;
  const { world } = await oldTitleWorld(files, undefined, profile);
  try {
    await world.initialize('main.kcs');
    const task = await world.spawnScript('cg63.kcs'),
      state = new NativeGlobalFile(0, 0x80000),
      file = world.runtime.handles.add('global-file', state);
    task.machine.store(516, file);
    await world.tick();

    const handle = task.machine.load(512),
      owned = world.runtime.handles.get(handle, 'cg-registration');
    assert.deepEqual(
      [520, 524, 528, 532, 536].map((at) => task.machine.load(at)),
      [1, 1, 0, 1, 1],
    );
    assert.deepEqual(owned.variants('opening', 3, true), ['shot,2,4']);
    const stored = state.read(mark),
      header = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
    assert.equal(stored.length, 3 * (68 + 2 * 8));
    assert.equal(header.getUint32(0, true), 1);
    assert.equal(header.getUint32(68, true), 1);
    assert.equal(header.getInt32(76 + 4, true), -1);
    assert.deepEqual(owned.registry.write(), stored);

    ({ world: fresh } = await oldTitleWorld(files, undefined, profile));
    await fresh.restore(world.snapshot());
    const restored = fresh.runtime.handles.get(handle, 'cg-registration');
    assert.notStrictEqual(restored, owned);
    assert.deepEqual(restored.registry.write(), stored);
    assert.deepEqual(restored.variants('opening', 3, true), ['shot,2,4']);
    await fresh.runtime.scheduler.send(task.id, [1, 0xffff0001, 0, 0]);
    await fresh.tick();
    assert.throws(() => fresh.runtime.handles.get(handle, 'cg-registration'), /handle/i);
    assert.deepEqual(fresh.runtime.handles.get(file, 'global-file').read(mark), stored);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('63 Script opens, queries and releases a grouped tone table', async () => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    table = [0x13, 512],
    lookup = (id, name, output, result) => [
      [37, table],
      [37, name],
      [37, output],
      [37, output + 4],
      [37, output + 8],
      [43, id, 20],
      [38, [0x13, result]],
    ];
  const { world } = await oldTitleWorld(
    {
      'tones.tbl': bytes('#Dusk(31,64,127)\r\nGarden//alias\r\n'),
      'tones63.kcs': kcsProgram(
        [
          [37, 1024],
          [43, 594, 4],
          [38, table],
          ...lookup(596, 1056, 520, 532),
          ...lookup(597, 1088, 536, 548),
          ...lookup(597, 1120, 536, 552),
          [37, table],
          [43, 595, 4],
          [37, 1152],
          [43, 594, 4],
          [38, [0x13, 556]],
          [37, 576],
          [43, 71, 4],
          [59],
        ],
        [
          [1024, 'owned.int/tones.tbl'],
          [1056, '#DUSK'],
          [1088, 'garden'],
          [1120, 'missing'],
          [1152, 'owned.int/missing.tbl'],
        ],
      ),
    },
    undefined,
    profile,
  );
  try {
    await world.initialize('main.kcs');
    const { machine } = await world.spawnScript('tones63.kcs');
    await world.tick();
    assert.deepEqual(
      [520, 524, 528, 532].map((at) => machine.load(at)),
      [31, 64, 127, 1],
    );
    assert.deepEqual(
      [536, 540, 544, 548, 552, 556].map((at) => machine.load(at)),
      [31, 64, 127, 1, 0, 0],
    );
    assert(machine.load(512));
    assert.throws(
      () => world.runtime.handles.get(machine.load(512), 'character-names'),
      /released/,
    );
  } finally {
    await world.close();
  }
});

async function verifyCursorVisibility(t, profile, cursorMessage = 22) {
  const { world, audio } = await oldTitleWorld(
    {
      'main.kcs': kcsProgram([
        [37, 512],
        [43, 71, 4],
        [37, 528],
        [43, 71, 4],
        [37, 544],
        [43, 71, 4],
        [59],
      ]),
    },
    undefined,
    profile,
  );
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
        if (words[1] === cursorMessage)
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
      ['Sound', [sender, cursorMessage, 0, 0], NATIVE_UNWRITTEN_WORD, true, 0],
      ['Script', [sender, cursorMessage, 0, 0], 1, false, 0],
      ['FES', [sender, cursorMessage, 0, 0], NATIVE_UNWRITTEN_WORD, true, 0],
      ['Sound', [sender, cursorMessage, 0, 1], 0, false, 0],
      ['Script', [sender, cursorMessage, 0, 1], 1, false, 0],
      ['FES', [sender, cursorMessage, 0, 1], NATIVE_UNWRITTEN_WORD, true, 0],
    ]);
    const unreviewed = cursorMessage === 22 ? 21 : 22;
    await assert.rejects(
      world.engineMessages.dispatch(sound.record.id, input.id, unreviewed),
      new RegExp(`Unreviewed ABI message .*/sound/canonical/${unreviewed}`),
    );

    world.sound.audio = audio;
    assert.deepEqual(
      await world.engineMessages.dispatch(
        sound.record.id,
        input.id,
        cursorMessage,
        0xffffffff,
        0xffffffff,
      ),
      { routed: true, handled: false, result: NATIVE_UNWRITTEN_WORD },
    );
    const emptyScript = await world.objects.create({ kind: 12, parent: main.id });
    assert.deepEqual(
      await world.engineMessages.dispatch(emptyScript, input.id, cursorMessage, 0, 1),
      {
        routed: true,
        handled: true,
        result: NATIVE_UNWRITTEN_WORD,
      },
    );
    await assert.rejects(
      world.engineMessages.dispatch(main.id, input.id, profile === title67Profile ? 9 : 65),
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
}

for (const [version, profile] of versions) {
  test(version + ' Input cursor changes reach the Sound, Script and FES receivers', (t) =>
    verifyCursorVisibility(t, profile),
  );
}

test('2.6.1.23 Input cursor changes reach Sound, Script and FES through its own message', (t) =>
  verifyCursorVisibility(t, 'grisaia-jp-engine-2.6.1.23', 21));

test('63 startup Plane GCALLs bind and release the owned Input region', async () => {
  const { world, audio } = await oldTitleWorld({}, undefined, 'rebellions-jp-engine-2.6.1.63');
  try {
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, machine, main),
      done = { control: 2 };
    machine.writeString('owned startup plane', 128);
    assert.deepEqual(await call(79, [0, 0, 0, 0]), done);
    const child = await call(66, [2, world.nativeTaskID(main.id), 128]),
      target = world.resolveTaskID(child.value, main.id),
      plane = world.graphics.get(target);
    assert.equal(child.control, 1);
    assert.deepEqual(
      await call(79, [child.value, floatBits(4.5), floatBits(3.25), 0x80112233]),
      done,
    );
    assert.deepEqual(await call(88, [child.value, floatBits(23.5)]), done);
    assert.deepEqual(await call(92, [child.value, 1]), done);
    assert.deepEqual(await call(104, [child.value, 77, 80, 7, 8, 99, 0x81230005]), done);
    assert.deepEqual(await call(105, [child.value, 0x81230001]), done);
    assert.deepEqual(await call(848, [child.value, 0x80000005]), done);
    assert.deepEqual(await call(849, [child.value, 0x80000007]), done);

    const region = world.input.get(target);
    assert.deepEqual(plane.state.bindArea, [0, 0, 4, 3]);
    assert.equal(region.owner, target);
    assert.equal(region.receiver, world.nativeTaskID(main.id));
    assert.equal(region.priority, 23);
    assert.equal(region.flags, 0);
    assert.equal(region.enabled, 0x81230001);
    assert.equal(region.hoverEnabled, 0x80000005);
    assert.equal(region.dragEnabled, 0x80000007);

    assert.deepEqual(await call(67, [child.value]), done);
    await world.tick();
    assert.equal(world.objects.objects.has(target), false);
    assert.equal(world.input.get(target), null);
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 cold Script idle clears VRAM, updates its Plane and polls the live FES exit word', async (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 18, 3, 4, 5));
  const profile = 'rebellions-jp-engine-2.6.1.63',
    color = 0xff112233,
    files = {
      'main.kcs': kcsProgram([
        [37, title67Sentinel],
        ...title67Call(71, [512]),
        [45],
        ...title67Call(117, [0, 1, 0, 2, 1, color]),
        ...title67Call(92, [[0x13, 528], 0]),
        ...title67Call(100, [[0x13, 528], color, 0x81230005]),
        ...title67Call(448, [[0x13, 532]]),
        ...title67Call(117, [[0x13, 536], 1, 0, 1, 1, color]),
        ...title67Call(452, [[0x13, 532]], 540),
        [59],
      ]),
      'flow.fes': bytes('#START\nwait 6\nexit 17\n'),
    },
    source = await oldTitleWorld(files, undefined, profile);
  let fresh;
  t.after(async () => {
    for (const owner of [fresh, source]) {
      if (!owner) continue;
      try {
        await owner.world.close();
      } finally {
        await owner.audio.dispose();
      }
    }
  });

  const { world } = source,
    main = await world.initialize('main.kcs'),
    call = (id, args) => world.runtime.native('main', id, args, main.machine, main),
    planeID = await world.objects.create({ kind: 2, parent: main.id }),
    nativePlane = world.nativeTaskID(planeID),
    draw = await world.objects.create({ kind: 15, parent: main.id }),
    owner = await world.objects.create({ kind: 34, parent: main.id }),
    fes = world.objects.objects.get(owner).implementation,
    vram = await world.graphics.ensureVRAM(4, 3),
    bitmap = world.graphics.images.create(2, 3, main.id);
  world.runtime.variableBank(main).initialize(16);
  await call(79, [nativePlane, floatBits(4), floatBits(3), 0xffffffff]);
  await call(92, [nativePlane, 1]);
  await world.sendEngine(draw, main.id, 279, 4, 3);
  await world.sendEngine(draw, main.id, 283, 0, 0);
  await fes.initialize(main.context.variableBank);
  await world.sendEngine(owner, main.id, 334, 0, world.nativeTaskID(draw));
  await fes.loadSource('flow.fes');
  await vram.fill(0, 0, 4, 3, 0xff432100);
  [nativePlane, world.nativeTaskID(owner), bitmap].forEach((value, i) =>
    main.machine.store(528 + i * 4, value),
  );
  assert.equal(main.machine.waiting.kind, 'message');
  const state = world.snapshot(0);
  fresh = await oldTitleWorld(files, undefined, profile);
  await fresh.world.restore(structuredClone(state));
  assert.equal(await checkpointDifference(fresh.world.snapshot(0), state), null);
  const next = fresh.world,
    resumed = next.main;
  await next.tick();

  const pixels = await next.graphics.images.get(next.graphics.vramHandle).pixels(),
    bitmapPixels = await next.graphics.images.get(bitmap).pixels(),
    plane = next.graphics.get(planeID);
  assert.deepEqual(
    [...pixels.subarray(0, 16)],
    [67, 33, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 67, 33, 0, 255],
  );
  assert.deepEqual([...bitmapPixels.subarray(16, 24)], [0, 0, 0, 0, 17, 34, 51, 255]);
  assert.deepEqual([...bitmapPixels.subarray(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(new DataView(plane.graph.kx2.buffer).getUint32(MOTION_ABI.color, true), color);
  assert.equal(plane.state.colorOverride, 0x81230005);
  assert.equal(resumed.machine.load(540), 0xffffffff);
  assert.equal(resumed.machine.pop(), title67Sentinel);
  for (let frame = 0; frame < 8; frame++) await next.tick();
  const query = (id) => next.runtime.native('main', 452, [id], resumed.machine, resumed);
  assert.deepEqual(await query(next.nativeTaskID(owner)), { control: 1, value: 17 });
  assert.deepEqual(await query(0x7fffff00), { control: 1, value: 0xffffffff });
});

test('63 FES GCALLs use and publish the real Draw owner before waiting', async (t) => {
  const { world, audio } = await oldTitleWorld(
    {
      'entry.fes': bytes(
        '#DEFINE\nVIEW marker[2]\n#START\n$8=73\nwait 2\n$8=74\nwait frame 4\n$8=75\nwait\n$8=76\n' +
          '#PING\n$10=91\nbreak\n#marker.PING\n$10=92\nbreak\n',
      ),
    },
    undefined,
    'rebellions-jp-engine-2.6.1.63',
  );
  try {
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, machine, main);
    assert.deepEqual(call(209, [64]), { control: 2 });
    const bank = world.runtime.variableBank(main, false);
    machine.writeString('owned FES', 128);
    machine.writeString('entry', 160);
    const created = await call(66, [34, world.nativeTaskID(main.id), 128]);
    assert.equal(created.control, 1);
    const fesID = world.resolveTaskID(created.value, main.id),
      record = world.objects.objects.get(fesID),
      fes = record.implementation;
    assert.equal(record.parent, main.id);
    const drawTask = await call(66, [15, world.nativeTaskID(main.id), 128]),
      drawID = world.resolveTaskID(drawTask.value, main.id),
      draw = world.graphics.drawTasks.get(drawID);
    assert.equal(drawTask.control, 1);
    assert.deepEqual(await call(256, [drawTask.value, 4, 3]), { control: 2 });
    assert.deepEqual(await call(260, [drawTask.value, 0xffffffff, 2]), { control: 2 });
    assert.deepEqual(await call(262, [drawTask.value, 0]), { control: 2 });
    assert.deepEqual(await call(262, [drawTask.value, 9]), { control: 2 });
    assert.deepEqual(draw.state.offset, [-1, 2]);
    assert.deepEqual([draw.state.enabled, draw.state.pending], [9, 1]);
    const output = t.mock.method(world.graphics, 'output');
    assert.deepEqual(await call(342, [drawTask.value]), { control: 2 });
    assert.equal(draw.state.pending, 0);
    assert.deepEqual(
      output.mock.calls.map(({ arguments: [bitmap, offset, area] }) => [
        bitmap.width,
        bitmap.height,
        offset,
        area,
      ]),
      [[4, 3, [-1, 2], null]],
    );
    assert.deepEqual(await call(449, [created.value, drawTask.value]), { control: 2 });
    assert.equal(fes.surface, drawID);
    assert.deepEqual(await call(447, [created.value, 160]), { control: 2 });
    assert.equal(fes.variableBank(), bank);
    assert.equal(world.graphics.fesSurfaces.get(drawID).get(fesID), fes.player);
    assert.deepEqual(await call(645, [created.value, 511, 0x89abcdef]), { control: 2 });
    assert.deepEqual(await call(645, [created.value, 512, 17]), { control: 2 });
    assert.deepEqual(await call(645, [created.value, 0xffffffff, 18]), { control: 2 });
    assert.deepEqual(await call(646, [created.value, 511]), { control: 1, value: 0x89abcdef });
    assert.deepEqual(await call(646, [created.value, 512]), { control: 1, value: 0 });
    assert.deepEqual(await call(646, [created.value, 0xffffffff]), { control: 1, value: 0 });
    assert.equal(fes.player.root.local(511) >>> 0, 0x89abcdef);
    machine.writeString('PING', 192);
    machine.writeString('', 224);
    machine.writeString('marker', 256);
    assert.deepEqual(await call(630, [created.value, 192, 224, 0]), { control: 2 });
    assert.equal(bank.get(10), 91);
    assert.deepEqual(await call(630, [created.value, 192, 256, 1]), { control: 2 });
    assert.equal(bank.get(10), 92);
    assert.equal(bank.get(8), 0);
    assert.deepEqual(await call(448, [created.value]), { control: 2 });
    assert.equal(bank.get(8), 73);
    assert.equal(fes.player.root.commandDelayUntil, fes.player.root.nativeFrameWord + 2);
    await world.tick();
    assert.equal(bank.get(8), 73);
    await world.tick();
    assert.equal(bank.get(8), 74);
    assert.equal(fes.player.root.commandDelayUntil, -2);
    assert.equal(fes.player.root.waitParameters.frameThreshold, 4);
    await world.tick();
    assert.equal(bank.get(8), 74);
    await world.tick();
    assert.equal(bank.get(8), 75);
    assert.equal(fes.player.root.commandDelayUntil, -1);
    await world.tick();
    assert.equal(bank.get(8), 75);
    await world.tick();
    assert.equal(bank.get(8), 76);

    assert.deepEqual(await call(67, [created.value]), { control: 2 });
    assert.equal(record.destroyRequested, true);
    await world.tick();
    assert.equal(world.objects.objects.has(fesID), false);
    assert.equal(world.graphics.fesSurfaces.get(drawID)?.has(fesID) ?? false, false);
    assert.equal(bank.get(8), 76);
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 Script motion manager and matrix initialization use owned resource handles', async () => {
  const { world, audio } = await oldTitleWorld({}, undefined, 'rebellions-jp-engine-2.6.1.63');
  try {
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, machine, main),
      { control, value: handle } = call(294, []),
      { owner, manager } = world.runtime.handles.get(handle, 'motion-manager'),
      expected = Array.from({ length: 16 }, (_, i) => floatBits(i % 5 === 0 ? 1 : 0));
    assert.equal(control, 1);
    assert.equal(owner, main.id);
    assert.equal(manager.speed, 1);
    assert.equal(manager.records.size, 0);
    assert.equal(new DataView(manager.base.buffer).getUint32(MOTION_ABI.color, true), 0xffffffff);
    assert.deepEqual(manager.working, manager.base);
    assert.deepEqual(call(586, [handle, 0x80000001]), { control: 2 });
    assert.equal(manager.flags, 0x80000001);
    assert.deepEqual(call(586, [0, 0]), { control: 2 });
    assert.equal(manager.flags, 0x80000001);
    machine.bytes(128, 72).fill(0xa5);
    assert.deepEqual(call(207, [132]), { control: 2 });
    assert.deepEqual(
      expected.map((_, i) => machine.load(132 + i * 4)),
      expected,
    );
    assert.equal(machine.load(128), 0xa5a5a5a5);
    assert.equal(machine.load(196), 0xa5a5a5a5);
    assert.deepEqual(call(295, [0]), { control: 2 });
    assert.deepEqual(call(295, [handle]), { control: 2 });
    assert.equal(world.runtime.handles.records.has(handle), false);
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 motion state transfers and formatted script add preserve the manager and arguments', async () => {
  const { world, audio } = await oldTitleWorld(
    { 'owned-7.kcs': kcsProgram([[59]]) },
    undefined,
    'rebellions-jp-engine-2.6.1.63',
  );
  try {
    const main = await world.initialize('empty.kcs'),
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main),
      handle = (await call(294, [])).value,
      { manager } = world.runtime.handles.get(handle, 'motion-manager'),
      pointers = [64, 96, 128, 160, 240, 256, 272, 288, 304],
      input = [handle, ...pointers];
    m.store(128, floatBits(4.5));
    input[6] = 0x12345678;
    input[9] = 0x80000001;
    assert.deepEqual(await call(301, input), { control: 2 });
    assert.equal(motionVector(manager.working, MOTION_ABI.pos)[0], 4.5);
    assert.equal(motionVector(manager.base, MOTION_ABI.pos)[0], 0);
    assert.deepEqual(await call(303, [handle]), { control: 2 });
    assert.deepEqual(manager.base, manager.working);
    const outputs = pointers.map((pointer) => pointer + 512);
    assert.deepEqual(await call(300, [handle, ...outputs]), { control: 2 });
    assert.equal(m.load(outputs[2]), floatBits(4.5));
    assert.equal(m.load(outputs[5]), 0x12345678);
    assert.equal(m.load(outputs[8]), 0x80000001);
    m.store(512, 7);
    m.writeString('owned-%d[G512]', 320);
    m.store(352, floatBits(9));
    m.bytes(368, 3).set([1, 2, 3]);
    assert.deepEqual(await call(304, [handle, 0xffffffff, 352, 1, 368, 3, 17]), {
      control: 1,
      value: 0,
    });
    const added = await call(304, [handle, 320, 352, 1, 368, 3, 17]);
    assert.deepEqual(added, { control: 1, value: 1 });
    const { group, instance } = manager.records.get(added.value);
    assert.equal(group, 17);
    assert.equal(instance.script.name, 'owned-7');
    m.store(352, 0);
    m.bytes(368, 3).fill(0);
    assert.equal(instance.view.getUint32(MOTION_ABI.registers, true), floatBits(9));
    assert.deepEqual(
      [...instance.machine.bytes(instance.view.getUint32(MOTION_ABI.extraData, true), 3)],
      [1, 2, 3],
    );
    assert.deepEqual(await call(298, [handle, 17]), { control: 2 });
    assert.equal(manager.records.size, 0);
  } finally {
    await world.close();
    await audio.dispose();
  }
});

test('63 scene setup sets motion speed and prunes the live backlog to its configured limit', async () => {
  const { world, audio } = await oldTitleWorld({}, undefined, 'rebellions-jp-engine-2.6.1.63');
  try {
    const main = await world.initialize('empty.kcs'),
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main),
      motion = (await call(294, [])).value,
      { manager } = world.runtime.handles.get(motion, 'motion-manager');
    assert.deepEqual(await call(308, [motion, floatBits(0.625)]), { control: 2 });
    assert.equal(manager.speed, 0.625);
    assert.deepEqual(await call(308, [0, floatBits(0)]), { control: 2 });
    assert.equal(manager.speed, 0.625);
    const logs = world.displayLogs,
      { value: handle } = await call(696, []),
      model = logs.get(handle);
    m.writeString('owned', 256);
    m.writeString('猫', 288);
    m.writeString('本文', 320);
    for (const block of [3, 4, 5])
      assert.deepEqual(await call(698, [handle, 256, block, 288, 320, 0, 0]), { control: 2 });
    assert.deepEqual(await call(785, [handle, 2]), { control: 2 });
    assert.deepEqual(
      model.blocks.map((block) => block[2]),
      [4, 5],
    );
    assert.equal(model.blockBase, 1);
    assert.deepEqual(await call(700, [handle, 384, 0]), { control: 2 });
    assert.equal(m.string(384), model.config.nameFirst + '猫' + model.config.nameLast);
    assert.deepEqual(await call(785, [handle, -1]), { control: 2 });
    m.writeString('次の文', 320);
    assert.deepEqual(await call(698, [handle, 256, 6, 288, 320, 0, 0]), { control: 2 });
    assert.deepEqual(
      model.blocks.map((block) => block[2]),
      [4, 5, 6],
    );
    assert.deepEqual(await call(876, [handle]), { control: 2 });
    assert.equal(model.rows.length, 0);
    assert.deepEqual(await call(697, [handle]), { control: 2 });
    assert.throws(() => logs.get(handle), /released/);
  } finally {
    await world.close();
    await audio.dispose();
  }
});

test('63 textured Plane coordinate mode belongs to its current render model', async () => {
  const { world, audio } = await oldTitleWorld({}, undefined, 'rebellions-jp-engine-2.6.1.63');
  try {
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, machine, main),
      id = await world.objects.create({ kind: 2, parent: main.id }),
      plane = world.graphics.get(id),
      target = world.nativeTaskID(id),
      width = floatBits(20.5),
      height = floatBits(12.25);
    assert.deepEqual(await call(78, [0, width, height]), { control: 2 });
    assert.deepEqual(await call(466, [target, 1]), { control: 2 });
    assert.equal(plane.state.coordMode, 0);
    assert.deepEqual(await call(78, [target, width, height]), { control: 2 });
    assert.deepEqual(plane.state.shapeWords, [0, 0, 0, width, height, 32, 1, 0xffffffff]);
    assert.deepEqual(plane.state.rect, [0, 0, 20.5, 12.25]);
    assert.equal(plane.graph.vram, true);
    assert.deepEqual(await call(466, [target, 2]), { control: 2 });
    assert.equal(plane.state.coordMode, 2);
    assert.deepEqual(await call(88, [target, floatBits(90)]), { control: 2 });
    assert.deepEqual(await call(85, [target, floatBits(3), floatBits(5), 0]), { control: 2 });
    assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.base), [3, 5, 90]);
    assert.deepEqual(await call(84, [target, ...[6, 7, 8].map(floatBits), 0]), { control: 2 });
    assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.pos), [6, 7, 8]);
    for (let i = 0; i < 16; i++) machine.store(128 + i * 4, floatBits(i));
    assert.deepEqual(await call(344, [target, 128, 1]), { control: 2 });
    assert.deepEqual(
      plane.graph.textureTransform.subarray(MOTION_ABI.matrix, MOTION_ABI.matrix + 64),
      machine.bytes(128, 64),
    );
    assert.deepEqual(await call(93, [target, ...[-5, 10, 15].map(floatBits), 0]), { control: 2 });
    assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.rotation), [-5, 10, 15]);
    assert.deepEqual(await call(101, [target, ...[2, 3, 4].map(floatBits), 1]), { control: 2 });
    assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.scale), [2, 3, 4]);
    assert.deepEqual(motionVector(plane.graph.textureTransform, MOTION_ABI.scale), [1, 1, 1]);
    assert.deepEqual(await call(402, [target, 3]), { control: 2 });
    assert.equal(plane.state.blendMode, 3);
    assert.deepEqual(await call(402, [target, 9]), { control: 2 });
    assert.equal(plane.state.blendMode, 0);
    machine.bytes(208, 16).fill(0xa5);
    assert.deepEqual(await call(345, [0, 208, 212, 216, 220]), { control: 2 });
    assert.deepEqual([...machine.bytes(208, 16)], new Array(16).fill(0xa5));
    assert.deepEqual(await call(345, [target, 208, 212, 216, 220]), { control: 2 });
    assert.deepEqual(
      [208, 212, 216, 220].map((at) => bitsFloat(machine.load(at))),
      [0, 0, 20.5, 12.25],
    );
    assert.deepEqual(await call(343, [target, 224, 228]), { control: 2 });
    assert.deepEqual(
      [224, 228].map((at) => bitsFloat(machine.load(at))),
      [20.5, 12.25],
    );
    assert.deepEqual(await call(78, [target, width, height]), { control: 2 });
    assert.equal(plane.state.coordMode, 0);
    assert.deepEqual(await call(79, [target, width, height, 0xffeeeeee]), { control: 2 });
    assert.deepEqual(await call(466, [target, 1]), { control: 2 });
    assert.equal(plane.state.coordMode, 1);
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 texture allocation retains existing pages and authored optional calls return control 2', async () => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    { world, audio } = await oldTitleWorld({}, undefined, profile);
  try {
    const texture = world.configuration.fields.texture;
    texture.size.set([8, 8]);
    texture.grid.set([2, 2]);
    texture.bppY.set([0, 1]);
    texture.bpp = 32;
    for (const area of texture.areas) area.fill(0xffffffff);
    texture.areas[0].set([0, 0, 1, 1]);
    const main = await world.initialize('empty.kcs'),
      call = (id, args) => world.runtime.native('main', id, args, main.machine, main);
    assert.deepEqual(await call(542, []), { control: 2 });
    const pages = world.graphics.texturePages,
      existing = pages.frame(0);
    existing.rgba[0] = 79;
    assert.equal(pages.pages.has(1), false);
    texture.areas[0].set([0, 0, 2, 2]);
    assert.deepEqual(await call(542, []), { control: 2 });
    assert.equal(pages.frame(0), existing);
    assert.equal(existing.rgba[0], 79);
    assert.equal(pages.pages.get(1).bpp, 32);
    assert.equal(pages.pages.get(2).bpp, 16);
    for (const [id, words] of [
      [543, 3],
      [546, 2],
      [550, 3],
      [652, 3],
    ])
      assert.deepEqual(await call(id, new Array(words).fill(0xffffffff)), { control: 2 });
    assert.equal(nativeABI(profile).tables.main.entries[544].status, 'unknown');
  } finally {
    await world.close();
    await audio.dispose();
  }
});

test('63 preload GCALLs own the loaded archive bytes and age the live queue', async () => {
  const image = hg3(2, 2, new Uint8Array(16).fill(0x65)),
    { world, audio } = await oldTitleWorld(
      { 'preload.hg3': image },
      undefined,
      'rebellions-jp-engine-2.6.1.63',
    );
  try {
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      call = (id, args = []) => world.runtime.native('main', id, args, machine, main),
      cache = world.resourceCache;
    cache.enabled = 1;
    machine.writeString('preload', 128);
    machine.writeString('image', 160);
    assert.deepEqual(await call(434), { control: 2 });
    assert.deepEqual(await call(435, [128, 160, 2]), { control: 2 });
    assert.deepEqual(await call(436), { control: 2 });
    await cache.settle();
    assert.deepEqual(await call(437, [2]), { control: 1, value: 1 });
    assert.equal(cache.entries.length, 1);
    assert.deepEqual(await cache.peek(cache.entries[0].filename), image);
    assert.deepEqual(await call(438), { control: 2 });
    assert.equal(cache.entries[0].lifetime, 1);
    assert.deepEqual(await call(434), { control: 2 });
    assert.equal(cache.entries.length, 0);
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 packed image buffers zero only the mapped metadata record and own the source bytes', async () => {
  const image = hg3(2, 3, new Uint8Array(24).fill(0x7d)),
    { world, audio } = await oldTitleWorld(
      { 'packed.hg3': image, 'unknown.hg3': Uint8Array.of(68, 65, 84, 65) },
      undefined,
      'rebellions-jp-engine-2.6.1.63',
    );
  try {
    const main = await world.initialize('empty.kcs'),
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main),
      buffers = world.runtime.imageDataBuffers;
    m.writeString('packed', 128);
    const { value: handle } = await call(365, [128]),
      pointer = buffers.pointer(handle);
    assert.deepEqual(buffers.data(pointer), image);
    m.bytes(256, 40).fill(0xa5);
    assert.deepEqual(await call(368, [0, 0, 256]), { control: 1, value: 0 });
    assert.deepEqual(m.bytes(256, 40), new Uint8Array(40).fill(0xa5));
    assert.deepEqual(await call(368, [handle, 0, 256]), { control: 1, value: 1 });
    assert.deepEqual(
      [0, 4, 8, 12, 16, 20, 24, 28, 32].map((at) => m.load(256 + at)),
      [0, 0, 2, 3, 2, 3, 4, 0, 0],
    );
    assert.equal(m.load(292), 0xa5a5a5a5);
    m.writeString('unknown', 128);
    const { value: unknown } = await call(365, [128]);
    m.bytes(256, 36).fill(0xa5);
    assert.deepEqual(await call(368, [unknown, 0, 256]), { control: 1, value: 0 });
    assert.deepEqual(m.bytes(256, 36), new Uint8Array(36));
    assert.equal(m.load(292), 0xa5a5a5a5);
    assert.deepEqual(await call(366, [unknown]), { control: 2 });
    assert.deepEqual(await call(366, [handle]), { control: 2 });
    assert.throws(() => buffers.require(pointer), /released/);
  } finally {
    await world.close();
    await audio.dispose();
  }
});

test('63 Flow and warning FES honor the configured Control key only during the skippable wait', async (t) => {
  const packetAddress = 384,
    keyScript = kcsProgram([
      [37, packetAddress],
      [43, 71, 4],
      [39, 0],
      [19, [0x13, packetAddress + 12], 12],
      [39, 0],
      ...title67Call(108, [[0x13, packetAddress + 8], 1]),
      [41, 0],
    ]),
    { world, audio } = await oldTitleWorld(
      {
        'key-owner.kcs': keyScript,
        'flow.fes': bytes(
          '#START\nexecfes warning\nnext POLL\n#POLL\nwait 1\nif ($8==3)\nendfes\nexecfes ready\nnext WAIT\nendif\nnext POLL\n#WAIT\n',
        ),
        'warning.fes': bytes(
          '#START\nkeyskip off\n$8=1\nwait 4\nnext IN\n#IN\nkeyskip on\n$8=2\nwait 200\nnext TAIL\n#TAIL\nkeyskip off\nwait 3\n$8=3\nexit\n',
        ),
        'ready.fes': bytes('#START\n$9=17\nnext WAIT\n#WAIT\n'),
      },
      undefined,
      'rebellions-jp-engine-2.6.1.63',
    );
  t.after(async () => {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  });
  const row = world.configuration.keys.rows[12];
  row.name = 'Skip';
  row.enabled = 1;
  row.keyboard[0] = 17;
  const bindings = new NativeInputBindings(world.input, world.configuration);
  world.inputBindings = bindings;
  const control = { code: 'ControlLeft', key: 'Control', ctrlKey: true };
  assert.ok(bindings.acceptsKeyboard(control));
  assert.equal(world.window.keyboardShortcut(control), null);
  assert.deepEqual(world.window.keyboardShortcut({ code: 'F4', key: 'F4', altKey: true }), [
    0x104,
    115,
    0x20000001,
    { modifiers: 16, character: null },
  ]);
  const step = async () => {
    bindings.sample();
    await world.tick();
  };

  const main = await world.initialize('key-owner.kcs'),
    bank = world.runtime.variableBank(main),
    keyPlane = await world.objects.create({ kind: 6, parent: main.id }),
    planeNativeID = world.nativeTaskID(keyPlane),
    draw = await world.objects.create({ kind: 15, parent: main.id }),
    owner = await world.objects.create({ kind: 34, parent: main.id }),
    flow = world.objects.objects.get(owner).implementation;
  bank.initialize(16);
  assert.deepEqual(
    await world.runtime.native(
      'main',
      104,
      [planeNativeID, 16, 16, 16, 16, 10000, 0],
      main.machine,
      main,
    ),
    { control: 2 },
  );
  const keyPackets = [],
    inputReplies = [],
    dispatchImmediate = world.runtime.scheduler.send,
    sendInput = world.input.send;
  t.mock.method(world.runtime.scheduler, 'send', async function (id, words) {
    const reply = await dispatchImmediate.call(this, id, words);
    if (words[1] === 0xffff0003 || words[1] === 0xffff0004)
      keyPackets.push({ id, words, accepted: reply.accepted });
    return reply;
  });
  t.mock.method(world.input, 'send', async function (region, message, w, l, context) {
    const reply = await sendInput.call(this, region, message, w, l, context);
    if (message === 4 && w === 12) inputReplies.push([region.owner, l, reply.result]);
    return reply;
  });
  await world.sendEngine(draw, main.id, 279, 4, 3);
  await world.sendEngine(draw, main.id, 283, 0, 0);
  await flow.initialize(main.context.variableBank);
  await world.sendEngine(owner, main.id, 334, 0, world.nativeTaskID(draw));
  assert.equal(await flow.loadSource('flow.fes'), true);
  for (let frame = 0; frame < 4 && bank.get(8) === 0; frame++) await step();
  const warningID = flow.player.root.childTaskID,
    warning = world.objects.objects.get(warningID).implementation.player.root,
    warningRegion = world.input
      .ordered()
      .find((region) => region.receiver === world.nativeTaskID(warningID));
  assert.ok(warningRegion);
  assert.equal(bank.get(8), 1);
  assert.equal(warning.label, 'START');
  assert.equal(warning.keySkipEnabled, false);
  bindings.keyboard(control, true);
  await step();
  assert.equal(warning.skipControl, true);
  assert.equal(bank.get(8), 1);
  bindings.keyboard(control, false);
  for (let frame = 0; frame < 5 && bank.get(8) === 1; frame++) await step();
  assert.equal(bank.get(8), 2);
  assert.equal(warning.label, 'IN');
  assert.equal(warning.keySkipEnabled, true);
  assert.equal(warning.skipControl, false);
  assert.ok(warning.commandDelayUntil > warning.nativeFrameWord + 100);
  await step();
  assert.equal(bank.get(8), 2);

  bindings.keyboard(control, true);
  await step();
  assert.equal(warning.label, 'TAIL');
  assert.equal(bank.get(8), 2);
  bindings.keyboard(control, false);
  for (let frame = 0; frame < 8 && bank.get(9) === 0; frame++) await step();
  assert.equal(bank.get(8), 3);
  const ready = world.objects.objects.get(flow.player.root.childTaskID).implementation.player.root;
  assert.equal(bank.get(9), 17);
  assert.equal(ready.label, 'WAIT');
  assert.equal(ready.skipControl, false);
  assert.deepEqual(
    keyPackets.map(({ id, words, accepted }) => [id, ...words, accepted]),
    [0xffff0003, 0xffff0004, 0xffff0003, 0xffff0004].map((edge) => [
      main.id,
      planeNativeID,
      edge,
      planeNativeID,
      12,
      true,
    ]),
  );
  assert.equal(world.runtime.calls.get('main:108'), 4);
  assert.deepEqual(
    inputReplies.filter(([region]) => region === keyPlane),
    [1, 0, 1, 0].map((edge) => [keyPlane, edge, 1]),
  );
  assert.deepEqual(
    inputReplies.filter(([region]) => region === warningRegion.owner),
    [1, 0, 1, 0].map((edge) => [warningRegion.owner, edge, 1]),
  );
  assert.equal(world.graphics.tasks.get(keyPlane).state.changed, 0);
  const inactiveScript = await world.objects.create({ kind: 12, parent: main.id });
  for (const edge of [9, 10])
    assert.deepEqual(
      await world.engineMessages.dispatch(inactiveScript, keyPlane, edge, planeNativeID, 12),
      { routed: true, handled: true, result: 1 },
    );
  await assert.rejects(
    world.engineMessages.dispatch(main.id, keyPlane, 65, planeNativeID, 12),
    /Unreviewed ABI behavior .*\/messages\.scriptBaseOnly/,
  );
});

test('63 startup file GCALLs import bounded flags through the selected Script owner', async (t) => {
  const storage = new SaveSlotFiles(),
    file = new NativeGlobalFile(7, 524288),
    flags = new Uint8Array(512 * 4),
    words = new DataView(flags.buffer);
  for (const [index, value] of [
    [0, 17],
    [1, 29],
    [810 - 512, 1],
    [1023 - 512, 2],
  ])
    words.setUint32(index * 4, value, true);
  file.write(1024, flags);
  const reads = [],
    diagnostics = [],
    read = storage.read;
  await storage.write('owned/owned-flags.css', await file.file());
  t.mock.method(storage, 'read', function (name) {
    reads.push(name);
    return read.call(this, name);
  });
  const { world, audio } = await oldTitleWorld({}, storage, 'rebellions-jp-engine-2.6.1.63');
  world.host.nativeDiagnostic = (event) => diagnostics.push(event);
  try {
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      sender = world.nativeTaskID(main.id),
      call = (id, args) =>
        world.runtime.native('main', id, args, machine, main, world.runtime.scheduler);
    main.context.contextName = 'owned';
    assert.deepEqual(call(209, [2048]), { control: 2 });
    const bank = world.runtime.variableBank(main, false);
    machine.writeString('missing-flags.css', 128);
    machine.writeString('owned-flags.css', 192);

    assert.deepEqual(await call(247, [128]), { control: 1, value: 0 });
    assert.deepEqual(call(250, [0, 1024, sender, 810]), { control: 1, value: 0 });
    assert.equal(bank.get(810), 0);
    assert.equal(bank.dirty, false);

    const loaded = await call(247, [192]);
    assert.equal(loaded.control, 1);
    const handle = loaded.value;
    assert.notEqual(handle, 0, JSON.stringify({ reads, diagnostics }));
    assert.deepEqual(
      reads.filter((name) => name.endsWith('.css')),
      ['owned/missing-flags.css', 'owned/owned-flags.css'],
    );
    assert.deepEqual(diagnostics, []);
    assert.equal(world.runtime.handles.get(handle, 'global-file').growthBytes, 524288);
    assert.deepEqual(call(250, [handle, 1023, sender, 810]), { control: 1, value: 0 });
    assert.equal(bank.dirty, false);
    assert.deepEqual(call(250, [handle, 1024, sender, 2047]), { control: 1, value: 1 });
    assert.equal(bank.get(2047), 17);
    assert.equal(bank.get(2048), 0);
    assert.equal(bank.dirty, true);
    assert.deepEqual(call(250, [handle, 1024, sender, 512]), { control: 1, value: 1 });
    assert.deepEqual([bank.get(810), bank.get(1023)], [1, 2]);

    machine.bytes(0, 8).fill(0xa5);
    assert.deepEqual(call(254, [handle, 1024, 0, 5]), { control: 1, value: 5 });
    assert.deepEqual([...machine.bytes(0, 8)], [...flags.subarray(0, 5), 0xa5, 0xa5, 0xa5]);
    assert.deepEqual(call(254, [handle, 1024, 0xffffffff, 5]), { control: 1, value: 0 });
    assert.deepEqual(call(246, [handle]), { control: 2 });
    assert.equal(world.runtime.handles.records.has(handle), false);
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 startup GCALLs use owned XML, files and Script string storage', async () => {
  const storage = new SaveSlotFiles(),
    { world, audio } = await oldTitleWorld(
      {
        'config.xml': bytes(
          '<?xml version="1.0" encoding="shift_jis"?><document><group><number>73</number><label>検証</label></group></document>',
        ),
      },
      storage,
      'rebellions-jp-engine-2.6.1.63',
    );
  try {
    await storage.write('owned/bytes.bin', Uint8Array.of(0x11, 0x22, 0x33, 0x44, 0x55));
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, machine, main);
    const voidReply = { control: 2 },
      result = (value) => ({ control: 1, value });
    const log = [];
    world.runtime.services.log = (text) => log.push(text);
    for (const [at, text] of [
      [256, 'owned text'],
      [288, 'a b,c'],
      [304, ' ,'],
      [320, 'owned/bytes.bin'],
      [368, 'rb'],
      [384, 'owned.int/config.xml'],
      [432, 'group/number'],
      [480, 'group/label'],
      [528, 'group/missing'],
      [576, 'owned.int/missing.xml'],
    ])
      machine.writeString(text, at);

    assert.deepEqual(call(1, [256]), voidReply);
    assert.deepEqual(log, ['owned text']);
    assert.deepEqual(call(36, [0, 0x15a, 16]), voidReply);
    assert.deepEqual(call(14, [0, 256]), result(0));
    assert.deepEqual([...machine.bytes(0, 14)], [...bytes('owned text'), 0, 0, 0x5a, 0x5a]);
    machine.bytes(64, 8).fill(0xa5);
    assert.deepEqual(call(41, [64, 288, 304]), voidReply);
    assert.deepEqual([...machine.bytes(64, 8)], [97, 0, 98, 0, 99, 0, 0, 0xa5]);
    assert.deepEqual(call(276, [7, 0]), voidReply);
    assert.equal(world.runtime.stringBank(main, false).get(7), 'owned text');
    assert.deepEqual(call(209, [8]), voidReply);
    assert.deepEqual(call(211, [7, 41]), voidReply);
    assert.deepEqual(call(210, [7]), result(41));
    assert.deepEqual(call(210, [8]), result(0));

    const file = (await call(29, [320, 368])).value;
    assert.ok(file);
    machine.bytes(96, 8).fill(0xa5);
    assert.deepEqual(call(30, [96, 2, 2, file]), result(4));
    assert.deepEqual(call(30, [100, 2, 2, file]), result(1));
    assert.deepEqual(call(30, [101, 2, 2, file]), result(0));
    assert.deepEqual(call(30, [101, 1, 4, 0]), result(0));
    assert.deepEqual([...machine.bytes(96, 8)], [0x11, 0x22, 0x33, 0x44, 0x55, 0xa5, 0xa5, 0xa5]);
    assert.deepEqual(await call(32, [file]), voidReply);
    assert.equal(world.runtime.handles.records.has(file), false);

    const xml = (await call(590, [384])).value;
    assert.ok(xml);
    assert.deepEqual(call(592, [xml, 9, 432]), result(73));
    assert.deepEqual(call(592, [xml, 9, 528]), result(9));
    assert.deepEqual(call(592, [0, 9, 0xffffffff]), result(9));
    assert.deepEqual(call(593, [xml, 0, 480]), voidReply);
    assert.equal(machine.string(0), '検証');
    assert.deepEqual(call(593, [xml, 0, 528]), voidReply);
    assert.equal(machine.string(0), '検証');
    assert.deepEqual(call(591, [xml]), voidReply);
    assert.equal(world.runtime.handles.records.has(xml), false);
    assert.deepEqual(await call(590, [576]), result(0));
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 startup database imports owned CSS flag bytes into its loaded records', async () => {
  const store = new SaveSlotFiles(),
    flags = new NativeGlobalFile(0, 524288),
    { world, audio } = await oldTitleWorld(
      { 'entry.kdb': compiledDatabase([{ ID: 1, INDEX: 'owned' }]) },
      store,
      'rebellions-jp-engine-2.6.1.63',
    );
  const persisted = new NativeDatabase();
  persisted.records.set('owned', {
    name: bytes('owned'),
    flags: Uint32Array.of(0x80000001, 0x40000020, 1),
  });
  const raw = persisted.export();
  try {
    flags.write(0x10000001, raw);
    await store.write('owned-flags.css', await flags.file());
    const main = await world.initialize('empty.kcs'),
      machine = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, machine, main),
      memory = world.runtime.imageDataBuffers.process;
    for (const [at, text] of [
      [256, 'owned.int/entry.kdb'],
      [288, '\\n'],
      [320, ''],
      [352, 'owned-flags.css'],
      [384, 'owned.int/missing.kdb'],
    ])
      machine.writeString(text, at);

    const loaded = await call(869, [256, 288, 288, 320]);
    assert.equal(loaded.control, 1);
    const database = world.runtime.handles.get(loaded.value, 'database');
    assert.deepEqual([...database.records.keys()], ['owned']);
    assert.deepEqual([...database.records.get('owned').flags], [0, 0, 0]);
    const file = (await call(247, [352])).value;
    assert.ok(file);
    const pointer = (await call(836, [file, 0x10000001, 64])).value;
    assert.equal(machine.load(64), raw.length);
    assert.deepEqual(await call(873, [loaded.value, 0]), { control: 1, value: 0 });
    await assert.rejects(call(873, [0, pointer]), /NULL-handle import has an unwritten result/);
    assert.deepEqual(memory.read(pointer, raw.length), raw);
    assert.deepEqual(await call(873, [loaded.value, pointer]), { control: 1, value: 1 });
    assert.deepEqual(database.export(), raw);
    assert.equal(database.modified, 0);
    assert.deepEqual(await call(834, [pointer]), { control: 2 });
    assert.deepEqual(call(246, [file]), { control: 2 });
    assert.deepEqual(await call(870, [loaded.value]), { control: 2 });
    assert.equal(world.runtime.handles.records.has(loaded.value), false);

    const missing = (await call(869, [384, 288, 288, 320])).value;
    assert.ok(missing);
    assert.deepEqual(await call(872, [missing, 0]), { control: 1, value: 4 });
    assert.deepEqual(await call(870, [missing]), { control: 2 });
  } finally {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
  }
});

test('63 Script sound GCALLs load, play, stop and release a mounted wave', async () => {
  const { world, audio } = await oldTitleWorld(
    { 'bgm_owned.wav': title67Wave() },
    undefined,
    'rebellions-jp-engine-2.6.1.63',
  );
  try {
    const main = await world.initialize('empty.kcs'),
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main);
    m.writeString('bgm_owned.wav', 256);
    assert.deepEqual(await call(155, [4, 0, 256, 1]), { control: 1, value: 1 });
    assert.equal(world.sound.device[4].loaded, true);
    assert.deepEqual(await call(161, [4, 50]), { control: 2 });
    assert.deepEqual(await call(162, [4]), { control: 1, value: 50 });
    assert.deepEqual(await call(157, [4, 1]), { control: 2 });
    assert.deepEqual(await call(160, [4]), { control: 1, value: 1 });
    assert.deepEqual(await call(159, [4]), { control: 2 });
    assert.deepEqual(await call(160, [4]), { control: 1, value: 0 });
    assert.deepEqual(await call(156, [4]), { control: 2 });
    assert.equal(world.sound.device[4].loaded, false);
  } finally {
    await world.close();
    await audio.dispose();
  }
});

test('63 FES sound loads, plays and closes through its own Sound receiver', async (t) => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    { world, audio } = await oldTitleWorld(
      {
        'bgm_owned.wav': title67Wave(),
        'sounds.fes': bytes(
          '#DEFINE\nSOUND fixed\nSOUND routed\n#OBJECT CHANNEL FILE\nfixed 0 bgm_owned.wav\n#OBJECT GROUP FILE\nrouted bgm bgm_owned.wav\n#START\nfixed play 1\nrouted play 1\nnext READY\n#READY\n',
        ),
      },
      undefined,
      profile,
    );
  t.after(async () => {
    try {
      await world.close();
    } finally {
      await audio.dispose();
    }
    assert.equal(audio.channels.size, 0);
  });
  world.configuration.soundGroups[0] = { id: 0, type: 'bgm', min: 2, max: 3 };
  const main = await world.initialize('empty.kcs');
  world.runtime.variableBank(main).initialize(64);
  const draw = await world.objects.create({ kind: 15, parent: main.id });
  await world.sendEngine(draw, main.id, 279, 4, 3);
  await world.sendEngine(draw, main.id, 283, 0, 0);
  const id = await world.objects.create({ kind: 34, parent: main.id }),
    task = world.objects.objects.get(id).implementation;
  await task.initialize(main.context.variableBank);
  await world.sendEngine(id, main.id, 334, 0, world.nativeTaskID(draw));
  const packets = [],
    send = world.sendNativeEngine;
  t.mock.method(world, 'sendNativeEngine', async function (target, sender, message, w, l, context) {
    const payload = context?.payload;
    const packet =
      message === 173 || message === 199
        ? {
            size: payload.data.length,
            words: [0, 4, 8, 268, 272, 276].map((offset) => payload.load(offset)),
          }
        : null;
    const result = await send.call(this, target, sender, message, w, l, context);
    if (target === task.player?.nativeSoundTaskID)
      packets.push({ sender, message, w, l, packet, result });
    return result;
  });

  assert.equal(await task.loadSource('sounds.fes'), true);
  for (let frame = 1; frame <= 4; frame++) await world.tick(frame);
  const nativeSound = world.sound.primary(main.id);
  assert.equal(world.sound.bankCount, 32);
  assert.ok(packets.every((packet) => packet.sender === id));
  assert.deepEqual(packets.find((packet) => packet.message === 173).packet, {
    size: 280,
    words: [0, 0, 0, 0, 1, 0],
  });
  assert.deepEqual(packets.find((packet) => packet.message === 199).packet, {
    size: 280,
    words: [0xffffffff, 0, 0, 0, 1, 0],
  });
  assert.equal(packets.find((packet) => packet.message === 203).result, 0);
  assert.equal(packets.find((packet) => packet.message === 199).result, 2);
  assert.deepEqual(
    packets.filter((packet) => packet.message === 176).map(({ w, l }) => [w, l]),
    [
      [0, 1],
      [2, 1],
    ],
  );
  assert.deepEqual(
    packets.filter((packet) => packet.message === 194).map(({ w, result }) => [w, result]),
    [
      [0, 120],
      [2, 120],
    ],
  );
  assert.ok(world.sound.playing(0));
  assert.ok(world.sound.playing(2));
  await assert.rejects(
    nativeSound.message([main.nativeID, 184, 0, 0]),
    /Unreviewed ABI message .*\/sound\/canonical\/184/,
  );
  await world.sendEngine(id, main.id, 3, 0, 0);
  assert.deepEqual(
    packets.filter((packet) => packet.message === 204).map(({ w }) => w),
    [0, 2],
  );
  await world.tick(5);
  assert.equal(world.objects.objects.has(id), false);
});

test('63 title Particle FES runs selected native calls and restores its own bank', async (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 17, 3, 4, 5));
  const profile = 'rebellions-jp-engine-2.6.1.63',
    code = kcsProgram([
      ...title67Call(1, [], 512),
      ...title67Call(2, [], 516),
      ...title67Call(5, [520, 524]),
      ...title67Call(19, [floatBits(90)], 528),
      ...title67Call(6, [[0x13, 528]], 532),
      ...title67Call(35, [640]),
      ...title67Call(27, [floatBits(4), floatBits(-2), floatBits(3)]),
      ...title67Call(28, [536, 540, 544]),
      ...title67Call(30, [800]),
      ...title67Call(25, [800, floatBits(5), floatBits(6), floatBits(7)]),
      ...title67Call(26, [800, floatBits(2), floatBits(2), floatBits(2)]),
      ...title67Call(31, [800]),
      ...title67Call(34, [], 548),
      ...title67Call(36, [], 552),
      ...title67Call(50, [2]),
      [59],
    ]),
    files = {
      'specks.kcs': code,
      'particle.fes': bytes(
        '#DEFINE\nPARTICLE specks\n#START\nspecks init 0 specks no_texture 2 7\nspecks param 12 -3\nspecks start\nnext WAIT\n#WAIT\n',
      ),
    };
  new DataView(code.buffer).setUint16(8, 2, true);
  const source = await oldTitleWorld(files, undefined, profile);
  let restored;
  t.after(async () => {
    for (const owner of [restored, source]) {
      if (!owner) continue;
      try {
        await owner.world.close();
        assert.equal(owner.world.particles.host.banks.size, 0);
      } finally {
        await owner.audio.dispose();
      }
    }
  });

  const { world } = source,
    main = await world.initialize('empty.kcs');
  world.runtime.variableBank(main).initialize(16);
  const draw = await world.objects.create({ kind: 15, parent: main.id });
  await world.sendEngine(draw, main.id, 279, 4, 3);
  await world.sendEngine(draw, main.id, 283, 0, 0);
  const owner = await world.objects.create({ kind: 34, parent: main.id }),
    fes = world.objects.objects.get(owner).implementation;
  await fes.initialize(main.context.variableBank);
  await world.sendEngine(owner, main.id, 334, 0, world.nativeTaskID(draw));
  assert.equal(await fes.loadSource('particle.fes'), true);
  for (let step = 0; step < 4; step++) await world.tick();

  const object = fes.player.root.objects.find((value) => value.nativeType === 23),
    taskID = object.particleResource.taskID,
    task = world.particles.get(taskID),
    instance = task.bank.instance;
  assert.equal(task.record.parent, owner);
  assert.equal(task.bank.started, true);
  assert.equal(instance.blendMode, 2);
  assert.deepEqual([...instance.registers.subarray(0, 4)], [12, -3, 0, 0]);
  assert.deepEqual(
    [520, 524].map((address) => instance.machine.load(address)),
    [instance.screenWidth, instance.screenHeight],
  );
  assert.equal(bitsFloat(instance.machine.load(532)), 1);
  assert.equal(instance.machine.load(552), 1);
  assert.deepEqual(
    [536, 540, 544].map((address) => bitsFloat(instance.machine.load(address))),
    [4, -2, 3],
  );
  assert.deepEqual(
    [...instance.calls.keys()].sort((a, b) => a - b),
    [1, 2, 5, 6, 19, 25, 26, 27, 28, 30, 31, 34, 35, 36, 50],
  );
  assert.throws(
    () => instance.native(33, [], instance.machine),
    /Unreviewed PTCL native .*particle-v2\/33/,
  );
  assert.throws(
    () => instance.native(5, [520], instance.machine),
    /GetScreenSize requires 2 arguments/,
  );
  assert.equal(instance.calls.has(33), false);

  const snapshot = world.snapshot(0);
  restored = await oldTitleWorld(files, undefined, profile);
  await restored.world.restore(structuredClone(snapshot));
  assert.equal(await checkpointDifference(restored.world.snapshot(0), snapshot), null);
  const copy = restored.world.particles.get(taskID).bank.instance;
  assert.throws(() => copy.native(33, [], copy.machine), /Unreviewed PTCL native/);
  await world.close();
  assert.equal(restored.world.particles.get(taskID).active, true);
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
    source = await oldTitleWorld(files),
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
    fresh = await oldTitleWorld(files);
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

test('63 warning and title motions run the selected round, linear and clear contracts', async () => {
  const interpolation = [0, 255, 0, 30].map(floatBits),
    script = await readKCS(
      kcsProgram([
        [37, title67Sentinel],
        ...title67Call(17, [floatBits(-1.5)], 512),
        ...title67Call(41, [...interpolation, floatBits(-1)], 516),
        ...title67Call(41, [...interpolation, floatBits(15)], 520),
        ...title67Call(41, [...interpolation, floatBits(31)], 524),
        ...title67Call(38, []),
        [59],
      ]),
    ),
    motion = new MotionInstance(script, { profile: 'rebellions-jp-engine-2.6.1.63' }),
    initialSP = motion.machine.sp;
  assert.throws(() => motion.native(42, [], motion.machine), /Unrecovered MOT native .*:2a/);
  assert.equal(motion.update(3).active, false);
  assert.equal(motion.machine.load(512) | 0, -1);
  assert.deepEqual(
    [516, 520, 524].map((at) => bitsFloat(motion.machine.load(at))),
    [0, 127.5, 255],
  );
  assert.deepEqual(
    [...motion.calls],
    [
      [17, 1],
      [41, 3],
      [38, 1],
    ],
  );
  assert.equal(motion.machine.pop(), title67Sentinel);
  assert.equal(motion.machine.sp, initialSP);
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

const oldCloseProgram = (body, strings = [], dataSize = 16384) => {
  const program = kcsProgram(body, strings);
  new DataView(program.buffer, program.byteOffset, program.byteLength).setUint32(
    32,
    dataSize,
    true,
  );
  return program;
};
async function oldCloseCaller(world, name) {
  const id = await world.objects.create({
      kind: 12,
      parent: world.main.id,
      name: 'owned close caller',
    }),
    implementation = world.objects.objects.get(id).implementation;
  await implementation.loadScript(name);
  return implementation.task;
}

async function verifyClosePersistence(t, profile) {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 17, 3, 4, 5));
  const prefix = [
      ...title67Call(238, [0x81234567], 512),
      ...title67Call(244, [[0x13, 512], 16384, 4, 0], 516),
      ...title67Call(833, [300], 536),
    ],
    waitPC = (await readKCS(kcsProgram(prefix))).codeSize,
    program = oldCloseProgram(
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
    source = await oldTitleWorld(owned, files, profile);
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
    const task = await oldCloseCaller(source.world, 'close-owned.kcs'),
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
    if (profile === 'rebellions-jp-engine-2.6.1.63') {
      const call = (id, args) => source.world.runtime.native('main', id, args, machine, task);
      const { value: copyHandle } = await call(390, [fileHandle]);
      const owner = source.world.runtime.handles.get(fileHandle, 'global-file'),
        copy = source.world.runtime.handles.get(copyHandle, 'global-file');
      assert.deepEqual(copy.snapshot(), owner.snapshot());
      copy.write(42, Uint8Array.of(7));
      assert.equal(owner.read(42), null);
      assert.deepEqual(await call(246, [copyHandle]), { control: 2 });
      assert.deepEqual(await call(390, [0]), { control: 1, value: 0 });
      machine.store(64, 0xa5a5a5a5);
      assert.deepEqual(await call(836, [fileHandle, 15, 64]), { control: 1, value: 0 });
      assert.equal(machine.load(64), 0xa5a5a5a5);
      const data = await call(836, [fileHandle, 16384, 64]);
      assert.equal(data.control, 1);
      assert.equal(machine.load(64), 4);
      assert.deepEqual([...memory.read(data.value, 4)], [0xfe, 0xca, 0, 0x81]);
      assert.equal(memory.load(data.value - 4), 1);
      assert.deepEqual(await call(834, [data.value]), { control: 2 });
      assert.equal(memory.allocations.has(data.value - 4), false);
    }
    const state = source.world.snapshot(0);
    fresh = await oldTitleWorld(owned, files, profile);
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
}

async function verifyCloseBoundaries(profile, emptyStringResult) {
  const program = oldCloseProgram(
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
    nullProgram = oldCloseProgram([...title67Call(872, [0, 0], 64), [59]]),
    source = await oldTitleWorld(
      { 'limits.kcs': program, 'null-export.kcs': nullProgram },
      undefined,
      profile,
    );
  try {
    const world = source.world;
    await world.initialize('empty.kcs');
    const task = await oldCloseCaller(world, 'limits.kcs'),
      machine = task.machine,
      initialSP = machine.sp;
    world.runtime.stringBank(task).set(8, '');
    machine.bytes(64, 8).fill(0xa5);
    machine.bytes(96, 8).fill(0xa5);
    machine.bytes(1024, 0x80001).fill(0x5a);
    await world.runtime.scheduler.execute(task);
    assert.deepEqual(
      [machine.load(512), machine.load(516), machine.load(524)],
      [emptyStringResult, 0, 1],
    );
    assert.deepEqual([...machine.bytes(64, 3)], [0, 0xa5, 0xa5]);
    assert.deepEqual([...machine.bytes(96, 3)], [0, 0xa5, 0xa5]);
    const file = world.runtime.handles.get(machine.load(520), 'global-file');
    assert.equal(file.capacity, 0x100000);
    assert.equal(file.used, 0x80009);
    assert.equal(file.read(1).length, 0x80001);
    assert.equal(machine.pop(), title67Sentinel);
    assert.equal(machine.sp, initialSP);
    const empty = await oldCloseCaller(world, 'null-export.kcs');
    empty.machine.store(64, 0xa5a5a5a5);
    const before = world.runtime.handles.snapshot();
    await assert.rejects(() => world.runtime.scheduler.execute(empty), /unwritten|uninitialized/);
    assert.equal(empty.machine.load(64), 0xa5a5a5a5);
    assert.deepEqual(world.runtime.handles.snapshot(), before);
    for (const id of [239, 856, 871])
      assert.equal(nativeABI(profile).tables.main.entries[id].status, 'unknown');
    if (profile === title67Profile)
      for (const id of [385, 836, 869, 873])
        assert.equal(nativeABI(profile).tables.main.entries[id].status, 'unknown');
  } finally {
    await source.world.close();
    await source.audio.dispose();
  }
}

for (const [version, profile] of versions) {
  test(`${version} close GCALLs persist real banks and raw database bytes through a cold owner`, (t) =>
    verifyClosePersistence(t, profile));
  test(`${version} close preserves string results, growth and the NULL database boundary`, () =>
    verifyCloseBoundaries(profile, version === '2.6.1.63' ? 1 : 0));
}
