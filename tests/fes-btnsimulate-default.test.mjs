// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  text = (bytes) => new TextDecoder().decode(bytes),
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
#PULSE
btnsimulate 0 1
break
#WORDS
btnsimulate 79 -2147483647
break
#ZERO
btnsimulate 79 0
break
#SWITCH
other setact
break
#MISSING
btnsimulate
btnsimulate ++$20
$51=19
break
#DEFER
automove b
btnsimulate
break
#VALUES
btnsimulate $str7 $str8 $str9
$52=29
break
#EMPTY
btnsimulate $str10 $str11
break
#PENDING
btnsimulate 0 1
$50=17
break
#OUT
btnsimulate 80 1
$50=17
break
#NEGATIVE
btnsimulate -1 1
$50=17
break
#b.PUSH_L
$10=17
break
#b.RELEASE_L
$11=23
break
#other.PUSH_L
$12=37
break
#other.RELEASE_L
$13=43
break
`;
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': ascii(source) });
  world.ensureNativeEngine = () => {
    throw new Error('btnsimulate must stay in the default JavaScript path');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return { ...h, world, input: h.task.input.input, runtime: h.instance.runtime };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: fesLabelPayload(() => label) });
function observe(h) {
  const sent = [],
    returns = [],
    records = [],
    protocol = h.world.engineMessages,
    dispatch = protocol.dispatch.bind(protocol),
    command = h.runtime.buttonSimulate.bind(h.runtime),
    fifo = h.runtime.pendingRecords,
    push = fifo.push.bind(fifo);
  protocol.dispatch = (target, sender, code, w, l, context) => {
    if ([93, 125, 137, 138, 145, 154].includes(code))
      sent.push({ target, sender, code, w, l, flags: context?.flags });
    return dispatch(target, sender, code, w, l, context);
  };
  Object.defineProperty(h.runtime, 'buttonSimulate', {
    value: (args) => {
      const result = command(args);
      returns.push(result);
      return result;
    },
  });
  Object.defineProperty(fifo, 'push', {
    value: (record) => {
      records.push(structuredClone(record));
      return push(record);
    },
  });
  return { sent, returns, records };
}
function pause154(h) {
  const entered = Promise.withResolvers(),
    gate = Promise.withResolvers(),
    protocol = h.world.engineMessages,
    dispatch = protocol.dispatch.bind(protocol);
  let armed = true;
  protocol.dispatch = async (target, sender, code, ...args) => {
    const result = await dispatch(target, sender, code, ...args);
    if (sender === h.id && code === 154 && armed) {
      armed = false;
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  return { entered: entered.promise, ...gate };
}
for (const profile of profiles) {
  test(`${profile}: normal337 btnsimulate queues two int32 values, returns-3 and reaches actual154; real tick reads the later active reference`, async () => {
    const h = await open(profile);
    try {
      const seen = observe(h),
        focus = structuredClone(h.task.input.state.focus),
        mouse = { ...h.task.player.mouse },
        inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
      await notify(h, 'WORDS');
      assert.deepEqual(seen.returns, [-3]);
      assert.deepEqual(seen.records, [
        { operation: 'button-simulate', index: 79, value: -2147483647 },
      ]);
      assert.deepEqual(seen.sent, [
        { target: inputID, sender: h.id, code: 154, w: 79, l: -2147483647, flags: 0 },
      ]);
      assert.equal(h.input.pulses[79], 0x80000001);
      await notify(h, 'ZERO');
      assert.equal(h.input.pulses[79], 0);
      assert.deepEqual(h.task.input.state.focus, focus);
      assert.equal(h.task.input.state.savedMouse, null);
      assert.deepEqual(h.task.player.mouse, mouse);
      await notify(h, 'PULSE');
      assert.equal(h.instance.global(10), 0);
      assert.equal(h.input.pulses[0], 1);
      assert.equal(h.instance.nativeQueuePending, false);
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.deepEqual(h.task.input.state.focus, focus);
      await notify(h, 'SWITCH');
      h.input.pointer(61, 41, 1);
      await h.world.tick();
      assert.equal(h.instance.global(10), 0);
      assert.equal(h.instance.global(12), 37);
      assert.equal(h.input.pulses[0], 0);
      await h.world.tick();
      assert.equal(h.instance.global(11), 0);
      assert.equal(h.instance.global(13), 43);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: required getter/eval order preserves missing-second effects, expanded-empty0 and the same prior FIFO without reading operand3`, async () => {
    const h = await open(profile);
    try {
      const seen = observe(h),
        bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        replacements = h.world.configuration.scriptReplacements,
        calls = [],
        scripts = [],
        expand = bank.expandBytes.bind(bank),
        apply = replacements.apply.bind(replacements);
      bank.setBytes(7, ascii('KEY'));
      bank.setBytes(8, ascii('COUNT'));
      bank.setBytes(9, ascii('++$39'));
      bank.setBytes(10, new Uint8Array());
      bank.setBytes(11, ascii('\0++$38'));
      replacements.add(ascii('KEY'), ascii('++$20'));
      replacements.add(ascii('COUNT'), ascii('++$21'));
      bank.expandBytes = (bytes) => {
        calls.push(text(bytes));
        return expand(bytes);
      };
      replacements.apply = (bytes) => {
        scripts.push(text(bytes));
        return apply(bytes);
      };
      await notify(h, 'MISSING');
      assert.deepEqual(seen.returns, [0, 0]);
      assert.deepEqual(seen.sent, []);
      assert.equal(h.instance.global(20), 1);
      assert.equal(h.instance.global(51), 19);
      await notify(h, 'DEFER');
      assert.deepEqual(seen.returns, [0, 0, 0]);
      assert.equal(h.runtime.pendingRecords.length, 1);
      assert.equal(h.runtime.pendingRecords[0].operation, 'auto-move');
      assert.deepEqual(seen.sent, []);
      calls.length = scripts.length = 0;
      await notify(h, 'VALUES');
      assert.equal(h.instance.global(20), 2);
      assert.equal(h.instance.global(21), 1);
      assert.equal(h.instance.global(39), 0);
      assert.equal(h.instance.global(52), 29);
      assert.deepEqual(
        seen.sent.map((call) => call.code),
        [125, 137, 154],
      );
      assert.deepEqual(seen.records.at(-1), { operation: 'button-simulate', index: 2, value: 1 });
      assert.equal(calls.filter((v) => v === '$str7').length, 1);
      assert.equal(calls.filter((v) => v === '$str8').length, 1);
      assert.equal(calls.includes('$str9'), false);
      assert.equal(scripts.filter((v) => v === 'KEY').length, 1);
      assert.equal(scripts.filter((v) => v === 'COUNT').length, 1);
      assert.equal(scripts.includes('++$20'), false);
      await notify(h, 'EMPTY');
      assert.deepEqual(seen.records.at(-1), { operation: 'button-simulate', index: 0, value: 0 });
      assert.equal(h.instance.global(38), 0);
      assert.equal(h.input.pulses[0], 0);
      assert.deepEqual(seen.returns, [0, 0, 0, -3, -3]);
      assert.deepEqual(h.runtime.pendingRecords, []);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: actual154 owner-close resolve/reject retains issued pulse and cancels continuation; live failures and unsafe key indices remain errors`, async () => {
    for (const rejected of [false, true]) {
      const h = await open(profile);
      try {
        const gate = pause154(h),
          pending = notify(h, 'PENDING');
        await gate.entered;
        assert.equal(h.input.pulses[0], 1);
        await h.world.objects.release(h.id);
        if (rejected) gate.reject(new Error('cancelled actual154'));
        else gate.resolve();
        await pending;
        assert.equal(h.instance.global(50), 0);
        assert.equal(h.instance.finished, null);
        assert.equal(h.runtime.closed, true);
        assert.equal(h.input.pulses[0], 1);
        assert.deepEqual(h.runtime.pendingRecords, []);
      } finally {
        await h.world.close();
      }
    }
    const live = await open(profile);
    try {
      const gate = pause154(live),
        pending = notify(live, 'PENDING');
      await gate.entered;
      gate.reject(new Error('live actual154 failure'));
      await assert.rejects(pending, /live actual154 failure/);
      assert.equal(live.input.pulses[0], 1);
      assert.equal(live.instance.global(50), 0);
      assert.equal(live.runtime.closed, false);
    } finally {
      await live.world.close();
    }
    for (const label of ['OUT', 'NEGATIVE']) {
      const h = await open(profile);
      try {
        await assert.rejects(notify(h, label), /pulse crosses the 80-key table/);
        assert.equal(h.instance.global(50), 0);
        assert.ok(h.input.pulses.every((word) => word === 0));
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: shared physical pulse authority and key gate restore settled in a fresh World without setter or source replay`, async () => {
    const h = await open(profile);
    let fresh;
    try {
      h.world.inputBindings = new NativeInputBindings(h.world.input, h.world.configuration);
      h.input.pointer(31, 41, 1);
      const inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
      await h.world.engineMessages.dispatch(inputID, h.world.main.id, 150, 0, 0, { flags: 0 });
      await notify(h, 'PULSE');
      assert.equal(h.world.inputBindings.injected[0], 1);
      assert.equal(h.input.pulses[0], 0);
      const state = h.world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      fresh.ensureNativeEngine = () => {
        throw new Error('btnsimulate fresh restore must stay JavaScript');
      };
      const reads = [],
        setters = [],
        read = fresh.game.read.bind(fresh.game),
        dispatch = fresh.engineMessages.dispatch.bind(fresh.engineMessages);
      fresh.game.read = (name) => {
        reads.push(name);
        if (name !== 'case.kcs') throw new Error('btnsimulate restore replayed ' + name);
        return read(name);
      };
      fresh.engineMessages.dispatch = (target, sender, code, ...args) => {
        if (code === 154) setters.push([target, sender, ...args]);
        return dispatch(target, sender, code, ...args);
      };
      await fresh.restore(state);
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = { world: fresh, id: h.id, task, instance: task.player.root },
        input = task.input.input;
      assert.deepEqual(reads, ['case.kcs']);
      assert.deepEqual(setters, []);
      assert.equal(fresh.inputBindings.input, input);
      assert.equal(fresh.inputBindings.injected[0], 1);
      assert.equal(input.pulses[0], 0);
      assert.equal(input.enabled[0], 0);
      await fresh.tick();
      assert.equal(restored.instance.global(10), 0);
      await fresh.engineMessages.dispatch(inputID, fresh.main.id, 150, 0, 1, { flags: 0 });
      await notify(restored, 'PULSE');
      assert.equal(setters.length, 1);
      await fresh.tick();
      assert.equal(restored.instance.global(10), 17);
      assert.equal(fresh.inputBindings.injected[0], 0);
      assert.equal(input.pulses[0], 0);
      assert.equal(h.world.inputBindings.injected[0], 1);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await h.world.close();
    }
  });
}
