// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { readPEVersionResource } from '../src/native/profile.mjs';
import {
  ordinaryStartupGame,
  startupEnvironment,
  startupProfiles,
  startupVersionImage,
  StartupCanvas,
} from './fixtures/ordinary-startup.mjs';

for (const profile of startupProfiles)
  test(`ordinary Core selects a resource-only EXE and cold-restores its first real KCS frame: ${profile}`, async () => {
    const environment = startupEnvironment(),
      image = startupVersionImage(nativeABI(profile).engineVersion),
      view = new DataView(image.buffer),
      pe = view.getUint32(60, true),
      optional = pe + 24,
      section = optional + view.getUint16(pe + 20, true);
    // One data section, no code bytes, entry point, imports, or executable flags.
    assert.equal(view.getUint16(pe + 6, true), 1);
    assert.equal(view.getUint32(optional + 4, true), 0);
    assert.equal(view.getUint32(optional + 16, true), 0);
    assert.equal(view.getUint32(optional + 104, true), 0);
    assert.equal(view.getUint32(section + 36, true) & 0x20000000, 0);
    const createGame = () =>
      ordinaryStartupGame(profile, {
        sound: false,
        files: { 'authored.exe': image.slice() },
      });
    let core, fresh;
    try {
      const game = await createGame();
      let versionReads = 0;
      const require = game.require;
      game.require = async function (name, ...args) {
        if (name === 'authored.exe') versionReads++;
        return require.call(this, name, ...args);
      };
      const createCore = (source) =>
        new CatSystem2({
          game: source,
          canvas: new StartupCanvas(),
          audioContext: { currentTime: 0, close: async () => {} },
          randomSeed: 47,
        });
      core = createCore(game);
      assert.equal(core.transitionalExe, null);
      await core.initialize();
      assert.equal(core.nativeProfile, profile);
      assert.ok(versionReads > 0, 'real auto-selection reads the version resource');
      assert.equal(core.nativeModule.name, 'authored.exe');
      assert.deepEqual(core.nativeModule.resource, readPEVersionResource(image));
      assert.equal(core.world.frame, 1);
      assert.equal(core.world.runtime.variableBank(core.world.main, false).get(7), 0x12345678);
      assert.equal(Object.hasOwn(core.world, 'nativeEngine'), false);
      const saved = await core.snapshot();
      assert.equal(Object.hasOwn(saved.world, 'nativeEngine'), false);
      const restoredGame = await createGame(),
        originalRequire = restoredGame.require;
      let replayedModule = 0;
      restoredGame.require = async function (name, ...args) {
        if (name === 'authored.exe') replayedModule++;
        return originalRequire.call(this, name, ...args);
      };
      fresh = createCore(restoredGame);
      await fresh.initialize({ checkpoint: saved });
      assert.equal(fresh.world.frame, 1, 'no warm frame');
      assert.equal(replayedModule, 0, 'saved module authority avoids replaying EXE selection');
      assert.deepEqual(fresh.world.snapshot(), saved.world);
      assert.deepEqual(fresh.world.random.snapshot(), saved.world.random);
      assert.deepEqual(fresh.nativeModule.resource, readPEVersionResource(image));
      await fresh.step();
      assert.equal(fresh.world.frame, 2, 'the resumed ordinary scheduler runs the next frame');
      assert.equal(Object.hasOwn(fresh.world, 'nativeEngine'), false);
    } finally {
      await fresh?.dispose();
      await core?.dispose();
      environment.restore();
    }
  });
