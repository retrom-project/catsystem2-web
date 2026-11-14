// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { EngineHost } from '../src/host.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

async function expectMissingHead(instance, invoke, head) {
  const getters = [],
    argument = instance.argumentBytes,
    records = structuredClone(instance.runtime.pendingRecords),
    queuePending = instance.nativeQueuePending,
    commands = instance.player.pending.size;
  instance.argumentBytes = function (token, ...args) {
    getters.push(typeof token === 'string' ? token : new TextDecoder().decode(token));
    return argument.call(this, token, ...args);
  };
  try {
    await assert.rejects(
      async () => invoke(),
      (error) => {
        assert.equal(
          error.message.endsWith('FES whole-row evaluator is pending: ' + head),
          true,
          error.message,
        );
        return true;
      },
    );
  } finally {
    instance.argumentBytes = argument;
  }
  assert.deepEqual(getters, [head, head], 'only the two native head getter stages ran');
  assert.deepEqual(instance.runtime.pendingRecords, records);
  assert.equal(instance.nativeQueuePending, queuePending);
  assert.equal(instance.player.pending.size, commands);
}

const utf8 = (value) => new TextEncoder().encode(value),
  string = (bytes) => new TextDecoder().decode(bytes),
  reference = (ref) => (ref === null ? null : [string(ref.nameBytes), ref.index]),
  declarations =
    '#DEFINE\nBUTTON single\nBUTTON many[3]\nSTRING other\n#OBJECT SIZE POS PRI DISP ENABLE\nsingle 8,8 10,10 60000 1 1\nmany 8,8 20,20 60001 1 1\n#OBJECT SIZE\nother 8,8\n#START\nnext IDLE\n#IDLE\n';
