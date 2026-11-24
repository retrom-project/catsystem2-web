// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const marker = 0xb5178731;

function program(id, words) {
  return kcsProgram([
    [37, marker],
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    [59],
  ]);
}

async function runGuest(world, name, initialize) {
  const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false });
  initialize?.(task.machine);
  const sp = task.machine.sp;
  await world.runtime.scheduler.execute(task);
  assert.equal(task.machine.halted, true);
  assert.equal(task.machine.sp, sp + 4);
  assert.equal(task.machine.pop(), marker);
  return task.machine;
}

test('fixed 2.6.1.74 Main9 post, language confirmation, and ordinary Script shutdown', async (t) => {
  for (const [selector, accepted, translated] of [
    [1, false, false],
    [0xffffffff, true, true],
    [0, false, false],
  ]) {
    const world = await dataWorld(profile, { 'close.kcs': program(9, [selector]) });
    t.after(() => world.close({ flushFiles: false }));
    const actions = [],
      main = world.objects.objects.get(world.main.id),
      title = world.configuration.fields.application.title;
    assert.equal(main.scriptEnabled, 1);
    world.host.nativeWindowAction = async (action, owner) => {
      assert.equal(owner, world);
      actions.push(action);
      if (action.type === 'close') assert.equal(main.scriptEnabled, 0);
      return accepted;
    };
    if (translated)
      world.globalStrings.parse(
        0,
        new TextEncoder().encode(
          '$0000-0042$\nClose %s from its own menu?\n$0000-0043$\nOriginal language table\n',
        ),
      );
    await runGuest(world, 'close.kcs');
    assert.deepEqual(world.windowMessages, [
      { message: selector ? 0x10 : 0x433, wParam: 0, lParam: 0 },
    ]);
    assert.deepEqual(actions, []);
    await world.processWindowMessages();
    const expected = [];
    if (selector)
      expected.push({
        type: 'confirm-close',
        message: translated
          ? `Close ${title} from its own menu?`
          : `${title} を終了してよろしいですか？`,
        caption: translated ? 'Original language table' : '終了',
      });
    const quits = !selector || accepted;
    if (quits) expected.push({ type: 'hide' }, { type: 'close' });
    assert.deepEqual(actions, expected);
    assert.equal(Boolean(world.quitRequested), quits);
    assert.equal(main.scriptEnabled, quits ? 0 : 1);
    assert.deepEqual(world.windowMessages, []);
  }
});

test('fixed 2.6.1.74 Main10 formats clipboard CP932 before writing to the browser owner', async (t) => {
  const world = await dataWorld(profile, {
    'copy.kcs': program(10, [256]),
    'unmapped.kcs': program(10, [0xffffffff]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const writes = [],
    diagnostics = [];
  let active = true;
  const clipboard = new BrowserNativeClipboard({
    clipboard: {
      async writeText(value) {
        assert.equal(clipboard.owner, world.window.handle);
        if (!active) throw new Error('User activation is required');
        writes.push(value);
      },
    },
    diagnostic: (value) => diagnostics.push(value),
  });
  world.runtime.services.nativeClipboard = clipboard;
  for (const [source, expected] of [
    ['猫\\n犬 %d[G192] 100%%', '猫\r\n犬 -41 100%'],
    ['ソnZ', '\ufffd\r\nZ'],
    ['', ''],
  ]) {
    const machine = await runGuest(world, 'copy.kcs', (machine) => {
      machine.writeString(source, 256);
      machine.store(192, -41);
    });
    assert.equal(machine.string(256), source);
    assert.deepEqual(writes.splice(0), ['', expected]);
    assert.equal(clipboard.opened, false);
  }
  active = false;
  await runGuest(world, 'copy.kcs', (machine) => machine.writeString('denied', 256));
  assert.deepEqual(writes, []);
  assert.equal(clipboard.opened, false);
  assert.deepEqual(
    diagnostics.splice(0),
    Array.from({ length: 2 }, () => ({
      type: 'native-clipboard',
      message: 'User activation is required',
    })),
  );
  world.runtime.services.nativeClipboard = new BrowserNativeClipboard({ clipboard: null });
  await runGuest(world, 'copy.kcs', (machine) => machine.writeString('unavailable', 256));
  assert.deepEqual(writes, []);
  await assert.rejects(runGuest(world, 'unmapped.kcs'), /KCS memory/);
});
