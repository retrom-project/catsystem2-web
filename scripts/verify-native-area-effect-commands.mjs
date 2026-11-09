// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NATIVE_ENGINE_IMAGES, NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeAreaEffectCommands } from '../src/native/area-effect-commands.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { bitsFloat, floatBits, KCSMachine, readKCS } from '../src/kcs.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!filename || !output)
  throw new Error(
    'Usage: node scripts/verify-native-area-effect-commands.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Area effect oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({
    bytes,
    profile,
    configuration: new NativeConfiguration({ profile }),
  }),
  p = engine.process,
  mainTable = sdk ? 0xb3c900 : 0xa2dd38,
  m = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(512)),
  out = p.allocate(12, true),
  argv = p.allocate(12, true),
  host = p.allocate(8, true),
  vtable = p.allocate(20, true),
  sender = 17,
  scratchFill = new Uint8Array(12).fill(0xa5),
  packet = p.allocate(24, true),
  initMessages = [265, 263, 266, 267, 268, 269, 270, 271, 272, 274, 275, 276, 274, 277, 278],
  followUpMessages = new Map([
    [0xc4, new Map(initMessages.map((message, index) => [17 + index, message]))],
    [
      0xc9,
      new Map([
        [18, 264],
        [25, 273],
      ]),
    ],
    [
      0xca,
      new Map([
        [26, 260],
        [27, 260],
      ]),
    ],
  ]),
  commands = new Map([
    [0xc4, 13],
    [0xc5, 257],
    [0xc6, 258],
    [0xc7, 262],
    [0xc8, 259],
    [0xc9, 13],
    [0xca, 13],
    [0xcb, 261],
  ]);
let events = [],
  replyWord,
  writeReply,
  statusInput,
  commandID,
  activeEffect = 0,
  operations = 0,
  wrapperChecks = 0,
  receiverChecks = 0;
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  if (activeEffect) receiverChecks++;
  else wrapperChecks++;
};
const observedBytes = (message) => {
  if (message === 262) return 64;
  if (message === 266) return 40;
  if (message === 267) return 12;
  if (message === 277) return 60;
  if (message === 278) return 52;
  return [260, 264, 273].includes(message) ? 20 : 56;
};
const observe = (from, target, message, w, l, flags, result) => {
  if (message === 259 || message === 13) statusInput = p.load(result);
  events.push({
    from,
    target,
    message,
    w,
    flags,
    source: l ? Array.from(p.read(l, observedBytes(message))) : null,
    initial:
      message === 13 && commandID === 0xc4
        ? statusInput
        : message === 13 || message === 259
          ? 'caller'
          : null,
  });
  if (message === 262) p.write(l, new Uint8Array(64).fill(0x5a));
  return writeReply ? replyWord : undefined;
};
const adapter = new NativeAreaEffectCommands(engine, {
  objects: { machine: () => null, objects: new Map() },
  nativeTaskID: () => sender,
  resolveTaskID: () => null,
  async sendNativeEngine(target, origin, message, w, l, context) {
    assert.equal(origin, 41);
    context.nativeRouted = target !== 0xffffffff;
    return observe(
      context.nativeSender,
      target,
      message,
      w,
      l,
      context.flags,
      context.nativeResult,
    );
  },
});
for (const [name, definition] of nativeRectangleDefinitions(p))
  engine.registerWindows('USER32.dll', name, definition);
p.store(host, vtable);
p.store(host + 4, sender);
p.store(
  vtable + 16,
  p.trap(
    'original area effect transport boundary',
    7,
    async ([from, target, raw, w, l, flags, result]) => {
      if (activeEffect) {
        [target, from, raw, w, l, flags].forEach((value, i) => p.store(packet + 4 * i, value));
        await engine.callFromHost(
          p.load(p.load(activeEffect) + 24),
          [packet, result],
          activeEffect,
        );
        return 1;
      }
      const message = sdk && raw !== 13 ? raw + 5 : raw,
        value = observe(from, target, message, w, l, flags, result);
      if (value !== undefined) p.store(result, value);
      return Number(target !== 0xffffffff);
    },
  ),
);
const callOriginal = async (id, args, memory) => {
  const slot = mainTable + id * 4;
  args.forEach((word, i) => p.store(argv + i * 4, word));
  p.write(out, scratchFill);
  const control = await engine.call(p.load(slot), [memory, host, argv, out + 4], slot, {
    task: 41,
  });
  return control === 1 ? { control, value: p.load(out + 4) } : { control };
};
const vmState = () => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];

