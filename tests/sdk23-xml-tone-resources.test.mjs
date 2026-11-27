// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const group of ['x1', 'x2']) {
  const golden = JSON.parse(
    await readFile(new URL(`./fixtures/sdk23-xml-tone-${group}-golden.json`, import.meta.url)),
  );
  for (const coldAt of [null, ...golden.coldAt])
    test(`SDK23 ${group} typed resource consumers ${coldAt === null ? 'normal lifetime' : `independent cold${coldAt}`}`, async () => {
      const reads = [],
        sources = [],
        open = async (initialize) => {
          const world = await modernParticleMessageWorld(
              golden.profile,
              Object.fromEntries(golden.inputs.archives.map((r) => [r.name, bytes(r.data)])),
              {
                initialize,
                startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))),
              },
            ),
            read = world.game.read;
          world.game.read = async (name) => {
            const data = await read(name);
            if (name.startsWith('metadata.int/')) {
              reads.push(name);
              sources.push(data);
            }
            return data;
          };
          return world;
        };
      let world = await open(true),
        caller = await world.spawnScript(golden.script, { initialExecute: false }),
        originalReads;
      const compare = (row) => {
        const m = caller.machine;
        assert.deepEqual(
          Array.from({ length: golden.outputWords }, (_, i) => m.load(128 + i * 4)),
          row.outputs,
          row.label,
        );
        for (const span of row.spans)
          assert.deepEqual([...m.bytes(span.at, span.bytes.length)], span.bytes, row.label);
        const targetOwners = [...world.runtime.handles.records.values()]
          .filter((r) => ['xml', 'character-names'].includes(r.type))
          .map((r) => r.type);
        assert.deepEqual(targetOwners, golden.liveTargetOwners[row.phase].types);
        if (row.phase === 0) {
          const first = m.load(64),
            second = m.load(68),
            type = group === 'x1' ? 'xml' : 'character-names';
          assert.notEqual(first, second);
          assert.notEqual(
            world.runtime.handles.get(first, type),
            world.runtime.handles.get(second, type),
          );
        }
      };
      try {
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        const floor = caller.machine.sp;
        for (const row of golden.rows) {
          await world.objects.update(caller.id, 500 + row.phase);
          assert.equal(caller.machine.sp, floor + 4, 'real VM consumes every result');
          assert.equal(caller.machine.load(floor), golden.marker);
          compare(row);
          if (row.phase === 0) {
            assert.equal(reads.length, 2, 'both typed owners came from real mounted resources');
            originalReads = reads.length;
            for (const source of sources) source.fill(0);
          } else
            assert.equal(reads.length, originalReads, 'later consumers use owned parsed state');
          if (row.phase === coldAt) {
            const id = caller.id,
              state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await open(false);
            await world.restore(state);
            caller = world.runtime.scheduler.tasks.get(id);
            compare(row);
            assert.equal(reads.length, originalReads, 'cold restore does not reopen parsed owners');
          }
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}
