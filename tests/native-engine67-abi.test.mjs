// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { CatSystem2 } from '../src/engine.mjs';
import { bitsFloat, encodeCP932, floatBits, KCSMachine, readKCS } from '../src/kcs.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { parseXML } from '../src/xml.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67';

async function run(instructions, diagnostic) {
  const runtime = new NativeRuntime({
    profile,
    read: async () => kcsProgram(instructions),
    services: { diagnostic },
  });
  const task = await runtime.spawn('abi-probe.kcs');
  return { runtime, task, machine: task.machine };
}

test('2.6.1.67 Main stubs preserve their original three result behaviors', async () => {
  const table = nativeABI(profile).tables.main.entries;
  const noops = table.filter((entry) => entry.status === 'reserved');
  const zeros = table.filter((entry) => entry.status === 'constant-zero');
  const unwritten = [140, 142, 549].map((id) => table[id]);
  assert.equal(noops.length, 80);
  assert.equal(zeros.length, 19);
  const cases = [...noops, ...zeros, ...unwritten];
  const markerAddress = (index) => 512 + index * 4;
  const resultAddress = (index) => 1024 + index * 4;
  const marker = 0x82345678;

  // The fixed scripts exercise ignored calls with zero to seven argument words.
  for (let words = 0; words <= 7; words++) {
    const instructions = cases.flatMap((entry, index) => [
      [37, marker],
      ...Array.from({ length: words }, (_, word) => [37, 0xffa0b000 + word]),
      [43, entry.id, words * 4],
      ...(entry.status === 'reserved' ? [] : [[38, resultAddress(index)]]),
      [38, markerAddress(index)],
    ]);
    const diagnostics = [];
    const { runtime, task, machine } = await run([...instructions, [59]], (event) =>
      diagnostics.push(event),
    );
    machine.bytes(1024, cases.length * 4).fill(0xa5);
    machine.store(508, 0x3b46d32d);
    const stack = machine.sp;
    await runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, stack);
    assert.equal(machine.load(508), 0x3b46d32d);
    for (const [index, entry] of cases.entries()) {
      const noResult = entry.status === 'reserved';
      const zero = entry.status === 'constant-zero';
      assert.equal(runtime.calls.get(`main:${entry.id}`), 1);
      assert.equal(entry.signature.argumentWords, null);
      assert.equal(entry.signature.parameters.kind, 'ignored');
      assert.equal(entry.signature.resultWritten, zero);
      assert.deepEqual(entry.controlCodes, noResult ? [2] : [1]);
      assert.equal(machine.load(markerAddress(index)), marker);
      assert.equal(
        machine.load(resultAddress(index)),
        noResult ? 0xa5a5a5a5 : zero ? 0 : NATIVE_RESULT_SENTINEL,
      );
    }
    assert.equal(diagnostics.length, 3);
    assert.ok(diagnostics.every((event) => event.type === 'native-result-sentinel'));
  }
});

