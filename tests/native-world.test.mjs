// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, u32 } from './helpers.mjs';
function kcs(instructions, strings = []) {
  const code = instructions.flatMap(([op, ...args]) => [
    op,
    ...args.flatMap((arg) => {
      const [mode, value] = Array.isArray(arg) ? arg : [0x23, arg];
      return [mode, ...u32(value)];
    }),
  ]);
  const table = [],
    text = [];
  for (const [address, value] of strings) {
    table.push(...u32(strings.length * 8 + text.length), ...u32(address));
    text.push(...new TextEncoder().encode(value), 0);
  }
  const body = Uint8Array.from([...code, ...table, ...text]);
  return Uint8Array.from([
    ...[
      0x0053434b,
      2,
      0,
      52,
      code.length,
      52 + code.length,
      strings.length,
      table.length + text.length,
      512,
      1024,
      52 + body.length,
      0,
      Math.max(body.length, code.length * 2),
    ].flatMap(u32),
    ...deflateSync(body),
  ]);
}
const profile = 'nekopara-vol3-engine-2.6.1.76';
function world(files) {
  const game = memoryGame(files),
    random = new ParticleRandom(),
    configuration = new NativeConfiguration({ profile });
  const storage = {
    read: (name) => game.read(name),
    write: async () => true,
    remove: async () => true,
    stat: async () => null,
  };
  return new NativeWorld({
    game,
    images: {},
    host: {},
    profile,
    configuration,
    storage,
    random,
    motionLibrary: new MotionLibrary(game, { profile, random }),
  });
}

test('the native world retains the root/input/sound graph and continues main after a fresh-world restore', async () => {
  const files = {
    'main.kcs': kcs(
      [
        [37, 16],
        [43, 0xd1, 4],
        [37, 2],
        [37, 71],
        [43, 0xd3, 8],
        [37, 3],
        [37, 64],
        [43, 0x114, 8],
        [43, 0x41, 0],
        [37, 2],
        [37, 72],
        [43, 0xd3, 8],
        [59],
      ],
      [[64, 'shared name']],
    ),
  };
  const first = world(files);
  await first.initialize('main.kcs');
  assert.deepEqual(
    [...first.objects.objects.values()].map((r) => [r.id, r.kind]),
    [
      [0, 1],
      [1, 11],
      [2, 13],
      [3, 12],
    ],
  );
  const bank = first.runtime.variableBank(first.main),
    strings = first.runtime.stringBank(first.main);
  assert.equal(bank.get(2), 71);
  assert.equal(strings.get(3), 'shared name');
  assert.equal(first.main.status, 'yielded');
  const restored = world(files);
  await restored.restore(structuredClone(first.snapshot()));
  const view = restored.runtime.bankView(restored.main.context.variableBank);
  await restored.tick();
  assert.equal(restored.main.status, 'finished');
  assert.equal(view[2], 72);
  assert.equal(restored.runtime.stringBank(restored.main).get(3), 'shared name');
  assert.equal(restored.objects.objects.get(0).implementation.input, 1);
});

test('native task IDs reuse the lowest free slot and frame execution follows ID order', async () => {
  const objects = new NativeObjects(),
    order = [];
  objects.register(0, (r) => ({
    message: () => 0,
    tick: () => order.push(r.id),
    snapshot: () => ({}),
    restore() {},
  }));
  assert.equal(await objects.create({ kind: 0 }), 0);
  await objects.create({ kind: 0, parent: 0 });
  await objects.create({ kind: 0, parent: 0 });
  await objects.release(1);
  assert.equal(await objects.create({ kind: 0, parent: 0 }), 1);
  await objects.tick(1);
  assert.deepEqual(order, [1, 2, 0]);
  await objects.release(0);
  assert.equal(objects.objects.size, 0);
});

test('all task logic completes before the independent child-first drawing phase', async () => {
  const objects = new NativeObjects(),
    events = [];
  objects.register(0, (record) => ({
    message: () => 0,
    tick: (frame) => events.push(['logic', record.id, frame]),
    drawTick: (frame) => events.push(['draw', record.id, frame]),
  }));
  await objects.create({ kind: 0 });
  await objects.create({ kind: 0, parent: 0 });
  await objects.create({ kind: 0, parent: 1 });
  objects.objects.get(1).userValue = 1;
  await objects.tick(7);
  await objects.drawTick(7);
  assert.deepEqual(events, [
    ['logic', 2, 0],
    ['logic', 1, 0],
    ['logic', 0, 7],
    ['draw', 2, 7],
    ['draw', 1, 7],
    ['draw', 0, 7],
  ]);
  assert.equal(objects.objects.get(1).pausedFrames, 7);
});

