// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
const waiting = kcsProgram([[37, 128], [43, 0x47, 4], [43, 0x41, 0], [59]]),
  own = kcsProgram([[37, 8], [43, 0xd1, 4], [37, 128], [43, 0x47, 4], [59]]);
function fixture(profile, main = waiting) {
  const game = memoryGame({ 'main.kcs': main, 'child.kcs': waiting, 'own.kcs': own }),
    random = new ParticleRandom();
  return new NativeWorld({
    game,
    images: {},
    host: {},
    profile,
    configuration: new NativeConfiguration({ profile }),
    random,
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
}
for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74']) {
  test(`${profile} getters before D1 preserve a null bank and a child may initialize its own`, async () => {
    const world = fixture(profile);
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine;
      for (const [id, args] of [
        [0xd2, [0]],
        [0x292, [0]],
      ])
        assert.equal((await world.runtime.native('main', id, args, m, task)).value, 0);
      assert.equal(task.context.variableBank, 0);
      const child = await world.spawnScript('own.kcs', { parent: task.id, initialExecute: true }),
        bank = world.runtime.variableBank(child, false),
        handle = child.context.variableBank,
        stringHandle = child.context.stringBank;
      assert.equal(bank.capacity, 8);
      assert.equal(bank.contexts.size, 0);
      assert.equal(child.context.allowVariableInitialization, true);
      assert.equal(task.context.variableBank, 0);
      await world.objects.release(child.id);
      assert.throws(() => world.runtime.handles.get(handle), /released/);
      assert.equal(
        world.runtime.handles.get(stringHandle, 'string-bank'),
        world.runtime.stringBank(task, false),
      );
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} inherited scripts share global words and strings and own private variable contexts`, async () => {
    const world = fixture(profile, own);
    let restored;
    try {
      await world.initialize('main.kcs');
      const main = world.main,
        bank = world.runtime.variableBank(main, false),
        one = await world.spawnScript('child.kcs', { parent: main.id, initialExecute: true }),
        two = await world.spawnScript('child.kcs', { parent: main.id, initialExecute: true });
      assert.equal(one.context.variableBank, main.context.variableBank);
      assert.equal(two.context.variableBank, main.context.variableBank);
      assert.equal(bank.context(main.id), null);
      assert.equal(bank.context(one.id).words.length, 512);
      assert.notEqual(bank.context(one.id).words, bank.context(two.id).words);
      assert.equal(one.context.stringBank, main.context.stringBank);
      assert.equal(one.context.stringBank, two.context.stringBank);
      assert.equal(one.context.stringBankInherited, true);
      bank.context(one.id).words[3] = 11;
      bank.context(two.id).words[3] = 22;
      bank.selectContext(two.id);
      assert.equal((await world.runtime.native('main', 0x292, [3], one.machine, one)).value, 22);
      const message = { load: () => 0, store: () => {} };
      await world.sendEngine(one.id, main.id, 172, 0, 0, { payload: message });
      assert.equal(bank.selectedContext, one.id);
      assert.equal(
        (
          await world.runtime.native(
            'main',
            0x45,
            [world.nativeTaskID(two.id), 0x33, 0, 0],
            one.machine,
            one,
          )
        ).value,
        1,
      );
      assert.equal(bank.selectedContext, one.id);
      const strings = world.runtime.stringBank(one);
      strings.set(7, 'shared string');
      assert.equal(world.runtime.stringBank(two, false).get(7), 'shared string');
      bank.selectContext(two.id);
      await world.objects.objects.get(one.id).implementation.loadScript('child.kcs');
      assert.equal(bank.selectedContext, two.id);
      assert.equal(bank.context(one.id).words[3], 11);
      assert.equal(
        world.runtime.stringBank(world.runtime.scheduler.tasks.get(one.id), false).get(7),
        'shared string',
      );
      restored = fixture(profile, own);
      await restored.restore(structuredClone(world.snapshot()));
      const fresh = restored.runtime.variableBank(restored.main, false);
      assert.equal(fresh.selectedContext, two.id);
      assert.equal(fresh.context(one.id).words[3], 11);
      await restored.objects.release(one.id);
      assert.equal(fresh.context(one.id), null);
      assert.equal(fresh.context(two.id).words[3], 22);
      assert.equal(fresh.selectedContext, two.id);
      await restored.objects.release(main.id);
      assert.equal(restored.runtime.handles.records.size, 0);
    } finally {
      await world.close({ flushFiles: false });
      await restored?.close({ flushFiles: false });
    }
  });
  test(`${profile} script load inherits through the live parent message broadcast`, async () => {
    const world = fixture(profile);
    try {
      await world.initialize('main.kcs');
      const base = await world.objects.create({ kind: 0, parent: world.main.id }),
        first = await world.objects.create({ kind: 12, parent: base }),
        later = await world.spawnScript('own.kcs', { parent: base, initialExecute: true }),
        bank = world.runtime.variableBank(later, false);
      await world.objects.objects.get(first).implementation.loadScript('child.kcs');
      const task = world.runtime.scheduler.tasks.get(first);
      assert.equal(task.context.variableBank, later.context.variableBank);
      assert.ok(bank.context(first));
      assert.equal(task.context.allowVariableInitialization, false);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
