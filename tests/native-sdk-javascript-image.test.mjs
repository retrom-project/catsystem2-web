// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { authoredHG3 } from './fixtures/hg3.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const sentinel = 0x13579bdf;
const red = [255, 0, 0, 255, 0, 255, 0, 255];
const blue = [0, 0, 255, 255];
const program = [
  'var image = new CsImage(), alias = image, after = 0;',
  'var result = image.load("sprite,1,2.hg3");',
  'after++;',
  'function GameLoop(frame) {',
  '  if (frame === 3) { if (image === alias) {',
  '    if (result === true) { if (after === 1) cfExit(42); }',
  '  } }',
  '}',
].join('\n');

function fixture(source = program, delay = false) {
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
          [256, 'Owned image JS'],
          [288, 'image.js'],
        ],
      ),
      'image.js': new TextEncoder().encode(source),
      'plain.hg3': authoredHG3([
        {
          width: 2,
          height: 1,
          rgba: red,
          offsetX: 3,
          offsetY: 4,
          canvasWidth: 9,
          canvasHeight: 8,
          baseX: 5,
          baseY: 6,
        },
      ]),
      'sprite_1.hg3': authoredHG3([
        {
          width: 2,
          height: 1,
          rgba: red,
          offsetX: 1,
          offsetY: 2,
          canvasWidth: 9,
          canvasHeight: 8,
          baseX: 3,
          baseY: 4,
        },
      ]),
      'sprite_02.hg3': authoredHG3([
        {
          width: 1,
          height: 1,
          offsetX: 2,
          offsetY: 2,
          canvasWidth: 9,
          canvasHeight: 8,
          baseX: 3,
          baseY: 4,
          rgba: blue,
        },
      ]),
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
    events = { reads: [], native: [], packets: [], original: 0 },
    originalRead = game.read,
    native = world.runtime.native,
    send = world.sendNativeEngine;
  let notify, permit;
  const entered = new Promise((resolve) => {
      notify = resolve;
    }),
    blocked = new Promise((resolve) => {
      permit = resolve;
    });
  let pending = delay;
  game.read = function (...args) {
    events.reads.push(args[0]);
    if (pending && ['sprite_1.hg3', 'plain.hg3'].includes(args[0])) {
      pending = false;
      notify();
      return blocked.then(() => originalRead.apply(this, args));
    }
    return originalRead.apply(this, args);
  };
  world.ensureNativeEngine = () => {
    events.original++;
    throw new Error('normal CsImage attempted original CPU');
  };
  world.runtime.native = function (...args) {
    events.native.push(args[1]);
    return native.apply(this, args);
  };
  world.sendNativeEngine = function (...args) {
    events.packets.push({
      target: args[0],
      sender: args[1],
      id: args[2],
      w: args[3],
      l: args[4],
      flags: args[5]?.flags,
    });
    return send.apply(this, args);
  };
  return { world, events, entered, release: permit };
}
function task(world) {
  return world.objects.objects.get(world.resolveTaskID(world.main.machine.load(68), world.main.id));
}
function cell(world, name) {
  const machine = task(world).implementation.machine;
  return machine.state.cells[machine.cell(0, name)];
}
function hostImage(world) {
  return world.runtime.handles.get(cell(world, 'image').hostObject, 'javascript-image');
}
function assertData(value, seen = new Set()) {
  assert.notEqual(typeof value, 'function');
  assert.equal(value instanceof Promise, false);
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const item of value instanceof Map ? [...value].flat() : Object.values(value))
    assertData(item, seen);
}
async function actualIO(f, initialization) {
  await Promise.race([
    f.entered,
    initialization.then(() => {
      throw new Error('initialization returned without the actual delayed image read');
    }),
  ]);
}

