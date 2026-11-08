// SPDX-License-Identifier: MPL-2.0
// Executes the original five main wrappers, queue, list sort, age, threshold
// and worker. Formatting, category resolution, file I/O and OS locks/events
// are explicit boundaries; the queue/list algorithms are not substituted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeResourceCache, nativeResourceCache } from '../src/native/resource-cache.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-resource-cache.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Resource cache oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk-'),
  f = sdk
    ? {
        main: 0xb3c900,
        global: 0xc94630,
        list: 0x1350c,
        exit: 0x13510,
        progress: 0x13518,
        enabled: 0x1351c,
        nodeBytes: 288,
        data: 268,
        lifetime: 272,
        priority: 276,
        type: 280,
        loaded: 284,
        clear: 0x4b0950,
        queue: 0x4b05c0,
        start: 0x4b2b70,
        age: 0x4b10b0,
        complete: 0x4b13b0,
        worker: 0x4b1ba0,
        lock: 0x4b7a10,
        unlock: 0x4b7aa0,
        signal: 0x4b7b80,
        reset: 0x4b7b00,
        wait: 0x4b7c50,
        resolve: 0x4b0830,
        format: 0x8a6510,
        read: 0x4b1410,
        release: 0x4b0a30,
      }
    : {
        main: 0xa2dd38,
        global: 0xb8fb08,
        list: 156176,
        exit: 156180,
        progress: 156188,
        enabled: 156192,
        nodeBytes: 548,
        data: 528,
        lifetime: 532,
        priority: 536,
        type: 540,
        loaded: 544,
        clear: 0x5d3c80,
        queue: 0x5d36d0,
        start: 0x5d61c0,
        age: 0x5d4410,
        complete: 0x5d4700,
        worker: 0x5d4ff0,
        lock: 0x5db550,
        unlock: 0x5db5e0,
        signal: 0x5db6c0,
        reset: 0x5db640,
        wait: 0x5db790,
        resolve: 0x5d39e0,
        format: 0x876ea0,
        read: 0x5d47c0,
        release: 0x5d3d60,
      },
  engine = await NativeEngineProcess.open({ bytes, profile, trace: true }),
  p = engine.process,
  owner = p.allocate(f.enabled + 4, true),
  list = p.allocate(8, true),
  sentinel = p.allocate(f.nodeBytes, true),
  parameters = p.allocate(16, true),
  result = p.allocate(4, true),
  memory = p.allocate(4096, true),
  vm = p.allocate(1400, true),
  fileObjects = new Map();
let passed = 0,
  sourceReads = [],
  originalReads = [],
  originalReadProgress = [],
  originalSteps = [],
  modelSteps = [],
  stopWorker = true;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
const cp = (at) => p.string(at, false),
  wide = (at) => p.string(at, true);
const content = (name) => (name === 'missing' ? null : encodeCP932(name));
const sourceRead = async (name) => {
  sourceReads.push(name);
  modelSteps.push(cache.progress);
  return content(name);
};
const cache = new NativeResourceCache({ read: sourceRead }),
  services = {
    resourceCache: cache,
    format: (offset) => cp(memory + offset),
    resourceFilename: (name) => name,
  },
  machine = {};
p.store(list, sentinel);
p.store(sentinel, sentinel);
p.store(sentinel + 4, sentinel);
p.store(owner + f.list, list);
p.store(owner + f.enabled, 1);
p.store(f.global, owner);
for (const address of [f.lock, f.unlock, f.signal, f.reset])
  engine.patch(address, 'resource cache OS mutex/event boundary', 1, () => 1, { calleePops: true });
