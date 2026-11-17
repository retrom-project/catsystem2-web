// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { OriginalNativeWindow } from '../oracle/window-original.mjs';
import assert from 'node:assert/strict';
import { KIFArchive, BlobFile } from '../src/files.mjs';
import { kif } from './helpers.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { nativeStartupSeed } from '../src/native/startup-author.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
  saveStartupPreferences,
  startupXML,
  startupVersionImage,
} from './fixtures/ordinary-startup.mjs';

for (const profile of startupProfiles) {
  test(`ordinary CatSystem2.initialize creates actual JS application tasks and first tick: ${profile}`, async (t) => {
    const environment = startupEnvironment();
    let player,
      opens = 0;
    try {
      t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 13, 2, 3, 4, 567));
      const game = await ordinaryStartupGame(profile);
      await saveStartupPreferences(game, {
        'setup.xml': startupXML(
          profile,
          '<WINDOW><width>80</width><height>60</height></WINDOW><VOICE><vol_master>60</vol_master><vol_bgm>50</vol_bgm></VOICE><EFFECT><auto_cd>1</auto_cd><auto_cds>3</auto_cds></EFFECT>',
        ),
        'sound.xml': startupXML(profile, '<MASTER><volume>33</volume></MASTER>'),
      });
      player = new CatSystem2({
        game,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        nativeProfile: profile,
        randomSeed: 123,
        uiLanguage: 0x409,
        transitionalExe: {
          open() {
            opens++;
            throw new Error('unexpected original process');
          },
        },
      });
      await player.initialize();
      const world = player.world;
      assert.equal(opens, 0);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(world.nativeEngineLoading, undefined);
      assert.equal(player.mode, 'running');
      assert.equal(world.frame, 1);
      assert.equal(world.runtime.variableBank(world.main, false).get(7), 0x12345678);
      assert.deepEqual(
        [...world.objects.objects.values()].map((record) => record.kind),
        [1, 11, 13, 12],
      );
      assert.equal(player.nativeConfiguration, world.configuration);
      assert.equal(player.nativeSoundConfiguration, world.soundConfiguration);
      assert.equal(world.configuration.screen.currentWidth, 80);
      assert.equal(world.graphics.view.clientWidth, 80);
      assert.equal(world.graphics.view.virtualWidth, 128);
      assert.deepEqual(world.graphics.view.drawingRectangle, [0, 0, 80, 60]);
      assert.equal(new DataView(world.configuration.blocks[0].buffer).getUint32(0, true), 30);
      assert.equal(world.soundConfiguration.loaded, true);
      assert.equal(world.soundConfiguration.master.defaults.volume, 70);
      assert.equal(world.soundConfiguration.master.current.volume, 33);
      assert.equal(world.soundConfiguration.parts[0].head, 'bgm');
      assert.equal(world.soundConfiguration.dirty, false);
      const expectedSeed =
        nativeABI(profile).startup.resourceCheck === 'before-defaults'
          ? 123
          : nativeStartupSeed({ utcNow: Date.now });
      assert.deepEqual(world.random.snapshot(), new ParticleRandom(expectedSeed).snapshot());
      assert.equal(
        document.title,
        profile.startsWith('sdk-') ? 'Authored SDK title' : 'Authored game title',
      );
      assert.equal(world.inputBindings, player.inputBindings);
      assert.equal(world.input.cursorAutoHide, 1);
      assert.equal(world.input.cursorHideFrames, 180);
      const inputTask = [...world.objects.objects.values()].find((record) => record.kind === 11);
      assert.equal(inputTask.implementation.inputState, world.input);
    } finally {
      await player?.dispose();
      environment.restore();
    }
  });
}

function startupPlayer(game, profile, options = {}) {
  return new CatSystem2({
    game,
    nativeProfile: profile,
    canvas: new StartupCanvas(),
    audioContext: { currentTime: 0, close: async () => {} },
    randomSeed: 77,
    uiLanguage: 0x409,
    ...options,
  });
}

