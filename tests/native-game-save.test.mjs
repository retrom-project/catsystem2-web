// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { CatSystem2 } from '../src/engine.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeGlobalFile, nativePersistence } from '../src/native/persistence.mjs';
import { NativeSaveSlots } from '../src/native/save-slots.mjs';
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

function cssWithPayload(payload) {
  const compressed = deflateSync(payload),
    bytes = new Uint8Array(16 + compressed.length),
    header = new DataView(bytes.buffer);
  [0x00535343, compressed.length, payload.length, 19].forEach((value, index) =>
    header.setUint32(index * 4, value, true),
  );
  bytes.set(compressed, 16);
  return bytes;
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
      assert.equal(original.importedGameSaveRevision, null);
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

test('the imported revision precedes native save writes on the first game tick', async () => {
  await loadNativeZlib();
  const environment = startupEnvironment(),
    profile = 'sdk-4.01-engine-2.6.1.74';
  let core;
  try {
    const selected = await nativeSave(11).file();
    const game = await ordinaryStartupGame(profile, {
      sound: false,
      files: {
        'scripts.int': kif([
          [
            'main.kcs',
            kcsProgram(
              [
                [37, 128],
                [43, 0xf7, 4],
                [38, 64],
                [37, [0x13, 64]],
                [37, 256],
                [43, 0xf5, 8],
                [38, 68],
                [59],
              ],
              [
                [128, 'save5000.dat'],
                [256, 'save5001.dat'],
              ],
            ),
          ],
        ]),
      },
    });
    core = new CatSystem2({
      game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      audioContext: audioFixture().context,
    });
    const createWorld = core.createNativeWorld.bind(core);
    let imported;
    core.createNativeWorld = () => {
      imported = core.gameSaveStatus().revision;
      return createWorld();
    };
    await core.initialize({ gameSave: [entry('save5000.dat', selected)] });
    assert.equal(core.world.main.machine.load(68), 1);
    const captured = await core.exportGameSave();
    assert.deepEqual(
      captured.files.map(({ path }) => path),
      ['save5000.dat', 'save5001.dat'],
    );
    assert.deepEqual(captured.files[1].bytes, selected);
    assert.notEqual(captured.revision, imported);
    assert.equal(core.importedGameSaveRevision, imported);
  } finally {
    await core?.dispose();
    environment.restore();
  }
});

test('a slot remains busy through serialization and the storage capacity check', async () => {
  await loadNativeZlib();
  const environment = startupEnvironment(),
    storage = new NativeFileStorage({ lookup: () => null }, 'account:game'),
    serialization = Promise.withResolvers(),
    capacityCheck = Promise.withResolvers(),
    capacity = Promise.withResolvers();
  let pending, bytes;
  try {
    bytes = await nativeSave(12).file();
    await storage.open();
    await storage.prepareGameSave([entry('save0000.dat', bytes)]);
    storage.diskSpace = () => {
      capacityCheck.resolve();
      return capacity.promise;
    };
    const prior = storage.exportGameSave(),
      slots = new NativeSaveSlots({ storage });
    pending = slots.write('save0001.dat', { file: () => serialization.promise });
    assert.equal(storage.gameSaveStatus().busy, true);
    assert.throws(() => storage.exportGameSave(), /being committed/);

    serialization.resolve(bytes);
    await capacityCheck.promise;
    assert.equal(storage.gameSaveStatus().busy, true);
    assert.equal(await storage.readSaved('save0001.dat'), null);

    capacity.resolve({ availableBytes: 0 });
    assert.equal(await pending, false);
    assert.equal(storage.gameSaveStatus().busy, undefined);
    assert.deepEqual(storage.exportGameSave(), prior);
  } finally {
    serialization.resolve(bytes);
    capacity.resolve({ availableBytes: 0 });
    await pending?.catch(() => {});
    storage.close();
    environment.restore();
  }
});

test('an authored CSS save remains busy before it commits new slot bytes', async () => {
  await loadNativeZlib();
  const environment = startupEnvironment(),
    storage = new NativeFileStorage({ lookup: () => null }, 'account:game'),
    serialization = Promise.withResolvers();
  let pending, bytes;
  try {
    bytes = await nativeSave(12).file();
    await storage.open();
    await storage.prepareGameSave([entry('save0000.dat', bytes)]);
    const handles = new NativeHandles(),
      file = handles.add('global-file', { file: () => serialization.promise }),
      prior = storage.gameSaveStatus().revision;
    pending = nativePersistence(0xf5, [file, 128], null, {
      handles,
      persistence: storage,
      format: () => 'save0001.dat',
    });
    assert.equal(storage.gameSaveStatus().busy, true);
    assert.throws(() => storage.exportGameSave(), /being committed/);
    assert.equal(await storage.readSaved('save0001.dat'), null);

    serialization.resolve(bytes);
    assert.equal((await pending).value, 1);
    assert.equal(storage.gameSaveStatus().busy, undefined);
    const captured = storage.exportGameSave();
    assert.notEqual(captured.revision, prior);
    assert.deepEqual(captured.files[1].bytes, bytes);
  } finally {
    serialization.resolve(bytes);
    await pending?.catch(() => {});
    storage.close();
    environment.restore();
  }
});

test('FES slot annotation, copy and exchange stay busy from the first read', async () => {
  await loadNativeZlib();
  const environment = startupEnvironment(),
    storage = new NativeFileStorage({ lookup: () => null, read: async () => null }, 'account:game'),
    profile = 'sdk-4.01-engine-2.6.1.74',
    slots = new NativeSaveSlots({
      storage,
      profile,
      objects: { objects: new Map([[1, { kind: 34, context: { contextName: '' } }]]) },
    }),
    encoder = new TextEncoder(),
    instance = { runtimeID: 1, argumentBytes: (token) => encoder.encode(token), value: Number };
  const originalRead = storage.read.bind(storage);
  try {
    const first = await nativeSave(11).file(),
      second = await nativeSave(22).file();
    await storage.open();
    await storage.prepareGameSave([entry('save0001.dat', first), entry('save0002.dat', second)]);
    const original = storage.gameSaveStatus().revision;
    const write = async (source, fault) => {
      const waiting = Promise.withResolvers();
      storage.read = (name) => {
        storage.read = originalRead;
        return waiting.promise.then(() => originalRead(name));
      };
      const pending = slots.command(instance, source.split(' ')[0], source);
      try {
        assert.equal(storage.gameSaveStatus().busy, true);
        assert.throws(() => storage.exportGameSave(), /being committed/);
        if (fault) {
          waiting.reject(fault);
          await assert.rejects(pending, (error) => error === fault);
        } else {
          waiting.resolve();
          assert.equal(await pending, 0);
        }
        assert.equal(storage.gameSaveStatus().busy, undefined);
      } finally {
        waiting.resolve();
        await pending.catch(() => {});
        storage.read = originalRead;
      }
    };
    await write('saveapend_str 1 1025 annotated');
    const annotated = await storage.readSaved('save0001.dat');
    assert.deepEqual(
      (await slots.load('save0001.dat')).read(1025),
      encoder.encode('annotated\0\0\0\0'),
    );
    assert.notEqual(storage.gameSaveStatus().revision, original);
    await write('savecopy 1 3');
    assert.deepEqual(await storage.readSaved('save0003.dat'), annotated);
    await write('saveexchg 1 2');
    assert.deepEqual(await storage.readSaved('save0001.dat'), second);
    assert.deepEqual(await storage.readSaved('save0002.dat'), annotated);

    const captured = storage.exportGameSave();
    await write('saveexchg 1 2', new Error('Delayed source read failed'));
    assert.deepEqual(storage.exportGameSave(), captured);
  } finally {
    storage.close();
    environment.restore();
  }
});

test('an oversized CSS payload or too many CSS records never replaces the account view', async () => {
  await loadNativeZlib();
  const environment = startupEnvironment(),
    storage = new NativeFileStorage({ lookup: () => null }, 'account:game');
  try {
    const prior = await nativeSave(11).file(),
      oversized = prior.slice(),
      tooManyRecords = cssWithPayload(new Uint8Array((262144 + 1) * 8));
    new DataView(oversized.buffer).setUint32(8, 64 * 1024 * 1024 + 1, true);
    await storage.open();
    await storage.write('save0000.dat', prior);
    await assert.rejects(
      storage.prepareGameSave([entry('save0000.dat', oversized)]),
      /expanded byte limit/,
    );
    await assert.rejects(
      storage.prepareGameSave([entry('save0000.dat', tooManyRecords)]),
      /record limit/,
    );
    assert.equal(storage.gameSaveEnabled, false);
    assert.deepEqual(await storage.readSaved('save0000.dat'), prior);
  } finally {
    storage.close();
    environment.restore();
  }
});

test('the same expanded CSS budget applies to selection and export across files', async () => {
  await loadNativeZlib();
  const environment = startupEnvironment(),
    storage = new NativeFileStorage({ lookup: () => null }, 'account:game');
  try {
    const prior = await nativeSave(11).file(),
      payload = new Uint8Array(64 * 1024 * 1024);
    new DataView(payload.buffer).setUint32(4, payload.length - 8, true);
    const compressed = cssWithPayload(payload),
      selection = [
        entry('save0000.dat', prior),
        ...Array.from({ length: 4 }, (_, index) => entry(`save000${index + 1}.dat`, compressed)),
      ];
    await storage.open();
    await storage.write('save0000.dat', prior);
    await assert.rejects(storage.prepareGameSave(selection), /combined expanded byte limit/);
    assert.equal(storage.gameSaveEnabled, false);
    assert.deepEqual(await storage.readSaved('save0000.dat'), prior);
    assert.equal(await storage.readSaved('save0001.dat'), null);
    await storage.prepareGameSave([selection[0]]);
    for (const { path, bytes } of selection.slice(1)) assert(await storage.write(path, bytes));
    assert.throws(() => storage.exportGameSave(), /combined expanded byte limit/);
    assert(await storage.remove('save0004.dat'));
    assert.deepEqual(
      storage.exportGameSave().files.map(({ path }) => path),
      ['save0000.dat', 'save0001.dat', 'save0002.dat', 'save0003.dat'],
    );
    assert.deepEqual(storage.store.get('save0000.dat').data.bytes, prior);
  } finally {
    storage.close();
    environment.restore();
  }
});

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
