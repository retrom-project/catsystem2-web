// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-task-context-tm3-golden.json', import.meta.url)),
  ),
  bytes = (s) => Buffer.from(s, 'base64');
for (const coldAt of [null, 0, 1, 3, 5])
  test(`SDK23 FES-created Script selected-context CSS ${coldAt === null ? 'normal consumer lifetime' : 'independent cold ' + coldAt}`, async () => {
    const open = (initialize) =>
      modernParticleMessageWorld(
        golden.profile,
        {
          'startup.xml': bytes(golden.inputs.startup),
          'scripts.int': kif([
            ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
            ['bank-producer.kcs', bytes(golden.inputs.program)],
            ['bank-worker.kcs', bytes(golden.inputs.worker)],
          ]),
          'images.int': kif([]),
          'ptcl.int': kif([]),
          'scenes.int': kif([]),
          'fes.int': kif([['bank-driver.fes', Buffer.from(golden.inputs.source)]]),
        },
        { initialize, startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))) },
      );
    let world = await open(true),
      producer;
    const compare = (row) => {
      assert.equal(producer.machine.pc, row.producerPC, row.label + ' producer PC');
      assert.deepEqual(
        Array.from({ length: 5 }, (_, i) => producer.machine.load(128 + 4 * i)),
        row.producerWords,
        row.label + ' actual global consumer',
      );
      const fesID = world.resolveTaskID(producer.machine.load(80), producer.id),
        fes = world.objects.objects.get(fesID),
        worker = [...world.objects.objects.values()].find(
          (r) => r.kind === 12 && r.parent === fesID,
        );
      assert.equal(Boolean(fes), row.fesAlive, 'normal FES collection');
      assert.equal(Boolean(worker), Boolean(row.worker), 'actual native execkcs child lifetime');
      if (!row.worker) return;
      const task = world.runtime.scheduler.tasks.get(worker.id),
        machine = task.machine,
        expected = new Map(row.worker.values.map((r) => [r.at, r.bits]));
      assert.equal(machine.pc, row.worker.pc, 'actual inherited parsed VM PC');
      for (const at of [16, 128, 132, 136, 140, 144, 148, 152, 156])
        assert.equal(machine.load(at), expected.get(at), row.label + ' initialized child ' + at);
      assert.equal(machine.load(64), world.nativeTaskID(worker.id));
      assert.equal(machine.load(68), world.nativeTaskID(fesID));
      assert.equal(
        worker.context.variableBank,
        producer.context.variableBank,
        'real parent message inherited the provider bank',
      );
      if (row.worker.file) {
        const file = world.runtime.handles.get(machine.load(72), 'global-file');
        assert.equal(file.capacity, row.worker.file.capacity);
        assert.equal(file.used, row.worker.file.used);
        assert.deepEqual(
          file.payload(),
          Uint8Array.from(bytes(row.worker.file.payload)),
          'complete initialized2048B private record and its header',
        );
      }
    };
    try {
      const parent = await world.objects.create({
        kind: 12,
        parent: world.root,
        name: 'unloaded bootstrap',
      });
      producer = await world.spawnScript('bank-producer', { parent });
      await world.runtime.native('main', 209, [512], producer.machine, producer);
      for (const row of golden.rows) {
        await world.objects.update(world.root, 900 + row.frame);
        compare(row);
        if (row.frame === coldAt) {
          const id = producer.id,
            state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(state);
          producer = world.runtime.scheduler.tasks.get(id);
          compare(row);
        }
      }
      assert.equal(
        [...world.runtime.handles.records.values()].filter((r) => r.type === 'global-file').length,
        0,
        'explicit CSS owner release survives child and FES retirement',
      );
    } finally {
      await world.close({ flushFiles: false });
    }
    assert.equal(
      world.runtime.handles.records.size,
      0,
      'final World releases the remaining provider banks',
    );
  });
