// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const utf8 = (value) => new TextEncoder().encode(value),
  text = (bytes) => new TextDecoder().decode(bytes),
  ref = (value) => (value === null ? null : [text(value.nameBytes), value.index]),
  source = `#DEFINE
BUTTON a
BUTTON b[2]
#START
next IDLE
#IDLE
#SELECT
a setact
break
#DEFAULT
b[0] noact
break
#APPLY
a setact
react $str7 NEVER_EVALUATE
$30=++$30
break
#REACT
react $str7 NEVER_EVALUATE
$30=++$30
break
#TWICE
react
react
break
#DISABLED
a enable 0
react
break
#SWITCH
b[1] setact
baseimg
$31=++$31
break
#a.FOCUS
$10=++$10
break
#a.UNFOCUS
$11=++$11
break
#b.FOCUS
$12=++$12
break
`;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': utf8(source) });
  Object.assign(world.configuration.screen, {
    width: 128,
    height: 96,
    currentWidth: 128,
    currentHeight: 96,
    virtualWidth: 128,
    virtualHeight: 96,
  });
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return { ...h, world, input: h.task.input, runtime: h.instance.runtime };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, label) =>
    h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: fesLabelPayload(() => label) }),
  select = async (h) => {
    await notify(h, 'SELECT');
    await h.runtime.flushRecords();
  };