for (const profile of startupProfiles) {
  for (const invalid of [false, true]) {
    test(`startup recomputes volumes and the same view with ${invalid ? 'invalid' : 'missing'} setup: ${profile}`, async (t) => {
      const environment = startupEnvironment();
      let player;
      try {
        const game = await ordinaryStartupGame(profile, { sound: false });
        if (invalid)
          await saveStartupPreferences(game, { 'setup.xml': new TextEncoder().encode('<broken>') });
        let derivations = 0;
        const original = NativeConfiguration.prototype.deriveVolumes;
        t.mock.method(NativeConfiguration.prototype, 'deriveVolumes', function () {
          derivations++;
          return original.call(this);
        });
        player = startupPlayer(game, profile);
        await player.initialize();
        assert.equal(derivations, 2);
        assert.equal(player.world.graphics.view.clientWidth, 64);
        assert.equal(player.world.graphics.view.virtualWidth, 128);
        assert.equal(
          new DataView(player.nativeConfiguration.blocks[0].buffer).getUint32(0, true),
          40,
        );
        assert.equal(player.nativeSoundConfiguration.master, null);
        assert.equal(player.nativeSoundConfiguration.loaded, false);
        assert.deepEqual(
          player.nativeDiagnostics ?? [],
          invalid ? [{ type: 'preferences-invalid', file: 'setup.xml' }] : [],
        );
      } finally {
        await player?.dispose();
        environment.restore();
      }
    });
  }

  for (const resource of ['missing', 'invalid', 'invalid-preferences']) {
    test(`sound startup keeps ${resource} resource/preferences semantics: ${profile}`, async () => {
      const environment = startupEnvironment();
      let player;
      try {
        const files =
          resource === 'missing'
            ? { 'sound.xml': undefined }
            : resource === 'invalid'
              ? { 'sound.xml': new TextEncoder().encode('<broken>') }
              : {};
        // An omitted mount is different from an empty or malformed opened file.
        const game = await ordinaryStartupGame(profile, { files });
        await saveStartupPreferences(game, {
          'sound.xml':
            resource === 'invalid-preferences'
              ? new TextEncoder().encode('<broken>')
              : startupXML(profile, '<MASTER><volume>9</volume></MASTER>'),
        });
        player = startupPlayer(game, profile);
        if (resource === 'invalid')
          await assert.rejects(player.initialize(), /soundconf fields were not initialized/);
        else await player.initialize();
        const sound = player.nativeSoundConfiguration;
        assert.equal(sound.loaded, resource !== 'missing');
        if (resource === 'invalid-preferences') {
          assert.equal(sound.master.current.volume, 70);
          assert.deepEqual(player.nativeDiagnostics, [
            { type: 'preferences-invalid', file: 'sound.xml' },
          ]);
        } else {
          assert.equal(sound.master, null);
          assert.deepEqual(
            player.nativeDiagnostics ?? [],
            resource === 'invalid'
              ? [{ type: 'sound-configuration-invalid', file: 'sound.xml' }]
              : [],
          );
          assert.throws(() => sound.requireTree(), /not initialized/);
        }
      } finally {
        await player?.dispose();
        environment.restore();
      }
    });
  }

  for (const explicit of [false, true]) {
    test(`fresh startup samples constructor/author clocks and applies ${explicit ? 'explicit input at its ABI position' : 'seven local fields'} MT seed: ${profile}`, async (t) => {
      const environment = startupEnvironment();
      let player;
      try {
        const now = Date.UTC(2026, 10, 13, 2, 3, 4, 567),
          date = new Date(now),
          expected =
            explicit && nativeABI(profile).startup.resourceCheck === 'before-defaults'
              ? 77
              : date.getFullYear() +
                date.getMonth() +
                1 +
                date.getDate() +
                date.getHours() +
                date.getMinutes() +
                date.getSeconds() +
                date.getMilliseconds();
        t.mock.method(Date, 'now', () => now);
        let clockSamples = 0;
        const original = NativeSystemClock.prototype.utcNow;
        t.mock.method(NativeSystemClock.prototype, 'utcNow', function () {
          clockSamples++;
          return original.call(this);
        });
        player = startupPlayer(await ordinaryStartupGame(profile), profile, {
          randomSeed: explicit ? 77 : undefined,
        });
        await player.initialize();
        assert.equal(clockSamples, 2);
        assert.deepEqual(player.random.snapshot(), new ParticleRandom(expected).snapshot());
        assert.deepEqual(player.world.effekseer.threads.snapshot().threads, [
          { id: 'frame', state: 1, calls: 0, seedCalls: 0 },
        ]);
      } finally {
        await player?.dispose();
        environment.restore();
      }
    });
  }

  test(`fresh ordinary checkpoint restore preserves current owners without mutable startup replay: ${profile}`, async (t) => {
    const environment = startupEnvironment();
    let player, restored;
    try {
      const game = await ordinaryStartupGame(profile);
      await saveStartupPreferences(game, {
        'setup.xml': startupXML(profile, '<WINDOW><width>90</width><height>70</height></WINDOW>'),
        'sound.xml': startupXML(profile, '<MASTER><volume>31</volume></MASTER>'),
      });
      player = startupPlayer(game, profile);
      await player.initialize();
      player.random.rand();
      player.random.rand();
      player.random.frand();
      player.world.dispatchContext.run(player.world.effekseer.frameExecutor, (entry) => {
        player.world.effekseer.nextInt(entry);
        player.world.effekseer.nextInt(entry);
      });
      // W3 requires a real full producer before checkpointing the primary target.
      // This upload neither ticks World nor samples either random registry.
      const gpu = player.world.stageRenderer.gpu,
        { width, height } = gpu.primaryTarget;
      gpu.uploadRenderTarget(gpu.primaryTarget, {
        width,
        height,
        rgba: new Uint8Array(width * height * 4).fill(0x55),
      });
      const snapshot = await player.snapshot();
      await saveStartupPreferences(game, {
        'setup.xml': startupXML(profile, '<WINDOW><width>111</width><height>77</height></WINDOW>'),
        'sound.xml': startupXML(profile, '<MASTER><volume>99</volume></MASTER>'),
      });
      const reads = [],
        original = NativeFileStorage.prototype.readSaved;
      t.mock.method(NativeFileStorage.prototype, 'readSaved', function (name) {
        reads.push(name);
        return original.call(this, name);
      });
      let clockSamples = 0;
      const originalClock = NativeSystemClock.prototype.utcNow;
      t.mock.method(NativeSystemClock.prototype, 'utcNow', function () {
        clockSamples++;
        return originalClock.call(this);
      });
      let opens = 0;
      restored = startupPlayer(game, profile, {
        randomSeed: undefined,
        transitionalExe: {
          open() {
            opens++;
            throw new Error('unexpected original restore');
          },
        },
      });
      await restored.initialize({ checkpoint: snapshot });
      assert.equal(opens, 0);
      assert.deepEqual(reads, []);
      assert.equal(clockSamples, 0);
      assert.equal(restored.world.frame, 1);
      assert.deepEqual(restored.random.snapshot(), snapshot.world.random);
      assert.deepEqual(restored.world.effekseer.snapshot(), snapshot.world.effekseer);
      assert.equal(restored.nativeConfiguration.screen.currentWidth, 90);
      assert.equal(restored.world.graphics.view.clientWidth, 90);
      assert.equal(restored.nativeSoundConfiguration.master.current.volume, 31);
      assert.equal(
        restored.world.runtime.variableBank(restored.world.main, false).get(7),
        0x12345678,
      );
      assert.deepEqual(
        [...restored.world.objects.objects.values()].map((record) => record.kind),
        [1, 11, 13, 12],
      );
    } finally {
      await restored?.dispose();
      await player?.dispose();
      environment.restore();
    }
  });

  test(`ordinary ABI selection accepts authored version-only resources without opening PE: ${profile}`, async () => {
    const environment = startupEnvironment();
    let player;
    try {
      const game = await ordinaryStartupGame(profile, {
        files: { 'authored.exe': startupVersionImage(nativeABI(profile).engineVersion) },
      });
      player = startupPlayer(game, undefined, {
        transitionalExe: {
          open() {
            throw new Error('unexpected PE execution');
          },
        },
      });
      await player.initialize();
      assert.equal(player.nativeProfile, profile);
      assert.equal(player.world.frame, 1);
      assert.equal(player.world.runtime.variableBank(player.world.main, false).get(7), 0x12345678);
    } finally {
      await player?.dispose();
      environment.restore();
    }
  });

  test(`mismatched V_CODE fails before root/first tick or PE execution: ${profile}`, async () => {
    const environment = startupEnvironment();
    let player,
      opens = 0;
    try {
      const game = await ordinaryStartupGame(profile, {
        files: {
          'startup.xml': startupXML(profile, '<APP><v_code>mismatch</v_code></APP>'),
          'authored.exe': startupVersionImage(nativeABI(profile).engineVersion, [
            { type: 'V_CODE', name: 'DATA', bytes: new Uint8Array([1, 2, 3, 4]) },
          ]),
        },
      });
      player = startupPlayer(game, undefined, {
        transitionalExe: {
          open() {
            opens++;
            throw new Error('unexpected original');
          },
        },
      });
      await assert.rejects(player.initialize(), /does not match startup v_code/);
      assert.equal(opens, 0);
      assert.equal(player.world.root, undefined);
      assert.equal(player.world.frame, 0);
    } finally {
      await player?.dispose();
      environment.restore();
    }
  });

  test(`optional KEY_CODE/V_CODE2 alone have no fabricated private Settings consumer: ${profile}`, async () => {
    const environment = startupEnvironment();
    let player;
    try {
      const game = await ordinaryStartupGame(profile, {
        files: {
          'authored.exe': startupVersionImage(nativeABI(profile).engineVersion, [
            { type: 'KEY_CODE', name: 'KEY', bytes: new Uint8Array([1, 2]) },
            { type: 'V_CODE2', name: 'DATA', bytes: new Uint8Array([3, 4]) },
          ]),
        },
      });
      player = startupPlayer(game, undefined);
      await player.initialize();
      assert.equal(player.world.frame, 1);
      assert.equal(player.world.nativeEngine, undefined);
    } finally {
      await player?.dispose();
      environment.restore();
    }
  });
}

