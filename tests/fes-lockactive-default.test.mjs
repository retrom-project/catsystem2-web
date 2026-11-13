// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { EngineHost } from '../src/host.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const utf8 = (s) => new TextEncoder().encode(s),
  text = (b) => new TextDecoder().decode(b),
  ref = (r) => (r === null ? null : [text(r.nameBytes), r.index]),
  declarations =
    '#DEFINE\nBUTTON a\nBUTTON b[2]\n#OBJECT SIZE POS PRI DISP ENABLE\na 8,8 10,10 60000 1 1\nb[0] 8,8 30,10 60001 1 1\nb[1] 8,8 50,10 60001 1 1\n#START\nnext IDLE\n#IDLE\n',
  labels = {
    SELECT: 'a setact',
    DEFAULT: 'b[0] noact',
    LOCK: 'lockactive -2147483648',
    WRAP: 'lockactive 4294967295',
    UNLOCK: 'lockactive',
    PARAM: 'lockactive $str7 $str8\n$30=++$30',
    EMPTY: 'lockactive $str9',
    BAD: 'lockactive NOT_AN_EXPRESSION',
    SHIFT: 'b[1] setact\nlockactive -5',
    'a.FOCUS': '$10=++$10',
    'a.UNFOCUS': '$11=++$11',
    'a.PUSH_L': '$14=++$14',
    'a.RELEASE_L': '$15=++$15',
    'b.FOCUS': '$12=++$12',
  };