function trace(h) {
  const values = [],
    input = h.input.input,
    query = input.message.bind(input),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages),
    event = h.instance.dispatchEvent.bind(h.instance);
  Object.defineProperty(input, 'message', {
    configurable: true,
    writable: true,
    value: (message, ...args) => {
      if ([152, 125].includes(message)) values.push(['mouse', message]);
      return query(message, ...args);
    },
  });
  h.world.engineMessages.dispatch = (target, sender, message, w, l, context = {}) => {
    if ([93, 138, 145].includes(message))
      values.push(['input', message, target, sender, w, l, context.flags]);
    return dispatch(target, sender, message, w, l, context);
  };
  h.instance.dispatchEvent = (object, name) => {
    values.push(['event', object.key, name, ref(h.input.state.focus)]);
    return event(object, name);
  };
  return values;
}
function pause(h, stage) {
  const entered = deferred(),
    gate = deferred();
  let armed = true;
  if (stage === 'mouse') {
    const input = h.input.input,
      query = input.message.bind(input);
    Object.defineProperty(input, 'message', {
      configurable: true,
      writable: true,
      value: async (message, ...args) => {
        const result = await query(message, ...args);
        if (message === 125 && armed) {
          armed = false;
          entered.resolve();
          await gate.promise;
        }
        return result;
      },
    });
  } else {
    const dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
    h.world.engineMessages.dispatch = async (target, sender, message, w, l, context) => {
      const result = await dispatch(target, sender, message, w, l, context);
      if (message === 93 && l === 1 && armed) {
        armed = false;
        entered.resolve();
        await gate.promise;
      }
      return result;
    };
  }
  return { entered: entered.promise, ...gate };
}
async function fresh(h) {
  const state = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('react restore replayed ' + name);
    return read(name);
  };
  try {
    await world.restore(state);
    const task = world.objects.objects.get(h.id).implementation;
    return { world, id: h.id, task, instance: task.player.root, input: task.input, reads };
  } catch (error) {
    await world.close();
    throw error;
  }
}
for (const profile of profiles) {
  test(`${profile}: react normal FIFO ignores operands, flushes -3 and repeats real mouse/Input93/FOCUS without replacing either reference`, async () => {
    const h = await open(profile);
    try {
      await notify(h, 'DEFAULT');
      await h.runtime.flushRecords();
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        bankCalls = [],
        scriptCalls = [],
        expand = bank.expandBytes.bind(bank),
        script = h.world.configuration.scriptReplacements,
        apply = script.apply.bind(script);
      bank.setBytes(7, utf8('SIDE'));
      script.add(utf8('SIDE'), utf8('++$42'));
      bank.expandBytes = (bytes) => {
        bankCalls.push(text(bytes));
        return expand(bytes);
      };
      script.apply = (bytes) => {
        scriptCalls.push(text(bytes));
        return apply(bytes);
      };
      h.input.input.pointer(17, 19, 1);
      const values = trace(h);
      await notify(h, 'APPLY');
      assert.equal(h.instance.global(10), 2);
      assert.equal(h.instance.global(11), 0);
      assert.equal(h.instance.global(30), 1);
      assert.equal(h.instance.global(42), 0);
      assert.equal(bankCalls.includes('$str7'), false);
      assert.equal(bankCalls.includes('NEVER_EVALUATE'), false);
      assert.equal(scriptCalls.includes('SIDE'), false);
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.equal(h.instance.nativeQueuePending, false);
      assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
      assert.deepEqual(ref(h.instance.defaultButton), ['b', 0]);
      assert.deepEqual(h.task.player.mouse, { x: 17, y: 19 });
      assert.deepEqual(
        values.map((row) => row.slice(0, 2)),
        [
          ['mouse', 152],
          ['mouse', 125],
          ['input', 93],
          ['event', 'a'],
          ['mouse', 152],
          ['mouse', 125],
          ['input', 93],
          ['event', 'a'],
        ],
      );
      const inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
      assert.deepEqual(
        values.filter(([kind]) => kind === 'input'),
        [
          ['input', 93, inputID, h.id, 0, 1, 1],
          ['input', 93, inputID, h.id, 0, 1, 1],
        ],
      );
      const authority = h.input.state.focus;
      values.length = 0;
      await notify(h, 'TWICE');
      assert.equal(h.input.state.focus, authority);
      assert.equal(h.instance.global(10), 4);
      assert.equal(h.instance.global(11), 0);
      assert.equal(values.filter(([kind]) => kind === 'input').length, 2);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: react gates only the early name, preserving NULL and typed empty/index7 and not filtering an existing disabled target`, async () => {
    const h = await open(profile);
    try {
      const values = trace(h);
      await notify(h, 'REACT');
      assert.deepEqual(values, []);
      assert.equal(h.input.state.focus, null);
      // Non-NULL empty/index7 is an existing typed FIFO input, not an authored producer.
      h.runtime.pendingRecords.push({
        operation: 'active-reference',
        reference: { nameBytes: new Uint8Array(), index: 7 },
      });
      await h.runtime.flushRecords();
      values.length = 0;
      await notify(h, 'REACT');
      assert.deepEqual(values, []);
      assert.deepEqual(ref(h.input.state.focus), ['', 7]);
      await select(h);
      values.length = 0;
      await notify(h, 'DISABLED');
      assert.equal(h.instance.collection.lookup('a', 0).enable, false);
      assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
      assert.equal(h.instance.global(10), 2);
      assert.deepEqual(
        values.filter(([kind]) => kind === 'event'),
        [['event', 'a', 'FOCUS', ['a', 0]]],
      );
      assert.deepEqual(
        values.filter(([kind]) => kind === 'input').map((row) => row.slice(4)),
        [[0, 1, 1]],
      );
    } finally {
      await h.world.close();
    }
  });
  test(
    `${profile}: react cancels after real mouse or Input93 resolve/reject on owner close and propagates a live query failure`,
    { timeout: 5000 },
    async () => {
      for (const stage of ['mouse', 'active'])
        for (const rejected of [false, true]) {
          const h = await open(profile);
          let running;
          try {
            await select(h);
            const gate = pause(h, stage),
              record = h.world.objects.objects.get(h.id);
            running = notify(h, 'REACT');
            running.catch(() => {});
            await gate.entered;
            const closing = h.world.objects.release(h.id);
            if (rejected) gate.reject(new Error('react canceled query'));
            else gate.resolve();
            await Promise.all([running, closing]);
            assert.equal(h.instance.global(10), 1);
            assert.equal(h.instance.global(30), 0);
            assert.equal(h.instance.finished, null);
            assert.equal(record.exitCode, -1);
            assert.equal(h.runtime.closed, true);
            assert.deepEqual(h.runtime.pendingRecords, []);
          } finally {
            await h.world.close();
            await running?.catch(() => {});
          }
        }
      const h = await open(profile);
      try {
        await select(h);
        const gate = pause(h, 'active'),
          running = notify(h, 'REACT');
        const failed = assert.rejects(running, /react live query/);
        await gate.entered;
        gate.reject(new Error('react live query'));
        await failed;
        assert.equal(h.instance.global(10), 1);
        assert.equal(h.instance.global(30), 0);
        assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
        assert.equal(h.runtime.closed, false);
        assert.equal(h.instance.nativeQueuePending, false);
      } finally {
        await h.world.close();
      }
    },
  );
  test(
    `${profile}: react rereads the current name/index after either real query and fresh restore does not replay completed focus`,
    { timeout: 5000 },
    async () => {
      for (const stage of ['mouse', 'active']) {
        const h = await open(profile);
        let running, restored;
        try {
          await select(h);
          await notify(h, 'DEFAULT');
          await h.runtime.flushRecords();
          const gate = pause(h, stage);
          running = notify(h, 'REACT');
          await gate.entered;
          await notify(h, 'SWITCH');
          assert.deepEqual(ref(h.input.state.focus), ['b', 1]);
          gate.resolve();
          await running;
          assert.deepEqual(
            [10, 11, 12, 30, 31].map((i) => h.instance.global(i)),
            [1, 1, 2, 1, 1],
          );
          assert.deepEqual(ref(h.input.state.focus), ['b', 1]);
          assert.deepEqual(ref(h.instance.defaultButton), ['b', 0]);
          restored = await fresh(h);
          assert.deepEqual(restored.reads, ['case.kcs']);
          assert.deepEqual(ref(restored.input.state.focus), ['b', 1]);
          assert.deepEqual(
            [10, 11, 12, 30, 31].map((i) => restored.instance.global(i)),
            [1, 1, 2, 1, 1],
          );
          await notify(restored, 'REACT');
          assert.equal(restored.instance.global(12), 3);
          assert.equal(restored.instance.global(30), 2);
          assert.equal(restored.world.nativeEngine, undefined);
        } finally {
          await restored?.world.close();
          await h.world.close();
          await running?.catch(() => {});
        }
      }
    },
  );
}