test('normal SDK CsImage resumes real selector IO and restores shared host references without replay', async () => {
  const first = fixture(program, true),
    fresh = fixture();
  let initialization;
  try {
    initialization = first.world.initialize('main.kcs');
    await actualIO(first, initialization);
    assert.equal(task(first.world).kind, 55);
    assert.equal(task(first.world).implementation.loaded, false);
    assert.equal(
      cell(first.world, 'after'),
      0,
      'guest statements cannot pass a pending native load',
    );
    assert.equal(cell(first.world, 'result'), undefined);
    assert.throws(() => first.world.snapshot(), /settled|pending|callback/);
    first.release();
    await initialization;
    assert.equal(cell(first.world, 'result'), true);
    assert.equal(cell(first.world, 'after'), 1, 'IO resumes the same call once');
    const imageRecord = hostImage(first.world),
      bitmap = imageRecord.bitmap;
    assert.ok(bitmap);
    assert.equal(imageRecord.owner, task(first.world).id);
    assert.equal(imageRecord.slot, 1);
    assert.equal(imageRecord.plane, 0, 'no explicit plane and no drawable has been created');
    assert.deepEqual(
      [imageRecord.x, imageRecord.y, imageRecord.anchorX, imageRecord.anchorY],
      [2, 2, 3, 4],
    );
    const state = first.world.graphics.images.get(bitmap).state;
    assert.deepEqual(
      [state.offsetX, state.offsetY, state.canvasWidth, state.canvasHeight],
      [0, 0, 2, 1],
    );
    assert.deepEqual(
      first.events.packets.filter((x) => [277, 286, 296].includes(x.id)),
      [],
      'the no-plane native branch does not publish draw items',
    );
    assert.deepEqual(
      await first.world.graphics.images.get(bitmap).pixels(),
      Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 255]),
    );
    assert.equal(first.world.main.machine.load(first.world.main.machine.sp - 4), sentinel);
    await first.world.tick();
    assert.equal(first.world.frame, 2);
    const checkpoint = structuredClone(first.world.snapshot());
    assertData(checkpoint);
    let draws = 0;
    for (const generator of [fresh.world.random.integer, fresh.world.random.real]) {
      const next = generator.nextUint32;
      generator.nextUint32 = function (...args) {
        draws++;
        return next.apply(this, args);
      };
    }
    await fresh.world.restore(structuredClone(checkpoint));
    assert.deepEqual(
      fresh.world.snapshot(),
      checkpoint,
      'the restored World is exact without a warm frame',
    );
    assert.deepEqual(
      fresh.events.reads,
      ['main.kcs'],
      'cold Script restore reads only its immutable KCS; image bytes and JavaScript source are not replayed',
    );
    assert.deepEqual(fresh.events.native, []);
    assert.deepEqual(fresh.events.packets, []);
    assert.equal(draws, 0);
    assert.equal(cell(fresh.world, 'image').hostObject, cell(fresh.world, 'alias').hostObject);
    assert.notEqual(hostImage(fresh.world), hostImage(first.world));
    await fresh.world.tick();
    assert.equal(
      task(fresh.world).exitCode,
      42,
      'restored guest identity and continuation both execute',
    );
    assert.equal(task(first.world).exitCode, -1);
    await first.world.tick();
    assert.equal(task(first.world).exitCode, 42);
    assert.deepEqual(fresh.world.snapshot(), first.world.snapshot());
    const owner = task(first.world),
      scriptID = first.world.nativeTaskID(first.world.main.id);
    await first.world.objects.release(owner.id);
    assert.equal(
      first.world.objects.objects.has(first.world.main.id),
      true,
      'the borrowed Script survives host owner close',
    );
    assert.equal(
      [...first.world.runtime.handles.records.values()].some(
        (x) => x.type === 'javascript-image' && x.value.owner === owner.id,
      ),
      false,
      'the reserved context slot is returned',
    );
    assert.equal(
      first.world.runtime.handles.records.has(bitmap),
      false,
      'owned output is released',
    );
    assert.deepEqual(
      first.events.packets.filter((x) => x.id === 278),
      [{ target: scriptID, sender: owner.id, id: 278, w: 1, l: 0, flags: 0 }],
      'raw SDK276 is sent as Script canonical278, independently of its unhandled transport result',
    );
    assert.deepEqual(
      await fresh.world.graphics.images.get(bitmap).pixels(),
      Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 255]),
    );
    assert.equal(first.events.original + fresh.events.original, 0);
  } finally {
    first.release();
    await initialization?.catch(() => {});
    await fresh.world.close();
    await first.world.close();
  }
  assert.equal(first.world.objects.objects.size, 0);
  assert.equal(fresh.world.objects.objects.size, 0);
});

