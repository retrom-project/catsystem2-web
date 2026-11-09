// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectNativeM2Bootstrap } from '../src/native/emote-bootstrap.mjs';
import { transitionalExe } from '../web/transitional-entry.mjs';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { memoryGame } from './helpers.mjs';

const gameProfile = 'nekopara-vol3-engine-2.6.1.76';
test('native bootstrap does not initialize a driver because an unrelated executable is mounted', async () => {
  assert.equal(await inspectNativeM2Bootstrap(memoryGame({}), gameProfile), null);
  assert.equal(
    await inspectNativeM2Bootstrap(
      memoryGame({ 'tool.exe': nativeParticleFixture() }),
      gameProfile,
      transitionalExe,
    ),
    null,
  );
});

for (const [profile, fixture, required] of [
  ['sdk-4.01-engine-2.6.1.74', process.env.CATSYSTEM2_SDK_EXE, false],
  [gameProfile, process.env.CATSYSTEM2_ENGINE_EXE, true],
])
  test(
    `bootstrap reads the reviewed ${profile} import table without loading its optional media or DLLs`,
    { skip: !fixture },
    async () => {
      const bytes = new Uint8Array(await readFile(fixture)),
        game = memoryGame({ 'engine.exe': bytes, 'unrelated.exe': nativeParticleFixture() }),
        result = await inspectNativeM2Bootstrap(game, profile, transitionalExe);
      assert.equal(result.name, 'engine.exe');
      assert.equal(result.sha256, NATIVE_ENGINE_IMAGES[profile].sha256);
      assert.equal(result.required, required);
      assert.equal(result.driver?.toLowerCase() ?? null, required ? 'emotedriver.dll' : null);
      if (required) assert.equal(game.names('dll').length, 0);
      const duplicate = memoryGame({ 'one.exe': bytes, 'two.exe': bytes });
      await assert.rejects(
        inspectNativeM2Bootstrap(duplicate, profile, transitionalExe),
        /Multiple matching/,
      );
    },
  );
