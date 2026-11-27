// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-task-message-tm1-golden.json', import.meta.url)),
  ),
  bytes = (s) => Buffer.from(s, 'base64');
for (const coldAt of [null, ...golden.coldAt])
  test(`SDK23 Task direct/queued parsed consumers ${coldAt === null ? 'normal Root lifetime' : 'independent cold ' + coldAt}`, async () => {
    const open = (initialize) =>
      modernParticleMessageWorld(
        golden.profile,
        {
          'startup.xml': bytes(golden.inputs.startup),
          'scripts.int': kif([
            ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
            ['message-owner.kcs', bytes(golden.inputs.producer)],
            ['message-child.kcs', bytes(golden.inputs.consumer)],
          ]),
          'images.int': kif([]),
          'ptcl.int': kif([]),
          'scenes.int': kif([]),
        },
        { initialize, startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))) },
      );
    let world = await open(true),
      caller,
      frame = -1;
    const oldReceive = KCSMachine.prototype.receiveMessage,
      received = [];
    KCSMachine.prototype.receiveMessage = function (words) {
      const task = [...world.runtime.scheduler.tasks.values()].find((t) => t.machine === this),
        accepted = oldReceive.call(this, words);
      if (task && frame >= 0 && frame < 9)
        received.push({ frame, pending: Number(accepted), incoming: [...words], owner: task.id });
      return accepted;
    };
    const values = (r) => new Map(r.values.map((v) => [v.at, v.bits]));
    const compare = (row) => {
      const actual = world.objects.objects.get(caller.id),
        m = caller.machine,
        old = values(row.parent),
        childNative = m.load(72);
      assert.equal(m.load(16), old.get(16));
      assert.equal(m.load(64), world.nativeTaskID(caller.id));
      assert.equal(m.load(68), world.nativeTaskID(actual.parent));
      assert.equal(m.pc, row.parent.pc, 'producer PC agrees with original yield/control');
      for (const at of [128, 132, 136, 140, 144, 148, 152, 156, 160])
        assert.equal(m.load(at), old.get(at), row.label + ' output ' + at);
      if (row.child) {
        const childID = world.resolveTaskID(childNative, caller.id),
          child = world.runtime.scheduler.tasks.get(childID),
          e = values(row.child);
        assert(child, 'actual loaded child remains present');
        assert.equal(child.machine.pc, row.child.pc);
        for (const at of [16, 80, 100, 104, 108, 244, 248, 252])
          assert.equal(child.machine.load(at), e.get(at), row.label + ' child ' + at);
        assert.equal(child.machine.load(64), childNative);
        assert.equal(child.machine.load(68), world.nativeTaskID(caller.id));
        for (const at of [96, 240]) {
          const original = e.get(at);
          assert.equal(
            child.machine.load(at),
            original === row.parent.nativeID ? world.nativeTaskID(caller.id) : original,
          );
        }
      }
    };
    try {
      const bootstrap = await world.objects.create({
        kind: 12,
        parent: world.root,
        name: 'unloaded parent',
      });
      caller = await world.spawnScript('message-owner', { parent: bootstrap });
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      for (const row of golden.frames) {
        frame = row.frame;
        await world.objects.update(world.root, 500 + frame);
        compare(row);
        if (frame === coldAt) {
          const callerID = caller.id,
            state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          frame = -1;
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(state);
          caller = world.runtime.scheduler.tasks.get(callerID);
          compare(row);
        }
      }
      const normalized = received.map((r) => ({
        frame: r.frame,
        pending: r.pending,
        incoming: r.incoming.map((n, i) =>
          i === 0 && n === world.nativeTaskID(caller.id) ? golden.frames[0].parent.nativeID : n,
        ),
      }));
      assert.deepEqual(
        normalized,
        golden.deliveries.map(({ result: _result, ...r }) => r),
        'native copy attempts, accepted/ignored status and FIFO order',
      );
      assert.equal(
        [...world.objects.objects.values()].filter((r) => r.name === 'message child').length,
        0,
        'both native requests retire their actual child at the next Root collection',
      );
    } finally {
      frame = -1;
      await world.close({ flushFiles: false });
      KCSMachine.prototype.receiveMessage = oldReceive;
    }
  });