test('normal SDK CsImage returns real missing-load false and releases its previous owned bitmap', async () => {
  const f = fixture(
    [
      'var image = new CsImage();',
      'var baseResult = image.setBaseType("scene");',
      'var first = image.load("plain.hg3"), missing;',
      'function GameLoop(frame) { missing = image.load("absent.hg3"); if (first === true) { if (missing === false) {',
      '  if (baseResult === undefined) cfExit(42);',
      '} } }',
    ].join('\n'),
  );
  try {
    await f.world.initialize('main.kcs');
    assert.equal(cell(f.world, 'first'), true);
    assert.equal(hostImage(f.world).baseType, 0);
    const bitmap = hostImage(f.world).bitmap,
      state = f.world.graphics.images.get(bitmap).state;
    assert.deepEqual(
      [
        hostImage(f.world).x,
        hostImage(f.world).y,
        hostImage(f.world).anchorX,
        hostImage(f.world).anchorY,
      ],
      [5, 6, 0, 0],
    );
    assert.deepEqual(
      [state.offsetX, state.offsetY, state.canvasWidth, state.canvasHeight],
      [3, 4, 9, 8],
      'scene mode preserves source extents',
    );
    await f.world.tick();
    assert.equal(cell(f.world, 'missing'), false);
    assert.equal(f.world.runtime.handles.records.has(bitmap), false);
    assert.equal(hostImage(f.world).bitmap, 0);
    assert.equal(
      [...f.world.runtime.handles.records.values()].filter((x) => x.type === 'bitmap').length,
      0,
    );
    assert.equal(task(f.world).exitCode, 42);
    assert.equal(f.events.original, 0);
  } finally {
    await f.world.close();
  }
  assert.equal(
    [...f.world.runtime.handles.records.values()].some((x) => x.type === 'javascript-image'),
    false,
  );
});

test('normal SDK CsImage discards late IO after its real owner closes', async () => {
  const f = fixture(
    'var image = new CsImage(); var result = image.load("plain.hg3"); function GameLoop(frame) { cfExit(42); }',
    true,
  );
  let initialization;
  try {
    initialization = f.world.initialize('main.kcs');
    await actualIO(f, initialization);
    const record = task(f.world),
      image = hostImage(f.world);
    assert.equal(record.implementation.loaded, false);
    assert.equal(image.bitmap, 0);
    await f.world.objects.release(record.id);
    assert.equal(f.world.objects.objects.has(record.id), false);
    assert.equal(
      f.world.objects.objects.has(f.world.main.id),
      true,
      'close does not release the borrowed Script',
    );
    assert.equal(
      [...f.world.runtime.handles.records.values()].some((x) => x.type === 'javascript-image'),
      false,
      'pending close returns its context slot',
    );
    assert.deepEqual(
      f.events.packets.filter((x) => x.id === 278),
      [
        {
          target: f.world.nativeTaskID(f.world.main.id),
          sender: record.id,
          id: 278,
          w: image.slot,
          l: 0,
          flags: 0,
        },
      ],
    );
    f.release();
    await assert.rejects(initialization, /JavaScript image owner is closed/);
    assert.equal(
      [...f.world.runtime.handles.records.values()].some((x) =>
        ['javascript-image', 'bitmap', 'bitmap-data'].includes(x.type),
      ),
      false,
    );
    assert.equal(f.events.original, 0);
  } finally {
    f.release();
    await initialization?.catch(() => {});
    await f.world.close();
  }
});

