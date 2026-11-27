// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createNativePortMatcher } from '../src/render/port-reflection.mjs';

const object = Object,
  array = Array,
  reflect = Reflect,
  define = object.defineProperty,
  own = object.getOwnPropertyDescriptor,
  all = object.getOwnPropertyDescriptors,
  apply = reflect.apply;
function fixture() {
  const instances = new WeakSet();
  class Port {
    constructor() {
      instances.add(this);
    }
    get drawingBufferWidth() {
      if (!instances.has(this)) throw new TypeError('not the test platform object');
      return 8;
    }
    upload() {}
  }
  // Large method sets are ordinary qualifier input, not a timing benchmark.
  for (let i = 0; i < 500; i++)
    define(Port.prototype, `method${i}`, { configurable: true, writable: true, value() {} });
  const rows = [[Port.prototype, all(Port.prototype)]],
    receiver = new Port(),
    match = createNativePortMatcher(rows, 'drawingBufferWidth');
  const legacy = (value) =>
    rows.every(([prototype, descriptors]) =>
      Reflect.ownKeys(descriptors).every((key) => {
        const current = Object.getOwnPropertyDescriptor(prototype, key),
          expected = descriptors[key];
        return (
          !Object.hasOwn(value, key) &&
          current?.value === expected.value &&
          current?.get === expected.get &&
          current?.set === expected.set
        );
      }),
    );
  return { Port, rows, receiver, match, legacy };
}

test('one complete live check preserves every member and does not retain qualification', async () => {
  const f = fixture();
  assert.equal(f.match(f.receiver), true);
  assert.equal(f.legacy(f.receiver), true);
  const descriptor = own(f.Port.prototype, 'method499');
  try {
    await Promise.resolve();
    define(f.Port.prototype, 'method499', { ...descriptor, value() {} });
    assert.equal(f.match(f.receiver), false);
    assert.equal(f.legacy(f.receiver), false);
  } finally {
    define(f.Port.prototype, 'method499', descriptor);
  }
  assert.equal(f.match(new f.Port()), true);
  assert.equal(f.match(f.receiver), true);
  define(f.receiver, 'upload', { configurable: true, value() {} });
  assert.equal(f.match(f.receiver), false);
  assert.equal(f.legacy(f.receiver), false);
  delete f.receiver.upload;
  assert.equal(f.match(f.receiver), true);
});

test('own/accessor fields are not invoked and descriptor flags keep the original predicate', () => {
  const f = fixture();
  let calls = 0;
  define(f.receiver, 'unrelated', {
    configurable: true,
    get() {
      calls++;
      throw Error('getter');
    },
  });
  assert.equal(f.match(f.receiver), true);
  assert.equal(calls, 0);
  define(f.receiver, 'upload', {
    configurable: true,
    get() {
      calls++;
      throw Error('getter');
    },
  });
  assert.equal(f.match(f.receiver), false);
  assert.equal(f.legacy(f.receiver), false);
  assert.equal(calls, 0);
  delete f.receiver.upload;
  const original = own(f.Port.prototype, 'upload');
  try {
    define(f.Port.prototype, 'upload', { ...original, enumerable: !original.enumerable });
    assert.equal(f.match(f.receiver), f.legacy(f.receiver));
    define(f.Port.prototype, 'upload', {
      configurable: true,
      get() {
        calls++;
        throw Error('getter');
      },
    });
    assert.equal(f.match(f.receiver), false);
    assert.equal(calls, 0);
  } finally {
    define(f.Port.prototype, 'upload', original);
  }
});

test('a Proxy receiver selects the original path without new ownKeys or descriptor traps', () => {
  const f = fixture(),
    events = [];
  const proxy = new Proxy(f.receiver, {
    ownKeys(target) {
      events.push('keys');
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      events.push(String(key));
      return own(target, key);
    },
  });
  assert.equal(f.match(proxy), null);
  assert.deepEqual(events, []);
  const original = f.legacy(proxy),
    calls = events.slice();
  events.length = 0;
  assert.equal(f.match(proxy) ?? f.legacy(proxy), original);
  assert.deepEqual(events, calls);
  const failure = new Proxy(f.receiver, {
    getOwnPropertyDescriptor() {
      throw new Error('original descriptor failure');
    },
  });
  assert.equal(f.match(failure), null);
  assert.throws(() => f.legacy(failure), /original descriptor failure/);
  assert.throws(() => f.match(failure) ?? f.legacy(failure), /original descriptor failure/);
});

test('an authentic model from another prototype realm keeps the original outer rejection', () => {
  const f = fixture(),
    Foreign = runInNewContext('(Base) => class Foreign extends Base {}')(f.Port),
    receiver = new Foreign();
  assert.equal(f.match(receiver), null);
  // nativeTextureConsumer retains this exact outer prototype gate.
  assert.notEqual(object.getPrototypeOf(receiver), f.Port.prototype);
});

test('changed receiver or ancestor prototypes never bulk-read a new Proxy prototype', () => {
  const f = fixture();
  let traps = 0;
  const proxy = new Proxy(object.prototype, {
    ownKeys() {
      traps++;
      throw Error('unexpected ownKeys');
    },
    getOwnPropertyDescriptor() {
      traps++;
      throw Error('unexpected descriptor');
    },
  });
  const original = object.getPrototypeOf(f.Port.prototype);
  try {
    object.setPrototypeOf(f.Port.prototype, proxy);
    assert.equal(f.match(f.receiver), null);
    assert.equal(traps, 0);
  } finally {
    object.setPrototypeOf(f.Port.prototype, original);
  }
  try {
    object.setPrototypeOf(f.receiver, proxy);
    assert.equal(f.match(f.receiver), null);
    assert.equal(traps, 0);
  } finally {
    object.setPrototypeOf(f.receiver, f.Port.prototype);
  }
});