function blocks(values) {
  return Object.entries(values)
    .map(([label, lines]) => `#${label}\n${lines}\nbreak\n`)
    .join('');
}
async function open(profile, values = {}, lateSlots = []) {
  const world = await defaultFESWorld(profile, {
    'screen.fes': utf8(
      lateSlots.length
        ? '#MACRO\n' +
            lateSlots.map((slot) => `LATE_${slot} $str${slot}`).join('\n') +
            '\n' +
            (declarations + blocks(values)).replace(/\$str(\d+)/g, (token, slot) =>
              lateSlots.includes(Number(slot)) ? `LATE_${slot}` : token,
            )
        : declarations + blocks(values),
    ),
  });
  try {
    const seedBank = lateSlots.length
        ? world.runtime.stringBank(world.objects.objects.get(world.main.id))
        : null,
      savedSlots = lateSlots.map((slot) => [slot, seedBank.getBytes(slot)]);
    for (const [slot] of savedSlots) seedBank.setBytes(slot, utf8(`$str${slot}`));
    const h = await loadDefaultFES(world);
    for (const [slot, bytes] of savedSlots) {
      if (bytes === undefined) seedBank.entries.delete(slot);
      else seedBank.setBytes(slot, bytes);
    }
    await h.task.tick();
    return { ...h, world, input: h.task.input };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, label) => h.task.player.notify(label),
  drain = (h) => h.instance.runtime.flushRecords();
async function declare(h, type, name) {
  const data = new Uint8Array(36),
    view = new DataView(data.buffer);
  data.set(utf8(name));
  view.setUint32(32, 1, true);
  await h.world.sendEngine(
    h.id,
    h.world.main.id,
    338,
    0,
    FES_OBJECT_DEFINITION_ORDER.indexOf(type),
    {
      payload: {
        string: (at) => string(data.subarray(at, data.indexOf(0, at))),
        bytes: (at, count) => data.subarray(at, at + count),
        load: (at) => view.getUint32(at, true),
      },
    },
  );
  await h.instance.runtime.initializeResources();
}
async function fresh(h) {
  const state = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    read = world.game.read.bind(world.game),
    reads = [];
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('input reference restore replayed ' + name);
    return read(name);
  };
  try {
    await world.restore(state);
    const task = world.objects.objects.get(h.id).implementation;
    return { world, id: h.id, task, instance: task.player.root, input: task.input, reads };
  } catch (error) {
    await world.close();
    throw error;
  }
}
function inputTrace(h) {
  const calls = [],
    send = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
  h.world.engineMessages.dispatch = (target, sender, message, w, l, context = {}) => {
    if (message === 93) calls.push([target, sender, w, l, context.flags]);
    return send(target, sender, message, w, l, context);
  };
  return calls;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const profile of profiles) {
  test(`${profile}: input A uses actual FES Button children and Top Input, with no bare aliases`, async () => {
    const h = await open(profile);
    try {
      const top = h.world.engineMessages.closestTop(h.id),
        id = top.implementation.input,
        button = h.instance.collection.lookup('single', 0),
        child = h.world.objects.objects.get(button.nativeInputTaskID);
      assert.equal(h.world.objects.objects.get(id).kind, 11);
      assert.deepEqual([child.kind, child.parent], [6, h.id]);
      assert.equal(
        h.world.engineMessages.children(h.world.objects.objects.get(id)).includes(child),
        false,
      );
      for (const verb of ['noact', 'setact']) {
        const bare = await open(profile, { DO: verb + ' single' });
        try {
          await assert.rejects(
            notify(bare, 'DO'),
            new RegExp('FES whole-row evaluator is pending: ' + verb),
          );
        } finally {
          await bare.world.close();
        }
      }
      assert.deepEqual(h.instance.runtime.pendingRecords, []);
      assert.equal(h.instance.defaultButton, null);
      assert.equal(h.input.state.focus, null);
      const reply = await h.world.engineMessages.dispatch(id, h.id, 93, 0, 1, { flags: 0 });
      assert.equal(reply.result, NATIVE_UNWRITTEN_WORD);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A noact queues once for a disabled raw6 and copies default only at drain`, async () => {
    const h = await open(profile, {
      OFF: 'single enable 0',
      DO: 'single noact',
      'single.FOCUS': '$20=++$20',
    });
    try {
      await notify(h, 'OFF');
      await h.task.syncObjects();
      const calls = inputTrace(h);
      await notify(h, 'DO');
      assert.equal(h.instance.defaultButton, null);
      assert.equal(h.input.state.focus, null);
      assert.equal(h.instance.deferredCommandReturn, null);
      assert.deepEqual(
        h.instance.runtime.pendingRecords.map((r) => [r.operation, reference(r.reference)]),
        [['default-reference', ['single', 0]]],
      );
      assert.deepEqual(calls, []);
      await drain(h);
      assert.deepEqual(reference(h.instance.defaultButton), ['single', 0]);
      assert.equal(h.input.state.focus, null);
      assert.equal(h.instance.global(20), 0);
      assert.deepEqual(calls, []);
      assert.deepEqual(h.instance.runtime.pendingRecords, []);
      // These empty refs are typed FIFO inputs, not claims about source production.
      h.instance.runtime.pendingRecords.push({
        operation: 'default-reference',
        reference: { nameBytes: new Uint8Array(), index: 7 },
      });
      await drain(h);
      assert.equal(h.instance.defaultButton, null);
      h.instance.runtime.pendingRecords.push({
        operation: 'active-reference',
        reference: { nameBytes: new Uint8Array(), index: 7 },
      });
      await drain(h);
      assert.deepEqual(reference(h.input.state.focus), ['', 7]);
      assert.deepEqual(calls, []);
      const f = await fresh(h);
      try {
        assert.deepEqual(reference(f.input.state.focus), ['', 7]);
        assert.equal(f.task.player.focused, null);
      } finally {
        await f.world.close();
      }
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A singleton omission normalizes while real multi -1 skips optional evaluation`, async () => {
    const h = await open(profile, {
      SINGLE: 'single noact ++$10',
      MANY: 'many noact ++$10',
      MISSING: 'many[9] noact ++$10\n$60=++$60',
      NEGATIVE: 'many[-2] setact ++$10\n$60=++$60',
    });
    try {
      await notify(h, 'SINGLE');
      assert.equal(h.instance.global(10), 1);
      await notify(h, 'MANY');
      assert.equal(h.instance.global(10), 1);
      await expectMissingHead(h.instance, () => notify(h, 'MISSING'), 'many[9]');
      assert.equal(h.instance.global(10), 1);
      assert.equal(h.instance.global(60), 0);
      // The wrapper's missing-target behavior is independent of normal head admission.
      assert.equal(
        await h.instance.runtime.command('noact', { nameBytes: utf8('many'), index: 9 }, [
          utf8('++$10'),
        ]),
        0,
      );
      assert.equal(h.instance.global(10), 2);
      await expectMissingHead(h.instance, () => notify(h, 'NEGATIVE'), 'many[-2]');
      assert.equal(h.instance.global(10), 2);
      assert.equal(h.instance.global(60), 0);
      assert.equal(
        await h.instance.runtime.command('setact', { nameBytes: utf8('many'), index: -2 }, [
          utf8('++$10'),
        ]),
        0,
      );
      assert.equal(h.instance.global(10), 3);
      assert.deepEqual(
        h.instance.runtime.pendingRecords.map((r) => reference(r.reference)),
        [['single', 0]],
      );
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A optional getter expands bank and SCRIPT once with zero, empty, absent and error boundaries`, async () => {
    const h = await open(
      profile,
      {
        EVAL: 'single noact $str0',
        ZERO: 'single noact 0',
        EMPTY: 'single noact $str1',
        NONE: 'single noact',
      },
      [0, 1],
    );
    try {
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        bankCalls = [],
        scriptCalls = [],
        expand = bank.expandBytes.bind(bank),
        script = h.world.configuration.scriptReplacements,
        apply = script.apply.bind(script),
        values = [],
        evaluate = h.instance.value.bind(h.instance);
      bank.setBytes(0, utf8('SIDE'));
      bank.setBytes(1, Uint8Array.of(0, 63, 63));
      script.add(utf8('SIDE'), utf8('++$10'));
      bank.expandBytes = (bytes) => {
        bankCalls.push(string(bytes));
        return expand(bytes);
      };
      script.apply = (bytes) => {
        scriptCalls.push(string(bytes));
        return apply(bytes);
      };
      h.instance.value = (bytes, ...args) => {
        values.push(typeof bytes === 'string' ? bytes : string(bytes));
        return evaluate(bytes, ...args);
      };
      await notify(h, 'EVAL');
      assert.equal(h.instance.global(10), 1);
      assert.equal(bankCalls.filter((s) => s === '$str0').length, 1);
      assert.equal(scriptCalls.filter((s) => s === 'SIDE').length, 1);
      await notify(h, 'ZERO');
      await notify(h, 'EMPTY');
      await notify(h, 'NONE');
      assert.equal(values.filter((s) => s === '0').length, 1);
      assert.equal(
        values.includes(''),
        false,
        'native empty-number helper exits before the general expression parser',
      );
      assert.equal(h.instance.runtime.pendingRecords.length, 4);
      await assert.rejects(
        h.instance.runtime.command('noact', h.instance.runtime.reference(utf8('single')), [
          utf8('???'),
        ]),
        /expected|unknown|invalid|unexpected/i,
      );
      assert.equal(h.instance.runtime.pendingRecords.length, 4);
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A absent and non-BUTTON current targets still evaluate before their no-record gate`, async () => {
    const h = await open(profile, {
      DROP: 'many[1] delete',
      WRONG: 'other setact ++$10',
      HOLE: 'many[1] noact ++$10\n$60=++$60',
      '_TOPOBJ_.CHECK': '@ noact ++$10\n$60=++$60',
    });
    try {
      await notify(h, 'DROP');
      await h.task.syncObjects();
      await notify(h, 'WRONG');
      assert.equal(h.instance.global(10), 1);
      await expectMissingHead(h.instance, () => notify(h, 'HOLE'), 'many[1]');
      assert.equal(h.instance.global(10), 1);
      assert.equal(h.instance.global(60), 0);
      assert.equal(
        await h.instance.runtime.command('noact', { nameBytes: utf8('many'), index: 1 }, [
          utf8('++$10'),
        ]),
        0,
      );
      assert.equal(h.instance.global(10), 2);
      // This existing JS lookup route returns a real BASE/raw0 top object.
      // It is separate from the ordinary native tuple-map missing-record gate.
      const top = h.instance.collection.lookup(utf8('_TOPOBJ_'), 0),
        savedContext = structuredClone(h.instance.nativeContext),
        topGetters = [],
        topCommands = [],
        argument = h.instance.argumentBytes,
        command = h.instance.runtime.command;
      assert.equal(top.nativeType, 0);
      assert.equal(h.instance.collection.graph.get(top.handle), top);
      h.instance.argumentBytes = function (token, ...args) {
        topGetters.push(typeof token === 'string' ? token : string(token));
        return argument.call(this, token, ...args);
      };
      h.instance.runtime.command = async function (verb, selection, args, context) {
        const entry = structuredClone(h.instance.nativeContext),
          result = await command.call(this, verb, selection, args, context);
        topCommands.push({
          verb,
          reference: reference(selection),
          entry,
          bytes: context.commandBytes.slice(),
          result,
        });
        return result;
      };
      try {
        assert.equal(await h.task.player.notify('CHECK', '_TOPOBJ_', 0), true);
      } finally {
        h.instance.argumentBytes = argument;
        h.instance.runtime.command = command;
      }
      assert.deepEqual(topGetters, ['@', 'noact', '++$10']);
      assert.deepEqual(topCommands, [
        {
          verb: 'noact',
          reference: ['_TOPOBJ_', 0],
          entry: { nameBytes: utf8('_TOPOBJ_'), index: 0, current: 0 },
          bytes: utf8('@ noact ++$10'),
          result: 0,
        },
      ]);
      assert.deepEqual(h.instance.nativeContext, savedContext);
      assert.equal(h.instance.collection.lookup(utf8('_TOPOBJ_'), 0), top);
      assert.equal(h.instance.global(60), 1, 'native0 runs the real top handler continuation');
      assert.equal(h.instance.global(10), 3);
      assert.deepEqual(h.instance.runtime.pendingRecords, []);
      assert.equal(h.instance.defaultButton, null);
      assert.equal(h.input.state.focus, null);
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A queued references own Buffer and bank bytes and resolve a new same-key task at drain`, async () => {
    const h = await open(profile, { DO: 'si$str0 setact', 'single.FOCUS': '$20=++$20' });
    try {
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id));
      bank.setBytes(0, utf8('ngle'));
      await notify(h, 'DO');
      bank.setBytes(0, utf8('many[2]'));
      const name = Buffer.from('single'),
        old = h.instance.collection.lookup('single', 0),
        oldTask = old.nativeInputTaskID;
      await h.instance.runtime.command('setact', { name: 'single', nameBytes: name, index: 0 }, []);
      name.fill(0);
      for (const record of h.instance.runtime.pendingRecords) {
        assert.deepEqual(reference(record.reference), ['single', 0]);
        assert.equal(record.reference.nameBytes.constructor, Uint8Array);
      }
      await h.instance.collection.remove(old);
      await declare(h, 'BUTTON', 'single');
      const current = h.instance.collection.lookup('single', 0);
      assert.notEqual(current.handle, old.handle);
      assert.notEqual(current.nativeInputTaskID, oldTask);
      await drain(h);
      assert.equal(h.task.player.focused.o, current);
      assert.deepEqual(reference(h.input.state.focus), ['single', 0]);
      assert.equal(h.instance.global(20), 2);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A setact preserves mouse, Input, UNFOCUS, copy, Input, FOCUS and appended FIFO order`, async () => {
    const h = await open(profile, {
      OLD: 'single setact',
      NEW: 'many[1] setact',
      'single.UNFOCUS': '$20=++$20',
      'many.FOCUS': '$21=@\n@ noact',
    });
    try {
      await notify(h, 'OLD');
      await drain(h);
      const input = h.world.inputFor(h.id),
        query = input.message.bind(input),
        trace = [],
        send = h.world.engineMessages.dispatch.bind(h.world.engineMessages),
        event = h.instance.dispatchEvent.bind(h.instance),
        inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
      input.pointer(17, 19, 1);
      input.message = (message, ...args) => {
        if ([152, 125].includes(message)) trace.push(['mouse', message]);
        return query(message, ...args);
      };
      h.world.engineMessages.dispatch = (target, sender, message, w, l, context = {}) => {
        if (message === 93)
          trace.push([
            'input',
            target,
            sender,
            w,
            l,
            context.flags,
            reference(h.input.state.focus),
          ]);
        return send(target, sender, message, w, l, context);
      };
      h.instance.dispatchEvent = (object, name) => {
        trace.push(['event', object.key, name, reference(h.input.state.focus)]);
        return event(object, name);
      };
      const regions = input.regions.map((r) => [r.owner, r.active]);
      await notify(h, 'NEW');
      await drain(h);
      assert.deepEqual(trace, [
        ['mouse', 152],
        ['mouse', 125],
        ['input', inputID, h.id, 0, 0, 1, ['single', 0]],
        ['event', 'single', 'UNFOCUS', ['single', 0]],
        ['input', inputID, h.id, 0, 1, 1, ['many', 1]],
        ['event', 'many[1]', 'FOCUS', ['many', 1]],
      ]);
      assert.deepEqual(reference(h.instance.defaultButton), ['many', 1]);
      assert.equal(h.instance.global(20), 1);
      assert.equal(h.instance.global(21), 1);
      assert.deepEqual([input.x, input.y], [17, 19]);
      assert.deepEqual(h.task.player.mouse, { x: 17, y: 19 });
      assert.deepEqual(
        input.regions.map((r) => [r.owner, r.active]),
        regions,
      );
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A repeats identical refs and tick retains missing/nonraw6 but clears disabled raw6 through fresh restore`, async () => {
    const h = await open(profile, {
      DO: 'single setact',
      OFF: 'single enable 0',
      'single.FOCUS': '$20=++$20',
      'single.UNFOCUS': '$21=++$21',
    });
    try {
      await notify(h, 'DO');
      await drain(h);
      await notify(h, 'DO');
      await drain(h);
      assert.equal(h.instance.global(20), 2);
      assert.equal(h.instance.global(21), 1);
      const calls = inputTrace(h);
      await h.instance.collection.remove(h.instance.collection.lookup('single', 0));
      for (const type of [null, 'STRING', 'BUTTON']) {
        if (type) await declare(h, type, 'single');
        const current = h.instance.collection.lookup('single', 0);
        if (type === 'BUTTON') await notify(h, 'OFF');
        await h.input.tick();
        assert.deepEqual(reference(h.input.state.focus), type === 'BUTTON' ? null : ['single', 0]);
        assert.equal(h.task.player.focused?.o ?? null, type === 'STRING' ? current : null);
        const f = await fresh(h);
        try {
          await f.input.tick();
          assert.deepEqual(
            reference(f.input.state.focus),
            type === 'BUTTON' ? null : ['single', 0],
          );
          assert.deepEqual(f.reads, ['case.kcs']);
        } finally {
          await f.world.close();
        }
        if (current) await h.instance.collection.remove(current);
      }
      assert.deepEqual(calls, []);
      assert.equal(h.instance.global(20), 2);
      assert.equal(h.instance.global(21), 1);
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: input A canonical93 is unwritten at Input and only flags1 routes real Input children`, async () => {
    const h = await open(profile, { DO: 'single setact' });
    try {
      const id = h.world.engineMessages.closestTop(h.id).implementation.input,
        graph = await h.world.objects.create({
          kind: 6,
          parent: id,
          creator: h.id,
          name: 'authored Input child',
        });
      await h.world.graphics.send(
        graph,
        h.id,
        89,
        0,
        0,
        new NativeGraphicsPacket([1, 1, 3, 3, 10, 0]),
      );
      const region = h.world.inputFor(h.id).get(graph);
      assert.equal(region.active, 0);
      const reply = await h.world.engineMessages.dispatch(id, h.id, 93, 0, 1, { flags: 0 });
      assert.equal(reply.result, NATIVE_UNWRITTEN_WORD);
      assert.equal(region.active, 0);
      await notify(h, 'DO');
      await drain(h);
      assert.equal(region.active, true);
      assert.equal(
        h.world.inputFor(h.id).get(h.instance.collection.lookup('single', 0).nativeInputTaskID)
          .active,
        false,
      );
      assert.deepEqual(reference(h.input.state.focus), ['single', 0]);
    } finally {
      await h.world.close();
    }
  });

  test(
    `${profile}: input A snapshots current/default/pending refs once and owner-close cancels an awaiting UNFOCUS`,
    { timeout: 2000 },
    async () => {
      const h = await open(profile, {
        OLD: 'single setact\nmany[1] noact',
        NEXT: 'many[2] setact\nsingle noact',
        'single.FOCUS': '$20=++$20',
        'single.UNFOCUS': '$21=++$21',
        'many.FOCUS': '$22=++$22',
      });
      try {
        await notify(h, 'OLD');
        await drain(h);
        await notify(h, 'NEXT');
        const snapshot = h.task.snapshot(),
          f = await fresh(h);
        try {
          assert.deepEqual(reference(snapshot.input.focus), ['single', 0]);
          assert.deepEqual(reference(snapshot.player.root.defaultButton), ['many', 1]);
          assert.equal(Object.hasOwn(snapshot.player, 'focused'), false);
          assert.equal(f.task.player.focused.o, f.instance.collection.lookup('single', 0));
          assert.deepEqual(
            f.instance.runtime.pendingRecords.map((r) => [r.operation, reference(r.reference)]),
            [
              ['active-reference', ['many', 2]],
              ['default-reference', ['single', 0]],
            ],
          );
          snapshot.input.focus.nameBytes.fill(0);
          snapshot.player.root.defaultButton.nameBytes.fill(0);
          assert.deepEqual(reference(f.input.state.focus), ['single', 0]);
          await drain(f);
          assert.deepEqual(reference(f.input.state.focus), ['many', 2]);
          assert.deepEqual(reference(f.instance.defaultButton), ['single', 0]);
          assert.equal(f.instance.global(20), 1);
          assert.equal(f.instance.global(21), 1);
          assert.equal(f.instance.global(22), 1);
          assert.deepEqual(f.reads, ['case.kcs']);
          assert.equal(f.world.nativeEngine, undefined);
        } finally {
          await f.world.close();
        }
      } finally {
        await h.world.close();
      }
      for (const phase of ['mouse', 'unfocus']) {
        const modal = await open(profile, {
            OLD: 'single setact',
            NEXT: 'many[0] setact',
            HOLD: 'config_open\n$40=99',
            'single.UNFOCUS': phase === 'unfocus' ? 'config_open\n$40=99' : '',
          }),
          dom = nativeWindowDOM(),
          opened = deferred(),
          canceled = deferred(),
          gate = deferred(),
          queryEntered = deferred(),
          queryGate = deferred(),
          calls = inputTrace(modal),
          queries = [];
        modal.world.host.engine = {};
        modal.world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
        modal.world.host.nativeWindowAction = function (action, owner) {
          const result = EngineHost.prototype.nativeWindowAction.call(this, action, owner);
          if (action.type === 'fes-configuration') opened.resolve();
          if (action.type === 'fes-owner-close') {
            canceled.resolve();
            return gate.promise.then(() => result);
          }
          return result;
        };
        let request, closing, hold;
        try {
          await notify(modal, 'OLD');
          await drain(modal);
          calls.length = 0;
          const player = modal.task.player,
            mouse = { ...player.mouse },
            input = modal.world.inputFor(modal.id),
            query = input.message.bind(input);
          if (phase === 'mouse') {
            input.pointer(71, 73, 1);
            input.message = async (message, ...args) => {
              const result = await query(message, ...args);
              if ([152, 125].includes(message)) queries.push(message);
              if (message === 152) {
                queryEntered.resolve();
                await queryGate.promise;
              }
              return result;
            };
          }
          await notify(modal, 'NEXT');
          request = drain(modal);
          if (phase === 'mouse') {
            await queryEntered.promise;
            hold = notify(modal, 'HOLD');
          }
          await opened.promise;
          const record = modal.world.objects.objects.get(modal.id);
          closing = modal.world.objects.release(modal.id);
          await canceled.promise;
          assert.equal(modal.task.player, player);
          assert.equal(record.state, 'releasing');
          assert.equal(modal.instance.runtime.closed, true);
          queryGate.resolve();
          await request;
          await hold;
          assert.deepEqual(reference(modal.input.state.focus), ['single', 0]);
          assert.deepEqual(
            calls.map((v) => v.slice(2)),
            phase === 'mouse' ? [] : [[0, 0, 1]],
          );
          if (phase === 'mouse') {
            assert.deepEqual(queries, [152]);
            assert.deepEqual(player.mouse, mouse);
          }
          assert.equal(modal.instance.global(40), 0);
          assert.equal(record.exitCode, -1);
          assert.equal(modal.instance.finished, null);
          gate.resolve();
          await closing;
          assert.equal(modal.world.nativeEngine, undefined);
        } finally {
          queryGate.resolve();
          gate.resolve();
          modal.world.host.windowService?.close();
          await request?.catch(() => {});
          await hold?.catch(() => {});
          await closing?.catch(() => {});
          await modal.world.close();
          dom.dispose();
        }
      }
    },
  );
}
