// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const group of ['a1', 'a2', 'a3']) {
  const golden = JSON.parse(
    await readFile(
      new URL(`./fixtures/sdk23-numeric-memory-${group}-golden.json`, import.meta.url),
    ),
  );
  for (const coldAt of [null, ...golden.coldAt])
    test(`SDK23 ${group} numeric/byte consumers ${coldAt === null ? 'normal lifetime' : `independent cold${coldAt}`}`, async () => {
      const open = (initialize) =>
        modernParticleMessageWorld(
          golden.profile,
          Object.fromEntries(golden.inputs.archives.map((r) => [r.name, bytes(r.data)])),
          { initialize, startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))) },
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
      };
      try {
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        const floor = caller.machine.sp;
        for (const row of golden.rows) {
          await world.objects.update(caller.id, 500 + row.phase);
          assert.equal(caller.machine.sp, floor + 4, 'all results are consumed by real VM stores');
          assert.equal(caller.machine.load(floor), golden.marker);
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
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}

// A native helper's physical-NULL shortcut is not evidence for an arbitrary
// nonzero VM address. Both mapped builds retain the VM range guard.
for (const profile of ['grisaia-jp-engine-2.6.1.23', 'bokutomo-engine-2.6.1.67'])
  for (const side of ['source', 'destination'])
    test(`${profile} copy rejects an unknown nonzero ${side} span before writing`, async () => {
      const { dataWorld } = await import('./fixtures/data-world.mjs');
      const { kcsProgram } = await import('./helpers.mjs');
      const program = kcsProgram([
          [37, 0x23a5a5a5],
          [37, side === 'destination' ? 0x7fffffff : 512],
          [37, side === 'source' ? 0x7fffffff : 512],
          [37, 4],
          [43, 35, 12],
          [59],
        ]),
        world = await dataWorld(profile, { 'copy-guard.kcs': program });
      try {
        const task = await world.spawnScript('copy-guard.kcs', { initialExecute: false }),
          m = task.machine,
          floor = m.sp;
        m.bytes(512, 8).fill(0xa5);
        await assert.rejects(() => world.runtime.scheduler.execute(task), /memory|address/i);
        assert.deepEqual([...m.bytes(512, 8)], new Array(8).fill(0xa5));
        assert.equal(m.load(floor), 0x23a5a5a5);
      } finally {
        await world.close({ flushFiles: false });
      }
    });
