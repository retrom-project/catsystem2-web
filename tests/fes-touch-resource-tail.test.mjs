// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = `#DEFINE
BUTTON b
BUTTON silent
CIMAGE c
#OBJECT SIZE POS DEFAULT
b 16,16 10,10,0 SHARED
#OBJECT SIZE POS
silent 16,16 50,10,0
#OBJECT SIZE POS PRI COLOR DISP
c 4,4 5,6,0 200 0xffffffff 1
#START
next IDLE
#IDLE
break
next IDLE
#SHARED.TOUCH
$40=++$40
break
#b.TOUCH
$41=++$41
break
`;
const define = (h, columns, values) =>
  h.world.sendEngine(h.id, h.world.main.id, 339, 0, 64, {
    payload: { string: (at) => (at === 0 ? `ID ${columns}` : values) },
  });
function position(h) {
  const entry = h.runtime.resources.entries.find((entry) => entry.savedType === 1);
  return h.draw.entry(entry.image.binding.key).position.slice();
}
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('normal TOUCH must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const input = h.task.input.input,
      runtime = h.instance.runtime,
      b = h.instance.collection.lookup('b', 0),
      first = runtime.resources.entries.find((entry) => entry.name === 'b');
    assert.ok(input.get(first.buttonTaskID), 'first real BUTTON Graph is already registered');
    await world.sendEngine(
      h.id,
      world.main.id,
      338,
      0,
      FES_OBJECT_DEFINITION_ORDER.indexOf('BUTTON'),
      {
        payload: { string: () => 'b', load: () => 1 },
      },
    );
    await runtime.initializeResources();
    await define({ ...h, world }, 'SIZE', 'b 18,16');
    input.pointer(110, 80, 1);
    await world.tick();
    const entries = runtime.resources.entries.filter((entry) => entry.name === 'b');
    assert.equal(entries.length, 2);
    assert.equal(
      h.instance.collection.lookup('b', 0),
      b,
      'live duplicate keeps the current object',
    );
    assert.notEqual(entries[0].buttonTaskID, entries[1].buttonTaskID);
    for (const entry of entries) {
      assert.equal(entry.savedType, 6);
      assert.equal(entry.initialHandle, b.handle);
      assert.equal(world.objects.objects.get(entry.buttonTaskID).kind, 6);
      assert.ok(input.get(entry.buttonTaskID)?.enabled, 'both actual Graph regions remain live');
    }
    assert.equal(b.nativeInputTaskID, entries[1].buttonTaskID);
    assert.deepEqual(
      h.task.input.state.buttons.filter(([key]) => key === b.key).map(([, id]) => id),
      [entries[1].buttonTaskID],
      'presentation-key map no longer contains the first live Graph',
    );
    return { ...h, world, input, runtime, bEntries: entries };
  } catch (error) {
    await world.close();
    throw error;
  }
}
function observe(h) {
  const rows = [],
    frameEntries = [],
    receive = h.task.input.message.bind(h.task.input),
    tick = h.input.tick.bind(h.input),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages),
    message = h.input.message.bind(h.input),
    event = h.task.player.nativeEvent.bind(h.task.player),
    flush = h.task.player.flush.bind(h.task.player),
    traverse = h.runtime.resources.traverse.bind(h.runtime.resources),
    sync = h.task.input.sync.bind(h.task.input),
    send = h.world.graphics.send.bind(h.world.graphics);
  let current = null;
  h.input.tick = (frame, context) => {
    frameEntries.push(context.executorEntry);
    return tick(frame, context);
  };
  h.task.input.message = async (words, context) => {
    if (words[1] !== 65) return receive(words, context);
    const row = {
      taskID: h.world.resolveTaskID(words[2], h.id),
      sender: context.nativeSenderWorldID,
      context,
      frameEntry: frameEntries.at(-1),
      order: [],
      events: [],
      returns: [],
      eventDepth: 0,
      resourceContexts: [],
      beforePosition: position(h),
      touchBefore: h.instance.touch ?? 0,
      sourceBefore: [h.task.input.state.source, h.instance.inputSource],
      pressedBefore: structuredClone(h.task.input.state.pressed),
      countersBefore: [40, 41].map((i) => h.instance.global(i)),
    };
    rows.push(row);
    current = row;
    try {
      row.result = await receive(words, context);
      return row.result;
    } finally {
      row.afterPosition = position(h);
      row.touchAfter = h.instance.touch ?? 0;
      row.sourceAfter = [h.task.input.state.source, h.instance.inputSource];
      row.pressedAfter = structuredClone(h.task.input.state.pressed);
      row.countersAfter = [40, 41].map((i) => h.instance.global(i));
      current = null;
    }
  };
  h.world.engineMessages.dispatch = (target, sender, code, ...args) => {
    if (current && sender === h.id && code === 95) current.order.push('95');
    return dispatch(target, sender, code, ...args);
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: (code, ...args) => {
      if (current && [152, 125].includes(code)) current.order.push(String(code));
      return message(code, ...args);
    },
  });
  h.task.player.nativeEvent = (key, name) => {
    const row = current;
    if (row) {
      row.events.push([key, name]);
      row.order.push(`event:${key}`);
      row.eventDepth++;
    }
    const result = event(key, name);
    if (result && typeof result.then === 'function')
      return result
        .then((value) => {
          if (row) row.returns.push(value);
          return value;
        })
        .finally(() => {
          if (row) row.eventDepth--;
        });
    if (row) {
      row.returns.push(result);
      row.eventDepth--;
    }
    return result;
  };
  h.task.player.flush = (...args) => {
    if (current && !current.eventDepth) current.order.push('flush');
    return flush(...args);
  };
  h.runtime.resources.traverse = async (context) => {
    const row = current;
    if (row) {
      row.order.push('resources');
      row.resourceContexts.push(context);
    }
    const result = await traverse(context);
    if (row) row.afterResources = position(h);
    return result;
  };
  h.task.input.sync = (...args) => {
    if (current) current.order.push('input-sync');
    return sync(...args);
  };
  h.world.graphics.send = (target, sender, code, ...args) => {
    if (current && code === 94) {
      current.order.push('94');
      current.propagationTarget = target;
    }
    return send(target, sender, code, ...args);
  };
  return rows;
}
for (const profile of profiles) {
  test(`${profile}: normal TOUCH routes duplicate Graphs by resource identity and keeps matched returns separate from the no-entry resource tail`, async () => {
    const h = await open(profile);
    try {
      const rows = observe(h),
        b = h.instance.collection.lookup('b', 0),
        silent = h.instance.collection.lookup('silent', 0),
        steps = [
          { point: [12, 12], before: [5, 6], after: [20, 30], object: b, handled: true },
          { point: [52, 12], before: [20, 30], after: [40, 50], object: silent, handled: false },
          { point: [110, 80], before: [40, 50], after: [60, 70], object: null },
        ];
      for (const step of steps) {
        h.input.pointer(...step.point, 1);
        await h.world.tick();
        assert.deepEqual(position(h), step.before, 'hover/release settle precedes new dirty work');
        const touchBefore = h.instance.touch ?? 0;
        await define(h, 'POS', `c ${step.after.join(',')},0`);
        assert.deepEqual(position(h), step.before, 'real339 has not traversed its dirty resource');
        const first = rows.length;
        h.input.pointerActivation = true;
        await h.world.tick();
        const deliveries = rows.slice(first),
          matched = deliveries.filter((row) => row.taskID !== h.task.input.state.lowButton),
          noEntry = deliveries.filter((row) => row.taskID === h.task.input.state.lowButton),
          expectedIDs =
            step.object === b
              ? h.bEntries.map((entry) => entry.buttonTaskID)
              : step.object
                ? [step.object.nativeInputTaskID]
                : [];
        assert.deepEqual(
          matched.map((row) => row.taskID),
          expectedIDs,
        );
        assert.equal(noEntry.length, 1, 'actual full-screen low Graph has no FES resource entry');
        assert.equal(deliveries.at(-1), noEntry[0]);
        for (const [at, row] of deliveries.entries()) {
          assert.equal(row.sender, row.taskID, 'original Graph remains the callback sender');
          assert.ok(row.frameEntry, 'actual Input tick has its live frame executor entry');
          assert.equal(
            row.context.executorEntry,
            row.frameEntry,
            'click preserves that same entry',
          );
          assert.equal(row.result, 0);
          assert.deepEqual(row.beforePosition, step.before);
          assert.deepEqual(
            row.sourceAfter,
            row.sourceBefore,
            'TOUCH has no source95 or source write',
          );
          assert.deepEqual(row.pressedAfter, row.pressedBefore, 'TOUCH does not capture pressed');
          if (row === noEntry[0]) {
            assert.deepEqual(row.order, ['152', '125', 'resources', 'input-sync']);
            assert.deepEqual(row.events, []);
            assert.deepEqual(row.returns, []);
            assert.equal(row.touchBefore, step.object?.handle ?? touchBefore);
            assert.equal(row.touchAfter, row.touchBefore, 'no entry leaves the TOUCH field alone');
            assert.deepEqual(row.afterResources, step.after);
            assert.deepEqual(row.afterPosition, step.after, 'current339 consumed before65 returns');
            assert.equal(row.resourceContexts.length, 1);
            assert.equal(row.resourceContexts[0].executorEntry, row.frameEntry);
          } else {
            assert.deepEqual(row.order, [
              '152',
              '125',
              `event:${step.object.key}`,
              'flush',
              ...(step.handled ? [] : ['94']),
            ]);
            assert.deepEqual(row.events, [[step.object.key, 'TOUCH']]);
            assert.deepEqual(row.returns, [step.handled]);
            assert.equal(row.touchBefore, at ? step.object.handle : touchBefore);
            assert.equal(
              row.touchAfter,
              step.object.handle,
              'field resolves the current name/index',
            );
            assert.deepEqual(
              row.afterPosition,
              step.before,
              'matched return does not visit resources',
            );
            assert.deepEqual(row.resourceContexts, []);
            if (!step.handled) assert.equal(row.propagationTarget, row.sender);
          }
          assert.deepEqual(
            row.countersAfter.map((value, i) => value - row.countersBefore[i]),
            row !== noEntry[0] && step.handled ? [1, 1] : [0, 0],
          );
        }
        assert.equal(h.input.pointerActivation, false);
        assert.deepEqual(position(h), step.after);
      }
      assert.equal(h.instance.global(40), 2);
      assert.equal(h.instance.global(41), 2);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
