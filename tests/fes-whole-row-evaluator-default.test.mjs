// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { kcsProgram } from './helpers.mjs';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  fesNotificationMemory,
} from './fixtures/default-fes-world.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  source = ascii(`#DEFINE
CPLANE live
#START
wait 1
break
#MES_SHOW
\\52 = \\0
toolbase disp \\52
\\53 = 77
break
#TAIL
toolbase ++$20
$25 = 88
break
#lost.BINDINGS
ghost $28 = live[0]
ghost $29 = missing[-1]
ghost \\54 = @
ghost 1 || ++$20
ghost[++$21] $26 = ++$22
break
`);
async function notify(world, id, label, name = null, index = 0) {
  const memory = fesNotificationMemory(ascii(label), name === null ? null : ascii(name), index);
  await world.sendEngine(id, world.main.id, 337, name === null ? 0 : 64, 0, { payload: memory });
  assert.equal(memory.stringReads, 0);
}
for (const profile of profiles) {
  test(`normal whole-row misses use original bytes and the owning evaluator: ${profile}`, async (t) => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'screen.fes': source },
      world = await defaultFESWorld(profile, files);
    let fresh;
    try {
      const { id, instance: root } = await loadDefaultFES(world),
        words = world.runtime.variableBank(world.main, false),
        rules = world.configuration.scriptReplacements,
        scriptInputs = [],
        apply = rules.apply;
      t.mock.method(rules, 'apply', function (bytes) {
        scriptInputs.push(String.fromCharCode(...bytes));
        return apply.call(this, bytes);
      });
      // A whole-row SCRIPT pass would redirect this real mutation to $30.
      rules.add(ascii('$20'), ascii('$30'));
      await world.sendEngine(id, world.main.id, 340, 0, 1);
      await notify(world, id, 'MES_SHOW');
      assert.equal(root.local(52), 1);
      assert.equal(
        root.local(53),
        77,
        'the meswnd continuation executes after the original unknown-object row',
      );
      assert.equal(root.collection.lookup(ascii('toolbase'), 0), null);
      assert.deepEqual(scriptInputs, ['toolbase', 'toolbase']);
      scriptInputs.length = 0;
      await notify(world, id, 'TAIL');
      assert.deepEqual([words.get(20), words.get(30), words.get(25)], [1, 0, 88]);
      assert.deepEqual(scriptInputs, ['toolbase', 'toolbase']);
      const tuple = structuredClone(root.nativeContext),
        bankCurrent = words.contextValue;
      await notify(world, id, 'BINDINGS', 'lost', -7);
      assert.equal(words.get(28), root.collection.lookup(ascii('live'), 0).handle);
      assert.equal(words.get(29), 0);
      assert.equal(root.local(54), -7);
      assert.deepEqual([words.get(20), words.get(21), words.get(22), words.get(26)], [2, 1, 1, 1]);
      assert.deepEqual(root.nativeContext, tuple);
      assert.equal(
        words.contextValue,
        bankCurrent,
        'per-call current does not replace the bank current field',
      );
      const saved = world.snapshot();
      fresh = await defaultFESWorld(
        profile,
        { 'case.kcs': files['case.kcs'] },
        { initialize: false },
      );
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        assert.equal(name, 'case.kcs');
        return read(name);
      };
      await fresh.restore(saved);
      const next = fresh.objects.objects.get(id).implementation.player.root,
        nextWords = fresh.runtime.variableBank(fresh.main, false);
      assert.notEqual(next, root);
      assert.deepEqual([next.local(52), next.local(53), next.local(54)], [1, 77, -7]);
      assert.deepEqual(nextWords.snapshot(), words.snapshot());
      assert.deepEqual(next.nativeContext, tuple);
      assert.deepEqual(fresh.random.snapshot(), saved.random);
      assert.deepEqual(reads, ['case.kcs']);
      await notify(fresh, id, 'TAIL');
      assert.deepEqual([nextWords.get(20), nextWords.get(30), nextWords.get(25)], [3, 0, 88]);
      assert.equal(words.get(20), 2, 'fresh evaluator mutates only its restored owner');
    } finally {
      if (fresh) await fresh.close();
      await world.close();
    }
  });
}
