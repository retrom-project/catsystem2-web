// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { defaultFESWorld, loadDefaultFES, profiles } from './fixtures/default-fes-world.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { BrowserNativeWindow } from '../src/native/window-browser.mjs';
import { EngineHost } from '../src/host.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';

const ascii = (s) => new TextEncoder().encode(s),
  deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  },
  fixtureSource = ascii('#START\nnext IDLE\n#IDLE\n#CONFIG\nconfig_open ++$10\nbreak\n');
async function settledUntil(condition) {
  for (let i = 0; i < 30; i++) {
    if (condition()) return;
    await Promise.resolve();
  }
  assert.fail('Expected authored host operation did not become pending');
}
function instrument(h, world) {
  const calls = [],
    instance = h.instance,
    platform = instance.runtime.platform,
    bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
  let active = false;
  for (const [object, name, category] of [
    [bank, 'expandBytes', 'bank'],
    [world.configuration.scriptReplacements, 'apply', 'SCRIPT'],
    [instance, 'value', 'eval'],
    [instance, 'setGlobal', 'write'],
  ]) {
    const original = object[name].bind(object);
    object[name] = (...args) => {
      if (active)
        calls.push([
          category,
          ...args.map((value) =>
            value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value,
          ),
        ]);
      return original(...args);
    };
  }
  const command = platform.command.bind(platform);
  platform.command = (...args) => {
    active = true;
    try {
      const result = command(...args);
      calls.push(['return', result]);
      return result;
    } finally {
      active = false;
    }
  };
  return { calls, bank, clear: () => (calls.length = 0) };
}

