// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const group of ['g1', 'g2', 'g3']) {
  const golden = JSON.parse(
    await readFile(new URL(`./fixtures/sdk23-data-records-${group}-golden.json`, import.meta.url)),
  );
  for (const coldAt of [null, ...golden.coldAt, 'native-file'])
    test(`SDK23 ${group} real data owners ${coldAt === null ? 'normal chain' : coldAt === 'native-file' ? 'original CSS input' : `independent cold${coldAt}`}`, async () => {
      const saved = new Map(),
        native = new Map(golden.savedFiles.map((r) => [r.name, bytes(r.data)])),
        storage = {
          read: async (name) =>
            (coldAt === 'native-file' ? native : saved).get(name)?.slice() ?? null,
          write: async (name, data) => {
            saved.set(name, data.slice());
            return true;
          },
        },
        open = (initialize) =>
          modernParticleMessageWorld(
            golden.profile,
            Object.fromEntries(golden.inputs.archives.map((r) => [r.name, bytes(r.data)])),
            {
              initialize,
              startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))),
              storage,
            },
          );
      let world = await open(true),
        caller = await world.spawnScript(golden.script, { initialExecute: false });
      const compare = (row) => {
        const m = caller.machine;
        assert.deepEqual(
          Array.from({ length: golden.outputWords }, (_, i) => m.load(128 + i * 4)),
          row.outputs,
          row.label,
        );
        for (const span of row.spans)
          assert.deepEqual([...m.bytes(span.at, span.bytes.length)], span.bytes, row.label);
        for (const expected of row.files) {
          const [at] = golden.liveFiles[row.phase].find((r) => r[1] === expected.name),
            actual = world.runtime.handles.get(m.load(at), 'global-file');
          assert.equal(actual.used, expected.used);
          assert.equal(actual.tag, expected.tag);
          assert.equal(actual.capacity, expected.capacity);
          assert.deepEqual(actual.payload(), bytes(expected.payload));
        }
        for (const expected of row.stacks) {
          const [at] = golden.liveStacks[row.phase].find((r) => r[1] === expected.name),
            actual = world.runtime.handles.get(m.load(at), 'record-stack');
          for (const key of ['recordSize', 'count', 'increment', 'capacity'])
            assert.equal(actual[key], expected[key]);
          if (expected.data) assert.deepEqual([...actual.data], expected.data);
        }
        if (row.phase === golden.rows.length - 1)
          assert(
            ![...world.runtime.handles.records.values()].some((r) =>
              ['global-file', 'record-stack', 'cg-registration', 'display-log'].includes(r.type),
            ),
            'every explicit data owner was normally disposed',
          );
      };
      try {
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        const floor = caller.machine.sp;
        for (const row of golden.rows) {
          await world.objects.update(caller.id, 500 + row.phase);
          assert.equal(caller.machine.sp, floor + 4, 'all control1 values were consumed by the VM');
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
            original = await NativeGlobalFile.fromFile(bytes(expected.data), 0x80000);
          assert.equal(actual.tag, original.tag);
          assert.deepEqual(
            actual.payload(),
            original.payload(),
            'all defined native CSS entry bytes',
          );
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}
