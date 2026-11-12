// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeInput } from '../src/native/input.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

test('real input tick passes each caller context by identity through press, repeat and release; omitted context keeps four dispatcher arguments', async () => {
  for (const explicit of [false, true]) {
    const calls = [],
      input = new NativeInput({ dispatch: (...args) => (calls.push(args), 0) }),
      contexts = Array.from({ length: 3 }, () => Object.freeze({ executorEntry: {} }));
    input.register({ owner: 27, bounds: [10, 10, 20, 20], mask: 1 });
    input.repeatStart = 2;
    input.key(0, true);
    await input.tick(1, explicit ? contexts[0] : undefined);
    await input.tick(2, explicit ? contexts[1] : undefined);
    input.key(0, false);
    await input.tick(3, explicit ? contexts[2] : undefined);
    const route = calls.filter((call) => call[1] === 4);
    assert.deepEqual(
      route.map((call) => call.slice(0, 4)),
      [
        [27, 4, 0, 1],
        [27, 4, 0, 1],
        [27, 4, 0, 0],
      ],
    );
    for (let at = 0; at < route.length; at++) {
      assert.equal(route[at].length, explicit ? 5 : 4);
      if (explicit) assert.equal(route[at][4], contexts[at]);
    }
    assert.equal(JSON.stringify(input.snapshot()).includes('executorEntry'), false);
  }
});
const source = `#DEFINE
BUTTON b
#OBJECT SIZE POS
b 16,16 30,40,0
#START
b setact
next IDLE
#IDLE
break
next IDLE
#b.PUSH_L
$10=17
break
#b.RELEASE_L
$11=23
break
`;
for (const profile of profiles)
  test(`${profile}: actual World.tick logical key traverses default Graph and FES PUSH/RELEASE with its live frame entry`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': new TextEncoder().encode(source),
    });
    world.ensureNativeEngine = () => {
      throw new Error('input route must stay in the default JavaScript path');
    };
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const input = h.task.input.input,
        tick = input.tick.bind(input),
        receive = h.task.input.message.bind(h.task.input),
        entries = [],
        routed = [];
      Object.defineProperty(input, 'tick', {
        configurable: true,
        value: (frame, context) => {
          entries.push(context.executorEntry);
          return tick(frame, context);
        },
      });
      h.task.input.message = (words, context) => {
        if (words[1] === 9 || words[1] === 10) routed.push([words[1], context.executorEntry]);
        return receive(words, context);
      };
      input.pointer(31, 41, 1);
      input.key(0, true);
      await world.tick();
      assert.equal(h.instance.global(10), 17);
      const press = routed.filter(([id]) => id === 9);
      assert.ok(press.length > 0);
      assert.ok(entries[0]);
      assert.ok(press.every(([, entry]) => entry === entries[0]));
      input.key(0, false);
      await world.tick();
      assert.equal(h.instance.global(11), 23);
      const release = routed.filter(([id]) => id === 10);
      assert.ok(release.length > 0);
      assert.ok(release.every(([, entry]) => entry === entries[1]));
      assert.notEqual(entries[0], entries[1]);
      assert.throws(() => world.effekseer.nextInt(entries[0]), /live explicit/);
      assert.equal(JSON.stringify(input.snapshot()).includes('executorEntry'), false);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });
