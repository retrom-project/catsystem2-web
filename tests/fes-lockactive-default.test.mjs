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
      await assert.doesNotReject(() => notify(h, 'BAD'));
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

for (const profile of profiles) {
  test(`${profile}: normal lockactive retains raw numeric bytes, signed lookup and fresh scalar without replay`, async (t) => {
    const h = await open(
      profile,
      {
        KNOWN: 'lockactive known[(++$10)-1]\n$30=++$30',
      },
      [7, 8, 9],
    );
    let restored;
    try {
      const root = h.instance,
        collection = root.collection,
        aName = Uint8Array.of(0x81),
        bName = Uint8Array.of(0x82),
        knownName = utf8('known'),
        known = collection.create('VIEW', knownName, 2, { enqueue: false }),
        a = collection.create('VIEW', aName, 1, { enqueue: false })[0],
        b = collection.create('VIEW', bName, 1, { enqueue: false })[0],
        decoy = collection.create('VIEW', utf8('?'), 1, { enqueue: false })[0],
        getters = [],
        numeric = [],
        lookups = [],
        argumentBytes = root.argumentBytes,
        operandValue = root.operandValue,
        valueLookup = root.valueLookup;
      // Fixture owner data does not admit non-ASCII DEFINE or another native factory type.
      assert.equal(a.baseName, b.baseName);
      assert.notEqual(a.handle, b.handle);
      assert.notEqual(a.handle, decoy.handle);
      assert.deepEqual(collection.reference(a), { nameBytes: aName, index: 0 });
      assert.deepEqual(collection.reference(b), { nameBytes: bName, index: 0 });
      t.mock.method(root, 'argumentBytes', function (bytes) {
        const result = argumentBytes.call(this, bytes);
        getters.push({ source: bytes.slice(), result: result.slice() });
        return result;
      });
      t.mock.method(root, 'operandValue', function (bytes) {
        assert.ok(bytes instanceof Uint8Array);
        numeric.push(bytes.slice());
        return operandValue.call(this, bytes);
      });
      t.mock.method(root, 'valueLookup', function (nameBytes, index) {
        assert.ok(nameBytes instanceof Uint8Array);
        lookups.push({ nameBytes: nameBytes.slice(), index });
        return valueLookup.call(this, nameBytes, index);
      });
      for (const raw of [aName, bName]) {
        const bytes = Uint8Array.from([...utf8('(++$12)+'), ...raw]),
          beforeGetter = getters.length,
          beforeNumeric = numeric.length,
          beforeLookup = lookups.length;
        root.setGlobal(12, 0);
        let caught;
        try {
          h.runtime.lockActive([bytes]);
        } catch (error) {
          caught = error;
        }
        if (!caught)
          t.diagnostic(
            JSON.stringify({
              unexpectedlyAcceptedRaw: [...raw],
              mutation: root.global(12),
              queued: h.runtime.pendingRecords,
              decoyHandle: decoy.handle,
            }),
          );
        assert.match(caught?.message ?? '', /Unsupported FES numeric name byte/);
        assert.deepEqual(getters.slice(beforeGetter), [{ source: bytes, result: bytes }]);
        assert.deepEqual(numeric.slice(beforeNumeric), [bytes]);
        assert.equal(lookups.length, beforeLookup);
        assert.equal(root.global(12), 0);
        assert.deepEqual(h.runtime.pendingRecords, []);
        assert.equal(h.input.state.activeLock, 0);
      }
      root.setGlobal(12, 0);
      assert.throws(() => h.runtime.lockActive([utf8('(++$12)+')]), /expression|token/i);
      assert.equal(root.global(12), 0, 'A truly malformed expression has no AST mutation');
      assert.deepEqual(h.runtime.pendingRecords, []);
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        beforeBoundGetter = getters.length,
        beforeBoundNumeric = numeric.length;
      assert.throws(() => h.runtime.lockActive([utf8('1'.repeat(1024))]), /token exceeds/);
      assert.equal(getters.length, beforeBoundGetter);
      assert.equal(numeric.length, beforeBoundNumeric);
      bank.setBytes(7, utf8('1'.repeat(1024)));
      assert.throws(() => h.runtime.lockActive([utf8('$str7')]), /operand exceeds/);
      assert.equal(getters.length, beforeBoundGetter + 1);
      assert.equal(numeric.length, beforeBoundNumeric);
      assert.deepEqual(h.runtime.pendingRecords, []);
      const queue = async (args, expected) => {
        const active = h.input.state.activeLock;
        assert.equal(h.runtime.lockActive(args), -3);
        assert.deepEqual(h.runtime.pendingRecords, [{ operation: 'active-lock', value: expected }]);
        assert.equal(
          h.input.state.activeLock,
          active,
          'The existing FIFO owns the deferred scalar',
        );
        await h.runtime.flushRecords();
        assert.equal(h.input.state.activeLock, expected);
        assert.deepEqual(h.runtime.pendingRecords, []);
      };
      await queue([Uint8Array.of(39, 0x81, 39)], 0x8100);
      const beforeEmptyNumeric = numeric.length;
      bank.setBytes(7, new Uint8Array());
      await queue([utf8('$str7'), utf8('++$43')], 0);
      assert.equal(
        numeric.length,
        beforeEmptyNumeric,
        'Expanded empty bypasses the numeric reader',
      );
      const beforeMissingGetter = getters.length;
      await queue([], 0);
      assert.equal(getters.length, beforeMissingGetter);
      assert.equal(numeric.length, beforeEmptyNumeric);
      root.setGlobal(11, 0);
      await queue([utf8('known[(++$11)-2]')], 0);
      assert.equal(root.global(11), 1);
      assert.deepEqual(lookups.at(-1), { nameBytes: knownName, index: -1 });
      await queue([utf8('absent')], 0);
      assert.deepEqual(lookups.at(-1), { nameBytes: utf8('absent'), index: 0 });
      const bankCalls = [],
        scriptCalls = [],
        replacements = h.world.configuration.scriptReplacements,
        expand = bank.expandBytes.bind(bank),
        apply = replacements.apply.bind(replacements);
      t.mock.method(bank, 'expandBytes', (bytes) => {
        bankCalls.push(text(bytes));
        return expand(bytes);
      });
      t.mock.method(replacements, 'apply', (bytes) => {
        scriptCalls.push(text(bytes));
        return apply(bytes);
      });
      bank.setBytes(7, utf8('VALUE'));
      bank.setBytes(8, utf8('++$43'));
      replacements.add(utf8('VALUE'), utf8('known[(++$10)-1]'));
      const beforeRealGetter = getters.length,
        beforeRealNumeric = numeric.length,
        beforeRealLookup = lookups.length;
      await notify(h, 'PARAM');
      assert.deepEqual(getters.slice(beforeRealGetter), [
        { source: utf8('$str7'), result: utf8('known[(++$10)-1]') },
      ]);
      assert.deepEqual(numeric.slice(beforeRealNumeric), [utf8('known[(++$10)-1]')]);
      assert.deepEqual(lookups.slice(beforeRealLookup), [{ nameBytes: knownName, index: 0 }]);
      assert.equal(bankCalls.filter((s) => s === '$str7').length, 1);
      assert.equal(bankCalls.includes('$str8'), false);
      assert.equal(scriptCalls.filter((s) => s === 'VALUE').length, 1);
      assert.equal(root.global(10), 1);
      assert.equal(root.global(30), 1);
      assert.equal(root.global(43), 0);
      assert.equal(h.input.state.activeLock, known[0].handle);
      assert.deepEqual(h.runtime.pendingRecords, []);
      assert.equal(root.nativeQueuePending, false);
      await queue([utf8('known[1]')], known[1].handle);
      const handles = collection.objects.map((object) => object.handle);
      restored = await fresh(h);
      const next = restored.instance,
        restoredNumeric = [],
        restoredLookups = [],
        runNext = next.operandValue,
        lookupNext = next.valueLookup;
      assert.deepEqual(restored.reads, ['case.kcs']);
      assert.deepEqual(
        next.collection.objects.map((object) => object.handle),
        handles,
      );
      assert.deepEqual(next.collection.reference(next.collection.lookup(aName, 0)), {
        nameBytes: aName,
        index: 0,
      });
      assert.deepEqual(next.collection.reference(next.collection.lookup(bName, 0)), {
        nameBytes: bName,
        index: 0,
      });
      assert.equal(restored.input.state.activeLock, known[1].handle);
      assert.deepEqual(next.runtime.pendingRecords, []);
      assert.equal(next.global(10), 1);
      assert.equal(next.global(30), 1, 'Fresh restoration does not replay the completed event');
      t.mock.method(next, 'operandValue', function (bytes) {
        restoredNumeric.push(bytes.slice());
        return runNext.call(this, bytes);
      });
      t.mock.method(next, 'valueLookup', function (nameBytes, index) {
        assert.ok(nameBytes instanceof Uint8Array);
        restoredLookups.push({ nameBytes: nameBytes.slice(), index });
        return lookupNext.call(this, nameBytes, index);
      });
      // This saved source row has a literal operand; SCRIPT configuration is not a new snapshot owner.
      await notify(restored, 'KNOWN');
      assert.deepEqual(restoredNumeric, [utf8('known[(++$10)-1]')]);
      assert.deepEqual(restoredLookups, [{ nameBytes: knownName, index: 1 }]);
      assert.equal(next.global(10), 2);
      assert.equal(next.global(30), 2);
      assert.equal(restored.input.state.activeLock, known[1].handle);
      assert.deepEqual(next.runtime.pendingRecords, []);
      assert.equal(next.nativeQueuePending, false);
      assert.equal(h.world.nativeEngine, undefined);
      assert.equal(restored.world.nativeEngine, undefined);
    } finally {
      await restored?.world.close();
      await h.world.close();
    }
  });
}
