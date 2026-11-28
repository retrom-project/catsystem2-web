// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { notify } from './fixtures/fes-effekseer-world.mjs';

const utf8 = (s) => new TextEncoder().encode(s),
  text = (bytes) => (typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)),
  source = `#DEFINE
BUTTON b
#OBJECT SIZE POS
b 8,8 40,50,0
#START
$20=20
$21=30
$22=3
$23=11
next IDLE
#IDLE
break
next IDLE
#DEFAULT
automoveex $20++ $21++
$30=++$30
$20=77
$21=88
break
#SIGNED
automoveex -2 12 $22++
$31=++$31
$22=99
break
#WORDS
automoveex 65540 65543 -2
break
#MISSING_X
automoveex
$32=++$32
break
#MISSING_Y
automoveex $23++
$33=++$33
break
#GATE
automoveex 90 95 4
$34=++$34
break
#OFF
setconf 0 autocur
break
#ON
setconf 1 autocur
break
#UNITS
$35=++$35
automoveex 1 2 3%
$36=++$36
break
#b.FOCUS
$10=++$10
break
`;

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
    throw new Error('automoveex must stay in the default JavaScript path');
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

function trace(h) {
  const entries = [],
    actions = [],
    protocol = h.world.engineMessages,
    dispatch = protocol.dispatch.bind(protocol),
    input = h.input.input,
    message = input.message.bind(input);
  let consuming = false;
  if (h.input.consumeAutoMoveEx) {
    const consume = h.input.consumeAutoMoveEx.bind(h.input);
    h.input.consumeAutoMoveEx = async (record) => {
      consuming = true;
      try {
        return await consume(record);
      } finally {
        consuming = false;
      }
    };
  }
  protocol.dispatch = (target, sender, code, w, l, context = {}) => {
    if (consuming) actions.push([code, target, sender, w, l, context.flags]);
    if ([125, 137, 138, 93, 94, 145].includes(code))
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
  return { entries, actions };
}

for (const profile of profiles) {
  test(`${profile}: automoveex copies raw required X/Y and optional frames, preserves signed-low16 OR and return0 FIFO, and reaches actual125→137→138`, async () => {
    const h = await open(profile);
    try {
      const input = h.input.input,
        scriptMouse = { ...h.task.player.mouse },
        getter = h.instance.argumentBytes.bind(h.instance),
        getters = [],
        { entries, actions } = trace(h);
      h.instance.argumentBytes = (token) => {
        getters.push(text(token));
        return getter(token);
      };
      input.pointer(17, 19, 1);
      await notify(h, 'DEFAULT');
      assert.deepEqual(h.runtime.pendingRecords, [
        { operation: 'auto-move-ex', packed: 0x001e0014, frames: 8 },
      ]);
      assert.deepEqual(getters, ['$20++', '$21++']);
      assert.equal(h.instance.global(30), 1);
      assert.equal(h.instance.global(20), 77);
      assert.equal(h.instance.global(21), 88);
      assert.equal(h.instance.nativeQueuePending, false);
      assert.deepEqual(entries, []);
      assert.equal(h.input.state.savedMouse, null);
      await h.runtime.flushRecords();
      const inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
      assert.deepEqual(actions, [
        [125, inputID, h.id, 0, 4, 0],
        [137, inputID, h.id, 8, 0x001e0014, 0],
      ]);
      assert.deepEqual(
        entries.filter((e) => e[0] === 'input'),
        [
          ['input', 137],
          ['input', 138],
        ],
      );
      assert.deepEqual(h.input.state.savedMouse, [17, 19]);
      assert.deepEqual(h.task.player.mouse, scriptMouse);
      assert.deepEqual([input.x, input.y], [17, 19]);
      assert.deepEqual(input.warp, { x: 20, y: 30, remaining: 8, started: input.frame });
      assert.equal(h.input.state.focus, null);
      assert.equal(h.instance.defaultButton, null);
      assert.equal(h.instance.global(10), 0);
      // One real Input tick exercises the existing interpolation authority.
      await input.tick(input.frame + 1);
      assert.deepEqual([input.x, input.y], [17, 20]);
      assert.equal(input.warp.remaining, 7);
      const focusAfterTick = structuredClone(h.input.state.focus);

      actions.length = entries.length = getters.length = 0;
      input.pointer(23, 29, 1);
      await notify(h, 'SIGNED');
      assert.deepEqual(h.runtime.pendingRecords, [
        { operation: 'auto-move-ex', packed: 0xfffffffe, frames: 3 },
      ]);
      assert.deepEqual(getters, ['-2', '12', '$22++']);
      assert.equal(h.instance.global(31), 1);
      assert.equal(h.instance.global(22), 99);
      await h.runtime.flushRecords();
      assert.deepEqual(actions, [
        [125, inputID, h.id, 0, 4, 0],
        [137, inputID, h.id, 3, 0xfffffffe, 0],
      ]);
      assert.deepEqual(
        entries.filter((e) => e[0] === 'input'),
        [
          ['input', 137],
          ['input', 138],
        ],
      );
      assert.deepEqual(h.input.state.savedMouse, [23, 29]);
      // The existing Input consumer falls back to unsigned words when the
      // viewport conversion returns null; this leaf does not alter that path.
      assert.deepEqual(input.warp, {
        x: 65534,
        y: 65535,
        remaining: 3,
        started: input.frame,
      });

      actions.length = entries.length = 0;
      await notify(h, 'WORDS');
      assert.deepEqual(h.runtime.pendingRecords, [
        { operation: 'auto-move-ex', packed: 0x00070004, frames: -2 },
      ]);
      await h.runtime.flushRecords();
      assert.deepEqual(actions, [
        [125, inputID, h.id, 0, 4, 0],
        [137, inputID, h.id, -2, 0x00070004, 0],
      ]);
      assert.deepEqual(input.warp, {
        x: 4,
        y: 7,
        remaining: 0xfffffffe,
        started: input.frame,
      });

      actions.length = entries.length = getters.length = 0;
      await notify(h, 'MISSING_X');
      assert.deepEqual(getters, []);
      await notify(h, 'MISSING_Y');
      assert.deepEqual(getters, ['$23++']);
      assert.equal(h.instance.global(23), 12);
      assert.equal(h.instance.global(32), 1);
      assert.equal(h.instance.global(33), 1);
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.deepEqual(actions, []);

      await notify(h, 'GATE');
      assert.deepEqual(h.runtime.pendingRecords, [
        { operation: 'auto-move-ex', packed: 0x005f005a, frames: 4 },
      ]);
      const saved = [...h.input.state.savedMouse],
        warp = { ...input.warp };
      await notify(h, 'OFF');
      await h.runtime.flushRecords();
      assert.deepEqual(actions, []);
      assert.deepEqual(h.input.state.savedMouse, saved);
      assert.deepEqual(input.warp, warp);
      assert.equal(h.instance.global(34), 1);
      assert.deepEqual(h.runtime.pendingRecords, []);
      await notify(h, 'ON');
      assert.deepEqual(h.input.state.focus, focusAfterTick);
      assert.equal(h.instance.defaultButton, null);
      assert.equal(h.instance.global(10), 0);

      // A numeric operand is not the coordinate helper's trailing-% unit form.
      // This asserts the current expression boundary, not native error wording.
      await assert.rejects(notify(h, 'UNITS'), /expression/);
      assert.equal(h.instance.global(35), 1);
      assert.equal(h.instance.global(36), 0);
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.deepEqual(actions, []);
    } finally {
      await h.world.close();
    }
  });
}
