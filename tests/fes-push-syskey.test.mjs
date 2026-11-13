// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = `#DEFINE
BUTTON b
CIMAGE c
BUTTON unbound
BUTTON disabled
BUTTON a
BUTTON silent
#OBJECT SIZE POS SYSKEY
b 16,16 10,10,0 2
a 16,16 40,10,0 2
silent 16,16 80,50,0 2
#OBJECT SIZE POS ENABLE SYSKEY
disabled 16,16 70,10,0 0 2
#OBJECT SIZE POS
unbound 16,16 100,10,0
#OBJECT SIZE POS PRI COLOR DISP
c 4,4 5,6,0 200 0xffffffff 1
#START
next IDLE
#IDLE
break
next IDLE
#PULSE2
btnsimulate 2 1
break
#PULSE3
btnsimulate 3 1
break
#PULSE79
btnsimulate 79 1
break
#MODE79
$50=1
break
#b.PUSH_L
$40=++$40
if($50) a enable 0
break
#a.PUSH_L
$41=++$41
break
#disabled.PUSH_L
$42=++$42
break
#unbound.PUSH_L
$43=++$43
break
`;
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: fesLabelPayload(() => label) });
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('SYSKEY PUSH must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
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
async function prepare(h, step) {
  await notify(h, `PULSE${step.key}`);
  assert.equal(h.input.pulses[step.key], 1, 'authored btnsimulate reached actual Input154');
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
    if (words[1] !== 9 || ![2, 3, 79].includes(words[3])) return receive(words, context);
    const row = {
      key: words[3],
      words: [...words],
      context,
      order: [],
      events: [],
      returns: [],
      labelFlushes: 0,
      eventDepth: 0,
      resourceContexts: [],
      focusBefore: structuredClone(h.task.input.state.focus),
      beforePosition: position(h),
      clickBefore: h.instance.clickL,
      countersBefore: [40, 41, 42, 43].map((i) => h.instance.global(i)),
    };
    rows.push(row);
    current = row;
    try {
      row.result = await receive(words, context);
      return row.result;
    } finally {
      row.pressed = structuredClone(h.task.input.state.pressed);
      row.clickL = h.instance.clickL;
      row.afterPosition = position(h);
      row.countersAfter = [40, 41, 42, 43].map((i) => h.instance.global(i));
      current = null;
    }
  };
  h.world.engineMessages.dispatch = (target, sender, code, ...args) => {
    if (current && sender === h.id && code === 95) {
      current.order.push('95');
      current.sourceTarget = target;
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
          if (row) row.returns.push([key, name, value]);
          return value;
        })
        .finally(() => {
          if (row) row.eventDepth--;
        });
    if (row) {
      row.returns.push([key, name, result]);
      row.eventDepth--;
    }
    return result;
  };
  h.task.player.flush = (...args) => {
    if (current) {
      if (current.eventDepth) current.labelFlushes++;
      else current.order.push('flush');
    }
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
  test(`${profile}: real SYSKEY producers visit all live FIFO matches, skip unbound/disabled entries and recheck later eligibility after an author label`, async () => {
    const h = await open(profile);
    let fresh;
    try {
      const rows = observe(h),
        get = (name) => h.instance.collection.lookup(name, 0),
        steps = [
          { key: 2, before: [5, 6], after: [20, 30], names: ['b', 'a', 'silent'] },
          { key: 3, before: [20, 30], after: [40, 50], names: [] },
          { key: 79, before: [40, 50], after: [60, 70], names: ['b'] },
        ];
      assert.equal(get('b').systemKey, 2);
      assert.equal(get('a').systemKey, 2);
      assert.deepEqual(
        h.runtime.resources.entries
          .filter((entry) => entry.savedType === 6)
          .map((entry) => entry.name),
        ['b', 'unbound', 'disabled', 'a', 'silent'],
      );
      for (const [phase, step] of steps.entries()) {
        if (phase) {
          await h.world.tick();
          assert.deepEqual(position(h), step.before);
        }
        if (step.key === 79) {
          for (const name of ['b', 'a', 'disabled'])
            await h.world.sendEngine(h.id, h.world.main.id, 339, 0, 64, {
              payload: { string: (at) => (at === 0 ? 'ID SYSKEY' : `${name} 79`) },
            });
          await notify(h, 'MODE79');
          assert.equal(
            get('a').enable,
            true,
            'later matching entry starts enabled before the b label',
          );
        }
        await prepare(h, step);
        const first = rows.length;
        await h.world.tick();
        assert.ok(rows.length > first, `actual World Graph callbacks for logical${step.key}`);
        for (const [delivery, row] of rows.slice(first).entries()) {
          const expectedClick = step.names.length ? get(step.names.at(-1)).handle : 0;
          assert.equal(row.key, step.key);
          assert.equal(row.focusBefore?.nameBytes.length ?? 0, 0);
          assert.equal(row.pressed, null, 'SYSKEY scan must work without a pressed/active object');
          assert.deepEqual(
            row.events,
            step.names.map((name) => [name, 'PUSH_L']),
          );
          assert.deepEqual(
            row.returns,
            step.names.map((name) => [name, 'PUSH_L', name !== 'silent']),
          );
          assert.deepEqual(row.order, [
            '95',
            '152',
            '125',
            ...step.names.flatMap((name) => [`event:${name}`, 'flush']),
            ...(step.names.length ? [] : ['94']),
            'resources',
            'input-sync',
          ]);
          assert.equal(row.clickBefore, delivery === 0 ? 0 : expectedClick);
          assert.equal(row.clickL, expectedClick);
          assert.deepEqual(
            row.countersAfter.map((value, i) => value - row.countersBefore[i]),
            [step.names.includes('b') ? 1 : 0, step.names.includes('a') ? 1 : 0, 0, 0],
          );
          assert.deepEqual(row.beforePosition, delivery === 0 ? step.before : step.after);
          assert.deepEqual(row.afterResources, step.after);
          assert.deepEqual(row.afterPosition, step.after);
          assert.equal(row.resourceContexts.length, 1);
          assert.equal(row.resourceContexts[0].executorEntry, row.context.executorEntry);
          assert.ok(row.context.executorEntry);
          assert.equal(row.result, 0);
          assert.equal(h.world.objects.objects.get(row.sourceTarget)?.kind, 6);
        }
        assert.equal(h.input.pulses[step.key], 0);
        assert.equal(get('unbound').systemKey, -1);
        assert.equal(get('silent').systemKey, 2);
        assert.equal(get('disabled').enable, false);
      }
      assert.equal(
        get('a').enable,
        false,
        'the first SYSKEY79 handler disabled the later FIFO candidate',
      );
      const saved = h.world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      fresh.ensureNativeEngine = () => {
        throw new Error('SYSKEY restore must stay JavaScript');
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        instance = task.player.root;
      assert.equal(instance.collection.lookup('unbound', 0).systemKey, -1);
      assert.equal(instance.collection.lookup('b', 0).systemKey, 79);
      assert.equal(instance.collection.lookup('silent', 0).systemKey, 2);
      assert.equal(instance.collection.lookup('a', 0).systemKey, 79);
      assert.equal(instance.collection.lookup('a', 0).enable, false);
      for (const entry of instance.runtime.resources.entries)
        if (entry.savedType === 6)
          assert.equal(
            instance.collection.graph.get(entry.initialHandle).systemKey,
            instance.collection.lookup(entry.nameBytes, entry.index).systemKey,
          );
      assert.equal(fresh.nativeEngine, undefined);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await h.world.close();
    }
  });
}