test('teardown releases siblings and their owner even when a child cleanup fails', async () => {
  const objects = new NativeObjects(),
    closed = [];
  objects.register(0, (record) => ({
    message: () => 0,
    close() {
      closed.push(record.id);
      if (record.id === 1) throw new Error('authored cleanup failure');
    },
  }));
  await objects.create({ kind: 0 });
  await objects.create({ kind: 0, parent: 0 });
  await objects.create({ kind: 0, parent: 0 });
  await assert.rejects(objects.release(0), AggregateError);
  assert.deepEqual(closed, [0, 1, 2]);
  assert.equal(objects.objects.size, 0);
  assert.equal(await objects.release(0), false);
});

test('a failing factory rolls back children created during initialization', async () => {
  const objects = new NativeObjects(),
    closed = [];
  objects.register(1, async (record) => {
    await objects.create({ kind: 2, parent: record.id });
    throw new Error('authored construction failure');
  });
  objects.register(2, (record) => ({ message: () => 0, close: () => closed.push(record.id) }));
  await assert.rejects(objects.create({ kind: 1 }), /construction failure/);
  assert.deepEqual(closed, [1]);
  assert.equal(objects.objects.size, 0);
});

test('native frame clocks retain pause accounting across checkpoints and inherit their owner rate', async () => {
  const first = world({ 'main.kcs': kcs([[43, 0x41, 0], [43, 0x41, 0], [59]]) });
  first.configuration.screen.fps = 30;
  await first.initialize('main.kcs');
  const task = first.main,
    clock = (id) =>
      first.runtime.native('main', id, [], task.machine, task, first.runtime.scheduler).value;
  assert.equal(clock(7), 30);
  assert.equal(clock(5), 1);
  await first.sendEngine(task.id, 0, 29, 0, 1);
  await first.tick();
  assert.equal(clock(5), 1);
  const second = world({ 'main.kcs': kcs([[43, 0x41, 0], [43, 0x41, 0], [59]]) });
  await second.restore(first.snapshot());
  await second.sendEngine(task.id, 0, 29, 0, 0);
  await second.tick();
  const restored = second.main;
  assert.equal(
    second.runtime.native('main', 7, [], restored.machine, restored, second.runtime.scheduler)
      .value,
    30,
  );
  assert.equal(
    second.runtime.native('main', 5, [], restored.machine, restored, second.runtime.scheduler)
      .value,
    2,
  );
  await first.close();
  await second.close();
});

test('a parent cycle is rejected before publishing a native task checkpoint', async () => {
  const objects = new NativeObjects();
  const descriptor = (id, parent) => ({
    id,
    parent,
    kind: 0,
    name: 'cycle',
    state: 'active',
    data: {},
  });
  await assert.rejects(
    objects.restore({ objects: [descriptor(0, 1), descriptor(1, 0)], queue: [], nextSequence: 1 }),
    /parent cycle/,
  );
  assert.equal(objects.objects.size, 0);
});

test('native FES load executes on its task, force-frame advances it, and main observes its exit code', async () => {
  const loadHandle = [0x13, 128];
  const files = {
    'main.kcs': kcs(
      [
        [37, 16],
        [43, 0xd1, 4],
        [37, 34],
        [37, 3],
        [37, 64],
        [43, 0x42, 12],
        [38, 128],
        [37, loadHandle],
        [37, 256],
        [43, 0x1bf, 8],
        [37, loadHandle],
        [43, 0x1c0, 4],
        [43, 0x41, 0],
        [37, loadHandle],
        [43, 0x1c4, 4],
        [59],
      ],
      [
        [64, 'authored interface'],
        [256, 'flow.fes'],
      ],
    ),
    'flow.fes': new TextEncoder().encode('#START\n$1=77\nexit 7\n'),
  };
  const current = world(files);
  await current.initialize('main.kcs');
  assert.equal(current.runtime.variableBank(current.main).get(1), 77);
  const fes = current.objects.objects.get(4);
  assert.equal(fes.implementation.player.frameCount, 1);
  assert.equal(fes.exitCode, 7);
  await current.tick();
  assert.equal(current.main.machine.pop(), 7);
});

