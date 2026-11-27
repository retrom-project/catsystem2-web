// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const group of ['g1', 'g2', 'g3']) {
  const golden = JSON.parse(
    await readFile(new URL(`./fixtures/sdk23-string-data-${group}-golden.json`, import.meta.url)),
  );
  for (const coldAt of [null, ...golden.coldAt])
    test(`SDK23 ${group} loaded string data consumers ${coldAt === null ? 'normal lifetime' : `across cold${coldAt}`}`, async () => {
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
        for (const child of row.children ?? []) {
          const id = world.resolveTaskID(m.load(child.slot), caller.id),
            task = world.runtime.scheduler.tasks.get(id),
            bank = world.runtime.variableBank(task, false);
          assert.equal(world.objects.objects.get(id).parent, caller.id);
          assert.equal(task.context.variableBank, caller.context.variableBank);
          assert(bank.context(id), 'actual inherited Script load owns its private context');
          assert.deepEqual(
            Array.from({ length: golden.childOutputWords }, (_, i) =>
              task.machine.load(128 + i * 4),
            ),
            child.outputs,
            row.label,
          );
          for (const span of child.spans)
            assert.deepEqual(
              [...task.machine.bytes(span.at, span.bytes.length)],
              span.bytes,
              row.label,
            );
        }
        if (group === 'g3') {
          const bank = world.runtime.variableBank(caller, false);
          assert.equal(bank.contexts.size, [2, 2, 2, 2, 1, 1, 0][row.phase]);
          if (row.phase === golden.rows.length - 1) {
            assert.equal(bank.get(2), 19, 'the supplier retains the restored global value');
            assert.equal(
              bank.selectedContext,
              null,
              'retiring the last private owner clears selection',
            );
          }
        }
        for (const span of row.spans)
          assert.deepEqual([...m.bytes(span.at, span.bytes.length)], span.bytes, row.label);
      };
      try {
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        const floor = caller.machine.sp;
        for (const row of golden.rows) {
          await world.objects.update(caller.id, 500 + row.phase);
          assert.equal(caller.machine.sp, floor + 4, 'the VM consumes every control1 result');
          assert.equal(caller.machine.load(floor), golden.marker, 'authored stack marker');
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
        assert(
          ![...world.runtime.handles.records.values()].some((r) => r.type === 'dictionary'),
          'normal release retires every explicit dictionary owner',
        );
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}
