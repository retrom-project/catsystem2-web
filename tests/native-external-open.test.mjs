// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { BrowserNativeWindow } from '../src/native/window-browser.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { kcsProgram } from './helpers.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-external-open-golden.json', import.meta.url)),
  ),
  profiles = {
    23: 'grisaia-jp-engine-2.6.1.23',
    63: 'rebellions-jp-engine-2.6.1.63',
    67: 'bokutomo-engine-2.6.1.67',
  },
  ascii = (text) => new TextEncoder().encode(text),
  program = kcsProgram([[43, 629, 12], [59]]);

for (const build of golden.builds) {
  test(`${build.version} Main629 real GCALL preserves its three expansions and discards ShellExecute results`, async () => {
    const profile = profiles[build.version],
      world = await dataWorld(profile),
      seen = [];
    let leafResult;
    world.host.nativeWindowAction = (action) => {
      seen.push(action);
      return leafResult;
    };
    try {
      const entry = nativeABI(profile).tables.main.entries[629];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.signature.argumentWords, 3);
      for (const row of build.cases) {
        const task = world.main,
          m = (task.machine = new KCSMachine(
            await readKCS(kcsProgram([[43, 629, row.args.length * 4], [59]])),
            { native: (id, args, vm) => world.runtime.scheduler.native(task, id, args, vm) },
          ));
        m.memory.fill(0xa5);
        m.shared.fill(0x93);
        m.floor = m.fp = 3584;
        m.sp = 3588 + row.args.length * 4;
        m.pc = 0;
        m.store(3584, 0x93deff25);
        row.args.forEach((word, i) => m.store(3588 + 4 * i, word));
        const offsets = [256, 768, 1280];
        row.strings.forEach((text, i) =>
          m.writeString(text, (offsets[i] | (row.shared ? 0x80000000 : 0)) >>> 0),
        );
        for (const [at, word] of row.words ?? []) m.store(at, word);
        const memory = m.memory.slice(),
          shared = m.shared.slice();
        task.status = 'ready';
        task.io = null;
        leafResult = row.result;
        assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
        assert.equal(m.sp, 3588);
        assert.deepEqual(m.memory, memory);
        assert.deepEqual(m.shared, shared);
        const action = seen.at(-1);
        assert.equal(action.type, 'script-shell-open');
        assert.equal(action.window, world.window.handle);
        assert.equal(action.operation, 'open');
        assert.equal(action.show, row.leaf.show);
        for (const name of ['file', 'parameters', 'directory'])
          assert.deepEqual([...action[name]], row.leaf[name]);
      }
      const task = world.main,
        snapshot = world.snapshot(0),
        copy = await dataWorld(profile, { 'case.kcs': program }, { initialize: false });
      try {
        let calls = 0;
        copy.host.nativeWindowAction = () => (calls++, 0);
        await copy.restore(structuredClone(snapshot));
        assert.equal(calls, 0);
        assert.deepEqual(copy.snapshot(0), snapshot);
        const restored = copy.main;
        restored.machine.pc = 0;
        restored.machine.halted = false;
        restored.machine.sp = 3600;
        restored.status = 'ready';
        restored.io = null;
        assert.equal((await copy.runtime.scheduler.execute(restored)).status, 'halted');
        assert.equal(calls, 1);
        assert.equal(restored.machine.sp, 3588);
        await assert.rejects(
          world.runtime.native('main', 629, [256], task.machine, task),
          /three string arguments/,
        );
        task.machine.writeString('x'.repeat(260), 256);
        await assert.rejects(
          world.runtime.native('main', 629, [256, 768, 1280], task.machine, task),
          /260-byte string temporary/,
        );
      } finally {
        await copy.close({ flushFiles: false });
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('browser external open detaches the blank window before navigation and reports actual capability failures', (t) => {
  const previous = globalThis.window,
    browser = new BrowserNativeWindow({}),
    traffic = [],
    target = {
      opener: {},
      location: {
        replace(url) {
          assert.equal(target.opener, null);
          traffic.push(['navigate', url]);
        },
      },
      close: () => traffic.push(['close']),
    },
    action = { type: 'fes-open-site', bytes: ascii('https://example.invalid/path') };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  globalThis.window = {
    open: (...args) => {
      traffic.push(args);
      return target;
    },
  };
  assert.equal(browser.externalOpen(action), 33);
  assert.deepEqual(traffic, [
    ['about:blank', '_blank'],
    ['navigate', 'https://example.invalid/path'],
  ]);
  window.open = () => null;
  assert.equal(browser.externalOpen(action), 5);
  window.open = () => {
    throw new DOMException('sandbox', 'SecurityError');
  };
  assert.equal(browser.externalOpen(action), 5);
  assert.equal(browser.externalOpen({ ...action, bytes: ascii('file:///C:/tool.exe') }), 31);
  assert.equal(
    browser.externalOpen({ ...action, bytes: ascii('mailto:example@example.invalid') }),
    31,
  );
  assert.equal(browser.externalOpen({ ...action, bytes: ascii('relative-file') }), 31);
  assert.equal(
    browser.externalOpen({
      type: 'script-shell-open',
      operation: 'open',
      show: 5,
      file: action.bytes,
      parameters: ascii('argument'),
      directory: ascii(''),
    }),
    31,
  );
  delete globalThis.window;
  assert.equal(browser.externalOpen(action), 31);
  browser.cancelForExit();
  assert.equal(browser.externalOpen(action), 5);
});

test('ordinary FES browser popup failure uses its owned localized modal and existing FIFO', async (t) => {
  const dom = nativeWindowDOM(),
    previous = globalThis.window,
    world = await defaultFESWorld('sdk-4.01-engine-2.6.1.74', {
      'screen.fes': ascii(
        '#START\nnext IDLE\n#IDLE\n#SITE\nopensite (:https://example.invalid)\n$40=7\nbreak\n',
      ),
    }),
    browser = new BrowserNativeWindow({});
  t.after(() => {
    dom.dispose();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  globalThis.window = { open: () => null };
  world.host.nativeWindowAction = (action) => browser.perform(action, world);
  try {
    const h = await loadDefaultFES(world);
    assert.deepEqual(h.instance.execute(ascii('opensite (:https://example.invalid)'), [], 0), {
      action: 'flush',
    });
    const pending = h.instance.flushNativeRecords();
    for (let i = 0; i < 20 && !browser.dialog?.open; i++) await Promise.resolve();
    assert(browser.dialog?.open);
    assert.equal(browser.dialogOwner, h.id);
    assert(dom.all().some((node) => node.textContent?.includes('アクセスを拒否')));
    browser.dialog.children.at(-1).firstChild.onclick();
    await pending;
    assert.equal(browser.dialog, null);
    assert.equal(h.instance.runtime.pendingRecords.length, 0);
  } finally {
    browser.cancelForExit();
    await world.close({ flushFiles: false });
  }
});
