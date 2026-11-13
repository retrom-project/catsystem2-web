// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
const ascii = (text) => new TextEncoder().encode(text),
  directions = [
    [4, 'RELEASE_UP', 'releaseUp'],
    [5, 'RELEASE_DOWN', 'releaseDown'],
    [6, 'RELEASE_LEFT', 'releaseLeft'],
    [7, 'RELEASE_RIGHT', 'releaseRight'],
  ],
  fieldNames = directions.map((row) => row[2]),
  source = `#DEFINE
BUTTON b
BUTTON other
#OBJECT SIZE POS
b 16,16 30,40,0
other 16,16 60,40,0
#START
b setact
next IDLE
#IDLE
break
next IDLE
#DELETE
lockactive 1
b delete
break
#b.RELEASE_UP
$40=++$40
break
#b.RELEASE_DOWN
$40=++$40
break
#b.RELEASE_LEFT
$40=++$40
break
#b.RELEASE_RIGHT
$40=++$40
break
`;
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': ascii(source) });
  world.ensureNativeEngine = () => {
    throw new Error('release keys must stay JavaScript');
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
async function press(h, key) {
  h.input.key(key, true);
  await h.world.tick();
  assert.deepEqual(
    h.task.input.state.pressed,
    h.instance.collection.reference(h.instance.collection.lookup('b', 0)),
  );
}
const flags = (h) => Object.fromEntries(fieldNames.map((name) => [name, h.instance[name]]));
function observe(h) {
  const rows = [],
    receive = h.task.input.message.bind(h.task.input),
    event = h.task.player.nativeEvent.bind(h.task.player),
    flush = h.task.player.flush.bind(h.task.player),
    traverse = h.runtime.resources.traverse.bind(h.runtime.resources),
    visit = h.runtime.resources.visit.bind(h.runtime.resources),
    sync = h.task.input.sync.bind(h.task.input),
    send = h.world.graphics.send.bind(h.world.graphics),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages),
    message = h.input.message.bind(h.input);
  let current = null;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 10) return receive(words, context);
    const row = {
      key: words[3],
      context,
      order: [],
      events: [],
      visits: [],
      before: flags(h),
      pressed: h.task.input.state.pressed,
    };
    rows.push(row);
    current = row;
    try {
      const value = await receive(words, context);
      row.after = flags(h);
      row.value = value;
      return value;
    } finally {
      current = null;
    }
  };
  h.task.player.nativeEvent = (key, name) => {
    if (current) {
      current.order.push(name);
      current.events.push([key, name]);
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
  h.runtime.resources.visit = (entry, semantic, context) => {
    if (current) current.visits.push({ id: entry.id, entry: context.executorEntry });
    return visit(entry, semantic, context);
  };
  h.task.input.sync = (...args) => {
    if (current) current.order.push('input-sync');
    return sync(...args);
  };
  h.world.graphics.send = (target, sender, code, ...args) => {
    if (current && code === 94) current.order.push('94');
    return send(target, sender, code, ...args);
  };
  h.world.engineMessages.dispatch = (target, sender, code, ...args) => {
    if (current && code === 145) current.order.push('145');
    return dispatch(target, sender, code, ...args);
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: (code, ...args) => {
      if (current && [152, 125].includes(code)) {
        current.order.push(String(code));
        current.sourceAtMouse = h.task.input.state.source;
      }
      return message(code, ...args);
    },
  });
  return rows;
}
function checkTail(h, row, order) {
  assert.deepEqual(row.order, order);
  assert.equal(row.value, 0);
  assert.equal(row.sourceAtMouse, 0);
  assert.ok(row.context.executorEntry);
  assert.deepEqual(
    row.visits.map((v) => v.id),
    h.runtime.resources.entries.map((entry) => entry.id),
  );
  assert.ok(row.visits.length > 0);
  assert.ok(row.visits.every((v) => v.entry === row.context.executorEntry));
}
function pause125(h) {
  const entered = Promise.withResolvers(),
    gate = Promise.withResolvers(),
    receive = h.task.input.message.bind(h.task.input),
    message = h.input.message.bind(h.input);
  let inRelease = false,
    armed = true;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 10) return receive(words, context);
    inRelease = true;
    try {
      return await receive(words, context);
    } finally {
      inRelease = false;
    }
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: async (code, ...args) => {
      const value = await message(code, ...args);
      if (inRelease && code === 125 && armed) {
        armed = false;
        entered.resolve();
        await gate.promise;
      }
      return value;
    },
  });
  return { entered: entered.promise, ...gate };
}
for (const profile of profiles) {
  test(`${profile}: actual Graph direction releases write only their original fields and traverse the same FIFO before returning`, async () => {
    const h = await open(profile);
    try {
      const rows = observe(h),
        object = h.instance.collection.lookup('b', 0);
      for (const [key, event, field] of directions) {
        await press(h, key);
        const first = rows.length;
        h.input.key(key, false);
        await h.world.tick();
        const actual = rows.slice(first);
        assert.ok(actual.length > 0);
        for (const row of actual) {
          checkTail(h, row, ['152', '125', event, 'flush', '94', 'resources', 'input-sync']);
          assert.deepEqual(row.events, [[object.key, event]]);
          assert.equal(row.after[field], object.handle);
          for (const other of fieldNames.filter((name) => name !== field))
            assert.equal(row.after[other], row.before[other]);
        }
        assert.deepEqual(h.task.input.state.pressed, h.instance.collection.reference(object));
        assert.equal(h.task.input.state.source, 0);
        assert.equal(h.instance.inputSource, 1);
        assert.equal(
          h.instance.global(40),
          0,
          'direction labels are not dispatched by either frozen event table',
        );
      }
      await press(h, 4);
      const first = rows.length;
      h.input.pointer(90, 90, 1);
      h.input.key(4, false);
      await h.world.tick();
      const empty = rows.slice(first);
      assert.ok(empty.length > 0);
      for (const row of empty) {
        checkTail(h, row, ['152', '125', 'RELEASE_UP', 'flush', '94', 'resources', 'input-sync']);
        assert.deepEqual(row.events, [[null, 'RELEASE_UP']]);
        assert.equal(row.after.releaseUp, -1);
      }
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: actual Graph default keys and explicit UINTMAX message skip nativeEvent/flush; missing saved direction also preserves the early return`, async () => {
    const h = await open(profile);
    try {
      const rows = observe(h);
      for (const key of [2, 79]) {
        await press(h, key);
        const first = rows.length;
        h.input.key(key, false);
        await h.world.tick();
        const actual = rows.slice(first);
        assert.ok(actual.length > 0);
        for (const row of actual) {
          checkTail(h, row, ['152', '125', '94', 'resources', 'input-sync']);
          assert.deepEqual(row.events, []);
          assert.deepEqual(row.after, row.before);
        }
      }
      const forced = h.world.effekseer.createExecutor('release-default-boundary'),
        sender = h.instance.collection.lookup('other', 0).nativeInputTaskID,
        first = rows.length;
      let borrowed;
      // UINTMAX is not a physical 80-key producer; it is a defined FES message switch-default input.
      await h.world.withExecutor(forced, (executorEntry) => {
        borrowed = executorEntry;
        return h.world.sendEngine(h.id, sender, 10, 0, 0xffffffff, { executorEntry });
      });
      assert.equal(rows.length, first + 1);
      const row = rows.at(-1);
      checkTail(h, row, ['152', '125', '94', 'resources', 'input-sync']);
      assert.equal(row.context.executorEntry, borrowed);
      assert.deepEqual(row.after, row.before);
      assert.deepEqual(row.events, []);
      assert.equal(h.instance.global(40), 0);
    } finally {
      await h.world.close();
    }
    const missing = await open(profile);
    try {
      await press(missing, 4);
      const saved = missing.task.input.state.pressed;
      await missing.world.sendEngine(missing.id, missing.world.main.id, 337, 0, 0, {
        payload: { string: () => 'DELETE' },
      });
      assert.equal(missing.instance.collection.lookup(saved.nameBytes, saved.index), null);
      const rows = observe(missing);
      missing.input.key(4, false);
      await missing.world.tick();
      assert.ok(
        rows.length > 0,
        'normal capture route must reach missing-name consumer without a forced route',
      );
      for (const row of rows) {
        checkTail(missing, row, ['152', '125', '94', 'resources', 'input-sync']);
        assert.deepEqual(row.events, []);
        assert.deepEqual(row.after, row.before);
      }
      assert.equal(missing.task.input.state.pressed, saved);
    } finally {
      await missing.world.close();
    }
  });
  test(`${profile}: direction/default real125 close resolve/reject cancels later work; live125/resource errors still propagate`, async () => {
    for (const key of [4, 2])
      for (const rejected of [false, true]) {
        const h = await open(profile);
        let pending, gate;
        try {
          await press(h, key);
          const rows = observe(h);
          gate = pause125(h);
          h.input.key(key, false);
          pending = h.world.tick();
          await Promise.race([
            gate.entered,
            pending.then(() => {
              throw new Error('release completed before real125 wait');
            }),
          ]);
          await h.world.objects.release(h.id);
          if (rejected) gate.reject(new Error('cancelled release-key125'));
          else gate.resolve();
          await pending;
          assert.ok(rows.length > 0);
          assert.ok(rows.every((row) => row.order.join(',') === '152,125'));
          assert.equal(h.runtime.closed, true);
          assert.equal(h.instance.finished, null);
          assert.equal(h.instance.global(40), 0);
        } finally {
          gate?.resolve();
          await pending?.catch(() => {});
          await h.world.close();
        }
      }
    for (const stage of ['125', 'resources']) {
      const h = await open(profile);
      try {
        const key = stage === '125' ? 2 : 4;
        await press(h, key);
        if (stage === '125') {
          const gate = pause125(h);
          h.input.key(key, false);
          const pending = h.world.tick();
          await gate.entered;
          gate.reject(new Error('live release-key125 failure'));
          await assert.rejects(pending, /live release-key125/);
        } else {
          const receive = h.task.input.message.bind(h.task.input),
            traverse = h.runtime.resources.traverse.bind(h.runtime.resources);
          let inRelease = false;
          h.task.input.message = async (words, context) => {
            if (words[1] !== 10) return receive(words, context);
            inRelease = true;
            try {
              return await receive(words, context);
            } finally {
              inRelease = false;
            }
          };
          h.runtime.resources.traverse = (context) => {
            if (inRelease) throw new Error('live release-key resources failure');
            return traverse(context);
          };
          h.input.key(key, false);
          await assert.rejects(h.world.tick(), /live release-key resources/);
          assert.equal(h.instance.releaseUp, h.instance.collection.lookup('b', 0).handle);
        }
        assert.equal(h.runtime.closed, false);
        assert.equal(h.instance.finished, null);
        assert.equal(h.instance.global(40), 0);
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: settled fresh World restores held direction/pressed identity and executes the normal release tail without replay`, async () => {
    const h = await open(profile);
    let fresh;
    try {
      await press(h, 4);
      const saved = h.task.input.state.pressed,
        state = h.world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      fresh.ensureNativeEngine = () => {
        throw new Error('direction release restore must stay JavaScript');
      };
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        if (name !== 'case.kcs') throw new Error('release-key replayed ' + name);
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
        },
        rows = observe(restored),
        object = restored.instance.collection.lookup('b', 0);
      assert.deepEqual(reads, ['case.kcs']);
      assert.deepEqual(task.input.state.pressed, saved);
      restored.input.key(4, false);
      await fresh.tick();
      assert.ok(rows.length > 0);
      for (const row of rows) {
        checkTail(restored, row, [
          '152',
          '125',
          'RELEASE_UP',
          'flush',
          '94',
          'resources',
          'input-sync',
        ]);
        assert.equal(row.after.releaseUp, object.handle);
      }
      assert.deepEqual(task.input.state.pressed, saved);
      assert.equal(restored.instance.global(40), 0);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await h.world.close();
    }
  });
}
