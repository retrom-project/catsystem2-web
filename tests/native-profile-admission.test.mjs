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
import { parseNativeXML } from '../src/native/xml.mjs';
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
  });
}
