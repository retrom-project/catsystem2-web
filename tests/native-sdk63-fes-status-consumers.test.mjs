// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const f = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk63-fes-status-consumers.json', import.meta.url)),
);
for (const cold of [null, ...f.cold])
  test(`SDK63 parsed FES surface/context/exit state${cold === null ? '' : ' cold ' + cold}`, async () => {
    const input = Object.fromEntries(
      f.inputs.map(({ name, bytes }) => [name, Uint8Array.from(Buffer.from(bytes, 'base64'))]),
    );
    const open = async (initialize) => {
      const w = await modernParticleMessageWorld(f.profile, input, {
        initialize,
        startup: parseXML(new TextDecoder().decode(input['startup.xml'])),
      });
      w.graphics.createLogicalDevice();
      return w;
    };
    let w = await open(true),
      owner = await w.spawnScript('status-owner', { initialExecute: false }),
      phase = 0;
    async function compare() {
      const row = f.rows[phase],
        record = w.objects.objects.get(owner.id);
      assert.equal(Boolean(record), row.alive);
      if (!record) return;
      assert.deepEqual(
        Array.from({ length: 21 }, (_, i) => owner.machine.load(160 + i * 4)),
        row.words,
      );
      assert.deepEqual([...owner.machine.bytes(1536, 32)], row.contextOut);
      assert.equal(record.context.contextName, '共有');
      assert.equal(record.exitCode, 37);
      const fes = w.objects.objects.get(w.resolveTaskID(owner.machine.load(44), owner.id));
      assert.equal(Boolean(fes), phase < 3);
      if (fes) {
        assert.equal(
          fes.implementation.surface,
          w.resolveTaskID(owner.machine.load(52), owner.id),
          'surface follows the actual replacement Draw owner',
        );
        assert.equal(fes.implementation.player.root.resultValue, 1);
        assert.equal(fes.implementation.runEnabled, true);
      }
    }
    try {
      await w.sendEngine(owner.id, owner.id, 26, 0, 1024, { payload: owner.machine });
      for (phase = 0; phase < 5; phase++) {
        if ([1, 2].includes(phase))
          assert.equal(
            (
              await w.runtime.native(
                'main',
                70,
                [w.nativeTaskID(owner.id), f.tag, phase, 0],
                owner.machine,
                owner,
              )
            ).value,
            1,
          );
        if (phase === 4)
          await w.runtime.native('main', 67, [w.nativeTaskID(owner.id)], owner.machine, owner);
        await w.objects.update(w.root, 700 + phase);
        await compare();
        if (phase === cold) {
          const id = owner.id,
            snapshot = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
          await w.close({ flushFiles: false });
          w = await open(false);
          await w.restore(snapshot);
          owner = w.runtime.scheduler.tasks.get(id);
          await compare();
        }
      }
      assert.equal(w.graphics.drawTasks.size, 0);
    } finally {
      await w.close({ flushFiles: false });
    }
  });
