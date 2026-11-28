// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-fes-bank-lifecycle.json', import.meta.url)),
);
const files = {
  'case.kcs': kcsProgram([[43, 65, 0], [59]]),
  'bank-case.kcs': kcsProgram(golden.instructions),
  ...Object.fromEntries(
    Object.entries(golden.sources).map(([name, text]) => [name, new TextEncoder().encode(text)]),
  ),
};

async function open() {
  const world = await dataWorld(golden.profile, files);
  // Match the qualified bootstrap: initialize the owned bank before Main143
  // parses its feature program. All targets below use that loaded KCS VM.
  await world.runtime.native('main', 209, [512], world.main.machine, world.main);
  world.main.machine.writeString('bank-case.kcs', 800);
  await world.runtime.native(
    'main',
    143,
    [world.nativeTaskID(world.main.id), 800, 0],
    world.main.machine,
    world.main,
  );
  return world;
}

for (const coldAt of [null, 3, 6, 8]) {
  test(`SDK23 two FES owners match original VM frames${coldAt === null ? '' : ` across independent cold after ${golden.rows[coldAt].label}`}`, async () => {
    let world = await open();
    try {
      for (const [index, row] of golden.rows.entries()) {
        if (row.drive === 'parent') await world.objects.tick(row.frame);
        else await world.runtime.scheduler.execute(world.main);
        const machine = world.main.machine,
          bank = world.runtime.variableBank(world.main);
        assert.equal(bank.context(world.main.id), null, 'own-bank caller has no inherited context');
        assert.deepEqual(
          Array.from({ length: 16 }, (_, word) => machine.load(96 + word * 4)),
          row.outputs,
          row.label,
        );
        for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row.vm[key], row.label);
        assert.equal(machine.load(row.vm.floor), 0x23464553, 'authored stack marker');
        const live = [];
        for (const slot of [32, 36]) {
          if (!index) continue;
          const nativeID = machine.load(slot),
            id = world.resolveTaskID(nativeID, world.main.id),
            record = world.objects.objects.get(id);
          if (!record) continue;
          assert.equal(record.kind, 34);
          live.push(slot);
          assert.equal(record.context.variableBank, world.main.context.variableBank);
          assert(bank.context(record.context.fesVariableContextKey));
          assert.equal(record.implementation.player.root.runtime.resources.entries.length, 0);
        }
        assert.deepEqual(live, row.liveSlots, 'normal retirement keeps the other instance alive');
        if (index === 4) {
          assert.equal(machine.load(112), 0x22222222, 'absent caller copy preserves B first word');
          assert.equal(machine.load(116), 0, 'absent caller copy preserves B last word');
        }
        if (index === 6) assert.equal(machine.load(128), 0, 'rebuilt private words start fresh');
        if (index === 7) {
          assert.equal(machine.load(136), 43, 'replacement START executes');
          assert.equal(machine.load(140), 0, 'rebuilt named defaults start fresh');
        }
        if (index === coldAt) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await dataWorld(golden.profile, files, { initialize: false });
          await world.restore(state);
          assert.equal(world.main, world.runtime.scheduler.tasks.get(world.main.id));
        }
      }
      const bank = world.runtime.variableBank(world.main);
      assert.equal(bank.contexts.size, 0, 'both FES contexts retire while supplier remains');
      assert(world.runtime.handles.records.has(world.main.context.variableBank));
      await world.close({ flushFiles: false });
      assert.equal(world.runtime.handles.records.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
