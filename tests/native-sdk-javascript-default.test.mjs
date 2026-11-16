// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { JavaScriptMachine } from '../src/javascript/machine.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const sentinel = 0x13579bdf;
const source = [
  'var next, peek = make(0);',
  'function make(count) {',
  '  next = function () { return ++count; };',
  '  return function () { return count; };',
  '}',
  'function GameLoop(frame) {',
  '  var n = next();',
  '  if (frame === 3) { if (peek() === 2) cfExit(n + 40); }',
  '}',
].join('\n');

function fixture(text = source, extraFiles = {}) {
  const own = [37, [0x14, 64]],
    target = [37, [0x14, 68]],
    start = [
      [37, sentinel],
      [43, 0x44, 0],
      [38, 64],
      [37, 55],
      own,
      [37, 256],
      [43, 0x42, 12],
      [38, 68],
      target,
      own,
      [43, 0x3ce, 8],
      target,
      [37, 288],
      [43, 0x3cf, 8],
    ],
    idle = start.reduce((pc, op) => pc + 1 + (op.length - 1) * 5, 0),
    game = memoryGame({
      'main.kcs': kcsProgram(
        [...start, [43, 0x41, 0], [41, idle]],
        [
          [256, 'Owned JavaScript'],
          [288, 'owned.js'],
        ],
      ),
      'owned.js': new TextEncoder().encode(text),
      ...extraFiles,
    }),
    random = new ParticleRandom(19, 23),
    world = new NativeWorld({
      game,
      profile,
      random,
      configuration: new NativeConfiguration({ profile }),
      images: {},
      host: {},
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: (name) => game.read(name), write: async () => true },
    }),
    events = { original: 0, reads: [], native: [], packets: [] },
    read = game.read,
    native = world.runtime.native,
    send = world.sendNativeEngine;
  world.ensureNativeEngine = () => {
    events.original++;
    throw new Error('normal kind55 attempted original CPU');
  };
  game.read = function (...args) {
    events.reads.push(args[0]);
    return read.apply(this, args);
  };
  world.runtime.native = function (...args) {
    events.native.push({ table: args[0], id: args[1], args: [...args[2]] });
    return native.apply(this, args);
  };
  world.sendNativeEngine = function (...args) {
    const [target, sender, id, w, l, context] = args;
    if ([89, 92].includes(id) && this.objects.objects.get(sender)?.kind === 55)
      events.packets.push({
        target,
        sender,
        id,
        w,
        l,
        flags: context?.flags,
        words:
          id === 89 ? Array.from({ length: 6 }, (_, i) => context.payload.load(l + i * 4)) : null,
      });
    return send.apply(this, args);
  };
  return { world, events };
}

function task(world) {
  return world.objects.objects.get(world.resolveTaskID(world.main.machine.load(68), world.main.id));
}

function assertNoExecutableValues(value, seen = new Set()) {
  assert.notEqual(typeof value, 'function');
  assert.equal(value instanceof Promise, false);
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  seen.add(value);
  for (const item of value instanceof Map ? [...value].flat() : Object.values(value))
    assertNoExecutableValues(item, seen);
}

