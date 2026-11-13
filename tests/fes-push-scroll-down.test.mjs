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
#PULSE
btnsimulate 9 1
break
#DELETE
b delete
break
#RESET
resetactive
break
#b.SCRL_D
c pos 99 99 0 1
$40=99
break
#SCRL_D
$41=97
break
#b.PAGE_U
$42=93
break
#PAGE_U
$43=91
break
`;
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: { string: () => label } });
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('scroll-down must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    await notify({ ...h, world }, 'LOCK');
    h.task.input.input.pointer(110, 90, 1);
    // Settle real hover before creating the pulse/dirty work for this callback.
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
async function prepare(h) {
  await notify(h, 'PULSE');
  assert.equal(h.input.pulses[9], 1, 'normal FES btnsimulate9 reached the actual Input154 pulse');
  // Real FES definition message339 leaves the resource dirty for the next visitor.
  await h.world.sendEngine(h.id, h.world.main.id, 339, 0, 64, {
    payload: { string: (at) => (at === 0 ? 'ID POS' : 'c 20,30,0') },
  });
  assert.deepEqual(position(h), [5, 6]);
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
    if (words[1] !== 9 || words[3] !== 9) return receive(words, context);
    const row = {
      context,
      words: [...words],
      order: [],
      inFlight: true,
      resourceContexts: [],
      beforePosition: position(h),
    };
    rows.push(row);
    current = row;
    try {
      row.result = await receive(words, context);
      return row.result;
    } finally {
      row.inFlight = false;
      row.scrollDown = h.instance.scrollDown;
      row.scrollUp = h.instance.scrollUp;
      row.pageUp = h.instance.pageUp;
      row.pressed = structuredClone(h.task.input.state.pressed);
      if (h.world.objects.objects.has(h.id)) row.afterPosition = position(h);
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
function check(h, row, event = true) {
  assert.deepEqual(row.order, [
    '95',
    '152',
    '125',
    ...(event ? ['SCRL_D'] : []),
    '94',
    'resources',
    'input-sync',
  ]);
  assert.deepEqual(row.afterResources, [20, 30]);
  assert.deepEqual(row.afterPosition, [20, 30]);
  assert.ok(row.context.executorEntry);
  assert.ok(row.resourceContexts.length > 0);
  assert.ok(row.resourceContexts.every((ctx) => ctx.executorEntry === row.context.executorEntry));
  assert.equal(row.result, 0);
  assert.equal(h.instance.global(40), 0, 'authored object SCRL_D label must not execute');
  assert.equal(h.instance.global(41), 0, 'authored default SCRL_D label must not execute');
  assert.equal(h.instance.global(42), 0, 'key9 must not execute the adjacent key10 own label');
  assert.equal(h.instance.global(43), 0, 'key9 must not execute the adjacent key10 default label');
}
for (const profile of profiles) {
  test(`${profile}: authored btnsimulate9 selects event7 scroll-down, leaves key10 page-up alone and consumes current dirty resources before callback return`, async () => {
    const h = await open(profile);
    try {
      await prepare(h);
      const rows = observe(h),
        button = h.instance.collection.lookup('b', 0);
      assert.equal(h.instance.scrollDown, 0);
      assert.equal(h.instance.scrollUp, 0);
      assert.equal(h.instance.pageUp, 0);
      await h.world.tick();
      assert.ok(rows.length > 0);
      assert.deepEqual(rows[0].beforePosition, [5, 6]);
      for (const row of rows) {
        check(h, row);
        assert.equal(row.scrollDown, button.handle);
        assert.equal(row.scrollUp, 0);
        assert.equal(row.pageUp, 0, 'logical9 must not select the adjacent logical10 event9 field');
        assert.deepEqual(row.pressed, { nameBytes: Uint8Array.of(98), index: 0 });
      }
      assert.equal(h.input.pulses[9], 0);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
