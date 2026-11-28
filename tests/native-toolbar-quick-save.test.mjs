// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { EngineHost } from '../src/host.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { KCSScheduler } from '../src/kcs/scheduler.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { NativeGlobalFile, nativePersistence } from '../src/native/persistence.mjs';
import { SaveStore } from '../src/saves.mjs';
import { loadNativeZlib } from '../src/native/zlib.mjs';
import { StartupCanvas, startupEnvironment } from './fixtures/ordinary-startup.mjs';

function transactionalSaves() {
  let stored = new Map();
  const db = {
    failNextWrite: null,
    throwNextWrite: null,
    readTransactions: [],
    close() {},
    transaction(_store, mode) {
      const operations = [],
        readKeys = [],
        transaction = {
          aborted: false,
          abort() {
            this.aborted = true;
          },
        },
        resultOf = (perform) => {
          const request = {};
          operations.push([request, perform]);
          return request;
        },
        store = {
          get: (key) => {
            readKeys.push(key);
            return resultOf((records) => structuredClone(records.get(key)));
          },
          put: (record) => {
            if (db.throwNextWrite === record.key) {
              db.throwNextWrite = null;
              throw new Error('Owned synchronous save failure');
            }
            return resultOf((records) => {
              if (db.failNextWrite === record.key) {
                db.failNextWrite = null;
                throw new Error('Owned transaction failure');
              }
              records.set(record.key, structuredClone(record));
              return record.key;
            });
          },
        };
      queueMicrotask(() => {
        if (transaction.aborted) return;
        const next = new Map(stored);
        try {
          for (const [request, perform] of operations) {
            request.result = perform(next);
            request.onsuccess?.();
          }
        } catch (error) {
          transaction.error = error;
          transaction.onabort();
          return;
        }
        if (mode === 'readonly') db.readTransactions.push(readKeys);
        else stored = next;
        transaction.oncomplete();
      });
      return Object.assign(transaction, { objectStore: () => store });
    },
  };
  return db;
}

function owner(database, identity, { story = true, implicitReader = true, textOwner } = {}) {
  const nativeStorage = new NativeFileStorage({}, identity),
    saves = new SaveStore(identity),
    writer = { id: 3 },
    root = { runtimeID: 10 },
    sender = {
      id: root.runtimeID,
      parent: story ? writer.id : 8,
      implementation: { player: { root } },
    },
    text = { sourceEvents: [{ kind: 'append', bytes: Uint8Array.of(112) }] },
    textRecord = {
      id: 18,
      parent: textOwner ?? sender.id,
      state: 'active',
      implementation: { text, state: { shown: true } },
    },
    objects = new Map([
      [root.runtimeID, sender],
      [writer.id, writer],
      [textRecord.id, textRecord],
    ]),
    reader = { filename: 'owned-story.cst', block: 7, line: 11 },
    storyState = { phase: 'story', reader, message: 'First saved dialogue' },
    calls = { snapshots: 0, packets: [], cssWrites: 0, restored: [] },
    task = {
      status: 'waiting',
      machine: {
        waiting: { kind: 'message', address: 0 },
        receiveMessage(words) {
          calls.packets.push(words);
          return true;
        },
        load: () => 0,
      },
    },
    scheduler = {
      tasks: new Map([[writer.id, task]]),
      send: KCSScheduler.prototype.send,
      async execute() {
        storyState.phase = 'saving';
        return { status: 'waiting' };
      },
    },
    world = {
      closed: false,
      frame: 12,
      objects: {
        objects,
        children: (record) => [...objects.values()].filter((child) => child.parent === record.id),
      },
      nativeTaskID: () => 91,
      async tick() {
        this.frame++;
      },
    };
  nativeStorage.store.db = nativeStorage.platformStore.db = saves.db = database;
  const engine = Object.assign(
    new CatSystem2({
      game: { width: 2, height: 2 },
      canvas: new StartupCanvas(),
      audioContext: { currentTime: 0, close: async () => {} },
    }),
    {
      world,
      saves,
      nativeStorage,
      identity,
      quickSaveStart: 42,
      adv: { value: () => '2' },
      nativeRuntime: { scheduler, sceneData: () => (implicitReader ? { reader } : null) },
      activeFES: () => sender.implementation.player,
      inputBindings: { sample() {} },
      audio: { setFrame() {} },
      async snapshot() {
        calls.snapshots++;
        return {
          format: 'catsystem2-web',
          sourceIdentity: identity,
          world: structuredClone(storyState),
        };
      },
      async restore(value) {
        calls.restored.push(value);
      },
    },
  );
  const host = new EngineHost(engine);
  const writeCSS = (name, octet, author = writer) => {
    calls.cssWrites++;
    const file = new NativeGlobalFile(7);
    file.write(10, Uint8Array.of(octet));
    return nativePersistence(
      0xf5,
      [1, 0],
      {},
      {
        owner: author.id,
        world: { objects: { objects: new Map([[author.id, author]]) } },
        handles: { get: () => file },
        persistence: nativeStorage,
        saveDirectory: 'saves',
        format: () => name,
      },
    );
  };
  return {
    host,
    engine,
    saves,
    nativeStorage,
    world,
    calls,
    reader,
    storyState,
    writeCSS,
    textRecord,
    text,
  };
}

