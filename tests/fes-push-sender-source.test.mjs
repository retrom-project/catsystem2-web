// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
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
    throw new Error('PUSH sender query must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return {
      ...h,
      world,
      runtime: h.instance.runtime,
      input: h.task.input.input,
      sender: h.instance.collection.lookup('b', 0).nativeInputTaskID,
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const fields = (h) => [h.task.input.state.source, h.instance.inputSource, h.input.source];
async function prime(h) {
  h.input.pointer(31, 41, 1);
  h.input.key(0, true, 1);
  await h.world.tick();
  assert.deepEqual(fields(h), [1, 1, 1]);
}
function observe(h) {
  const rows = [],
    receive = h.task.input.message.bind(h.task.input),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages),
    input = h.input.message.bind(h.input),
    event = h.task.player.nativeEvent.bind(h.task.player),
    traverse = h.runtime.resources.traverse.bind(h.runtime.resources),
    sync = h.task.input.sync.bind(h.task.input),
    send = h.world.graphics.send.bind(h.world.graphics);
  let current = null;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 9 || words[3] > 1) return receive(words, context);
    const row = {
      order: [],
      queries: [],
      mouseFields: [],
      before: fields(h),
      context,
      words: [...words],
    };
    rows.push(row);
    current = row;
    try {
      return await receive(words, context);
    } finally {
      row.after = fields(h);
      current = null;
    }
  };
  h.world.engineMessages.dispatch = async (target, sender, code, w, l, context) => {
    const row = current;
    if (!row || code !== 95 || sender !== h.id)
      return dispatch(target, sender, code, w, l, context);
    row.order.push('95');
    const query = {
      target,
      sender,
      code,
      w,
      l,
      flags: context.flags,
      executorEntry: context.executorEntry,
    };
    row.queries.push(query);
    const result = await dispatch(target, sender, code, w, l, context);
    query.result = result;
    return result;
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: (code, ...args) => {
      if (current && [152, 125].includes(code)) {
        current.order.push(String(code));
        current.mouseFields.push(fields(h));
      }
      return input(code, ...args);
    },
  });
  h.task.player.nativeEvent = (key, name) => {
    if (current) current.order.push(name);
    return event(key, name);
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
    if (current && code === 94) current.order.push('94');
    return send(target, sender, code, ...args);
  };
  return rows;
}
function pauseQuery(h) {
  const plane = h.world.objects.objects.get(h.sender).implementation,
    message = plane.message.bind(plane),
    entered = Promise.withResolvers(),
    gate = Promise.withResolvers();
  let armed = true;
  Object.defineProperty(plane, 'message', {
    configurable: true,
    value: async (words, context) => {
      const result = await message(words, context);
      if (words[1] === 95 && armed) {
        armed = false;
        entered.resolve();
        await gate.promise;
      }
      return result;
    },
  });
  return { entered: entered.promise, ...gate };
}
const send = (h, sender, key = 0) =>
  h.world.withExecutor(h.world.effekseer.frameExecutor, (executorEntry) =>
    h.world.sendEngine(h.id, sender, 9, 0, key, { executorEntry }),
  );