test('normal SDK CsImage enforces its finite signed32 base-type numeric domain', async () => {
  for (const value of [-2147483649, 2147483648, 4294967296, 0.5]) {
    const f = fixture(
      `var image = new CsImage(); image.setBaseType(${value}); function GameLoop(frame) { cfExit(42); }`,
    );
    try {
      await assert.rejects(
        f.world.initialize('main.kcs'),
        /Unsupported JavaScript host import.*CsImage arguments or method.*image\.js:1:/,
        `unsupported numeric input ${value} must fail with its real source span`,
      );
      assert.equal(f.events.original, 0);
    } finally {
      await f.world.close();
    }
  }
  for (const [value, expected] of [
    [-2147483648, 1],
    [0, 0],
    [2147483647, 1],
  ]) {
    const f = fixture(
      `var image = new CsImage(); var result = image.setBaseType(${value}); var loaded = image.load("plain.hg3"); function GameLoop(frame) { if (loaded === true) { if (result === undefined) cfExit(42); } }`,
    );
    try {
      await f.world.initialize('main.kcs');
      assert.equal(hostImage(f.world).baseType, expected);
      await f.world.tick();
      assert.equal(task(f.world).exitCode, 42);
      assert.equal(f.events.original, 0);
    } finally {
      await f.world.close();
    }
  }
});

test('normal SDK kind55 rejects late source IO without reviving its closed owner', async () => {
  const f = fixture('var after = 1; function GameLoop(frame) { after++; }');
  const originalRead = f.world.game.read;
  let signal, release;
  const entered = new Promise((resolve) => {
      signal = resolve;
    }),
    blocked = new Promise((resolve) => {
      release = resolve;
    });
  f.world.game.read = function (...args) {
    if (args[0] === 'image.js') {
      signal();
      return blocked.then(() => originalRead.apply(this, args));
    }
    return originalRead.apply(this, args);
  };
  let initialization;
  try {
    initialization = f.world.initialize('main.kcs');
    await Promise.race([
      entered,
      initialization.then(() => {
        throw new Error('source load did not enter its actual delayed read');
      }),
    ]);
    const record = task(f.world),
      implementation = record.implementation;
    assert.equal(implementation.machine, null);
    const closing = f.world.objects.release(record.id);
    await closing;
    assert.equal(f.world.objects.objects.has(record.id), false);
    assert.equal(
      f.world.objects.objects.has(f.world.main.id),
      true,
      'closing the JS task retains its borrowed Script',
    );
    const handles = [...f.world.runtime.handles.records.keys()];
    release();
    let failure;
    await initialization.catch((error) => {
      failure = error;
    });
    assert.equal(
      implementation.machine,
      null,
      'late pure JavaScript source must not publish or execute a ghost machine',
    );
    assert.equal(implementation.loaded, false);
    assert.equal(implementation.running, false);
    assert.match(failure?.message ?? '', /JavaScript.*owner is closed/);
    assert.deepEqual(
      [...f.world.runtime.handles.records.keys()],
      handles,
      'late source creates no handle',
    );
    assert.equal(f.events.original, 0);
  } finally {
    release();
    await initialization?.catch(() => {});
    await f.world.close();
  }
});

function hostPlane(world, name = 'plane') {
  return world.runtime.handles.get(cell(world, name).hostObject, 'javascript-plane');
}
function planeTask(world, name = 'plane') {
  return world.objects.objects.get(hostPlane(world, name).child);
}
function observePlanePackets(world) {
  const events = [],
    send = world.sendNativeEngine;
  world.sendNativeEngine = function (...args) {
    const [target, sender, id, w, l, context] = args;
    const count = id === 41 ? 8 : [49, 51, 66].includes(id) ? 3 : id === 57 ? 16 : 0;
    events.push({
      target,
      sender,
      id,
      w,
      l,
      flags: context?.flags,
      words:
        count && context?.payload?.load
          ? Array.from({ length: count }, (_, i) => context.payload.load(l + i * 4))
          : null,
    });
    return send.apply(this, args);
  };
  return events;
}