const readStored = (store, slot) =>
  store.request('readonly', (records) => records.get(`${store.namespace}:${slot}`));

test('toolbar checkpoints follow actual native CSS commits and resume a fresh title before the save action', async (t) => {
  await loadNativeZlib();
  const environment = startupEnvironment();
  t.after(() => environment.restore());
  const disk = transactionalSaves(),
    first = owner(disk, 'source-one'),
    name = 'saves/save0042.dat';
  assert.equal(await first.host.quickLoad(), 1, 'the original Script fallback remains available');
  assert.deepEqual(first.calls.packets.pop(), [91, 0xffff0003, 0, 22]);
  first.storyState.phase = 'story';
  await CatSystem2.prototype.step.call(first.engine);
  assert.equal(first.calls.snapshots, 0);
  assert.deepEqual(await Promise.all([first.host.quickSave(), first.host.quickSave()]), [1, 0]);
  assert.equal(first.calls.snapshots, 1);
  assert.deepEqual(first.calls.packets, [[91, 0xffff0003, 0, 21]]);
  assert.equal(first.storyState.phase, 'saving');
  assert.equal(await first.nativeStorage.readToolbarQuickSave(first.saves), null);
  assert.equal((await first.writeCSS('save0099.dat', 9)).value, 1);
  assert.equal(await first.nativeStorage.readToolbarQuickSave(first.saves), null);
  assert.equal((await first.writeCSS('save0042.dat', 1, { id: 3 })).value, 1);
  assert.equal(
    await first.nativeStorage.readToolbarQuickSave(first.saves),
    null,
    'a reused owner ID is not the same writer',
  );
  assert.equal((await first.writeCSS('save0042.dat', 2)).value, 1);

  const committed = await readStored(first.nativeStorage.store, name),
    title = owner(disk, 'source-one', { story: false }),
    unrelated = owner(disk, 'source-two', { story: false });
  assert.equal(
    first.storyState.phase,
    'saving',
    'the actual CSS commit can precede save notifications',
  );
  assert.equal((await NativeGlobalFile.fromFile(committed.data.bytes)).read(10)[0], 2);
  assert.equal(await title.host.systemAction(22), 0, 'nested title parent has no Script receiver');
  const priorReads = disk.readTransactions.length;
  await title.host.quickLoad();
  assert.deepEqual(disk.readTransactions.slice(priorReads), [
    ['source-one:toolbar-quick-save', 'source-one:native-files:saves/save0042.dat'],
  ]);
  assert.equal(title.calls.restored[0].world.phase, 'story');
  assert.equal(title.calls.restored[0].world.message, 'First saved dialogue');
  assert.equal(title.calls.snapshots, 0);
  assert.equal(await unrelated.host.quickLoad(), 0);
  assert.deepEqual(unrelated.calls.restored, []);
  title.nativeStorage.close();
  title.saves.close();
  assert.deepEqual(await readStored(first.nativeStorage.store, name), committed);

  first.storyState.phase = 'story';
  first.storyState.message = 'Second saved dialogue';
  first.reader.line++;
  assert.equal(await first.host.quickSave(), 1);
  disk.failNextWrite = first.nativeStorage.store.namespace + ':' + name;
  assert.equal((await first.writeCSS('save0042.dat', 3)).value, 0);
  const afterFailure = owner(disk, 'source-one', { story: false });
  await afterFailure.host.quickLoad();
  assert.equal(afterFailure.calls.restored[0].world.message, 'First saved dialogue');
  assert.deepEqual(await readStored(first.nativeStorage.store, name), committed);

  first.storyState.phase = 'story';
  assert.equal(await first.host.quickSave(), 1);
  disk.throwNextWrite = first.nativeStorage.store.namespace + ':' + name;
  assert.equal((await first.writeCSS('save0042.dat', 3)).value, 0);
  await afterFailure.host.quickLoad();
  assert.equal(afterFailure.calls.restored[1].world.message, 'First saved dialogue');
  assert.deepEqual(await readStored(first.nativeStorage.store, name), committed);

  first.storyState.phase = 'story';
  assert.equal(await first.host.quickSave(), 1);
  assert.equal((await first.writeCSS('save0042.dat', 4)).value, 1);
  await afterFailure.host.quickLoad();
  assert.equal(afterFailure.calls.restored[2].world.message, 'Second saved dialogue');
  assert.notEqual(
    (await readStored(first.nativeStorage.store, name)).data.quickSaveRevision,
    committed.data.quickSaveRevision,
  );
  assert.equal(await first.nativeStorage.write(name, committed.data.bytes), true);
  assert.equal(
    await afterFailure.host.quickLoad(),
    0,
    'a regular native overwrite invalidates the old companion',
  );
  assert.equal(afterFailure.calls.restored.length, 3);
});