test('task destruction notifies immediately and disposes after its children on the next frame', async () => {
  const objects = new NativeObjects(),
    events = [];
  objects.register(0, (record) => ({
    message: (words) => {
      events.push(['message', record.id, words[1]]);
      return 0;
    },
    tick: () => events.push(['tick', record.id]),
    close: () => events.push(['close', record.id]),
    snapshot: () => ({}),
    restore() {},
  }));
  await objects.create({ kind: 0 });
  await objects.create({ kind: 0, parent: 0 });
  await objects.destroy(0, 3);
  assert.equal(objects.objects.size, 2);
  assert.deepEqual(events, [['message', 0, 3]]);
  await objects.tick(1);
  assert.deepEqual(events, [
    ['message', 0, 3],
    ['tick', 1],
    ['close', 0],
    ['message', 1, 3],
    ['close', 1],
  ]);
  assert.equal(objects.objects.size, 0);
});

test('script engine messages preserve context names and pack signed drag coordinates into user messages', async () => {
  const current = world({ 'main.kcs': kcs([[37, 128], [43, 0x47, 4], [59]]) });
  await current.initialize('main.kcs');
  const machine = current.main.machine;
  machine.writeString('authored-context', 64);
  await current.sendEngine(3, 3, 26, 0, 64);
  await current.sendEngine(3, 3, 25, 0, 80);
  assert.equal(machine.string(80), 'authored-context');
  const words = [65539, -2, 12, -7];
  await current.sendEngine(3, 99, 6, 0, 8, {
    payload: { load: (address) => words[address / 4] >>> 0 },
  });
  assert.deepEqual(
    Array.from({ length: 4 }, (_, i) => machine.load(128 + 4 * i)),
    [99, 0xffff0002, 0xfffe0003, 0xfff9000c],
  );
});

test('native task queries distinguish their kind, direct children, parent and existence', async () => {
  const current = world({ 'main.kcs': kcs([[43, 0x41, 0], [59]]) });
  await current.initialize('main.kcs');
  const child = await current.objects.create({ kind: 0, parent: current.main.id }),
    nested = await current.objects.create({ kind: 0, parent: child }),
    task = current.main,
    query = async (id, args) =>
      (
        await current.runtime.native(
          'main',
          id,
          args,
          task.machine,
          task,
          current.runtime.scheduler,
        )
      ).value;
  assert.equal(await query(0x4a, [task.id]), 12);
  assert.equal(await query(0x4b, [0]), child);
  assert.equal(await query(0x4b, [1]), 0xffffffff);
  assert.equal(await query(0x4c, []), current.root);
  assert.equal(await query(0x4d, [nested]), 1);
  assert.equal(await query(0x4d, [current.root]), 0);
  await current.objects.release(child);
  await current.tick();
  assert.equal(await query(0x4d, [nested]), 0);
  assert.equal(await query(0x4a, [nested]), 0xffffffff);
  await current.close();
});

test('nested Top tasks allocate independent native IDs and keep KCS identity, lookups and checkpoints in their domain', async () => {
  const files = {
      'main.kcs': kcs([[43, 0x41, 0], [59]]),
      'inner.kcs': kcs([[43, 0x41, 0], [59]], [[64, 'authored child']]),
    },
    first = world(files);
  await first.initialize('main.kcs');
  const top = await first.objects.create({ kind: 1, parent: first.root, name: 'nested Top' }),
    inner = await first.spawnScript('inner.kcs', { parent: top }),
    call = (current, task, id, args) =>
      current.runtime.native('main', id, args, task.machine, task, current.runtime.scheduler);
  assert.equal(inner.id, 7);
  assert.equal(first.nativeTaskID(inner.id), 2);
  assert.equal(call(first, inner, 0x44, []).value, 2);
  assert.equal(call(first, inner, 0x4a, [2]).value, 12);
  assert.equal(call(first, first.main, 0x4a, [2]).value, 13);
  assert.equal((await call(first, inner, 0x4d, [4])).value, 0);
  assert.equal((await call(first, inner, 0x4d, [2])).value, 0);
  assert.equal((await call(first, first.main, 0x4d, [4])).value, 1);
  assert.equal((await call(first, inner, 0x42, [0, 2, 64])).value, 3);
  assert.equal(call(first, inner, 0x4b, [0]).value, 3);
  assert.equal(call(first, inner, 0x4c, []).value, 4);
  const child = first.resolveTaskID(3, inner.id);
  assert.equal(first.resolveTaskID(3, first.main.id), first.main.id);
  await first.sendNativeEngine(3, inner.id, 24, 0, 81);
  assert.equal(first.objects.objects.get(child).exitCode, 81);
  const second = world(files);
  await second.restore(structuredClone(first.snapshot()));
  assert.equal(second.resolveTaskID(3, inner.id), child);
  assert.equal(await second.sendNativeEngine(3, inner.id, 23), 81);
  await second.objects.release(child);
  await second.tick();
  assert.equal(
    (await call(second, second.runtime.scheduler.tasks.get(inner.id), 0x42, [0, 2, 64])).value,
    3,
  );
  await first.close();
  await second.close();
});