test('startup resource lookup bounds named directories and matches the exact required resource', async () => {
  const { findNativeStartupResource } = await import('../src/native/startup-resources.mjs');
  const version = '2.6.1.76',
    plain = startupVersionImage(version),
    wrong = startupVersionImage(version, [
      { type: 'V_CODE', name: 'OTHER', bytes: new Uint8Array([7]) },
    ]),
    required = startupVersionImage(version, [
      { type: 'V_CODE', name: 'DATA', bytes: new Uint8Array() },
    ]);
  assert.equal(findNativeStartupResource(plain, 'V_CODE', 'DATA'), null);
  assert.equal(findNativeStartupResource(wrong, 'V_CODE', 'DATA'), null);
  assert.equal(findNativeStartupResource(required, 'V_CODE', 'DATA').size, 0);
  const malformed = required.slice();
  new DataView(malformed.buffer).setUint32(268, 16, true);
  assert.throws(
    () => findNativeStartupResource(malformed, 'V_CODE', 'DATA'),
    /Invalid PE startup resource offset/,
  );
});

test('encrypted KIF still has its separate prepared/decrypted input diagnostic', async () => {
  const bytes = kif([['__key__.dat', new Uint8Array([1, 2, 3, 4])]]);
  await assert.rejects(
    KIFArchive.open(new BlobFile(new Blob([bytes])), 'encrypted.int'),
    /encrypted KIF; use a prepared\/decrypted game directory/,
  );
});

