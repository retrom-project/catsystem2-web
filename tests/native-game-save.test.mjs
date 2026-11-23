// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { loadNativeZlib } from '../src/native/zlib.mjs';
import { audioFixture } from './fixtures/audio-context.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import {
  ordinaryStartupGame,
  StartupCanvas,
  startupEnvironment,
} from './fixtures/ordinary-startup.mjs';

const time = {
  createdMs: 1700000000000,
  accessedMs: 1700000001000,
  modifiedMs: 1700000002000,
  attributes: 0x80,
};
const entry = (path, bytes, info = time) => ({ path, bytes, ...info });
function nativeSave(value) {
  const file = new NativeGlobalFile(19);
  file.write(1024, Uint8Array.of(value));
  return file;
}

for (const profile of [
  'rebellions-jp-engine-2.6.1.63',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
]) {
  test(`${profile} native slot loads the selected version and isolates later writes from the account`, async () => {
    await loadNativeZlib();
    const environment = startupEnvironment(),
      cores = [];
    try {
      const older = await nativeSave(11).file(),
        newer = await nativeSave(22).file(),
        indexA = await nativeSave(31).file(),
        indexB = await nativeSave(32).file();
      const game = await ordinaryStartupGame(profile, {
        sound: false,
        files: {
          'save9999.dat': newer,
          'scripts.int': kif([
            [
              'main.kcs',
              kcsProgram([[37, 128], [43, 0xf7, 4], [38, 64], [59]], [[128, 'save5000.dat']]),
            ],
          ]),
        },
      });
      const storageNamespace = `account:game:${await game.fingerprint()}`;
      const launch = async (gameSave, verifyBeforeWorld) => {
        const core = new CatSystem2({
          game,
          storageNamespace,
          nativeProfile: profile,
          canvas: new StartupCanvas(),
          audioContext: audioFixture().context,
        });
        cores.push(core);
        if (verifyBeforeWorld) {
          const createWorld = core.createNativeWorld;
          core.createNativeWorld = function (...args) {
            assert(this.nativeStorage.hasSaved('save5000.dat'));
            assert(this.gameSaveStatus().progress);
            return createWorld.apply(this, args);
          };
        }
        await core.initialize({ gameSave });
        return core;
      };
      const original = await launch(null);
      const storage = original.nativeStorage;
      assert.equal(original.saves, undefined);
      assert(storage.has('save9999.dat'));
      await storage.write('preferences.bin', Uint8Array.of(4));
      await storage.write('savegen.dat', indexB);
      assert.equal(original.gameSaveStatus().progress, false);
      assert.equal(await original.exportGameSave(), null);
      await original.world.saveSlots.write('save5000.dat', nativeSave(22));
      await storage.setTimes('save5000.dat', { modifiedMs: 1800000000000 });
      await storage.write('save0001.dat', newer);
      const captured = await original.exportGameSave();
      assert.deepEqual(
        captured.files.map(({ path }) => path),
        ['save0001.dat', 'save5000.dat', 'savegen.dat'],
      );
      assert.equal(captured.files[1].modifiedMs, 1800000000000);
      captured.files[1].bytes.fill(0);
      assert.deepEqual(await storage.readSaved('save5000.dat'), newer);
      await original.dispose();

      const selected = [entry('save5000.dat', older), entry('savegen.dat', indexA)];
      const resumed = await launch(selected, true),
        files = resumed.nativeStorage;
      assert.equal(
        resumed.world.runtime.handles
          .get(resumed.world.main.machine.load(64), 'global-file')
          .read(1024)[0],
        11,
      );
      assert.equal((await resumed.world.saveSlots.load('save5000.dat')).read(1024)[0], 11);
      assert.equal(await resumed.world.saveSlots.load('save0001.dat'), null);
      assert.deepEqual(await files.stat('save5000.dat'), time);
      assert.deepEqual(await files.readSaved('preferences.bin'), Uint8Array.of(4));
      const revision = resumed.gameSaveStatus().revision;
      await resumed.world.saveSlots.write('save5000.dat', nativeSave(11));
      assert.equal(resumed.gameSaveStatus().revision, revision);
      await files.write('savegen.dat', indexB);
      assert.notEqual(resumed.gameSaveStatus().revision, revision);
      await resumed.world.saveSlots.write('save5000.dat', nativeSave(44));
      await resumed.world.saveSlots.exchange('save5000.dat', 'save5001.dat', '');
      assert.equal((await resumed.world.saveSlots.load('save5001.dat')).read(1024)[0], 44);
      assert.equal(await files.readSaved('save5000.dat'), null);
      assert.deepEqual(
        (await resumed.exportGameSave()).files.map(({ path }) => path),
        ['save5001.dat', 'savegen.dat'],
      );
      assert.deepEqual(await files.readSaved('savegen.dat'), indexB);
      await resumed.dispose();

      const unchangedSelection = await launch(selected, true);
      assert.deepEqual(await unchangedSelection.nativeStorage.readSaved('savegen.dat'), indexA);
      await unchangedSelection.dispose();
      const final = await launch(null);
      assert.equal((await final.world.saveSlots.load('save5000.dat')).read(1024)[0], 22);
      assert.equal(await final.world.saveSlots.load('save5001.dat'), null);
      assert.deepEqual(await final.nativeStorage.readSaved('savegen.dat'), indexB);
      assert.equal((await final.nativeStorage.stat('save5000.dat')).modifiedMs, 1800000000000);
    } finally {
      for (const core of cores.reverse()) await core.dispose();
      environment.restore();
    }
  });
}