test('normal SDK CsPlane creates real VRAM children with independent constructor vectors', async () => {
  const f = fixture(
    'var plane = new CsPlane(800,600,0,0,0), alias = plane; var offset = new CsPlane(9,7,3,-2,11); function GameLoop(frame) { if (frame === 2) { if (plane === alias) cfExit(42); } }',
  );
  const packets = observePlanePackets(f.world);
  try {
    await f.world.initialize('main.kcs');
    const owner = task(f.world),
      first = planeTask(f.world),
      second = planeTask(f.world, 'offset');
    assert.equal(first.kind, 2);
    assert.equal(second.kind, 2);
    assert.notEqual(first.id, second.id);
    assert.equal(
      first.parent,
      owner.id,
      'self creation is under the kind55 owner, not its borrowed Script',
    );
    assert.equal(second.parent, owner.id);
    assert.equal(first.creator, owner.id);
    assert.equal(first.name, 'JS Plane');
    assert.equal(f.world.objects.objects.has(f.world.main.id), true);
    assert.deepEqual(cell(f.world, 'plane'), cell(f.world, 'alias'));
    const graph = first.implementation.graph,
      other = second.implementation.graph;
    assert.ok(graph && other, 'the real Plane receiver must allocate its graphs');
    assert.deepEqual(
      [graph.type, graph.vram, graph.width, graph.height, graph.registrationEnabled],
      [1, true, 800, 600, false],
    );
    assert.equal(first.implementation.state.shown, false);
    assert.equal(f.world.graphics.tasks.get(first.id), first.implementation);
    assert.deepEqual(motionVector(other.kx2, MOTION_ABI.base), [0, 0, 11]);
    assert.deepEqual(motionVector(other.kx2, MOTION_ABI.pos), [0, 0, 0]);
    assert.deepEqual(motionVector(other.textureTransform, MOTION_ABI.pos), [3, -2, 0]);
    assert.notEqual(
      other.kx2,
      other.textureTransform,
      'VRAM w1 must not alias its physical transform',
    );
    const published = packets.filter(
      (x) => x.target === second.nativeID && [41, 51, 49, 66, 57, 59, 47].includes(x.id),
    );
    assert.deepEqual(
      published.map((x) => [x.sender, x.id, x.w, x.l, x.flags]),
      [
        [owner.id, 41, 0, 0, 0],
        [owner.id, 51, 1, 0, 0],
        [owner.id, 51, 0, 0, 0],
        [owner.id, 49, 0, 0, 0],
        [owner.id, 66, 0, 0, 0],
        [owner.id, 57, 0, 0, 0],
        [owner.id, 59, 1, 4294967295, 0],
        [owner.id, 47, 0, 0, 0],
      ],
    );
    assert.deepEqual(
      published[0].words,
      [0, 0, 1093664768, 1091567616, 1088421888, 32, 1, 4294967295],
    );
    assert.deepEqual(published[1].words, [1077936128, 3221225472, 0]);
    assert.deepEqual(published[2].words, [0, 0, 0]);
    assert.deepEqual(published[3].words, [0, 0, 1093664768]);
    assert.deepEqual(published[4].words, [1065353216, 1065353216, 1065353216]);
    assert.deepEqual(
      published[5].words,
      [1065353216, 0, 0, 0, 0, 1065353216, 0, 0, 0, 0, 1065353216, 0, 0, 0, 0, 1065353216],
    );
    assert.equal(f.world.main.machine.load(f.world.main.machine.sp - 4), sentinel);
    await f.world.tick();
    assert.equal(task(f.world).exitCode, 42);
    await f.world.objects.release(owner.id);
    for (const child of [first, second]) {
      assert.equal(f.world.objects.objects.has(child.id), false);
      assert.equal(f.world.graphics.tasks.has(child.id), false);
      assert.equal(f.world.graphics.graphs.has(child.nativeID), false);
    }
    assert.equal(f.world.objects.objects.has(f.world.main.id), true);
    assert.equal(
      [...f.world.runtime.handles.records.values()].some((x) => x.type === 'javascript-plane'),
      false,
    );
    assert.equal(f.events.original, 0);
  } finally {
    await f.world.close();
  }
});