async function normalWindowEvent(world) {
  const implementation = world.objects.objects.get(world.main.id).implementation,
    original = implementation.message,
    received = [];
  implementation.message = function (words, context, output) {
    if (words[1] === 158) received.push({ words: [...words], flags: context.flags });
    return original.call(this, words, context, output);
  };
  try {
    await world.window.sendEvent(158, 0, 1);
  } finally {
    implementation.message = original;
  }
  assert.deepEqual(received, [{ words: [0, 158, 0, 1], flags: 0 }]);
  assert.equal(world.input.idleFrames, 0);
}

test('ordinary startup routes normal window events and retains unknown ABI boundaries', async () => {
  const environment = startupEnvironment();
  let player;
  try {
    const game = await ordinaryStartupGame(startupProfiles[1]);
    const unknown = startupPlayer(game, 'unregistered');
    await assert.rejects(unknown.initialize(), /Unregistered.*ABI/);
    await unknown.dispose();
    player = startupPlayer(game, startupProfiles[1]);
    await player.initialize();
    await normalWindowEvent(player.world);
    assert.equal(player.world.nativeEngine, undefined);
    assert.equal(player.world.nativeEngineLoading, undefined);
    assert.deepEqual(player.world.effekseer.threads.snapshot().threads, [
      { id: 'frame', state: 1, calls: 0, seedCalls: 0 },
    ]);
  } finally {
    await player?.dispose();
    environment.restore();
  }
});