test('script task messages use the original synchronous and queued packets and write bank queries through lParam', async () => {
  const current = world({ 'main.kcs': kcs([[37, 128], [43, 0x47, 4], [43, 0x41, 0], [59]]) });
  await current.initialize('main.kcs');
  const task = current.main,
    scheduler = current.runtime.scheduler;
  const query = current.runtime.native(
    'main',
    0x45,
    [3, 77, 81, 82],
    task.machine,
    task,
    scheduler,
  );
  assert.equal((await query).value, 1);
  assert.deepEqual(
    Array.from({ length: 4 }, (_, i) => task.machine.load(128 + i * 4)),
    [3, 77, 81, 82],
  );
  assert.equal(
    (await current.runtime.native('main', 0x46, [3, 88, 91, 92], task.machine, task, scheduler))
      .value,
    1,
  );
  assert.deepEqual(task.messages, [[3, 88, 91, 92]]);
  const bank = current.runtime.variableBank(task);
  bank.initialize(8);
  task.machine.store(64, 0xcafebabe);
  await current.sendEngine(task.id, task.id, 176, 0, 64);
  assert.equal(task.machine.load(64), task.context.variableBank);
  await current.close();
});

test('released native IDs stay reserved until the parent finishes its whole child frame walk', async () => {
  const current = world({ 'main.kcs': kcs([[43, 0x41, 0], [59]]) });
  await current.initialize('main.kcs');
  const dying = await current.objects.create({ kind: 0, parent: current.main.id }),
    sibling = await current.objects.create({ kind: 0, parent: current.main.id }),
    seen = [];
  await current.objects.destroy(dying, current.main.id);
  current.objects.objects.get(sibling).implementation.tick = async () => {
    const next = await current.objects.create({ kind: 0, parent: current.main.id });
    seen.push(current.nativeTaskID(next));
    current.objects.objects.get(next).implementation.tick = () => seen.push('new task tick');
  };
  await current.tick();
  assert.deepEqual(seen, [6, 'new task tick']);
  const next = await current.objects.create({ kind: 0, parent: current.main.id });
  assert.equal(current.nativeTaskID(next), 4);
  await current.close();
});

test('FES local bank messages preserve partial bytes, report their native size and select the authored load label', async () => {
  const current = world({
    'main.kcs': kcs([[37, 16], [43, 0xd1, 4], [37, 64], [43, 0x47, 4], [59]]),
    'locals.fes': new TextEncoder().encode(
      '#START\nnext HOLD\n#HOLD\nnext HOLD\n#_LOAD_\n$3=123\nnext HOLD\n',
    ),
  });
  await current.initialize('main.kcs');
  const id = await current.objects.create({ kind: 34, parent: current.main.id });
  await current.objects.objects.get(id).implementation.load('locals.fes', current.main);
  const root = current.objects.objects.get(id).implementation.player.root,
    bytes = new Uint8Array(4096),
    view = new DataView(bytes.buffer),
    payload = { bytes: (at, size) => bytes.subarray(at, at + size) };
  root.setLocal(0, 0x12345678);
  root.setLocal(511, -1);
  assert.equal(await current.sendEngine(id, current.main.id, 343), 2048);
  assert.equal(await current.sendEngine(id, current.main.id, 343, 2047, 1, { payload }), 0);
  assert.equal(await current.sendEngine(id, current.main.id, 343, 2048, 16, { payload }), 2048);
  assert.equal(view.getUint32(16, true), 0x12345678);
  assert.equal(view.getInt32(16 + 511 * 4, true), -1);
  bytes.set([0xab, 0xcd, 0xef], 1);
  await current.sendEngine(id, current.main.id, 344, 3, 1, { payload });
  assert.equal(root.local(0) >>> 0, 0x12efcdab);
  assert.equal(root.local(511), -1);
  assert.equal(root.label, '_LOAD_');
  await current.close();
});

