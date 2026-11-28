// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';

const source = new TextEncoder().encode('#START\n$20=37\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n');

async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': source });
  try {
    const h = await loadDefaultFES(world);
    assert.equal(world.objects.objects.get(h.id).kind, 34);
    assert.ok(h.task.player.root.runtime instanceof FESCoordinator);
    return { world, ...h };
  } catch (error) {
    await world.close();
    throw error;
  }
}

function observe(world) {
  const sends = [],
    send = world.sendNativeEngine;
  world.sendNativeEngine = function (...args) {
    sends.push(args.slice(0, 5));
    return send.apply(this, args);
  };
  return sends;
}

function declaration(profile, id) {
  const entry = nativeABI(profile).tables.main.entries[id];
  assert.equal(entry.status, 'recovered');
  assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[id].signature);
  assert.equal(entry.signature.argumentWords, 1);
  assert.deepEqual(entry.controlCodes, [2]);
  assert.equal(entry.signature.result.kind, 'void');
  assert.equal(entry.signature.resultWritten, false);
  if (profile === profiles[0]) {
    assert.match(entry.evidence, new RegExp('SDK-2\\.6\\.1\\.74-main' + id + '-full-wrapper'));
    assert.notEqual(entry.evidence, nativeABI(profiles[1]).tables.main.entries[id].evidence);
  }
}

test('main448 performs real FES update work through both explicit profiles', async () => {
  for (const [profileIndex, profile] of profiles.entries()) {
    const h = await open(profile);
    try {
      const { world, task } = h,
        owner = world.main,
        machine = owner.machine,
        target = world.nativeTaskID(h.id),
        args = [target],
        before = {
          pc: machine.pc,
          sp: machine.sp,
          fp: machine.fp,
          stack: machine.memory.slice(machine.sp - 4, machine.sp + 4),
          frame: task.player.frameCount,
        },
        sends = observe(world);
      assert.equal(task.player.root.global(20), 0);
      assert.ok(before.stack.length >= 4);
      const reply = await world.runtime.native(
        'main',
        448,
        args,
        machine,
        owner,
        world.runtime.scheduler,
      );
      assert.deepEqual(reply, { control: 2 });
      assert.equal(task.player.frameCount, before.frame + 1);
      assert.equal(task.player.root.global(20), 37, 'The real normal FES source assignment ran');
      assert.equal(world.runtime.variableBank(owner, false).get(20), 37);
      assert.deepEqual(sends[0], [target, owner.id, 333, 0, 0]);
      assert.equal(sends.filter((row) => row[0] === target && row[2] === 333).length, 1);
      assert.equal(mapABIMessage(profile, 'control', 'raw', 333, 34), [328, 333][profileIndex]);
      assert.deepEqual([machine.pc, machine.sp, machine.fp], [before.pc, before.sp, before.fp]);
      assert.deepEqual(machine.memory.slice(before.sp - 4, before.sp + 4), before.stack);
      assert.deepEqual(args, [target]);
      // Updating the FES bank is intentional work, not a universal VM return write.
      declaration(profile, 448);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  }
});

test('main453 updates its actual Script caller exit code without a VM result in both profiles', async () => {
  for (const profile of profiles) {
    const h = await open(profile);
    try {
      const { world } = h,
        owner = world.main,
        machine = owner.machine,
        caller = world.objects.objects.get(owner.id),
        fes = world.objects.objects.get(h.id),
        fesExit = fes.exitCode,
        sends = observe(world);
      assert.equal(caller.kind, 12);
      assert.strictEqual(world.runtime.scheduler.tasks.get(caller.id), owner);
      for (const [word, expected] of [
        [0, 0],
        [-7, -7],
        [0x80000000, -2147483648],
      ]) {
        const args = [word],
          before = machine.snapshot();
        const reply = await world.runtime.native(
          'main',
          453,
          args,
          machine,
          owner,
          world.runtime.scheduler,
        );
        assert.deepEqual(reply, { control: 2 });
        assert.equal(caller.exitCode, expected, 'The actual caller record received the DWORD');
        assert.deepEqual(machine.snapshot(), before, 'No caller VM result or other VM write');
        const saved = world.objects.snapshot().objects.find((record) => record.id === caller.id);
        assert.equal(saved.exitCode, expected);
        assert.equal(fes.exitCode, fesExit, 'A different FES task was not the caller context');
        assert.deepEqual(args, [word]);
      }
      assert.deepEqual(sends, [], 'The direct caller-field setter sends no engine message');
      declaration(profile, 453);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  }
});
