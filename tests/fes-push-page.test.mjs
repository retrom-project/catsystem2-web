// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = `#DEFINE
BUTTON b
CIMAGE c
#OBJECT SIZE POS
b 16,16 30,40,0
#OBJECT SIZE POS PRI COLOR DISP
c 4,4 5,6,0 200 0xffffffff 1
#START
b setact
next IDLE
#IDLE
break
next IDLE
#LOCK
lockactive 1
break
#PULSE_UP
btnsimulate 10 1
break
#PULSE_DOWN
btnsimulate 11 1
break
#b.PAGE_U
c pos 99 99 0 1
$40=99
break
#PAGE_U
$41=97
break
#b.PAGE_D
c pos 98 98 0 1
$42=93
break
#PAGE_D
$43=91
break
`;
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: { string: () => label } });
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('pagination PUSH must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    await notify({ ...h, world }, 'LOCK');
    h.task.input.input.pointer(110, 90, 1);
    // Settle actual hover before creating either pulse and its dirty image work.
    await world.tick();
    return { ...h, world, runtime: h.instance.runtime, input: h.task.input.input };
  } catch (error) {
    await world.close();
    throw error;
  }
}
function position(h) {
  const entry = h.runtime.resources.entries.find((entry) => entry.savedType === 1);
  return h.draw.entry(entry.image.binding.key).position.slice();
}
async function prepare(h, step) {
  await notify(h, step.label);
  assert.equal(h.input.pulses[step.key], 1, 'normal btnsimulate reached the actual Input154 pulse');
  await h.world.sendEngine(h.id, h.world.main.id, 339, 0, 64, {
    payload: { string: (at) => (at === 0 ? 'ID POS' : `c ${step.after.join(',')},0`) },
  });
  assert.deepEqual(position(h), step.before);
}
function observe(h) {
  const rows = [],
    receive = h.task.input.message.bind(h.task.input),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages),
    message = h.input.message.bind(h.input),
    event = h.task.player.nativeEvent.bind(h.task.player),
    flush = h.task.player.flush.bind(h.task.player),
    traverse = h.runtime.resources.traverse.bind(h.runtime.resources),
    sync = h.task.input.sync.bind(h.task.input),
    send = h.world.graphics.send.bind(h.world.graphics);
  let current = null;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 9 || ![10, 11].includes(words[3])) return receive(words, context);
    const row = {
      key: words[3],
      context,
      order: [],
      resourceContexts: [],
      beforePosition: position(h),
      beforePageUp: h.instance.pageUp,
      beforePageDown: h.instance.pageDown,
      beforeScrollUp: h.instance.scrollUp,
      beforeScrollDown: h.instance.scrollDown,
    };
    rows.push(row);
    current = row;
    try {
      row.result = await receive(words, context);
      return row.result;
    } finally {
      row.pageUp = h.instance.pageUp;
      row.pageDown = h.instance.pageDown;
      row.scrollUp = h.instance.scrollUp;
      row.scrollDown = h.instance.scrollDown;
      row.pressed = structuredClone(h.task.input.state.pressed);
      row.afterPosition = position(h);
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
    if (current) current.order.push(name);
    return event(key, name);
  };
  h.task.player.flush = (...args) => {
    if (current) current.order.push('flush');
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
    if (current && code === 94) current.order.push('94');
    return send(target, sender, code, ...args);
  };
  return rows;
}
for (const profile of profiles) {
  test(`${profile}: authored btnsimulate10/11 select their own page fields without labels or flush and consume each current dirty image before returning`, async () => {
    const h = await open(profile);
    try {
      const rows = observe(h),
        button = h.instance.collection.lookup('b', 0),
        steps = [
          { key: 10, label: 'PULSE_UP', event: 'PAGE_U', before: [5, 6], after: [20, 30] },
          { key: 11, label: 'PULSE_DOWN', event: 'PAGE_D', before: [20, 30], after: [40, 50] },
        ];
      assert.equal(h.instance.pageUp, 0);
      assert.equal(h.instance.pageDown, 0);
      for (const step of steps) {
        if (step.key === 11) {
          // Finish the previous pulse's real RELEASE before staging the next dirty image.
          await h.world.tick();
          assert.deepEqual(position(h), [20, 30]);
        }
        await prepare(h, step);
        const first = rows.length;
        await h.world.tick();
        assert.ok(rows.length > first, `real World callback for logical${step.key}`);
        assert.deepEqual(rows[first].beforePosition, step.before);
        for (const [delivery, row] of rows.slice(first).entries()) {
          const writtenUp = step.key === 10 ? button.handle : 0,
            writtenDown = step.key === 11 ? button.handle : 0;
          assert.equal(row.key, step.key);
          assert.deepEqual(row.beforePosition, delivery === 0 ? step.before : step.after);
          assert.equal(row.beforePageUp, delivery === 0 ? 0 : writtenUp);
          assert.equal(row.beforePageDown, delivery === 0 ? 0 : writtenDown);
          assert.equal(row.beforeScrollUp, 0);
          assert.equal(row.beforeScrollDown, 0);
          assert.deepEqual(row.order, [
            '95',
            '152',
            '125',
            step.event,
            '94',
            'resources',
            'input-sync',
          ]);
          assert.deepEqual(row.afterResources, step.after);
          assert.deepEqual(row.afterPosition, step.after);
          assert.equal(row.result, 0);
          assert.equal(row.pageUp, writtenUp);
          assert.equal(row.pageDown, writtenDown);
          assert.equal(row.scrollUp, 0);
          assert.equal(row.scrollDown, 0);
          assert.deepEqual(row.pressed, { nameBytes: Uint8Array.of(98), index: 0 });
          assert.ok(row.context.executorEntry);
          assert.ok(row.resourceContexts.length > 0);
          assert.ok(
            row.resourceContexts.every((ctx) => ctx.executorEntry === row.context.executorEntry),
          );
        }
        assert.equal(h.input.pulses[step.key], 0);
        for (const index of [40, 41, 42, 43])
          assert.equal(
            h.instance.global(index),
            0,
            'own/default PAGE_U/PAGE_D labels must not run',
          );
      }
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
