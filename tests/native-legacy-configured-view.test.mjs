// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

for (const version of ['63', '67']) {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-sdk' + version + '-configured-view.json', import.meta.url),
      ),
    ),
    callerAt = 2048,
    topAt = 2052,
    code = kcsProgram(
      golden.cases
        .flatMap((row) => [
          ...row.args.map((a) => [37, a === 'caller' ? [0x13, callerAt] : a]),
          [43, row.id, row.args.length * 4],
          ...(row.save ? [[38, topAt]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2360],
        ])
        .concat([[59]]),
    ),
    files = { 'configured-view.kcs': code },
    make = (initialize = true) =>
      dataWorld(golden.profile, files, {
        initialize,
        startup: parseNativeXML(encodeCP932(golden.startupXML)),
      });
  async function close(world) {
    for (const task of world.runtime.scheduler.tasks.values())
      world.runtime.scheduler.cancel(task.id, false);
    await world.close({ flushFiles: false });
  }
  async function step(world, task) {
    if (task.machine.waiting?.kind === 'message')
      await world.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
    else await world.runtime.scheduler.execute(task);
  }
  function compare(world, task, row, label) {
    const machine = task.machine,
      top = world.objects.objects.get(world.resolveTaskID(machine.load(topAt), task.id));
    assert.equal(top?.kind, 1, label + ' actual factory Top');
    assert.equal(top.parent, task.id, label + ' Script owns its published Top');
    assert.equal(world.graphics.cameraNearWord, row.nearWord, label + ' raw near word');
    assert.deepEqual(
      Array.from({ length: 18 }, (_, i) => machine.load(512 + i * 4)),
      row.outputWords,
      label + ' complete mapped output region',
    );
    assert.equal(world.graphics.view.active, !!row.view.enabled, label + ' live View');
    assert.equal(!!world.graphics.device.attachment, row.view.attachment, label + ' attachment');
  }
  test(
    'SDK' + version + ' configured View API matches own GCALL outputs and eight cold continuations',
    async (t) => {
      const world = await make();
      t.after(() => close(world));
      world.graphics.createLogicalDevice();
      const task = await world.spawnScript('configured-view.kcs', {
          parent: world.main.id,
          initialExecute: false,
        }),
        machine = task.machine,
        floor = machine.sp,
        native = world.runtime.native;
      machine.store(callerAt, world.nativeTaskID(task.id));
      machine.bytes(512, 72).fill(0xa5);
      let next = 0,
        cold = 0;
      function observe(current, rowAt) {
        const call = current.runtime.native;
        current.runtime.native = async function (table, id, args, m, owner, ...rest) {
          if (id === 71) return Reflect.apply(call, this, [table, id, args, m, owner, ...rest]);
          const row = golden.cases[rowAt()];
          assert.equal(id, row.id);
          if (row.text)
            m.bytes(row.textAt, encodeCP932(row.text).length + 1).set([
              ...encodeCP932(row.text),
              0,
            ]);
          const before = m.memory.slice(),
            reply = await Reflect.apply(call, this, [table, id, args, m, owner, ...rest]),
            changed = [];
          for (let i = 0; i < 4096; i++)
            if (before[i] !== m.memory[i]) changed.push([i, m.memory[i]]);
          assert.equal(reply.control, row.control, 'original GCALL control');
          if (!row.save)
            assert.equal(Object.hasOwn(reply, 'value'), false, 'no result publication');
          assert.deepEqual(changed, row.changed, 'exact original output writes');
          return reply;
        };
      }
      observe(world, () => next);
      for (const [index, row] of golden.cases.entries()) {
        await step(world, task);
        assert.equal(machine.sp, floor, 'GCALL leaves the caller stack balanced');
        assert.equal(machine.waiting?.kind, 'message');
        compare(world, task, row, 'frame' + index);
        next++;
        if (golden.coldAfter.includes(index)) {
          const fresh = await make(false);
          try {
            // Device endpoints belong to the new host, never to its checkpoint.
            fresh.graphics.createLogicalDevice();
            await fresh.restore(
              await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
            );
            const restored = fresh.runtime.scheduler.tasks.get(task.id);
            compare(fresh, restored, row, 'cold' + index);
            observe(fresh, () => index + 1);
            await step(fresh, restored);
            compare(fresh, restored, golden.cases[index + 1], 'cold next' + index);
            cold++;
          } finally {
            await close(fresh);
          }
        }
      }
      assert.equal(cold, 8);
      world.runtime.native = native;
    },
  );
  test(
    'SDK' + version + ' camera near keeps absent attachment and unreviewed distances protected',
    async (t) => {
      const world = await make();
      t.after(() => close(world));
      const call = (args) => world.runtime.native('main', 12, args, world.main.machine, world.main),
        initial = world.graphics.cameraNearWord;
      await assert.rejects(async () => call([0x3f800000]), /initialized mode1/);
      world.graphics.createLogicalDevice();
      for (const word of [0, 0xbf800000, 0x7f800000, 0x7fc01234])
        await assert.rejects(async () => call([word]), /positive finite/);
      assert.equal(
        world.graphics.cameraNearWord,
        initial,
        'protected shapes never publish a near word',
      );
    },
  );
}
