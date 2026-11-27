// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { nativeReply } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76';
async function runtimeFor(instructions = [[59]], strings = []) {
  const bytes = kcsProgram(instructions, strings),
    runtime = new NativeRuntime({ profile, read: async () => bytes }),
    task = await runtime.spawn('primitive.kcs');
  return {
    runtime,
    task,
    call: (id, args) => runtime.native('main', id, args, task.machine, task, runtime.scheduler),
  };
}

test('real VM primitive chains retain guest writes, current variables, dictionaries and cold continuation', async () => {
  const instructions = [
      [37, 16],
      [43, 0xd1, 4],
      [37, 512],
      [37, 256],
      [37, 1],
      [43, 0x207, 12],
      [38, [0x13, 64]],
      [37, 512],
      [43, 0xd5, 4],
      [38, [0x13, 68]],
      [37, 1280],
      [37, 256],
      [37, 768],
      [37, 1024],
      [43, 0x2d, 16],
      [43, 0x203, 0],
      [38, [0x13, 72]],
      [37, [0x13, 72]],
      [37, 768],
      [37, 0x80000009],
      [43, 0x205, 12],
      [37, [0x13, 72]],
      [37, 768],
      [43, 0x206, 8],
      [38, [0x13, 76]],
      [43, 0x41, 0],
      [37, 512],
      [43, 0xd5, 4],
      [38, [0x13, 80]],
      [59],
    ],
    strings = [
      [256, 'set $1+=3'],
      [768, 'set'],
      [1024, 'let'],
    ],
    { runtime, task } = await runtimeFor(instructions, strings);
  let unrelatedReads = 0;
  Object.defineProperty(runtime.services, 'unrelated', {
    enumerable: true,
    get() {
      unrelatedReads++;
      return 17;
    },
  });
  await runtime.scheduler.execute(task);
  assert.equal(
    unrelatedReads,
    1,
    'only the ordinary yield prepares the full fallback service view',
  );
  const m = task.machine;
  assert.deepEqual([m.load(64), m.load(68), m.load(76)], [1, 3, 0x80000009]);
  assert.equal(m.string(1280), 'let $1+=3');
  assert.equal(runtime.variableBank(task, false).get(1), 3);
  const state = structuredClone(runtime.snapshot()),
    fresh = (await runtimeFor(instructions, strings)).runtime;
  await fresh.restore(state);
  const restored = fresh.scheduler.tasks.get(task.id);
  assert.deepEqual(fresh.snapshot(), state);
  fresh.variableBank(restored, false).set(1, 40);
  await fresh.scheduler.execute(restored);
  assert.equal(
    restored.machine.load(80),
    43,
    'expression is executed again against the current bank',
  );
  assert.equal(runtime.variableBank(task, false).get(1), 3);
  const handle = m.load(72);
  assert.deepEqual(
    fresh.native('main', 0x204, [handle], restored.machine, restored),
    nativeReply(2),
  );
  assert.throws(() => fresh.handles.get(handle, 'dictionary'), /released/);
});