test('a native save from an advanced story does not get the earlier toolbar checkpoint', async (t) => {
  const environment = startupEnvironment();
  t.after(() => environment.restore());
  const disk = transactionalSaves(),
    first = owner(disk, 'source-one');
  assert.equal(await first.host.quickSave(), 1);
  first.reader.line++;
  assert.equal((await first.writeCSS('save0042.dat', 5)).value, 1);
  assert.equal(await first.nativeStorage.readToolbarQuickSave(first.saves), null);
  assert.equal(first.nativeStorage.toolbarQuickSavePending, false);
  assert.equal(first.calls.snapshots, 1);
});

test('explicit scene resources can use a visible text generation from the receiving Script', async (t) => {
  const environment = startupEnvironment();
  t.after(() => environment.restore());
  await t.test('retains the unchanged visible text through the CSS commit', async () => {
    const first = owner(transactionalSaves(), 'source-one', { implicitReader: false });
    assert.equal(await first.host.quickSave(), 1);
    assert.equal(first.calls.snapshots, 1);
    assert.equal((await first.writeCSS('save0042.dat', 1)).value, 1);
    assert.ok(await first.nativeStorage.readToolbarQuickSave(first.saves));
  });
  await t.test('does not capture a text writer from another Script', async () => {
    const first = owner(transactionalSaves(), 'source-one', {
      implicitReader: false,
      textOwner: 48,
    });
    assert.equal(await first.host.quickSave(), 1);
    assert.equal(first.calls.snapshots, 0);
    assert.equal((await first.writeCSS('save0042.dat', 1)).value, 1);
    assert.equal(await first.nativeStorage.readToolbarQuickSave(first.saves), null);
  });
  for (const [name, change] of [
    [
      'replacement',
      ({ text }) => {
        text.sourceEvents = structuredClone(text.sourceEvents);
      },
    ],
    ['append', ({ text }) => text.sourceEvents.push({ kind: 'mark' })],
    [
      'clear',
      ({ text }) => {
        text.sourceEvents = [];
      },
    ],
    [
      'release',
      ({ textRecord }) => {
        textRecord.state = 'releasing';
      },
    ],
  ]) {
    await t.test(`rejects the earlier checkpoint after text ${name}`, async () => {
      const first = owner(transactionalSaves(), 'source-one', { implicitReader: false });
      assert.equal(await first.host.quickSave(), 1);
      change(first);
      assert.equal((await first.writeCSS('save0042.dat', 1)).value, 1);
      assert.equal(await first.nativeStorage.readToolbarQuickSave(first.saves), null);
    });
  }
});
