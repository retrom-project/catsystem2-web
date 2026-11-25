// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { readEngineVersion } from '../src/native/profile.mjs';
import {
  ordinaryStartupGame,
  startupEnvironment,
  startupProfiles,
  startupVersionImage,
  StartupCanvas,
} from './fixtures/ordinary-startup.mjs';

for (const profile of startupProfiles)
  test(`resource-only PE cannot authorize production; explicit no-PE authoring cold-restores its first KCS frame: ${profile}`, async () => {
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
    const createGame = (executable = false) =>
      ordinaryStartupGame(profile, {
        sound: false,
        files: executable ? { 'authored.exe': image.slice() } : {},
      });
    let core, fresh, automatic;
    const createCore = (game, nativeProfile) =>
      new CatSystem2({
        game,
        nativeProfile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        randomSeed: 47,
      });
    try {
      const input = await createGame(true);
      assert.equal(readEngineVersion(image), nativeABI(profile).engineVersion);
      for (const explicit of [undefined, profile]) {
        automatic = createCore(input, explicit);
        await assert.rejects(automatic.initialize(), /SHA-256 .*unreviewed executable fingerprint/);
        assert.equal(automatic.world, undefined);
        await automatic.dispose();
      }
      const game = await createGame();
      core = createCore(game, profile);
      assert.equal(core.transitionalExe, null);
      await core.initialize();
      assert.equal(core.nativeProfile, profile);
      assert.equal(core.nativeModule, null);
      assert.equal(core.world.frame, 1);
      assert.equal(core.world.runtime.variableBank(core.world.main, false).get(7), 0x12345678);
      assert.equal(Object.hasOwn(core.world, 'nativeEngine'), false);
      const saved = await core.snapshot();
      assert.equal(Object.hasOwn(saved.world, 'nativeEngine'), false);
      automatic = createCore(game);
      await assert.rejects(automatic.initialize({ checkpoint: saved }), /unique reviewed/);
      assert.equal(automatic.world, undefined);
      fresh = createCore(await createGame(), profile);
      await fresh.initialize({ checkpoint: saved });
      assert.equal(fresh.world.frame, 1, 'no warm frame');
      assert.deepEqual(fresh.world.snapshot(), saved.world);
      assert.deepEqual(fresh.world.random.snapshot(), saved.world.random);
      assert.equal(fresh.nativeModule, null);
      await fresh.step();
      assert.equal(fresh.world.frame, 2, 'the resumed ordinary scheduler runs the next frame');
      assert.equal(Object.hasOwn(fresh.world, 'nativeEngine'), false);
    } finally {
      await automatic?.dispose();
      await fresh?.dispose();
      await core?.dispose();
      environment.restore();
    }
  });
