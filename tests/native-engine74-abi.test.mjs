// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
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

const integerKCS = kcsProgram([[37, marker], [43, 33, 0], [38, 64], [59]]);

async function randomWorld(t, rows, seed = 0) {
  const world = await defaultFESWorld(profile, {
    'screen.fes': new TextEncoder().encode(['#START', ...rows, 'wait 10'].join('\n')),
    'integer.kcs': integerKCS,
  });
  t.after(() => world.close({ flushFiles: false }));
  const bank = world.runtime.variableBank(world.objects.objects.get(world.main.id));
  bank.initialize(256);
  bank.words.fill(marker);
  bank.dirty = false;
  const { instance, task } = await loadDefaultFES(world);
  world.random.integer.seed(seed);
  return { world, instance, privateState: task.player.randomState, bank };
}

test('fixed 2.6.1.74 FES rand advances the native integer stream read by the next Main33', async (t) => {
  for (const [seed, selected, following] of [
    [0, 2, 3667282373],
    [0xffffffff, 1, 1275255859],
  ]) {
    const { world, instance, privateState, bank } = await randomWorld(
      t,
      ['rand 27 1 2', 'if ($27==1)', '$28=101', 'else', '$28=102', 'endif'],
      seed,
    );
    const real = world.random.real.snapshot();
    await world.tick();
    assert.deepEqual(bank.words.slice(27, 29), Uint32Array.from([selected, 100 + selected]));
    assert.equal(world.random.integer.index, 1);
    assert.equal(instance.player.randomState, privateState);
    const machine = await runGuest(world, 'integer.kcs');
    assert.equal(machine.load(64), following);
    assert.equal(world.random.integer.index, 2);
    assert.deepEqual(world.random.real.snapshot(), real);
  }
});

test('fixed 2.6.1.74 rand and randtbl preserve original ranges, writes, and missing operands', async (t) => {
  const cases = [
    ['rand 11 15 0', [[11, 477480920]], 1, 3667282373, true],
    ['rand 513 1 3', [], 1, 3667282373, true],
    ['rand 27 1', [], 624, 477480905, false],
    [
      'randtbl 20 23 40 44',
      [
        [20, 42],
        [21, 43],
        [22, 40],
        [23, 41],
      ],
      130,
      3399954203,
      true,
    ],
    ['randtbl 31 31 80 100', [[31, 80]], 130, 3399954203, true],
    [
      'randtbl 250 259 -20 -11',
      [
        [250, 0],
        [251, 0],
        [252, 0],
        [253, 0],
        [254, 0],
        [255, 0],
      ],
      130,
      3399954203,
      true,
    ],
    ['randtbl 22 1 7 9', [], 130, 3399954203, true],
    ['randtbl 20 26 4', [], 624, 477480905, false],
  ];
  for (const [row, writes, index, following, dirty] of cases) {
    const { world, instance, bank } = await randomWorld(t, [row]);
    const expected = new Uint32Array(bank.capacity).fill(marker);
    for (const [index, word] of writes) expected[index] = word;
    const read = instance.player.host.nativeFESArgumentBytes;
    const fetched = [];
    instance.player.host.nativeFESArgumentBytes = (bytes, ...args) => {
      fetched.push(new TextDecoder().decode(bytes));
      return read(bytes, ...args);
    };
    await world.tick();
    const wait = fetched.indexOf('wait');
    assert.ok(wait >= 0, row);
    assert.deepEqual(fetched.slice(0, wait), row.split(' ').slice(1), row);
    assert.deepEqual(bank.words, expected, row);
    assert.equal(bank.dirty, dirty, row);
    assert.equal(world.random.integer.index, index, row);
    assert.equal((await runGuest(world, 'integer.kcs')).load(64), following, row);
  }
});

test('fixed 2.6.1.74 RNG rejects undefined division and signed table overflow', async (t) => {
  for (const [row, failure] of [
    ['rand 20 1 0', /zero unsigned range/],
    ['randtbl 20 19 4 8', /zero unsigned range/],
    ['randtbl 2147483647 2147483647 4 8', /signed index overflow/],
  ]) {
    const { world, bank } = await randomWorld(t, [row]);
    await assert.rejects(world.tick(), failure, row);
    assert.equal(world.random.integer.index, 624);
    assert.equal(bank.dirty, false);
  }
});
