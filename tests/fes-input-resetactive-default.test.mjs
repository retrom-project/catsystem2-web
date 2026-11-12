// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { EngineHost } from '../src/host.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const utf8 = (value) => new TextEncoder().encode(value),
  text = (bytes) => new TextDecoder().decode(bytes),
  ref = (value) => (value === null ? null : [text(value.nameBytes), value.index]),
  declarations =
    '#DEFINE\nBUTTON a\nBUTTON b\n#OBJECT SIZE POS PRI DISP ENABLE\na 8,8 10,10 60000 1 1\nb 8,8 30,10 60001 1 1\n#START\nnext IDLE\n#IDLE\n',
  blocks = {
    SELECT: 'a setact',
    AFTER: 'b setact',
    DEFAULT: 'b noact',
    RESET: 'resetactive $str7 NEVER_EVALUATE\n$30=++$30',
    RESET_TWICE: 'resetactive\nresetactive',
    'a.FOCUS': '$10=++$10',
    'a.UNFOCUS': '$11=++$11',
    'b.FOCUS': '$12=++$12',
    'b.UNFOCUS': '$13=++$13',
    HOLD: 'config_open\n$31=99',
  };
async function open(profile, labels = {}) {
  const source =
      declarations +
      Object.entries({ ...blocks, ...labels })
        .map(([label, body]) => `#${label}\n${body}\nbreak\n`)
        .join(''),
    world = await defaultFESWorld(profile, { 'screen.fes': utf8(source) });
  Object.assign(world.configuration.screen, {
    width: 128,
    height: 96,
    currentWidth: 128,
    currentHeight: 96,
    virtualWidth: 128,
    virtualHeight: 96,
  });
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return {
      ...h,
      world,
      input: h.task.input,
      get: (name) => h.instance.collection.lookup(name, 0),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, name) => h.task.player.notify(name),
  drain = (h) => h.instance.runtime.flushRecords();
function trace(h) {
  const values = [],
    input = h.input.input,
    query = input.message.bind(input),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages),
    event = h.instance.dispatchEvent.bind(h.instance);
  Object.defineProperty(input, 'message', {
    configurable: true,
    writable: true,
    value: (message, ...args) => {
      if ([152, 125].includes(message)) values.push(['mouse', message]);
      return query(message, ...args);
    },
  });
  h.world.engineMessages.dispatch = (target, sender, message, w, l, context = {}) => {
    if ([93, 145].includes(message))
      values.push([
        'input',
        message,
        target,
        sender,
        w,
        l,
        context.flags,
        ref(h.input.state.focus),
      ]);
    return dispatch(target, sender, message, w, l, context);
  };
  h.instance.dispatchEvent = (object, name) => {
    values.push(['event', object.key, name, ref(h.input.state.focus)]);
    return event(object, name);
  };
  return values;
}
async function selected(h) {
  await notify(h, 'SELECT');
  await drain(h);
}
async function armRegion(h) {
  const input = h.world.engineMessages.closestTop(h.id).implementation.input,
    child = h.get('a').nativeInputTaskID;
  await h.world.sendEngine(input, h.id, 132, h.world.nativeTaskID(child), 1);
  assert.equal(
    h.input.input.get(child).active,
    1,
    'real Input132 established a live active region',
  );
  return input;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fresh(h) {
  const snapshot = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('resetactive restore replayed ' + name);
    return read(name);
  };
  try {
    await world.restore(snapshot);
    const task = world.objects.objects.get(h.id).implementation;
    return {
      world,
      id: h.id,
      task,
      instance: task.player.root,
      input: task.input,
      reads,
      get: (name) => task.player.root.collection.lookup(name, 0),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
for (const profile of profiles) {
  test(`${profile}: resetactive normal caller ignores operands, queues NULL with return0 and preserves mouse/UNFOCUS/clear/Input145 order`, async () => {
    const h = await open(profile);
    try {
      await selected(h);
      await notify(h, 'DEFAULT');
      await drain(h);
      const inputID = await armRegion(h),
        input = h.input.input;
      input.pointer(17, 19, 1);
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        bankCalls = [],
        scriptCalls = [],
        expand = bank.expandBytes.bind(bank),
        script = h.world.configuration.scriptReplacements,
        apply = script.apply.bind(script);
      bank.setBytes(7, utf8('SIDE'));
      script.add(utf8('SIDE'), utf8('++$42'));
      bank.expandBytes = (bytes) => {
        bankCalls.push(text(bytes));
        return expand(bytes);
      };
      script.apply = (bytes) => {
        scriptCalls.push(text(bytes));
        return apply(bytes);
      };
      const values = trace(h);
      await notify(h, 'RESET');
      assert.deepEqual(h.instance.runtime.pendingRecords, [
        { operation: 'active-reference', reference: null },
      ]);
      assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
      assert.equal(h.instance.global(30), 1);
      assert.deepEqual(bankCalls, []);
      assert.deepEqual(scriptCalls, []);
      assert.equal(h.instance.global(42), 0);
      assert.equal(h.instance.nativeQueuePending, false);
      assert.deepEqual(values, [], 'return0 did not flush');
      await drain(h);
      assert.deepEqual(values, [
        ['mouse', 152],
        ['mouse', 125],
        ['input', 93, inputID, h.id, 0, 0, 1, ['a', 0]],
        ['event', 'a', 'UNFOCUS', ['a', 0]],
        ['input', 145, inputID, h.id, 0, 1, 1, null],
      ]);
      assert.equal(h.input.state.focus, null);
      assert.equal(h.task.player.focused, null);
      assert.deepEqual(ref(h.instance.defaultButton), ['b', 0]);
      assert.deepEqual(h.task.player.mouse, { x: 17, y: 19 });
      assert.equal(h.instance.global(11), 1);
      assert.equal(h.instance.global(10), 1);
      assert.equal(h.instance.global(12), 0);
      assert.ok(input.regions.every((r) => r.active === 0));
      assert.deepEqual([input.previousX, input.previousY, input.forceCursor], [-1, -1, true]);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: NULL reset differs from a non-NULL empty name/index7 and repeats without dedup or current object gate`, async () => {
    for (const mode of ['empty', 'none', 'missing', 'disabled']) {
      const h = await open(profile);
      try {
        if (mode === 'empty') {
          // The ordinary setact frontend does not produce this payload; existing typed queue input does.
          h.instance.runtime.pendingRecords.push({
            operation: 'active-reference',
            reference: { nameBytes: new Uint8Array(), index: 7 },
          });
          h.input.input.pointer(0, 0, 0);
          const values = trace(h);
          await drain(h);
          assert.deepEqual(ref(h.input.state.focus), ['', 7]);
          assert.deepEqual(
            values,
            [['mouse', 152]],
            'outside152 prevents its first125; non-NULL empty performs no145',
          );
          const restored = await fresh(h);
          try {
            assert.deepEqual(ref(restored.input.state.focus), ['', 7]);
            await notify(restored, 'RESET');
            await drain(restored);
            assert.equal(restored.input.state.focus, null);
            assert.deepEqual(restored.reads, ['case.kcs']);
          } finally {
            await restored.world.close();
          }
        } else if (mode !== 'none') {
          await selected(h);
          if (mode === 'missing') await h.instance.collection.remove(h.get('a'));
          else
            await h.instance.runtime.command(
              'enable',
              { name: 'a', nameBytes: utf8('a'), index: 0 },
              [utf8('0')],
            );
        }
        const values = trace(h),
          inputID = h.world.engineMessages.closestTop(h.id).implementation.input;
        await notify(h, 'RESET_TWICE');
        assert.equal(h.instance.runtime.pendingRecords.length, 2);
        await drain(h);
        const messages = values.filter((v) => v[0] === 'input');
        if (mode === 'missing' || mode === 'disabled')
          assert.deepEqual(messages.shift(), ['input', 93, inputID, h.id, 0, 0, 1, ['a', 0]]);
        assert.deepEqual(messages, [
          ['input', 145, inputID, h.id, 0, 1, 1, null],
          ['input', 145, inputID, h.id, 0, 1, 1, null],
        ]);
        const events = values.filter((v) => v[0] === 'event');
        assert.equal(events.length, mode === 'disabled' ? 1 : 0);
        assert.equal(h.input.state.focus, null);
        assert.equal(h.instance.global(11), mode === 'disabled' ? 1 : 0);
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: queued NULL and ordered references survive fresh World without replay or a second focus authority`, async () => {
    const h = await open(profile);
    let f;
    try {
      await selected(h);
      await notify(h, 'DEFAULT');
      await drain(h);
      await notify(h, 'RESET');
      await notify(h, 'AFTER');
      await notify(h, 'RESET');
      assert.deepEqual(
        h.instance.runtime.pendingRecords.map((r) => ref(r.reference)),
        [null, ['b', 0], null],
      );
      f = await fresh(h);
      assert.deepEqual(f.reads, ['case.kcs']);
      assert.deepEqual(ref(f.input.state.focus), ['a', 0]);
      assert.equal(f.task.player.focused.o, f.get('a'));
      assert.deepEqual(
        f.instance.runtime.pendingRecords.map((r) => ref(r.reference)),
        [null, ['b', 0], null],
      );
      const left = trace(h),
        right = trace(f);
      await drain(h);
      await drain(f);
      assert.deepEqual(left, right);
      assert.equal(f.input.state.focus, null);
      assert.equal(f.task.player.focused, null);
      assert.deepEqual(
        [10, 11, 12, 13, 30].map((i) => f.instance.global(i)),
        [1, 1, 1, 1, 2],
      );
      assert.deepEqual(ref(f.instance.defaultButton), ['b', 0]);
      assert.deepEqual(f.instance.runtime.pendingRecords, []);
    } finally {
      await f?.world.close();
      await h.world.close();
    }
  });
  test(
    `${profile}: real UNFOCUS Host wait and sent Input145 retain cancellation and live-error boundaries`,
    { timeout: 5000 },
    async () => {
      for (const seam of ['unfocus', '145-resolve', '145-reject', '145-live-error']) {
        const dom = nativeWindowDOM(),
          h = await open(
            profile,
            seam === 'unfocus' ? { 'a.UNFOCUS': '$11=++$11\nconfig_open\n$31=99' } : {},
          ),
          opened = deferred(),
          canceled = deferred(),
          gate = deferred(),
          entered = deferred(),
          query = deferred();
        h.world.host.engine = {};
        h.world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
        h.world.host.nativeWindowAction = function (action, owner) {
          const result = EngineHost.prototype.nativeWindowAction.call(this, action, owner);
          if (action.type === 'fes-configuration') opened.resolve();
          if (action.type === 'fes-owner-close') {
            canceled.resolve();
            return gate.promise.then(() => result);
          }
          return result;
        };
        let request, hold, closing;
        try {
          await selected(h);
          const inputID = await armRegion(h),
            values = trace(h),
            dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
          if (seam !== 'unfocus')
            h.world.engineMessages.dispatch = async (...args) => {
              const result = await dispatch(...args);
              if (args[0] === inputID && args[2] === 145) {
                entered.resolve();
                await query.promise;
                if (seam !== '145-resolve') throw new Error('resetactive-145-error');
              }
              return result;
            };
          const player = h.task.player;
          await notify(h, 'RESET');
          request = drain(h);
          if (seam === 'unfocus') await opened.promise;
          else await entered.promise;
          if (seam === '145-live-error') {
            const failure = assert.rejects(request, /resetactive-145-error/);
            query.resolve();
            await failure;
            assert.equal(h.input.state.focus, null);
            assert.ok(h.input.input.regions.every((r) => r.active === 0));
            assert.deepEqual(
              [h.input.input.previousX, h.input.input.previousY, h.input.input.forceCursor],
              [-1, -1, true],
            );
            assert.equal(h.instance.finished, null);
            assert.equal(h.world.objects.objects.get(h.id).exitCode, -1);
            continue;
          }
          if (seam !== 'unfocus') {
            hold = notify(h, 'HOLD');
            await opened.promise;
          }
          // Queue the follow-on through the already implemented typed object frontend,
          // without starting a second FES notification stack during the Host wait.
          await h.instance.runtime.command(
            'setact',
            { name: 'b', nameBytes: utf8('b'), index: 0 },
            [],
          );
          assert.equal(
            h.instance.runtime.pendingRecords.some((r) => r.operation === 'active-reference'),
            true,
          );
          const focus = ref(h.input.state.focus),
            record = h.world.objects.objects.get(h.id),
            count = values.filter((v) => v[0] === 'input' && v[1] === 145).length;
          closing = h.world.objects.release(h.id);
          await canceled.promise;
          assert.equal(h.task.player, player);
          assert.equal(record.state, 'releasing');
          assert.equal(h.instance.runtime.closed, true);
          query.resolve();
          await request;
          await hold;
          assert.deepEqual(ref(h.input.state.focus), focus);
          assert.equal(values.filter((v) => v[0] === 'input' && v[1] === 145).length, count);
          assert.equal(count, seam === 'unfocus' ? 0 : 1);
          assert.equal(h.instance.global(12), 0);
          assert.equal(h.instance.global(31), 0);
          assert.equal(h.instance.finished, null);
          assert.equal(record.exitCode, -1);
          if (seam !== 'unfocus') {
            assert.equal(h.input.state.focus, null);
            assert.ok(h.input.input.regions.every((r) => r.active === 0));
            assert.deepEqual(
              [h.input.input.previousX, h.input.input.previousY, h.input.input.forceCursor],
              [-1, -1, true],
            );
          }
          gate.resolve();
          await closing;
        } finally {
          query.resolve();
          gate.resolve();
          h.world.host.windowService?.close();
          await request?.catch(() => {});
          await hold?.catch(() => {});
          await closing?.catch(() => {});
          await h.world.close();
          dom.dispose();
        }
      }
    },
  );
}