test('normal SDK kind55 executes hoisted closures through KCS and restores shared cells without replay', async () => {
  const first = fixture(),
    fresh = fixture(),
    { world } = first;
  try {
    world.graphics.view.configure({ clientWidth: 320, clientHeight: 240 });
    await world.initialize('main.kcs');
    const record = task(world),
      child = [...world.objects.objects.values()].find((item) => item.parent === record.id);
    assert.equal(record.kind, 55);
    assert.equal(record.parent, world.main.id);
    assert.equal(child.kind, 6);
    assert.equal(child.name, 'js base button');
    const size = [world.graphics.view.virtualWidth, world.graphics.view.virtualHeight],
      region = world.inputFor(record.id).get(child.id);
    assert.notDeepEqual(size, [world.graphics.view.clientWidth, world.graphics.view.clientHeight]);
    assert.deepEqual(first.events.packets, [
      {
        target: child.nativeID,
        sender: record.id,
        id: 89,
        w: 0,
        l: 0,
        flags: 1,
        words: [0, 0, ...size, 2, child.nativeID],
      },
      { target: child.nativeID, sender: record.id, id: 92, w: 0, l: 1, flags: 1, words: null },
    ]);
    assert.equal(region.owner, child.id);
    assert.equal(region.receiver, record.nativeID);
    assert.equal(region.priority, 2);
    assert.equal(
      region.flags,
      child.nativeID,
      'Input metadata and transport flags remain different domains',
    );
    assert.equal(region.enabled, 1, 'the owned Input setter retains its raw DWORD');
    assert.equal(record.exitCode, -1);
    assert.equal(world.frame, 1);
    assert.deepEqual(
      first.events.native
        .filter((item) => [0x42, 0x3ce, 0x3cf].includes(item.id))
        .map((item) => item.id),
      [0x42, 0x3ce, 0x3cf],
    );
    assert.equal(
      world.main.machine.load(world.main.machine.sp - 4),
      sentinel,
      'link/load remain control2 with no VM output',
    );
    await world.tick();
    assert.equal(world.frame, 2);
    assert.equal(record.exitCode, -1, 'the shared closure has executed once');
    const checkpoint = structuredClone(world.snapshot());
    assertNoExecutableValues(checkpoint);
    let randomDraws = 0;
    const generators = [fresh.world.random.integer, fresh.world.random.real];
    for (const generator of generators) {
      const next = generator.nextUint32;
      generator.nextUint32 = function (...args) {
        randomDraws++;
        return next.apply(this, args);
      };
    }
    await fresh.world.restore(structuredClone(checkpoint));
    assert.equal(fresh.world.random.integer, generators[0]);
    assert.equal(fresh.world.random.real, generators[1]);
    assert.deepEqual(fresh.world.snapshot(), checkpoint, 'fresh is exact before a warm frame');
    assert.deepEqual(fresh.events.native, []);
    assert.deepEqual(fresh.events.packets, [], 'cold restore does not replay input registration');
    assert.equal(
      fresh.events.reads.includes('owned.js'),
      false,
      'restore does not reload or re-execute the source',
    );
    assert.equal(randomDraws, 0);
    assert.notEqual(task(fresh.world).implementation, record.implementation);
    await fresh.world.tick();
    assert.equal(
      task(fresh.world).exitCode,
      42,
      'restored lexical cells retain both closure aliases',
    );
    assert.equal(record.exitCode, -1, 'fresh execution does not mutate the source World');
    await world.tick();
    assert.equal(record.exitCode, 42);
    assert.deepEqual(
      fresh.world.snapshot(),
      world.snapshot(),
      'both real logic continuations finish identically',
    );
    assert.equal(first.events.original, 0);
    assert.equal(fresh.events.original, 0);
  } finally {
    await fresh.world.close();
    await world.close();
  }
  assert.equal(world.objects.objects.size, 0);
  assert.equal(fresh.world.objects.objects.size, 0);
});

test('normal SDK kind55 rejects unsupported syntax and host imports with their source spans', async () => {
  for (const [text, message] of [
    ['var count = 0;\nwhile (count) { count++; }', /Unsupported JavaScript syntax.*owned\.js:2:1/],
    ['var count = 0;\nmystery(count);', /Unsupported JavaScript host import.*owned\.js:2:1/],
  ]) {
    const { world, events } = fixture(text);
    try {
      await assert.rejects(world.initialize('main.kcs'), message);
      assert.equal(events.original, 0);
      assert.equal(task(world).kind, 55);
    } finally {
      await world.close();
    }
  }
});

test('normal SDK kind55 cfExit returns to JavaScript and stops only subsequent frame callbacks', async () => {
  const first = fixture(
      [
        'var count = 0;',
        'function GameLoop(frame) {',
        '  var result = cfExit();',
        '  count++;',
        '  if (result === undefined) {',
        '    result = cfExit(7);',
        '    count++;',
        '    if (result === undefined) cfExit(40 + count);',
        '  }',
        '}',
      ].join('\n'),
    ),
    fresh = fixture(),
    { world } = first;
  try {
    await world.initialize('main.kcs');
    assert.equal(task(world).exitCode, -1);
    await world.tick();
    assert.equal(
      task(world).exitCode,
      42,
      'both cfExit calls return undefined and subsequent JS executes',
    );
    const checkpoint = structuredClone(world.snapshot());
    await fresh.world.restore(structuredClone(checkpoint));
    assert.deepEqual(fresh.world.snapshot(), checkpoint);
    assert.deepEqual(fresh.events.native, []);
    await world.tick();
    await fresh.world.tick();
    assert.equal(task(world).exitCode, 42, 'another GameLoop would increment count and produce 44');
    assert.equal(task(fresh.world).exitCode, 42);
    assert.deepEqual(fresh.world.snapshot(), world.snapshot());
    assert.equal(first.events.original, 0);
    assert.equal(fresh.events.original, 0);
  } finally {
    await fresh.world.close();
    await world.close();
  }
});