test('normal SDK CsPlane restores mixed host aliases without replay and isolates owners', async () => {
  const first = fixture(
    'var plane = new CsPlane(9,7,3,-2,11), alias = plane; var image = new CsImage(), imageAlias = image; var result = image.load("plain.hg3"); function GameLoop(frame) { if (frame === 3) { if (plane === alias) { if (image === imageAlias) { if (result === true) cfExit(42); } } } }',
  );
  const fresh = fixture(),
    invalid = fixture();
  try {
    await first.world.initialize('main.kcs');
    await first.world.tick();
    const checkpoint = structuredClone(first.world.snapshot());
    assertData(checkpoint);
    let draws = 0;
    for (const generator of [fresh.world.random.integer, fresh.world.random.real]) {
      const next = generator.nextUint32;
      generator.nextUint32 = function (...args) {
        draws++;
        return next.apply(this, args);
      };
    }
    await fresh.world.restore(structuredClone(checkpoint));
    assert.deepEqual(
      fresh.world.snapshot(),
      checkpoint,
      'mixed aliases and actual Plane graphs restore with zero warm frames',
    );
    assert.deepEqual(fresh.events.reads, ['main.kcs']);
    assert.deepEqual(fresh.events.native, []);
    assert.deepEqual(fresh.events.packets, []);
    assert.equal(draws, 0);
    assert.deepEqual(cell(fresh.world, 'plane'), cell(fresh.world, 'alias'));
    assert.deepEqual(cell(fresh.world, 'image'), cell(fresh.world, 'imageAlias'));
    assert.notEqual(
      planeTask(first.world).implementation.graph,
      planeTask(fresh.world).implementation.graph,
    );
    const corrupt = structuredClone(checkpoint);
    const ownerDTO = corrupt.objects.objects.find((x) => x.kind === 55);
    ownerDTO.data.machine.cells[task(first.world).implementation.machine.cell(0, 'plane')] = {
      hostObject: 2147483647,
    };
    await assert.rejects(
      invalid.world.restore(corrupt),
      /JavaScript.*host|JavaScript.*reference|handle/i,
      'unknown mixed host references must not be silently filtered',
    );
    await first.world.tick();
    await fresh.world.tick();
    assert.equal(task(first.world).exitCode, 42);
    assert.equal(task(fresh.world).exitCode, 42);
    const child = planeTask(fresh.world),
      bitmap = hostImage(fresh.world).bitmap;
    await first.world.objects.release(task(first.world).id);
    assert.equal(fresh.world.objects.objects.get(child.id), child);
    assert.deepEqual(
      await fresh.world.graphics.images.get(bitmap).pixels(),
      Uint8ClampedArray.from(red),
    );
    await fresh.world.objects.release(task(fresh.world).id);
    assert.equal(fresh.world.objects.objects.has(child.id), false);
    assert.equal(fresh.world.objects.objects.has(fresh.world.main.id), true);
    assert.equal(first.events.original + fresh.events.original + invalid.events.original, 0);
  } finally {
    await first.world.close();
    await fresh.world.close();
    await invalid.world.close();
  }
});

test('normal SDK CsPlane cancels its real pending child creation when the owner closes', async () => {
  const f = fixture(
    'var plane = new CsPlane(9,7,3,-2,11); var after = 1; function GameLoop(frame) { cfExit(42); }',
  );
  const original = f.world.objects.factories.get(2);
  let enter, release;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    blocked = new Promise((resolve) => {
      release = resolve;
    });
  let created,
    calls = 0,
    initialization;
  f.world.objects.factories.set(2, function (...args) {
    const value = original.apply(this, args);
    calls++;
    created = args[0];
    enter();
    return blocked.then(() => value);
  });
  try {
    initialization = f.world.initialize('main.kcs');
    await Promise.race([
      entered,
      initialization.then(() => {
        throw new Error('constructor did not enter its real child factory');
      }),
    ]);
    const owner = task(f.world),
      implementation = owner.implementation;
    assert.equal(calls, 1);
    assert.equal(cell(f.world, 'after'), undefined);
    assert.throws(() => f.world.snapshot(), /settled|pending|callback/);
    await f.world.objects.release(owner.id);
    assert.equal(f.world.objects.objects.has(f.world.main.id), true);
    release();
    await assert.rejects(initialization, /JavaScript.*owner is closed/);
    assert.equal(implementation.machine, null);
    assert.equal(implementation.loaded, false);
    assert.equal(implementation.running, false);
    assert.equal(f.world.objects.objects.has(created.id), false);
    assert.equal(f.world.graphics.tasks.has(created.id), false);
    assert.equal(
      [...f.world.runtime.handles.records.values()].some((x) => x.type === 'javascript-plane'),
      false,
    );
    assert.equal(f.events.original, 0);
  } finally {
    release();
    await initialization?.catch(() => {});
    await f.world.close();
  }
});
