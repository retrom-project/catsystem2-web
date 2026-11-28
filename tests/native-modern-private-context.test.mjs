// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/native-modern-private-context.json', import.meta.url)));
for (const b of fixture.builds) for (const cold of [false, true])
  test(`own${b.version} parsed child registration owns private context${cold ? ' across independent cold' : ''}`, async () => {
    const inputs = Object.fromEntries(b.inputs.map(r => [r.name, new Uint8Array(Buffer.from(r.data, 'base64'))]));
    const open = initialize => modernParticleMessageWorld(b.profile, inputs, {startup: parseXML(b.startup), initialize});
    let world = await open(true);
    try {
      const parent = await world.spawnScript('parent.kcs', {initialExecute:false});
      await world.objects.update(parent.id, 0);
      const ids = [parent.machine.load(64), ...(b.children === 2 ? [parent.machine.load(68)] : [])];
      assert.equal(new Set(ids).size, b.children);
      for (const frame of [0, 1]) {
        for (const [child, id] of ids.entries()) {
          const task = world.runtime.scheduler.tasks.get(id);
          await world.objects.update(id, frame);
          const row = b.rows.find(r => r.child === child && r.frame === frame);
          assert.deepEqual(Array.from({length:23}, (_, i) => task.machine.load(256+i*4)), row.words);
          if (frame === 1) assert.equal(task.machine.load(344), b.marker);
        }
        if (cold && frame === 0) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({flushFiles:false});
          world = await open(false);
          await world.restore(state);
        }
      }
      assert.equal(world.nativeEngine, undefined);
    } finally { await world.close({flushFiles:false}); }
  });
