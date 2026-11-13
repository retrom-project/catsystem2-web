// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const utf8 = (s) => new TextEncoder().encode(s),
  text = (b) => new TextDecoder().decode(b),
  pack = (x, y) => ((x & 65535) | ((y & 65535) << 16)) >>> 0,
  source = `#DEFINE
CIMAGE target
#OBJECT SIZE POS
target 8,8 61,73,0
#START
target keypos 1 0 0
next IDLE
#IDLE
#MOVE
automove target
break
#RESTORE
restoremove $str7 ++$40
$30=++$30
break
#ROUNDTRIP
automove target
restoremove $str7 ++$40
$31=++$31
break
#FLUSH
restoremove $str7 ++$40
lockactive
$33=++$33
break
#OFF
setconf 0 autocur
break
#ON
setconf 1 autocur
break
#target.FOCUS
$10=++$10
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
  world.ensureNativeEngine = () => {
    throw new Error('restoremove must use the default JS path');
  };
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
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: fesLabelPayload(() => label) });
async function capture(h, x = 17, y = 19) {
  h.input.input.pointer(x, y, 1);
  await notify(h, 'MOVE');
  await h.runtime.flushRecords();
  assert.deepEqual(h.input.state.savedMouse, [x, y]);
}
function trace(h) {
  const values = [],
    protocol = h.world.engineMessages,
    dispatch = protocol.dispatch.bind(protocol),
    input = h.input.input,
    message = input.message.bind(input);
  protocol.dispatch = (target, sender, code, w, l, context = {}) => {
    if ([125, 137, 138, 93, 145].includes(code))
      values.push(['engine', code, target, sender, w, l, context.flags]);
    return dispatch(target, sender, code, w, l, context);
  };
  Object.defineProperty(input, 'message', {
    configurable: true,
    writable: true,
    value: (code, ...args) => {
      if (code === 137 || code === 138) values.push(['input', code]);
      return message(code, ...args);
    },
  });
  return values;
}
function pause137(h) {
  const entered = deferred(),
    gate = deferred(),
    protocol = h.world.engineMessages,
    dispatch = protocol.dispatch.bind(protocol);
  let armed = true;
  protocol.dispatch = async (target, sender, code, ...args) => {
    const result = await dispatch(target, sender, code, ...args);
    if (sender === h.id && code === 137 && armed) {
      armed = false;
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  return { entered: entered.promise, ...gate };
}
async function fresh(h) {
  const snapshot = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    queries = [],
    read = world.game.read.bind(world.game),
    dispatch = world.engineMessages.dispatch.bind(world.engineMessages);
  world.ensureNativeEngine = () => {
    throw new Error('restoremove fresh must stay JS');
  };
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('restoremove replayed ' + name);
    return read(name);
  };
  world.engineMessages.dispatch = (target, sender, code, ...args) => {
    if (code === 125 || code === 137) queries.push(code);
    return dispatch(target, sender, code, ...args);
  };
  try {
    await world.restore(snapshot);
    const task = world.objects.objects.get(h.id).implementation;
    return {
      world,
      id: h.id,
      task,
      input: task.input,
      instance: task.player.root,
      runtime: task.player.root.runtime,
      reads,
      queries,
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
for (const profile of profiles) {
  test(`${profile}: parameterless restoremove ignores operands, returns0 and reads the current saved point only at dequeue through actual137→138`, async () => {
    const h = await open(profile);
    try {
      const seen = trace(h);
      h.input.input.pointer(17, 19, 1);
      assert.equal(h.input.state.savedMouse, null);
      await notify(h, 'ROUNDTRIP');
      assert.deepEqual(h.runtime.pendingRecords, [
        { operation: 'auto-move', x: 61, y: 73 },
        { operation: 'restore-move' },
      ]);
      assert.equal(h.instance.global(31), 1);
      assert.equal(h.instance.nativeQueuePending, false);
      assert.equal(h.input.state.savedMouse, null);
      assert.deepEqual(seen, []);
      await h.runtime.flushRecords();
      const inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
      assert.deepEqual(
        seen.filter((x) => x[0] === 'engine'),
        [
          ['engine', 125, inputID, h.id, 0, 4, 0],
          ['engine', 137, inputID, h.id, 4, pack(61, 73), 0],
          ['engine', 137, inputID, h.id, 4, pack(17, 19), 0],
        ],
      );
      const saved = h.input.state.savedMouse,
        scriptMouse = { ...h.task.player.mouse },
        bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        replacements = h.world.configuration.scriptReplacements,
        calls = [],
        scripts = [],
        expand = bank.expandBytes.bind(bank),
        apply = replacements.apply.bind(replacements);
      bank.setBytes(7, utf8('IGNORED'));
      replacements.add(utf8('IGNORED'), utf8('++$41'));
      bank.expandBytes = (bytes) => {
        calls.push(text(bytes));
        return expand(bytes);
      };
      replacements.apply = (bytes) => {
        scripts.push(text(bytes));
        return apply(bytes);
      };
      seen.length = 0;
      h.input.input.pointer(47, 53, 1);
      await notify(h, 'RESTORE');
      assert.deepEqual(h.runtime.pendingRecords, [{ operation: 'restore-move' }]);
      assert.equal(h.instance.global(30), 1);
      assert.equal(h.instance.global(40), 0);
      assert.equal(h.instance.global(41), 0);
      assert.equal(calls.includes('$str7'), false);
      assert.equal(scripts.includes('IGNORED'), false);
      assert.deepEqual(seen, []);
      await h.runtime.flushRecords();
      assert.deepEqual(seen, [
        ['engine', 137, inputID, h.id, 4, pack(17, 19), 0],
        ['input', 137],
        ['input', 138],
      ]);
      assert.equal(h.input.state.savedMouse, saved);
      assert.deepEqual(saved, [17, 19]);
      assert.deepEqual(h.task.player.mouse, scriptMouse);
      assert.equal(h.input.state.focus, null);
      assert.equal(h.instance.defaultButton, null);
      assert.equal(h.instance.global(10), 0);
      const input = h.input.input,
        frame = input.frame;
      assert.deepEqual([input.x, input.y], [47, 53]);
      await input.tick(frame + 1);
      assert.deepEqual([input.x, input.y], [40, 45]);
      await input.tick(frame + 2);
      await input.tick(frame + 3);
      assert.deepEqual([input.x, input.y], [17, 19]);
      assert.equal(input.warp, null);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: restoremove checks current autocur before reading unknown savedMouse, never queries125 and keeps gate decisions out of the wrapper`, async () => {
    const unknown = await open(profile);
    try {
      const seen = trace(unknown);
      await notify(unknown, 'RESTORE');
      assert.deepEqual(unknown.runtime.pendingRecords, [{ operation: 'restore-move' }]);
      await notify(unknown, 'OFF');
      await unknown.runtime.flushRecords();
      assert.deepEqual(seen, []);
      assert.equal(unknown.input.state.savedMouse, null);
      await notify(unknown, 'ON');
      await assert.rejects(notify(unknown, 'FLUSH'), /restoremove.*known.*saved mouse/);
      assert.deepEqual(seen, []);
      assert.equal(unknown.input.state.savedMouse, null);
      assert.equal(unknown.instance.global(33), 0);
      assert.equal(unknown.instance.finished, null);
    } finally {
      await unknown.world.close();
    }
    const h = await open(profile);
    try {
      await capture(h);
      const saved = h.input.state.savedMouse,
        seen = trace(h);
      await notify(h, 'RESTORE');
      await notify(h, 'OFF');
      await h.runtime.flushRecords();
      assert.deepEqual(seen, []);
      assert.equal(h.input.state.savedMouse, saved);
      await notify(h, 'RESTORE');
      await notify(h, 'ON');
      await h.runtime.flushRecords();
      assert.deepEqual(
        seen.filter((x) => x[0] === 'engine').map((x) => x[1]),
        [137],
      );
      assert.equal(h.input.state.savedMouse, saved);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: ordinary337 pending restore137 close resolve/reject cancels following FIFO work while live errors preserve issued movement`, async () => {
    for (const rejected of [false, true]) {
      const h = await open(profile);
      try {
        await capture(h);
        const saved = h.input.state.savedMouse,
          input = h.input.input,
          seen = trace(h),
          gate = pause137(h),
          pending = notify(h, 'FLUSH');
        await gate.entered;
        assert.deepEqual(input.warp, { x: 17, y: 19, remaining: 4, started: input.frame });
        await h.world.objects.release(h.id);
        if (rejected) gate.reject(new Error('cancelled restore137'));
        else gate.resolve();
        assert.equal(await pending, NATIVE_UNWRITTEN_WORD);
        assert.deepEqual(
          seen.filter((x) => x[0] === 'engine').map((x) => x[1]),
          [137],
        );
        assert.equal(h.input.state.savedMouse, saved);
        assert.deepEqual(input.warp, { x: 17, y: 19, remaining: 4, started: input.frame });
        assert.equal(h.instance.global(33), 0);
        assert.equal(h.instance.finished, null);
        assert.equal(h.runtime.closed, true);
      } finally {
        await h.world.close();
      }
    }
    const h = await open(profile);
    try {
      await capture(h);
      const saved = h.input.state.savedMouse,
        gate = pause137(h),
        pending = notify(h, 'FLUSH');
      await gate.entered;
      gate.reject(new Error('live restore137'));
      await assert.rejects(pending, /live restore137/);
      assert.equal(h.input.state.savedMouse, saved);
      assert.equal(h.instance.global(33), 0);
      assert.equal(h.runtime.closed, false);
      assert.equal(h.world.objects.objects.get(h.id).state, 'active');
      assert.deepEqual(h.input.input.warp, {
        x: 17,
        y: 19,
        remaining: 4,
        started: h.input.input.frame,
      });
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: fresh World retains unknown/known savedMouse and operation-only restore records without recapture, overwriting or replay`, async () => {
    const h = await open(profile);
    let unknown, known;
    try {
      await notify(h, 'RESTORE');
      unknown = await fresh(h);
      assert.deepEqual(unknown.reads, ['case.kcs']);
      assert.deepEqual(unknown.queries, []);
      assert.equal(unknown.input.state.savedMouse, null);
      assert.deepEqual(unknown.runtime.pendingRecords, [{ operation: 'restore-move' }]);
      await assert.rejects(unknown.runtime.flushRecords(), /restoremove.*known.*saved mouse/);
      assert.deepEqual(unknown.queries, []);
      await notify(h, 'OFF');
      await h.runtime.flushRecords();
      await notify(h, 'ON');
      await capture(h, 65540, 65543);
      await notify(h, 'RESTORE');
      h.input.input.pointer(100, 200, 1);
      known = await fresh(h);
      assert.deepEqual(known.reads, ['case.kcs']);
      assert.deepEqual(known.queries, []);
      assert.deepEqual(known.input.state.savedMouse, [65540, 65543]);
      const saved = known.input.state.savedMouse;
      assert.deepEqual(known.runtime.pendingRecords, [{ operation: 'restore-move' }]);
      await known.runtime.flushRecords();
      assert.deepEqual(known.queries, [137]);
      assert.equal(known.input.state.savedMouse, saved);
      assert.deepEqual(saved, [65540, 65543]);
      assert.deepEqual(known.input.input.warp, {
        x: 4,
        y: 7,
        remaining: 4,
        started: known.input.input.frame,
      });
      assert.deepEqual([known.input.input.x, known.input.input.y], [100, 200]);
    } finally {
      if (known) await known.world.close();
      if (unknown) await unknown.world.close();
      await h.world.close();
    }
  });
}
