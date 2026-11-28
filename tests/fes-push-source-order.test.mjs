// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
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
#b.PUSH_R
$11=23
break
#_FES_SLEEP_
break
`;
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('push source order must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    h.task.input.input.pointer(31, 41, 1);
    return { ...h, world, runtime: h.instance.runtime, input: h.task.input.input };
  } catch (error) {
    await world.close();
    throw error;
  }
}
async function prime(h, key) {
  h.input.key(key, true, 1);
  await h.world.tick();
  assert.equal(h.task.input.state.source, 1);
  assert.equal(h.instance.inputSource, 1);
}
const fields = (h) => [h.task.input.state.source, h.instance.inputSource, h.input.source];
function observe(h) {
  const rows = [],
    receive = h.task.input.message.bind(h.task.input),
    message = h.input.message.bind(h.input),
    event = h.task.player.nativeEvent.bind(h.task.player),
    flush = h.task.player.flush.bind(h.task.player),
    traverse = h.runtime.resources.traverse.bind(h.runtime.resources),
    sync = h.task.input.sync.bind(h.task.input),
    send = h.world.graphics.send.bind(h.world.graphics);
  let current = null;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 9 || words[3] > 1) return receive(words, context);
    const row = {
      key: words[3],
      context,
      before: fields(h),
      order: [],
      queries: [],
      events: [],
      propagation: [],
    };
    rows.push(row);
    current = row;
    try {
      const result = await receive(words, context);
      row.after = fields(h);
      row.result = result;
      return result;
    } finally {
      current = null;
    }
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: (code, ...args) => {
      if (current && [152, 125].includes(code)) {
        current.order.push(String(code));
        current.queries.push({ code, fields: fields(h) });
      }
      return message(code, ...args);
    },
  });
  h.task.player.nativeEvent = (key, name) => {
    if (current) {
      current.order.push(name);
      current.events.push({ key, name, fields: fields(h) });
    }
    return event(key, name);
  };
  h.task.player.flush = (...args) => {
    if (current) current.order.push('flush');
    return flush(...args);
  };
  h.runtime.resources.traverse = (context) => {
    if (current) current.order.push('resources');
    return traverse(context);
  };
  h.task.input.sync = (...args) => {
    if (current) current.order.push('input-sync');
    return sync(...args);
  };
  h.world.graphics.send = (target, sender, code, ...args) => {
    if (current && code === 94) {
      current.order.push('94');
      current.propagation.push(fields(h));
    }
    return send(target, sender, code, ...args);
  };
  return rows;
}
function pause125(h) {
  const entered = Promise.withResolvers(),
    gate = Promise.withResolvers(),
    receive = h.task.input.message.bind(h.task.input),
    message = h.input.message.bind(h.input);
  let inPush = false,
    armed = true;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 9 || words[3] > 1) return receive(words, context);
    inPush = true;
    try {
      return await receive(words, context);
    } finally {
      inPush = false;
    }
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: async (code, ...args) => {
      const result = await message(code, ...args);
      if (inPush && code === 125 && armed) {
        armed = false;
        entered.resolve();
        await gate.promise;
      }
      return result;
    },
  });
  return { entered: entered.promise, ...gate };
}
for (const profile of profiles) {
  test(`${profile}: same-Top Graph source is written to owner/interpreter before either actual mouse query on left/right PUSH`, async () => {
    const h = await open(profile);
    try {
      for (const key of [0, 1]) {
        await prime(h, key);
        const rows = observe(h);
        h.input.key(key, true, 2);
        await h.world.tick();
        assert.ok(rows.length > 0);
        assert.deepEqual(rows[0].before, [1, 1, 2]);
        for (const row of rows) {
          assert.deepEqual(row.order, [
            '152',
            '125',
            key ? 'PUSH_R' : 'PUSH_L',
            'flush',
            'resources',
            'input-sync',
          ]);
          assert.deepEqual(
            row.queries.map((q) => q.code),
            [152, 125],
          );
          assert.ok(row.queries.every((q) => q.fields.join(',') === '2,2,2'));
          assert.ok(row.events.every((e) => e.fields.join(',') === '2,2,2'));
          assert.deepEqual(row.after, [2, 2, 2]);
          assert.ok(row.context.executorEntry);
        }
        h.input.key(key, false);
        await h.world.tick();
      }
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: sleeping actual342 masks hardware; legal same-Top FES PUSH boundary writes source then94 without mouse/event/resource/input sync`, async () => {
    for (const key of [0, 1]) {
      const h = await open(profile);
      try {
        await prime(h, key);
        await h.world.sendEngine(h.id, h.world.main.id, 342, 0, 1);
        const rows = observe(h);
        assert.ok(h.input.regions.every((region) => !region.enabled));
        h.input.key(key, true, 2);
        await h.world.tick();
        assert.equal(rows.length, 0, 'masked hardware did not deliver a PUSH');
        assert.deepEqual(fields(h), [1, 1, 2]);
        const pressed = h.task.input.state.pressed,
          counters = [h.instance.global(10), h.instance.global(11)],
          sender = h.instance.collection.lookup('b', 0).nativeInputTaskID;
        // This is the exposed FES message boundary, not forced routing of masked hardware.
        await h.world.withExecutor(h.world.effekseer.frameExecutor, (executorEntry) =>
          h.world.sendEngine(h.id, sender, 9, 0, key, { executorEntry }),
        );
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0].before, [1, 1, 2]);
        assert.deepEqual(rows[0].order, ['94']);
        assert.deepEqual(rows[0].propagation, [[2, 2, 2]]);
        assert.deepEqual(rows[0].queries, []);
        assert.deepEqual(rows[0].events, []);
        assert.deepEqual(rows[0].after, [2, 2, 2]);
        assert.equal(rows[0].result, 0);
        assert.equal(h.task.input.state.pressed, pressed);
        assert.deepEqual([h.instance.global(10), h.instance.global(11)], counters);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: real125 close resolve/reject and live error retain earlier source writes and cancel later PUSH work`, async () => {
    for (const rejected of [false, true]) {
      const h = await open(profile);
      let gate, pending;
      try {
        await prime(h, 0);
        const rows = observe(h);
        gate = pause125(h);
        h.input.key(0, true, 2);
        pending = h.world.tick();
        await Promise.race([
          gate.entered,
          pending.then(() => {
            throw new Error('PUSH completed before actual125 wait');
          }),
        ]);
        assert.deepEqual(fields(h), [2, 2, 2]);
        await h.world.objects.release(h.id);
        if (rejected) gate.reject(new Error('cancelled PUSH source125'));
        else gate.resolve();
        await pending;
        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => row.order.join(',') === '152,125'));
        assert.equal(h.task.input.state.source, 2);
        assert.equal(h.instance.inputSource, 2);
        assert.equal(h.runtime.closed, true);
        assert.equal(h.instance.finished, null);
      } finally {
        gate?.resolve();
        await pending?.catch(() => {});
        await h.world.close();
      }
    }
    const h = await open(profile);
    let gate, pending;
    try {
      await prime(h, 1);
      const rows = observe(h);
      gate = pause125(h);
      h.input.key(1, true, 2);
      pending = h.world.tick();
      await gate.entered;
      assert.deepEqual(fields(h), [2, 2, 2]);
      gate.reject(new Error('live PUSH source125 failure'));
      await assert.rejects(pending, /live PUSH source125/);
      assert.ok(rows.length > 0);
      assert.ok(rows.every((row) => row.order.join(',') === '152,125'));
      assert.equal(h.task.input.state.source, 2);
      assert.equal(h.instance.inputSource, 2);
      assert.equal(h.runtime.closed, false);
      assert.equal(h.instance.finished, null);
    } finally {
      gate?.resolve();
      await pending?.catch(() => {});
      await h.world.close();
    }
  });
}