engine.patch(
  f.wait,
  'resource cache OS wait boundary',
  2,
  () => {
    originalSteps.push(p.load(owner + f.progress) | 0);
    if (stopWorker) p.store(owner + f.exit, 1);
    return 0;
  },
  { calleePops: true },
);
engine.patch(
  f.format,
  'KCS formatting boundary',
  2,
  ([offset, out]) => {
    p.write(out, p.stringBytes(memory + offset, false, true));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  f.resolve,
  'resource category path boundary',
  3,
  ([out, name]) => {
    p.write(out, p.stringBytes(name, false, true));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  f.read,
  'mounted-file reader boundary',
  2,
  ([name, flags]) => {
    const text = sdk ? cp(name) : wide(name),
      data = content(text);
    originalReads.push([text, flags]);
    originalReadProgress.push(p.load(owner + f.progress) | 0);
    if (data === null) return 0;
    const object = p.allocate(20, true),
      at = p.allocate(Math.max(1, data.length), true);
    p.write(at, data);
    p.store(object, at);
    p.store(object + 4, data.length);
    fileObjects.set(object, at);
    return object;
  },
  { calleePops: true },
);
engine.patch(
  f.release,
  'cached resource release boundary',
  1,
  ([object]) => {
    if (!fileObjects.has(object)) throw new Error('Native cache released an unknown resource');
    p.free(fileObjects.get(object));
    fileObjects.delete(object);
    p.free(object);
    return 1;
  },
  { calleePops: true },
);

const snapshot = () => {
  const entries = [];
  for (let node = p.load(sentinel); node !== sentinel; node = p.load(node)) {
    if (entries.length > 512) throw new Error('Original preload list is cyclic');
    const resource = p.load(node + f.data);
    entries.push({
      filename: sdk ? cp(node + 8) : wide(node + 8),
      lifetime: p.load(node + f.lifetime) | 0,
      priority: p.load(node + f.priority) | 0,
      type: p.load(node + f.type),
      loaded: p.load(node + f.loaded),
      bytes: resource ? [...p.read(p.load(resource), p.load(resource + 4))] : null,
    });
  }
  check(entries.length, p.load(list + 4), 'list count');
  return { entries, progress: p.load(owner + f.progress) | 0, enabled: p.load(owner + f.enabled) };
};
const compareState = (label) => {
  const expected = cache.snapshot();
  expected.entries = expected.entries.map((e) => ({ ...e, bytes: e.bytes ? [...e.bytes] : null }));
  check(snapshot(), expected, label);
};
const rawCall = async (id, args = []) => {
  args.forEach((v, i) => p.store(parameters + i * 4, v));
  p.store(result, 0x6ad5b31c);
  const control = await engine.call(p.load(f.main + id * 4), [vm, 0, parameters, result]);
  check(control, id === 0x1b5 ? 1 : 2, `wrapper ${id.toString(16)} control`);
  if (id !== 0x1b5) check(p.load(result), 0x6ad5b31c, `wrapper ${id.toString(16)} leaves output`);
  return p.load(result);
};
const call = async (id, args = []) => {
  const actual = await rawCall(id, args),
    reply = await nativeResourceCache(id, args, machine, services);
  if (id === 0x1b5) check(actual, reply.value, 'threshold result');
};
const queue = async (name, age, type = 3) => {
  p.write(memory + 32, Uint8Array.from([...encodeCP932(name), 0]));
  p.write(memory + 1024, Uint8Array.from([...encodeCP932('authored-category'), 0]));
  if (type === 3) await call(0x1b3, [32, 1024, age >>> 0]);
  else {
    const namePointer = p.allocate(600, true);
    p.write(
      namePointer,
      sdk
        ? Uint8Array.from([...encodeCP932(name), 0])
        : Uint8Array.from(
            [...name]
              .flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >>> 8])
              .concat([0, 0]),
          ),
    );
    try {
      check(await engine.call(f.queue, [namePointer, age >>> 0, type], owner), 1, 'queue helper');
      await cache.queue(name, age, type);
    } finally {
      p.free(namePointer);
    }
  }
  compareState(`queue ${name}/${age}`);
};
const runWorker = async () => {
  await rawCall(0x1b4);
  originalReads = [];
  originalReadProgress = [];
  originalSteps = [];
  sourceReads = [];
  modelSteps = [];
  do {
    p.store(owner + f.exit, 0);
    await engine.call(f.worker, [0, owner]);
  } while (p.load(owner + f.progress) !== 0x7fffffff);
  await cache.start();
  await cache.settle();
  check(
    originalReads.map(([name]) => name),
    sourceReads,
    'worker read order',
  );
  check(originalReadProgress, modelSteps, 'worker progress at each file boundary');
  for (const [, flags] of originalReads) check(flags, 3 | 0x110, 'worker read flags');
  compareState('worker complete');
};

try {
  compareState('initial');
  for (const enabled of [0, 1, 0xffffffff]) {
    cache.enabled = enabled;
    p.store(owner + f.enabled, enabled);
    for (const progress of [0, 1, -1, 0x7fffffff, -0x80000000, -34, 23]) {
      cache.progress = progress;
      p.store(owner + f.progress, progress);
      for (const threshold of [0, 1, -1, 0x7fffffff, -0x80000000, -35, 24])
        await call(0x1b5, [threshold >>> 0]);
    }
    await call(0x1b2);
    compareState('clear enabled');
    if (!enabled) {
      await queue('disabled', 2);
      await call(0x1b6);
      compareState('disabled age');
      await call(0x1b4);
      await cache.settle();
      compareState('disabled start');
    }
  }
  cache.enabled = 1;
  p.store(owner + f.enabled, 1);
  for (const [i, age] of [5, 2, 2, -1, -0x80000000, 0x7fffffff, 0, -2, 2, 17].entries())
    await queue('file' + i, age);
  await queue('FILE0', 9, 99);
  await queue('日本語', 4);
  const originalWake = cache.wake;
  cache.wake = () => {};
  await rawCall(0x1b4);
  await cache.start();
  compareState('signed stable sort');
  cache.wake = originalWake;
  await runWorker();
  await queue('missing', -1);
  await queue('file0', 0);
  await call(0x1b6);
  compareState('age removes negative, preserves INT_MIN wrap');
  await runWorker();
  for (let n = 0; n < 32; n++) {
    await queue('entry' + n, [0, 1, -1, -0x80000000, 0x7fffffff, 17][n % 6]);
    if (n % 5 === 4) {
      await rawCall(0x1b4);
      cache.wake = () => {};
      await cache.start();
      cache.wake = originalWake;
      compareState('random stable sort');
    }
    if (n % 7 === 6) {
      await call(0x1b6);
      compareState('random age');
    }
  }
  await runWorker();
  await call(0x1b2);
  compareState('final clear');
  check(fileObjects.size, 0, 'all cache resources released');
  console.log(`Native resource cache passed ${passed}/${passed}`);
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Both original queue/list/sort/age/threshold/worker and all five main wrappers. OS synchronization, formatting, category resolution and mounted-file I/O are explicit boundaries.',
        patches: engine.patches,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await cache.close();
  await engine.close();
}