test('normal SDK kind55 restores host-import aliases as data without re-executing source', async () => {
  const first = fixture(
      'var finish = cfExit;\nfunction GameLoop(frame) { if (frame === 3) finish(42); }',
    ),
    fresh = fixture(),
    { world } = first;
  try {
    await world.initialize('main.kcs');
    await world.tick();
    const checkpoint = structuredClone(world.snapshot());
    assertNoExecutableValues(checkpoint);
    await fresh.world.restore(structuredClone(checkpoint));
    assert.deepEqual(fresh.world.snapshot(), checkpoint);
    assert.deepEqual(fresh.events.native, []);
    assert.equal(fresh.events.reads.includes('owned.js'), false);
    await fresh.world.tick();
    assert.equal(task(fresh.world).exitCode, 42);
    assert.equal(task(world).exitCode, -1);
    await world.tick();
    assert.equal(task(world).exitCode, 42);
    assert.deepEqual(fresh.world.snapshot(), world.snapshot());
    assert.equal(first.events.original, 0);
    assert.equal(fresh.events.original, 0);
  } finally {
    await fresh.world.close();
    await world.close();
  }
});

test('normal SDK kind55 treats keyword-like string expressions as values', async () => {
  const { world, events } = fixture('function GameLoop(frame) { "return"; cfExit(42); }');
  try {
    await world.initialize('main.kcs');
    await world.tick();
    assert.equal(task(world).exitCode, 42, 'a string expression cannot terminate its function');
    assert.equal(events.original, 0);
  } finally {
    await world.close();
  }
});

test('normal SDK kind55 rejects block and conditional function declarations before execution', async () => {
  for (const opener of ['if (false) {', '{']) {
    const { world, events } = fixture(
      [
        'function GameLoop(frame) {',
        opener,
        'function finish() { return 42; }',
        '}',
        'cfExit(finish());',
        '}',
      ].join('\n'),
    );
    try {
      await assert.rejects(async () => {
        await world.initialize('main.kcs');
        await world.tick();
      }, /Unsupported JavaScript syntax.*block or conditional function declaration.*owned\.js:3:1/);
      assert.equal(events.original, 0);
    } finally {
      await world.close();
    }
  }
});

test('normal SDK kind55 separates literal delimiters and operators from grammar while retaining body hoisting', async () => {
  const literals = [
      'function',
      '}',
      '{',
      'var',
      'if',
      'else',
      'return',
      'true',
      'false',
      'null',
      '+',
      '-',
      '!',
      '++',
      '(',
      ')',
      ';',
      ',',
      '=',
      '===',
      '!==',
      '*',
      '/',
      '',
    ],
    { world, events } = fixture(
      [
        'function echo(value) { return value; }',
        'function GameLoop(frame) {',
        ...literals.map((value) => JSON.stringify(value) + ';'),
        'var value = finish();',
        'if (echo(")") === ")") { if (value === 42) cfExit(value); }',
        'function finish() { return 42; }',
        '}',
      ].join('\n'),
    );
  try {
    await world.initialize('main.kcs');
    await world.tick();
    assert.equal(task(world).exitCode, 42);
    assert.equal(events.original, 0);
  } finally {
    await world.close();
  }
  const invalid = fixture('var ready = 1;\n"left" "+" "right";');
  try {
    await assert.rejects(
      invalid.world.initialize('main.kcs'),
      /Unsupported JavaScript syntax.*owned\.js:2:8/,
    );
    assert.equal(invalid.events.original, 0);
  } finally {
    await invalid.world.close();
  }
});

