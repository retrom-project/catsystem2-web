// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeABI } from '../src/native/abi/index.mjs';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const marker = 0xb5178731;

function program(id, words) {
  return kcsProgram([[37, marker], ...callNative(id, words), [59]]);
}

function callNative(id, words, result) {
  const code = [...words.map((word) => [37, word]), [43, id, words.length * 4]];
  if (result !== undefined) code.push([38, result]);
  return code;
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

test('fixed SDK debug GCALL keeps original CP932 bounds and literal percent output', async (t) => {
  const world = await dataWorld(profile, { 'debug.kcs': program(1, [256]) });
  t.after(() => world.close({ flushFiles: false }));
  const output = [];
  world.host.nativeLog = (text) => output.push(text);
  for (const [source, expected] of [
    ['', ''],
    ['猫仮', '猫仮'],
    ['%d[G192] 100%%', '-41 100%'],
    ['100%%%%', '100%'],
    ['%% line %%', '% line %'],
    ['x'.repeat(499), 'x'.repeat(499)],
    ['x'.repeat(501), 'x'.repeat(500)],
    ['x'.repeat(499) + '猫', 'x'.repeat(499) + '\ufffd'],
  ]) {
    const machine = await runGuest(world, 'debug.kcs', (machine) => {
      machine.writeString(source, 256);
      machine.store(192, -41);
    });
    assert.equal(machine.string(256), source);
    assert.equal(output.pop(), expected);
  }
  assert.deepEqual(output, []);
  assert.equal(nativeABI(profile).tables.main.entries[1].signature.resultWritten, false);
});

test('fixed SDK file GCALLs use the byte mode and complete reads before advancing their cursor', async (t) => {
  const input = Uint8Array.of(25, 16, 255, 236, 14);
  const storage = new Map([['sample.bin', input]]);
  const stored = [];
  const handle = [0x13, 64];
  const transfer = (id, address, elementBytes, elements, result) =>
    callNative(id, [address, elementBytes, elements, handle], result);
  const fileProgram = (operations) =>
    kcsProgram([
      [37, marker],
      ...callNative(29, [128, 256], 64),
      ...operations.flat(),
      ...callNative(32, [handle]),
      [59],
    ]);
  const world = await dataWorld(
    profile,
    {
      'read.kcs': fileProgram([
        transfer(30, 320, 2, 2, 68),
        transfer(30, 0xffffffff, 1, 1, 72),
        transfer(30, 0x80000510, 0x80000001, 2, 76),
        transfer(30, 324, 1, 4, 80),
        transfer(31, 320, 1, 4, 84),
      ]),
      'write.kcs': fileProgram([
        transfer(31, 320, 2, 3, 68),
        transfer(31, 0x80000510, 0x80000001, 2, 72),
        transfer(30, 320, 1, 4, 76),
        callNative(30, [320, 1, 8, 0], 80),
        callNative(31, [320, 1, 8, 0], 84),
      ]),
    },
    {
      storage: {
        read: async (name) => storage.get(name)?.slice() ?? null,
        write: async (name, bytes) => {
          stored.push(name);
          storage.set(name, bytes.slice());
          return true;
        },
      },
    },
  );
  t.after(() => world.close({ flushFiles: false }));
  const canary = Uint8Array.from({ length: 8 }, (_, i) => 180 + i);
  const setup = (machine, name, mode) => {
    machine.writeString(name, 128);
    machine.writeStringBytes(Uint8Array.from(mode), 256);
    machine.bytes(320, 8).set(canary);
    machine.bytes(0x80000510, 8).set(canary);
  };
  for (const mode of [[114], [97], [114, 119], [0x81, 0x72]]) {
    const machine = await runGuest(world, 'read.kcs', (machine) =>
      setup(machine, 'sample.bin', mode),
    );
    assert.deepEqual(
      [68, 72, 76, 80, 84].map((address) => machine.load(address)),
      [4, 0, 1, 0, 0],
    );
    assert.deepEqual([...machine.bytes(320, 8)], [...input.slice(0, 4), ...canary.slice(4)]);
    assert.deepEqual([...machine.bytes(0x80000510, 8)], [14, ...canary.slice(1)]);
  }
  assert.deepEqual(stored, []);
  for (const mode of [
    [119, 114],
    [0x81, 0x77],
  ]) {
    const machine = await runGuest(world, 'write.kcs', (machine) =>
      setup(machine, 'output.bin', mode),
    );
    assert.deepEqual(
      [68, 72, 76, 80, 84].map((address) => machine.load(address)),
      [6, 2, 0, 0, 0],
    );
    assert.deepEqual(machine.bytes(320, 8), canary);
    assert.deepEqual(
      storage.get('output.bin'),
      Uint8Array.of(...canary.slice(0, 6), ...canary.slice(0, 2)),
    );
  }
  assert.deepEqual(stored, ['output.bin', 'output.bin']);
  const table = nativeABI(profile).tables.main.entries;
  for (const id of [30, 31]) {
    assert.equal(table[id].signature.review, 'reviewed');
    assert.equal(table[id].signature.result.unit, 'byte-count');
  }
});

test('fixed SDK name pairs append and query original bytes through the owned four-word calls', async (t) => {
  const handle = [0x13, 64];
  const compare = (source, first, second, result) =>
    callNative(292, [handle, source, first, second], result);
  const source = {
    'names.kcs': kcsProgram([
      [37, marker],
      ...callNative(289, [0x80000006, 2, 1], 64),
      ...callNative(291, [handle, 160, 0x1111, 0x2222]),
      ...callNative(291, [handle, 192, 0x81234567, 0x76543218]),
      ...callNative(291, [handle, 224, 11, 22]),
      ...callNative(291, [handle, 256, 0xfedcba98, 0x80000000]),
      ...callNative(291, [handle, 288, 61, 62]),
      ...callNative(291, [handle, 320, 71, 72]),
      ...compare(224, 104, 0x80000310, 68),
      ...compare(256, 108, 108, 72),
      ...compare(320, 112, 116, 76),
      ...compare(352, 120, 124, 80),
      ...callNative(293, [handle, 11, 22, 0x80000320], 84),
      ...callNative(293, [handle, 0x1111, 0x2222, 384], 88),
      ...callNative(292, [0, 224, 124, 124]),
      ...callNative(293, [0, 11, 22, 384]),
      [59],
    ]),
    'free.kcs': kcsProgram([[37, marker], ...callNative(290, [handle]), [59]]),
  };
  const world = await dataWorld(profile, source);
  t.after(() => world.close({ flushFiles: false }));
  const m = await runGuest(world, 'names.kcs', (vm) => {
    vm.writeString('', 160);
    vm.writeString('Tea', 192);
    vm.writeString('TEA', 224);
    vm.writeString('黒猫', 256);
    vm.writeStringBytes(Uint8Array.of(0x81, 0x72), 288);
    vm.writeStringBytes(Uint8Array.of(0x81, 0x52), 320);
    vm.writeString('missing', 352);
    vm.bytes(384, 8).fill(0xc5);
    vm.bytes(0x80000320, 8).fill(0xc5);
    vm.store(120, marker);
    vm.store(124, marker);
  });
  assert.deepEqual(
    [68, 72, 76, 80, 84, 88].map((at) => m.load(at)),
    [1, 1, 1, 0, 1, 0],
  );
  assert.deepEqual(
    [104, 0x80000310, 108, 112, 116, 120, 124].map((at) => m.load(at)),
    [0x81234567, 0x76543218, 0x80000000, 61, 62, marker, marker],
  );
  assert.deepEqual(m.bytes(0x80000320, 8), Uint8Array.of(84, 69, 65, 0, 0xc5, 0xc5, 0xc5, 0xc5));
  assert.deepEqual(m.bytes(384, 8), new Uint8Array(8).fill(0xc5));
  const id = m.load(64);
  const pairs = world.runtime.handles.get(id, 'name-pairs');
  assert.equal(pairs.length, 12 * 40);
  assert.deepEqual(pairs.subarray(5 * 40), new Uint8Array(7 * 40));
  const fresh = await dataWorld(profile, source, { initialize: false });
  t.after(() => fresh.close({ flushFiles: false }));
  await fresh.restore(world.snapshot());
  assert.deepEqual(fresh.runtime.handles.get(id, 'name-pairs'), pairs);
  assert.notEqual(fresh.runtime.handles.get(id, 'name-pairs'), pairs);
  await runGuest(fresh, 'free.kcs', (vm) => vm.store(64, id));
  assert.equal(fresh.runtime.handles.records.has(id), false);
  assert.equal(world.runtime.handles.records.has(id), true);
});

for (const matrixProfile of [profile, 'nekopara-vol3-engine-2.6.1.76']) {
  test(
    matrixProfile + ' Main662 writes the native x87 yaw, pitch and roll matrix in place',
    async (t) => {
      const fixtures = [
        [
          129,
          [0, 0x80000000, 0],
          '3f800000 00000000 00000000 00000000 00000000 3f800000 00000000 00000000 00000000 00000000 3f800000 00000000 00000000 00000000 00000000 3f800000',
        ],
        [
          0x80000103,
          [0x3f99999a, 0xbf266666, 0x3f66a7f0],
          'be5e71b0 3f1fc442 bf402402 00000000 bf225e4c 3efd0bae 3f1832ea 00000000 3f3df27a 3f1aed80 3e93b1f6 00000000 00000000 00000000 00000000 3f800000',
        ],
      ];
      const world = await dataWorld(
        matrixProfile,
        Object.fromEntries(
          fixtures.map(([at, angles], i) => [`matrix-${i}.kcs`, program(662, [at, ...angles])]),
        ),
      );
      t.after(() => world.close({ flushFiles: false }));
      for (const [i, [at, , expected]] of fixtures.entries()) {
        const m = await runGuest(world, `matrix-${i}.kcs`, (vm) => {
          vm.bytes(at - 4, 72).fill(0x1e);
        });
        assert.deepEqual(
          Array.from({ length: 16 }, (_, word) => m.load(at + word * 4)),
          expected.split(' ').map((word) => Number.parseInt(word, 16)),
        );
        assert.deepEqual([m.load(at - 4), m.load(at + 64)], [0x1e1e1e1e, 0x1e1e1e1e]);
      }
    },
  );
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

test('fixed 2.6.1.74 KCS local date writes seven unsigned fields in alias order', async (t) => {
  const address = [64, 68, 72, 76, 80, 84, 88];
  const world = await dataWorld(profile, {
    'clock.kcs': program(11, address),
    'clock-alias.kcs': program(11, Array(7).fill(64)),
  });
  t.after(() => world.close({ flushFiles: false }));
  world.runtime.services.date = () => new Date(2000, 1, 29, 23, 59, 58, 27);
  const now = await runGuest(world, 'clock.kcs');
  assert.deepEqual(
    address.map((at) => now.load(at)),
    [2000, 2, 2, 29, 23, 59, 58],
  );
  const alias = await runGuest(world, 'clock-alias.kcs', (machine) => machine.store(68, marker));
  assert.equal(alias.load(64), 58);
  assert.equal(alias.load(68), marker);
});

test('fixed 2.6.1.74 KCS heap compacts addresses and retains the empty allocation sentinel', async (t) => {
  const memory = (slot) => [0x13, slot];
  const executable = kcsProgram([
    [37, marker],
    ...callNative(27, [0], 64),
    ...callNative(27, [17], 68),
    ...callNative(27, [8], 72),
    ...callNative(36, [memory(72), 0x51, 3]),
    ...callNative(28, [memory(64)], 76),
    ...callNative(28, [memory(68)], 80),
    ...callNative(28, [memory(72)], 84),
    [59],
  ]);
  const world = await dataWorld(profile, { 'heap.kcs': executable });
  t.after(() => world.close({ flushFiles: false }));
  const machine = await runGuest(world, 'heap.kcs');
  const base = machine.load(68);
  assert.equal(machine.load(64), 0xffffffff);
  assert.equal(machine.load(72), base + 17);
  assert.deepEqual(
    [76, 80, 84].map((address) => machine.load(address)),
    [0, 1, 0],
  );
  assert.deepEqual([...machine.bytes(base, 8)], [0x51, 0x51, 0x51, 0, 0, 0, 0, 0]);
  assert.throws(() => machine.bytes(base + 17, 1), /KCS memory/);
});

test('fixed 2.6.1.74 original control-one stubs consume any declared stack span and leave the result unwritten', async (t) => {
  const abi = nativeABI(profile);
  for (const id of [140, 142, 549]) {
    const { signature } = abi.tables.main.entries[id];
    assert.deepEqual(signature.controlCodes, [1]);
    assert.equal(signature.argumentWords, null);
    assert.equal(signature.resultWritten, false);
    const code = kcsProgram([
      [37, marker],
      ...callNative(id, [], 64),
      ...callNative(id, [0xffffffff], 68),
      ...callNative(id, [1, 2, 0xffffffff, 4], 72),
      [59],
    ]);
    const world = await dataWorld(profile, { 'unwritten.kcs': code });
    t.after(() => world.close({ flushFiles: false }));
    const machine = await runGuest(world, 'unwritten.kcs');
    assert.deepEqual(
      [64, 68, 72].map((at) => machine.load(at)),
      Array(3).fill(0xcccccccc),
    );
  }
});