test('FES named words and sleep notifications continue after a fresh-world restore', async () => {
  const files = {
      'main.kcs': kcs([[37, 16], [43, 0xd1, 4], [37, 64], [43, 0x47, 4], [59]]),
      'named.fes': new TextEncoder().encode(
        '#START\nnext HOLD\n#HOLD\nnext HOLD\n#_FES_SLEEP_\n\\3=\\3+1\nreturn\n#_FES_WAKE_\n\\4=\\4+1\nreturn\n',
      ),
    },
    first = world(files);
  await first.initialize('main.kcs');
  const id = await first.objects.create({ kind: 34, parent: first.main.id });
  await first.objects.objects.get(id).implementation.load('named.fes', first.main);
  const call = (current, native, args) =>
    current.runtime.native(
      'main',
      native,
      args,
      current.main.machine,
      current.main,
      current.runtime.scheduler,
    );
  first.main.machine.writeString('named-word', 128);
  await call(first, 0x372, [id, 128, 0xfedcba98]);
  assert.equal((await call(first, 0x373, [id, 128])).value, 0xfedcba98);
  assert.equal((await call(first, 0x373, [id, 0])).value, 0);
  await call(first, 0x287, [id, 7]);
  await call(first, 0x287, [id, 7]);
  const root = first.objects.objects.get(id).implementation.player.root;
  assert.equal(root.local(3), 1);
  assert.equal(root.local(4), 0);
  const second = world(files);
  await second.restore(structuredClone(first.snapshot()));
  assert.equal((await call(second, 0x373, [id, 128])).value, 0xfedcba98);
  const implementation = second.objects.objects.get(id).implementation;
  assert.equal(implementation.sleepValue, 7);
  assert.equal(implementation.input.state.sleeping, true);
  await call(second, 0x287, [id, 0]);
  assert.equal(implementation.player.root.local(3), 1);
  assert.equal(implementation.player.root.local(4), 1);
  assert.equal(implementation.input.state.sleeping, false);
  await first.close();
  await second.close();
});

test('Windows language messages retain range gates, repeated option reloads and translated titles', async () => {
  const current = world({
      'main.kcs': kcs([[37, 64], [43, 0x47, 4], [59]]),
      'language_en.txt': new TextEncoder().encode('$title$\nEnglish title\n'),
      'language_jp.txt': new TextEncoder().encode('$title$\nJapanese title\n'),
    }),
    language = current.configuration.language,
    calls = [],
    titles = [],
    read = current.game.read.bind(current.game);
  Object.assign(language, {
    entries: [{ prefix: 'en' }, { prefix: 'jp' }],
    default: 0,
    ui: 0,
    main: 0,
    sub: 0xffffffff,
    optionTable: 'option_%LANG%_%LANG_M%.txt',
  });
  current.configuration.setField('application.title', '$title$fallback');
  current.game.read = (name) => {
    calls.push(name);
    return read(name);
  };
  current.host.nativeTitleChanged = (title) => titles.push(title);
  try {
    await current.initialize('main.kcs');
    const change = async (mode, index) => {
      calls.length = 0;
      await current.runtime.native(
        'main',
        0x41d,
        [mode, index],
        current.main.machine,
        current.main,
      );
      await current.processWindowMessages();
      return [...calls];
    };
    assert.deepEqual(titles, ['English title']);
    assert.deepEqual(await change(0, 99), []);
    assert.equal(language.ui, 99);
    assert.deepEqual(titles, ['English title']);
    assert.deepEqual(await change(0, 1), ['language_jp.txt', 'option_jp_en.txt']);
    assert.deepEqual(titles, ['English title', 'Japanese title']);
    assert.deepEqual(await change(1, 99), ['option_jp_en.txt']);
    assert.equal(language.main, 99);
    assert.deepEqual(await change(1, 1), ['option_jp_jp.txt', 'option_jp_jp.txt']);
    assert.deepEqual(await change(2, 99), []);
    assert.equal(language.sub, 0xffffffff);
  } finally {
    await current.close();
  }
});

test('checkpoint, next tick and close wait for the complete frame settlement', async () => {
  const scene = world({ 'main.kcs': kcs([[59]]) }),
    entered = Promise.withResolvers(),
    pending = Promise.withResolvers();
  await scene.initialize('main.kcs');
  const flush = scene.flushConfiguration;
  scene.flushConfiguration = async () => {
    entered.resolve();
    await pending.promise;
  };
  const ticking = scene.tick();
  try {
    await entered.promise;
    assert.equal(scene.running, false);
    assert.throws(() => scene.snapshot(), /settled frame/);
    await assert.rejects(() => scene.tick(), /serialized/);
    await assert.rejects(() => scene.close(), /settled frame/);
    pending.resolve();
    await ticking;
    assert.equal(scene.snapshot().frame, scene.frame);
    scene.stageRenderer.rendering = true;
    assert.throws(() => scene.snapshot(), /render/);
    scene.stageRenderer.rendering = false;
    assert.equal(scene.snapshot().frame, scene.frame);
  } finally {
    pending.resolve();
    await ticking;
    scene.stageRenderer.rendering = false;
    scene.flushConfiguration = flush;
    await scene.close({ flushFiles: false });
  }
});