test('native game save selection is complete, bounded and canceled before it changes the file view', async (t) => {
  await loadNativeZlib();
  const environment = startupEnvironment(),
    storage = new NativeFileStorage({ lookup: () => null }, 'account:game');
  try {
    const prior = await nativeSave(12).file(),
      selected = await nativeSave(38).file();
    await storage.open();
    await storage.write('save0000.dat', prior);
    for (const files of [
      [entry('savegen.dat', selected)],
      [entry('../save0000.dat', selected)],
      [entry('setup.xml', selected)],
      [entry('else/savegen.dat', selected), entry('save0000.dat', selected)],
      [entry('save0000.dat', selected), entry('save0000.dat', prior)],
      [entry('save0000.dat', await new NativeGlobalFile().file())],
      [entry('save0000.dat', selected), entry('save0001.dat', Uint8Array.of(1))],
    ]) {
      await assert.rejects(storage.prepareGameSave(files));
      assert.deepEqual(await storage.readSaved('save0000.dat'), prior);
      assert.equal(storage.gameSaveEnabled, false);
    }

    const waiting = Promise.withResolvers();
    const count = NativeGlobalFile.countFileEntries;
    const mock = t.mock.method(NativeGlobalFile, 'countFileEntries', async (...args) => {
      await waiting.promise;
      return count.call(NativeGlobalFile, ...args);
    });
    const cancel = new AbortController();
    const pending = storage.prepareGameSave([entry('save-001.dat', selected)], {
      signal: cancel.signal,
    });
    assert.equal(storage.gameSaveStatus().busy, true);
    assert.equal(await storage.readSaved('save-001.dat'), null);
    await assert.rejects(storage.prepareGameSave(null), /already configured/);
    cancel.abort();
    waiting.resolve();
    await assert.rejects(pending, { name: 'AbortError' });
    mock.mock.restore();
    assert.equal(storage.gameSaveEnabled, false);
    await storage.prepareGameSave([entry('save-001.dat', selected)]);
    assert.deepEqual(await storage.readSaved('save-001.dat'), selected);
    assert.equal(await storage.readSaved('save0000.dat'), null);
    assert.deepEqual(storage.store.get('save0000.dat').data.bytes, prior);
  } finally {
    storage.close();
    environment.restore();
  }
});
