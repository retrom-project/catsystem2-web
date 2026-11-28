// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { audioFixture } from './fixtures/audio-context.mjs';
import {
  ordinaryStartupGame,
  StartupCanvas,
  startupEnvironment,
} from './fixtures/ordinary-startup.mjs';

test('host accounts keep committed browser saves separate for the same mounted game', async () => {
  const environment = startupEnvironment(),
    settings = new Map(),
    originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    cores = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: (key, value) => settings.set(key, value) },
  });
  try {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      game = await ordinaryStartupGame(profile, { sound: false }),
      identity = await game.fingerprint();
    const launch = async (storageNamespace) => {
      const core = new CatSystem2({
        game,
        canvas: new StartupCanvas(),
        audioContext: audioFixture().context,
        nativeProfile: profile,
        storageNamespace,
      });
      cores.push(core);
      assert.equal(core.storageNamespace, storageNamespace);
      await core.initialize();
      assert.equal(core.identity, identity);
      return core;
    };
    const ownerA = `first:game:${identity}`,
      ownerB = `second:game:${identity}`,
      first = await launch(ownerA);
    await first.saves.put(7, { sourceIdentity: identity, marker: 'first' }, {});
    await first.nativeStorage.write('savegen.dat', Uint8Array.of(1));
    await first.nativeStorage.writePlatform('platform-flags', Uint8Array.of(2));
    first.settings.volume = 17;
    first.persistSettings();
    assert.equal((await first.snapshot()).sourceIdentity, identity);
    await first.dispose();

    const second = await launch(ownerB);
    assert.equal(second.saves.get(7), undefined);
    assert.equal(await second.nativeStorage.readSaved('savegen.dat'), null);
    assert.equal(await second.nativeStorage.readPlatform('platform-flags'), null);
    await second.nativeStorage.write('savegen.dat', Uint8Array.of(4));
    second.settings.volume = 45;
    second.persistSettings();
    await second.dispose();

    const original = await launch(ownerA);
    assert.equal(original.saves.get(7).data.marker, 'first');
    assert.deepEqual(await original.nativeStorage.readSaved('savegen.dat'), Uint8Array.of(1));
    assert.deepEqual(await original.nativeStorage.readPlatform('platform-flags'), Uint8Array.of(2));
    assert.equal(settings.get(`catsystem2:${ownerA}:settings`), '{"volume":17}');
    assert.equal(settings.get(`catsystem2:${ownerB}:settings`), '{"volume":45}');

    const ordinary = await launch();
    assert.equal(ordinary.saves.namespace, identity);
    assert.equal(ordinary.nativeStorage.store.namespace, `${identity}:native-files`);
    assert.equal(ordinary.saves.get(7), undefined);
    assert.equal(await ordinary.nativeStorage.readSaved('savegen.dat'), null);
  } finally {
    for (const core of cores.reverse()) await core.dispose();
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
    environment.restore();
  }
});
