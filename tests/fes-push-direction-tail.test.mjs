// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = `#KEYBLOCK 1
0 2,1 -1,-1,-1,-1
#DEFINE
BUTTON b[2]
CIMAGE c
#OBJECT SIZE POS KEYBLOCK
b[0] 16,16 10,20,0 0,0,0
b[1] 16,16 40,20,0 0,1,0
#OBJECT SIZE POS PRI COLOR DISP
c 4,4 5,6,0 200 0xffffffff 1
#START
b[1] keypos 1 0 0
b[0] setact
next IDLE
#IDLE
break
next IDLE
#LOCK
lockactive 1
break
#PULSE
btnsimulate 7 1
break
#b.PUSH_RIGHT
c pos 99 99 0 1
$40=99
break
#PUSH_RIGHT
$41=97
break
`;
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: fesLabelPayload(() => label) });
const reference = (index) => ({ nameBytes: Uint8Array.of(98), index });
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('direction PUSH must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    await notify({ ...h, world }, 'LOCK');
    h.task.input.input.pointer(110, 90, 1);
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
async function prepare(h, before, after) {
  await notify(h, 'PULSE');
  assert.equal(h.input.pulses[7], 1, 'normal btnsimulate7 reached actual Input154');
  await h.world.sendEngine(h.id, h.world.main.id, 339, 0, 64, {
    payload: { string: (at) => (at === 0 ? 'ID POS' : `c ${after.join(',')},0`) },
  });
  assert.deepEqual(position(h), before);
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
    if (words[1] !== 9 || words[3] !== 7) return receive(words, context);
    const row = {
      words: [...words],
      context,
      order: [],
      resourceContexts: [],
      focusBefore: structuredClone(h.task.input.state.focus),
      beforePosition: position(h),
      pushRightBefore: h.instance.pushRight,
    };
    rows.push(row);
    current = row;
    try {
      row.result = await receive(words, context);
      return row.result;
    } finally {
      row.focusAfter = structuredClone(h.task.input.state.focus);
      row.pressed = structuredClone(h.task.input.state.pressed);
      row.pushRight = h.instance.pushRight;
      row.afterPosition = position(h);
      current = null;
    }
  };
  h.world.engineMessages.dispatch = (target, sender, code, ...args) => {
    if (current && sender === h.id && [95, 138].includes(code)) {
      current.order.push(String(code));
      if (code === 95) current.sourceTarget = target;
      if (code === 138) current.warp = args.slice(0, 2);
    }
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
  test(`${profile}: real direction PUSH shares source/pressed prelude and one resource tail for a successful move and an unhandled edge`, async () => {
    const h = await open(profile);
    try {
      const rows = observe(h),
        target = h.instance.collection.lookup('b', 1);
      assert.equal(
        h.instance.program.keyblockCount,
        1,
        'normal FES requires an explicit KEYBLOCK count',
      );
      assert.equal(target.auxiliarySizeMode, 1);
      assert.deepEqual([target.auxiliaryWidth, target.auxiliaryHeight], [0, 0]);
      for (const [phase, step] of [
        { before: [5, 6], after: [20, 30] },
        { before: [20, 30], after: [40, 50] },
      ].entries()) {
        if (phase === 1) {
          // Finish the real previous RELEASE and cursor hover before staging new work.
          await h.world.tick();
          assert.deepEqual(position(h), [20, 30]);
        }
        await prepare(h, step.before, step.after);
        const first = rows.length;
        await h.world.tick();
        assert.ok(rows.length > first);
        assert.deepEqual(rows[first].beforePosition, step.before);
        for (const [delivery, row] of rows.slice(first).entries()) {
          const moved = phase === 0 && delivery === 0,
            beforeIndex = moved ? 0 : 1,
            field = phase === 0 ? target.handle : 0;
          assert.deepEqual(row.focusBefore, reference(beforeIndex));
          assert.deepEqual(row.focusAfter, reference(1));
          assert.deepEqual(
            row.pressed,
            reference(beforeIndex),
            'pressed reference is copied before navigation',
          );
          assert.equal(row.pushRightBefore, delivery === 0 ? 0 : field);
          assert.equal(row.pushRight, field);
          assert.deepEqual(row.order, [
            '95',
            '152',
            '125',
            ...(moved ? ['PUSH_RIGHT', '138'] : ['94']),
            'resources',
            'input-sync',
          ]);
          if (moved) assert.deepEqual(row.warp, [1, (40 | (20 << 16)) >>> 0]);
          assert.equal(
            row.resourceContexts.length,
            1,
            'one visitor per live normal direction callback',
          );
          assert.equal(row.resourceContexts[0].executorEntry, row.context.executorEntry);
          assert.ok(row.context.executorEntry);
          assert.deepEqual(row.afterResources, step.after);
          assert.deepEqual(row.afterPosition, step.after);
          assert.deepEqual(row.beforePosition, delivery === 0 ? step.before : step.after);
          assert.equal(row.result, 0);
          assert.equal(
            h.world.objects.objects.get(row.sourceTarget)?.kind,
            6,
            'source95 reaches the actual sending Graph',
          );
        }
        assert.equal(h.input.pulses[7], 0);
        assert.equal(h.instance.global(40), 0, 'direction own label must not run');
        assert.equal(h.instance.global(41), 0, 'direction default label must not run');
      }
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
