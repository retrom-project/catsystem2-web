// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-mapped-argv-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  for (const group of build.groups)
    test(`${build.version} Scene ${group.kind} fixed mapped argv and output aliases retain complete Main frames and cold`, async () => {
      const files = {
        'startup.xml': new TextEncoder().encode(group.xml),
        'loose-scene/fixture.cst': Buffer.from(build.input.file, 'base64'),
      };
      if (group.selection)
        files['loose-config/selector.xml'] = new TextEncoder().encode(group.selection);
      let world = await modernParticleMessageWorld(build.profile, files),
        caller = world.main;
      world.configuration.applyStartup(
        parseNativeXML(
          new TextEncoder().encode(group.xml),
          build.version === '74' ? 'Shift_JIS' : 'UTF-8',
        ),
      );
      const pointers = new Map();
      const normalize = (input) => {
        const bytes = new Uint8Array(input),
          v = new DataView(bytes.buffer);
        for (let at = 4100; at < 4150; at += 4) {
          const word = v.getUint32(at, true);
          if (pointers.has(word)) v.setUint32(at, pointers.get(word), true);
        }
        return bytes;
      };
      try {
        for (let i = 0; i < group.rows.length; i++) {
          const row = group.rows[i],
            label = group.cases[i].label;
          let reply;
          const machine = (caller.machine = new KCSMachine(
            await readKCS(
              kcsProgram([
                [43, row.id, row.declaredCount * 4],
                ...Array.from({ length: 22 }, () => [59]),
              ]),
            ),
            {
              native: (id, args, vm) => {
                const value = world.runtime.scheduler.native(caller, id, args, vm);
                return value && typeof value.then === 'function'
                  ? value.then((result) => (reply = result))
                  : (reply = value);
              },
            },
            world.runtime.scheduler.shared,
          ));
          machine.memory.set(normalize(Buffer.from(row.beforeLocal, 'base64')));
          machine.store(4096, 0xa17a29c5);
          row.args.forEach((word, n) => machine.store(4100 + n * 4, pointers.get(word) ?? word));
          machine.sp = 4100 + row.declaredCount * 4;
          caller.status = 'ready';
          caller.io = null;
          caller.waiting = null;
          await world.runtime.scheduler.execute(caller);
          if ([323, 379].includes(row.id)) pointers.set(row.result, machine.load(4100));
          assert.equal(reply.control, row.control, label + ' control');
          assert.deepEqual(
            machine.memory,
            normalize(Buffer.from(row.local, 'base64')),
            label + ' complete Main memory',
          );
          for (const key of ['pc', 'sp', 'fp'])
            assert.equal(machine[key], row[key], label + ' ' + key);
          if (
            [
              'short-expansion-overwrites-own-address-word',
              'cursor-text-ignores-tail',
              'checkpoint-short-output-address-alias',
            ].includes(label)
          ) {
            const memory = machine.memory.slice(),
              snapshot = world.snapshot(),
              state = await deserializeCheckpoint(await serializeCheckpoint(snapshot));
            await world.close({ flushFiles: false });
            world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
            await world.restore(state);
            caller = world.main;
            assert.deepEqual(caller.machine.memory, memory, label + ' cold VM');
            assert.deepEqual(world.snapshot(), snapshot, label + ' all cold state');
          }
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    });

for (const build of golden.builds)
  test(`${build.version} Scene mapped argv still diagnoses an actually unmapped required word`, async () => {
    const world = await modernParticleMessageWorld(build.profile),
      caller = world.main;
    try {
      const create = (caller.machine = new KCSMachine(
        await readKCS(kcsProgram([[43, 323, 0], [59]])),
        { native: (id, args, vm) => world.runtime.scheduler.native(caller, id, args, vm) },
        world.runtime.scheduler.shared,
      ));
      create.sp = 4100;
      await world.runtime.scheduler.execute(caller);
      const scene = create.load(4100),
        machine = (caller.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, 326, 0], [59]])),
          { native: (id, args, vm) => world.runtime.scheduler.native(caller, id, args, vm) },
          world.runtime.scheduler.shared,
        ));
      machine.sp = machine.memory.length - 4;
      machine.store(machine.sp, scene);
      caller.status = 'ready';
      caller.io = null;
      caller.waiting = null;
      await assert.rejects(world.runtime.scheduler.execute(caller), /KCS memory 2000\+4/);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
