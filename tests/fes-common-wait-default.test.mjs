// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESInstance } from '../src/fes/instance.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = new TextEncoder().encode(
  '#START\nreset_frame\n$50=_FRAME_\n$str30\n$51=_FRAME_\nreset_frame\n$53=_FRAME_\n$52=++$52\nnext IDLE\n#IDLE\n',
);

for (const profile of profiles) {
  test(`normal native FES frame inputs survive same-word333 and cold restore: ${profile}`, async (t) => {
    const world = await defaultFESWorld(profile, { 'screen.fes': source });
    let fresh;
    try {
      const h = await loadDefaultFES(world),
        bank = world.runtime.variableBank(world.main, false);
      world.runtime.stringBank(world.main).setBytes(30, new Uint8Array());
      bank.set(51, 0xffffffff);
      bank.set(52, 0);
      bank.set(53, 99);

      // The public native registry supplies this input. It is not World.frame
      // or a test mutation of the interpreter's clock/state.
      await world.objects.tick(17);
      assert.equal(world.objects.objects.get(h.id).effectiveFrame, 17);
      assert.equal(bank.get(50), 0);
      assert.equal(bank.get(52), 0);
      await world.sendEngine(h.id, world.main.id, 333);
      assert.equal(bank.get(52), 0, 'a forced update at the same input must not resume the guest');
      assert.equal(bank.get(51), 0xffffffff);
      assert.equal(h.instance.nativeFrameWord, 17);
      assert.equal(h.instance.frameOrigin, 17);
      assert.equal(h.instance.commandDelayUntil, 18);
      assert.equal(h.task.player.frameCount, 2, 'the diagnostic call count remains independent');

      const savedPlayer = structuredClone(h.task.player.snapshot()),
        checkpoint = structuredClone(world.snapshot()),
        random = structuredClone(world.random.snapshot()),
        reads = [];
      let restoring = false,
        restoreCommands = 0;
      const execute = FESInstance.prototype.execute;
      t.mock.method(FESInstance.prototype, 'execute', function (...args) {
        if (restoring) restoreCommands++;
        return execute.apply(this, args);
      });
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read;
      t.mock.method(fresh.game, 'read', function (name, ...args) {
        if (restoring) reads.push(name);
        return read.call(this, name, ...args);
      });
      restoring = true;
      try {
        await fresh.restore(checkpoint);
      } finally {
        restoring = false;
      }
      const nextTask = fresh.objects.objects.get(h.id).implementation,
        next = nextTask.player.root,
        nextBank = fresh.runtime.variableBank(fresh.main, false);
      assert.deepEqual(structuredClone(nextTask.player.snapshot()), savedPlayer);
      assert.equal(restoreCommands, 0);
      assert.deepEqual(
        reads.filter((name) => name.endsWith('.fes')),
        [],
      );
      assert.deepEqual(fresh.random.snapshot(), random);
      assert.equal(next.nativeFrameWord, 17);
      assert.equal(next.frameOrigin, 17);
      assert.notStrictEqual(
        next.nativeContext.nameBytes.buffer,
        h.instance.nativeContext.nameBytes.buffer,
      );

      await world.objects.tick(18);
      await fresh.objects.tick(18);
      for (const [task, words] of [
        [h.task, bank],
        [nextTask, nextBank],
      ]) {
        assert.equal(words.get(51), 1);
        assert.equal(words.get(52), 1);
        assert.equal(words.get(53), 0);
        assert.equal(task.player.root.nativeFrameWord, 18);
        assert.equal(task.player.root.frameOrigin, 18);
        assert.equal(task.player.root.commandDelayUntil, null);
        assert.equal(task.player.root.label, 'IDLE');
        assert.equal(task.player.frameCount, 3);
      }
      assert.deepEqual(
        structuredClone(nextTask.player.snapshot()),
        structuredClone(h.task.player.snapshot()),
      );
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
