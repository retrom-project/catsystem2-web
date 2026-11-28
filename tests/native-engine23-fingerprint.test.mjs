// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { readKCS, floatBits } from '../src/kcs.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { AuthoredClipboard } from './fixtures/unicode-output-services.mjs';
import { hg3, kcsProgram, memoryGame } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const caller = 'sdk-call.kcs';
const sentinel = 0xe8a7b319;

async function guest(code, { services = {}, initial = () => {} } = {}) {
  const bytes = kcsProgram([[37, sentinel], ...code, [59]]);
  const runtime = new NativeRuntime({ profile, read: async () => bytes, services });
  const task = await runtime.spawn(caller);
  initial(task.machine);
  return { task, runtime };
}

async function result(code, options) {
  const { task, runtime } = await guest(code, options);
  await runtime.tick();
  const { machine } = task;
  assert.equal(task.status, 'finished');
  assert.equal(machine.sp, machine.floor + 8, 'control 1 pushes exactly one word');
  const value = machine.pop();
  assert.equal(machine.pop(), sentinel);
  return value;
}

test('fixed 2.6.1.23 clock wrapper returns the current DWORD and handles rollover', async () => {
  const entry = nativeABI(profile).tables.main.entries[4];
  assert.equal(entry.signature.argumentWords, 0);
  assert.equal(entry.signature.resultWritten, true);
  let now = 0xfffffff0;
  const clock = new NativeSystemClock({ now: () => now });
  const services = { clock: () => clock.now() };
  assert.equal(await result([[43, 4, 0]], { services }), 0xfffffff0);
  now = 0x23;
  assert.equal(await result([[43, 4, 0]], { services }), 0x23);
});

test('fixed 2.6.1.23 integer parser consumes a CP932 format string from the guest frame', async () => {
  const entry = nativeABI(profile).tables.main.entries[25];
  assert.equal(entry.signature.argumentWords, 1);
  assert.equal(entry.signature.resultWritten, true);
  assert.deepEqual(entry.parameters[0].type, {
    addressSpace: 'vm',
    direction: 'in',
    kind: 'pointer',
    target: { kind: 'format-string', encoding: 'CP932' },
  });
  const cases = [
    ['-0xabcDtail', 0xffff5433],
    ['0X80invalid', 128],
    ['42.5', 0],
    [' 7', 0],
    ['4294967297', 1],
    ['0xFFFFFFFF', 0xffffffff],
    ['-2147483648', 0x80000000],
    ['+106;', 106],
    ['12日', 12],
    ['１２', 0],
    ['1e3', 1],
  ];
  for (const [text, word] of cases)
    assert.equal(
      await result(
        [
          [61, 256],
          [43, 25, 4],
        ],
        {
          initial: (machine) => machine.writeString(text, machine.fp + 256),
        },
      ),
      word,
      text,
    );
  assert.equal(
    await result(
      [
        [61, 256],
        [43, 25, 4],
      ],
      {
        initial: (machine) => {
          machine.store(128, 9);
          machine.writeString('-%d[G128]', machine.fp + 256);
        },
      },
    ),
    0xfffffff7,
  );
});

test('fixed 2.6.1.23 weekday uses signed century arithmetic from three guest words', async () => {
  const entry = nativeABI(profile).tables.main.entries[786];
  assert.equal(entry.signature.argumentWords, 3);
  assert.equal(entry.signature.resultWritten, true);
  const cases = [
    [2000, 2, 29, 2],
    [1900, 3, 1, -3],
    [2026, 11, 24, 2],
    [-1, 1, 1, 6],
    [0, 1, 1, 0],
    [-444, 11, 0, -4],
    [99999999, 1, 1, -2],
    [1, -1, -20, 3],
    [0x7fffffff, 0x7fffffff, 0x7fffffff, 5],
    [-0x80000000, -0x80000000, -0x80000000, 5],
  ];
  for (const [year, month, day, word] of cases)
    assert.equal(
      await result([...[64, 68, 72].map((address) => [37, [0x13, address]]), [43, 786, 12]], {
        initial: (machine) => {
          machine.store(64, year);
          machine.store(68, month);
          machine.store(72, day);
        },
      }),
      word >>> 0,
      [year, month, day].join('/'),
    );
});