test('2.6.1.67 name pairs preserve owned CP932 rows across a cold restore', async () => {
  const marker = 0xc461789a,
    text = 0x80000300,
    output = 0x80000340;
  let world = await dataWorld(profile);
  const call = async (id, args, name, callback) => {
    const program = await readKCS(
        kcsProgram([
          [37, marker],
          ...args.map((arg) => [37, arg]),
          [43, id, args.length * 4],
          [59],
        ]),
      ),
      task = { ...world.main, io: null },
      machine = (task.machine = new KCSMachine(
        program,
        {
          native: (number, words, caller) =>
            world.runtime.scheduler.native(task, number, words, caller),
        },
        world.runtime.scheduler.shared,
      ));
    if (name) machine.writeStringBytes(name, text);
    machine.bytes(output - 1, 16).fill(0xc5);
    await world.runtime.scheduler.execute(task);
    const result = machine.sp === machine.floor + 8 ? machine.pop() : undefined;
    assert.equal(machine.pop(), marker);
    callback?.(machine);
    return result;
  };
  try {
    const handle = await call(289, [3, 1, 1]);
    const bytes = world.runtime.handles.get(handle, 'name-pairs');
    assert.equal(bytes.length, 120);
    assert.equal(
      await call(291, [handle, text, 0x12345678, 0xabcdef01], Uint8Array.of(0x81, 0x72)),
      undefined,
    );
    await call(291, [handle, text, 1, 2], encodeCP932('黒猫'));
    assert.equal(
      await call(292, [handle, text, output, output], Uint8Array.of(0x81, 0x52), (machine) => {
        assert.equal(machine.load(output), 0xabcdef01);
      }),
      1,
    );
    assert.equal(
      await call(293, [handle, 2, 1, output], undefined, (machine) => {
        assert.deepEqual(machine.bytes(output - 1, 16), new Uint8Array(16).fill(0xc5));
      }),
      0,
    );
    assert.equal(await call(292, [0, 0, 0, 0]), undefined);
    const snapshot = structuredClone(world.snapshot());
    await world.close({ flushFiles: false });
    world = await dataWorld(profile, {}, { initialize: false });
    await world.restore(snapshot);
    assert.deepEqual(world.runtime.handles.get(handle, 'name-pairs'), bytes);
    assert.notEqual(world.runtime.handles.get(handle, 'name-pairs'), bytes);
    assert.equal(
      await call(293, [handle, 1, 2, output], undefined, (machine) => {
        assert.deepEqual(
          machine.bytes(output - 1, 7),
          Uint8Array.of(0xc5, ...encodeCP932('黒猫'), 0, 0xc5),
        );
      }),
      1,
    );
    await call(290, [handle]);
    await assert.rejects(call(293, [handle, 1, 2, output]), /released native name-pairs/);
    const full = await call(289, [1, 1, 1]);
    await call(291, [full, text, 1, 2], encodeCP932('first'));
    await assert.rejects(
      call(291, [full, text, 3, 4], encodeCP932('extra')),
      /end of its allocation/,
    );
    assert.equal(world.runtime.handles.get(full, 'name-pairs')[0], 102);
    await call(290, [full]);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('2.6.1.67 signed rectangles preserve shared aliases and intersect in place', async (t) => {
  const marker = 0x0d37c456,
    shared = 0x80000110,
    local = 256,
    instructions = (id, args) => [...args.map((word) => [37, word]), [43, id, args.length * 4]],
    program = kcsProgram([
      [37, marker],
      ...instructions(214, [shared]),
      ...instructions(215, [shared, local]),
      ...instructions(215, [shared, shared]),
      ...instructions(218, [shared, -2, -12, 20, 18]),
      ...instructions(217, [shared]),
      [38, 120],
      ...instructions(218, [shared, 100, 100, 151, 153]),
      ...instructions(217, [shared]),
      [38, 124],
      [59],
    ]),
    world = await dataWorld(profile, { 'rect.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('rect.kcs', { initialExecute: false }),
    m = task.machine;
  const edges = [-20, -3, 8, 44];
  edges.forEach((edge, i) => m.store(local + i * 4, edge));
  m.store(shared - 4, marker);
  m.store(shared + 16, marker);
  const floor = m.floor;
  await world.runtime.scheduler.execute(task);
  assert.equal(m.sp, floor + 4);
  assert.equal(m.pop(), marker);
  assert.deepEqual([m.load(120), m.load(124)], [0, 1]);
  assert.deepEqual(
    edges.map((_, i) => m.load(local + i * 4) | 0),
    edges,
  );
  assert.deepEqual(
    edges.map((_, i) => m.load(shared + i * 4)),
    [0, 0, 0, 0],
  );
  assert.equal(m.load(shared - 4), marker);
  assert.equal(m.load(shared + 16), marker);
});

test('2.6.1.67 task queries enumerate branch keys and follow owner teardown', async () => {
  const files = { 'child.kcs': kcsProgram([[59]]) };
  let world = await dataWorld(profile, files);
  const word = 0xcd34e26a;
  const call = async (id, args, ownerID = world.main.id) => {
    const script = await readKCS(
        kcsProgram([[37, word], ...args.map((arg) => [37, arg]), [43, id, args.length * 4], [59]]),
      ),
      owner = {
        context: {},
        ...world.runtime.scheduler.tasks.get(ownerID),
        id: ownerID,
        abi: 'main',
        io: null,
      },
      machine = (owner.machine = new KCSMachine(
        script,
        {
          native: (number, supplied, caller) =>
            world.runtime.scheduler.native(owner, number, supplied, caller),
        },
        world.runtime.scheduler.shared,
      ));
    machine.writeString('child.kcs', 0x200);
    await world.runtime.scheduler.execute(owner);
    assert.equal(machine.sp, machine.floor + (id === 67 ? 4 : 8));
    const response = id === 67 ? null : machine.pop();
    assert.equal(machine.pop(), word);
    return response;
  };
  try {
    const parent = world.main.id,
      parentID = world.nativeTaskID(parent),
      first = 0xdf20be12,
      nested = 0xe4decaa1,
      firstAt = await world.objects.create({ kind: 12, parent, nativeID: first }),
      nestedAt = await world.objects.create({ kind: 12, parent: firstAt, nativeID: nested }),
      fresh = await call(66, [12, parentID, 0x200]);
    assert.ok(fresh && fresh !== 0xffffffff);
    const created = world.resolveTaskID(fresh, parent);
    assert.equal(world.objects.objects.get(created).kind, 12);
    for (const [index, key] of [first, nested, fresh, 0xffffffff].entries())
      assert.equal(await call(75, [index]), key);
    assert.equal(await call(75, [0xffffffff]), 0xffffffff);
    assert.equal(await call(76, [], nestedAt), first);
    assert.equal(await call(76, [], firstAt), parentID);
    assert.equal(await call(74, [fresh]), 12);
    assert.equal(await call(74, [0x7364cafa]), 0xffffffff);
    assert.equal(await call(77, [0]), 0);
    assert.equal(await call(77, [nested]), 1);
    await assert.rejects(call(74, [0]), /Root query caller pointer/);
    await call(67, [fresh]);
    await assert.rejects(call(74, [fresh]), /retiring owner/);
    assert.equal(await call(77, [fresh]), 1);
    const checkpoint = structuredClone(world.snapshot());
    await world.close({ flushFiles: false });
    world = await dataWorld(profile, files, { initialize: false });
    await world.restore(checkpoint);
    assert.equal(await call(75, [1]), nested);
    assert.equal(await call(77, [fresh]), 1);
    await world.objects.release(created);
    assert.equal(await call(75, [2]), 0xffffffff);
    assert.equal(await call(77, [fresh]), 1, 'base destruction retains the root registry key');
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('2.6.1.67 Main9 preserves queued close confirmation and Script shutdown', async (t) => {
  const marker = 0x62913675;
  for (const [selector, accepted] of [
    [0, false],
    [1, false],
    [0xffffffff, true],
  ]) {
    const program = kcsProgram([[37, marker], [37, selector], [43, 9, 4], [59]]);
    const world = await dataWorld(profile, { 'desktop-close.kcs': program });
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('desktop-close.kcs', { initialExecute: false });
    const main = world.objects.objects.get(world.main.id),
      actions = [],
      title = world.configuration.fields.application.title;
    world.host.nativeWindowAction = async (action) => {
      actions.push(action);
      if (action.type === 'close') assert.equal(main.scriptEnabled, 0);
      return accepted;
    };
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, task.machine.floor + 4);
    assert.equal(task.machine.pop(), marker);
    assert.deepEqual(actions, []);
    assert.deepEqual(world.windowMessages, [
      { message: selector ? 0x10 : 0x433, wParam: 0, lParam: 0 },
    ]);
    await world.processWindowMessages();
    const quits = !selector || accepted,
      expected = selector
        ? [
            {
              type: 'confirm-close',
              message: `${title} を終了してよろしいですか？`,
              caption: '終了',
            },
          ]
        : [];
    if (quits) expected.push({ type: 'hide' }, { type: 'close' });
    assert.deepEqual(actions, expected);
    assert.equal(main.scriptEnabled, quits ? 0 : 1);
    assert.equal(Boolean(world.quitRequested), quits);
  }
});

test('2.6.1.67 KCS queues display and minimize commands and confirms Script shutdown', async () => {
  const marker = 0x5a8f2813,
    files = Object.fromEntries(
      [845, 846, 847].map((id) => [`${id}.kcs`, kcsProgram([[37, marker], [43, id, 0], [59]])]),
    ),
    world = await dataWorld(profile, files),
    requests = [],
    actions = [];
  let confirm = false;
  world.host.nativeWindowMessage = async (message) => {
    requests.push(message);
    CatSystem2.prototype.nativeWindowStateChanged.call({
      world,
      host: { nativeIsWindow: () => message.lParam === 0 },
    });
  };
  world.host.nativeWindowAction = async (action) => {
    actions.push(action);
    return action.type === 'confirm-close' && confirm;
  };
  const post = async (id) => {
    const task = await world.spawnScript(`${id}.kcs`, { initialExecute: false });
    try {
      await world.runtime.scheduler.execute(task);
      assert.equal(task.machine.sp, task.machine.floor + 4);
      assert.equal(task.machine.pop(), marker);
      assert.deepEqual(world.windowMessages, [{ message: 0x469 + id - 845, wParam: 0, lParam: 0 }]);
    } finally {
      await world.objects.release(task.id);
    }
    await world.processWindowMessages();
    assert.deepEqual(world.windowMessages, []);
  };
  try {
    const { screen } = world.configuration;
    screen.fullscreen = 0;
    screen.fullWidth = 960;
    screen.fullHeight = 588;
    await post(845);
    assert.equal(requests.at(-1).lParam, 1);
    assert.deepEqual([screen.fullscreen, screen.currentWidth, screen.currentHeight], [1, 960, 588]);
    await post(845);
    assert.equal(requests.at(-1).lParam, 0);
    assert.deepEqual(
      [screen.fullscreen, screen.currentWidth, screen.currentHeight],
      [0, screen.width, screen.height],
    );
    await post(846);
    assert.deepEqual(
      actions.map(({ type }) => type),
      ['minimize'],
    );
    world.input.idleFrames = 9;
    await post(847);
    assert.equal(world.input.idleFrames, 0);
    assert.equal(actions.at(-1).type, 'confirm-close');
    assert.equal(actions.at(-1).caption, '終了');
    assert.ok(!world.quitRequested);
    assert.equal(world.objects.objects.get(world.main.id).scriptEnabled, 1);
    confirm = true;
    await post(847);
    assert.deepEqual(
      actions.slice(-3).map(({ type }) => type),
      ['confirm-close', 'hide', 'close'],
    );
    assert.equal(world.objects.objects.get(world.main.id).scriptEnabled, 0);
    assert.equal(world.quitRequested, true);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('2.6.1.67 Main10 formats raw CP932 clipboard bytes through the browser owner', async (t) => {
  const marker = 0x21695740,
    program = kcsProgram([[37, marker], [37, 256], [43, 10, 4], [59]]);
  const world = await dataWorld(profile, { 'clipboard.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const writes = [],
    diagnostics = [];
  let userActive = true;
  const clipboard = new BrowserNativeClipboard({
    clipboard: {
      async writeText(text) {
        assert.equal(clipboard.owner, world.window.handle);
        if (!userActive) throw new Error('User activation is required');
        writes.push(text);
      },
    },
    diagnostic: (detail) => diagnostics.push(detail),
  });
  world.runtime.services.nativeClipboard = clipboard;
  async function copy(source, output) {
    const task = await world.spawnScript('clipboard.kcs', { initialExecute: false });
    task.machine.store(192, -41);
    task.machine.writeString(source, 256);
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, task.machine.floor + 4);
    assert.equal(task.machine.pop(), marker);
    assert.equal(task.machine.string(256), source);
    assert.deepEqual(writes.splice(0), output);
    assert.equal(clipboard.opened, false);
  }
  await copy('猫\\n犬 %d[G192] 100%%', ['', '猫\r\n犬 -41 100%']);
  await copy('ソnZ', ['', '\ufffd\r\nZ']);
  await copy('', ['', '']);
  userActive = false;
  await copy('clipboard permission denied', []);
  assert.deepEqual(
    diagnostics.map((detail) => detail.type),
    ['native-clipboard', 'native-clipboard'],
  );
});

test('2.6.1.67 Main7 and Main11 return the task rate and write the local date in guest order', async (t) => {
  const marker = 0xfe473287,
    addresses = [68, 0x80000048, 76, 0x80000050, 84, 0x80000058, 92],
    dateProgram = (targets) =>
      kcsProgram([[37, marker], ...targets.map((word) => [37, word]), [43, 11, 28], [59]]);
  const world = await dataWorld(profile, {
    'clock-date.kcs': dateProgram(addresses),
    'clock-alias.kcs': dateProgram(Array(7).fill(0x80000044)),
    'clock-rate.kcs': kcsProgram([[37, marker], [43, 7, 0], [38, 64], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  world.runtime.services.date = () => new Date(2000, 1, 29, 23, 59, 58, 999);
  for (const [source, output, expected] of [
    ['clock-date.kcs', addresses, [2000, 2, 2, 29, 23, 59, 58]],
    ['clock-alias.kcs', [0x80000044], [58]],
    ['clock-rate.kcs', [64], [0x80000000]],
  ]) {
    const task = await world.spawnScript(source, { initialExecute: false });
    if (source === 'clock-rate.kcs') world.objects.objects.get(task.id).frameRate = expected[0];
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, task.machine.floor + 4);
    assert.equal(task.machine.pop(), marker);
    assert.deepEqual(
      output.map((address) => task.machine.load(address)),
      expected,
    );
  }
});

test('2.6.1.67 regular files retain raw modes and transfer counts through owning KCS handles', async (t) => {
  const marker = 0x12bd6639,
    saved = new Map([['input.bin', Uint8Array.of(25, 16, 255, 236, 14)]]),
    fileHandle = [0x13, 64],
    open = [
      [37, 128],
      [37, 208],
      [43, 29, 8],
      [38, 64],
    ],
    close = [
      [37, fileHandle],
      [43, 32, 4],
    ],
    transfer = (id, address, size, count, output) => [
      [37, address],
      [37, size],
      [37, count],
      [37, fileHandle],
      [43, id, 16],
      [38, output],
    ],
    input = kcsProgram([
      [37, marker],
      ...open,
      ...transfer(30, 320, 2, 2, 72),
      ...transfer(30, 0x80000300, 0x80000001, 2, 76),
      ...transfer(31, 320, 1, 4, 80),
      ...close,
      [59],
    ]),
    output = kcsProgram([
      [37, marker],
      ...open,
      ...transfer(31, 320, 2, 3, 72),
      ...transfer(31, 0x80000300, 0x80000001, 2, 76),
      ...transfer(30, 320, 1, 4, 80),
      ...close,
      [59],
    ]);
  const world = await dataWorld(
    profile,
    { 'file-reader.kcs': input, 'file-writer.kcs': output },
    {
      storage: {
        read: async (name) => saved.get(name)?.slice() ?? null,
        write: async (name, bytes) => {
          saved.set(name, bytes.slice());
          return true;
        },
      },
    },
  );
  t.after(() => world.close({ flushFiles: false }));
  const previous = [...saved.get('input.bin')],
    bytes = Uint8Array.of(109, 110, 111, 112, 113, 114, 115, 116);
  for (const [script, name, mode, counts] of [
    ['file-reader.kcs', 'input.bin', [97, 0], [4, 1, 0]],
    ['file-writer.kcs', 'output.bin', [0x81, 0x77, 0], [6, 2, 0]],
  ]) {
    const task = await world.spawnScript(script, { initialExecute: false }),
      m = task.machine;
    m.writeString(name, 128);
    m.bytes(208, mode.length).set(mode);
    m.bytes(320, bytes.length).set(bytes);
    m.bytes(0x80000300, bytes.length).set(bytes);
    await world.runtime.scheduler.execute(task);
    assert.equal(m.sp, m.floor + 4);
    assert.equal(m.pop(), marker);
    const handle = m.load(64);
    assert.ok(handle);
    assert.equal(world.runtime.handles.records.has(handle), false);
    assert.deepEqual(
      [72, 76, 80].map((address) => m.load(address)),
      counts,
    );
    assert.deepEqual(
      [...m.bytes(320, 8)],
      script === 'file-reader.kcs' ? [...previous.slice(0, 4), ...bytes.slice(4)] : [...bytes],
    );
    assert.deepEqual(
      [...m.bytes(0x80000300, 8)],
      script === 'file-reader.kcs' ? [previous[4], ...bytes.slice(1)] : [...bytes],
    );
  }
  assert.deepEqual([...saved.get('input.bin')], previous);
  assert.deepEqual([...saved.get('output.bin')], [...bytes.slice(0, 6), ...bytes.slice(0, 2)]);
});

test('2.6.1.67 Main320 prepares spline records in the authored memory domain', async (t) => {
  const marker = 0xc41e2359,
    program = kcsProgram([[37, marker], [37, [0x13, 64]], [37, [0x13, 68]], [43, 320, 8], [59]]),
    world = await dataWorld(profile, { 'spline.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  async function runSpline(address, count, points, expected) {
    const task = await world.spawnScript('spline.kcs', { initialExecute: false }),
      { machine } = task,
      sp = machine.sp;
    machine.store(64, address);
    machine.store(68, count);
    if (points.length) {
      machine.bytes(address - 1, points.length * 20 + 2).fill(0xa5);
      points.forEach(([x, y], i) => {
        machine.store(address + 20 * i, floatBits(x));
        machine.store(address + 20 * i + 4, floatBits(y));
      });
    }
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(machine.sp, sp + 4);
    assert.equal(machine.pop(), marker);
    if (points.length) {
      assert.equal(machine.load(address - 1, 1), 0xa5);
      assert.equal(machine.load(address + points.length * 20, 1), 0xa5);
      points.forEach(([x, y], i) => {
        const at = address + 20 * i;
        assert.equal(machine.load(at), floatBits(x));
        assert.equal(machine.load(at + 4), floatBits(y));
        assert.deepEqual(
          [8, 12, 16].map((offset) => machine.load(at + offset)),
          expected[i],
        );
      });
    }
    await world.objects.release(task.id);
  }
  await runSpline(0xffffffff, 2, [], []);
  await runSpline(
    131,
    3,
    [
      [0, 4],
      [4, 12],
      [8, 20],
    ],
    [
      [0x40000000, 0x80000000, 0],
      [0x40000000, 0, 0x80000000],
      [0x40000000, 0x80000000, 0x80000000],
    ],
  );
  const upperNaN = [0x7fc00000, 0x7fc00000, 0x7fc00000],
    lowerNaN = [0xffc00000, 0xffc00000, 0xffc00000];
  await runSpline(
    0x80000087,
    4,
    [
      [0, 2],
      [0, 2],
      [1, 4],
      [3, 9],
    ],
    Array(4).fill(upperNaN),
  );
  await runSpline(
    0x8000008b,
    4,
    [
      [1, 0],
      [2, 2.75],
      [3, 2],
      [3, 6.75],
    ],
    Array(4).fill(lowerNaN),
  );
});

test('2.6.1.67 kind 8 Text preserves its original packets, rows and published clear', async (t) => {
  const widths = new Map([
      [123, 3],
      [124, 2],
      [125, 1],
      [126, 3],
      [127, 2],
      [128, 2],
      [129, 1],
      [131, 2],
      [132, 1],
      [138, 3],
      [139, 2],
      [418, 4],
      [456, 2],
      [557, 2],
      [585, 2],
      [599, 6],
    ]),
    marker = 0xe59f171d,
    programs = Object.fromEntries(
      [...widths].map(([id, width]) => [
        `${id}.kcs`,
        kcsProgram([
          [37, marker],
          ...Array.from({ length: width }, (_, i) => [37, [0x13, 64 + i * 4]]),
          [43, id, width * 4],
          [59],
        ]),
      ]),
    ),
    world = await dataWorld(profile, programs);
  t.after(() => world.close({ flushFiles: false }));
  const owner = await world.objects.create({ kind: 8, parent: world.root }),
    target = world.nativeTaskID(owner),
    model = world.legacyText.tasks.get(owner),
    uploads = [];
  world.graphics.output = async (bitmap, position) => {
    uploads.push({ position, bytes: (await bitmap.pixels()).slice() });
  };
  const configuration = Array(24).fill(0);
  Object.assign(configuration, {
    0: 5,
    1: -6,
    2: 128,
    3: 64,
    4: 4,
    5: 1,
    6: 16,
    11: 3,
    12: 4,
    15: 40,
    16: 0xff35791a,
    17: 1,
  });
  async function call(id, args, initialize = () => {}) {
    const task = await world.spawnScript(`${id}.kcs`, { initialExecute: false }),
      { machine } = task,
      start = machine.sp;
    try {
      args.forEach((word, index) => machine.store(64 + index * 4, word));
      initialize(machine);
      assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
      assert.equal(machine.sp, start + (id === 129 ? 8 : 4));
      const result = id === 129 ? machine.pop() : undefined;
      assert.equal(machine.pop(), marker);
      return result;
    } finally {
      await world.objects.release(task.id);
    }
  }
  const define = (machine, second) => {
    configuration.forEach((word, index) => machine.store(513 + index * 4, word));
    machine.bytes(800, 257).fill(65);
    machine.store(1056, 0, 1);
    machine.writeString(second, 1088);
  };
  await call(123, [target, 513, 800], (machine) => define(machine, ''));
  assert.deepEqual([model.text.w(201), model.text.w(330)], [256, 0]);
  await call(418, [target, 513, 800, 1088], (machine) => define(machine, 'あ。'));
  assert.deepEqual([model.text.w(201), model.text.w(330)], [256, 2]);
  assert.deepEqual([...model.text.profile(330, 331)], [0x82a0, 0x8142]);
  await call(557, [target, 0x84123456]);
  assert.equal(model.text.w(470) >>> 0, 0x84123456);
  await call(124, [target, 513], (machine) => machine.writeString('本文', 513));
  assert.deepEqual(
    model.text.rows.map((row) => [...row].map((word) => word >>> 0)),
    [
      [0x967b, 0xff35791a, 0, 0, 16, 16, 0, 0, 0, 0],
      [0x95b6, 0xff35791a, 16, 0, 16, 16, 0, 0, 0, 0],
    ],
  );
  const bitmap = world.graphics.images.get(model.bitmap);
  await bitmap.fill(0, 0, 128, 64, 0xa5347962);
  uploads.length = 0;
  await call(125, [target]);
  assert.deepEqual(model.text.rows, []);
  assert.deepEqual([model.text.w(459), model.text.w(460)], [3, 4]);
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].position, [5, -6]);
  assert.ok(uploads[0].bytes.every((byte) => byte === 0));
  await call(124, [0x76512345, 513], (machine) => machine.writeString('本文', 513));
  assert.deepEqual(model.text.rows, []);
  await call(126, [target, 1, 11]);
  await call(127, [target, -2]);
  await call(128, [target, 0x80000000]);
  assert.equal(await call(129, [target]), 1);
  await assert.rejects(call(129, [0x76512345]), /no initialized 32-bit output word/);
  await call(131, [target, 18]);
  await call(138, [target, 17, 6]);
  await call(456, [target, 1]);
  await call(585, [target, 0x843210ab]);
  await call(599, [target, 9, 11, 20, 32, 40]);
  await call(124, [target, 513], (machine) => machine.writeString('A', 513));
  await call(139, [target, 1]);
  await call(132, [target]);
  assert.deepEqual(
    Array.from(model.text.rows[0], (word) => word >>> 0),
    [65, 0x843210ab, 17, 0, 11, 18, 0, 0, 0, 0],
  );
  assert.deepEqual(Array.from(model.text.rows[1]), [0xffff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    [46, 183, 186, 193, 194, 195, 196, 197, 469, 471, 472, 473, 474, 475].map(
      (i) => model.text.w(i) >>> 0,
    ),
    [0x843210ab, 18, 0xfffffffe, 0x843210ab, 1, 11, 1, 0x80000000, 1, 9, 11, 20, 32, 40],
  );
  const restored = await dataWorld(profile, programs, { initialize: false });
  t.after(() => restored.close({ flushFiles: false }));
  await restored.restore(structuredClone(world.snapshot()));
  assert.deepEqual(restored.legacyText.tasks.get(owner).text.snapshot(), model.text.snapshot());
});

test('2.6.1.67 GCALL still rejects the adjacent unreviewed native slot', async () => {
  const args = [17, 18, 19],
    { runtime, task } = await run([...args.map((arg) => [37, arg]), [43, 134, 12], [59]]);
  await assert.rejects(
    () => runtime.scheduler.execute(task),
    (error) => {
      assert.ok(error instanceof UnsupportedKCSNative);
      assert.equal(error.details.profile, profile);
      assert.equal(error.details.table, 'main');
      assert.equal(error.details.id, 134);
      assert.deepEqual(error.details.args, args);
      return true;
    },
  );
});

test('2.6.1.67 KCS resource selection and comma replacement preserve their CP932 destinations', async (t) => {
  const call = (id, a, b) => [
      [37, a],
      [37, b],
      [43, id, 8],
    ],
    world = await dataWorld(profile, {
      'resource.kcs': kcsProgram(
        [
          [37, 0xb53ca8dd],
          ...call(598, 288, 512),
          [38, 80],
          ...call(598, 350, 560),
          [38, 84],
          ...call(598, 384, 384),
          [38, 88],
          ...call(904, 640, 416),
          ...call(904, 704, 464),
          [59],
        ],
        [
          [288, ',空%d[G156],一,二,'],
          [350, ',,,'],
          [384, '重ね,Ｃ'],
          [416, '@,新,,@'],
          [464, '@,@'],
        ],
      ),
    });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('resource.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    machine = task.machine,
    floor = machine.sp;
  machine.store(156, 9);
  machine.writeString('保持', 560);
  machine.writeString('元,重', 640);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xb53ca8dd);
  assert.deepEqual(
    [80, 84, 88].map((at) => machine.load(at)),
    [1, 0, 1],
  );
  assert.deepEqual(
    [512, 560, 384, 640, 704].map((at) => machine.string(at)),
    ['空9', '保持', '重ね', '元,新,0', '0,0'],
  );
});

test('2.6.1.67 KCS percentage conversion rounds after division and writes only its string', async () => {
  const cases = [
      ['149913%', 123, '184392'],
      ['16777217%', 6, '1006633'],
      ['158%', 16777217, '26508002'],
      ['-12%', 80, '-9'],
      ['50%', 0xffffffff, '-2147483648'],
      ['-50%', 0xffffffff, '-2147483648'],
      ['1.5%', 200, '1.5%'],
      ['0x20 text%', 200, '64'],
      ['word%', 100, 'word%'],
      ['25', 100, '25'],
      ['4294967297%', 100, '1'],
      ['0%', 0xc0000000, '0'],
      ['', 100, ''],
    ],
    address = (index) => 256 + index * 40,
    unchangedStack = 0x82345678,
    { runtime, task, machine } = await run([
      [37, unchangedStack],
      ...cases.flatMap(([, base], index) => [
        [37, address(index)],
        [37, base],
        [43, 46, 8],
      ]),
      [37, 0x80000001],
      [37, 100],
      [43, 46, 8],
      [59],
    ]);
  const floor = machine.sp;
  cases.forEach(([input], index) => {
    const at = address(index);
    machine.bytes(at - 1, 40).fill(0xa5);
    machine.bytes(at, input.length + 1).set([...encodeCP932(input), 0]);
  });
  await runtime.scheduler.execute(task);
  assert.equal(runtime.calls.get('main:46'), cases.length + 1);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), unchangedStack);
  cases.forEach(([input, , expected], index) => {
    const at = address(index),
      initial = Uint8Array.from([
        ...encodeCP932(input),
        0,
        ...new Uint8Array(38 - input.length).fill(0xa5),
      ]);
    initial.set([...encodeCP932(expected), 0]);
    assert.equal(machine.load(at - 1, 1), 0xa5);
    assert.deepEqual(machine.bytes(at, initial.length), initial, input);
  });
});

const crtArithmetic = [
  // atan2
  [
    [397, 7, 12],
    [
      [[0, 0], 0],
      [[0x80000000, 0], 0x80000000],
      [[0, 0x80000000], 0x40490fdb],
      [[0x80000000, 0x80000000], 0xc0490fdb],
      [[0x40e00000, 0], 0x3fc90fdb],
      [[0xc0e00000, 0], 0xbfc90fdb],
      [[0x40400000, 0xc0800000], 0x401fe0bb],
      [[0xc0400000, 0xc0800000], 0xc01fe0bb],
      [[0x40400000, 0x40800000], 0x3f24bc7d],
      [[0xc0400000, 0x40800000], 0xbf24bc7d],
      [[0x34000000, 0x46ea6000], 0x2c8bcf65],
      [[0x8826274c, 0xfa671c91], 0xc0490fdb],
      [[0x7f800000, 0x40000000], 0x3fc90fdb],
      [[0xff800000, 0xc0a00000], 0xbfc90fdb],
      [[0x40400000, 0x7f800000], 0],
      [[0xc0400000, 0xff800000], 0xc0490fdb],
      [[0x7f800000, 0x7f800000], 0xffc00000],
      [[0x7f800000, 0xff800000], 0xffc00000],
      [[0xff800000, 0x7f800000], 0xffc00000],
      [[0xff800000, 0xff800000], 0xffc00000],
      [[0x7fc00000, 0x40a00000], 0x7fc00000],
      [[0x40a00000, 0x7fc00000], 0x7fc00000],
      [[0x7f800001, 0xffc54321], 0xffc54321],
      [[0x7fc54321, 0xff854321], 0x7fc54321],
      [[0xffc54321, 0x7fc54321], 0x7fc54321],
      [[0xffc54321, 0xff817777], 0xffc54321],
    ],
  ],
  // ceil
  [
    [56, 8, 13],
    [
      [[0], 0],
      [[0x80000000], 0x80000000],
      [[0x3e800000], 0x3f800000],
      [[0xbe800000], 0x80000000],
      [[0x3fc00000], 0x40000000],
      [[0xbfc00000], 0xbf800000],
      [[0x41880000], 0x41880000],
      [[0xc1880000], 0xc1880000],
      [[0x00000001], 0x3f800000],
      [[0x80000001], 0x80000000],
      [[0x7f800000], 0x7f800000],
      [[0xff800000], 0xff800000],
      [[0x7fc00000], 0x7fc00000],
      [[0xff800001], 0xffc00001],
      [[0x7fa00001], 0x7fe00001],
    ],
  ],
  // floor
  [
    [58, 10, 15],
    [
      [[0], 0],
      [[0x80000000], 0x80000000],
      [[0x3e800000], 0],
      [[0xbe800000], 0xbf800000],
      [[0x3fc00000], 0x3f800000],
      [[0xbfc00000], 0xc0000000],
      [[0x41880000], 0x41880000],
      [[0xc1880000], 0xc1880000],
      [[0x00000001], 0],
      [[0x80000001], 0xbf800000],
      [[0x7f800000], 0x7f800000],
      [[0xff800000], 0xff800000],
      [[0x7fc00000], 0x7fc00000],
      [[0xff800001], 0xffc00001],
      [[0x7fa00001], 0x7fe00001],
    ],
  ],
  // Original x87 hardware, including partial reductions and both operand signs.
  [
    [59, 11, 16],
    [
      [[0x80000000, 0x40400000], 0],
      [[0xc0800000, 0x40000000], 0x80000000],
      [[0xc1140000, 0x40000000], 0xbfa00000],
      [[0x72e33123, 0x41880000], 0x41300000],
      [[0x72e33123, 0x2ef1e47f], 0x2e8b9070],
      [[0x00000001, 0x40400000], 1],
      [[0x3f800000, 0x7f800000], 0xffc00000],
      [[0x7f800001, 0xffc54321], 0xffc54321],
      [[0xffc54321, 0x7fc54321], 0x7fc54321],
    ],
  ],
  // sqrt
  [
    [60, 12, 17],
    [
      [[0], 0],
      [[0x80000000], 0x80000000],
      [[0x3f800000], 0x3f800000],
      [[0xbf800000], 0xffc00000],
      [[0x40000000], 0x3fb504f3],
      [[0x00000001], 0x1a3504f3],
      [[0x3eaaaaab], 0x3f13cd3a],
      [[0x7f800000], 0x7f800000],
      [[0xff800000], 0xffc00000],
      [[0x7fc00000], 0x7fc00000],
      [[0xff800001], 0xffc00001],
      [[0x7fa00001], 0x7fe00001],
    ],
  ],
].flatMap(([ids, rows]) => rows.map(([args, result]) => ({ ids, args, result })));

const scalarCases = [
  { ids: [50, 1, 6], args: [0x3f000000], result: 0x3ef57744 },
  { ids: [50, 1, 6], args: [0x80000000], result: 0x80000000 },
  { ids: [50, 1, 6], args: [0xff852038], result: 0xffc52038 },
  { ids: [50, 1, 6], args: [0x5f000000], result: 0x3f780bd8 },
  { ids: [51, 2, 7], args: [0x3f000000], result: 0x3f60a940 },
  { ids: [51, 2, 7], args: [0x7f800000], result: 0xffc00000 },
  { ids: [51, 2, 7], args: [0x7f7fffff], result: 0xbe6acefc },
  { ids: [52, 3, 8], args: [0x3f000000], result: 0x3f0bda7b },
  { ids: [52, 3, 8], args: [0x80000000], result: 0x80000000 },
  { ids: [52, 3, 8], args: [0x7f7fffff], result: 0xc087d565 },
  { ids: [53, 4, 9], args: [0x3f000000], result: 0x3f060a92 },
  { ids: [53, 4, 9], args: [0x40000000], result: 0xffc00000 },
  { ids: [54, 5, 10], args: [0x3f000000], result: 0x3f860a92 },
  { ids: [54, 5, 10], args: [0xbf800000], result: 0x40490fdb },
  { ids: [55, 6, 11], args: [0x3f000000], result: 0x3eed6338 },
  { ids: [55, 6, 11], args: [0xff800000], result: 0xbfc90fdb },
  { ids: [57, 9, 14], args: [0x80000000], result: 0 },
  { ids: [57, 9, 14], args: [0xff812345], result: 0x7fc12345 },
  { ids: [61, 13, 18], args: [0xbf800000, 0x7f800000], result: 0x3f800000 },
  { ids: [61, 13, 18], args: [0x7f801234, 0], result: 0x7fc01234 },
  { ids: [61, 13, 18], args: [0xff801234, 0x80000000], result: 0xffc01234 },
  { ids: [61, 13, 18], args: [0x80000000, 0xc0400000], result: 0xff800000 },
  { ids: [62, 14, 19], args: [floatBits(180)], result: 0x40490fdb },
  { ids: [62, 14, 19], args: [0x7f7fffff], result: 0x7c8efa35 },
  { ids: [63, 15, 20], args: [0x7bbb3ee6], result: 0x7ea7a18e },
  { ids: [63, 15, 20], args: [0x80000000], result: 0x80000000 },
  { ids: [64, 16, 21], args: [0xffffffe3], result: 29 },
  { ids: [64, 16, 21], args: [0x80000000], result: 0x80000000 },
  { ids: [318, 41, 41], args: [10, 20, 0, 4, 2].map(floatBits), result: 0x41700000 },
  { ids: [318, 41, 41], args: [-0, 20, 0, 4, -1].map(floatBits), result: 0x80000000 },
  { ids: [318, 41, 41], args: [10, 20, 0, 4, 4].map(floatBits), result: 0x41a00000 },
  { ids: [319, 17, 42], args: [floatBits(4294967808)], result: 512 },
  { ids: [319, 17, 42], args: [floatBits(-1.5)], result: 0xffffffff },
  { ids: [319, 17, 42], args: [floatBits(2 ** 63)], result: 0 },
  ...crtArithmetic,
];

function scalarProgram(column) {
  return [
    [37, 0x82345678],
    ...scalarCases.flatMap(({ ids, args }) => [
      ...args.map((word) => [37, word]),
      [43, ids[column], args.length * 4],
    ]),
    [59],
  ];
}

function assertScalarOutput(machine) {
  const expected = [0x82345678, ...scalarCases.map(({ result }) => result)];
  const offset = machine.sp - expected.length * 4;
  assert.deepEqual(
    expected.map((_, index) => machine.load(offset + index * 4)),
    expected,
  );
}

const triangleCases = [
  [[0, 0], 0xffc00000],
  [[0x3f800000, 0xff831234], 0x7fc31234],
  [[2, 16].map(floatBits), 0x3f000000],
  [[4, 16].map(floatBits), 0x3f800000],
  [[6, 16].map(floatBits), 0x3f000000],
  [[8, 16].map(floatBits), 0x80000000],
  [[12, 16].map(floatBits), 0xbf800000],
  [[-12, -16].map(floatBits), 0xbf800000],
];

test('2.6.1.67 Main triangle wave selects the original signed x87 quarter', async (t) => {
  const instructions = triangleCases.flatMap(([args], index) => [
      ...args.map((word) => [37, word]),
      [43, 321, 8],
      [38, 64 + index * 4],
    ]),
    world = await dataWorld(profile, { 'case.kcs': kcsProgram([...instructions, [59]]) });
  t.after(() => world.close({ flushFiles: false }));
  assert.deepEqual(
    triangleCases.map((_, index) => world.main.machine.load(64 + index * 4)),
    triangleCases.map(([, expected]) => expected),
  );
});

test('2.6.1.67 Main scalar GCALLs write the original x87 and integer words', async (t) => {
  const world = await dataWorld(profile, { 'case.kcs': kcsProgram(scalarProgram(0)) });
  t.after(() => world.close({ flushFiles: false }));
  assertScalarOutput(world.main.machine);
});

test('2.6.1.67 Main786 returns the signed century calendar remainder', async (t) => {
  const dates = [
      [1900, 3, 1],
      [2000, 2, 28],
      [0, -1, -2147483648],
    ],
    program = kcsProgram([
      [37, 0x83217bac],
      ...dates.flatMap((args, index) => [
        ...args.map((word) => [37, word]),
        [43, 786, 12],
        [38, 64 + index * 4],
      ]),
      [59],
    ]),
    world = await dataWorld(profile, { 'case.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const m = world.main.machine;
  assert.deepEqual(
    dates.map((_, index) => m.load(64 + index * 4)),
    [0xfffffffd, 1, 0xffffffff],
  );
  assert.equal(m.pop(), 0x83217bac);
});

test('2.6.1.67 Main log10 retains the initialized CRT result words', async (t) => {
  const samples = [
      [0x3f800000, 0],
      [0xbf800000, 0xffc00000],
      [0x80000000, 0xff800000],
      [1, 0xc23369f4],
      [0x7f801234, 0x7fc01234],
    ],
    program = kcsProgram([
      ...samples.flatMap(([value]) => [
        [37, value],
        [43, 461, 4],
      ]),
      [59],
    ]),
    world = await dataWorld(profile, { 'case.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const { machine } = world.main;
  assert.equal(machine.sp, machine.floor + 4 * samples.length);
  for (const [, expected] of samples.slice().reverse()) assert.equal(machine.pop(), expected);
});

for (const [table, version, column] of [
  ['generic', 0, 1],
  ['particle-v1', 1, 2],
  ['particle-v2', 2, 2],
]) {
  test(`2.6.1.67 ${table} scalar GCALLs use the original conversion and rounding words`, async () => {
    const bytes = kcsProgram(scalarProgram(column));
    new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, version, true);
    const script = await readKCS(bytes);
    const instance =
      version === 0
        ? new MotionInstance(script, { profile })
        : new ParticleScriptInstance(script, {
            profile,
            count: 1,
            width: 16,
            height: 16,
            screenWidth: 1280,
            screenHeight: 720,
          });
    if (version) assert.equal(instance.table, table);
    instance.update(19);
    assertScalarOutput(instance.machine);
  });
}

for (const version of [1, 2]) {
  const table = `particle-v${version}`,
    particleCall = (id, args = [], output) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      ...(output === undefined ? [] : [[38, output]]),
    ],
    particle = async (instructions, overrides = {}) => {
      const bytes = kcsProgram(instructions);
      new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, version, true);
      return new ParticleScriptInstance(await readKCS(bytes), {
        profile,
        count: 1,
        width: 16,
        height: 16,
        screenWidth: 0x81234567,
        screenHeight: 0xf8253146,
        fps: 144,
        shared: new Uint8Array(512),
        ...overrides,
      });
    };
  test(`2.6.1.67 ${table} UV updates preserve the original x87 words and current quad`, async () => {
    const marker = 0x6cf11937,
      samples = [
        {
          args: [2.5, -100, 5.5, 200].map(floatBits),
          width: 8,
          height: 16,
          uv: [1 / 4, 1 / 8, 5 / 8, 1 / 8, 1 / 4, 5 / 16, 5 / 8, 5 / 16].map(floatBits),
        },
        {
          args: [0xe2709dc0, 0xdadaecf4, 0x02c1761f, 0xb7ca33c3],
          width: bitsFloat(0x7ed94cf2),
          height: bitsFloat(0x3f4247a9),
          uv: [
            0xa30dbbe6, 0xe29e8742, 0x8025b2ee, 0xe29e8742, 0xa30dbbe6, 0xbf28a9f2, 0x8025b2ee,
            0xbf28a9f2,
          ],
        },
        {
          args: [0x3f800000, 0xc2b8a418, 0xff801234, 0xb788d897],
          width: 1,
          height: 1024,
          uv: [
            0x3f000000, 0x3a000000, 0xffc01234, 0x3a000000, 0x3f000000, 0xffc01234, 0xffc01234,
            0xffc01234,
          ],
        },
      ];
    for (const { args, width, height, uv } of samples) {
      const instance = await particle([[37, marker], ...particleCall(29, args), [59]], {
        count: 2,
        width,
        height,
      });
      instance.now = 1;
      const words = new Uint32Array(instance.quads.buffer);
      words.fill(marker);
      assert.equal(instance.machine.run().status, 'halted');
      assert.equal(instance.machine.pop(), marker);
      assert.equal(instance.machine.sp, instance.machine.floor);
      assert.deepEqual([...words.slice(0, 28)], Array(28).fill(marker));
      assert.deepEqual(
        [...words.slice(28)].filter((_, i) => i % 7 >= 5),
        uv,
      );
      assert.ok([...words.slice(28)].filter((_, i) => i % 7 < 5).every((word) => word === marker));
    }
    const malformed = await particle([...particleCall(29, [0, 0, 0]), [59]]);
    assert.throws(() => malformed.update(0), /requires 4 arguments/);
    assert.equal(malformed.calls.size, 0);
  });

  test(`2.6.1.67 ${table} fixed state, viewport, quad, register and visibility native wrappers`, async () => {
    const marker = 0xa5a5a5a5,
      position = [0x80000000, 0x7fc12345, 0x3fc00000],
      registers = Array.from({ length: 32 }, (_, index) => 0x3f800000 + index),
      quad = Array.from({ length: 28 }, (_, index) => 0x81001200 + index);
    registers.splice(0, 5, 0x80000000, 0xffc9a090, 0x7fc13579, 0x7f800000, 1);
    const instance = await particle(
        [
          [37, marker],
          ...particleCall(1, [], 64),
          ...particleCall(2, [], 68),
          ...particleCall(4, [], 72),
          ...particleCall(5, [76, 80]),
          ...particleCall(5, [84, 84]),
          ...particleCall(27, position),
          ...particleCall(28, [88, 92, 96]),
          ...particleCall(28, [100, 100, 100]),
          ...particleCall(31, [320]),
          ...particleCall(30, [0x80000020]),
          ...particleCall(35, [512]),
          ...particleCall(36, [], 104),
          ...particleCall(39, [0, 0x81234567]),
          ...particleCall(39, [1, 0x12345678]),
          ...particleCall(39, [0xffffffff, 0x77777777]),
          ...particleCall(40, [], 108),
          [59],
        ],
        { registers: new Float32Array(Uint32Array.from(registers).buffer) },
      ),
      m = instance.machine,
      words = (address, count) =>
        Array.from({ length: count }, (_, index) => m.load((address + index * 4) >>> 0));
    quad.forEach((value, index) => m.store(320 + index * 4, value));
    m.store(0x80000090, marker);
    m.store(640, marker);
    assert.equal(instance.table, table);
    const sp = m.sp;
    assert.equal(instance.update(0xf7654321).active, true);
    assert.deepEqual(
      words(64, 6),
      [0xf7654321, 0xffffffff, 144, 0x81234567, 0xf8253146, 0xf8253146],
    );
    assert.deepEqual(words(88, 6), [...position, position[2], 0, 0]);
    assert.deepEqual(Array.from(new Uint32Array(instance.positions.buffer)), [...position, 0]);
    assert.deepEqual(words(0x80000020, 29), [...quad, marker]);
    assert.deepEqual(words(512, 33), [...registers, marker]);
    assert.equal(instance.visibility[0] >>> 0, 0x81234567);
    assert.equal(m.pop(), marker);
    assert.equal(m.sp, sp);
    instance.update(0x80000000);
    assert.deepEqual(words(64, 2), [0x80000000, 0xf7654321]);
  });

  test(`2.6.1.67 ${table} exit halts each guest without a result and retains the particle loop order`, async () => {
    const marker = 0xa5a5a5a5,
      instance = await particle(
        [
          ...particleCall(36, [], 64),
          ...particleCall(40, [], 68),
          [37, marker],
          ...particleCall(32),
          [37, 7],
          [38, 72],
          [59],
        ],
        { count: 4 },
      ),
      m = instance.machine;
    const sp = m.sp;
    assert.equal(instance.update(9).active, false);
    assert.deepEqual([m.load(64), m.load(68), m.load(72)], [3, 3, 0]);
    assert.equal(instance.calls.get(32), 4);
    assert.equal(m.pop(), marker);
    assert.equal(m.sp, sp);
    assert.deepEqual(instance.update(10), { active: false, executed: 0 });
    const guarded = await particle([...particleCall(0, [64]), [59]]);
    assert.throws(() => guarded.update(9), /Unreviewed PTCL native .*\/0/);
  });

  test(`2.6.1.67 ${table} distance and triangle wave retain the native x87 words`, async () => {
    const distances = [
      [[3, 4, 12, 0, 0, 0].map(floatBits), 0x41500000],
      [[3.125, 8.25, 13.875, 2, 11, 1].map(floatBits), 0x41536a0f],
      [[4e-23, 4e-23, 4e-23, 0, 0, 0].map(floatBits), 0x1a9cc471],
      [[4e19, 3, 8, 12, 43, 39].map(floatBits), 0x7f800000],
      [[0, 0x7f800001, 0, 0, 0xffc12121, 0], 0xffc12121],
      [[0x7f800000, 0, 0, 0x7f800000, 0, 0], 0xffc00000],
    ];
    const cases = [
      ...distances.map(([args, result]) => ({ slot: 37, args, result })),
      ...triangleCases.map(([args, result]) => ({ slot: 43, args, result })),
    ];
    const instance = await particle([
      ...cases.flatMap(({ slot, args }, index) => particleCall(slot, args, 64 + index * 4)),
      [59],
    ]);
    instance.update(0);
    assert.deepEqual(
      cases.map((_, index) => instance.machine.load(64 + index * 4)),
      cases.map(({ result }) => result),
    );
  });

  test(`2.6.1.67 ${table} CalcFrame preserves signed input and rounds the unsigned rate at x87 precision`, async () => {
    const frames = [0, 1, 0x1000001, 0x7fffffff, 0x80000000, 0xffffffff];
    for (const [fps, expected] of [
      [0, [0, 1, 1, 1, 0x80000000, 0xffffffff]],
      [144, [0, 2, 0x266666c, 0x33333400, 0x80000000, 0xffffffff]],
      [0x80000305, [0, 0x2222230, 0x34000000, 1, 0x80000000, 0xffffffff]],
      [0xffffffff, [0, 0x4444448, 0x50000000, 1, 0x80000000, 0xffffffff]],
    ]) {
      const instance = await particle(
        [...frames.flatMap((frame, index) => particleCall(3, [frame], 64 + index * 4)), [59]],
        { fps },
      );
      instance.update(0);
      assert.deepEqual(
        frames.map((_, index) => instance.machine.load(64 + index * 4)),
        expected,
      );
    }
  });

  test(`2.6.1.67 ${table} rotates, translates and scales all four positions without changing their other words`, async () => {
    const vertices = [
      [0x3faa9fbe, 0xc0151eb8, 0xbf8a3d71, 0x3e800000, 0x819212aa, 0, 0],
      [0x402a9fbe, 0xbf89a36e, 0xc09b0a3d, 0x3fa00000, 0x819212ab, 0x3d8f5c29, 0x3e051eb8],
      [0x407fef9e, 0x3e37b4a2, 0xc109c28f, 0x40100000, 0x819212ac, 0x3e0f5c29, 0x3e851eb8],
      [0x40aa9fbe, 0x3fb79097, 0xc1460000, 0x40500000, 0x819212ad, 0x3e570a3d, 0x3ec7ae14],
    ];
    const angle = 0x3e000000,
      operands = [angle, 0x3faa3d71, 0xbe70a3d7],
      marker = 0xe6f13918,
      address = 128;
    for (const [slot, args, positions] of [
      [
        22,
        [angle],
        [
          [0x3faa9fbe, 0xc01c92f4, 0xbf47f4f3],
          [0x402a9fbe, 0xbfd5e1fe, 0xc0958a52],
          [0x407fef9e, 0xbf653c27, 0xc1090b03],
          [0x40aa9fbe, 0xbdf5a2a0, 0xc14750dd],
        ],
      ],
      [
        23,
        [angle],
        [
          [0x3fba871b, 0xc0151eb8, 0xbf67c71f],
          [0x404ff3ad, 0xbf89a36e, 0xc08f31af],
          [0x40a151e8, 0x3e37b4a2, 0xc100b53d],
          [0x40daa9f6, 0x3fb79097, 0xc139d1a3],
        ],
      ],
      [
        24,
        [angle],
        [
          [0x3f841c18, 0xc01e97bf, 0xbf8a3d71],
          [0x4020b674, 0xbfb31c08, 0xc09b0a3d],
          [0x407f5edf, 0xbea42246, 0xc109c28f],
          [0x40af03a2, 0x3f4215cb, 0xc1460000],
        ],
      ],
      [
        25,
        operands,
        [
          [0x3fba9fbe, 0xbf7ffffe, 0xbfa851ec],
          [0x40329fbe, 0x3e82680c, 0xc0a28f5c],
          [0x4083f7cf, 0x3fc13405, 0xc10d851e],
          [0x40ae9fbe, 0x4030e704, 0xc149c28f],
        ],
      ],
      [
        26,
        operands,
        [
          [0x3e2a9fbe, 0xc0465461, 0x3e81f213],
          [0x3eaa9fbe, 0xbfb70f1f, 0x3f91bcd3],
          [0x3effef9e, 0x3e745415, 0x40017e91],
          [0x3f2a9fbe, 0x3ff42426, 0x403a1eb8],
        ],
      ],
    ]) {
      const instance = await particle([
          [37, marker],
          ...particleCall(slot, [address, ...args]),
          [59],
        ]),
        machine = instance.machine,
        input = [marker, ...vertices.flat(), marker],
        expected = [
          marker,
          ...vertices.flatMap((v, i) => [...positions[i], ...v.slice(3)]),
          marker,
        ];
      input.forEach((value, index) => machine.store(address - 4 + index * 4, value));
      instance.update(0);
      assert.deepEqual(
        input.map((_, index) => machine.load(address - 4 + index * 4)),
        expected,
        `slot ${slot}`,
      );
      assert.equal(machine.pop(), marker);
    }
  });

  test(`2.6.1.67 ${table} writes the native SSE projection bounds in pointer order`, async () => {
    const marker = 0xe6f13918;
    for (const [screenWidth, screenHeight, priority, near, z, expected] of [
      [1280, 720, 5000, 59000, 0xc51c4000, [0xc4c80000, 0xc4610000, 0x45340000, 0x44ca8000]],
      [639, 479, 10000, 54000, 0xc5daca00, [0xc50b9662, 0xc4d12992, 0x45337662, 0x450674c9]],
      [1280, 720, 5000, 59000, 0x7f800000, Array(4).fill(0xffc00000)],
      [1279, 719, 5000, 59000, 0x7fc00000, Array(4).fill(0x7fc00000)],
    ]) {
      const outputs = [64, 68, 72, 76, 80],
        instance = await particle(
          [
            [37, marker],
            ...particleCall(38, [z, ...outputs.slice(0, 4)]),
            ...particleCall(38, [z, 80, 80, 80, 80]),
            [59],
          ],
          { screenWidth, screenHeight, priority, near },
        );
      instance.machine.store(84, marker);
      instance.update(0);
      assert.deepEqual(
        [...outputs, 84].map((address) => instance.machine.load(address)),
        [...expected, expected[3], marker],
      );
      assert.equal(instance.machine.pop(), marker);
    }
  });

  if (version === 2) {
    test('2.6.1.67 particle-v2 copies the entire quad bank and returns the raw attachment handle', async () => {
      const marker = 0xe6f13918,
        handle = 0x82345678,
        count = 3,
        length = count * 112,
        front = Uint8Array.from({ length }, (_, index) => (index * 37) & 255),
        backup = Uint8Array.from({ length }, (_, index) => (index * 13 + 7) & 255);
      for (const [slot, args, expected] of [
        [44, [], backup],
        [45, [0x80000001, 99], front],
      ]) {
        const instance = await particle(
          [[37, marker], ...particleCall(slot, args), ...particleCall(46, [], 64), [59]],
          { count, attachPlane: handle },
        );
        instance.quads.set(front);
        instance.backupQuads.set(backup);
        instance.update(0);
        assert.deepEqual(instance.quads, expected);
        assert.deepEqual(instance.backupQuads, expected);
        assert.equal(instance.machine.load(64), handle);
        assert.equal(instance.machine.pop(), marker);
        assert.equal(instance.calls.get(slot), count);
      }
    });

    test('2.6.1.67 particle-v2 reads a live attachment base and position with native writes', async () => {
      const marker = 0xe6f13918,
        coordinates = { base: [0x3fa40000, 0x80000000], pos: [0xc1970000, 0x42078400, 0x421f8000] },
        words = [...coordinates.base, ...coordinates.pos, coordinates.pos[2]],
        addresses = [64, 68, 72, 0x80000050, 84, 88],
        fixture = (options) =>
          particle(
            [
              [37, marker],
              ...particleCall(48, addresses.slice(0, 2)),
              ...particleCall(49, addresses.slice(2, 5)),
              ...particleCall(49, [88, 88, 88]),
              [59],
            ],
            options,
          );
      for (const [attachPlane, device] of [
        [101, true],
        [-1, true],
        [101, false],
      ]) {
        let touched = 0;
        const instance = await fixture({
          attachPlane,
          attachmentDevicePresent: () => device,
          attachment: (id) => {
            assert.equal(id, 101);
            touched++;
            return { base: coordinates.base.map(bitsFloat), pos: coordinates.pos.map(bitsFloat) };
          },
        });
        instance.machine.store(92, marker);
        instance.update(0);
        const live = device && attachPlane !== -1;
        assert.deepEqual(
          addresses.map((at) => instance.machine.load(at)),
          live ? words : Array(6).fill(0),
        );
        assert.equal(instance.machine.load(92), marker);
        assert.equal(instance.machine.pop(), marker);
        assert.equal(touched, live ? 3 : 0);
      }
      const stale = await fixture({ attachPlane: 101, attachmentDevicePresent: () => true });
      stale.machine.store(64, marker);
      assert.throws(() => stale.update(0), /Particle position requires a live attachment graph/);
      assert.equal(stale.machine.load(64), marker);
    });

    test('2.6.1.67 particle-v2 returns the full live model registration word', async () => {
      const marker = 0xe6f13918;
      for (const word of [0, 1, 0x81234567, 0xffffffff]) {
        const instance = await particle([[37, marker], ...particleCall(47, [], 64), [59]], {
          attachPlane: 101,
          attachmentDevicePresent: () => true,
          attachment: () => ({ registrationWord: word, disp: Number(!word) }),
        });
        instance.machine.store(68, marker);
        instance.update(0);
        assert.equal(instance.machine.load(64), word);
        assert.equal(instance.machine.load(68), marker);
        assert.equal(instance.machine.pop(), marker);
        assert.equal(instance.machine.sp, instance.machine.floor);
      }
      for (const options of [
        { attachPlane: -1 },
        { attachPlane: 101, attachmentDevicePresent: () => false },
        { attachPlane: 101, attachment: () => null },
      ]) {
        const instance = await particle([[37, marker], ...particleCall(47, [], 64), [59]], {
          attachment: () => assert.fail('An absent attachment does not resolve a model'),
          ...options,
        });
        instance.update(0);
        assert.equal(instance.machine.load(64), 0);
        assert.equal(instance.machine.pop(), marker);
      }
      const unowned = await particle([...particleCall(47), [59]], {
        attachPlane: 101,
        attachment: () => ({ disp: 1 }),
      });
      assert.throws(() => unowned.update(0), /registration word is unavailable/);
    });

    test('2.6.1.67 particle-v2 validates the complete blend-mode DWORD', async () => {
      for (const mode of [0, 1, 2, 3, 4, 5, 6, 0x80000000, 0xffffffff]) {
        const marker = 0xeadbac34,
          instance = await particle([[37, marker], ...particleCall(50, [mode]), [59]]);
        instance.blendMode = 4;
        instance.update(0);
        assert.equal(instance.blendMode, mode >= 1 && mode <= 5 ? mode : 0);
        assert.equal(instance.machine.pop(), marker);
      }
    });
  }
}

test('2.6.1.67 KCS, Motion and both Particle versions share two ordered native random streams', async (t) => {
  const program = (id, real) => kcsProgram([[43, id, 0], [38, 64], [43, real, 0], [38, 68], [59]]),
    world = await dataWorld(profile, { 'random.kcs': program(33, 34) });
  t.after(() => world.close({ flushFiles: false }));
  const random = world.random;
  random.integer.seed(4357);
  random.real.seed(0x7654ab5e);
  const output = (machine) => [machine.load(64), machine.load(68)],
    rng = await world.spawnScript('random.kcs', { parent: world.main.id, initialExecute: false });
  await world.runtime.scheduler.execute(rng);
  assert.deepEqual(output(rng.machine), [0xaae64ac3, 0x3e5cc951]);
  const motion = new MotionInstance(await readKCS(program(39, 40)), { profile, random });
  motion.update(1);
  assert.deepEqual(output(motion.machine), [0x5e7c47da, 0x3dd06f44]);
  for (const [version, expected] of [
    [1, [0xb98e8121, 0x3ec2dcd6]],
    [2, [0xb010f327, 0x3f08e2a5]],
  ]) {
    const bytes = program(33, 34);
    new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, version, true);
    const particle = new ParticleScriptInstance(await readKCS(bytes), {
      profile,
      random,
      count: 1,
      width: 1,
      height: 1,
      screenWidth: 1280,
      screenHeight: 720,
    });
    particle.update(1);
    assert.deepEqual(output(particle.machine), expected);
  }
  assert.equal(random.integer.index, 4);
  assert.equal(random.real.index, 4);
});

test('2.6.1.67 copies an opaque word and yields for one guest frame', async () => {
  const { runtime, task, machine } = await run([
    [37, 0xf31c5ba9],
    [43, 6, 4],
    [43, 65, 0],
    [37, 0xe6a8b101],
    [59],
  ]);
  const floor = machine.sp;
  await runtime.scheduler.execute(task);
  assert.equal(task.status, 'yielded');
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xf31c5ba9);
  await runtime.tick();
  assert.equal(task.status, 'finished');
  assert.equal(machine.sp, floor + 8);
  assert.equal(machine.load(floor + 4), 0xe6a8b101);
});

test('2.6.1.67 Script load GCALL binds shared memory and only suspends for immediate execution', async (t) => {
  const child = [0x13, 80],
    parentProgram = (runNow) =>
      kcsProgram(
        [[37, child], [37, 160], [37, runNow], [43, 143, 12], [37, 0xa134bd12], [38, 96], [59]],
        [[160, 'child.kcs']],
      ),
    world = await dataWorld(profile, {
      'deferred.kcs': parentProgram(0),
      'immediate.kcs': parentProgram(1),
      'child.kcs': kcsProgram([[37, 0x9123456a], [38, 96], [59]]),
    });
  t.after(() => world.close({ flushFiles: false }));
  for (const [name, immediate] of [
    ['deferred.kcs', false],
    ['immediate.kcs', true],
  ]) {
    const caller = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      id = await world.objects.create({ kind: 12, parent: caller.id }),
      marker = 0x8721d6aa;
    caller.machine.store(80, world.nativeTaskID(id));
    caller.machine.store(96, marker);
    caller.machine.store(0x80000030, 0xc33b9100);
    const floor = caller.machine.sp;
    await world.runtime.scheduler.execute(caller);
    assert.equal(caller.machine.sp, floor);
    const target = world.runtime.scheduler.tasks.get(id);
    assert.equal(target.name, 'child.kcs');
    assert.equal(target.machine.load(0x80000030), 0xc33b9100);
    assert.equal(target.machine.halted, immediate);
    assert.equal(target.machine.load(96), immediate ? 0x9123456a : 0);
    assert.equal(caller.machine.load(96), immediate ? marker : 0xa134bd12);
    assert.equal(caller.status, immediate ? 'yielded' : 'finished');
    if (immediate) {
      await world.runtime.tick();
      assert.equal(caller.machine.load(96), 0xa134bd12);
    }
  }
});

test('2.6.1.67 Main514 queries the retained Motion names and refreshes the working bank', async (t) => {
  const marker = 0xa1e63b55,
    program = kcsProgram([[59]]),
    files = {
      'query.kcs': kcsProgram([
        [37, marker],
        [37, [0x13, 32]],
        [37, [0x13, 36]],
        [43, 514, 8],
        [59],
      ]),
      'pbase.kcs': program,
      '.kcs': program,
    };
  const world = await dataWorld(profile, files),
    category = { name: 'mot', directory: '', extension: 'kcs' },
    registry = world.runtime.services.motion,
    handle = registry.create(world.main.id),
    manager = registry.get(handle);
  t.after(() => world.close({ flushFiles: false }));
  world.motionLibrary.game.nativeResources = { entries: [category] };
  for (const name of ['pBase', '.kcs']) manager.add(await world.motionLibrary.load(name));
  manager.base.fill(0x9b);
  const query = async (owner, address, name) => {
    const task = await world.spawnScript('query.kcs', { initialExecute: false }),
      m = task.machine,
      floor = m.sp;
    try {
      m.store(32, owner);
      m.store(36, address);
      if (name !== undefined) m.writeString(name, address);
      await world.runtime.scheduler.execute(task);
      assert.equal(m.sp, floor + 8);
      const result = m.pop();
      assert.equal(m.pop(), marker);
      return result;
    } finally {
      await world.objects.release(task.id);
    }
  };
  assert.equal(await query(handle, 200, 'PBASE.KCS'), 1);
  assert.equal(await query(handle, 0x800000c8, 'folder/pBase.kcs'), 0);
  manager.working.fill(0xa1);
  assert.equal(await query(handle, 0xefffffff), 1);
  assert.deepEqual(manager.working, manager.base);
  category.directory = 'mot';
  assert.equal(await query(handle, 200, 'pBase'), 0);
  assert.equal(await query(0, 0xefffffff), 0);
});

test('2.6.1.67 Motion mutates mapped components in native x87 order', async () => {
  const marker = 0xd1058137;
  for (const [id, addresses, expected] of [
    [18, [64, 68, 72], [0x3fa00000, 0x4048f5c3, 0x40066665]],
    [19, [64, 68, 72], [0xc048f5c3, 0xc0066666, 0x3f9fffff]],
    [20, [64, 68, 72], [0xc0066666, 0xbf9fffff, 0x4048f5c3]],
    [21, [0x80000040, 0x80000040, 0x80000040], [0x40905872, 0x40905872, 0x40905872]],
    [22, [0x80000040, 0x80000040, 0x80000040], [0xbf3d667d, 0xbf3d667d, 0xbf3d667d]],
  ]) {
    const factors = id <= 20 ? [Math.PI / 2] : [Math.PI / 2, 0.3, -0.5],
      args = [...addresses, ...factors.map(floatBits)],
      script = await readKCS(
        kcsProgram([
          [37, marker],
          ...args.map((value) => [37, value]),
          [43, id, args.length * 4],
          [59],
        ]),
      ),
      motion = new MotionInstance(script, { profile }),
      m = motion.machine;
    for (const [index, coordinate] of [1.25, -2.1, 3.14].entries()) {
      m.store(addresses[index], floatBits(coordinate));
    }
    const floor = m.floor;
    m.store(addresses[0] - 4, marker);
    m.run(32);
    assert.deepEqual(
      addresses.map((address) => m.load(address)),
      expected,
    );
    assert.equal(m.load(addresses[0] - 4), marker);
    assert.equal(m.sp, floor + 4);
    assert.equal(m.pop(), marker);
  }
});

test('2.6.1.67 existing MOT triangle GCALL follows the four ordered x87 quarters', async () => {
  const args = [
    [0, 0],
    [1, 0x3f000000],
    [3, 0x3f000000],
    [4, 0x80000000],
    [6, 0xbf800000],
    [8, 0],
  ];
  const script = await readKCS(
    kcsProgram([
      ...args.flatMap(([phase]) => [
        [37, floatBits(phase)],
        [37, floatBits(8)],
        [43, 42, 8],
      ]),
      [59],
    ]),
  );
  const motion = new MotionInstance(script, { profile });
  const floor = motion.machine.sp;
  motion.update(19);
  assert.equal(motion.machine.sp, floor + args.length * 4);
  assert.deepEqual(
    args.map((_, index) => motion.machine.load(floor + index * 4)),
    args.map(([, result]) => result),
  );
});

const scriptInputPackets = [
  [4, 0xffff0001, 0xb11e, 0xc77e, NATIVE_UNWRITTEN_WORD],
  [9, 0xffff0003, 0xb11e, 0xc77e, 0],
  [10, 0xffff0004, 0xb11e, 0xc77e, 0],
  [18, 0xffff0016, 0, 0, NATIVE_UNWRITTEN_WORD],
  [22, 0xffff0014, 0, 0xc77e, 1],
  [64, 0xffff0005, 0xb11e, 0xc77e, NATIVE_UNWRITTEN_WORD],
  [65, 0xffff0017, 0xb11e, 0xc77e, 1],
  [446, 0xffff0015, 0, 0xc77e, NATIVE_UNWRITTEN_WORD],
];

test('2.6.1.67 Script receives exact live input packets and keeps unhandled base messages out', async (t) => {
  const queued = [19, 20, 21];
  const program = kcsProgram([
    ...[...scriptInputPackets, ...queued].flatMap((_, index) => [
      [37, 512 + index * 16],
      [43, 71, 4],
    ]),
    [59],
  ]);
  const world = await dataWorld(profile, { 'case.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const task = world.main;
  const sender = await world.objects.create({ kind: 2, parent: task.id });
  const source = world.nativeTaskID(sender);
  for (const raw of [30, 31]) {
    const reply = await world.engineMessages.dispatch(task.id, sender, raw, 0xb11e, 0xc77e);
    assert.equal(reply.handled, false);
    assert.equal(reply.result, NATIVE_UNWRITTEN_WORD);
    assert.equal(task.machine.waiting?.address, 512);
  }
  for (const [index, [id, code, w, l, result]] of scriptInputPackets.entries()) {
    const start = 512 + index * 16;
    const reply = await world.engineMessages.dispatch(task.id, sender, id, 0xb11e, 0xc77e);
    assert.equal(reply.handled, true);
    assert.equal(reply.result, result);
    assert.deepEqual(
      Array.from({ length: 4 }, (_, word) => task.machine.load(start + word * 4)),
      [id === 18 ? 0xffffffff : source, code, w, l],
    );
  }
  for (const id of queued) {
    const reply = await world.engineMessages.dispatch(task.id, sender, id, 0xb11e, 0xc77e);
    assert.deepEqual(reply, { routed: true, handled: true, result: 1 });
  }
  const expected = queued.map((_, index) => [source, 0xffff0011 + index, 0, 0]);
  assert.deepEqual(task.messages, expected);
  assert.equal(task.machine.waiting?.address, 512 + scriptInputPackets.length * 16);
  await world.tick();
  assert.deepEqual(task.messages, []);
  for (const [index, packet] of expected.entries()) {
    const start = 512 + (scriptInputPackets.length + index) * 16;
    assert.deepEqual(
      Array.from({ length: 4 }, (_, word) => task.machine.load(start + word * 4)),
      packet,
    );
  }
  assert.equal(task.status, 'finished');
});

test('2.6.1.67 Plane input GCALLs update the active region, latch and receiver', async (t) => {
  const plane1 = [0x13, 80];
  const plane2 = [0x13, 84];
  const receiver = [0x13, 88];
  const calls = [
    [79, [plane1, floatBits(4), floatBits(3), 0xffffffff]],
    [79, [plane2, floatBits(4), floatBits(3), 0xffffffff]],
    [104, [plane1, 0, 0, 4, 3, 23, 0]],
    [104, [plane2, 0, 0, 4, 3, 23, 0]],
    [105, [plane1, 1]],
    [105, [plane2, 1]],
    [106, [plane2, 1]],
    [106, [plane1, 0x80000021]],
    [108, [plane1, 0x81200305]],
    [110, [plane1, receiver]],
  ];
  const program = kcsProgram([
    [37, 0xf217d9e3],
    ...calls.flatMap(([id, args]) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
    ]),
    [59],
  ]);
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'plane-input.kcs': program,
  });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id;
  const caller = await world.objects.create({ kind: 12, parent });
  const script = world.objects.objects.get(caller).implementation;
  const first = await world.objects.create({ kind: 2, parent: caller });
  const second = await world.objects.create({ kind: 2, parent: caller });
  const destination = await world.objects.create({ kind: 12, parent });
  await script.loadScript('plane-input.kcs');
  const { task } = script;
  const { machine } = task;
  const floor = machine.sp;
  for (const [position, id] of [
    [80, first],
    [84, second],
    [88, destination],
  ])
    machine.store(position, world.nativeTaskID(id));
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xf217d9e3);
  assert.equal(world.input.get(first).active, 0x80000021);
  assert.equal(world.input.get(second).active, 0);
  assert.equal(world.objects.objects.get(first).implementation.state.changed, 0x81200305);
  assert.equal(
    world.objects.objects.get(first).implementation.state.receiver,
    world.nativeTaskID(destination),
  );
});

test('2.6.1.67 task GCALLs use owned VM transfer, clocks and Script exit words', async (t) => {
  const remote = [0x13, 80];
  const words = [0xfeedcace, 0x10203040, 0x8a2ea583];
  const queued = [0x77733166, 0xe72a63fe, 0x19c68229];
  const calls = [
    [4, [], 112],
    [5, [], 116],
    [76, [], 120],
    [69, [remote, ...words], 124],
    [70, [remote, ...queued], 128],
    [73, [remote, 176, 5, 180]],
    [72, [remote, 176, 5, 192]],
    [453, [0xf131bd90]],
  ];
  const callerProgram = kcsProgram([
    [37, 0xff1112ad],
    ...calls.flatMap(([id, args, result]) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      ...(result === undefined ? [] : [[38, result]]),
    ]),
    [59],
  ]);
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'transfer.kcs': callerProgram,
    'receiver.kcs': kcsProgram([[37, 128], [43, 71, 4], [37, 144], [43, 71, 4], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id;
  const caller = await world.spawnScript('transfer.kcs', { parent, initialExecute: false });
  const receiver = await world.spawnScript('receiver.kcs', { parent, initialExecute: true });
  const record = world.objects.objects.get(caller.id);
  const { machine } = caller;
  const payload = Uint8Array.of(0x81, 0x23, 0, 0xf1, 0xff);
  const floor = machine.sp;
  world.runtime.services.clock = () => 0x100000012;
  record.effectiveFrame = 0xfffffff4;
  record.pausedFrames = 7;
  machine.store(80, world.nativeTaskID(receiver.id));
  machine.bytes(180, payload.length).set(payload);
  machine.bytes(191, 7).fill(0x5f);
  receiver.machine.bytes(175, 7).fill(0x4f);
  await world.runtime.scheduler.execute(caller);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xff1112ad);
  assert.deepEqual(
    [112, 116, 120, 124, 128].map((at) => machine.load(at)),
    [0x12, 0xffffffed, world.nativeTaskID(parent), 1, 1],
  );
  assert.deepEqual(machine.bytes(191, 7), Uint8Array.of(0x5f, ...payload, 0x5f));
  assert.deepEqual(receiver.machine.bytes(175, 7), Uint8Array.of(0x4f, ...payload, 0x4f));
  const sender = world.nativeTaskID(caller.id);
  const packet = (at) =>
    Array.from({ length: 4 }, (_, word) => receiver.machine.load(at + word * 4));
  assert.deepEqual(packet(128), [sender, ...words]);
  assert.deepEqual(receiver.messages, [[sender, ...queued]]);
  assert.equal(record.exitCode, 0xf131bd90 | 0);
  await world.tick();
  assert.equal(receiver.status, 'finished');
  assert.deepEqual(packet(144), [sender, ...queued]);
});

test('2.6.1.67 Script GCALLs use the owned variable bank and context bytes', async (t) => {
  const name = '接続';
  const program = kcsProgram([
    [37, 0x88ea0da3],
    [37, 4],
    [43, 209, 4],
    [37, 3],
    [37, 0xf812aa00],
    [43, 211, 8],
    [37, 3],
    [43, 210, 4],
    [38, 80],
    [37, 4],
    [43, 210, 4],
    [38, 84],
    [37, 0xffffffff],
    [43, 210, 4],
    [38, 88],
    [37, 0xa7a91991],
    [43, 212, 4],
    [37, 128],
    [43, 454, 4],
    [59],
  ]);
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'variable-context.kcs': program,
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('variable-context.kcs', { context: { contextName: name } });
  const { machine } = task;
  machine.bytes(127, 7).fill(0x5f);
  const sp = machine.sp;
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, sp + 4);
  assert.equal(machine.load(sp), 0x88ea0da3);
  assert.deepEqual(
    [80, 84, 88].map((at) => machine.load(at)),
    [0xf812aa00, 0, 0],
  );
  assert.equal(world.runtime.variableBank(task, false).contextValue, 0xa7a91991);
  assert.deepEqual(machine.bytes(127, 7), Uint8Array.of(0x5f, ...encodeCP932(name), 0, 0x5f));
});

test('2.6.1.67 configuration GCALLs project two output words without changing invalid ranges', async (t) => {
  const calls = [
    [790, [0, 1, 80, 84], 112],
    [790, [0x80000000, 1, 88, 92], 116],
    [790, [0, 8, 96, 100], 120],
    [790, [1, 0xffffffff, 96, 100], 124],
    [739, [104, 108]],
  ];
  const world = await dataWorld(profile, {
    'configuration.kcs': kcsProgram([
      [37, 0x51a71a7b],
      ...calls.flatMap(([id, args, result]) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        ...(result === undefined ? [] : [[38, result]]),
      ]),
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('configuration.kcs');
  const { machine } = task;
  const floor = machine.sp;
  world.configuration.variableRanges.local.set([11, 29], 2);
  world.configuration.variableRanges.global.set([517, 43], 2);
  world.graphics.view.configure({
    virtualWidth: 800,
    virtualHeight: 600,
    clientWidth: 1600,
    clientHeight: 900,
    deviceOffset: [20.75, -11.25],
    deviceScale: 1.5,
    windowShift: [3, -2],
  });
  machine.bytes(96, 8).fill(0x5f);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0x51a71a7b);
  const wordsAt = (...addresses) => addresses.map((at) => machine.load(at));
  assert.deepEqual(wordsAt(80, 84, 88, 92, 96, 100), [11, 29, 517, 43, 0x5f5f5f5f, 0x5f5f5f5f]);
  assert.deepEqual(
    wordsAt(104, 108).map((word) => word | 0),
    [4, -3],
  );
  assert.deepEqual(wordsAt(112, 116, 120, 124), [1, 1, 0, 0]);
});

test('2.6.1.67 fullscreen GCALLs read the setting and preserve unused coordinate output', async (t) => {
  const program = kcsProgram([
    [37, 0x781a2bcd],
    [43, 741, 0],
    [38, 80],
    [37, 84],
    [37, 88],
    [43, 740, 8],
    [59],
  ]);
  const world = await dataWorld(profile, { 'fullscreen.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const screen = world.configuration.screen;
  screen.fullHeight = 720;
  screen.virtualHeight = 600;
  screen.multiWindowPosition = 0x81234567;
  world.graphics.view.configure({
    virtualWidth: 800,
    virtualHeight: 600,
    clientWidth: 800,
    clientHeight: 600,
    deviceOffset: [10, -20],
    deviceScale: 1,
    windowShift: [2, 3],
    drawingRectangle: [0, 0, 800, 560],
  });
  for (const [fullscreen, mode, expected] of [
    [0, 0, [0, -12, 557]],
    [1, 1, [0x81234567, -12, 737]],
    [1, 2, [0x81234567, 0, 600]],
    [1, 3, [0x81234567, 0, 405]],
  ]) {
    screen.fullscreen = fullscreen;
    screen.fullPosition = mode;
    const task = await world.spawnScript('fullscreen.kcs');
    const { machine } = task;
    const floor = machine.sp;
    machine.store(88, 405);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0x781a2bcd);
    assert.deepEqual([machine.load(80), machine.load(84) | 0, machine.load(88) | 0], expected);
  }
});

test('2.6.1.67 narrow GCALLs append bytes and write the original result words', async (t) => {
  const calls = [
    [15, [128, 160], 80],
    [16, [128, 192], 84],
    [17, [128], 88],
    [19, [224, 256], 92],
    [21, [288, 320], 96],
    [25, [352], 100],
    [25, [384], 104],
  ];
  const program = kcsProgram(
    [
      [37, 0xf1910080],
      ...calls.flatMap(([id, args, result]) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        [38, result],
      ]),
      [59],
    ],
    [
      [128, '猫'],
      [160, '/log/'],
      [192, '100%%'],
      [224, 'A'],
      [256, 'B'],
      [288, 'NaMe'],
      [320, 'NAME'],
      [352, '-0x2ag'],
      [384, '5tail'],
    ],
  );
  const world = await dataWorld(profile, { 'narrow-strings.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('narrow-strings.kcs');
  const { machine } = task;
  const floor = machine.sp;
  machine.bytes(139, 5).fill(0x5a);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xf1910080);
  assert.deepEqual(
    [80, 84, 88, 92, 96, 100, 104].map((at) => machine.load(at)),
    [128, 128, 11, 1, 0, 0xffffffd6, 5],
  );
  assert.deepEqual(
    machine.bytes(128, 14),
    Uint8Array.of(...encodeCP932('猫/log/100%'), 0, 0, 0x5a),
  );
});

test('2.6.1.67 string expansion uses the existing Script bank and writes two terminators', async (t) => {
  const expanded = encodeCP932('猫+$str2/z:/$strQ');
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'strings.kcs': kcsProgram(
      [
        [37, 0x89541afb],
        [37, 7],
        [37, 192],
        [43, 276, 8],
        [37, 0xffffffff],
        [37, 224],
        [43, 276, 8],
        [37, 42],
        [37, 256],
        [43, 276, 8],
        [37, 44],
        [37, 288],
        [43, 276, 8],
        [37, 44],
        [37, 320],
        [43, 277, 8],
        [38, 84],
        [37, 7],
        [37, 352],
        [43, 277, 8],
        [38, 88],
        [37, 128],
        [43, 278, 4],
        [59],
      ],
      [
        [128, '$str7+$str-1/$str0x2a:$str44/$strQ'],
        [192, '猫'],
        [224, '$str2'],
        [256, 'z'],
        [288, ''],
        [320, 'old'],
        [352, 'old'],
      ],
    ),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { runtime, task: plain } = await run([[37, 128], [43, 278, 4], [59]]);
  const plainWord = encodeCP932('plain $strQ');
  plain.machine.writeStringBytes(plainWord, 128);
  plain.machine.bytes(128 + plainWord.length + 1, 2).fill(0x7f);
  await runtime.scheduler.execute(plain);
  assert.equal(runtime.stringBank(plain, false), null);
  assert.deepEqual(
    plain.machine.bytes(128, plainWord.length + 3),
    Uint8Array.of(...plainWord, 0, 0, 0x7f),
  );

  const { runtime: unownedRuntime, task: unowned } = await run([[37, 128], [43, 278, 4], [59]]);
  unowned.machine.writeString('$str7', 128);
  await assert.rejects(
    () => unownedRuntime.scheduler.execute(unowned),
    /Native string expansion requires the caller string bank/,
  );

  const task = await world.spawnScript('strings.kcs', { initialExecute: false });
  const { machine } = task;
  const floor = machine.sp;
  const tail = machine.load(128 + expanded.length + 2, 1);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0x89541afb);
  assert.deepEqual(machine.bytes(128, expanded.length + 3), Uint8Array.of(...expanded, 0, 0, tail));
  assert.deepEqual([machine.load(84), machine.load(88)], [0, 1]);
  assert.equal(machine.string(320), '');
  assert.equal(machine.string(352), '猫');
});

test('2.6.1.67 KCS copies only FES private words, preserves raw names and queries the live result', async (t) => {
  const target = 34,
    marker = 0x8cc9a31e,
    key = 'k'.repeat(32),
    call = (id, ...args) => [...args.map((word) => [37, word]), [43, id, args.length * 4]],
    files = {
      'bank.fes': encodeCP932('#START\nresult named\nnext HOLD\n#HOLD\n\n#LOOKUP\nresult ' + key),
      'start.kcs': kcsProgram([...call(447, target, 128), [59]], [[128, 'bank']]),
      'from.kcs': kcsProgram([
        [37, marker],
        ...call(664, target, 112, 0x89ca3216),
        ...call(664, target, 176, 0xaa123491),
        ...call(664, target, 184, 0x8bb25fcd),
        ...call(664, target, 192, 0xeb43a0c1),
        ...call(665, target),
        [59],
      ]),
      'to.kcs': kcsProgram([[37, marker], ...call(666, target), [59]]),
      'read.kcs': kcsProgram([[37, marker], ...call(667, target), [59]]),
      'clear.kcs': kcsProgram([[37, marker], ...call(668, target), ...call(667, target), [59]]),
      'missing.kcs': kcsProgram([...call(667, 0x1a823456), [59]]),
      'long.kcs': kcsProgram([...call(664, target, 128, 2), [59]], [[128, 'L'.repeat(36)]]),
    },
    world = await dataWorld(profile, files),
    parent = world.main.id,
    bank = world.runtime.variableBank(world.main);
  t.after(() => world.close({ flushFiles: false }));
  bank.initialize(32);
  bank.words.set([7, 8, 9]);
  const fesID = await world.objects.create({ kind: 34, parent, nativeID: target }),
    fes = world.objects.objects.get(fesID).implementation;
  const spawn = (name, w = world) =>
    w.spawnScript(name + '.kcs', { parent, initialExecute: false });
  await world.runtime.scheduler.execute(await spawn('start'));
  const from = await spawn('from'),
    local = bank.context(from.id),
    destinationKey = fes.variableContextKey(),
    destination = bank.context(destinationKey),
    words = Uint32Array.from({ length: 512 }, (_, index) => (0xe0ca9d12 + 0x68416 * index) >>> 0);
  local.words.set(words);
  bank.setName('callerOwned', 0, 0xb34);
  from.machine.writeString('named', 112);
  from.machine.writeStringBytes(Uint8Array.of(0xee, 0xf9), 176);
  from.machine.writeStringBytes(Uint8Array.of(0xfa, 0x54), 184);
  from.machine.writeString(key + '尾Z', 192);
  await world.runtime.scheduler.execute(from);
  assert.equal(from.machine.pop(), marker);
  assert.deepEqual(destination.words, words);
  assert.equal(bank.selectedContext, destinationKey);
  assert.equal(bank.getName('named'), 0x89ca3216);
  assert.equal(bank.getName(Uint8Array.of(0xee, 0xf9)), 0xaa123491);
  assert.equal(bank.getName(Uint8Array.of(0xfa, 0x54)), 0x8bb25fcd);
  assert.equal(bank.getName(encodeCP932(key)), 0xeb43a0c1);
  assert.equal(bank.getName('callerOwned'), 0);
  assert.equal(local.names.size, 1);
  assert.deepEqual(bank.words.slice(0, 3), Uint32Array.of(7, 8, 9));

  await fes.tick();
  const read = await spawn('read');
  await world.runtime.scheduler.execute(read);
  assert.deepEqual([read.machine.pop(), read.machine.pop()], [0x89ca3216, marker]);
  const to = await spawn('to');
  await world.runtime.scheduler.execute(to);
  assert.deepEqual(bank.context(to.id).words, words);
  assert.equal(bank.context(to.id).names.size, 0);
  assert.equal(bank.selectedContext, to.id);
  await assert.rejects(
    world.runtime.scheduler.execute(await spawn('long')),
    /FES local name exceeds its 36-byte key scratch/,
  );

  const restored = await dataWorld(profile, files, { initialize: false });
  t.after(() => restored.close({ flushFiles: false }));
  await restored.restore(structuredClone(world.snapshot()));
  const restoredFes = restored.objects.objects.get(fesID).implementation,
    restoredBank = restored.runtime.variableBank(restored.main);
  assert.deepEqual(restoredBank.context(destinationKey).words, words);
  assert.deepEqual(restoredBank.context(destinationKey).names, destination.names);
  const restoredRead = await spawn('read', restored);
  await restored.runtime.scheduler.execute(restoredRead);
  assert.deepEqual([restoredRead.machine.pop(), restoredRead.machine.pop()], [0x89ca3216, marker]);
  await restoredFes.player.notify('LOOKUP');
  await restoredFes.player.flush();
  const lookup = await spawn('read', restored);
  await restored.runtime.scheduler.execute(lookup);
  assert.deepEqual([lookup.machine.pop(), lookup.machine.pop()], [0xeb43a0c1, marker]);
  const clear = await spawn('clear', restored);
  await restored.runtime.scheduler.execute(clear);
  assert.deepEqual([clear.machine.pop(), clear.machine.pop()], [0, marker]);
  await assert.rejects(
    restored.runtime.scheduler.execute(await spawn('missing', restored)),
    /FES native 0x29b has no initialized 32-bit output word/,
  );
  await restoredFes.closeInterpreter();
  await assert.rejects(
    restored.runtime.scheduler.execute(await spawn('read', restored)),
    /FES result access requires its interpreter/,
  );
});

test('2.6.1.67 Draw GCALLs copy, clear and force the owned pixel surface', async (t) => {
  const target = [0x13, 80];
  const pixels = [23, 47, 89, 255];
  const program = (id, args = [target]) =>
    kcsProgram([
      [37, 0xd714a16b],
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      [59],
    ]);
  const world = await dataWorld(profile, {
    'copy.kcs': program(455, [target, [0x13, 84]]),
    'render.kcs': program(340),
    'clear.kcs': program(341),
    'force.kcs': program(342),
  });
  t.after(() => world.close({ flushFiles: false }));
  const texture = world.configuration.fields.texture;
  texture.size.set([64, 64]);
  texture.grid.set([1, 1]);
  texture.bppY.set([0, 1]);
  texture.areas[0].set([0, 0, 1, 1]);
  texture.bpp = 32;
  const owner = world.main;
  const id = await world.objects.create({ kind: 15, parent: owner.id });
  const nativeID = world.nativeTaskID(id);
  const targetDraw = world.graphics.drawTasks.get(id);
  await world.runtime.native('main', 256, [nativeID, 2, 2], owner.machine, owner);
  await world.runtime.native('main', 260, [nativeID, 0, 0], owner.machine, owner);
  await world.runtime.native('main', 262, [nativeID, 1], owner.machine, owner);
  const image = world.graphics.images.create(1, 1, owner.id);
  const source = world.graphics.images.get(image);
  (await source.pixels()).set(pixels);
  await source.changed();
  const execute = async (name, handle = 0) => {
    const task = await world.spawnScript(name);
    const { machine } = task;
    const stack = machine.sp;
    machine.store(80, nativeID);
    machine.store(84, handle);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, stack + 4);
    assert.equal(machine.load(stack), 0xd714a16b);
  };
  await execute('copy.kcs', image);
  assert.equal(targetDraw.state.baseVisible, true);
  assert.notEqual(targetDraw.state.baseImage, image);
  assert.deepEqual(
    Array.from(await world.graphics.images.get(targetDraw.state.baseImage).pixels()),
    pixels,
  );
  await execute('render.kcs');
  const rendered = await world.graphics.images.get(targetDraw.state.renderer.bitmap).pixels();
  assert.ok(
    rendered.some(
      (_, offset) =>
        offset % 4 === 0 && pixels.every((value, channel) => rendered[offset + channel] === value),
    ),
    'Expected the owned color in the ordinary Draw output',
  );
  await execute('copy.kcs');
  await execute('clear.kcs');
  assert.equal(targetDraw.state.baseVisible, false);
  assert.deepEqual(targetDraw.state.renderer.items, []);
  await world.runtime.native('main', 262, [nativeID, 0], owner.machine, owner);
  await execute('force.kcs');
  assert.equal(targetDraw.state.enabled, 0);
  assert.deepEqual(
    Array.from((await world.graphics.images.get(world.graphics.vramHandle).pixels()).slice(0, 4)),
    [0, 0, 0, 0],
  );
});

test('2.6.1.67 Input GCALLs target the owned Root input, gate keys and restore all DWORDs', async (t) => {
  const world = await dataWorld(profile, {
    'input-disable.kcs': kcsProgram([
      [37, 0xa2683243],
      [37, 0],
      [43, 401, 4],
      [37, 2],
      [37, 0],
      [43, 403, 8],
      [37, 79],
      [37, 0x82345678],
      [43, 403, 8],
      [59],
    ]),
    'input-reset.kcs': kcsProgram([
      [37, 0xa2683243],
      [43, 404, 0],
      [37, 0x92345678],
      [43, 401, 4],
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const run = async (name) => {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      floor = task.machine.sp;
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, floor + 4);
    assert.equal(task.machine.load(floor), 0xa2683243);
  };
  await run('input-disable.kcs');
  assert.equal(world.input.cursorEnabled, 0);
  assert.equal(world.input.enabled[79], 0x82345678);
  world.input.key(2, true, 1);
  await world.input.tick(1);
  assert.equal(world.input.held[8], 0);
  await run('input-reset.kcs');
  await world.input.tick(2);
  assert.equal(world.input.held[8], 1);
  assert.equal(world.input.cursorEnabled, 0x92345678);
  assert.deepEqual([...world.input.enabled], Array(80).fill(1));
});

test('2.6.1.67 task notification GCALLs deliver exact raw packets in the caller namespace', async (t) => {
  const world = await dataWorld(profile, {
    'send.kcs': kcsProgram([
      [37, 0xa9173e32],
      [37, 0],
      [43, 572, 4],
      [37, [0x13, 84]],
      [43, 570, 4],
      [37, [0x13, 84]],
      [37, [0x13, 88]],
      [43, 571, 8],
      [37, [0x13, 84]],
      [37, 0],
      [43, 571, 8],
      [37, 0xffffffef],
      [43, 572, 4],
      [37, 0xfe86085d],
      [43, 577, 4],
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('send.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    trace = [],
    send = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = async (...args) => {
    const result = await send(...args);
    trace.push({ args: args.slice(0, 5), result });
    return result;
  };
  const { machine } = task,
    floor = machine.sp,
    target = world.nativeTaskID(world.main.id),
    pointer = world.runtime.imageDataBuffers.process.allocate(4);
  world.runtime.imageDataBuffers.process.store(pointer, 0x888c0fea);
  machine.store(84, target);
  machine.store(88, pointer);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xa9173e32);
  assert.deepEqual(
    trace.map(({ args }) => args),
    [
      [0, task.id, 426, 0, 0],
      [target, task.id, 424, 0, 0],
      [target, task.id, 427, 0, 0x888c0fea],
      [target, task.id, 427, 0, 0],
      [0xffffffef, task.id, 426, 0, 0],
      [0, task.id, 38, 0, 0xfe86085d],
    ],
  );
  assert.ok(trace.every(({ result }) => result === NATIVE_UNWRITTEN_WORD));
  assert.equal(world.objects.objects.get(world.root).implementation.field, 0xfe86085d);
  world.runtime.imageDataBuffers.process.free(pointer);
});

test('2.6.1.67 Input GCALLs collect four physical sources and clear region activity', async (t) => {
  const world = await dataWorld(profile, {
    'input-query.kcs': kcsProgram([
      [37, 0xaefec213],
      [37, 12],
      [43, 285, 4],
      [38, 80],
      [43, 286, 0],
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { input } = world,
    region = input.register({ owner: world.main.id, bounds: [5, 10, 40, 45] }),
    task = await world.spawnScript('input-query.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    floor = task.machine.sp;
  [2, 16, 128, 4096].forEach((source, device) => input.key(12, true, source, device));
  input.get(region.owner).active = 0x312;
  input.previousX = 17;
  input.previousY = 38;
  input.forceCursor = false;
  await world.runtime.scheduler.execute(task);
  assert.equal(task.machine.load(80), 0x1092);
  assert.equal(task.machine.sp, floor + 4);
  assert.equal(task.machine.load(floor), 0xaefec213);
  assert.equal(region.active, 0);
  assert.deepEqual([input.previousX, input.previousY, input.forceCursor], [-1, -1, true]);
});

test('2.6.1.67 narrow string GCALLs preserve native byte aliases and character boundaries', async () => {
  const { runtime, task, machine } = await run([
    [37, 0xfa9232f2],
    ...[
      [43, [416, 320, 352]],
      [42, [480, 416, 1], 80],
      [42, [512, 416, 99], 84],
      [44, [544, 416, 0, -1]],
      [45, [576, 384, 448, 640]],
      [45, [704, 704, 448, 640]],
      [47, [768], 88],
      [48, [800], 92],
      [49, [768, 832], 96],
      [49, [768, 864], 100],
      [49, [768, 896], 104],
    ].flatMap(([id, args, output]) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      ...(output === undefined ? [] : [[38, output]]),
    ]),
    [59],
  ]);
  const floor = machine.sp;
  machine.bytes(416, 232).fill(0xa5);
  machine.writeString('a(b,(:c)),終', 320);
  machine.writeString(',', 352);
  machine.writeString('x-a-a-尾', 384);
  machine.writeString('a', 448);
  machine.writeString('写', 640);
  machine.writeString('a-tail', 704);
  machine.bytes(768, 5).set([0x81, 0x5c, 0x5c, 65, 0]);
  machine.writeString('二文字', 800);
  machine.writeString('\\', 832);
  machine.writeString('absent', 864);
  machine.writeString('', 896);
  await runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xfa9232f2);
  assert.equal(machine.string(480), '(b,(:c))');
  assert.deepEqual(machine.bytes(512, 3), Uint8Array.of(0, 0, 0xa5));
  assert.equal(machine.string(544), 'a (b,(:c)) 終 ');
  assert.equal(machine.string(576), 'x-写-写-尾');
  assert.deepEqual(machine.bytes(704, 4), Uint8Array.of(0, 0, 0x74, 0x61));
  assert.deepEqual(
    [80, 84, 88, 92, 96, 100, 104].map((at) => machine.load(at)),
    [1, 0, 3, 3, 2, 4, 0],
  );
});

test('2.6.1.67 Main519 selects a space token through its live CP932 group scanner', async () => {
  const { runtime, task, machine } = await run([
    ...[
      [320, 256, 1, 80],
      [352, 256, 0xffffffff, 84],
      [384, 384, 0, 88],
      [416, 0xffffffff, 0, 92],
    ].flatMap(([destination, source, index, output]) => [
      [37, destination],
      [37, source],
      [37, index],
      [43, 519, 12],
      [38, output],
    ]),
    [59],
  ]);
  machine.bytes(320, 112).fill(0xa5);
  machine.writeString('a(b (:中 d)) 尾', 256);
  machine.writeString('alias', 384);
  const stack = machine.sp;
  await runtime.scheduler.execute(task);
  assert.equal(machine.sp, stack);
  assert.deepEqual(
    machine.bytes(320, 14),
    Uint8Array.of(...encodeCP932('(b (:中 d))'), 0, 0, 0xa5),
  );
  assert.deepEqual(
    [80, 84, 88, 92].map((at) => machine.load(at)),
    [1, 0, 0, 0],
  );
  assert.deepEqual(machine.bytes(352, 3), Uint8Array.of(0, 0xa5, 0xa5));
  assert.deepEqual(machine.bytes(384, 3), Uint8Array.of(0, 0x6c, 0x69));
  assert.deepEqual(machine.bytes(416, 3), Uint8Array.of(0, 0xa5, 0xa5));
});

test('2.6.1.67 KCS guest allocation and copying retain byte ranges and forward MMX overlap', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    ...(at === undefined ? [] : [[38, at]]),
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(27, [0], 80),
    ...call(27, [8], 84),
    ...call(35, [320, [0x13, 84], 8]),
    ...call(36, [[0x13, 84], 0x123456cb, 4]),
    ...call(35, [328, [0x13, 84], 8]),
    ...call(28, [[0x13, 84]], 88),
    ...call(28, [[0x13, 84]], 92),
    ...call(35, [352, 0xffffffff, 1]),
    ...call(35, [0xffffffff, 352, 1]),
    ...call(35, [0xffffffff, 0xffffffff, 0]),
    ...call(35, [385, 384, 16]),
    ...call(35, [417, 416, 12]),
    ...call(35, [449, 448, 11]),
    [59],
  ]);
  m.bytes(320, 40).fill(0xa5);
  for (const at of [384, 416, 448]) m.bytes(at, 17).set(Array.from({ length: 17 }, (_, i) => i));
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.equal(m.load(80), 0xffffffff);
  assert.equal(m.load(84), m.memory.length);
  assert.deepEqual([m.load(88), m.load(92)], [1, 0]);
  assert.deepEqual(m.bytes(320, 8), new Uint8Array(8));
  assert.deepEqual(m.bytes(328, 8), Uint8Array.of(0xcb, 0xcb, 0xcb, 0xcb, 0, 0, 0, 0));
  assert.deepEqual(m.bytes(352, 3), Uint8Array.of(0xa5, 0xa5, 0xa5));
  assert.deepEqual(
    m.bytes(384, 17),
    Uint8Array.of(0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 9, 10, 11, 12, 13, 14, 15),
  );
  assert.deepEqual(m.bytes(416, 13), Uint8Array.of(0, 0, 1, 2, 3, 3, 5, 6, 7, 7, 9, 10, 11));
  assert.deepEqual(m.bytes(448, 12), Uint8Array.of(0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
});

test('2.6.1.67 KCS argument expressions return a bounded list and raw space offsets', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    [38, at],
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(539, [256, 512, 2], 80),
    ...call(539, [288, 544, 3], 84),
    ...call(539, [320, 576, 1], 88),
    ...call(539, [320, 580, 0xffffffff], 92),
    ...call(539, [0xffffffff, 608, 1], 96),
    ...[0, 1, 2, 3, 4, 0xffffffff].flatMap((index, i) => call(540, [352, index], 100 + i * 4)),
    [59],
  ]);
  runtime.variableBank(task).initialize(4);
  m.writeString('[1+2,0x10,9]', 256);
  m.writeString('[3-6]', 288);
  m.writeString('1-3*4', 320);
  m.writeString('猫\t犬  A ', 352);
  m.bytes(512, 104).fill(0xa5);
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    Array.from({ length: 11 }, (_, i) => m.load(80 + i * 4)),
    [2, 3, 1, 0, 0, 0, 7, 9, 0xffffffff, 0xffffffff, 0xffffffff],
  );
  assert.deepEqual(
    [512, 516, 520].map((at) => m.load(at)),
    [3, 16, 0xa5a5a5a5],
  );
  assert.deepEqual(
    [544, 548, 552, 556].map((at) => m.load(at)),
    [3, 4, 5, 0xa5a5a5a5],
  );
  assert.deepEqual(
    [576, 580, 608].map((at) => m.load(at)),
    [0xfffffff5, 0xa5a5a5a5, 0xa5a5a5a5],
  );
});

test('2.6.1.67 KCS variable owner evaluates, backs up bytes, and addresses its selected private context', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    ...(at === undefined ? [] : [[38, at]]),
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(212, [15]),
    ...call(213, [320], 80),
    ...call(213, [0xffffffff], 84),
    ...call(609, []),
    ...call(211, [0, 7]),
    ...call(211, [1, 8]),
    ...call(211, [2, 9]),
    ...call(610, []),
    ...call(210, [0], 88),
    ...call(210, [1], 92),
    ...call(210, [2], 96),
    ...call(659, [511, 0xfedcba98]),
    ...call(659, [512, 0xbeef]),
    ...call(659, [0xffffffff, 0xdead]),
    ...call(658, [511], 100),
    ...call(658, [512], 104),
    ...call(658, [0xffffffff], 108),
    [59],
  ]);
  const bank = runtime.variableBank(task);
  bank.initialize(8);
  bank.words.set([100, 200, 300]);
  bank.registerContext('unselected');
  bank.registerContext('active');
  m.writeString('$0+@%', 320);
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => m.load(80 + i * 4)),
    [115, 0, 100, 200, 9, 0xfedcba98, 0, 0],
  );
  assert.equal(bank.context('unselected').words[511], 0);
  assert.equal(bank.context('active').words[511], 0xfedcba98);
  assert.equal(bank.context('active').words[0], 0);
});

test('2.6.1.67 KCS formatted string calls preserve CP932 widths and live truncation', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    ...(at === undefined ? [] : [[38, at]]),
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(18, [256], 80),
    ...call(20, [896, 1024], 84),
    ...call(22, [416, 448], 88),
    ...call(23, [288, 2], 92),
    ...call(24, [320, 2], 96),
    ...call(26, [352], 100),
    ...call(37, [624, 1234567, 1]),
    ...call(37, [656, -999, 1]),
    ...call(38, [513, 512, 544, 7], 104),
    ...call(38, [576, 608, 688, 12], 108),
    ...call(39, [720, 608, 752, 12], 112),
    ...call(40, [256], 116),
    ...call(40, [784], 120),
    ...call(40, [0xffffffff], 124),
    [59],
  ]);
  m.bytes(512, 293).fill(0xa5);
  m.writeString('猫a', 256);
  m.writeString('猫a', 288);
  m.writeString('猫ab', 320);
  m.writeString('-12.5D-1rest', 352);
  m.writeString('aBc', 416);
  m.writeString('ABC', 448);
  m.writeString('abcd', 512);
  m.writeString('', 544);
  m.writeString('one\ttwo', 608);
  m.writeString('\\t', 688);
  m.writeString('\\\t', 752);
  m.writeStringBytes(Uint8Array.of(0x81, 0x7f), 784);
  m.writeString('C', 896);
  m.writeString('A'.repeat(1024) + 'D', 1024);
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => m.load(80 + i * 4)),
    [3, 3, 0, 0, 3, floatBits(-1.25), 5, 3, 3, 1, 0, 0],
  );
  assert.deepEqual(m.bytes(288, 4), Uint8Array.of(0, 0, 97, 0));
  assert.deepEqual(m.bytes(320, 5), Uint8Array.of(...encodeCP932('猫a'), 0, 0));
  assert.deepEqual(m.bytes(624, 13), Uint8Array.of(...encodeCP932('+1,234,567'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(656, 7), Uint8Array.of(...encodeCP932('-999'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(512, 9), Uint8Array.of(...encodeCP932('aaaaaa'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(576, 6), Uint8Array.of(...encodeCP932('one'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(720, 6), Uint8Array.of(...encodeCP932('one'), 0, 0, 0xa5));
});

test('2.6.1.67 KCS common Base commands reset the exit word and pause the designated task', async (t) => {
  const command = (id, words) => [...words.map((word) => [37, word]), [43, id, words.length * 4]],
    target = [0x13, 80],
    world = await dataWorld(profile, {
      'hold.kcs': kcsProgram([
        [37, 0x9753bf24],
        ...command(651, [target]),
        ...command(694, [target, 0x80234567]),
        ...command(694, [999999, 0x100]),
        [59],
      ]),
      'resume.kcs': kcsProgram([...command(694, [target, 0]), [59]]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const pausedID = await world.objects.create({ kind: 2, parent: world.main.id }),
    paused = world.objects.objects.get(pausedID),
    untouched = world.objects.objects.get(
      await world.objects.create({ kind: 2, parent: world.main.id }),
    );
  paused.exitCode = 85;
  untouched.exitCode = 15;
  const run = async (script) => {
    const task = await world.spawnScript(script, { parent: world.main.id, initialExecute: false });
    task.machine.store(80, world.nativeTaskID(pausedID));
    const stack = task.machine.sp;
    await world.runtime.scheduler.execute(task);
    return { task, stack };
  };
  const { task, stack } = await run('hold.kcs');
  assert.equal(task.machine.sp, stack + 4);
  assert.equal(task.machine.load(stack), 0x9753bf24);
  assert.equal(paused.exitCode, -1);
  assert.equal(paused.userValue, 0x80234567);
  assert.equal(untouched.exitCode, 15);
  assert.equal(untouched.userValue, 0);
  await run('resume.kcs');
  assert.equal(paused.userValue, 0);
});

test('2.6.1.67 KCS Plane restore relays the VRAM selector and formats both notification packets', async (t) => {
  const target = [0x13, 80],
    command = (id, words) => [...words.map((word) => [37, word]), [43, id, words.length * 4]],
    world = await dataWorld(profile, {
      'restore.kcs': kcsProgram([
        [37, 0x283e9da1],
        ...command(653, [target, 0x80234567]),
        ...command(654, [target, 96, 128]),
        ...command(655, [target, 160]),
        ...command(653, [0, 7]),
        [59],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const id = await world.objects.create({ kind: 2, parent: world.main.id }),
    plane = world.graphics.get(id),
    task = await world.spawnScript('restore.kcs', { parent: world.main.id, initialExecute: false }),
    machine = task.machine,
    stack = machine.sp,
    receiver = plane.message.bind(plane),
    packets = [];
  plane.message = (words, context) => {
    const [, message, w, l] = words;
    if (message === 85 || message === 86) {
      const size = message === 85 ? 512 : 256;
      packets.push({ message, w, l, bytes: context.payload.bytes(0, size).slice() });
    }
    return receiver(words, context);
  };
  machine.store(80, world.nativeTaskID(id));
  machine.writeString('背景', 96);
  machine.writeString('復帰', 128);
  machine.writeString('', 160);
  const original = structuredClone(plane.state);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, stack + 4);
  assert.equal(machine.load(stack), 0x283e9da1);
  assert.deepEqual(plane.state, { ...original, vramType: 0x80234567 });
  const pair = new Uint8Array(512);
  pair.set(encodeCP932('背景'));
  pair.set(encodeCP932('復帰'), 256);
  assert.deepEqual(packets, [
    { message: 85, w: 0, l: 256, bytes: pair },
    { message: 86, w: 0, l: 0, bytes: new Uint8Array(256) },
  ]);
});

test('2.6.1.67 KCS voice queries use the CP932 directory, name prefix and owned bank words', async (t) => {
  const names = [
      'VOICES.int/line.wav',
      '表ACTOR_01.wav',
      'other/actor_01.wav',
      'not_found.wav',
      'alternate.int/line.wav',
    ],
    ids = [844, 606, 607, 605],
    input = (index) => 256 + index * 64,
    result = (inputIndex, idIndex) => 640 + (inputIndex * ids.length + idIndex) * 4,
    world = await dataWorld(profile, {
      'voice.kcs': kcsProgram([
        ...names.flatMap((_, inputIndex) =>
          ids.flatMap((id, idIndex) => [
            [37, input(inputIndex)],
            [43, id, 4],
            [38, result(inputIndex, idIndex)],
          ]),
        ),
        [59],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const config = world.configuration,
    block = config.blocks[0],
    words = new DataView(block.buffer, block.byteOffset, block.byteLength),
    { groupByte, archiveByte, muteWord } = config.voiceLayout;
  config.soundGroups = [
    { id: 28, type: 'voice' },
    { id: 29, type: 'se' },
  ];
  words.setUint32(4, 52, true);
  words.setUint32(8, 73, true);
  const setRow = (index, archive, head, [play, master, group]) => {
    const start = config.voiceRecordByte(index);
    words.setUint32(start, play, true);
    words.setUint32(start + 36, master, true);
    words.setUint32(start + groupByte, group, true);
    block.set(encodeCP932(head), start + 40);
    block.set(encodeCP932(archive), start + archiveByte);
  };
  setRow(1, 'voices', '表actor', [7, 83, 28]);
  setRow(3, 'alternate', 'actor', [0, 45, 29]);
  const check = async (gains) => {
    const task = await world.spawnScript('voice.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      machine = task.machine;
    names.forEach((name, index) => machine.writeString(name, input(index)));
    await world.runtime.scheduler.execute(task);
    assert.deepEqual(
      names.map((_, inputIndex) =>
        ids.map((_, idIndex) => machine.load(result(inputIndex, idIndex))),
      ),
      [
        [1, 7, 83, gains[0]],
        [1, 7, 83, gains[1]],
        [0xffffffff, 0, 0, gains[2]],
        [0xffffffff, 0, 0, gains[3]],
        [3, 0, 45, gains[4]],
      ],
    );
  };
  await check([73, 52, 52, 100, 52]);
  words.setUint32((muteWord + 2) * 4, 1, true);
  await check([73, 0, 0, 100, 0]);
  words.setUint32(muteWord * 4, 1, true);
  await check([0, 0, 0, 0, 0]);
});

test('2.6.1.67 KCS category lookup selects the first configured archive or the flat voice row', async (t) => {
  const filename = 0x80000020,
    category = 416,
    marker = 0xde7c1b3a,
    world = await dataWorld(profile, {
      'category.kcs': kcsProgram([
        [37, marker],
        [37, filename],
        [37, category],
        [43, 674, 8],
        [59],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const entries = [];
  for (const [index, name] of [
    [0, 'image'],
    [2, 'bGM'],
    [5, 'same'],
    [11, 'SAME'],
    [17, 'A%rc'],
    [58, '表名前'],
    [63, 'voices'],
    [64, 'outside'],
  ])
    entries[index] = { name };
  world.game.nativeResources = { entries };
  Object.assign(world.soundConfiguration, {
    loaded: true,
    parts: [{ head: '表actor', int: 'outside', children: [] }],
  });
  const config = world.configuration,
    configBytes = config.blocks[0],
    archiveByte = config.voiceLayout.archiveByte;
  for (const [index, head, archive] of [
    [1, '表actor', 'voices'],
    [2, 'a', 'bgm'],
    [47, 'zz', '表名前'],
  ]) {
    const row = config.voiceRecordByte(index);
    configBytes.set(encodeCP932(head), row + 40);
    configBytes.set(encodeCP932(archive), row + archiveByte);
  }
  for (const [name, kind, expected] of [
    ['unused', 'IMAGE', 0],
    ['unused', 'BGM', 2],
    ['unused', 'same', 5],
    ['unused', 'outside', -1],
    ['unused', '', 1],
    ['unused', 'a%%rc', 17],
    ['unused', '表名前', 58],
    ['unused', 'absent', -1],
    ['表ACTOR_01.wav', 'sOuNd', 63],
    ['VOICES.int/line.wav', 'sound', 63],
    ['other/actor_01.wav', 'sound', -1],
    ['a001.ogg', 'sound', 2],
    ['zz0101.wav', 'sound', 58],
    ['rr0.wav', 'sound', -1],
  ]) {
    const task = await world.spawnScript('category.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      machine = task.machine,
      floor = machine.sp;
    machine.writeString(name, filename);
    machine.writeString(kind, category);
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(machine.sp, floor + 8);
    assert.equal(machine.pop(), expected >>> 0, JSON.stringify([name, kind]));
    assert.equal(machine.pop(), marker);
  }
});

test('2.6.1.67 KCS geometry uses live DWORD overlap and the original float accumulation', async (t) => {
  const matrix = 0x80000020,
    command = (id, ...words) => [...words.map((word) => [37, word]), [43, id, words.length * 4]],
    world = await dataWorld(profile, {
      'geometry.kcs': kcsProgram([
        [37, 0x3a1f8aa1],
        ...command(351, 132, 128),
        ...command(353, 260, 256),
        ...command(354, 324, 320),
        ...command(355, 384),
        [38, 560],
        ...command(356, 416),
        [38, 564],
        ...command(356, 448),
        [38, 568],
        ...command(357, 480, 492),
        ...command(358, 512, matrix),
        ...command(358, matrix, matrix),
        [59],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('geometry.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    stack = m.sp,
    put = (address, words) => words.forEach((word, i) => m.store(address + i * 4, floatBits(word))),
    read = (address, count) =>
      Array.from({ length: count }, (_, i) => bitsFloat(m.load(address + i * 4)));
  put(
    128,
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  put(256, [1, 2, 3, 4, 5]);
  put(320, [1, 2, 3, 4, 5]);
  put(384, [3, 0, 0, 4]);
  put(416, [8192, 0, 2, 2]);
  put(448, [2 ** -75, 2 ** -75, 2 ** -75, 2 ** -75]);
  put(480, [1, 2, 3, 4]);
  put(512, [1, 1, 1, 1, 123]);
  put(matrix, [1, 1, 1, 1, 33554432, 0, 0, 0, 1, 0, 0, 0, -33554432, 0, 0, 0]);
  await world.runtime.scheduler.execute(task);
  assert.equal(m.sp, stack + 4);
  assert.equal(m.load(stack), 0x3a1f8aa1);
  assert.deepEqual(read(128, 20), [...Array(17).fill(1), 18, 19, 20]);
  assert.deepEqual(read(256, 5), [1, 3, 6, 10, 15]);
  assert.deepEqual(read(320, 5), [1, 1, 2, 2, 3]);
  assert.deepEqual([m.load(560), m.load(564), m.load(568)], [floatBits(5), floatBits(67108864), 2]);
  assert.deepEqual(read(480, 4), [4, 8, 12, 16]);
  assert.deepEqual(read(512, 5), [0, 1, 1, 1, 123]);
  assert.deepEqual(read(matrix, 8), [0, 1, 1, 1, 33554432, 0, 0, 0]);
});

test('2.6.1.67 KCS reads the startup static log word during restore', async (t) => {
  const world = await dataWorld(profile, {
    'log.kcs': kcsProgram([[43, 852, 0], [38, 128], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const read = async () => {
    const task = await world.spawnScript('log.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    await world.runtime.scheduler.execute(task);
    return task.machine.load(128);
  };
  assert.equal(await read(), 0);
  world.configuration.applyStartup(
    parseXML('<document><GAME><log><static>3</static></log></GAME></document>'),
  );
  assert.equal(await read(), 3);
});

test('2.6.1.67 KCS Input reads the selected region activity word', async (t) => {
  const world = await dataWorld(profile, {
    'active.kcs': kcsProgram([[37, [0x13, 84]], [43, 107, 4], [38, 128], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const owner = await world.objects.create({ kind: 2, parent: world.main.id }),
    target = world.nativeTaskID(owner),
    region = await world.input.register({ owner, receiver: world.main.id }),
    task = await world.spawnScript('active.kcs', { parent: world.main.id, initialExecute: false });
  region.active = 0x80234567;
  task.machine.store(84, target);
  await world.runtime.scheduler.execute(task);
  assert.equal(task.machine.load(128), 0x80234567);
  assert.equal(region.active, 0x80234567);
  world.input.unregister(owner);
  const missing = await world.spawnScript('active.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  missing.machine.store(84, target);
  missing.machine.store(128, 0xa5a5a5a5);
  await assert.rejects(
    () => world.runtime.scheduler.execute(missing),
    /no initialized 32-bit output word/,
  );
  assert.equal(missing.machine.load(128), 0xa5a5a5a5);
});
