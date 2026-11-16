// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
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

function fixture(text = source) {
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