for (const profile of profiles) {
  test(`${profile} owner closes during deferred site failure without new UI, queue work or continuation`, async () => {
    const world = await defaultFESWorld(profile, {
        'screen.fes': ascii(
          '#START\nnext IDLE\n#IDLE\n#SITE\nopensite (:site)\n$40=++$10\nclipboard (:unstarted-continuation)\nbreak\n',
        ),
      }),
      gate = deferred(),
      calls = [];
    let runtime, request;
    world.host.nativeWindowAction = async (action) => {
      calls.push([action.type, runtime.platform.closed]);
      if (action.type === 'fes-open-site') return gate.promise;
      return 1;
    };
    world.host.nativeClipboard = new BrowserNativeClipboard({
      clipboard: { writeText: async () => calls.push(['unexpected-clipboard']) },
    });
    try {
      const h = await loadDefaultFES(world);
      runtime = h.instance.runtime;
      assert.ok(runtime instanceof FESCoordinator);
      await h.task.tick();
      h.instance.setGlobal(10, 9);
      request = h.task.player.notify('SITE');
      await settledUntil(() => runtime.platform.inFlight);
      const base = h.draw.setBaseImage.bind(h.draw);
      h.draw.setBaseImage = async (...args) => {
        calls.push(['base-image', runtime.platform.closed]);
        return base(...args);
      };
      runtime.queueBaseImage(null);
      h.instance.execute(ascii('clipboard (:unstarted-record)'), [], 0);
      await world.objects.release(h.id);
      assert.equal(runtime.platform.closed, true);
      assert.throws(() => runtime.snapshot(), /platform action is in flight/);
      calls.push(['resolve-site', true]);
      gate.resolve(5);
      await request;
      assert.deepEqual(calls, [
        ['fes-open-site', false],
        ['resolve-site', true],
      ]);
      assert.equal(runtime.platform.inFlight, null);
      assert.deepEqual(runtime.pendingRecords, []);
      assert.equal(h.instance.global(10), 9);
      assert.equal(h.instance.global(40), 0);
      assert.equal(
        h.instance.finished,
        null,
        'owner-close cancellation does not invent an EXITCODE',
      );
      assert.throws(() => h.instance.execute(ascii('fontcom init'), [], 0), /owner is closed/);
      assert.throws(() => h.instance.execute(ascii('$40=++$10'), [], 0), /owner is closed/);
      assert.equal(h.instance.global(10), 9);
      assert.equal(h.instance.global(40), 0);
      assert.equal(
        runtime.platform.fonts.names,
        null,
        'closed frontend does not restart enumeration',
      );
      assert.equal(world.nativeEngine, undefined);
    } finally {
      gate.resolve(5);
      await request?.catch(() => {});
      await world.close();
    }
  });

  test(`${profile} closed owner abandons a rejected deferred Host request without a script fatal or bank continuation`, async () => {
    const world = await defaultFESWorld(profile, {
        'screen.fes': ascii(
          '#START\nnext IDLE\n#IDLE\n#SITE\nopensite (:site)\n$40=++$10\nbreak\n',
        ),
      }),
      gate = deferred(),
      calls = [];
    let request;
    world.host.nativeWindowAction = (action) => {
      calls.push(action.type);
      return gate.promise;
    };
    try {
      const h = await loadDefaultFES(world),
        runtime = h.instance.runtime;
      await h.task.tick();
      h.instance.setGlobal(10, 9);
      request = h.task.player.notify('SITE');
      await settledUntil(() => runtime.platform.inFlight);
      await world.objects.release(h.id);
      assert.throws(() => runtime.snapshot(), /platform action is in flight/);
      gate.reject(new Error('authored Host operation canceled'));
      await request;
      assert.deepEqual(calls, ['fes-open-site']);
      assert.equal(h.instance.global(10), 9);
      assert.equal(h.instance.global(40), 0);
      assert.equal(h.instance.finished, null);
      assert.equal(runtime.platform.inFlight, null);
    } finally {
      gate.resolve(33);
      await request?.catch(() => {});
      await world.close();
    }
  });

  for (const stage of ['open', 'empty', 'write']) {
    test(`${profile} owner closes during deferred clipboard ${stage}; only started effects and finally-close remain`, async () => {
      const world = await defaultFESWorld(profile, {
          'screen.fes': ascii(
            '#START\nnext IDLE\n#IDLE\n#CLIP\nclipboard (:payload)\n$40=++$10\nopensite (:unstarted)\nbreak\n',
          ),
        }),
        gate = deferred(),
        calls = [];
      let runtime,
        request,
        reached = false;
      const clipboard = new BrowserNativeClipboard({
        clipboard: {
          writeText: async (text) => {
            calls.push(['host-start', text, runtime.platform.closed]);
            if ((stage === 'empty' && text === '') || (stage === 'write' && text === 'payload')) {
              reached = true;
              await gate.promise;
            }
            calls.push(['host-complete', text, runtime.platform.closed]);
          },
        },
      });
      const originalOpen = clipboard.open.bind(clipboard),
        originalEmpty = clipboard.empty.bind(clipboard),
        originalWrite = clipboard.write.bind(clipboard),
        originalClose = clipboard.close.bind(clipboard);
      clipboard.open = async (owner) => {
        calls.push(['open', owner, runtime.platform.closed]);
        if (stage === 'open') {
          reached = true;
          await gate.promise;
        }
        return originalOpen(owner);
      };
      clipboard.empty = () => {
        calls.push(['empty', runtime.platform.closed]);
        return originalEmpty();
      };
      clipboard.write = (text) => {
        calls.push(['write', text, runtime.platform.closed]);
        return originalWrite(text);
      };
      clipboard.close = () => {
        calls.push(['close', runtime.platform.closed]);
        return originalClose();
      };
      world.host.nativeClipboard = clipboard;
      world.host.nativeWindowAction = async (action) =>
        calls.push([action.type, runtime.platform.closed]);
      try {
        const h = await loadDefaultFES(world);
        runtime = h.instance.runtime;
        assert.ok(runtime instanceof FESCoordinator);
        await h.task.tick();
        h.instance.setGlobal(10, 9);
        request = h.task.player.notify('CLIP');
        await settledUntil(() => reached);
        await world.objects.release(h.id);
        assert.equal(runtime.platform.closed, true);
        calls.push(['owner-closed']);
        assert.throws(() => runtime.snapshot(), /platform action is in flight/);
        gate.resolve(true);
        await request;
        const before = [['open', 1, false]],
          empty = [
            ['empty', false],
            ['write', '', false],
            ['host-start', '', false],
          ],
          emptyDone = [['host-complete', '', false]],
          payload = [
            ['write', 'payload', false],
            ['host-start', 'payload', false],
          ];
        const expected =
          stage === 'open'
            ? [...before, ['owner-closed'], ['close', true]]
            : stage === 'empty'
              ? [
                  ...before,
                  ...empty,
                  ['owner-closed'],
                  ['host-complete', '', true],
                  ['close', true],
                ]
              : [
                  ...before,
                  ...empty,
                  ...emptyDone,
                  ...payload,
                  ['owner-closed'],
                  ['host-complete', 'payload', true],
                  ['close', true],
                ];
        assert.deepEqual(calls, expected);
        assert.equal(h.instance.global(10), 9);
        assert.equal(h.instance.global(40), 0);
        assert.equal(h.instance.finished, null);
        assert.equal(clipboard.opened, false);
        assert.equal(runtime.platform.inFlight, null);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        gate.resolve(true);
        await request?.catch(() => {});
        await world.close();
      }
    });
  }

  test(`${profile} closing a FES owner cancels its already started site error modal through the real Host`, async (t) => {
    const dom = nativeWindowDOM();
    t.after(() => dom.dispose());
    const world = await defaultFESWorld(profile, {
      'screen.fes': ascii('#START\nnext IDLE\n#IDLE\n#SITE\nopensite (:site)\n$40=++$10\nbreak\n'),
    });
    world.host.engine = {};
    world.host.nativeWindowAction = function (action, owner) {
      return action.type === 'fes-open-site'
        ? 5
        : EngineHost.prototype.nativeWindowAction.call(this, action, owner);
    };
    let request;
    try {
      const h = await loadDefaultFES(world),
        runtime = h.instance.runtime;
      await h.task.tick();
      h.instance.setGlobal(10, 9);
      request = h.task.player.notify('SITE');
      await settledUntil(() => world.host.windowService?.dialog?.open);
      const service = world.host.windowService;
      assert.equal(service.dialogOwner, h.id);
      assert.equal(service.close(h.id + 1), false);
      assert.throws(() => runtime.snapshot(), /platform action is in flight/);
      await world.objects.release(h.id);
      await request;
      assert.equal(service.dialog, null);
      assert.equal(h.instance.global(10), 9);
      assert.equal(h.instance.global(40), 0);
      assert.equal(h.instance.finished, null);
      assert.equal(runtime.platform.closed, true);
      assert.equal(runtime.platform.inFlight, null);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      world.host.windowService?.close();
      await request?.catch(() => {});
      await world.close();
    }
  });
  for (const operation of ['site', 'configuration']) {
    test(
      `${profile} Host callback reentrantly closes owner during ${operation} before any later continuation`,
      { timeout: 1000 },
      async (t) => {
        const dom = nativeWindowDOM();
        t.after(() => dom.dispose());
        const world = await defaultFESWorld(profile, {
            'screen.fes': ascii(
              '#START\nnext IDLE\n#IDLE\n#RUN\n' +
                (operation === 'site' ? 'opensite (:site)' : 'config_open') +
                '\n$40=++$10\nbreak\n',
            ),
          }),
          calls = [];
        let h, closing, request;
        world.host.engine = {};
        world.host.nativeWindowAction = function (action, owner) {
          calls.push([
            action.type,
            !!h.instance.runtime.platform.inFlight,
            h.instance.runtime.platform.closed,
          ]);
          if (action.type === (operation === 'site' ? 'fes-open-site' : 'fes-configuration')) {
            assert.throws(() => h.instance.runtime.snapshot(), /platform action is in flight/);
            closing = world.objects.release(h.id);
            if (operation === 'site') return 5;
            return closing.then(() =>
              EngineHost.prototype.nativeWindowAction.call(this, action, owner),
            );
          }
          return EngineHost.prototype.nativeWindowAction.call(this, action, owner);
        };
        try {
          h = await loadDefaultFES(world);
          await h.task.tick();
          h.instance.setGlobal(10, 9);
          request = h.task.player.notify('RUN');
          await settledUntil(() => closing);
          await closing;
          await request;
          assert.equal(calls[0][1], true, 'inFlight exists before the first Host invocation');
          assert.deepEqual(
            calls.map(([type]) => type),
            operation === 'site' ? ['fes-open-site'] : ['fes-configuration', 'fes-owner-close'],
          );
          assert.equal(dom.document.body.children.length, 0, 'dead owner cannot open a late modal');
          assert.equal(h.instance.global(10), 9);
          assert.equal(h.instance.global(40), 0);
          assert.equal(h.instance.finished, null);
          assert.equal(h.instance.runtime.platform.inFlight, null);
          assert.equal(world.nativeEngine, undefined);
        } finally {
          world.host.windowService?.close();
          await closing?.catch(() => {});
          await request?.catch(() => {});
          await world.close();
        }
      },
    );
  }

  test(`${profile} normal World close cancels its FES modal and suspended bank continuation without a fatal or EXITCODE`, async (t) => {
    const dom = nativeWindowDOM();
    t.after(() => dom.dispose());
    const world = await defaultFESWorld(profile, {
      'screen.fes': ascii('#START\nnext IDLE\n#IDLE\n#CONFIG\nconfig_open\n$40=++$10\nbreak\n'),
    });
    world.host.engine = {};
    world.host.nativeWindowAction = EngineHost.prototype.nativeWindowAction;
    let request;
    try {
      const h = await loadDefaultFES(world),
        runtime = h.instance.runtime,
        writes = [],
        write = h.instance.setGlobal.bind(h.instance);
      h.instance.setGlobal = (...args) => {
        writes.push(args);
        return write(...args);
      };
      await h.task.tick();
      request = h.task.player.notify('CONFIG');
      await settledUntil(() => world.host.windowService?.dialog?.open);
      assert.throws(() => runtime.snapshot(), /platform action is in flight/);
      await world.close();
      await request;
      assert.equal(world.host.windowService.dialog, null);
      assert.deepEqual(writes, []);
      assert.equal(h.instance.finished, null);
      assert.equal(runtime.platform.closed, true);
      assert.equal(runtime.platform.inFlight, null);
      assert.equal(world.objects.objects.size, 0);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      world.host.windowService?.close();
      await request?.catch(() => {});
      await world.close();
    }
  });

  for (const entry of ['task.tick', 'World.tick']) {
    test(
      `${profile} ${entry} stops a closed FES player after its real Host wait before sync or EXITCODE`,
      { timeout: 1000 },
      async () => {
        const world = await defaultFESWorld(profile, {
            'screen.fes': ascii('#START\nopensite (:site)\n$40=++$10\nnext IDLE\n#IDLE\n'),
          }),
          gate = deferred(),
          entered = deferred(),
          calls = [];
        let frame;
        world.host.nativeWindowAction = (action) => {
          calls.push(action.type);
          entered.resolve();
          return gate.promise;
        };
        try {
          const h = await loadDefaultFES(world),
            runtime = h.instance.runtime,
            sync = h.task.syncObjects.bind(h.task);
          let syncs = 0;
          h.task.syncObjects = (...args) => {
            syncs++;
            return sync(...args);
          };
          h.instance.setGlobal(10, 9);
          frame = entry === 'task.tick' ? h.task.tick() : world.tick();
          await Promise.race([
            entered.promise,
            frame.then(() => {
              throw new Error('task frame completed without its expected Host wait');
            }),
          ]);
          await world.objects.release(h.id);
          assert.equal(h.task.player, null);
          assert.throws(() => runtime.snapshot(), /platform action is in flight/);
          gate.resolve(33);
          await frame;
          assert.deepEqual(calls, ['fes-open-site']);
          assert.equal(syncs, 0, 'closed player is not synchronized by the awaiting task frame');
          assert.equal(h.instance.global(10), 9);
          assert.equal(h.instance.global(40), 0);
          assert.equal(h.instance.finished, null);
          assert.equal(runtime.platform.inFlight, null);
          assert.equal(world.nativeEngine, undefined);
        } finally {
          gate.resolve(33);
          await frame?.catch(() => {});
          await world.close();
        }
      },
    );
  }

  test(`${profile} ordinary queued frontends expand exactly once and await the existing FIFO`, async () => {
    const source = ascii(
        '#START\nnext IDLE\n#IDLE\n#EMPTY\nclipboard\nopensite\nbreak\n#QUEUE\nclipboard $str1 ++$10\nopensite $str2 $str3 ++$10\nconfig_open ++$10\n$30=7\nbreak\n',
      ),
      world = await defaultFESWorld(profile, { 'screen.fes': source }),
      writes = [],
      actions = [],
      modal = deferred();
    world.host.nativeClipboard = new BrowserNativeClipboard({
      clipboard: { writeText: async (text) => writes.push(text) },
    });
    world.host.nativeWindowAction = async (action) => {
      actions.push(action);
      if (action.type === 'fes-open-site') return 33;
      if (action.type === 'fes-configuration') return modal.promise;
      throw new Error('Unexpected authored action ' + action.type);
    };
    try {
      const h = await loadDefaultFES(world),
        t = instrument(h, world);
      await h.task.tick();
      h.instance.setGlobal(10, 0);
      t.bank.setBytes(1, encodeCP932('line\\n猫X'));
      t.bank.setBytes(2, ascii('httpsX'));
      t.bank.setBytes(3, Uint8Array.of(0x81, 0x7f, 0x59));
      world.configuration.scriptReplacements.add(ascii('X'), ascii('XX'));
      await h.task.player.notify('EMPTY');
      assert.deepEqual(t.calls, [
        ['return', 0],
        ['return', 0],
      ]);
      assert.deepEqual(writes, []);
      assert.deepEqual(actions, []);
      t.clear();
      let done = false;
      const request = h.task.player.notify('QUEUE').then(() => (done = true));
      await settledUntil(() => actions.some((action) => action.type === 'fes-configuration'));
      assert.equal(done, false);
      assert.equal(h.instance.global(30), 0);
      assert.equal(h.instance.global(10), 0);
      assert.deepEqual(writes, ['', 'line\\n猫XX']);
      assert.deepEqual([...actions[0].bytes], [...ascii('httpsXX://'), 0x81, 0x7f, 0x59]);
      assert.equal(Object.getPrototypeOf(actions[0].bytes), Uint8Array.prototype);
      assert.deepEqual(
        actions.map((action) => [action.type, action.owner]),
        [
          ['fes-open-site', h.id],
          ['fes-configuration', h.id],
        ],
      );
      assert.deepEqual(
        t.calls.map(([name]) => name),
        ['bank', 'SCRIPT', 'return', 'bank', 'SCRIPT', 'bank', 'SCRIPT', 'return', 'return'],
      );
      assert.deepEqual(
        t.calls.filter(([name]) => name === 'return').map(([, value]) => value),
        [-3, -3, -3],
      );
      assert.throws(() => world.snapshot(), /platform action is in flight/);
      modal.resolve(false);
      await request;
      assert.equal(done, true);
      assert.equal(h.instance.global(30), 7);
      assert.equal(h.instance.runtime.pendingRecords.length, 0);
      assert.equal(h.instance.nativeQueuePending, false);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      modal.resolve(false);
      await world.close();
    }
  });

  test(`${profile} shared FIFO retains owned exact Buffer payloads, holes and empty operands`, async () => {
    const world = await defaultFESWorld(profile, { 'screen.fes': fixtureSource }),
      calls = [];
    world.host.nativeClipboard = {
      open: async (owner) => (calls.push(['open', owner]), true),
      empty: async () => (calls.push(['empty']), false),
      write: async (text) => (calls.push(['write', text]), false),
      close: async () => (calls.push(['close']), true),
    };
    world.host.nativeWindowAction = async (action) => {
      calls.push([action.type, [...(action.bytes ?? [])]]);
      return 33;
    };
    try {
      const h = await loadDefaultFES(world),
        bank = world.runtime.stringBank(world.objects.objects.get(world.main.id)),
        expand = h.instance.argumentBytes.bind(h.instance),
        produced = [];
      h.instance.argumentBytes = (token) => {
        const bytes = Buffer.from(expand(token));
        produced.push(bytes);
        return bytes;
      };
      bank.setBytes(1, ascii('UP\\n'));
      assert.deepEqual(h.instance.execute(ascii('clipboard $str1'), [], 0), { action: 'flush' });
      const record = h.instance.runtime.pendingRecords[0];
      assert.equal(Object.getPrototypeOf(record.bytes), Uint8Array.prototype);
      for (const bytes of produced) bytes.fill(0);
      assert.deepEqual(record.bytes, ascii('UP\\n'));
      const base = h.draw.setBaseImage.bind(h.draw);
      h.draw.setBaseImage = async (...args) => {
        calls.push(['base', ...args]);
        return base(...args);
      };
      h.instance.runtime.queueBaseImage(null);
      assert.deepEqual(
        h.instance.execute(ascii('opensite (:https) (:example.invalid) IGNORED'), [], 0),
        { action: 'flush' },
      );
      assert.deepEqual(calls, []);
      await h.instance.flushNativeRecords();
      assert.deepEqual(
        calls.map(([name]) => name),
        ['open', 'empty', 'write', 'close', 'base', 'fes-open-site'],
      );
      assert.equal(calls[2][1], 'UP\\n');
      assert.deepEqual(calls.at(-1)[1], [...ascii('https://example.invalid')]);
      calls.length = 0;
      bank.setBytes(2, new Uint8Array());
      h.instance.execute(ascii('clipboard $str2 ++$10'), [], 0);
      h.instance.execute(ascii('opensite "first" ++$10'), [], 0);
      await h.instance.flushNativeRecords();
      assert.deepEqual(calls[2], ['write', '']);
      assert.deepEqual(calls.at(-1), [
        'fes-open-site',
        [...ascii(nativeABI(profile).sound.allowQuotedFesNames ? 'first' : '"first"://++$10')],
      ]);
      assert.equal(
        h.instance.global(10),
        0,
        'the native quoted-hole policy is profile specific; site arguments are never numeric evaluations',
      );
      bank.setBytes(1, new Uint8Array(1023).fill(65));
      h.instance.execute(ascii('clipboard $str1'), [], 0);
      assert.equal(h.instance.runtime.pendingRecords[0].bytes.length, 1023);
      h.instance.runtime.pendingRecords.length = 0;
      bank.setBytes(2, new Uint8Array(1023).fill(66));
      assert.throws(
        () => h.instance.execute(ascii('opensite $str1 $str2'), [], 0),
        /2048-byte destination/,
      );
      bank.setBytes(1, new Uint8Array(1024).fill(65));
      assert.throws(
        () => h.instance.execute(ascii('clipboard $str1'), [], 0),
        /1024-byte temporary/,
      );
    } finally {
      await world.close();
    }
  });

  test(`${profile} clipboard refusal, permission failure and platform exceptions preserve outputs and close ownership`, async () => {
    const world = await defaultFESWorld(profile, { 'screen.fes': fixtureSource }),
      calls = [],
      diagnostics = [];
    try {
      const h = await loadDefaultFES(world),
        run = async () => {
          h.instance.execute(ascii('clipboard (:text\\n)'), [], 0);
          return h.instance.flushNativeRecords();
        };
      world.host.nativeClipboard = {
        open: () => (calls.push('open'), false),
        empty: () => assert.fail('must not empty refused clipboard'),
        write: () => assert.fail('must not write refused clipboard'),
        close: () => assert.fail('must not close refused clipboard'),
      };
      await run();
      assert.deepEqual(calls, ['open']);
      world.host.nativeClipboard = new BrowserNativeClipboard({
        clipboard: {
          writeText: async (text) => {
            calls.push(text);
            throw new Error('denied');
          },
        },
        diagnostic: (detail) => diagnostics.push(detail.message),
      });
      await run();
      assert.deepEqual(calls, ['open', '', 'text\\n']);
      assert.deepEqual(diagnostics, ['denied', 'denied']);
      assert.equal(world.host.nativeClipboard.opened, false);
      world.host.nativeClipboard = {
        open: () => true,
        empty: () => {
          throw new Error('transport');
        },
        write: () => assert.fail('must not write after transport throws'),
        close: () => (calls.push('finally-close'), true),
      };
      await assert.rejects(run(), /transport/);
      assert.equal(calls.at(-1), 'finally-close');
      assert.equal(h.instance.global(10), 0);
      delete world.host.nativeClipboard;
      await assert.rejects(run(), /platform open service/);
    } finally {
      await world.close();
    }
  });

  test(`${profile} opensite reports selected real failures through the existing modal boundary`, async () => {
    const world = await defaultFESWorld(profile, { 'screen.fes': fixtureSource }),
      actions = [];
    let result = 5;
    world.host.nativeWindowAction = async (action) => {
      actions.push(action);
      return action.type === 'fes-open-site' ? result : 1;
    };
    try {
      const h = await loadDefaultFES(world),
        run = async () => {
          h.instance.execute(ascii('opensite (:file)'), [], 0);
          return h.instance.flushNativeRecords();
        };
      await run();
      assert.deepEqual(
        actions.map((action) => action.type),
        ['fes-open-site', 'fes-message-box'],
      );
      assert.equal(actions[1].caption, '実行エラー');
      assert.equal(
        actions[1].message,
        'オペレーティングシステムが、指定されたファイルへのアクセスを拒否しました。',
      );
      assert.equal(actions[1].buttons, 0);
      for (const [code, message] of [
        [28, '要求がタイムアウトしたので、DDE トランザクションを完了できませんでした。'],
        [
          30,
          'ほかの DDE トランザクションが現在処理中なので、DDE トランザクションを完了できませんでした。',
        ],
      ]) {
        result = code;
        actions.length = 0;
        await run();
        assert.deepEqual(
          actions.map((action) => action.type),
          ['fes-open-site', 'fes-message-box'],
        );
        assert.equal(actions[1].message, message);
      }
      for (result of [1, 4, 33]) {
        actions.length = 0;
        await run();
        assert.deepEqual(
          actions.map((action) => action.type),
          ['fes-open-site'],
        );
      }
      result = undefined;
      await assert.rejects(run(), /real ShellExecute result/);
      const browser = new BrowserNativeWindow({});
      world.host.nativeWindowAction = (action) => browser.perform(action, world);
      await assert.rejects(run(), /Unknown browser window action fes-open-site/);
      assert.equal(h.instance.global(10), 0);
    } finally {
      await world.close();
    }
  });

  test(`${profile} real Host configuration working copy awaits apply, cancels and closes only its FES owner`, async (t) => {
    const dom = nativeWindowDOM();
    t.after(() => dom.dispose());
    const world = await defaultFESWorld(profile, { 'screen.fes': fixtureSource });
    const defaults = encodeCP932('DEFAULT');
    world.host.nativeDefaultFontBytes = () => defaults;
    world.host.engine = {};
    world.host.nativeWindowAction = EngineHost.prototype.nativeWindowAction;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const original = world.fesConfiguration.get('messpd');
      let request = h.task.player.notify('CONFIG');
      await settledUntil(() => world.host.windowService?.dialog?.open);
      const service = world.host.windowService,
        input = dom.all().find((node) => node.name === 'messpd');
      assert.ok(input);
      input.value = String(original + 1);
      assert.equal(world.fesConfiguration.get('messpd'), original);
      assert.equal(service.dialogOwner, h.id);
      assert.equal(service.close(h.id + 1), false);
      assert.ok(service.dialog.open);
      service.close(h.id);
      await request;
      assert.equal(world.fesConfiguration.get('messpd'), original);
      assert.equal(service.dialog, null);
      request = h.task.player.notify('CONFIG');
      await settledUntil(() => service.dialog?.open);
      dom.all().find((node) => node.name === 'messpd').value = String(original + 3);
      const applying = dom
        .all()
        .find((node) => node.tagName === 'button' && node.textContent === 'Apply')
        .onclick();
      service.close(h.id);
      await applying;
      await request;
      assert.equal(
        world.fesConfiguration.get('messpd'),
        original,
        'canceled draft cannot apply after its modal owner closes',
      );
      request = h.task.player.notify('CONFIG');
      await settledUntil(() => service.dialog?.open);
      dom.all().find((node) => node.name === 'messpd').value = String(original + 2);
      await dom
        .all()
        .find((node) => node.tagName === 'button' && node.textContent === 'Apply')
        .onclick();
      await request;
      assert.equal(world.fesConfiguration.get('messpd'), original + 2);
      assert.deepEqual(world.nativeDefaultFontBytes(), defaults);
      assert.equal(service.dialog, null);
      request = h.task.player.notify('CONFIG');
      await settledUntil(() => service.dialog?.open);
      const platform = h.instance.runtime.platform;
      assert.throws(() => h.instance.runtime.snapshot(), /platform action is in flight/);
      await world.objects.release(h.id);
      await request;
      assert.equal(service.dialog, null);
      assert.equal(platform.closed, true);
      assert.equal(platform.inFlight, null);
      assert.equal(world.fesConfiguration.get('messpd'), original + 2);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      world.host.windowService?.close();
      await world.close();
      dom.dispose();
    }
  });

  test(`${profile} fresh World retains only unconsumed frontend records without replaying completed actions`, async (t) => {
    const world = await defaultFESWorld(profile, { 'screen.fes': fixtureSource }),
      writes = [];
    world.host.nativeClipboard = new BrowserNativeClipboard({
      clipboard: { writeText: async (text) => writes.push(text) },
    });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      h.instance.execute(ascii('clipboard (:completed)'), [], 0);
      await h.instance.flushNativeRecords();
      h.instance.execute(ascii('clipboard (:pending)'), [], 0);
      const saved = structuredClone(world.snapshot());
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = async (name) => {
        const bytes = await read(name);
        reads.push({
          name,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        return bytes;
      };
      fresh.host.nativeClipboard = new BrowserNativeClipboard({
        clipboard: { writeText: async (text) => writes.push(text) },
      });
      await fresh.restore(saved);
      assert.deepEqual(
        reads.map(({ name }) => name),
        ['case.kcs'],
      );
      t.diagnostic('fresh scheduler read: ' + JSON.stringify(reads));
      assert.deepEqual(writes, ['', 'completed']);
      const instance = fresh.objects.objects.get(h.id).implementation.player.root;
      assert.deepEqual(
        instance.runtime.pendingRecords.map((record) => record.operation),
        ['fes-clipboard'],
      );
      await instance.flushNativeRecords();
      assert.deepEqual(writes, ['', 'completed', '', 'pending']);
      assert.equal(instance.runtime.pendingRecords.length, 0);
      instance.execute(ascii('clipboard (:discarded)'), [], 0);
      await fresh.objects.release(h.id);
      assert.deepEqual(writes, ['', 'completed', '', 'pending']);
      assert.equal(instance.runtime.pendingRecords.length, 0);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