test('extra interface ancestors keep the original path before any bulk inspection', () => {
  const f = fixture();
  let traps = 0;
  const extra = new Proxy(
    {},
    {
      ownKeys() {
        traps++;
        throw Error('extra ancestor');
      },
    },
  );
  const match = createNativePortMatcher([...f.rows, [extra, {}]], 'drawingBufferWidth');
  assert.equal(match(f.receiver), null);
  const original = object.getPrototypeOf(f.Port.prototype);
  try {
    object.setPrototypeOf(f.Port.prototype, extra);
    assert.equal(createNativePortMatcher(f.rows, 'drawingBufferWidth')(f.receiver), null);
  } finally {
    object.setPrototypeOf(f.Port.prototype, original);
  }
  assert.equal(traps, 0);
});

test('deleted snapshot keys do not resolve inherited accessors', () => {
  const f = fixture(),
    descriptor = own(f.Port.prototype, 'method4');
  let calls = 0;
  delete f.Port.prototype.method4;
  assert.equal(f.match(f.receiver), false);
  try {
    define(object.prototype, 'method4', {
      configurable: true,
      get() {
        calls++;
        throw Error('inherited');
      },
    });
    assert.equal(f.match(f.receiver), null);
    assert.equal(f.match(f.receiver) ?? f.legacy(f.receiver), false);
  } finally {
    delete object.prototype.method4;
    define(f.Port.prototype, 'method4', descriptor);
  }
  assert.equal(calls, 0);
});

test('a replaced brand getter is not called and an unavailable getter uses the old path', () => {
  const f = fixture(),
    descriptor = own(f.Port.prototype, 'drawingBufferWidth');
  let calls = 0;
  try {
    define(f.Port.prototype, 'drawingBufferWidth', {
      configurable: true,
      get() {
        calls++;
        return 8;
      },
    });
    assert.equal(f.match(f.receiver), null);
    assert.equal(f.legacy(f.receiver), false);
  } finally {
    define(f.Port.prototype, 'drawingBufferWidth', descriptor);
  }
  assert.equal(calls, 0);
  assert.equal(createNativePortMatcher(f.rows, 'absentGetter')(f.receiver), null);
});

for (const kind of ['descriptor', 'bulk', 'ownKeys', 'every', 'iterator']) {
  test(`replaced ${kind} reflection port retains the original callback sequence`, () => {
    const f = fixture(),
      events = [];
    const [target, key] =
      kind === 'descriptor'
        ? [object, 'getOwnPropertyDescriptor']
        : kind === 'bulk'
          ? [object, 'getOwnPropertyDescriptors']
          : kind === 'ownKeys'
            ? [reflect, 'ownKeys']
            : [array.prototype, kind === 'every' ? 'every' : Symbol.iterator];
    const descriptor = own(target, key),
      original = descriptor.value;
    let baseline, candidate, first, second;
    try {
      define(target, key, {
        ...descriptor,
        value: function (...args) {
          events.push(kind);
          return apply(original, this, args);
        },
      });
      baseline = f.legacy(f.receiver);
      first = events.slice();
      events.length = 0;
      candidate = f.match(f.receiver) ?? f.legacy(f.receiver);
      second = events.slice();
    } finally {
      define(target, key, descriptor);
    }
    assert.equal(candidate, baseline);
    assert.deepEqual(second, first);
  });
}

for (const key of ['Object', 'Array', 'Reflect']) {
  test(`a replaced ${key} namespace accessor is observed only by the old path`, () => {
    const f = fixture(),
      descriptor = own(globalThis, key),
      original = descriptor.value;
    let callbacks = 0,
      first,
      second;
    try {
      define(globalThis, key, {
        configurable: true,
        get() {
          callbacks++;
          return original;
        },
      });
      f.legacy(f.receiver);
      first = callbacks;
      callbacks = 0;
      const result = f.match(f.receiver);
      if (result === null) f.legacy(f.receiver);
      second = callbacks;
    } finally {
      define(globalThis, key, descriptor);
    }
    assert.equal(second, first);
  });
}

test('an extra Array prototype accessor disables batching without invoking that accessor', () => {
  const f = fixture();
  let calls = 0,
    matched;
  try {
    define(array.prototype, '10000', {
      configurable: true,
      get() {
        calls++;
        throw Error('array index');
      },
    });
    matched = f.match(f.receiver);
  } finally {
    delete array.prototype[10000];
  }
  assert.equal(matched, null);
  assert.equal(calls, 0);
});

test('descriptor-field prototype getters remain on the original fallback only', () => {
  const f = fixture();
  let callbacks = 0,
    first,
    second;
  try {
    define(object.prototype, 'get', {
      configurable: true,
      get() {
        callbacks++;
        return undefined;
      },
    });
    f.legacy(f.receiver);
    first = callbacks;
    callbacks = 0;
    const matched = f.match(f.receiver);
    if (matched === null) f.legacy(f.receiver);
    second = callbacks;
  } finally {
    delete object.prototype.get;
  }
  assert(first > 0);
  assert.equal(second, first);
});
