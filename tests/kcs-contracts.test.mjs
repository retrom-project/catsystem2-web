// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply, readKCS, floatBits } from '../src/kcs.mjs';
import { KCSScheduler } from '../src/kcs/scheduler.mjs';
import { nativeTask } from '../src/native/task.mjs';

function program(instructions, name = 'authored') {
  const bytes = Uint8Array.from(
    instructions.flatMap(([op, ...args]) => [
      op,
      ...args.flatMap((arg) => {
        const [mode, value] = Array.isArray(arg) ? arg : [0x23, arg];
        return [mode, value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
      }),
    ]),
  );
  return {
    name,
    body: new Binary(bytes),
    codeSize: bytes.length,
    data: new Uint8Array(256),
    stackSize: 512,
  };
}
const machine = (instructions, native) => new KCSMachine(program(instructions), { native });

test('native argument reads retain mapped adjacent stack words beyond the declared byte count', () => {
  const vm = machine([[37, 71], [43, 0x13b, 4], [59]], (id, args, current) => {
    assert.equal(id, 0x13b);
    assert.deepEqual(args, [71]);
    assert.equal(current.nativeArgument(0), 71);
    assert.equal(current.nativeArgument(1), 0x12345678);
    assert.throws(() => current.nativeArgument(1e8), /memory/);
    return nativeReply(1, current.nativeArgument(1));
  });
  vm.store(vm.sp + 4, 0x12345678);
  vm.run();
  assert.equal(vm.pop(), 0x12345678);
});

test('KCS header keeps the native ABI major/minor and container offsets independently', async () => {
  const body = Uint8Array.from([59]),
    header = new Uint32Array([0x0053434b, 2, 0x00020001, 52, 1, 53, 0, 0, 32, 64, 53, 0, 2]);
  const parsed = await readKCS(Buffer.concat([Buffer.from(header.buffer), deflateSync(body)]));
  assert.equal(parsed.scriptMajor, 1);
  assert.equal(parsed.scriptMinor, 2);
  assert.equal(parsed.scriptVersion, 0x00010002);
  assert.equal(parsed.tableOffset, 1);
  assert.equal(parsed.bodyCapacity, 2);
  assert.equal(new KCSMachine(parsed).sp, 32);
  const malformed = header.slice();
  malformed[6] = 1;
  await assert.rejects(
    readKCS(Buffer.concat([Buffer.from(malformed.buffer), deflateSync(body)])),
    /records exceed/,
  );
});

test('KCS flat local pointers and shared pointers preserve signed subword reads', () => {
  const vm = machine([
    [49, 8],
    [61, 0],
    [21, [0x53, 0], 0xdead80ff],
    [1, [0x11, 256], 1],
    [1, [0x31, 256], 1],
    [1, [0x32, 256], 0],
    [21, [0x13, 0x80000004], 71],
    [59],
  ]);
  vm.run();
  assert.equal(vm.load(256), 0xdead80ff);
  assert.equal(vm.load(0x80000004), 71);
  assert.equal(vm.pop(), 71);
  assert.equal(vm.pop() | 0, -32513);
  assert.equal(vm.pop(), 0);
  assert.equal(vm.pop(), 256);
  assert.throws(() => vm.load(0x40000000), /memory/);
});

test('native x86 golden distinguishes unsigned arithmetic, signed flags and raw assignment', () => {
  const vm = machine([
    [4, [3, 0xffffffef], [3, 3]],
    [4, -17, 3],
    [11, -1, 1],
    [21, [0x14, 64], 7],
    [21, [0x13, 68], [4, floatBits(3.5)]],
    [59],
  ]);
  vm.run();
  assert.equal(vm.load(64), 7); // assignment copies bits; it does not cast int to float
  assert.equal(vm.load(68), floatBits(3.5));
  assert.equal(vm.pop(), floatBits(3.5));
  assert.equal(vm.pop(), 7);
  assert.equal(vm.pop(), 0x7fffffff); // standalone SHR uses logical shift
  assert.equal(vm.pop() | 0, -5);
  assert.equal(vm.pop(), 1431655759);
});

test('native x86 golden keeps compound /= remainder and byte increment adjacent bits', () => {
  const vm = machine([
    [21, [0x13, 64], 17],
    [60],
    [32, [0x13, 64], [3, 5]],
    [21, [0x13, 80], 0x123456ff],
    [60],
    [22, [0x11, 80]],
    [59],
  ]);
  vm.run();
  assert.equal(vm.load(64), 2);
  assert.equal(vm.load(80), 0x12345600);
  assert.equal(vm.pop(), 0x12345600);
});

test('KCS native control codes preserve void/result/yield/retry behavior and argument bytes', () => {
  for (const control of [0, 1, 2, 3, 4, 5]) {
    let calls = 0;
    const vm = machine([[37, 11], [37, 22], [43, 7, 8], [37, 99], [59]], (id, args) => {
      assert.equal(id, 7);
      assert.deepEqual(args, [11, 22]);
      calls++;
      return nativeReply(control, [1, 3].includes(control) ? 4242 : undefined);
    });
    const state = vm.run();
    assert.equal(calls, 1);
    assert.equal(state.status, [1, 2].includes(control) ? 'halted' : 'yielded');
    if (control === 5) {
      assert.equal(vm.pc, 12);
      assert.equal(vm.sp, vm.data.length + 8);
      vm.host.native = () => nativeReply(1, 4242);
      vm.run();
    } else if (![1, 2].includes(control)) vm.run();
    assert.equal(vm.pop(), 99);
    if ([1, 3, 5].includes(control)) assert.equal(vm.pop(), 4242);
    assert.equal(vm.sp, vm.data.length);
  }
  assert.throws(() => machine([[43, 9, 0], [59]], () => 0).run(), /explicit control reply/);
  assert.throws(() => nativeReply(1), /must supply/);
});

test('KCS frame return copies a multiword result and restores floor, fp and caller temporaries', () => {
  const vm = machine([[49, 8], [42, 18, 0], [59], [49, 12], [37, 11], [37, 22], [44, 8, 0]]);
  vm.run();
  assert.equal(vm.fp, 256);
  assert.equal(vm.floor, 264);
  assert.equal(vm.sp, 272);
  assert.equal(vm.pop(), 22);
  assert.equal(vm.pop(), 11);
  vm.start();
  assert.equal(vm.sp, 256);
  assert.equal(vm.load(264), 11); // per-invocation stack is not zero-initialized
});

test('KCS serializable waits restore native retry, heap blocks and shared bank identity', () => {
  const vm = machine([[43, 9, 0], [59]], () =>
    nativeReply(5, undefined, { kind: 'event', type: 'answer' }),
  );
  const a = vm.allocate(12),
    b = vm.allocate(8);
  vm.store(b, 73);
  vm.store(0x80000000, 21);
  assert.equal(vm.free(a), true);
  assert.equal(vm.load(a), 73); // native linked allocations compact their virtual addresses
  vm.run();
  const restored = machine([[43, 9, 0], [59]], () => nativeReply(1, 44));
  restored.shared = vm.shared;
  restored.restore(structuredClone(vm.snapshot()));
  assert.equal(restored.load(a), 73);
  assert.equal(restored.waiting.type, 'answer');
  restored.resume();
  restored.run();
  assert.equal(restored.pop(), 44);
  assert.equal(restored.load(0x80000000), 21);
});

test('KCS browser I/O resumes the same logical frame and runs each native side effect once', async () => {
  let calls = 0;
  const scheduler = new KCSScheduler({
    native: async () => {
      calls++;
      await Promise.resolve();
      return nativeReply(1, 71);
    },
  });
  const task = scheduler.add(program([[43, 9, 0], [37, 2], [1, [0x63, 0], [0x63, 0]], [59]]), {
    abi: 'main',
    name: 'io',
  });
  await scheduler.tick();
  assert.equal(scheduler.frame, 1);
  assert.equal(calls, 1);
  assert.equal(task.status, 'finished');
  assert.equal(task.machine.pop(), 73);
});

test('KCS tasks share memory, wait for events, and continue after restoring a new scheduler', async () => {
  const programs = {
    writer: program(
      [[21, [0x13, 0x80000000], 9], [43, 1, 0], [21, [0x13, 0x80000000], 17], [59]],
      'writer',
    ),
    reader: program([[43, 2, 0], [1, [0x13, 0x80000000], 1], [59]], 'reader'),
  };
  const native = (_abi, id, _args, _vm, _task, scheduler) =>
    id === 1
      ? nativeReply(4, undefined, { kind: 'frames', until: scheduler.frame + 2 })
      : nativeReply(4, undefined, { kind: 'event', type: 'continue' });
  const scheduler = new KCSScheduler({ load: async (name) => programs[name], native });
  await scheduler.spawn('writer', { abi: 'main' });
  const reader = await scheduler.spawn('reader', { abi: 'generic' });
  await scheduler.tick();
  const saved = structuredClone(scheduler.snapshot());
  const restored = new KCSScheduler({ load: async (name) => programs[name], native });
  await restored.restore(saved);
  await restored.tick();
  assert.equal(restored.tasks.get(reader.id).status, 'waiting');
  restored.emit('continue', { button: 3 }, reader.id);
  await restored.tick();
  assert.equal(restored.tasks.get(reader.id).machine.pop(), 18);
  assert.equal(restored.tasks.get(reader.id).context.event.value.button, 3);
  assert.equal(new Set([...restored.tasks.values()].map((task) => task.machine.shared)).size, 1);
  assert.equal(restored.shared[0], 17);
});

test('KCS task creation and cancellation retain child identity and checkpoints with sparse IDs', async () => {
  const script = program([[43, 1, 0], [59]], 'task');
  const scheduler = new KCSScheduler({ load: async () => script, native: () => nativeReply(4) });
  scheduler.nextID = 3;
  const parent = scheduler.add(script, { name: 'task', abi: 'main' });
  scheduler.nextID = 9;
  const child = scheduler.add(script, { name: 'task', abi: 'main', parent: parent.id });
  await scheduler.tick();
  const restored = new KCSScheduler({ load: async () => script, native: () => nativeReply(4) });
  await restored.restore(structuredClone(scheduler.snapshot()));
  assert.deepEqual([...restored.tasks.keys()], [3, 9]);
  restored.cancel(parent.id);
  assert.equal(restored.tasks.get(child.id).status, 'cancelled');
  assert.equal(restored.tasks.get(child.id).parent, 3);
});

test('KCS immediate messages run a handler; queued messages precede the normal idle frame', async () => {
  const script = program(
    [
      [37, 64],
      [43, 0x47, 4],
      [39, 40],
      [30, [0x13, 80], 1],
      [41, 0],
      [30, [0x13, 84], 1],
      [41, 0],
    ],
    'message-loop',
  );
  const scheduler = new KCSScheduler({
    load: async () => script,
    native: (_abi, id, args, m, task) => nativeTask(id, args, m, task, {}),
  });
  const task = await scheduler.spawn('message-loop', { abi: 'main' });
  assert.equal((await scheduler.send(task.id, [9, 7, 3, 1])).accepted, false);
  await scheduler.tick();
  assert.equal(task.machine.waiting.kind, 'message');
  assert.equal(task.machine.load(80), 0);
  const sent = await scheduler.send(task.id, [9, 7, 3, 1]);
  assert.equal(sent.result, 1);
  assert.deepEqual(sent.message, [9, 7, 3, 1]);
  assert.equal(task.machine.load(80), 1);
  assert.equal(task.machine.load(84), 0);
  scheduler.post(task.id, [9, 8, 4, 1]);
  scheduler.post(task.id, [9, 9, 5, 1]);
  await scheduler.tick();
  assert.equal(task.machine.load(80), 3);
  assert.equal(task.machine.load(84), 1);
  assert.equal(task.machine.load(68), 9);
  const restored = new KCSScheduler({
    load: async () => script,
    native: (_abi, id, args, m, t) => nativeTask(id, args, m, t, {}),
  });
  await restored.restore(structuredClone(scheduler.snapshot()));
  await restored.tick();
  assert.equal(restored.tasks.get(task.id).machine.load(84), 2);
});

test('KCS native task services retain argument order, void results and cross-task memory direction', async () => {
  const source = machine([[59]]),
    destination = machine([[59]]),
    calls = [];
  source.writeString('window', 32);
  source.store(64, 0x12345678);
  const services = {
    format: (at, m) => m.string(at),
    objects: {
      create: async (options) => {
        calls.push(options);
        return 91;
      },
      release: (id) => calls.push(id),
      send: (id, words, options) => {
        calls.push([id, words, options]);
        return 1;
      },
      machine: () => destination,
    },
  };
  assert.deepEqual(
    await nativeTask(0x42, [34, 8, 32], source, { id: 7 }, services),
    nativeReply(1, 91),
  );
  assert.deepEqual(calls[0], { kind: 34, parent: 8, name: 'window', creator: 7 });
  assert.deepEqual(nativeTask(0x43, [91], source, { id: 7 }, services), nativeReply(2));
  nativeTask(0x46, [91, 17, 18, 19], source, { id: 7 }, services);
  assert.deepEqual(calls[2], [91, [7, 17, 18, 19], { queued: true }]);
  nativeTask(0x49, [91, 96, 4, 64], source, { id: 7 }, services);
  assert.equal(destination.load(96), 0x12345678);
  destination.store(96, 88);
  nativeTask(0x48, [91, 96, 4, 68], source, { id: 7 }, services);
  assert.equal(source.load(68), 88);
});
