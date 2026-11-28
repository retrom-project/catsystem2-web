// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-scene-css-owner.json', import.meta.url)),
);
const bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const inputs = Object.fromEntries(golden.inputs.map((r) => [r.name, bytes(r.data)]));

function controlledStorage(saved) {
  return {
    read: async (name) => saved.get(name)?.slice() ?? null,
    write: async (name, data) => {
      saved.set(name, data.slice());
      return true;
    },
  };
}
function open(storage, initialize = true) {
  return modernParticleMessageWorld(golden.profile, inputs, {
    startup: parseXML(golden.startup),
    storage,
    initialize,
  });
}
function compare(task, row) {
  const p = golden.projections[row.kind];
  assert.deepEqual(
    p.outputs.map((at) => task.machine.load(at)),
    row.words,
    row.label,
  );
  assert.deepEqual(
    p.spans.map(({ at, size }) => Buffer.from(task.machine.bytes(at, size)).toString('base64')),
    row.spans,
    'original defined strings, values and caller canaries',
  );
}

for (const coldAt of [null, 0, 1])
  test(`own74 parsed writer and distinct reader retain normal CSS owners${coldAt === null ? '' : ` with cold after writer${coldAt}`}`, async () => {
    const saved = new Map(),
      storage = controlledStorage(saved);
    let world = await open(storage);
    try {
      for (const kind of ['writer', 'reader']) {
        let task = await world.spawnScript(kind + '.kcs', { initialExecute: false });
        for (const row of golden.rows.filter((r) => r.kind === kind)) {
          await world.objects.update(task.id, row.index);
          compare(task, row);
          if (kind === 'writer' && row.index === coldAt) {
            const id = task.id;
            const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await open(storage, false);
            await world.restore(state);
            task = world.runtime.scheduler.tasks.get(id);
            compare(task, row);
          }
        }
        assert.equal(
          task.machine.load(344),
          0x4dc55001,
          'actual Script reaches its final consumer',
        );
      }
      const actual = await NativeGlobalFile.fromFile(saved.get(golden.canonicalFile));
      const native = await NativeGlobalFile.fromFile(bytes(golden.nativeFile));
      assert.equal(actual.tag, native.tag);
      assert.deepEqual(
        actual.records.map((r) => [r.id, r.bytes.length]),
        native.records.map((r) => [r.id, r.bytes.length]),
      );
      for (const id of [11, 12]) assert.deepEqual(actual.read(id), native.read(id));
      assert.deepEqual(actual.read(13).subarray(0, -8), native.read(13).subarray(0, -8));
      const nested = NativeGlobalFile.fromRaw(actual.read(14));
      assert.equal(nested.tag, 29);
      assert.deepEqual([...nested.read(21)], [17, 3, 91, 255, 0, 7, 41, 18, 202, 5, 89]);
      for (const id of [31, 32]) {
        const current = actual.read(id),
          original = native.read(id);
        const nul = original.indexOf(0, 4);
        assert(nul >= 4 && nul < 36);
        assert.deepEqual(current.subarray(0, nul + 1), original.subarray(0, nul + 1));
        assert.deepEqual(current.subarray(36), original.subarray(36));
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

test('own74 original CSS alone feeds a fresh parsed reader and keeps source bytes unchanged', async () => {
  const saved = new Map([[golden.canonicalFile, bytes(golden.nativeFile)]]);
  const world = await open(controlledStorage(saved));
  try {
    const task = await world.spawnScript('reader.kcs', { initialExecute: false });
    for (const row of golden.rows.filter((r) => r.kind === 'reader')) {
      await world.objects.update(task.id, row.index);
      compare(task, row);
    }
    assert.deepEqual(saved.get(golden.canonicalFile), bytes(golden.nativeFile));
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close({ flushFiles: false });
  }
});
