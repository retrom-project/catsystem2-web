// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeInput } from '../src/native/input.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

for (const [profile, count] of [
  ['grisaia-jp-engine-2.6.1.23', 64],
  ['rebellions-jp-engine-2.6.1.63', 80],
  ['bokutomo-engine-2.6.1.67', 80],
]) {
  test(`${profile} Input keeps its own key domain through browser edges and cold restore`, async () => {
    const make = () => {
        const configuration = new NativeConfiguration({ profile }),
          input = new NativeInput({ configuration, dispatch: async () => 0 }),
          bindings = new NativeInputBindings(input, configuration);
        input.services.queryKey = (index, slot) => bindings.query(index, slot);
        input.services.repeat = (index) => bindings.repeat[index];
        return { input, bindings, configuration };
      },
      { input, bindings, configuration } = make(),
      last = count - 1;
    assert.equal(configuration.keys.rows.length, count);
    assert.equal(input.keyCount, count);
    assert.equal(bindings.keyCount, count);
    for (const value of [input.keys, input.held, input.repeatEnabled, bindings.sampled])
      assert.equal(value.length, count * 4);
    const queried = [];
    input.services.queryKey = (index, slot) => {
      queried.push([index, slot]);
      return bindings.query(index, slot);
    };
    bindings.tap(last);
    bindings.sample();
    await input.tick(1);
    assert.equal(new Set(queried.map(([index, slot]) => `${index}:${slot}`)).size, count * 4);
    assert.equal(Math.max(...queried.map(([index]) => index)), last);
    assert.equal(input.held[last * 4], 1);
    const saved = { input: input.snapshot(), bindings: bindings.snapshot() },
      fresh = make();
    fresh.input.restore(saved.input);
    fresh.bindings.restore(saved.bindings);
    assert.deepEqual(fresh.input.snapshot(), saved.input);
    bindings.sample();
    fresh.bindings.sample();
    await input.tick(2);
    await fresh.input.tick(2);
    assert.equal(input.held[last * 4], 0);
    assert.deepEqual(fresh.input.snapshot(), input.snapshot());
    assert.throws(() => input.key(count, true), /outside/);
    assert.throws(() => input.queryKey(count), /crosses/);
    assert.throws(() => bindings.tap(count), /Invalid native logical key/);
    assert.throws(() => bindings.setPulse(count, 1), /crosses/);
    await assert.rejects(input.message(150, count, 1), /crosses/);
    await assert.rejects(input.message(154, count, 1), /crosses/);
    const before = input.snapshot(),
      beforeBindings = bindings.snapshot();
    assert.throws(
      () => input.restore({ ...saved.input, keys: new Uint32Array(count * 4 + 4) }),
      /checkpoint key table/,
    );
    assert.deepEqual(input.snapshot(), before);
    assert.throws(
      () => bindings.restore({ ...saved.bindings, sampled: new Uint32Array(count * 4 + 4) }),
      /checkpoint key table/,
    );
    assert.deepEqual(bindings.snapshot(), beforeBindings);
  });

  test(`${profile} real key-source GCALL reaches the final valid slot and guards the next`, async (t) => {
    const world = await dataWorld(profile, {
      'last-key.kcs': kcsProgram([[37, count - 1], [43, 285, 4], [38, 64], [59]]),
      'outside-key.kcs': kcsProgram([[37, count], [43, 285, 4], [59]]),
    });
    t.after(() => world.close({ flushFiles: false }));
    assert.equal(world.input.keyCount, count);
    world.input.key(count - 1, true, 0x80000000, 3);
    const valid = await world.spawnScript('last-key.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    await world.runtime.scheduler.execute(valid);
    assert.equal(valid.machine.load(64), 0x80000000);
    const outside = await world.spawnScript('outside-key.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    await assert.rejects(world.runtime.scheduler.execute(outside), /crosses/);
  });
}