async function open(profile, overrides = {}, lateSlots = []) {
  const source =
      declarations +
      Object.entries({ ...labels, ...overrides })
        .map(([label, body]) => `#${label}\n${body}\nbreak\n`)
        .join(''),
    world = await defaultFESWorld(profile, {
      'screen.fes': utf8(
        lateSlots.length
          ? '#MACRO\n' +
              lateSlots.map((slot) => `LATE_${slot} $str${slot}`).join('\n') +
              '\n' +
              source.replace(/\$str(\d+)/g, (token, slot) =>
                lateSlots.includes(Number(slot)) ? `LATE_${slot}` : token,
              )
          : source,
      ),
    });
  Object.assign(world.configuration.screen, {
    width: 128,
    height: 96,
    currentWidth: 128,
    currentHeight: 96,
    virtualWidth: 128,
    virtualHeight: 96,
  });
  world.ensureNativeEngine = () => {
    throw new Error('lockactive must use the default JS path');
  };
  try {
    // Exercise the real factory/identity API so later FES World/native IDs differ.
    await world.objects.create({
      kind: 6,
      parent: world.main.id,
      name: 'native identity spacer',
      nativeID: 0x70000000,
    });
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
    return {
      ...h,
      world,
      input: h.task.input,
      runtime: h.instance.runtime,
      get: (name, index = 0) => h.instance.collection.lookup(name, index),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, label) =>
    h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
      payload: fesLabelPayload(() => label),
    }),
  select = async (h) => {
    await notify(h, 'SELECT');
    await h.runtime.flushRecords();
  },
  graph = (h, message, id = h.get('a').nativeInputTaskID, w = 0, l = 0) =>
    h.world.sendEngine(id, h.id, message, w, l);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function trace(h) {
  const seen = [],
    event = h.instance.dispatchEvent.bind(h.instance),
    forward = h.world.sendNativeEngine.bind(h.world),
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
  h.instance.dispatchEvent = (object, name) => {
    seen.push(['event', object.key, name, ref(h.input.state.focus), h.input.state.activeLock]);
    return event(object, name);
  };
  h.world.sendNativeEngine = (target, sender, message, w, l, context) => {
    if (message === 64) seen.push(['forward64', sender, w, l]);
    return forward(target, sender, message, w, l, context);
  };
  h.world.engineMessages.dispatch = (target, sender, message, w, l, context) => {
    if ([93, 138, 145].includes(message)) seen.push(['input', message]);
    return dispatch(target, sender, message, w, l, context);
  };
  return seen;
}
async function fresh(h) {
  const state = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    read = world.game.read.bind(world.game);
  world.ensureNativeEngine = () => {
    throw new Error('lockactive restore must stay JS');
  };
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('lockactive restore replayed ' + name);
    return read(name);
  };
  try {
    await world.restore(state);
    const task = world.objects.objects.get(h.id).implementation;
    return {
      world,
      id: h.id,
      task,
      input: task.input,
      instance: task.player.root,
      reads,
      get: (name, index = 0) => task.player.root.collection.lookup(name, index),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
function host(h, { reject = false } = {}) {
  const opened = deferred();
  h.world.host.engine = {};
  h.world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
  h.world.host.nativeWindowAction = function (action, owner) {
    const result = EngineHost.prototype.nativeWindowAction.call(this, action, owner);
    if (action.type === 'fes-configuration') {
      opened.resolve();
      return reject
        ? Promise.resolve(result).then(() => {
            throw new Error('lockactive Host failure');
          })
        : result;
    }
    return result;
  };
  return opened.promise;
}
function closeDialog(dom) {
  const button = dom.all().find((n) => n.tagName === 'button' && n.textContent === 'Close');
  assert.ok(button);
  button.onclick();
}
for (const profile of profiles) {
  test(`${profile}: lockactive evaluates optional operand once, defaults empty/missing to0 and preserves its signed word on the existing -3 FIFO`, async () => {
    const h = await open(profile, {}, [7, 8, 9]);
    try {
      assert.equal(h.input.state.activeLock, 0);
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        calls = [],
        scriptCalls = [],
        expand = bank.expandBytes.bind(bank),
        replacements = h.world.configuration.scriptReplacements,
        apply = replacements.apply.bind(replacements);
      bank.setBytes(7, utf8('VALUE'));
      bank.setBytes(8, utf8('++$43'));
      bank.setBytes(9, new Uint8Array());
      replacements.add(utf8('VALUE'), utf8('++$40'));
      bank.expandBytes = (bytes) => {
        calls.push(text(bytes));
        return expand(bytes);
      };
      replacements.apply = (bytes) => {
        scriptCalls.push(text(bytes));
        return apply(bytes);
      };
      await notify(h, 'PARAM');
      assert.equal(h.instance.global(40), 1);
      assert.equal(h.instance.global(43), 0);
      assert.equal(h.input.state.activeLock, 1);
      assert.equal(h.instance.global(30), 1);
      assert.equal(calls.filter((s) => s === '$str7').length, 1);
      assert.equal(calls.includes('$str8'), false);
      assert.equal(scriptCalls.filter((s) => s === 'VALUE').length, 1);
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.equal(h.instance.nativeQueuePending, false);
      await notify(h, 'LOCK');
      assert.equal(h.input.state.activeLock, -2147483648);
      await notify(h, 'WRAP');
      assert.equal(h.input.state.activeLock, -1);
      await notify(h, 'EMPTY');
      assert.equal(h.input.state.activeLock, 0);
      await notify(h, 'LOCK');
      await notify(h, 'UNLOCK');
      assert.equal(h.input.state.activeLock, 0);
      await assert.rejects(notify(h, 'BAD'), /expression|identifier|unknown/i);
      assert.equal(h.input.state.activeLock, 0);
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: real Graph7/8 and Input tick distinguish matched zero36, unknown saved-entry IDs, lock words and pressed sentinel`, async () => {
    const h = await open(profile);
    try {
      const a = h.get('a').nativeInputTaskID,
        low = h.input.state.lowButton,
        seen = trace(h);
      assert.notEqual(a, h.world.nativeTaskID(a));
      await graph(h, 7, a);
      assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
      await graph(h, 4, a, 0, 1);
      assert.deepEqual(ref(h.input.state.pressed), ['a', 0]);
      await notify(h, 'WRAP');
      await graph(h, 8, a);
      assert.deepEqual(ref(h.input.state.focus), ['', 0]);
      assert.deepEqual(ref(h.input.state.pressed), ['a', 0]);
      assert.ok(
        seen.some((r) => r[0] === 'event' && r[2] === 'UNFOCUS' && r[3][0] === '' && r[3][1] === 0),
      );
      assert.ok(
        seen.some(
          (r) =>
            r[0] === 'forward64' && r[1] === a && r[2] === h.world.nativeTaskID(a) && r[3] === 0,
        ),
      );
      await graph(h, 4, a, 0, 0);
      assert.equal(h.instance.global(15), 1);
      await select(h);
      await graph(h, 7, low);
      assert.deepEqual(
        ref(h.input.state.focus),
        ['a', 0],
        'unknown native buttonID with nonzero lock retains owner pair',
      );
      await notify(h, 'UNLOCK');
      await graph(h, 8, low);
      assert.deepEqual(ref(h.input.state.focus), ['', -1]);
      assert.equal(h.input.state.pressed, null);
      seen.length = 0;
      await graph(h, 7, a);
      await graph(h, 4, a, 0, 1);
      await graph(h, 8, a);
      assert.deepEqual(ref(h.input.state.focus), ['', -1]);
      assert.equal(h.input.state.pressed, null);
      await graph(h, 4, a, 0, 0);
      assert.equal(
        h.instance.global(15),
        1,
        'invalid pressed index prevents the later named release',
      );
      assert.equal(
        seen.some((r) => r[0] === 'input'),
        false,
        'hover does not borrow resetactive/Input145',
      );
      h.input.input.pointer(11, 11, 1);
      await h.input.input.tick(1);
      assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
      await notify(h, 'LOCK');
      h.input.input.pointer(110, 80, 1);
      await h.input.input.tick(2);
      assert.deepEqual(ref(h.input.state.focus), ['', 0]);
      h.input.input.pointer(31, 11, 1);
      await h.input.input.tick(3);
      assert.deepEqual(ref(h.input.state.focus), ['b', 0], 'enter still assigns while locked');
    } finally {
      await h.world.close();
    }
  });
  test(
    `${profile}: UNFOCUS changes lock/reference before the post-await read and fresh World restores its single current scalar/pair`,
    { timeout: 5000 },
    async () => {
      for (const value of [-5, 0]) {
        const h = await open(profile, {
          'a.UNFOCUS': `b[1] setact\nlockactive ${value}\n$11=++$11`,
        });
        let restored;
        try {
          await select(h);
          await notify(h, 'DEFAULT');
          await h.runtime.flushRecords();
          await notify(h, value ? 'UNLOCK' : 'LOCK');
          const seen = trace(h);
          await graph(h, 8);
          assert.equal(h.input.state.activeLock, value);
          assert.deepEqual(ref(h.input.state.focus), value ? ['b', 1] : ['', -1]);
          assert.equal(h.instance.global(11), 1);
          assert.equal(h.instance.global(12), 1);
          assert.deepEqual(seen.find((r) => r[0] === 'event' && r[2] === 'UNFOCUS')[3], ['', 0]);
          assert.deepEqual(ref(h.instance.defaultButton), ['b', 0]);
          restored = await fresh(h);
          assert.deepEqual(restored.reads, ['case.kcs']);
          assert.equal(restored.input.state.activeLock, value);
          assert.deepEqual(ref(restored.input.state.focus), value ? ['b', 1] : ['', -1]);
          assert.equal(restored.instance.global(11), 1);
          assert.equal(restored.instance.global(12), 1);
          assert.equal(restored.world.nativeEngine, undefined);
        } finally {
          await restored?.world.close();
          await h.world.close();
        }
      }
    },
  );
  test(
    `${profile}: real UNFOCUS Host wait admits a new nonmodal lock request and preserves owner-close/live-error boundaries`,
    { timeout: 5000 },
    async () => {
      for (const mode of ['reenter', 'close', 'cancel-reject', 'live-error']) {
        const dom = nativeWindowDOM(),
          h = await open(profile, {
            'a.UNFOCUS':
              mode === 'reenter'
                ? 'config_open\n$55=++$55'
                : 'config_open\nlockactive -7\n$55=++$55',
          });
        let running;
        try {
          await select(h);
          await notify(h, 'WRAP');
          const opened = host(h, { reject: mode === 'cancel-reject' || mode === 'live-error' }),
            record = h.world.objects.objects.get(h.id);
          running = graph(h, 8);
          running.catch(() => {});
          await opened;
          assert.deepEqual(ref(h.input.state.focus), ['', 0]);
          if (mode === 'reenter') {
            await notify(h, 'SHIFT');
            assert.deepEqual(ref(h.input.state.focus), ['b', 1]);
            closeDialog(dom);
            await running;
            assert.equal(h.input.state.activeLock, -5);
            assert.deepEqual(ref(h.input.state.focus), ['b', 1]);
            assert.equal(h.instance.global(55), 1);
          } else if (mode === 'live-error') {
            const failed = assert.rejects(running, /lockactive Host failure/);
            closeDialog(dom);
            await failed;
            assert.equal(h.input.state.activeLock, -1);
            assert.deepEqual(ref(h.input.state.focus), ['', 0]);
            assert.equal(h.runtime.closed, false);
            assert.equal(h.instance.global(55), 0);
          } else {
            await Promise.all([running, h.world.objects.release(h.id)]);
            assert.equal(h.input.state.activeLock, -1);
            assert.equal(h.instance.global(55), 0);
            assert.equal(h.runtime.closed, true);
            assert.equal(h.instance.finished, null);
            assert.equal(record.exitCode, -1);
          }
        } finally {
          await h.world.close();
          await running?.catch(() => {});
          dom.dispose();
        }
      }
    },
  );
}