test('fixed 2.6.1.23 clock, integer and weekday check arity and mapped string addresses', async () => {
  const cases = [
    [4, [0], /expects 0 arguments/],
    [25, [], /expects 1 arguments/],
    [25, [0xffffffff], /KCS memory ffffffff/],
    [786, [2026, 11], /expects year, month and day/],
  ];
  for (const [id, args, error] of cases) {
    const { runtime, task } = await guest([
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
    ]);
    await assert.rejects(runtime.tick(), error);
    assert.equal(task.status, 'failed');
    assert.equal(task.machine.sp, task.machine.floor + 4);
    assert.equal(task.machine.pop(), sentinel);
  }
});

const call = (id, args) => [...args.map((arg) => [37, arg]), [43, id, args.length * 4]];
const storeResult = (address) => [38, [0x13, address]];

function renderWorld(files = {}) {
  const game = memoryGame(files),
    random = new ParticleRandom();
  return new NativeWorld({
    profile,
    game,
    random,
    host: {},
    images: {},
    configuration: new NativeConfiguration({ profile }),
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
}

async function runRenderGuest(world, source, setup) {
  const program = await readKCS(kcsProgram([[37, sentinel], ...source, [59]]));
  const task = world.runtime.scheduler.add(program, {
    name: 'sdk-bitmap.kcs',
    abi: 'main',
  });
  setup?.(task);
  for (let frame = 0; frame < 20 && task.status !== 'finished'; frame++) await world.runtime.tick();
  assert.equal(task.status, 'finished');
  assert.equal(task.machine.sp, task.machine.floor + 4);
  assert.equal(task.machine.pop(), sentinel);
  return task;
}

test('fixed 2.6.1.23 KCS clipboard preserves CP932 formatting and the host denial path', async (t) => {
  const world = renderWorld(),
    clipboard = new AuthoredClipboard();
  t.after(() => world.close({ flushFiles: false }));
  world.runtime.services.nativeClipboard = clipboard;
  for (const [input, expected] of [
    ['日本語\\n%d[G192]', '日本語\r\n-41'],
    ['ソnZ', '\ufffd\r\nZ'],
    ['', ''],
  ]) {
    const { machine } = await runRenderGuest(world, call(10, [256]), ({ machine }) => {
      machine.store(192, -41);
      machine.writeString(input, 256);
    });
    assert.equal(machine.string(256), input);
    assert.equal(clipboard.contents, expected);
    assert.deepEqual(clipboard.events, [
      ['open', world.window.handle],
      ['empty'],
      ['write', expected],
      ['close'],
    ]);
    clipboard.events.length = 0;
  }
  clipboard.available = false;
  await runRenderGuest(world, call(10, [0]));
  assert.deepEqual(clipboard.events, [['open', world.window.handle]]);
  clipboard.events.length = 0;
  await assert.rejects(runRenderGuest(world, call(10, [0xffffffff])), /KCS memory/);
  assert.deepEqual(clipboard.events, []);
});

test('fixed 2.6.1.23 KCS recording keeps a bounded CP932 prefix and reserves only captured frames', async (t) => {
  const world = renderWorld(),
    capture = world.screenCapture,
    written = [];
  t.after(() => world.close({ flushFiles: false }));
  const prefix = '記録',
    set = (name, enabled, counter) =>
      runRenderGuest(
        world,
        [
          ...call(441, [enabled, 256, counter]),
          ...call(565, []),
          storeResult(512),
          ...call(566, []),
          storeResult(516),
        ],
        ({ machine }) => machine.writeString(name, 256),
      );
  const task = await set(prefix, 0x80000000, 0xffffffff);
  assert.deepEqual([task.machine.load(512), task.machine.load(516)], [0x80000000, 0xffffffff]);
  capture.frame = () => null;
  await capture.afterPresent();
  assert.equal(capture.state.counter, 0xffffffff);
  const rgba = Uint8Array.of(0x17, 0x29, 0x3b, 0x4d, 0x51, 0x62, 0x73, 0x84);
  capture.frame = () => ({ width: 2, height: 1, rgba });
  world.storage.write = async (name, bytes) => {
    assert.equal(capture.state.counter, 0, 'the view increments before virtual file I/O');
    written.push([name, bytes]);
    return false;
  };
  await capture.afterPresent();
  assert.equal(capture.state.counter, 0);
  const [[name, bytes]] = written,
    header = new DataView(bytes.buffer);
  assert.equal(name, '記録/記録_-000000001.bmp');
  assert.equal(header.getUint16(28, true), 32);
  assert.deepEqual(bytes.slice(54), Uint8Array.of(0x3b, 0x29, 0x17, 0x4d, 0x73, 0x62, 0x51, 0x84));
  await set('字'.repeat(15) + 'Z', 0, 17);
  const stable = capture.snapshot();
  await assert.rejects(set('字'.repeat(16), 1, 203), /prefix exceeds/);
  assert.deepEqual(capture.snapshot(), stable);
  await capture.afterPresent();
  assert.equal(written.length, 1);
});

test('fixed 2.6.1.23 MOT filename GCALL resolves the formatted narrow name and resets working state', async () => {
  const motion = kcsProgram([[59]]);
  const world = renderWorld({
    'owned-7.kcs': motion,
    'folder/other.kcs': motion,
    'ヂ.kcs': motion,
    'ダミーソ.kcs': motion,
  });
  const resource = { name: 'mot', extension: 'kcs', directory: '' };
  const registry = world.runtime.services.motion;
  const game = registry.library.game;
  game.nativeResources = {
    entries: [resource],
    resolve: (name) => (name.includes('.') ? name : name + '.kcs'),
  };
  game.readCategory = (name) => game.read(name.includes('.') ? name : name + '.kcs');
  const handle = registry.create(42);
  const manager = registry.get(handle);
  async function query(name, owner = handle) {
    manager.working.fill(0x71);
    const task = await runRenderGuest(
      world,
      [...call(514, [owner, 256]), storeResult(512)],
      ({ machine }) => {
        machine.writeString(name, 256);
        machine.store(768, 7);
        machine.store(508, sentinel);
        machine.store(516, sentinel);
      },
    );
    assert.deepEqual([task.machine.load(508), task.machine.load(516)], [sentinel, sentinel]);
    assert.deepEqual(manager.working, owner ? manager.base : new Uint8Array(144).fill(0x71));
    return task.machine.load(512);
  }
  try {
    assert.equal(nativeABI(profile).tables.main.entries[514].signature.argumentWords, 2);
    assert.equal(await query('owned-7', 0), 0);
    assert.equal(await query('owned-7'), 0);
    for (const filename of ['owned-%d[G768]', 'folder/other.kcs', 'ヂ', 'ダミーソ']) {
      const task = await runRenderGuest(
        world,
        [...call(304, [handle, 256, 0, 0, 0, 0, 9]), storeResult(512)],
        ({ machine }) => {
          machine.writeString(filename, 256);
          machine.store(768, 7);
        },
      );
      assert.ok(task.machine.load(512));
    }
    for (const [name, expected] of [
      ['owned-%d[G768]', 1],
      ['OWNED-7.KCS', 1],
      ['other', 1],
      ['folder/other.kcs', 0],
      ['folder\\other.kcs', 0],
      ['owned-7.mot', 0],
      ['ア', 1], // The original C-locale comparison folds the CP932 trail byte too.
      ['ダミーソ', 0],
      ['.kcs', 1], // The old record setter treats the CP932 trail 0x5c as a path separator.
    ])
      assert.equal(await query(name), expected, name);
    resource.archive = 'motions';
    assert.equal(await query('owned-7'), 0);
    assert.equal(await query('motions/owned-7.kcs'), 0);
    assert.equal(manager.records.size, 4);
  } finally {
    await world.close();
  }
});

test('fixed 2.6.1.23 image warmup caches decoded pixels and releases temporary owners', async (t) => {
  const pixels = Uint8ClampedArray.of(51, 17, 3, 255, 202, 176, 128, 0);
  const world = renderWorld({ '薄-2.hg3': hg3(2, 1, pixels) });
  t.after(() => world.close());
  world.game.resolveCategory = (name, category) => {
    assert.equal(category, 'image');
    return name.includes('.') ? name : name + '.hg3';
  };
  const reads = [];
  const read = world.game.read.bind(world.game);
  world.game.read = (file) => {
    reads.push(file);
    return read(file);
  };
  const images = world.graphics.images;
  for (const [name, readFiles] of [
    ['薄-%d[G768]', ['薄-2.hg3']],
    ['薄-2', ['薄-2.hg3']],
    ['missing', ['薄-2.hg3', 'missing.hg3']],
  ]) {
    const task = await runRenderGuest(world, call(681, [256]), ({ machine }) => {
      machine.writeString(name, 256);
      machine.store(768, 2);
      machine.store(772, sentinel);
    });
    assert.equal(task.machine.load(772), sentinel);
    assert.deepEqual(reads, readFiles);
    assert.deepEqual([...images.assets.keys()], ['薄-2:0']);
    assert.deepEqual(images.assets.get('薄-2:0').rgba, pixels);
    assert.ok(
      [...world.runtime.handles.records.values()].every(
        ({ type }) => type !== 'bitmap' && type !== 'bitmap-data',
      ),
    );
  }
});

test('fixed 2.6.1.23 image rotations and reflections update retained pixels and geometry', async (t) => {
  const world = renderWorld();
  t.after(() => world.close());
  const { imageOwners: owners, graphics } = world;
  const pixels = (indices) =>
    Uint8ClampedArray.from(indices.flatMap((i) => [i * 9, i * 13, i * 27, 255 - i * 17]));
  for (const [native, mode, order, size, canvas, offsets, base, clip] of [
    [723, 0, [1, 2, 3, 4, 5, 6], [2, 3], [9, 12], [2, -4], [5, -3], [1, 1, 2, 3]],
    [723, 90, [2, 4, 6, 1, 3, 5], [3, 2], [12, 9], [13, 2], [15, 5], [0, 0, 3, 2]],
    [723, 180, [6, 5, 4, 3, 2, 1], [2, 3], [9, 12], [5, 13], [4, 15], [0, 0, 2, 3]],
    [723, 270, [5, 3, 1, 6, 4, 2], [3, 2], [12, 9], [-4, 5], [-3, 4], [0, 0, 3, 2]],
    [727, 0, [5, 6, 3, 4, 1, 2], [2, 3], [9, 12], [2, 13], [5, 15], [1, 1, 2, 3]],
    [727, -1, [2, 1, 4, 3, 6, 5], [2, 3], [9, 12], [5, -4], [4, -3], [1, 1, 2, 3]],
  ]) {
    const bitmap = graphics.images.create(2, 3);
    const { state } = graphics.images.get(bitmap);
    Object.assign(state, {
      canvasWidth: 9,
      canvasHeight: 12,
      offsetX: 2,
      offsetY: -4,
      baseX: 5,
      baseY: -3,
      clip: [1, 1, 2, 3],
      rgba: pixels([1, 2, 3, 4, 5, 6]),
    });
    const owner = owners.add(bitmap, null, new Array(11).fill(0));
    const record = owners.get(owner);
    record.layers = [{ bitmap, animation: null }];
    await runRenderGuest(world, call(native, [owner, mode]));
    assert.deepEqual(await graphics.images.get(bitmap).pixels(), pixels(order));
    assert.deepEqual(state.clip, clip);
    assert.equal(record.bitmap, bitmap);
    assert.deepEqual(record.info.slice(0, 10), [...size, ...canvas, ...offsets, ...base, 4, 1]);
    await owners.release(owner);
  }
  await runRenderGuest(world, [...call(723, [0, 0]), ...call(727, [0, 0xffffffff])]);
});

test('fixed 2.6.1.23 retained image copy keeps the original physical write order', async (t) => {
  const world = renderWorld();
  t.after(() => world.close());
  world.game.width = world.game.height = 8;
  const { imageOwners: owners, graphics } = world;
  const bmp = graphics.images.create(4, 4),
    bitmap = graphics.images.get(bmp),
    record = (handle) => owners.add(handle, null, new Array(11).fill(0)),
    source = record(bmp),
    shared = record(graphics.images.alias(bmp)),
    absent = record(0);
  const data = (alpha) =>
    Uint8ClampedArray.from({ length: 64 }, (_, i) => (i % 4 === 3 ? alpha : 1 + i));
  bitmap.state.rgba = data(255);
  const lowerRow = bitmap.state.rgba.slice(48);
  await runRenderGuest(world, call(735, [source, 0, 1, 4, 3, shared, 0, 0, 4, 3]));
  assert.deepEqual(
    await bitmap.pixels(),
    Uint8ClampedArray.from([...lowerRow, ...lowerRow, ...lowerRow, ...lowerRow]),
  );

  const other = graphics.images.create(4, 4),
    destination = graphics.images.get(other),
    detached = record(other);
  bitmap.state.rgba = data(0);
  destination.state.rgba = data(67);
  await runRenderGuest(world, call(735, [source, 0, 0, 4, 4, detached, 0, 0, 2, 2]));
  assert.deepEqual(await destination.pixels(), data(67));
  await runRenderGuest(world, call(735, [source, 0, 0, 4, 4, source, 0, 0, 2, 2]));
  assert.deepEqual(await bitmap.pixels(), data(0));

  bitmap.state.rgba = data(101);
  destination.state.bpp = 2;
  await runRenderGuest(world, call(735, [source, 0, 0, 4, 4, detached, 0, 0, 4, 4]));
  assert.deepEqual(
    await destination.pixels(),
    data(101).map((channel) => (channel >>> 4) * 17),
  );
  destination.state.bpp = 3;
  await runRenderGuest(world, call(735, [source, 0, 0, 4, 4, detached, 0, 0, 4, 4]));
  assert.deepEqual(await destination.pixels(), data(255));
  await runRenderGuest(world, call(735, [source, 0, 0, 4, 4, detached, 0, 0, 2, 2]));
  assert.deepEqual(await destination.pixels(), data(255));

  bitmap.state.rgba = data(255);
  await runRenderGuest(world, call(735, [source, 2, 3, 17, 19, absent, -1, 0, 3, 2]));
  const vram = graphics.images.get(graphics.vramHandle);
  assert.equal(vram.width, 8);
  const pixels = await vram.pixels();
  assert.deepEqual(pixels.slice((3 * 8 + 2) * 4, (3 * 8 + 4) * 4), data(255).slice(0, 8));
  assert.deepEqual(pixels.slice((4 * 8 + 2) * 4, (4 * 8 + 4) * 4), data(255).slice(16, 24));
  await runRenderGuest(world, call(735, [source, 2, 3, 4, 4, 0, 0, 0, 4, 4]));
  assert.deepEqual(await vram.pixels(), pixels);
  for (const handle of [source, shared, detached, absent]) await owners.release(handle);
});

test('fixed 2.6.1.23 owned bitmap helpers preserve sizes, offsets and RGBA through the VM', async () => {
  const world = renderWorld(),
    handle = [0x13, 512],
    task = await runRenderGuest(
      world,
      [
        ...call(112, [2, 1]),
        storeResult(512),
        ...call(117, [handle, 0, 0, 2, 1, 0xad997f63]),
        ...call(119, [handle, 520, 524]),
        ...call(372, [handle, 40, 30]),
        storeResult(528),
        ...call(373, [handle, -9, 12]),
        storeResult(532),
        ...call(363, [handle, 536, 540]),
        ...call(119, [handle, 544, 544]),
        ...call(369, [handle, 0x7f69ebac]),
        ...call(119, [0, 548, 552]),
        ...call(363, [0, 556, 560]),
        ...call(372, [0, 40, 30]),
        storeResult(564),
        ...call(373, [0, 1, 1]),
        storeResult(568),
        ...call(369, [0, 0]),
      ],
      ({ machine }) => machine.bytes(520, 52).fill(0xab),
    );
  const { machine } = task;
  assert.deepEqual(
    Array.from({ length: 13 }, (_, n) => machine.load(520 + n * 4)),
    [2, 1, 1, 1, 0xfffffff7, 12, 1, 0, 0, 0, 0, 0, 0],
  );
  const bitmap = world.graphics.images.get(machine.load(512));
  assert.deepEqual([bitmap.state.canvasWidth, bitmap.state.canvasHeight], [40, 30]);
  assert.deepEqual([...(await bitmap.pixels())], [63, 117, 66, 86, 63, 117, 66, 86]);
  const table = nativeABI(profile).tables.main.entries;
  for (const [id, count, resultWritten] of [
    [119, 3, false],
    [363, 3, false],
    [369, 2, false],
    [372, 3, true],
    [373, 3, true],
  ])
    assert.deepEqual(
      [table[id].signature.argumentWords, table[id].signature.resultWritten],
      [count, resultWritten],
    );
});

test('fixed 2.6.1.23 image owners update independent geometry and preserve null and empty-owner returns', async () => {
  const world = renderWorld(),
    handle = [0x13, 512],
    emptyOwner = [0x13, 516],
    task = await runRenderGuest(
      world,
      [
        ...call(733, [3, 2]),
        storeResult(512),
        ...call(718, [handle, 50, 33]),
        storeResult(544),
        ...call(719, [handle, -24, 22]),
        storeResult(548),
        ...call(720, [handle, -5, 6]),
        storeResult(552),
        ...call(718, [0, -1, -2]),
        storeResult(556),
        ...call(719, [emptyOwner, 14, 15]),
        storeResult(560),
        ...call(720, [0, -1, -2]),
        storeResult(564),
        ...call(712, [handle, 568, 572]),
        ...call(714, [handle, 576, 580]),
        ...call(715, [handle, 584, 588]),
      ],
      (task) => task.machine.store(516, world.imageOwners.add(0, task.id, [])),
    );
  const { machine } = task,
    record = world.imageOwners.get(machine.load(512)),
    bitmap = world.graphics.images.get(record.bitmap);
  assert.deepEqual([bitmap.state.baseX, bitmap.state.baseY], [-5, 6]);
  assert.deepEqual(
    Array.from({ length: 12 }, (_, n) => machine.load(544 + n * 4)),
    [1, 1, 1, 1, 0, 1, 3, 2, 50, 33, 0xffffffe8, 22],
  );
  const table = nativeABI(profile).tables.main.entries;
  for (const id of [718, 719, 720])
    assert.deepEqual(
      [table[id].signature.argumentWords, table[id].signature.resultWritten],
      [3, true],
    );
});

test('fixed 2.6.1.23 bitmap queries reject unmapped outputs and image ownership mismatch', async () => {
  const world = renderWorld();
  await assert.rejects(
    runRenderGuest(world, call(119, [0, 0xffffffff, 128])),
    /KCS memory ffffffff/,
  );
  const bitmap = world.graphics.images.create(1, 1, 2);
  await assert.rejects(runRenderGuest(world, call(718, [bitmap, 10, 20])), /image-owner/);
  assert.deepEqual(
    [world.graphics.images.get(bitmap).width, world.graphics.images.get(bitmap).height],
    [1, 1],
  );
});

test('fixed 2.6.1.23 Main, Motion and both Particle tables share the original integer stream', async () => {
  const random = new ParticleRandom(4357);
  assert.equal(await result([[43, 33, 0]], { services: { random } }), 0xaae64ac3);
  const motion = new MotionInstance(await readKCS(kcsProgram([[43, 39, 0], [59]])), {
    profile,
    random,
  });
  motion.run();
  assert.equal(motion.machine.pop(), 0x5e7c47da);
  for (const [version, expected] of [
    [0x10000, 0xb98e8121],
    [0x20000, 0xb010f327],
  ]) {
    const p = await randomParticle(version, random, [[43, 33, 0]]);
    p.update(0);
    assert.equal(p.machine.pop(), expected);
  }
  assert.equal(random.integer.index, 4);
  assert.equal(random.real.index, 624);
});

async function randomParticle(scriptVersion, random, code) {
  const bytes = kcsProgram([...code, [59]]);
  new DataView(bytes.buffer).setUint16(8, scriptVersion >>> 16, true);
  const script = await readKCS(bytes);
  return new ParticleScriptInstance(script, {
    profile,
    random,
    count: 1,
    width: 8,
    height: 8,
    screenWidth: 64,
    screenHeight: 48,
  });
}

test('fixed 2.6.1.23 real GCALLs apply x87 high-word rounding without consuming the integer stream', async () => {
  const random = new ParticleRandom(4357);
  random.real.nextUint32();
  const before = random.snapshot();
  const expected = 0x3f27383a;
  const restore = () => {
    random.restore(before);
    random.real.index = 192;
  };
  restore();
  assert.equal(await result([[43, 34, 0]], { services: { random } }), expected);
  restore();
  const motion = new MotionInstance(await readKCS(kcsProgram([[43, 40, 0], [59]])), {
    profile,
    random,
  });
  motion.run();
  assert.equal(motion.machine.pop(), expected);
  for (const version of [0x10000, 0x20000]) {
    restore();
    const p = await randomParticle(version, random, [[43, 34, 0]]);
    p.update(0);
    assert.equal(p.machine.pop(), expected);
    assert.equal(random.real.index, 193);
    const wrongWidth = await randomParticle(version, random, [
      [37, sentinel],
      [43, 34, 4],
    ]);
    assert.throws(() => wrongWidth.update(0), /requires 0 arguments/);
    assert.equal(random.real.index, 193);
  }
  assert.deepEqual(random.integer.snapshot(), before.integer);
  restore();
  assert.equal(
    floatBits(random.frand()),
    0x3f27383b,
    'default random conversion preserves its original result',
  );
});
