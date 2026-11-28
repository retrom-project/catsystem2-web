// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { engineFixtureSet } from './fixtures/oracle-fixtures.mjs';
import {
  readEngineVersion,
  selectNativeProfile,
  selectNativeCheckpointProfile,
} from '../src/native/profile.mjs';
import { checkNativeStartupResources } from '../src/native/startup-resources.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { parseNativeXML, findNativeXML } from '../src/native/xml.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import {
  ordinaryStartupGame,
  StartupCanvas,
  startupEnvironment,
} from './fixtures/ordinary-startup.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { nativeABI, NATIVE_ABIS } from '../src/native/abi/index.mjs';

for (const fixture of await engineFixtureSet()) {
  test(`production admission binds reviewed bytes, checkpoint authority and startup resources: ${fixture.profile}`, async (t) => {
    if (!fixture.available) return t.skip(fixture.reason);
    const records = { 'engine.exe': fixture.bytes, 'utility.exe': Uint8Array.of(1, 2, 3) },
      game = { names: () => Object.keys(records), require: async (name) => records[name] },
      selected = await selectNativeProfile(game),
      state = { configuration: { profile: fixture.profile }, nativeModule: selected.module };
    assert.equal(selected.profile, fixture.profile);
    assert.equal(selected.executable.name, 'engine.exe');
    assert.deepEqual(selected.executable.bytes, fixture.bytes);
    assert.notEqual(selected.executable.bytes, fixture.bytes);
    assert.equal((await selectNativeProfile(game, fixture.profile)).profile, fixture.profile);
    assert.equal((await selectNativeCheckpointProfile(game, state)).profile, fixture.profile);
    await assert.rejects(
      selectNativeCheckpointProfile(game, { ...state, nativeModule: null }),
      /current reviewed executable/,
    );
    const wrong = Object.keys(NATIVE_ABIS).find((profile) => profile !== fixture.profile);
    await assert.rejects(selectNativeProfile(game, wrong), /does not match requested profile/);
    await assert.rejects(
      selectNativeCheckpointProfile(game, { ...state, configuration: { profile: wrong } }),
      /current native profile/,
    );
    records['copy.exe'] = fixture.bytes;
    await assert.rejects(selectNativeProfile(game), /unique reviewed/);
    delete records['copy.exe'];
    const changed = new Uint8Array(fixture.bytes.length + 1);
    changed.set(fixture.bytes);
    assert.equal(readEngineVersion(changed), readEngineVersion(fixture.bytes));
    records['engine.exe'] = changed;
    for (const explicit of [undefined, fixture.profile])
      await assert.rejects(selectNativeProfile(game, explicit), /SHA-256 .*unreviewed/);
    await assert.rejects(selectNativeCheckpointProfile(game, state), /SHA-256 .*unreviewed/);

    // Resource verification consumes the exact selected byte copy. It neither
    // scans nor rereads another executable after the current content changes.
    const world = {
      profile: fixture.profile,
      startupDocument: parseNativeXML(
        new Uint8Array(await readFile(join(dirname(fixture.filename), 'config/startup.xml'))),
        nativeABI(fixture.profile).xmlEncoding,
      ),
      configuration: new NativeConfiguration({ profile: fixture.profile }),
      random: new ParticleRandom(7),
      clock: { utcNow: () => 1700000000000 },
      storage: { size: async () => null },
      bootstrapOwner: { executable: selected.executable },
      game: {
        names() {
          throw new Error('Resource verification rescanned executables');
        },
        require() {
          throw new Error('Resource verification reread an executable');
        },
      },
    };
    await checkNativeStartupResources(world);

    const environment = startupEnvironment();
    let core, author;
    try {
      const code = (
          findNativeXML(world.startupDocument, 'APP/v_code')?.text ??
          new TextDecoder().decode(
            Uint8Array.from(nativeABI(fixture.profile).startup.verification.defaultCodeBytes),
          )
        )
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;'),
        owned = await ordinaryStartupGame(fixture.profile, {
          sound: false,
          startup: `<APP><v_code>${code}</v_code></APP>`,
          files: {
            'engine.exe': fixture.bytes,
            'scripts.int': kif([['main.kcs', kcsProgram([[59]])]]),
          },
        });
      const names = owned.names.bind(owned);
      // A mounted view can retain the same content identity while losing its PE.
      // This normal explicit authoring snapshot is never edited for the test.
      owned.names = (extension) => (extension === 'exe' ? [] : names(extension));
      author = new CatSystem2({
        game: owned,
        nativeProfile: fixture.profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        randomSeed: 77,
      });
      await author.initialize({ gameSave: null });
      const authorCheckpoint = await author.snapshot();
      assert.equal(authorCheckpoint.world.nativeModule, null);
      const automatic = new CatSystem2({
        game: owned,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        randomSeed: 77,
      });
      try {
        await assert.rejects(
          automatic.initialize({ checkpoint: authorCheckpoint }),
          /unique reviewed/,
        );
        assert.equal(automatic.world, undefined);
      } finally {
        await automatic.dispose();
      }
      owned.names = names;
      core = new CatSystem2({
        game: owned,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        randomSeed: 77,
      });
      await core.initialize({ gameSave: null });
      assert.equal(core.requestedNativeProfile, undefined);
      const saved = await core.snapshot(),
        previous = core.world,
        module = core.nativeModule,
        executable = core.nativeExecutable,
        create = core.createNativeWorld.bind(core);
      let creations = 0;
      core.createNativeWorld = (...args) => {
        creations++;
        return create(...args);
      };
      core.game.names = (extension) => (extension === 'exe' ? [] : names(extension));
      assert.equal(saved.sourceIdentity, authorCheckpoint.sourceIdentity);
      await assert.rejects(core.restore(authorCheckpoint), /unique reviewed/);
      assert.equal(creations, 0);
      assert.equal(core.world, previous);
      assert.equal(core.nativeModule, module);
      assert.equal(core.nativeExecutable, executable);
      const previousAuthor = author.world;
      await author.restore(authorCheckpoint);
      assert.notEqual(author.world, previousAuthor);
      core.game.names = names;
      await core.restore(saved);
      assert.notEqual(core.world, previous);
      assert.equal(creations, 1);
    } finally {
      await core?.dispose();
      await author?.dispose();
      environment.restore();
    }
  });
}