test('primitive service getters and reentry capture current expression context and bank per invocation', async () => {
  const { runtime, task, call } = await runtimeFor(),
    m = task.machine;
  call(0xd1, [16]);
  m.writeString('@', 128);
  m.writeString('a (b c)', 256);
  const events = [],
    originalBank = runtime.variableBank;
  let generation = 29;
  runtime.variableBank = function (...args) {
    events.push('bank');
    return Reflect.apply(originalBank, this, args);
  };
  Object.defineProperty(runtime.services, 'variableExpressionContext', {
    configurable: true,
    enumerable: true,
    get() {
      events.push('context');
      assert.deepEqual(call(0x207, [512, 256, 1]), nativeReply(1, 1));
      events.push('nested');
      return { contextValue: generation };
    },
  });
  for (const value of [29, 71]) {
    generation = value;
    assert.deepEqual(call(0xd5, [128]), nativeReply(1, value));
  }
  assert.deepEqual(events, ['context', 'nested', 'bank', 'context', 'nested', 'bank']);
  const inheritedValue = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
  let descriptorResult;
  try {
    Object.defineProperty(Object.prototype, 'value', {
      configurable: true,
      get() {
        throw new Error('missing descriptor fields must not invoke inherited getters');
      },
      set(value) {
        Object.defineProperty(this, 'value', {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    });
    descriptorResult = call(0xd5, [128]);
  } finally {
    Reflect.deleteProperty(Object.prototype, 'value');
    if (inheritedValue) Object.defineProperty(Object.prototype, 'value', inheritedValue);
  }
  assert.deepEqual(descriptorResult, nativeReply(1, 71));
  const nextBank = new NativeVariableBank();
  nextBank.initialize(16);
  nextBank.contextValue = 83;
  task.context.variableBank = runtime.handles.add('variable-bank', nextBank);
  Object.defineProperty(runtime.services, 'variableExpressionContext', {
    configurable: true,
    enumerable: false,
    get() {
      throw new Error('non-enumerable service is not part of the original service view');
    },
  });
  assert.deepEqual(call(0xd5, [128]), nativeReply(1, 83));
  delete runtime.services.variableExpressionContext;
  const inherited = Object.create(Object.getPrototypeOf(runtime.services), {
    variableExpressionContext: {
      get() {
        throw new Error('inherited service must not be consumed');
      },
    },
  });
  Object.setPrototypeOf(runtime.services, inherited);
  assert.deepEqual(call(0xd5, [128]), nativeReply(1, 83));
  Object.defineProperty(runtime.services, 'variableExpressionContext', {
    enumerable: true,
    get() {
      throw new Error('owned service failure');
    },
  });
  assert.throws(
    () => call(0xd5, [128]),
    (error) => error.details.id === 0xd5 && error.message === 'owned service failure',
  );

  const live = await runtimeFor();
  live.call(0xd1, [16]);
  const selectBank = live.runtime.variableBank;
  live.runtime.variableBank = function (...args) {
    this.profile = 'replaced-by-bank-selection';
    return Reflect.apply(selectBank, this, args);
  };
  assert.deepEqual(
    live.call(0x262, []),
    nativeReply(2),
    'profile is captured before bank selection callbacks',
  );
  assert.equal(live.runtime.profile, 'replaced-by-bank-selection');
});

test('raw dictionaries use the current handle provider once while guest memory may replace it reentrantly', async () => {
  const { runtime, task, call } = await runtimeFor(),
    m = task.machine;
  m.writeString('key', 128);
  const first = runtime.handles,
    second = runtime.createHandles(),
    make = (handles, value) => {
      runtime.services.handles = handles;
      const handle = call(0x203, []).value;
      call(0x205, [handle, 128, value]);
      return handle;
    },
    a = make(first, 17),
    b = make(second, 91);
  assert.equal(a, b, 'same numeric handle in independent providers exposes stale-provider reuse');
  let current = first,
    reads = 0;
  Object.defineProperty(runtime.services, 'handles', {
    configurable: true,
    enumerable: true,
    get() {
      reads++;
      return current;
    },
  });
  const load = m.load;
  m.load = function (...args) {
    current = second;
    return Reflect.apply(load, this, args);
  };
  assert.deepEqual(call(0x206, [a, 128]), nativeReply(1, 17));
  assert.deepEqual(call(0x206, [b, 128]), nativeReply(1, 91));
  assert.equal(reads, 2);
  call(0x204, [b]);
  assert.throws(
    () => call(0x206, [b, 128]),
    (error) => error.details.id === 0x206 && /released/.test(error.message),
  );
  assert.deepEqual(call(0x206, [0, 128]), nativeReply(1, 0xffffffff));
});

test('replaced service containers retain full fallback; barriers, registration and asynchronous retry keep their order', async () => {
  const { runtime, task, call } = await runtimeFor(),
    m = task.machine,
    events = [];
  m.writeString('a b', 128);
  const original = runtime.services;
  let fallbackReads = 0;
  runtime.services = new Proxy(
    {
      ...original,
      get unrelated() {
        fallbackReads++;
        return 1;
      },
    },
    {},
  );
  assert.deepEqual(call(0x207, [256, 128, 1]), nativeReply(1, 1));
  assert.equal(fallbackReads, 1);
  const other = await runtimeFor();
  Object.defineProperty(other.runtime.services, 'unrelated', {
    enumerable: true,
    get() {
      fallbackReads++;
      return 1;
    },
  });
  runtime.services = other.runtime.services;
  assert.deepEqual(call(0x207, [256, 128, 1]), nativeReply(1, 1));
  assert.equal(fallbackReads, 2, 'another runtime owns a different service container');
  runtime.services = original;
  runtime.textPublicationBarrier = () => {
    events.push('barrier');
    return Promise.resolve().then(() => {
      runtime.textPublicationBarrier = null;
      events.push('settled');
    });
  };
  m.store(256, 0xaa, 1);
  const pending = call(0x207, [256, 128, 1]);
  assert.equal(
    m.load(256, 1),
    0xaa,
    'pending publication settles before even the destination clear',
  );
  assert.deepEqual(await pending, nativeReply(1, 1));
  assert.deepEqual(events, ['barrier', 'settled']);
  assert.equal(m.string(256), 'b');
  let effects = 0;
  runtime.register('main', 0x207, async () => {
    effects++;
    return nativeReply(1, -1);
  });
  m.start();
  assert.deepEqual(await call(0x207, []), nativeReply(1, 0xffffffff));
  assert.equal(
    effects,
    1,
    'registered handlers take precedence over the built-in route and its arity',
  );
  await assert.rejects(
    async () => call(467, []),
    (error) => error.name === 'UnsupportedKCSNative',
  );

  const instructions = [[37, 256], [37, 128], [37, 1], [43, 0x207, 12], [59]],
    fresh = await runtimeFor(instructions, [[128, 'a b']]);
  fresh.runtime.register('main', 0x207, async (args, machine) => {
    effects++;
    await Promise.resolve();
    machine.store(args[0], 73);
    return nativeReply(1, 19);
  });
  await fresh.runtime.scheduler.execute(fresh.task);
  assert.equal(effects, 2);
  assert.equal(fresh.task.machine.pop(), 19);
  assert.equal(fresh.task.machine.load(256), 73);
});
