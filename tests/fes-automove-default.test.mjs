// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const utf8 = (s) => new TextEncoder().encode(s),
  text = (b) => new TextDecoder().decode(b),
  packed = (x, y) => ((x & 65535) | ((y & 65535) << 16)) >>> 0,
  points = [
    [13, 24],
    [29, 42],
    [101, 201],
    [50, 60],
    [70, 80],
    [90, 100],
    [65540, 65543],
  ],
  source = `#DEFINE
CIMAGE c
IMAGE i
BUTTON b
PANEL p
SAVEPANEL s
IMGWND w
CIMAGE far
BUTTON many[2]
BGTABLE table
STRING other
PLANE parent
#OBJECT SIZE POS
c 8,8 10,20,0
i 8,8 30,40,0
b 8,8 8,17,0
p 8,8 50,60,0
s 8,8 70,80,0
w 8,8 90,100,0
far 8,8 65540,65543,0
many[0] 8,8 15,16,0
many[1] 8,8 50,51,0
#OBJECT POS BASE
parent 100,200,0 10,20,0
#OBJECT PARENT
b parent
#START
c keypos 1 3 4
i keypos 1 -1 2
b keypos 1 3 4
p keypos 1 0 0
s keypos 1 0 0
w keypos 1 0 0
far keypos 1 0 0
many keypos 1 0 0
next IDLE
#IDLE
#POINTS
automove c
automove i
automove b
automove p
automove s
automove w
automove far
$30=++$30
break
#GATES
automove
automove $str9
automove missing[++$41]
automove table[++$42-1]
automove other
automove many
automove many[99]
automove many[0
$31=++$31
break
#EVAL
automove $str7 $str8
$32=++$32
break
#ONE
automove c
break
#FLUSH
automove c
lockactive
$33=++$33
break
#OFF
setconf 0 autocur
break
#ON
setconf 1 autocur
break
#c.FOCUS
$10=++$10
break
#b.FOCUS
$11=++$11
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
    throw new Error('automove must stay in the default JavaScript path');
  };
  try {
    await world.objects.create({
      kind: 6,
      parent: world.main.id,
      name: 'identity spacer',
      nativeID: 0x70000000,
    });
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
function trace(h) {
  const entries = [],
    protocol = h.world.engineMessages,
    dispatch = protocol.dispatch.bind(protocol),
    input = h.input.input,
    message = input.message.bind(input);
  protocol.dispatch = (target, sender, code, w, l, context = {}) => {
    if ([125, 137, 138, 93, 145].includes(code))
      entries.push(['engine', code, target, sender, w, l, context.flags]);
    return dispatch(target, sender, code, w, l, context);
  };
  Object.defineProperty(input, 'message', {
    configurable: true,
    writable: true,
    value: (code, ...args) => {
      if (code === 137 || code === 138) entries.push(['input', code]);
      return message(code, ...args);
    },
  });
  return entries;
}
function pause125(h) {
  const entered = deferred(),
    gate = deferred(),
    protocol = h.world.engineMessages,
    dispatch = protocol.dispatch.bind(protocol);
  let armed = true;
  protocol.dispatch = async (target, sender, code, w, l, context) => {
    const result = await dispatch(target, sender, code, w, l, context);
    if (sender === h.id && code === 125 && armed) {
      armed = false;
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  return { entered: entered.promise, ...gate };
}
async function fresh(h) {
  const state = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    queries = [],
    read = world.game.read.bind(world.game),
    dispatch = world.engineMessages.dispatch.bind(world.engineMessages);
  world.ensureNativeEngine = () => {
    throw new Error('automove fresh restore must stay JavaScript');
  };
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('automove restore replayed ' + name);
    return read(name);
  };
  world.engineMessages.dispatch = (target, sender, code, ...args) => {
    if (code === 125 || code === 137) queries.push(code);
    return dispatch(target, sender, code, ...args);
  };
  try {
    await world.restore(state);
    const task = world.objects.objects.get(h.id).implementation;
    return { world, id: h.id, task, input: task.input, instance: task.player.root, reads, queries };
  } catch (error) {
    await world.close();
    throw error;
  }
}
for (const profile of profiles) {
  test(`${profile}: normal automove computes all six admitted point slots once, queues return0 and uses actual125→137→138 interpolation without changing focus`, async () => {
    const h = await open(profile);
    try {
      assert.equal(h.input.state.savedMouse, null);
      const input = h.input.input,
        scriptMouse = { ...h.task.player.mouse },
        seen = trace(h);
      input.pointer(17, 19, 1);
      await notify(h, 'POINTS');
      assert.deepEqual(
        h.runtime.pendingRecords,
        points.map(([x, y]) => ({ operation: 'auto-move', x, y })),
      );
      assert.equal(h.instance.global(30), 1);
      assert.equal(h.instance.nativeQueuePending, false);
      assert.deepEqual(seen, []);
      assert.equal(h.input.state.focus, null);
      assert.equal(h.instance.defaultButton, null);
      await h.runtime.flushRecords();
      const inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
      assert.deepEqual(
        seen.filter((e) => e[0] === 'engine'),
        points.flatMap(([x, y]) => [
          ['engine', 125, inputID, h.id, 0, 4, 0],
          ['engine', 137, inputID, h.id, 4, packed(x, y), 0],
        ]),
      );
      assert.deepEqual(
        seen.filter((e) => e[0] === 'input'),
        points.flatMap(() => [
          ['input', 137],
          ['input', 138],
        ]),
      );
      assert.deepEqual(h.input.state.savedMouse, [17, 19]);
      assert.deepEqual(h.task.player.mouse, scriptMouse);
      assert.deepEqual([input.x, input.y], [17, 19]);
      assert.deepEqual(input.warp, { x: 4, y: 7, remaining: 4, started: input.frame });
      assert.equal(h.input.state.focus, null);
      assert.equal(h.instance.global(10), 0);
      assert.equal(h.instance.global(11), 0);
      // Exercise the real tick implementation, not a direct pointer assignment.
      const firstFrame = input.frame;
      await input.tick(firstFrame + 1);
      assert.deepEqual([input.x, input.y], [14, 16]);
      await input.tick(firstFrame + 2);
      await input.tick(firstFrame + 3);
      assert.deepEqual([input.x, input.y], [4, 7]);
      assert.equal(input.warp, null);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: automove getter/index evaluate once, missing/empty/type/group gates and dequeue-time autocur/137 recheck preserve the single FIFO`, async () => {
    const h = await open(profile);
    try {
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        replacements = h.world.configuration.scriptReplacements,
        calls = [],
        scripts = [],
        expand = bank.expandBytes.bind(bank),
        apply = replacements.apply.bind(replacements);
      bank.setBytes(7, utf8('TARGET'));
      bank.setBytes(8, utf8('++$43'));
      bank.setBytes(9, new Uint8Array());
      replacements.add(utf8('TARGET'), utf8('many[++$40-1]'));
      bank.expandBytes = (bytes) => {
        calls.push(text(bytes));
        return expand(bytes);
      };
      replacements.apply = (bytes) => {
        scripts.push(text(bytes));
        return apply(bytes);
      };
      await notify(h, 'GATES');
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.equal(h.instance.global(41), 1);
      assert.equal(h.instance.global(42), 1);
      assert.equal(h.instance.global(31), 1);
      await notify(h, 'OFF');
      await notify(h, 'EVAL');
      assert.equal(h.instance.global(40), 1);
      assert.equal(h.instance.global(43), 0);
      assert.equal(calls.filter((x) => x === '$str7').length, 1);
      assert.equal(calls.filter((x) => x === 'many').length, 4); // Bare many has distinct getter/name-bank calls, plus indexed GATES/EVAL names.
      assert.equal(calls.includes('$str8'), false);
      assert.equal(scripts.filter((x) => x === 'TARGET').length, 1);
      assert.equal(scripts.includes('many[++$40-1]'), false);
      assert.deepEqual(h.runtime.pendingRecords, [{ operation: 'auto-move', x: 15, y: 16 }]);
      const seen = trace(h);
      await h.runtime.flushRecords();
      assert.deepEqual(seen, []);
      assert.equal(h.input.state.savedMouse, null);
      assert.equal(h.input.input.warp, null);
      await notify(h, 'ON');
      h.input.input.pointer(23, 29, 1);
      const gate = pause125(h),
        draining = notify(h, 'FLUSH');
      await gate.entered;
      assert.deepEqual(h.input.state.savedMouse, [23, 29]);
      await notify(h, 'OFF');
      gate.resolve();
      await draining;
      assert.equal(h.instance.global(33), 1);
      assert.deepEqual(
        seen.filter((e) => e[0] === 'engine').map((e) => e[1]),
        [125, 137],
      );
      assert.deepEqual(
        seen.filter((e) => e[0] === 'input'),
        [['input', 137]],
      );
      assert.equal(h.input.input.warp, null);
      assert.deepEqual(h.input.state.savedMouse, [23, 29]);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: actual pending125 normal-source close resolve/reject cancels follow-up137 while live errors and partial/unwritten outputs remain explicit`, async () => {
    for (const rejected of [false, true]) {
      const h = await open(profile);
      try {
        h.input.input.pointer(31, 37, 1);
        const actualInput = h.input.input,
          seen = trace(h),
          gate = pause125(h),
          pending = notify(h, 'FLUSH');
        await gate.entered;
        assert.deepEqual(h.input.state.savedMouse, [31, 37]);
        await h.world.objects.release(h.id);
        if (rejected) gate.reject(new Error('cancelled automove query'));
        else gate.resolve();
        await pending;
        assert.deepEqual(
          seen.filter((e) => e[0] === 'engine').map((e) => e[1]),
          [125],
        );
        assert.equal(h.instance.global(33), 0);
        assert.equal(actualInput.warp, null);
        assert.equal(h.runtime.closed, true);
        assert.equal(h.world.objects.objects.has(h.id), false);
      } finally {
        await h.world.close();
      }
    }
    const unknown = await open(profile);
    try {
      const dispatch = unknown.world.engineMessages.dispatch.bind(unknown.world.engineMessages);
      // These are explicitly typed protocol faults, not authored Input125 producers.
      for (const count of [0, 1]) {
        unknown.world.engineMessages.dispatch = (target, sender, code, w, l, context) => {
          if (code === 125) {
            if (count) context.payload.store(w, 83);
            return 1;
          }
          return dispatch(target, sender, code, w, l, context);
        };
        await notify(unknown, 'ONE');
        await assert.rejects(unknown.runtime.flushRecords(), /automove.*both.*125 outputs/);
        assert.equal(unknown.input.state.savedMouse, null);
        assert.equal(unknown.input.input.warp, null);
      }
    } finally {
      await unknown.world.close();
    }
    const h = await open(profile);
    try {
      const gate = pause125(h),
        pending = notify(h, 'FLUSH');
      await gate.entered;
      gate.reject(new Error('live automove125 failure'));
      await assert.rejects(pending, /live automove125 failure/);
      assert.equal(h.input.input.warp, null);
      assert.deepEqual(h.input.state.savedMouse, [0, 0]);
      await h.runtime.flushRecords();
      const dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
      // Typed protocol fault injection only: the normal NativeInput125 always writes both words.
      for (const count of [0, 1]) {
        h.world.engineMessages.dispatch = (target, sender, code, w, l, context) => {
          if (code === 125) {
            if (count) context.payload.store(w, 83);
            return 1;
          }
          return dispatch(target, sender, code, w, l, context);
        };
        await notify(h, 'ONE');
        await assert.rejects(h.runtime.flushRecords(), /automove.*both.*125 outputs/);
        assert.deepEqual(h.input.state.savedMouse, [0, 0]);
        assert.equal(h.input.input.warp, null);
      }
    } finally {
      await h.world.close();
    }
    const moving = await open(profile);
    try {
      moving.input.input.pointer(47, 53, 1);
      const protocol = moving.world.engineMessages,
        dispatch = protocol.dispatch.bind(protocol);
      protocol.dispatch = async (target, sender, code, ...args) => {
        const result = await dispatch(target, sender, code, ...args);
        if (code === 137) throw new Error('live automove137 failure');
        return result;
      };
      await assert.rejects(notify(moving, 'FLUSH'), /live automove137 failure/);
      assert.deepEqual(moving.input.state.savedMouse, [47, 53]);
      assert.deepEqual(moving.input.input.warp, {
        x: 13,
        y: 24,
        remaining: 4,
        started: moving.input.input.frame,
      });
      assert.equal(moving.instance.global(33), 0);
    } finally {
      await moving.world.close();
    }
  });
  test(`${profile}: unknown/known savedMouse and copied pending XY restore once in a fresh World without constructor queries or source replay`, async () => {
    const h = await open(profile);
    let restored, known;
    try {
      assert.equal(h.input.state.savedMouse, null);
      h.input.input.pointer(41, 43, 1);
      await notify(h, 'ONE');
      restored = await fresh(h);
      assert.deepEqual(restored.reads, ['case.kcs']);
      assert.deepEqual(restored.queries, []);
      assert.equal(restored.input.state.savedMouse, null);
      assert.deepEqual(restored.instance.runtime.pendingRecords, [
        { operation: 'auto-move', x: 13, y: 24 },
      ]);
      await restored.instance.runtime.flushRecords();
      assert.deepEqual(restored.input.state.savedMouse, [41, 43]);
      known = await fresh(restored);
      assert.deepEqual(known.queries, []);
      assert.deepEqual(known.input.state.savedMouse, [41, 43]);
      assert.deepEqual(known.input.input.warp, restored.input.input.warp);
      known.input.state.savedMouse[0] = 99;
      assert.deepEqual(restored.input.state.savedMouse, [41, 43]);
    } finally {
      if (known) await known.world.close();
      if (restored) await restored.world.close();
      await h.world.close();
    }
  });
}
