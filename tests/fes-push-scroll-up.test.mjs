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
btnsimulate 8 1
break
#DELETE
b delete
break
#RESET
resetactive
break
#b.SCRL_U
c pos 99 99 0 1
$40=99
break
#SCRL_U
$41=97
break
`;
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: { string: () => label } });
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('scroll-up must stay JavaScript');
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
  assert.equal(h.input.pulses[8], 1, 'normal FES btnsimulate reached the actual Input154 pulse');
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
    if (words[1] !== 9 || words[3] !== 8) return receive(words, context);
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
      row.scrollUp = h.instance.scrollUp;
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
    ...(event ? ['SCRL_U'] : []),
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
  assert.equal(h.instance.global(40), 0, 'authored object SCRL_U label must not execute');
  assert.equal(h.instance.global(41), 0, 'authored default SCRL_U label must not execute');
}
function pause125(h) {
  const original = h.input.message.bind(h.input),
    receive = h.task.input.message.bind(h.task.input),
    entered = Promise.withResolvers(),
    gate = Promise.withResolvers();
  let armed = true,
    inScroll = false;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 9 || words[3] !== 8) return receive(words, context);
    inScroll = true;
    try {
      return await receive(words, context);
    } finally {
      inScroll = false;
    }
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: async (code, ...args) => {
      const result = await original(code, ...args);
      if (inScroll && code === 125 && armed) {
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
  test(`${profile}: authored btnsimulate8 reaches actual World Graph scroll-up field/RET0/94 and the same callback consumes real339 dirty resources`, async () => {
    const h = await open(profile);
    try {
      await prepare(h);
      const rows = observe(h),
        button = h.instance.collection.lookup('b', 0);
      await h.world.tick();
      assert.ok(rows.length > 0);
      assert.deepEqual(rows[0].beforePosition, [5, 6]);
      for (const row of rows) {
        check(h, row);
        assert.equal(row.scrollUp, button.handle);
        assert.deepEqual(row.pressed, { nameBytes: Uint8Array.of(98), index: 0 });
      }
      assert.equal(h.input.pulses[8], 0);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: key8 missing/NULL fields and actual342 masked producer keep their distinct paths`, async () => {
    for (const mode of ['missing', 'NULL', 'sleeping']) {
      const h = await open(profile);
      try {
        if (mode === 'missing') await notify(h, 'DELETE');
        if (mode === 'NULL') {
          await notify(h, 'RESET');
          await h.world.tick();
        }
        await prepare(h);
        if (mode === 'sleeping') await h.world.sendEngine(h.id, h.world.main.id, 342, 0, 1);
        const before = h.instance.scrollUp,
          rows = observe(h);
        await h.world.tick();
        if (mode === 'sleeping') {
          assert.equal(rows.length, 0, 'actual342 masks ordinary Input/Graph delivery');
          // Legal exposed FES boundary after masked hardware; do not force a Graph route.
          await h.world.withExecutor(h.world.effekseer.frameExecutor, (executorEntry) =>
            h.world.sendEngine(h.id, h.task.input.state.lowButton, 9, 0, 8, { executorEntry }),
          );
          assert.deepEqual(rows[0].order, ['95', '94']);
          assert.equal(rows[0].scrollUp, before);
          assert.equal(h.task.input.state.source, h.input.source);
        } else {
          assert.ok(rows.length > 0);
          for (const row of rows) {
            check(h, row, mode !== 'missing');
            assert.equal(row.scrollUp, mode === 'missing' ? before : -1);
          }
        }
        assert.equal(h.instance.global(40), 0);
        assert.equal(h.instance.global(41), 0);
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: real key8 mouse waits cancel after close, live query/resource errors propagate and resource effects keep their timing`, async () => {
    for (const mode of ['close-resolve', 'close-reject', 'live-error']) {
      const h = await open(profile);
      let gate, pending;
      try {
        await prepare(h);
        const rows = observe(h);
        gate = pause125(h);
        pending = h.world.tick();
        await Promise.race([
          gate.entered,
          pending.then(() => {
            throw new Error('key8 missed actual125 wait');
          }),
        ]);
        assert.equal(h.task.input.state.source, 1);
        assert.equal(h.task.input.state.pressed, null);
        if (mode.startsWith('close')) await h.world.objects.release(h.id);
        if (mode === 'close-resolve') gate.resolve();
        else gate.reject(new Error(mode));
        if (mode === 'live-error') await assert.rejects(pending, /live-error/);
        else await pending;
        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => row.order.join(',') === '95,152,125'));
        assert.equal(h.task.input.state.pressed, null);
        assert.equal(h.instance.scrollUp, 0);
        assert.equal(h.runtime.closed, mode.startsWith('close'));
        assert.equal(h.instance.finished, null);
      } finally {
        gate?.resolve();
        await pending?.catch(() => {});
        await h.world.close();
      }
    }
    const h = await open(profile);
    try {
      await prepare(h);
      const rows = observe(h),
        traverse = h.runtime.resources.traverse.bind(h.runtime.resources);
      h.runtime.resources.traverse = async (context) => {
        const inScroll = rows.at(-1)?.inFlight === true;
        await traverse(context);
        if (inScroll) throw new Error('live key8 resource');
      };
      await assert.rejects(h.world.tick(), /live key8 resource/);
      assert.ok(rows.length > 0);
      assert.ok(rows.every((row) => row.order.join(',') === '95,152,125,SCRL_U,94,resources'));
      assert.deepEqual(rows[0].beforePosition, [5, 6]);
      assert.deepEqual(rows[0].afterResources, [20, 30]);
      assert.equal(rows[0].scrollUp, h.instance.collection.lookup('b', 0).handle);
      assert.equal(h.runtime.closed, false);
      assert.equal(h.instance.finished, null);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: fresh World restores a pending authored key8 pulse and dirty image, then uses its current callback entry without replay`, async () => {
    const h = await open(profile);
    let fresh;
    try {
      await prepare(h);
      const state = h.world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      fresh.ensureNativeEngine = () => {
        throw new Error('key8 fresh must stay JavaScript');
      };
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        if (name !== 'case.kcs') throw new Error('scroll-up replayed ' + name);
        return read(name);
      };
      await fresh.restore(state);
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = {
          world: fresh,
          id: h.id,
          task,
          instance: task.player.root,
          runtime: task.player.root.runtime,
          input: task.input.input,
          draw: fresh.graphics.drawTasks.get(h.surface),
        },
        rows = observe(restored),
        button = restored.instance.collection.lookup('b', 0);
      assert.deepEqual(reads, ['case.kcs']);
      assert.equal(restored.input.pulses[8], 1);
      assert.deepEqual(position(restored), [5, 6]);
      await fresh.tick();
      assert.ok(rows.length > 0);
      assert.deepEqual(rows[0].beforePosition, [5, 6]);
      for (const row of rows) {
        check(restored, row);
        assert.equal(row.scrollUp, button.handle);
      }
      assert.equal(restored.input.pulses[8], 0);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await h.world.close();
    }
  });
}
