// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-global-css-data-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));

function records(file) {
  return file.records.map(({ id, bytes: source }) => {
    const data = source.slice();
    // The native raw header contains an ignored process pointer, and its string
    // serializer reports eight trailing bytes which it never writes.
    if (id === 14) data.fill(0, 0, 4);
    if (id === 13) data.fill(0, data.length - 8);
    return { id, bytes: data };
  });
}

for (const coldAt of [null, 0, 1, 2, 3])
  test(`SDK23 loaded global CSS variables/strings/nested owner${coldAt === null ? '' : ` independent cold${coldAt}`}`, async () => {
    const saved = new Map(),
      storage = {
        read: async (name) => saved.get(name)?.slice() ?? null,
        write: async (name, data) => {
          saved.set(name, data.slice());
          return true;
        },
      },
      open = (initialize) =>
        modernParticleMessageWorld(
          golden.profile,
          Object.fromEntries(golden.inputs.archives.map((row) => [row.name, bytes(row.data)])),
          {
            initialize,
            startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))),
            storage,
          },
        );
    let world = await open(true),
      caller = await world.spawnScript('global-g1', { initialExecute: false });
    const compare = (row) => {
      const machine = caller.machine;
      assert.deepEqual(
        Array.from({ length: 31 }, (_, i) => machine.load(128 + 4 * i)),
        row.outputs,
        row.label,
      );
      for (const span of row.spans)
        assert.deepEqual(
          [...machine.bytes(span.at - 4, 32)],
          span.bytes,
          'copied bytes and canaries',
        );
      for (const expected of row.containers) {
        const at = { parent: 64, child: 68, reader: 72, nested: 76 }[expected.name],
          actual = world.runtime.handles.get(machine.load(at), 'global-file'),
          native = NativeGlobalFile.fromPayload(
            bytes(expected.payload),
            expected.tag,
            expected.capacity,
            0x80000,
          );
        assert.equal(actual.used, expected.used);
        assert.equal(actual.capacity, expected.capacity);
        assert.equal(actual.tag, expected.tag);
        assert.deepEqual(records(actual), records(native));
      }
      if (row.phase === 3)
        assert(![...world.runtime.handles.records.values()].some((r) => r.type === 'global-file'));
    };
    try {
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      for (const row of golden.rows) {
        await world.objects.update(caller.id, 300 + row.phase);
        compare(row);
        if (row.phase === coldAt) {
          const id = caller.id,
            state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(state);
          caller = world.runtime.scheduler.tasks.get(id);
          compare(row);
        }
      }
      for (const expected of golden.savedFiles) {
        const actual = await NativeGlobalFile.fromFile(saved.get(expected.name), 0x80000),
          native = await NativeGlobalFile.fromFile(bytes(expected.data), 0x80000);
        assert.equal(actual.tag, native.tag);
        assert.deepEqual(records(actual), records(native));
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

test('SDK23 original CSS writer bytes feed the loaded VM reader after source owners release', async () => {
  const native = new Map(golden.savedFiles.map((row) => [row.name, bytes(row.data)])),
    written = new Map(),
    world = await modernParticleMessageWorld(
      golden.profile,
      Object.fromEntries(golden.inputs.archives.map((row) => [row.name, bytes(row.data)])),
      {
        startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))),
        storage: {
          read: async (name) => native.get(name)?.slice() ?? null,
          write: async (name, data) => {
            written.set(name, data.slice());
            return true;
          },
        },
      },
    );
  try {
    const caller = await world.spawnScript('global-g1', { initialExecute: false });
    await world.runtime.native('main', 209, [512], caller.machine, caller);
    for (const row of golden.rows) {
      await world.objects.update(caller.id, 300 + row.phase);
      assert.deepEqual(
        Array.from({ length: 31 }, (_, i) => caller.machine.load(128 + i * 4)),
        row.outputs,
      );
      for (const span of row.spans)
        assert.deepEqual([...caller.machine.bytes(span.at - 4, 32)], span.bytes);
    }
    assert.equal(written.size, 2);
  } finally {
    await world.close({ flushFiles: false });
  }
});
