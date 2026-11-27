// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { readKCS, KCSMachine } from '../src/kcs.mjs';
const bytes = (s) => Buffer.from(s, 'base64');
for (const group of ['prefix', 'qualified', 'consumer', 'sleep']) {
  const golden = JSON.parse(
    await readFile(
      new URL(`./fixtures/sdk23-task-context-tm2-${group}-golden.json`, import.meta.url),
    ),
  );
  for (const coldAt of [
    null,
    ...(['consumer', 'sleep'].includes(group) ? [0] : golden.rows.map((r) => r.frame)),
  ])
    test(`SDK23 ${group} typed context/recipient chain ${coldAt === null ? 'normal Root lifetime' : 'independent cold ' + coldAt}`, async () => {
      const name =
          group === 'prefix'
            ? 'task-context'
            : group === 'qualified'
              ? 'context-qualified'
              : group === 'consumer'
                ? 'metadata-consumer'
                : 'sleep-consumer',
        open = (initialize) =>
          modernParticleMessageWorld(
            golden.profile,
            {
              'startup.xml': bytes(golden.inputs.startup),
              'scripts.int': kif([
                ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
                [name + '.kcs', bytes(golden.inputs.program)],
              ]),
              'images.int': kif([]),
              'ptcl.int': kif([]),
              'scenes.int': kif([]),
              'fes.int': kif([['context-state.fes', Buffer.from(golden.inputs.source)]]),
            },
            {
              initialize,
              startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))),
            },
          );
      let world = await open(true),
        caller;
      const compare = (row) => {
        if (group === 'sleep' && row.private0 !== null)
          assert.equal(
            caller.machine.load(160),
            row.private0,
            'own23 sleep/wake masks resources without firing modern named callbacks',
          );
        assert.equal(caller.machine.pc, row.pc, row.label + ' actual VM PC');
        assert.deepEqual(
          Array.from({ length: 6 }, (_, i) => caller.machine.load(128 + i * 4)),
          row.words,
          row.label + ' initialized replies',
        );
        assert.deepEqual(
          [...caller.machine.bytes(512, 32)],
          row.expanded,
          row.label + ' CP932 owned bytes',
        );
        assert.equal(world.objects.objects.get(caller.id).exitCode, row.frame >= 1 ? 37 : -1);
      };
      try {
        const parent = await world.objects.create({
          kind: 12,
          parent: world.root,
          name: 'unloaded bootstrap',
        });
        caller = await world.spawnScript(name, { parent });
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        for (const row of golden.rows) {
          await world.objects.update(world.root, 700 + row.frame);
          compare(row);
          if (row.frame === coldAt) {
            const id = caller.id,
              state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await open(false);
            await world.restore(state);
            caller = world.runtime.scheduler.tasks.get(id);
            compare(row);
          }
        }
        if (group !== 'prefix') {
          assert.equal(
            [...world.objects.objects.values()].filter((r) => [15, 34].includes(r.kind)).length,
            0,
            'actual FES/retained recipients have retired before supplier cleanup',
          );
          assert.equal(
            caller.machine.load(144),
            group === 'qualified' ? 23 : 9,
            'normal later FES decoder consumed ALT',
          );
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}

// Own67 44b160 and ee6-76 62e1b0 explicitly invoke these named callbacks.
// This current-VM contrast preserves that established modern branch; its
// original evidence is static, separate from the SDK23 dynamic golden.
for (const [profile, notifies, handled] of [
  ['rebellions-jp-engine-2.6.1.63', false, true],
  ['bokutomo-engine-2.6.1.67', true, true],
  ['nekopara-vol3-engine-2.6.1.76', true, false],
])
  test(`${profile} retains its FES sleep callback/control difference through current cold`, async () => {
    const golden = JSON.parse(
        await readFile(
          new URL('./fixtures/sdk23-task-context-tm2-sleep-golden.json', import.meta.url),
        ),
      ),
      original = bytes(golden.inputs.program),
      decoder = new KCSMachine(await readKCS(original), {}),
      instructions = [];
    const shutdownBranches = [];
    for (let pc = 0; pc < decoder.script.codeSize; ) {
      const i = decoder.instruction(pc);
      pc += i.size;
      if (profile === 'rebellions-jp-engine-2.6.1.63' && i.op === 43 && i.args[0].value === 65) {
        const stop = [40, 0];
        shutdownBranches.push(stop);
        instructions.push([37, 1536], [43, 71, 4], stop);
      } else instructions.push([i.op, ...i.args.map((a) => [a.mode, a.value])]);
    }
    const haltAt = instructions.slice(0, -1).reduce((pc, i) => pc + 1 + 5 * (i.length - 1), 0);
    for (const branch of shutdownBranches) branch[1] = haltAt;
    // Main65 remains protected on63. A normal owned wait/idle carrier replaces
    // that unavailable entry in this current-only contrast, never in raw evidence.
    // Its actual teardown packet halts the test Script instead of continuing
    // feature calls while its parent is releasing; idle0 advances normally.
    const program =
        profile === 'rebellions-jp-engine-2.6.1.63' ? kcsProgram(instructions) : original,
      open = (initialize) =>
        modernParticleMessageWorld(
          profile,
          {
            'startup.xml': bytes(golden.inputs.startup),
            'scripts.int': kif([
              ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
              ['sleep-consumer.kcs', program],
            ]),
            'images.int': kif([]),
            'ptcl.int': kif([]),
            'scenes.int': kif([]),
            'fes.int': kif([['context-state.fes', Buffer.from(golden.inputs.source)]]),
          },
          { initialize, startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))) },
        );
    let world = await open(true),
      caller;
    try {
      const parent = await world.objects.create({
        kind: 12,
        parent: world.root,
        name: 'unloaded bootstrap',
      });
      caller = await world.spawnScript('sleep-consumer', { parent });
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      await world.objects.update(world.root, 700);
      const fesID = world.resolveTaskID(caller.machine.load(80), caller.id),
        reply = await world.engineMessages.dispatch(fesID, caller.id, 342, 0, 0);
      assert.equal(reply.handled, handled, 'own original unchanged-value receiver return');
      assert.equal(reply.result, NATIVE_UNWRITTEN_WORD, 'transport result scratch stays unwritten');
      const id = caller.id,
        state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await open(false);
      await world.restore(state);
      caller = world.runtime.scheduler.tasks.get(id);
      await world.objects.update(world.root, 701);
      assert.equal(
        caller.machine.load(160),
        notifies ? 222 : 0,
        'own original named callback behavior remains observable',
      );
      await world.objects.update(world.root, 702);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