test('normal JavaScript option GCALL retains raw words, parent-native zero targets and cold ownership', async () => {
  const words = [0, 1, 0x80000000, 0xffffffff],
    program = kcsProgram([
      [37, sentinel],
      ...words.flatMap((word) => [
        [37, [0x13, 128]],
        [37, word],
        [43, 1006, 8],
      ]),
      [37, 0],
      [37, 7],
      [43, 1006, 8],
      [37, 73],
      [38, [0x13, 512]],
      [59],
    ]),
    files = {
      'option.kcs': program,
      'missing-option.kcs': kcsProgram([
        [37, sentinel],
        [37, 0x7f100600],
        [37, 0xffffffff],
        [43, 1006, 8],
        [59],
      ]),
    },
    first = fixture('function GameLoop(frame) {}', files),
    fresh = fixture('function GameLoop(frame) {}', files),
    { world } = first;
  try {
    await world.initialize('main.kcs');
    const ownerID = await world.objects.create({
        kind: 55,
        parent: world.main.id,
        nativeID: 0x1006abcd,
      }),
      owner = world.objects.objects.get(ownerID),
      implementation = owner.implementation,
      caller = await world.spawnScript('option.kcs', { parent: owner.id }),
      sends = [],
      send = world.sendNativeEngine;
    assert.notEqual(owner.nativeID, owner.id);
    assert.notEqual(owner.nativeID, 0);
    const initialOption = implementation.optionWord;
    const stores = [],
      receive = implementation.message;
    implementation.message = function (...parameters) {
      const reply = receive.apply(this, parameters);
      if (parameters[0][1] === 526) stores.push(this.optionWord);
      return reply;
    };
    world.sendNativeEngine = function (...args) {
      const reply = send.apply(this, args);
      if (args[2] === 526) sends.push({ words: args.slice(0, 5), flags: args[5]?.flags, reply });
      return reply;
    };
    caller.machine.store(128, owner.nativeID);
    const sp = caller.machine.sp;
    await world.runtime.scheduler.execute(caller);
    assert.equal(caller.machine.load(512), 73);
    assert.equal(caller.machine.load(caller.machine.sp - 4), sentinel);
    assert.equal(caller.machine.sp, sp + 4);
    assert.equal(initialOption, 0);
    assert.equal(implementation.optionWord, 7);
    assert.deepEqual(stores, [...words, 7]);
    assert.equal(implementation.loaded, false);
    assert.equal(implementation.running, false);
    assert.deepEqual(
      sends.map(({ words }) => words),
      [...words, 7].map((word) => [owner.nativeID, caller.id, 526, 0, word]),
    );
    assert.deepEqual(
      sends.map(({ flags }) => flags),
      [0, 0, 0, 0, 0],
    );
    assert.deepEqual(
      await Promise.all(sends.map(({ reply }) => reply)),
      Array(5).fill(NATIVE_UNWRITTEN_WORD),
    );
    const missing = await world.spawnScript('missing-option.kcs', { parent: owner.id });
    await world.runtime.scheduler.execute(missing);
    assert.equal(missing.machine.load(missing.machine.sp - 4), sentinel);
    assert.deepEqual(stores, [...words, 7]);
    assert.equal(implementation.optionWord, 7);
    const saved = world.snapshot();
    assertNoExecutableValues(saved);
    fresh.world.runtime.native = () => {
      throw new Error('Option restore replayed a GCALL');
    };
    for (const random of [fresh.world.random.integer, fresh.world.random.real])
      random.nextUint32 = () => {
        throw new Error('Option restore replayed RNG');
      };
    await fresh.world.restore(await deserializeCheckpoint(await serializeCheckpoint(saved)));
    assert.deepEqual(fresh.world.snapshot(), saved);
    const restored = fresh.world.objects.objects.get(owner.id).implementation;
    assert.equal(restored.optionWord, 7);
    await fresh.world.sendNativeEngine(owner.nativeID, fresh.world.main.id, 526, 0, 0x80000000, {
      flags: 0,
    });
    assert.equal(restored.optionWord, 0x80000000);
    assert.equal(implementation.optionWord, 7);
    assert.equal(world.nativeEngine, undefined);
    assert.equal(first.events.original + fresh.events.original, 0);
  } finally {
    await fresh.world.close();
    await world.close();
  }
});

