// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { CatSystem2 } from '../web/transitional-entry.mjs';
import { EngineHost } from '../src/host.mjs';
import { BrowserNativeWindow } from '../src/native/window-browser.mjs';
import { NativeWorld as OrdinaryNativeWorld } from '../src/native/world.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
async function fixture(profile = 'sdk-4.01-engine-2.6.1.74', World = NativeWorld) {
  const game = memoryGame({ 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) }),
    random = new ParticleRandom(),
    configuration = new NativeConfiguration({ profile }),
    trace = [],
    host = {
      nativeWindowAction: async (action) => {
        trace.push(action.type);
        return false;
      },
      nativeWindowMessage: async (message) => {
        trace.push(['mode', message.lParam]);
        configuration.screen.fullscreen = message.lParam;
      },
    },
    world = new World({
      game,
      images: {},
      host,
      profile,
      configuration,
      random,
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
    });
  await world.initialize('main.kcs');
  world.window.sendEvent = async (event, w = 0, l = 0, options) => {
    trace.push(options ? ['event', event, w, l, options] : ['event', event, w, l]);
  };
  return { world, trace, host };
}
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} Script window requests post before toggling display, minimizing or asking to close`, async () => {
    const { world, trace } = await fixture(profile);
    try {
      const [task] = world.runtime.scheduler.tasks.values(),
        request = (id) =>
          world.runtime.native('main', id, [], task.machine, task, world.runtime.scheduler);
      for (const [id, message, expected] of [
        [0x34d, 0x469, [['mode', 1]]],
        [0x34d, 0x469, [['mode', 0]]],
        [0x34e, 0x46a, ['minimize']],
        [0x34f, 0x46b, [['event', 158, 0, 1], 'confirm-close']],
      ]) {
        trace.length = 0;
        assert.deepEqual(request(id), { control: 2 });
        assert.deepEqual(world.windowMessages, [{ message, wParam: 0, lParam: 0 }]);
        assert.deepEqual(trace, []);
        await world.processWindowMessages();
        assert.deepEqual(trace, expected);
        assert.deepEqual(world.windowMessages, []);
      }
      assert.equal(world.quitRequested, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
test('window messages drain posted menu commands and preserve native preparation/action order', async () => {
  const { world, trace } = await fixture();
  try {
    for (const [selector, expected] of [
      [0, [['event', 158, 0, 1], 'confirm-title']],
      [1, ['save-directory']],
      [13, [['event', 20, 0, 0]]],
      [20, [['event', 158, 0, 1], 'game-configuration']],
      [21, [['event', 158, 0, 1], 'system-configuration']],
      [22, [['event', 158, 0, 1], 'volume']],
      [30, [['event', 158, 0, 1], 'version']],
      [31, [['event', 158, 0, 1], 'system-information']],
      [32, [['event', 158, 0, 1], 'configuration-tool']],
      [12, ['minimize']],
    ]) {
      trace.length = 0;
      world.window.post(0x46c, 0, selector);
      await world.processWindowMessages();
      assert.deepEqual(trace, expected, `selector ${selector}`);
      assert.equal(world.windowMessages.length, 0);
    }
    trace.length = 0;
    world.window.post(0x46c, 0, 0xffffffff);
    await world.processWindowMessages();
    assert.deepEqual(trace, []);
    world.window.post(0x46c, 0, 10);
    await world.processWindowMessages();
    assert.deepEqual(trace, [['mode', 1]]);
    world.window.post(0x46c, 0, 10);
    await world.processWindowMessages();
    assert.deepEqual(trace, [['mode', 1]]);
    world.window.post(0x46c, 0, 11);
    await world.processWindowMessages();
    assert.deepEqual(trace, [
      ['mode', 1],
      ['mode', 0],
    ]);
  } finally {
    await world.close({ flushFiles: false });
  }
});
test('language menu commands select native indexes, and only private main-language messages preload the option table', async () => {
  const { world } = await fixture('nekopara-vol3-engine-2.6.1.76');
  const { language } = world.configuration,
    calls = [],
    send = async (id, word) => {
      world.window.post(id, word);
      await world.processWindowMessages();
    };
  try {
    language.entries = [{ prefix: 'en' }, { prefix: 'jp' }];
    language.optionTable = 'options_%LANG%_%LANG_M%.txt';
    world.globalStrings.reload = async (...args) => calls.push(args);
    await send(0x111, 0x10000 | 40076);
    assert.equal(language.main, 1);
    assert.deepEqual(calls.splice(0), [[1, 'options_en_jp.txt']]);
    await send(0x111, 40076);
    await send(0x111, 40078);
    assert.equal(language.main, 1);
    assert.deepEqual(calls.splice(0), []);
    await send(0x111, 40086);
    assert.equal(language.sub, 1);
    await send(0x111, 40087);
    assert.equal(language.sub, 0xffffffff);
    assert.deepEqual(calls.splice(0), []);
    await send(0x111, 40066);
    assert.equal(language.ui, 1);
    assert.deepEqual(calls.splice(0), [
      [0, 'language_jp.txt'],
      [1, 'options_jp_jp.txt'],
    ]);
    await send(0x46f, 0);
    assert.deepEqual(calls, [
      [1, 'options_jp_jp.txt'],
      [1, 'options_jp_jp.txt'],
    ]);
  } finally {
    await world.close({ flushFiles: false });
  }
});
test('close confirmation cancellation retains the World; acceptance disables Scripts before the settled teardown request', async () => {
  const { world, trace, host } = await fixture();
  try {
    world.window.post(0x46c, 0, 2);
    await world.processWindowMessages();
    assert.deepEqual(trace, [['event', 158, 0, 1], 'confirm-close']);
    assert.equal(world.quitRequested, undefined);
    trace.length = 0;
    host.nativeWindowAction = async (action) => {
      trace.push(action.type);
      return true;
    };
    world.window.post(0x10);
    await world.processWindowMessages();
    assert.deepEqual(trace, [
      'confirm-close',
      'hide',
      ['event', 162, 0, 0, { taskType: 12 }],
      'close',
    ]);
    assert.equal(world.quitRequested, true);
    assert.throws(() => world.snapshot(), /closing/);
  } finally {
    await world.close({ flushFiles: false });
  }
});
test('Engine disposal cancels an open platform dialog and waits for its running World frame', async () => {
  const { world, host } = await fixture();
  let resolve;
  host.nativeWindowAction = () =>
    new Promise((done) => {
      resolve = done;
    });
  world.window.post(0x10);
  const frame = world.tick();
  while (!resolve) await new Promise((done) => setImmediate(done));
  const engine = {
    world,
    host: { nativeDispose: () => resolve(false) },
    renderer: { dispose() {} },
    audio: { dispose() {} },
    disposed: false,
  };
  await CatSystem2.prototype.dispose.call(engine);
  await frame;
  assert.equal(world.closed, true);
  assert.equal(world.running, false);
  assert.equal(world.frameSettled, null);
  assert.equal(world.objects.objects.size, 0);
});

test('host exit settles its open modal and a second window queued behind a settings write', async () => {
  const { world, host } = await fixture('sdk-4.01-engine-2.6.1.74', OrdinaryNativeWorld);
  const engine = {
    world,
    renderer: { dispose() {} },
    audio: { dispose() {} },
    disposed: false,
  };
  engine.host = new EngineHost(engine);
  engine.host.windowService = new BrowserNativeWindow(engine);
  const opened = Promise.withResolvers(),
    writing = Promise.withResolvers(),
    persisted = Promise.withResolvers();
  host.nativeWindowAction = (action, owner) => {
    if (action.type !== 'confirm-close') return engine.host.nativeWindowAction(action, owner);
    return new Promise((resolve) => {
      engine.host.windowService.cancel = () => resolve(false);
      opened.resolve();
    });
  };
  world.flushConfiguration = () => {
    writing.resolve();
    return persisted.promise;
  };
  let closedClipboard = false;
  engine.host.clipboardService = { close: () => (closedClipboard = true) };
  world.window.post(0x10);
  world.window.post(0x111, 40057);
  const frame = world.tick();
  try {
    await opened.promise;
    CatSystem2.prototype.cancelHostModal.call(engine);
    await writing.promise;
    persisted.resolve();
    await frame;
    assert.equal(world.frameSettled, null);
    assert.equal(world.quitRequested, undefined);
    assert.equal(engine.disposed, false);
    assert.equal(closedClipboard, false);
  } finally {
    await CatSystem2.prototype.dispose.call(engine);
  }
  assert.equal(closedClipboard, true);
  assert.equal(world.closed, true);
});

test('host exit before its first window preserves native message box cancellation results', async () => {
  const host = new EngineHost({});
  assert.equal(host.windowService, undefined);
  host.cancelHostModal();
  assert.equal(await host.nativeWindowAction({ type: 'script-message-box', buttons: 4 }, {}), 7);
});
