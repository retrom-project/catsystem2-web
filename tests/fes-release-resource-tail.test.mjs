// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  source = `#DEFINE
BUTTON b
BUTTON other
CIMAGE c
#OBJECT SIZE POS
b 16,16 30,40,0
other 16,16 60,40,0
#OBJECT SIZE POS PRI COLOR DISP
c 4,4 5,6,0 200 0xffffffff 1
#START
b setact
next IDLE
#IDLE
break
next IDLE
#SWITCH
other setact
break
#DELETE
lockactive 1
b delete
break
#b.PUSH_L
$10=17
break
#b.PUSH_R
$11=23
break
#b.RELEASE_L
c pos 20 30 0 1
$12=37
break
#b.RELEASE_R
c pos 40 50 0 1
$13=43
break
#other.RELEASE_L
$14=73
break
#other.RELEASE_R
$15=79
break
`,
  modal = source.replace('c pos 20 30 0 1', 'config_open\nc pos 20 30 0 1'),
  unhandled = source.replace('#b.RELEASE_L\nc pos 20 30 0 1\n$12=37\nbreak\n', '');
async function open(profile, text = source) {
  const world = await defaultFESWorld(profile, { 'screen.fes': ascii(text) });
  world.ensureNativeEngine = () => {
    throw new Error('release must stay in the default JavaScript path');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    h.task.input.input.pointer(31, 41, 1);
    return { ...h, world, input: h.task.input.input, runtime: h.instance.runtime };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
    payload: fesLabelPayload(() => label),
  });
function position(h) {
  const entry = h.runtime.resources.entries.find((entry) => entry.savedType === 1);
  return h.draw.entry(entry.image.binding.key).position.slice();
}
async function press(h, key = 0) {
  h.input.key(key, true);
  await h.world.tick();
  assert.deepEqual(
    h.task.input.state.pressed,
    h.instance.collection.reference(h.instance.collection.lookup('b', 0)),
  );
}
function observe(h) {
  const releases = [],
    receive = h.task.input.message.bind(h.task.input),
    event = h.task.player.nativeEvent.bind(h.task.player),
    sync = h.task.input.sync.bind(h.task.input),
    traverse = h.runtime.resources.traverse.bind(h.runtime.resources),
    message = h.input.message.bind(h.input),
    send = h.world.graphics.send.bind(h.world.graphics),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
  let current = null;
  h.task.input.message = async (words, context) => {
    if (words[1] !== 10) return receive(words, context);
    const row = {
      key: words[3],
      context,
      order: [],
      resets: [],
      pressed: h.task.input.state.pressed,
    };
    releases.push(row);
    current = row;
    try {
      const result = await receive(words, context);
      row.result = result;
      if (h.world.objects.objects.has(h.id)) row.position = position(h);
      return result;
    } finally {
      current = null;
    }
  };
  h.task.player.nativeEvent = (key, name) => {
    if (current) current.order.push(name);
    return event(key, name);
  };
  h.task.input.sync = (...args) => {
    if (current) current.order.push('input-sync');
    return sync(...args);
  };
  h.runtime.resources.traverse = (context) => {
    if (current) current.order.push('resources');
    return traverse(context);
  };
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: (code, ...args) => {
      if (current && [125, 152].includes(code)) {
        current.order.push(String(code));
        current.sourceAtMouse = h.task.input.state.source;
      }
      return message(code, ...args);
    },
  });
  h.world.graphics.send = (target, sender, code, ...args) => {
    if (current && code === 94) current.order.push('94');
    return send(target, sender, code, ...args);
  };
  h.world.engineMessages.dispatch = (target, sender, code, w, l, context) => {
    if (current && code === 145) {
      current.order.push('145');
      current.resets.push({
        target,
        sender,
        w,
        l,
        flags: context.flags,
        entry: context.executorEntry,
      });
    }
    return dispatch(target, sender, code, w, l, context);
  };
  return releases;
}
function pause145(h) {
  const entered = Promise.withResolvers(),
    gate = Promise.withResolvers(),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
  h.world.engineMessages.dispatch = async (target, sender, code, ...args) => {
    const result = await dispatch(target, sender, code, ...args);
    if (sender === h.id && code === 145) {
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  return { entered: entered.promise, ...gate };
}
for (const profile of profiles) {
  test(`${profile}: actual World RELEASE_L/R keeps pressed target, sends owning145 before resources and returns updated retained state`, async () => {
    const h = await open(profile);
    try {
      const before = position(h),
        rows = observe(h);
      for (const key of [0, 1]) {
        await press(h, key);
        const saved = h.task.input.state.pressed;
        await notify(h, 'SWITCH');
        assert.equal(h.task.input.state.pressed, saved);
        h.input.key(key, false);
        const first = rows.length;
        await h.world.tick();
        const actual = rows.slice(first);
        assert.ok(actual.length > 0);
        for (const row of actual) {
          assert.deepEqual(row.order, [
            '152',
            '125',
            key ? 'RELEASE_R' : 'RELEASE_L',
            '145',
            'resources',
            'input-sync',
          ]);
          assert.equal(row.sourceAtMouse, 0);
          assert.equal(row.result, 0);
          assert.equal(row.pressed, saved);
          assert.deepEqual(row.position, [
            before[0] + (key ? 35 : 15),
            before[1] + (key ? 44 : 24),
          ]);
          assert.deepEqual(row.resets, [
            {
              target: h.world.engineMessages.closestTop(h.id).implementation.input,
              sender: h.id,
              w: 0,
              l: 0,
              flags: 0,
              entry: row.context.executorEntry,
            },
          ]);
          assert.ok(row.context.executorEntry);
        }
        assert.equal(h.task.input.state.pressed, saved);
        assert.equal(h.task.input.state.source, 0);
        assert.equal(h.instance.inputSource, 1);
        assert.equal(h.instance[key ? 'clickR' : 'clickL'], 0);
        assert.equal(h.input.forceCursor, true);
        assert.equal(h.instance.global(key ? 13 : 12), key ? 43 : 37);
        assert.equal(h.instance.global(key ? 15 : 14), 0);
      }
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: unhandled, NULL and missing pressed paths stay distinct; sleeping is a legal FES-message gate with94 only`, async () => {
    const h = await open(profile, unhandled);
    try {
      await press(h);
      const rows = observe(h),
        saved = h.task.input.state.pressed;
      h.input.key(0, false);
      await h.world.tick();
      assert.ok(rows.length > 0);
      assert.ok(
        rows.every((row) => row.order.join(',') === '152,125,RELEASE_L,94,resources,input-sync'),
      );
      assert.equal(h.task.input.state.pressed, saved);
      assert.equal(h.instance.clickL, 0);
    } finally {
      await h.world.close();
    }
    const empty = await open(profile);
    try {
      await press(empty);
      // The ordinary FES frame already consumed its click field; the traced
      // NULL event below still distinguishes it from missing-name's early return.
      const rows = observe(empty);
      empty.input.pointer(90, 90, 1);
      empty.input.key(0, false);
      await empty.world.tick();
      assert.ok(rows.length > 0);
      assert.ok(rows.every((row) => row.pressed === null));
      assert.ok(
        rows.every((row) => row.order.join(',') === '152,125,RELEASE_L,94,resources,input-sync'),
      );
      assert.equal(empty.instance.clickL, 0);
      assert.equal(empty.instance.global(12), 0);
    } finally {
      await empty.world.close();
    }
    const missing = await open(profile);
    try {
      await press(missing);
      const saved = missing.task.input.state.pressed,
        click = missing.instance.clickL;
      await notify(missing, 'DELETE');
      assert.equal(missing.instance.collection.lookup(saved.nameBytes, saved.index), null);
      assert.equal(missing.task.input.state.pressed, saved);
      const rows = observe(missing);
      missing.input.key(0, false);
      await missing.world.tick();
      assert.ok(rows.length > 0, 'normal capture route must reach the consumer; no forced route');
      assert.ok(rows.every((row) => row.order.join(',') === '152,125,94,resources,input-sync'));
      assert.equal(missing.instance.clickL, click);
      assert.equal(missing.task.input.state.pressed, saved);
      assert.equal(missing.instance.global(12), 0);
    } finally {
      await missing.world.close();
    }
    const sleeping = await open(profile);
    try {
      await press(sleeping);
      await sleeping.world.sendEngine(sleeping.id, sleeping.world.main.id, 342, 0, 1);
      const rows = observe(sleeping),
        saved = sleeping.task.input.state.pressed,
        click = sleeping.instance.clickL,
        sender = sleeping.instance.collection.lookup('b', 0).nativeInputTaskID;
      // Input masking prevents ordinary hardware delivery; this is the exposed FES message boundary.
      await sleeping.world.sendEngine(sleeping.id, sender, 10, 0, 0);
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].order, ['94']);
      assert.equal(sleeping.task.input.state.source, 0);
      assert.equal(sleeping.task.input.state.pressed, saved);
      assert.equal(sleeping.instance.clickL, click);
      assert.equal(sleeping.instance.inputSource, 1);
    } finally {
      await sleeping.world.close();
    }
  });
  test(`${profile}: real RELEASE Host/145 waits cancel after owner close and retain issued reset; live Host/145/resource failures propagate`, async () => {
    for (const stage of ['host', '145'])
      for (const rejected of [false, true]) {
        const h = await open(profile, stage === 'host' ? modal : source),
          gate = stage === 'host' ? Promise.withResolvers() : null,
          entered = stage === 'host' ? Promise.withResolvers() : null;
        let pending, pause;
        try {
          await press(h);
          const rows = observe(h);
          if (stage === 'host')
            h.world.host.nativeWindowAction = (action) => {
              if (action.type === 'fes-owner-close') return 1;
              assert.equal(action.type, 'fes-configuration');
              entered.resolve();
              return gate.promise;
            };
          else pause = pause145(h);
          h.input.key(0, false);
          pending = h.world.tick();
          await Promise.race([
            entered?.promise ?? pause.entered,
            pending.then(() => {
              throw new Error('release completed before its actual wait');
            }),
          ]);
          if (stage === '145') assert.equal(h.input.forceCursor, true);
          await h.world.objects.release(h.id);
          const request = gate ?? pause;
          if (rejected) request.reject(new Error('cancelled actual release ' + stage));
          else request.resolve(1);
          await pending;
          assert.ok(rows.length > 0);
          assert.ok(
            rows.every(
              (row) => !row.order.includes('resources') && !row.order.includes('input-sync'),
            ),
          );
          assert.equal(h.instance.global(12), stage === '145' ? 37 : 0);
          assert.equal(h.instance.finished, null);
          assert.equal(h.runtime.closed, true);
          if (stage === '145') assert.equal(h.input.forceCursor, true);
        } finally {
          gate?.resolve(1);
          pause?.resolve(1);
          await pending?.catch(() => {});
          await h.world.close();
        }
      }
    for (const stage of ['host', '145', 'resources']) {
      const h = await open(profile, stage === 'host' ? modal : source);
      try {
        await press(h);
        if (stage === 'host')
          h.world.host.nativeWindowAction = (action) => {
            if (action.type === 'fes-owner-close') return 1;
            throw new Error('live release host failure');
          };
        if (stage === '145') {
          const dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
          h.world.engineMessages.dispatch = async (target, sender, code, ...args) => {
            const value = await dispatch(target, sender, code, ...args);
            if (sender === h.id && code === 145) throw new Error('live release145 failure');
            return value;
          };
        }
        if (stage === 'resources') {
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
            if (inRelease) throw new Error('live release resources failure');
            return traverse(context);
          };
        }
        h.input.key(0, false);
        await assert.rejects(h.world.tick(), /live release/);
        assert.equal(h.runtime.closed, false);
        assert.equal(h.instance.finished, null);
        assert.equal(h.instance.global(12), stage === 'host' ? 0 : 37);
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: settled fresh World retains the pressed reference and performs real RELEASE145/resource tail without source replay`, async () => {
    const h = await open(profile);
    let fresh;
    try {
      await press(h);
      const saved = h.task.input.state.pressed,
        state = h.world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      fresh.ensureNativeEngine = () => {
        throw new Error('release restore must stay JavaScript');
      };
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        if (name !== 'case.kcs') throw new Error('release replayed ' + name);
        return read(name);
      };
      await fresh.restore(state);
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = {
          id: h.id,
          world: fresh,
          task,
          instance: task.player.root,
          runtime: task.player.root.runtime,
          input: task.input.input,
          draw: fresh.graphics.drawTasks.get(h.surface),
        },
        before = position(restored),
        rows = observe(restored);
      assert.deepEqual(reads, ['case.kcs']);
      assert.deepEqual(task.input.state.pressed, saved);
      restored.input.key(0, false);
      await fresh.tick();
      assert.ok(rows.length > 0);
      assert.ok(
        rows.every((row) => row.order.join(',') === '152,125,RELEASE_L,145,resources,input-sync'),
      );
      assert.ok(
        rows.every(
          (row) => row.position[0] === before[0] + 15 && row.position[1] === before[1] + 24,
        ),
      );
      assert.equal(restored.instance.global(12), 37);
      assert.equal(h.instance.global(12), 0);
      assert.deepEqual(task.input.state.pressed, saved);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await h.world.close();
    }
  });
}

test('Game real RELEASE consumes EFK FILE/Play inside the same Input callback on its live executor', async () => {
  const { open: openEFK, task: effectTask } = await import('./fixtures/fes-effekseer-world.mjs'),
    text = `#DEFINE
BUTTON b
EFKPLANE fx
#OBJECT SIZE POS
b 16,16 30,40,0
#OBJECT FILE
fx scene.efk
#START
b setact
next IDLE
#IDLE
break
next IDLE
#b.PUSH_L
$10=17
break
#b.RELEASE_L
fx load other.efk
fx play
$12=37
break
`,
    h = await openEFK({ text }),
    world = h.world;
  try {
    await world.withExecutor(world.effekseer.frameExecutor, (executorEntry) =>
      world.sendEngine(h.id, world.main.id, 333, 0, 0, { executorEntry }),
    );
    const input = h.task.input.input,
      tick = input.tick.bind(input),
      receive = h.task.input.message.bind(h.task.input),
      t = effectTask(h),
      play = t.manager.play.bind(t.manager),
      samples = [],
      returns = [];
    let inInput = false,
      entry;
    Object.defineProperty(input, 'tick', {
      value: async (frame, context) => {
        inInput = true;
        entry = context.executorEntry;
        try {
          return await tick(frame, context);
        } finally {
          inInput = false;
        }
      },
    });
    t.manager.play = (...args) => {
      samples.push([inInput, args[2]]);
      return play(...args);
    };
    h.task.input.message = async (words, context) => {
      const result = await receive(words, context);
      if (words[1] === 10) {
        const fx = h.instance.collection.lookup('fx', 0);
        returns.push([
          context.executorEntry,
          fx.resourcePending,
          fx.playDirty,
          t.manager.sets.size,
        ]);
      }
      return result;
    };
    input.pointer(31, 41, 1);
    input.key(0, true);
    await world.tick();
    assert.deepEqual(samples, []);
    input.key(0, false);
    await world.tick();
    assert.equal(h.instance.global(12), 37);
    assert.ok(returns.length > 0);
    assert.ok(
      returns.every(([e, file, pending, size]) => e === entry && !file && !pending && size > 0),
    );
    assert.ok(samples.length > 0);
    assert.ok(samples.every(([inside, thread]) => inside && thread === 'frame'));
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});