for (const profile of startupProfiles)
  test(`adapter-only startup routes window events but rejects a partial original owner: ${profile}`, async () => {
    const environment = startupEnvironment();
    let player,
      opens = 0;
    try {
      player = startupPlayer(await ordinaryStartupGame(profile), profile, {
        transitionalExe: {
          open() {
            opens++;
            throw new Error('partial original startup must not begin');
          },
        },
      });
      await player.initialize();
      player.random.rand();
      player.random.frand();
      player.world.dispatchContext.run(player.world.effekseer.frameExecutor, (entry) => {
        player.world.effekseer.nextInt(entry);
      });
      const random = player.random.snapshot(),
        crt = player.world.effekseer.snapshot();
      await normalWindowEvent(player.world);
      const loading = Object.getOwnPropertyDescriptor(player.world, 'nativeEngineLoading');
      // An explicit in-flight original owner is a separate failure boundary.
      // It must reject before trying to open or await a partial process.
      player.world.nativeEngineLoading = new Promise(() => {});
      try {
        await assert.rejects(
          OriginalNativeWindow.prototype.sendEvent.call(player.world.window, 158, 0, 1),
          /window-events requires initialized original application, Settings and random owners/,
        );
      } finally {
        if (loading) Object.defineProperty(player.world, 'nativeEngineLoading', loading);
        else delete player.world.nativeEngineLoading;
      }
      assert.equal(opens, 0);
      assert.equal(player.world.nativeEngine, undefined);
      assert.equal(player.world.nativeEngineLoading, undefined);
      assert.deepEqual(player.random.snapshot(), random);
      assert.deepEqual(player.world.effekseer.snapshot(), crt);
    } finally {
      await player?.dispose();
      environment.restore();
    }
  });