try {
  const block = m.allocate(512),
    locations = [0, 112, 0x80000040, block + 128, 0xffffffff],
    matrixLocations = [0, 113, 0x80000041, block + 129, block + 448],
    words = [0, 1, 0x80000000, 0xffffffff];
  for (const [i, address] of [
    ...new Set([...locations.slice(0, -1), ...matrixLocations]),
  ].entries())
    m.bytes(address, 64).set(Uint8Array.from({ length: 64 }, (_, j) => (i * 23 + j * 37) & 255));
  for (const [id, firstMessage] of commands) {
    commandID = id;
    const isInit = id === 0xc4,
      hasSelector = id === 0xc9,
      matrix = id === 0xc7,
      addresses = matrix ? matrixLocations : firstMessage === 13 ? locations : [0],
      queriesKind = firstMessage === 13,
      kindMessages = followUpMessages.get(id),
      values = queriesKind
        ? [...Array.from({ length: 33 }, (_, i) => i), ...words.slice(2)]
        : words;
    for (const target of words)
      for (const selector of hasSelector ? [0, 1, 0xffffffff] : [0])
        for (replyWord of values)
          for (const address of addresses)
            for (writeReply of [false, true]) {
              const args = [target],
                before = vmState(),
                memory = new NativeKCSMemory(p, m);
              if (hasSelector) args.push(selector);
              if (queriesKind || matrix) args.push(address);
              events = [];
              let native;
              try {
                native = await callOriginal(id, args, memory.pointer);
              } finally {
                memory.close();
              }
              const followUp =
                  writeReply && selector === 0 ? kindMessages?.get(replyWord) : undefined,
                expectedMessages = [firstMessage, ...(followUp ? [followUp] : [])],
                expectedEvents = events;
              equal(
                events.map((event) => event.message),
                expectedMessages,
                'original message IDs',
              );
              if (isInit) equal(events[0].initial, mainTable + 4 * id, 'GCALL slot remains in ECX');
              if (matrix)
                equal(
                  events[0].source,
                  Array.from(m.bytes(address, 64)),
                  'original C7 copies all matrix bytes',
                );
              if (queriesKind && !isInit)
                equal(statusInput, host, 'kind query starts with caller word');
              if (followUp)
                equal(
                  events[1].source,
                  address === 0xffffffff
                    ? null
                    : Array.from(m.bytes(address, observedBytes(followUp))),
                  'original VM address translation',
                );
              equal(
                [...p.read(out, 4), ...p.read(out + 8, 4)],
                new Array(8).fill(0xa5),
                'original result canaries',
              );
              if (native.control === 2)
                equal(p.load(out + 4), 0xa5a5a5a5, 'original void result is unwritten');
              events = [];
              const actual = await adapter.apply(id, args, m, { id: 41 });
              if (queriesKind && !isInit)
                equal(p.allocations.has(statusInput), false, 'kind query used caller scratch');
              if (id === 0xc8 && !writeReply) {
                equal(native.value, host, 'unwritten original C8 copies the caller pointer');
                equal(actual.value, statusInput, 'adapter preserves the unwritten caller word');
                native.value = actual.value;
              }
              equal(actual, native, 'complete wrapper result');
              equal(events, expectedEvents, 'complete original packet envelope and bytes');
              equal(vmState(), before, 'all VM regions remain unchanged');
              operations++;
            }
  }

  for (const address of [0xffffffff, block + 449])
    await assert.rejects(adapter.apply(0xc7, [1, address], m, { id: 41 }), /KCS memory/);

  const faultMemory = new NativeKCSMemory(p, m);
  events = [];
  p.cpu.mem_protect(0, 4096, 0);
  try {
    await assert.rejects(
      callOriginal(0xc7, [1, 0xffffffff], faultMemory.pointer),
      (error) =>
        error.nativeFault?.pc === (sdk ? 0x529a1b : 0x6418ab) &&
        error.nativeFault.registers.EAX === 0,
    );
    equal(events.length, 0, 'original C7 faults on NULL translation before dispatch');
  } finally {
    p.cpu.mem_protect(0, 4096, p.uc.PROT_ALL);
    faultMemory.close();
  }

  // The reference path uses the original task factory and original receivers.
  // Only its transport and final bitmap upload are supplied.
  const abi = sdk
      ? [0x4b8cd0, 0x4b9f40, 0x9933b4, 0x561f40, 0x562970, 0x563a90, 0x54e790]
      : [0x5dcab0, 0x5ddcb0, 0x8ce0d4, 0x68b3e0, 0x68be00, 0x68cf20, 0x677690],
    [base, factory, wipeVtable, bitmapCtor, bitmapSize, bitmapRelease, upload] = abi,
    view = p.allocate(280, true),
    parent = p.allocate(280, true),
    name = p.allocate(32, true),
    raster = [],
    width = 8,
    height = 6,
    previous = 0xffff0000,
    next = 0xff0000ff;
  p.write(name, new TextEncoder().encode('Authored Wipe2\0'));
  await engine.call(base, [sender, name, 60], parent);
  p.store(parent + 104, view);
  p.store(parent + 100, 20);
  activeEffect = await engine.call(factory, [29, name, out + 4], parent);
  let nativeID = p.load(out + 4);
  const callWipe = (id, ...args) => callOriginal(id, [nativeID, ...args], memory.pointer);
  equal(p.load(activeEffect), wipeVtable, 'original factory constructs the Wipe2 receiver');
  equal(p.load(activeEffect + 64), 29, 'original factory assigns kind');
  equal(p.load(activeEffect + 100), 20, 'original factory inherits current task clock');
  const makeBitmap = async (pixel, dimensions = [width, height, 4]) => {
    const bitmap = p.allocate(92, true),
      wrapper = p.allocate(4, true);
    await engine.call(bitmapCtor, [], bitmap);
    assert.ok(await engine.call(bitmapSize, dimensions, bitmap));
    const data = p.load(bitmap + 12),
      stride = p.load(bitmap + 20);
    if (pixel)
      for (let y = 0; y < dimensions[1]; y++)
        for (let x = 0; x < dimensions[0]; x++) p.store(data + y * stride + x * 4, pixel(x, y));
    p.store(wrapper, bitmap);
    return { wrapper, bitmap };
  };
  const sources = await Promise.all([
    makeBitmap(() => previous),
    makeBitmap(() => next),
    makeBitmap((x) => (0xff470d00 | [0, 32, 64, 96, 128, 160, 192, 255][x]) >>> 0),
  ]);
  engine.patch(
    upload,
    'original area effect bitmap upload boundary',
    7,
    ([bitmap, sx, sy, w, h, x, y]) => {
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, view);
      const data = p.load(bitmap + 12),
        stride = p.load(bitmap + 20);
      raster.push({
        bitmap,
        sx,
        sy,
        w,
        h,
        x,
        y,
        pixels: Array.from({ length: h }, (_, row) =>
          Array.from({ length: w }, (_, col) =>
            p.load(data + (row + sy) * stride + 4 * (col + sx)),
          ),
        ),
      });
      return 1;
    },
    { calleePops: true },
  );
  const values = [
    4,
    sources[0].wrapper,
    0,
    0,
    sources[1].wrapper,
    0,
    0,
    sources[2].wrapper,
    4,
    3,
    0,
    0,
    0,
    0,
  ];
  values.forEach((word, i) => m.store(112 + i * 4, word));
  const memory = new NativeKCSMemory(p, m),
    frame = async (at) => {
      const table = p.load(activeEffect);
      await engine.call(p.load(table + 8), [at, out], activeEffect);
      await engine.call(p.load(table + 12), [at], activeEffect);
    },
    expectRaster = (redColumns) => {
      equal(raster.length, 1, 'exactly one original upload');
      const { bitmap, ...result } = raster.pop();
      equal(
        result,
        {
          sx: 0,
          sy: 0,
          w: width,
          h: height,
          x: 4,
          y: 3,
          pixels: Array.from({ length: height }, () =>
            Array.from({ length: width }, (_, x) => (x < redColumns ? previous : next)),
          ),
        },
        'original Wipe2 mask bytes and upload rectangle',
      );
      return bitmap;
    };
  try {
    equal(await callWipe(0xc8), { control: 1, value: 0 }, 'fresh Wipe2 inactive');
    equal(await callWipe(0xc4, 112), { control: 2 }, 'full original init through factory receiver');
    const working = p.load(activeEffect + 164);
    const initialized = new Uint32Array(p.read(activeEffect + 108, 56).buffer);
    equal(
      [...initialized],
      values.map((word, i) => (i === 10 ? width : i === 11 ? height : word)),
      'original init fields copied and measured',
    );
    equal(p.allocations.get(working), 92, 'work bitmap allocated by original receiver');
    equal(await callWipe(0xc5), { control: 2 }, 'start wrapper');
    equal(await callWipe(0xc8), { control: 1, value: 1 }, 'Wipe2 active');
    for (const [at, red] of [
      [21, 6],
      [22, 4],
      [23, 2],
      [24, 0],
    ]) {
      await frame(at);
      equal(
        expectRaster(red),
        red ? working : sources[1].bitmap,
        'original upload source identity',
      );
    }
    equal(await callWipe(0xc8), { control: 1, value: 0 }, 'time-completed Wipe2 inactive');
    equal(await callWipe(0xcb), { control: 2 }, 'CB ignores an inactive Wipe2');
    equal(raster.length, 0, 'inactive CB leaves VRAM alone');
    for (const id of [0xcb, 0xc6]) {
      await callWipe(0xc5);
      equal(await callWipe(id), { control: 2 }, 'force-finish wrapper');
      equal(expectRaster(0), sources[1].bitmap, 'force-finish uses the destination');
      equal(await callWipe(0xc8), { control: 1, value: 0 }, 'force-finished Wipe2 inactive');
    }
    await callWipe(0xc6);
    equal(expectRaster(0), sources[1].bitmap, 'C6 also finishes an initialized idle effect');
    const source = p.load(memory.pointer + 20) + 112,
      replacement = source + 64;
    p.store(replacement + 4, sources[1].wrapper);
    p.store(replacement + 16, sources[0].wrapper);
    [nativeID, sender, sdk ? 255 : 260, 0, replacement, 0].forEach((word, i) =>
      p.store(packet + 4 * i, word),
    );
    await engine.call(p.load(wipeVtable + 24), [packet, out], activeEffect);
    equal(
      [112, 124, 136].map((offset) => p.load(activeEffect + offset)),
      [sources[1].wrapper, sources[0].wrapper, sources[2].wrapper],
      'original message 260 replaces the borrowed input pair',
    );
    await callWipe(0xc6);
    const replaced = raster.pop();
    equal(replaced.bitmap, sources[0].bitmap, 'finish uses replaced destination identity');
    equal(
      replaced.pixels.flat(),
      new Array(width * height).fill(previous),
      'replaced destination pixels',
    );
    p.store(source + 28, 0);
    await callWipe(0xc4, 112);
    equal(p.load(activeEffect + 168), 0, 'missing mask leaves original effect uninitialized');
    equal(p.load(activeEffect + 164), 0, 'missing mask clears the old work pointer');
    equal(p.allocations.has(working), false, 'reinitialization releases original work bitmap');
    await callWipe(0xc5);
    equal(await callWipe(0xc8), { control: 1, value: 0 }, 'uninitialized start has no effect');
    p.store(source + 28, sources[2].wrapper);
    await callWipe(0xc4, 112);
    const finalWork = p.load(activeEffect + 164);
    await engine.call(p.load(wipeVtable), [1], activeEffect);
    equal(p.allocations.has(activeEffect), false, 'original destructor releases actor');
    equal(p.allocations.has(finalWork), false, 'original destructor releases work bitmap');
    const wrongSize = await makeBitmap(null, [width + 1, height, 4]),
      wrongBpp = await makeBitmap(null, [width, height, 3]),
      diagnostics = [],
      log = p.beforeInstruction(
        sdk ? 0x4a82f0 : 0x5cac90,
        'observe original Fade validation',
        () => {
          const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
          diagnostics.push(p.string(p.load(sp + 4)));
        },
      );
    try {
      for (const kind of [26, 27]) {
        activeEffect = await engine.call(factory, [kind, name, out + 4], parent);
        nativeID = p.load(out + 4);
        const fade = kind === 27,
          size = fade ? 176 : 200,
          pair = (first, second) => {
            p.write(replacement, new Uint8Array(24).fill(0xa5));
            p.store(replacement + 4, first.wrapper);
            p.store(replacement + 16, second.wrapper);
          },
          configure = (first, second) => {
            const params = [
              4,
              first.wrapper,
              0,
              0,
              second.wrapper,
              0,
              0,
              ...(fade ? [4, 3, width, height] : [first.wrapper, 4, 3, 0, 0, 0, 0]),
            ];
            params.forEach((word, i) => p.store(source + 4 * i, word));
            return callWipe(0xc4, 112);
          },
          expectColor = (color) => {
            equal(raster.length, 1, 'one original replacement frame is uploaded');
            equal(
              raster.pop().pixels.flat(),
              new Array(width * height).fill(color),
              'all original replacement pixels',
            );
          };
        await configure(sources[0], sources[1]);
        await callWipe(0xc5);
        await frame(21);
        expectColor(fade ? 0xffbf003f : previous);
        equal(await callWipe(0xc8), { control: 1, value: 1 }, 'replacement target is active');
        pair(sources[1], sources[0]);
        const before = p.read(activeEffect, size),
          changed = new DataView(before.buffer),
          beforeInput = p.read(replacement, 24);
        changed.setUint32(112, sources[1].wrapper, true);
        changed.setUint32(124, sources[0].wrapper, true);
        equal(await callWipe(0xca, 176), { control: 2 }, 'original CA replacement result');
        equal(p.read(activeEffect, size), before, 'only the two borrowed pointers change');
        equal(p.read(replacement, 24), beforeInput, 'CA preserves all packet bytes and canary');
        equal(diagnostics.length, 0, 'compatible source replacement has no diagnostic');
        await frame(22);
        expectColor(fade ? 0xff7f007f : next);
        await frame(23);
        expectColor(fade ? 0xffbf003f : 0xff7f007f);
        await frame(24);
        expectColor(previous);
        equal(
          await callWipe(0xc8),
          { control: 1, value: 0 },
          'original deadline remains unchanged',
        );
        for (const candidate of [wrongSize, wrongBpp]) {
          pair(candidate, sources[0]);
          const count = diagnostics.length;
          await callWipe(0xca, 176);
          equal(p.load(activeEffect + 112), candidate.wrapper, 'replacement pointer is retained');
          equal(diagnostics.length - count, Number(fade), 'Fade validates source size and depth');
          if (fade) assert.match(diagnostics.at(-1), /Task_Eff2D_Fade/);
        }
        diagnostics.length = 0;
        const work = p.load(activeEffect + (fade ? 152 : 164));
        await engine.call(p.load(p.load(activeEffect)), [1], activeEffect);
        equal(
          p.allocations.has(activeEffect),
          false,
          'original destructor releases replaced actor',
        );
        equal(p.allocations.has(work), false, 'original destructor releases the same work bitmap');
      }
    } finally {
      log();
    }
    for (const { wrapper, bitmap } of [...sources, wrongSize, wrongBpp]) {
      equal(p.load(wrapper), bitmap, 'original receiver borrows caller wrappers');
      equal(p.allocations.has(bitmap), true, 'actor destruction preserves caller bitmap');
      await engine.call(bitmapRelease, [], bitmap);
      p.free(wrapper);
    }
    // GlassBreak reads both original plane models, builds its shard state,
    // then installs the original vertex callback on the textured model.
    const glass = sdk
        ? {
            capsGlobal: 0xc93b94,
            coreGlobal: 0xc95180,
            manager: 0x54f8e0,
            destroy: 0x54fd00,
            createPlane: 0x551280,
            lookup: 0x5531b0,
            table: 0x993014,
            callback: 0x4ca2a0,
            seed: 0x49e630,
            random: [0x656dd0, 0x656df0],
          }
        : {
            capsGlobal: 0xb8f074,
            coreGlobal: 0xb90778,
            manager: 0x678b60,
            destroy: 0x678fb0,
            createPlane: 0x67a5a0,
            lookup: 0x67c510,
            table: 0x8cdd34,
            callback: 0x5ef970,
            seed: 0x5c1ff0,
            random: [0x7c45a0, 0x7c45c0],
          },
      graphManager = p.allocate(0x220, true),
      caps = p.allocate(0x6cc, true),
      core = p.allocate(0x670, true),
      rng = p.allocate(1, true),
      triangle = p.allocate(52, true),
      glassGraph = 0x80000315,
      textureLayout = engine.options.configuration.fields.texture;
    textureLayout.size.set([64, 64]);
    textureLayout.grid.set([1, 1]);
    textureLayout.areas.forEach((area) => area.fill(0xffffffff));
    [4096, 4096].forEach((word, i) => p.store(caps + 88 + 4 * i, word));
    p.store(glass.capsGlobal, caps);
    p.store(glass.coreGlobal, core);
    p.store(view + 4, 1);
    p.store(view + 8, graphManager);
    const wordsAt = (address, count) =>
      Array.from({ length: count }, (_, i) => p.load(address + 4 * i));
    new NativeEngineFiles(engine, { game: { read: async () => null } });
    await engine.call(glass.random[0], [], rng);
    await engine.call(glass.manager, [], graphManager);
    equal(
      await engine.call(
        glass.createPlane,
        [glassGraph, ...[0, 0, 0, 24, 18].map(floatBits)],
        graphManager,
      ),
      1,
      'original manager creates the paired color and textured models',
    );
    const descriptor = await engine.call(glass.lookup, [glassGraph], graphManager),
      [geometry, texture] = wordsAt(descriptor + 12, 2);
    assert.ok(geometry && texture, 'the original graph contains both models');
    equal(p.load(texture + 396), 2, 'original rectangle has two textured triangles');

    for (const graph of [glassGraph, glassGraph + 1]) {
      activeEffect = await engine.call(factory, [20, name, out + 4], parent);
      nativeID = p.load(out + 4);
      equal(p.load(activeEffect), glass.table, 'original GlassBreak factory');
      equal(p.load(activeEffect + 108), graphManager, 'original GlassBreak capability');
      const init = [graph, floatBits(6), 4, 0xa5a55a5a];
      init.forEach((word, i) => p.store(source + 4 * i, word));
      equal(await callWipe(0xc4, 112), { control: 2 }, 'original GlassBreak initializer');
      equal(wordsAt(activeEffect + 112, 3), init.slice(0, 3), 'three original input words');
      equal(wordsAt(source, 4), init, 'initializer preserves the input and its tail');
      equal(await callWipe(0xc8), { control: 1, value: 0 }, 'initialized GlassBreak is idle');
      await engine.call(glass.seed, [0x8120719]);
      equal(await callWipe(0xc5), { control: 2 }, 'original GlassBreak start control');
      const shards = p.load(activeEffect + 124);
      if (graph === glassGraph) {
        equal(p.load(activeEffect + 136), 2, 'original shard count');
        equal(p.allocations.get(shards - 4), 260, 'two 128-byte shards with the heap header');
        equal(p.load(shards - 4), 1, 'shards are owned by the original task');
        equal(wordsAt(texture + 236, 3), [glass.callback, 0, activeEffect], 'native graph binding');
        equal(await callWipe(0xc8), { control: 1, value: 1 }, 'GlassBreak is active');
        equal(await callWipe(0xcb), { control: 2 }, 'GlassBreak has no CB receiver branch');
        equal(await callWipe(0xc8), { control: 1, value: 1 }, 'CB leaves GlassBreak active');
        const rows = [
            [0, 0, 0, 1, 24, 0, 0, 1, 24, 18, 0, 1],
            [0, 0, 0, 1, 0, 18, 0, 1, 24, 18, 0, 1],
          ],
          initial = rows.map((vertices, i) => {
            const pivot = [i ? 8 : 16, i ? 12 : 6, 0].map(floatBits),
              at = shards + i * 128;
            equal(wordsAt(at + 32, 3), pivot, 'native color triangle centroid');
            equal(wordsAt(at + 48, 3), pivot, 'the centroid is the initial translation');
            const matrix = Array.from({ length: 16 }, (_, index) => (index % 5 ? 0 : floatBits(1)));
            equal(wordsAt(at + 64, 16), matrix, 'the initial original matrix is identity');
            return wordsAt(at, 32);
          });
        for (const [i, vertices] of rows.entries()) {
          const input = [...vertices.map(floatBits), 0xa5a55a5a];
          input.forEach((word, index) => p.store(triangle + 4 * index, word));
          equal(
            await engine.call(glass.callback, [activeEffect, 3, triangle, i]),
            1,
            'original GlassBreak transforms the three supplied vertices',
          );
          equal(wordsAt(triangle, 13), input, 'identity shard and vertex tail are preserved');
        }
        await frame(21);
        for (const [i, vertices] of rows.entries()) {
          const at = shards + i * 128,
            float = new Float32Array(Uint32Array.from(initial[i]).buffer),
            step = p.load(activeEffect + 76),
            position = [0, 1, 2].map((j) =>
              Math.fround(float[12 + j] + Math.fround(float[j] * step)),
            );
          equal(
            wordsAt(at + 48, 3),
            position.map(floatBits),
            'one original frame advances the shard',
          );
          equal(
            wordsAt(at + 64, 16).some((word, j) => word !== initial[i][16 + j]),
            true,
            'rotation advances',
          );
          const input = [...vertices.map(floatBits), 0xa5a55a5a];
          input.forEach((word, index) => p.store(triangle + 4 * index, word));
          await engine.call(glass.callback, [activeEffect, 3, triangle, i]);
          equal(p.load(triangle + 48), input[12], 'vertex deformation preserves tail');
          equal(
            wordsAt(triangle, 12).some((word, j) => word !== input[j]),
            true,
            'actual vertices move',
          );
        }
        await frame(24);
        equal(await callWipe(0xc8), { control: 1, value: 0 }, 'native duration clears the status');
        equal(wordsAt(texture + 236, 3), [0, 0, 0], 'native duration detaches the graph');
        equal(p.allocations.has(shards - 4), true, 'finished task still owns the shard array');
        await callWipe(0xc5);
        await callWipe(0xc6);
        equal(await callWipe(0xc8), { control: 1, value: 0 }, 'original explicit stop status');
        equal(wordsAt(texture + 236, 3), [0, 0, 0], 'explicit stop detaches the same callback');
        await callWipe(0xc5);
      } else {
        equal(shards, 0, 'absent graph creates no shards');
        equal(p.load(activeEffect + 108), 0, 'failed start clears the original view capability');
        equal(await callWipe(0xc8), { control: 1, value: host }, 'failed status remains unwritten');
      }
      const last = p.load(activeEffect + 124);
      await engine.call(p.load(glass.table), [1], activeEffect);
      equal(p.allocations.has(activeEffect), false, 'native GlassBreak task destructor');
      equal(p.allocations.has(last - 4), false, 'destructor releases the last shard allocation');
      equal(
        wordsAt(texture + 236, 3),
        [0, 0, 0],
        'active destruction detaches from the borrowed model',
      );
    }
    const rain = sdk
        ? { table: 0x992fec, callback: 0x4c9220, lines: 0x5530f0, create: 0x550490 }
        : { table: 0x8cdd0c, callback: 0x5ee8f0, lines: 0x67c450, create: 0x679760 },
      lineBatches = [],
      f = Math.fround,
      seed = 0x8120719,
      color = 0xff60c4f4,
      viewBounds = [0, 0, 64, 48];
    p.store(core + 312, 1);
    engine.registerWindows('USER32.dll', 'GetClientRect', {
      count: 2,
      fn: ([hwnd, address]) => {
        assert.equal(hwnd, 1);
        viewBounds.forEach((word, i) => p.store(address + 4 * i, word));
        return 1;
      },
    });
    engine.patch(
      rain.lines,
      'original RainDrop final line submission',
      6,
      (args) => {
        assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, graphManager);
        lineBatches.push({ args, bytes: p.read(args[2], args[3] * 40) });
        return Number(args[3] !== 0);
      },
      { calleePops: true },
    );
    const createRain = async () => {
      activeEffect = await engine.call(factory, [19, name, out + 4], parent);
      nativeID = p.load(out + 4);
      equal(p.load(activeEffect), rain.table, 'original RainDrop factory');
      equal(p.load(activeEffect + 64), 19, 'original RainDrop task kind');
      return activeEffect;
    };
    const initializeRain = async (count, capacity, speed = 42) => {
      const input = [
        ...[64, 16, 48].map(floatBits),
        300,
        ...[14, 7, speed].map(floatBits),
        count,
        capacity,
        color,
        0xa5a55a5a,
      ];
      input.forEach((word, i) => p.store(source + 4 * i, word));
      equal(await callWipe(0xc4, 112), { control: 2 }, 'original RainDrop initializer');
      equal(wordsAt(source, input.length), input, 'RainDrop VM packet and canary');
      if (p.load(activeEffect + 108))
        equal(wordsAt(activeEffect + 120, 10), input.slice(0, 10), 'all RainDrop input words');
    };
    for (const count of [0, 6]) {
      const actor = await createRain(),
        random = new ParticleRandom(seed),
        capacity = count,
        drop = (initial) => {
          const y = f(random.frand() * 48 * (initial ? -5 : -1)),
            x = f(random.frand() * 64),
            z = f(random.frand() * 16 - 8),
            length = f(f(random.frand() * 7) + 7);
          return [
            ...[x, f(y - length), z, 1].map(floatBits),
            color,
            ...[x, y, z, 1].map(floatBits),
            color,
          ];
        };
      await engine.call(glass.seed, [seed]);
      equal(p.load(actor + 108), graphManager, 'RainDrop uses the original graph manager');
      await initializeRain(count, capacity);
      const [vertices, projected] = wordsAt(actor + 112, 2),
        graph = await engine.call(glass.lookup, [nativeID], graphManager),
        model = p.load(graph + 8);
      assert.ok(graph && model, 'the original factory adds a custom model');
      for (const pointer of [vertices, projected]) {
        equal(p.load(pointer - 4), 1, 'original reference header');
        equal(p.allocations.get(pointer - 4), 4 + capacity * 40, 'original capacity');
      }
      equal(
        wordsAt(actor + 172, 8),
        [32, 24, 300, 1, 32, 24, 0, 1].map(floatBits),
        'original projection centers',
      );
      let expected = Array.from({ length: count }, () => drop(true)).flat();
      equal(wordsAt(vertices, count * 10), expected, 'every initial XYZW/diffuse word');
      await initializeRain(count ? count + 2 : 0, capacity);
      equal(wordsAt(actor + 112, 2), [vertices, projected], 'repeat C4 preserves both arrays');
      equal(wordsAt(vertices, count * 10), expected, 'repeat C4 does not re-seed drops');
      equal(await callWipe(0xc8), { control: 1, value: 0 });
      await callWipe(0xc5);
      equal(await callWipe(0xc8), { control: 1, value: 1 });
      equal(p.load(graph + 4), 1, 'C5 shows the custom model');
      equal(wordsAt(model + 236, 3), [0, rain.callback, actor], 'C5 binds the original callback');
      const clock = p.load(actor + 168),
        step = p.load(actor + 76);
      let last = clock,
        respawns = 0;
      for (const at of [clock, clock + 1, clock + 2, clock + 9]) {
        const speed = f(f(f(at - last) * f(step)) * 42);
        for (let offset = 0; offset < expected.length; offset += 10) {
          for (const y of [1, 6])
            expected[offset + y] = floatBits(f(bitsFloat(expected[offset + y]) + speed));
          if (bitsFloat(expected[offset + 1]) > 48) {
            expected.splice(offset, 10, ...drop(false));
            respawns++;
          }
        }
        await frame(at);
        equal(p.load(actor + 168), at, 'original update clock');
        equal(wordsAt(vertices, count * 10), expected, 'every moved or respawned word');
        last = at;
      }
      assert.equal(respawns > 0, count !== 0, 'non-empty original rain recycles expired drops');
      const before = p.read(projected, count * 40);
      equal(await engine.call(rain.callback, [actor, 0]), 1);
      equal(lineBatches.length, 0, 'the original callback visibility gate');
      equal(p.read(projected, count * 40), before);
      equal(await engine.call(rain.callback, [actor, 1]), 1);
      equal(lineBatches.length, 1);
      equal(lineBatches.pop(), {
        args: [68, 2, projected, count, 0, 1],
        bytes: p.read(projected, count * 40),
      });
      equal(wordsAt(graphManager + 160, 4), viewBounds, 'original callback marks client damage');
      for (let i = 0; i < count; i++) {
        const [x, y, z, w, a, x2, y2, z2, w2, b] = wordsAt(projected + i * 40, 10);
        equal([x, z, w, a], [x2, z2, w2, b], 'the original projected endpoints share X/Z/W');
        equal([a, b], [color, color], 'projection preserves diffuse');
        assert.ok([x, y, z, w, y2].every((word) => Number.isFinite(bitsFloat(word))));
        assert.ok(bitsFloat(y) < bitsFloat(y2));
      }
      await callWipe(0xcb);
      equal(await callWipe(0xc8), { control: 1, value: 1 }, 'CB leaves RainDrop running');
      await callWipe(0xc6);
      equal(await callWipe(0xc8), { control: 1, value: 0 }, 'C6 stops the original task');
      equal(p.load(graph + 4), 0, 'C6 hides the original graph');
      equal(wordsAt(model + 236, 3), [0, 0, actor], 'C6 detaches the original callback');
      await frame(last + 1);
      equal(wordsAt(vertices, count * 10), expected, 'stopped task leaves source unchanged');
      await callWipe(0xc5);
      equal(await callWipe(0xc8), { control: 1, value: 1 });
      await engine.call(p.load(rain.table), [1], actor);
      equal(p.allocations.has(actor), false, 'original task destructor releases the actor');
      equal(await engine.call(glass.lookup, [nativeID], graphManager), 0, 'original graph removed');
      equal(p.allocations.has(vertices - 4), false, 'native destructor releases source vertices');
      equal(p.allocations.has(projected - 4), true, 'projected buffer survives native destructor');
    }
    for (const mounted of [true, false]) {
      p.store(view + 4, Number(mounted));
      const actor = await createRain();
      if (mounted)
        equal(
          await engine.call(rain.create, [nativeID], graphManager),
          1,
          'duplicate graph fixture',
        );
      const before = await engine.call(glass.lookup, [nativeID], graphManager);
      await initializeRain(1, 1);
      equal(wordsAt(actor + 108, 3), [0, 0, 0], 'failed init leaves both arrays absent');
      await callWipe(0xc5);
      equal(
        await callWipe(0xc8),
        { control: 1, value: host },
        'failed capability leaves C8 unwritten',
      );
      equal(p.load(actor + 164), 0, 'failed capability cannot start');
      await engine.call(p.load(rain.table), [1], actor);
      equal(
        await engine.call(glass.lookup, [nativeID], graphManager),
        before,
        'borrowed graph survives',
      );
    }
    await engine.call(glass.destroy, [], graphManager);
    await engine.call(glass.random[1], [], rng);
    p.free(rng);
    p.free(graphManager);
    p.store(glass.capsGlobal, 0);
    p.store(glass.coreGlobal, 0);
    p.free(caps);
    p.free(core);
    p.free(triangle);

    // Observe the exact original GraphManager callback envelope. The mounted
    // browser regression also runs the actual graph manager and renderer.
    const manager = p.allocate(32, true),
      callbacks = [],
      callback = sdk ? 0x4c8db0 : 0x5ee480,
      vertices = p.allocate(40, true),
      graph = 0x80000022,
      install = sdk ? 0x555060 : 0x67e3d0;
    p.store(view + 4, 1);
    p.store(view + 8, manager);
    engine.patch(
      install,
      'original Raster graph callback boundary',
      5,
      (args) => {
        assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, manager);
        callbacks.push(args);
        return 1;
      },
      { calleePops: true },
    );
    for (const fps of [30, 60, 144]) {
      p.store(parent + 72, fps);
      for (const mode of [1, 0x80000001]) {
        const converted = Boolean(mode & 0x80000000),
          rawFields = [graph, mode, floatBits(0), floatBits(8), floatBits(10)];
        activeEffect = await engine.call(factory, [18, name, out + 4], parent);
        nativeID = p.load(out + 4);
        equal(p.load(activeEffect), sdk ? 0x992f90 : 0x8cdcb0, 'original Raster vtable');
        equal(p.load(activeEffect + 108), manager, 'original Raster view capability');
        rawFields.forEach((word, i) => p.store(source + 4 * i, word));
        equal(await callWipe(0xc4, 112), { control: 2 }, 'Raster initializer control');
        equal(await callWipe(0xc5), { control: 2 }, 'Raster start control');
        equal(
          callbacks.pop(),
          [graph, callback, 0, activeEffect, 0],
          'original graph callback install',
        );
        equal(await callWipe(0xc8), { control: 1, value: 1 }, 'Raster becomes active');
        const matrix = Uint8Array.from({ length: 64 }, (_, i) => i * 29 + 7),
          rasterState = p.read(activeEffect, 148);
        p.write(source + 128, matrix);
        equal(await callWipe(0xc7, 240), { control: 2 }, 'original C7 returns its void control');
        equal(p.read(activeEffect, 148), rasterState, 'Raster ignores the matrix packet');
        equal(p.read(source + 128, 64), matrix, 'C7 preserves caller matrix');
        const update = [0xffffffff, 0x12345678, floatBits(4), floatBits(8), floatBits(30)],
          before = p.read(activeEffect, 148),
          expected = new DataView(before.buffer);
        p.write(replacement, new Uint8Array(24).fill(0xa5));
        update.forEach((word, i) => p.store(replacement + i * 4, word));
        const input = p.read(replacement, 24);
        equal(
          await callWipe(0xc9, 1, 0xffffffff),
          { control: 2 },
          'nonzero selector ignores VM address',
        );
        equal(p.read(activeEffect, 148), before, 'nonzero selector leaves the actor unchanged');
        expected.setUint32(124, update[2], true);
        expected.setUint32(128, converted ? floatBits(1 / 8) : update[3], true);
        expected.setUint32(132, converted ? floatBits(fps / 2) : update[4], true);
        equal(await callWipe(0xc9, 0, 176), { control: 2 }, 'Raster update control');
        equal(p.read(activeEffect, 148), before, 'only the original Raster fields change');
        equal(p.read(replacement, 24), input, 'Raster preserves parameter packet bytes');
        const words = [8, 2, 0.5, 1, 8, 6, 0.25, 1].map(floatBits),
          canary = 0xa5a55a5a;
        [...words, canary, canary].forEach((word, i) => p.store(vertices + i * 4, word));
        equal(
          await engine.call(callback, [activeEffect, 2, vertices, 0]),
          1,
          'original Raster draws vertices',
        );
        words[0] = floatBits(12);
        words[4] = floatBits(4);
        equal(
          Array.from({ length: 10 }, (_, i) => p.load(vertices + 4 * i)),
          [...words, canary, canary],
          'original Raster vertex bytes and tail',
        );
        equal(await callWipe(0xc6), { control: 2 }, 'Raster stop control');
        equal(callbacks.pop(), [graph, 0, 0, 0, 0], 'native stop detaches the callback');
        equal(await callWipe(0xc8), { control: 1, value: 0 }, 'Raster becomes inactive');
        await callWipe(0xc5);
        equal(callbacks.pop(), [graph, callback, 0, activeEffect, 0], 'native restart reattaches');
        await engine.call(p.load(p.load(activeEffect)), [1], activeEffect);
        equal(callbacks.pop(), [graph, 0, 0, 0, 0], 'active Raster destruction detaches');
        equal(p.allocations.has(activeEffect), false, 'original Raster destruction frees task');
      }
    }
    p.free(vertices);
    p.free(manager);
    activeEffect = await engine.call(factory, [25, name, out + 4], parent);
    nativeID = p.load(out + 4);
    equal(p.load(activeEffect), sdk ? 0x993100 : 0x8cde20, 'original Hydro vtable');
    const hydro = p.read(activeEffect, 180);
    equal(await callWipe(0xc4, 0xffffffff), { control: 2 }, 'Hydro ignores original C4 payload');
    equal(await callWipe(0xc9, 0, 0xffffffff), { control: 2 }, 'Hydro ignores original C9 payload');
    equal(
      await callWipe(0xc8),
      { control: 1, value: host },
      'Hydro status leaves result unwritten',
    );
    equal(p.read(activeEffect, 180), hydro, 'original Hydro receiver preserves its task data');
    await engine.call(p.load(p.load(activeEffect)), [1], activeEffect);
    equal(p.allocations.has(activeEffect), false, 'original Hydro destruction frees task');
    // Both extended wipes use a 256-entry table followed by a separate
    // blend interval. The 32-bit reference assets also exercise transparent RGB.
    const intensity = [0, 64, 128, 192, 255, 192, 128, 64],
      threshold = (value) => 4 - Math.floor((4 * value) / 255),
      weight = (frame, x) => Math.max(0, Math.min(256, 128 * (frame - threshold(intensity[x])))),
      extendedImages = await Promise.all([
        makeBitmap((x, y) => (x === 7 && y === 0 ? 0x00ff0000 : previous)),
        makeBitmap(() => next),
        makeBitmap((x) => (0xff7f3300 | intensity[x]) >>> 0),
        makeBitmap(() => previous),
        makeBitmap(null, [width, height, 3]),
      ]),
      [transparent, destination, mask, picture, rgb24] = extendedImages,
      blend = (src, dst, factor) => {
        let result = 0;
        for (let shift = 0; shift < 32; shift += 8)
          result |=
            ((((src >>> shift) & 255) * (256 - factor) + ((dst >>> shift) & 255) * factor) >> 8) <<
            shift;
        return result >>> 0;
      };
    p.store(parent + 72, 60);
    for (const [kind, fadeIn] of [
      [30, 0],
      [31, 0],
      [31, 1],
    ]) {
      activeEffect = await engine.call(factory, [kind, name, out + 4], parent);
      nativeID = p.load(out + 4);
      const alpha = kind === 31,
        workOffset = alpha ? 160 : 168,
        tableOffset = alpha ? 184 : 192,
        initializedOffset = alpha ? 164 : 172,
        size = alpha ? 1224 : 1228,
        inputImage = alpha ? picture : transparent,
        fields = alpha
          ? [4, 2, picture.wrapper, 0, 0, mask.wrapper, 4, 3, width, height, fadeIn, 0, 0]
          : [
              4,
              2,
              transparent.wrapper,
              0,
              0,
              destination.wrapper,
              0,
              0,
              mask.wrapper,
              4,
              3,
              0,
              0,
              0,
              0,
            ],
        configure = (words) => {
          p.write(source, new Uint8Array(64).fill(0xa5));
          words.forEach((word, i) => p.store(source + 4 * i, word));
          return callWipe(0xc4, 112);
        },
        expectPixels = (tick, forced = false) => {
          const pixels = Array.from({ length: height }, (_, y) =>
            Array.from({ length: width }, (_, x) => {
              if (!alpha) {
                const src = x === 7 && y === 0 ? 0x000000ff : previous;
                return tick === 6 ? next : blend(src, next, weight(tick, x));
              }
              const a = (255 * weight(forced ? tick : Math.min(tick, 5), x)) >> 8;
              return (((fadeIn ? a : 255 - a) << 24) | 0xff0000) >>> 0;
            }),
          );
          equal(raster.length, 1, 'one original extended wipe upload');
          const { bitmap, ...upload } = raster.pop();
          equal(
            upload,
            { sx: 0, sy: 0, w: width, h: height, x: 4, y: 3, pixels },
            'all original extended wipe bytes and rectangle',
          );
          return bitmap;
        };
      const table = sdk ? (alpha ? 0x99351c : 0x993468) : alpha ? 0x8ce23c : 0x8ce188;
      equal(p.load(activeEffect), table, 'original extended wipe task vtable');
      equal(p.load(activeEffect + 64), kind, 'factory assigns actual extended wipe kind');
      equal(p.load(activeEffect + workOffset), 0, 'factory starts without a work bitmap');
      equal(await callWipe(0xc5), { control: 2 }, 'fresh inactive start control');
      equal(await callWipe(0xc8), { control: 1, value: 0 }, 'fresh task has not started');

      const sourcePixel = p.load(inputImage.bitmap + 12) + 7 * 4,
        refs = extendedImages.map(({ bitmap }) => p.load(bitmap + 80));
      if (alpha)
        for (const index of [2, 5]) {
          const unsupported = fields.slice();
          unsupported[index] = rgb24.wrapper;
          await configure(unsupported);
          equal(
            p.load(activeEffect + initializedOffset),
            0,
            'original Alpha3 rejects either 24-bit input',
          );
          equal(p.load(activeEffect + workOffset), 0, 'rejected Alpha3 creates no work bitmap');
        }
      await configure(fields);
      equal(p.load(activeEffect + initializedOffset), 1, 'original extended wipe initializes');
      equal(
        p.load(sourcePixel),
        alpha ? previous : 0x000000ff,
        'Wipe3 prepares transparent source RGB in the borrowed bitmap',
      );
      const work = p.load(activeEffect + workOffset);
      equal(p.allocations.get(work), 92, 'original effect owns a native work bitmap');
      equal(await callWipe(0xc5), { control: 2 }, 'original extended wipe starts');
      equal(
        Array.from({ length: 256 }, (_, i) => p.load(activeEffect + tableOffset + 4 * i)),
        Array.from({ length: 256 }, (_, i) => threshold(i)),
        'original per-mask transition table',
      );
      equal(await callWipe(0xc8), { control: 1, value: 1 }, 'extended wipe is active');
      for (let tick = 1; tick <= 6; tick++) {
        await frame(20 + tick);
        equal(
          expectPixels(tick),
          !alpha && tick === 6 ? destination.bitmap : work,
          'original upload uses the correct backing identity',
        );
      }
      equal(await callWipe(0xc8), { control: 1, value: 0 }, 'natural end clears active');
      equal(await callWipe(0xcb), { control: 2 }, 'inactive CB control');
      equal(raster.length, 0, 'inactive CB produces no upload');
      await callWipe(0xc6);
      expectPixels(6, true);
      await callWipe(0xc5);
      await callWipe(0xcb);
      expectPixels(6, true);
      equal(await callWipe(0xc8), { control: 1, value: 0 }, 'forced end clears active');

      const before = p.read(activeEffect, size),
        expected = new DataView(before.buffer);
      p.store(replacement + 8, destination.wrapper);
      p.store(replacement + 20, picture.wrapper);
      expected.setUint32(116, destination.wrapper, true);
      if (!alpha) expected.setUint32(128, picture.wrapper, true);
      [nativeID, sender, sdk ? 255 : 260, 0, replacement, 0].forEach((word, i) =>
        p.store(packet + 4 * i, word),
      );
      await engine.call(p.load(table + 24), [packet, out], activeEffect);
      equal(
        p.read(activeEffect, size),
        before,
        'raw message 260 replaces only original borrowed fields',
      );
      equal(
        await callWipe(0xca, 0xffffffff),
        { control: 2 },
        'CA does not route to extended wipes',
      );
      equal(p.read(activeEffect, size), before, 'CA preserves the extended wipe');

      const missing = fields.slice();
      missing[alpha ? 5 : 8] = 0;
      await configure(missing);
      equal(
        p.load(activeEffect + initializedOffset),
        0,
        'missing source or mask fails initialization',
      );
      equal(p.load(activeEffect + workOffset), 0, 'missing bitmap releases old work');
      equal(p.allocations.has(work), false, 'old original work allocation is gone');
      const clipped = fields.slice();
      clipped[0] = clipped[1] = 0;
      clipped[alpha ? 11 : 13] = clipped[alpha ? 12 : 14] = 1;
      await configure(clipped);
      equal(
        [108, 112].map((at) => p.load(activeEffect + at)),
        [1, 1],
        'original interval clamping',
      );
      equal(
        [size - 8, size - 4].map((at) => p.load(activeEffect + at)),
        [width - 1, height - 1],
        'original clip dimensions',
      );
      const replacementWork = p.load(activeEffect + workOffset);
      await engine.call(p.load(table), [1], activeEffect);
      equal(p.allocations.has(activeEffect), false, 'original extended wipe frees its task');
      equal(p.allocations.has(replacementWork), false, 'original extended wipe frees its work');
      equal(
        extendedImages.map(({ bitmap }) => p.load(bitmap + 80)),
        refs,
        'borrowed reference counts are unchanged',
      );
    }
    for (const { wrapper, bitmap } of extendedImages) {
      await engine.call(bitmapRelease, [], bitmap);
      p.free(wrapper);
    }
    await engine.call(p.load(p.load(parent)), [1], parent);
  } finally {
    memory.close();
  }

  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        operations,
        wrapperChecks,
        receiverChecks,
        wrapperBoundary:
          'Original eight GCALL wrappers compared with adapter. Observer supplies routing and target replies.',
        receiverBoundary:
          'Original factories, Raster/Hydro/RainDrop/GlassBreak/Wipe1/Fade/Wipe2/Wipe3/WipeAlpha3 receivers, per-frame draws and destructors. RainDrop and GlassBreak use the original graph manager and callbacks with authored display caps and an empty mounted file provider. Observe RainDrop final line submission, Raster graph registration and bitmap uploads at their view boundaries.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original area effects: ${operations} wrapper calls, ${wrapperChecks} wrapper comparisons, ${receiverChecks} receiver comparisons`,
  );
} finally {
  await engine.close();
}