for (const profile of profiles) {
  test(`${profile}: actual World Graph PUSH queries its sender95 flags1/w0/l1 with the same live entry before mouse and resources`, async () => {
    const h = await open(profile);
    try {
      const rows = observe(h);
      h.input.pointer(31, 41, 1);
      h.input.key(0, true, 2);
      await h.world.tick();
      assert.ok(rows.length > 0);
      for (const row of rows) {
        assert.deepEqual(row.order, ['95', '152', '125', 'PUSH_L', 'resources', 'input-sync']);
        assert.equal(row.queries.length, 1);
        const query = row.queries[0];
        const actualSender = row.context.nativeSenderWorldID;
        assert.equal(h.world.objects.objects.get(actualSender).kind, 6);
        assert.equal(h.world.inputFor(actualSender), h.input);
        assert.deepEqual(
          [query.target, query.sender, query.code, query.w, query.l, query.flags],
          [actualSender, h.id, 95, 0, 1, 1],
        );
        assert.equal(query.executorEntry, row.context.executorEntry);
        assert.ok(query.executorEntry);
        assert.equal(query.result.result, 2);
        assert.deepEqual(row.mouseFields, [
          [2, 2, 2],
          [2, 2, 2],
        ]);
        assert.deepEqual(row.after, [2, 2, 2]);
      }
      assert.equal(h.instance.global(10), 17);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: exposed cross-Top FES boundary queries the actual Graph Top source including16-to2 and known0 before sleep`, async () => {
    const h = await open(profile);
    try {
      await prime(h);
      const top = await h.world.objects.create({ kind: 1, parent: null, name: 'other Top' }),
        sender = await h.world.objects.create({ kind: 6, parent: top, name: 'other sender Graph' }),
        other = h.world.inputFor(sender),
        rows = observe(h);
      assert.notEqual(other, h.input);
      assert.notEqual(
        h.world.nativeTaskID(sender),
        sender,
        'World and native identities must not be confused',
      );
      for (const value of [2, 16]) {
        await h.world.withExecutor(h.world.effekseer.frameExecutor, async (executorEntry) => {
          // Exposed Input route produces source16 without the ordinary tick's earlier normalization.
          // The cross-Top FES message is a legal boundary, not a cross-Top hardware route.
          await other.route(79, false, value, false, { executorEntry });
          await h.world.sendEngine(h.id, sender, 9, 0, 1, { executorEntry });
        });
        const row = rows.at(-1);
        assert.equal(row.queries[0].target, sender);
        assert.equal(row.queries[0].result.result, 2);
        assert.deepEqual(row.after, [2, 2, 1]);
        assert.deepEqual(row.mouseFields, [
          [2, 2, 1],
          [2, 2, 1],
        ]);
        assert.equal(other.source, value);
        assert.deepEqual(row.order, ['95', '152', '125', 'PUSH_R', 'resources', 'input-sync']);
      }
      await h.world.sendEngine(h.id, h.world.main.id, 342, 0, 1);
      await other.route(79, false, 0);
      await send(h, sender, 1);
      assert.deepEqual(rows.at(-1).order, ['95', '94']);
      assert.equal(rows.at(-1).queries[0].result.result, 0, 'written0 is a valid source');
      assert.deepEqual(rows.at(-1).after, [0, 0, 1]);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: exposed non-Graph and absent sender queries reject unwritten output without mouse or source fallback`, async () => {
    const h = await open(profile);
    try {
      await prime(h);
      const base = await h.world.objects.create({ kind: 0, parent: h.world.main.id }),
        rows = observe(h),
        pressed = h.task.input.state.pressed;
      for (const sender of [base, 0xffffffff]) {
        await assert.rejects(send(h, sender), /FES PUSH source.*initialized 32-bit output word/);
        const row = rows.at(-1);
        assert.deepEqual(row.order, ['95']);
        assert.equal(row.queries[0].result.result, NATIVE_UNWRITTEN_WORD);
        assert.deepEqual(row.after, [1, 1, 1]);
        assert.equal(h.task.input.state.pressed, pressed);
        assert.equal(h.instance.finished, null);
        assert.equal(h.runtime.closed, false);
      }
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: real sender query await cancels close resolve/reject before writes and propagates live errors`, async () => {
    for (const mode of ['close-resolve', 'close-reject', 'live-error']) {
      const h = await open(profile);
      let gate, pending;
      try {
        await prime(h);
        const rows = observe(h);
        gate = pauseQuery(h);
        h.input.key(0, true, 2);
        pending = h.world.tick();
        await Promise.race([
          gate.entered,
          pending.then(() => {
            throw new Error('PUSH completed without awaiting sender95');
          }),
        ]);
        assert.deepEqual(fields(h), [1, 1, 2]);
        assert.deepEqual(rows[0].order, ['95']);
        if (mode !== 'live-error') await h.world.objects.release(h.id);
        if (mode === 'close-resolve') gate.resolve();
        else gate.reject(new Error(mode));
        if (mode === 'live-error') await assert.rejects(pending, /live-error/);
        else await pending;
        assert.deepEqual(rows[0].order, ['95']);
        assert.equal(h.task.input.state.source, 1);
        assert.equal(h.instance.inputSource, 1);
        assert.equal(h.runtime.closed, mode !== 'live-error');
        assert.equal(h.instance.finished, null);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        gate?.resolve();
        await pending?.catch(() => {});
        await h.world.close();
      }
    }
  });
}