for (const profile of startupProfiles)
  for (const scenario of ['missing', 'malformed', 'valid', 'saved-throws', 'resource-throws'])
    test(`ordinary startup sound I/O gate ${scenario}: ${profile}`, async (t) => {
      const { GameFiles } = await import('../src/files.mjs'),
        { NativeSoundConfiguration } = await import('../src/native/sound-config.mjs'),
        environment = startupEnvironment(),
        events = [],
        savedStates = [],
        savedFailure = new Error('authored saved sound read failed'),
        resourceFailure = new Error('authored mounted sound read failed');
      let player,
        opens = 0;
      try {
        const files =
            scenario === 'missing'
              ? { 'sound.xml': undefined }
              : scenario === 'malformed'
                ? { 'sound.xml': new TextEncoder().encode('<broken>') }
                : {},
          game = await ordinaryStartupGame(profile, { files });
        await saveStartupPreferences(game, {
          'sound.xml': startupXML(profile, '<MASTER><volume>33</volume></MASTER>'),
        });
        const originalResolve = GameFiles.prototype.resolveCategory,
          originalRead = GameFiles.prototype.readNative,
          originalSaved = NativeFileStorage.prototype.readSaved,
          originalLoad = NativeSoundConfiguration.prototype.load,
          originalApply = NativeSoundConfiguration.prototype.applyPreferences;
        t.mock.method(GameFiles.prototype, 'resolveCategory', function (name, category) {
          if (name !== 'sound.xml' || category !== 'config')
            return originalResolve.call(this, name, category);
          events.push('resource:lookup');
          const result = originalResolve.call(this, name, category);
          events.push(result === null ? 'resource:missing' : 'resource:found');
          return result;
        });
        t.mock.method(GameFiles.prototype, 'readNative', async function (name, mode) {
          if (name !== 'config.int/sound.xml') return originalRead.call(this, name, mode);
          events.push('resource:read');
          if (scenario === 'resource-throws') {
            events.push('resource:throw');
            throw resourceFailure;
          }
          const bytes = await originalRead.call(this, name, mode);
          events.push('resource:bytes');
          return bytes;
        });
        t.mock.method(NativeSoundConfiguration.prototype, 'load', function (document) {
          events.push('resource:load');
          const result = originalLoad.call(this, document);
          events.push('resource:loaded');
          return result;
        });
        t.mock.method(NativeFileStorage.prototype, 'readSaved', async function (name) {
          if (name !== 'sound.xml') return originalSaved.call(this, name);
          const sound = player.world.soundConfiguration;
          events.push('saved:read');
          savedStates.push({
            owner: sound,
            loaded: sound.loaded,
            master: sound.master,
            defaultsVolume: sound.master?.defaults.volume,
            currentVolume: sound.master?.current.volume,
            parts: sound.parts.map((part) => part.head),
          });
          if (scenario !== 'valid') {
            events.push('saved:throw');
            throw savedFailure;
          }
          const bytes = await originalSaved.call(this, name);
          events.push('saved:bytes');
          return bytes;
        });
        t.mock.method(NativeSoundConfiguration.prototype, 'applyPreferences', function (document) {
          events.push('preferences:apply');
          const result = originalApply.call(this, document);
          events.push('preferences:applied');
          return result;
        });
        player = startupPlayer(game, profile, {
          transitionalExe: {
            open() {
              opens++;
              throw new Error('unexpected original process');
            },
          },
        });
        if (scenario === 'malformed')
          await assert.rejects(player.initialize(), /soundconf fields were not initialized/);
        else if (scenario === 'saved-throws')
          await assert.rejects(player.initialize(), (error) => error === savedFailure);
        else if (scenario === 'resource-throws')
          await assert.rejects(player.initialize(), (error) => error === resourceFailure);
        else await player.initialize();
        assert.equal(opens, 0);
        const sound = player.world.soundConfiguration,
          resourceReady = [
            'resource:lookup',
            'resource:found',
            'resource:read',
            'resource:bytes',
            'resource:load',
            'resource:loaded',
          ];
        if (scenario === 'missing') {
          assert.deepEqual(events, ['resource:lookup', 'resource:missing']);
          assert.equal(sound.loaded, false);
          assert.equal(sound.master, null);
          assert.equal(player.world.frame, 1);
          assert.equal(
            player.world.runtime.variableBank(player.world.main, false).get(7),
            0x12345678,
          );
        } else if (scenario === 'malformed') {
          assert.deepEqual(events, [
            'resource:lookup',
            'resource:found',
            'resource:read',
            'resource:bytes',
          ]);
          assert.equal(sound.loaded, true);
          assert.equal(sound.master, null);
          assert.equal(player.world.frame, 0);
          assert.deepEqual(player.nativeDiagnostics, [
            { type: 'sound-configuration-invalid', file: 'sound.xml' },
          ]);
        } else if (scenario === 'resource-throws') {
          assert.deepEqual(events, [
            'resource:lookup',
            'resource:found',
            'resource:read',
            'resource:throw',
          ]);
          assert.equal(player.world.frame, 0);
        } else {
          assert.deepEqual(events, [
            ...resourceReady,
            'saved:read',
            ...(scenario === 'valid'
              ? ['saved:bytes', 'preferences:apply', 'preferences:applied']
              : ['saved:throw']),
          ]);
          assert.equal(sound.loaded, true);
          assert.equal(sound.master.defaults.volume, 70);
          assert.equal(sound.master.current.volume, scenario === 'valid' ? 33 : 70);
          assert.equal(savedStates.length, 1);
          assert.equal(savedStates[0].owner, sound);
          assert.equal(savedStates[0].master, sound.master);
          assert.equal(savedStates[0].loaded, true);
          assert.equal(savedStates[0].defaultsVolume, 70);
          assert.equal(savedStates[0].currentVolume, 70);
          assert.deepEqual(savedStates[0].parts, ['bgm']);
          assert.equal(player.world.frame, scenario === 'valid' ? 1 : 0);
        }
        if (['missing', 'malformed', 'resource-throws'].includes(scenario))
          assert.deepEqual(savedStates, []);
      } finally {
        await player?.dispose();
        environment.restore();
      }
    });