test('normal JavaScript foreign GCALL passes a live string array and restores aliases after stopped callbacks', async () => {
  const program = kcsProgram(
      [
        [37, sentinel],
        [37, 0],
        [37, 800],
        [37, 100],
        [37, 2],
        [43, 976, 16],
        [37, 73],
        [38, [0x13, 512]],
        [59],
      ],
      [[800, 'Enable']],
    ),
    files = {
      'foreign.kcs': program,
      'foreign-empty.kcs': kcsProgram(
        [[37, sentinel], [37, 0], [37, 800], [37, 0], [37, 0x80000000], [43, 976, 16], [59]],
        [[800, 'Empty']],
      ),
    },
    text =
      'var received, alias; function Enable(values) { received = values; alias = values; if (values.length === 2) { if (values[0] === "\\u65e5\\u672c") { if (values[1] === "") cfExit(42); } } } function Empty(values) { if (values.length === 0) cfExit(43); } function GameLoop(frame) {}',
    first = fixture(text, files),
    fresh = fixture(text, files),
    { world } = first;
  try {
    await world.initialize('main.kcs');
    const owner = task(world),
      implementation = owner.implementation,
      caller = await world.spawnScript('foreign.kcs', { parent: owner.id }),
      strings = world.runtime.stringBank(caller);
    strings.set(100, '日本');
    const sp = caller.machine.sp;
    await world.runtime.scheduler.execute(caller);
    assert.equal(caller.machine.load(512), 73);
    assert.equal(caller.machine.sp, sp + 4);
    assert.equal(caller.machine.load(caller.machine.sp - 4), sentinel);
    assert.equal(owner.exitCode, 42);
    assert.equal(implementation.loaded, true);
    assert.equal(implementation.running, false);
    const cell = implementation.machine.cell(0, 'received'),
      alias = implementation.machine.cell(0, 'alias'),
      values = implementation.machine.state.cells[cell];
    assert.deepEqual(values, ['日本', '']);
    assert.strictEqual(values, implementation.machine.state.cells[alias]);
    for (const value of [() => 1, Promise.resolve(1), { host: 'cfExit' }]) {
      const invalid = implementation.machine.snapshot();
      invalid.cells[cell] = [value];
      assert.throws(() => JavaScriptMachine.restore(invalid), /Invalid JavaScript string array/);
    }
    for (const values of [
      Object.assign(new Array(1), { extra: () => 1 }),
      Object.defineProperty(['owned'], 'hidden', { value: Promise.resolve(1) }),
    ]) {
      const invalid = implementation.machine.snapshot();
      invalid.cells[cell] = values;
      assert.throws(() => JavaScriptMachine.restore(invalid), /Invalid JavaScript string array/);
    }
    const saved = world.snapshot();
    assertNoExecutableValues(saved);
    fresh.world.runtime.native = () => {
      throw new Error('Foreign restore replayed a GCALL');
    };
    await fresh.world.restore(await deserializeCheckpoint(await serializeCheckpoint(saved)));
    assert.deepEqual(fresh.world.snapshot(), saved);
    const restored = fresh.world.objects.objects.get(owner.id).implementation;
    assert.notStrictEqual(restored.machine.state.cells[cell], values);
    assert.strictEqual(restored.machine.state.cells[cell], restored.machine.state.cells[alias]);
    const after = await fresh.world.spawnScript('foreign-empty.kcs', { parent: owner.id });
    fresh.world.runtime.native = Object.getPrototypeOf(world.runtime).native;
    await fresh.world.runtime.scheduler.execute(after);
    assert.equal(fresh.world.objects.objects.get(owner.id).exitCode, 43);
    assert.equal(owner.exitCode, 42);
    assert.notStrictEqual(restored.machine.state.cells[cell], values);
    assert.equal(world.nativeEngine, undefined);
    assert.equal(first.events.original + fresh.events.original, 0);
  } finally {
    await fresh.world.close();
    await world.close();
  }
});

test('normal JavaScript foreign strings reject unwritten bytes beyond the native UTF8 window', async () => {
  const program = kcsProgram(
      [[37, 0], [37, 800], [37, 100], [37, 1], [43, 976, 16], [59]],
      [[800, 'Accept']],
    ),
    first = fixture(
      'var received, count=0; function Accept(values) { ++count; received=values; } function GameLoop(frame) {}',
      { 'limit.kcs': program },
    ),
    { world } = first;
  try {
    await world.initialize('main.kcs');
    const owner = task(world),
      implementation = owner.implementation,
      invoke = async (value) => {
        const caller = await world.spawnScript('limit.kcs', { parent: owner.id });
        world.runtime.stringBank(caller).set(100, value);
        await world.runtime.scheduler.execute(caller);
      },
      machine = implementation.machine,
      received = machine.cell(0, 'received'),
      count = machine.cell(0, 'count');
    for (const value of ['x'.repeat(4095), '日'.repeat(1365)]) {
      assert.equal(new TextEncoder().encode(value).length, 4095);
      await invoke(value);
      assert.deepEqual(machine.state.cells[received], [value]);
    }
    assert.equal(machine.state.cells[count], 2);
    const before = implementation.snapshot();
    for (const value of ['x'.repeat(4096), '日'.repeat(1366)]) {
      assert.ok(new TextEncoder().encode(value).length >= 4096);
      await assert.rejects(invoke(value), /native 4096-byte conversion window/);
      assert.deepEqual(
        implementation.snapshot(),
        before,
        'No undefined native scratch or truncated value becomes a guest argument',
      );
    }
    assert.equal(machine.state.cells[count], 2);
    assert.equal(first.events.original, 0);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});
