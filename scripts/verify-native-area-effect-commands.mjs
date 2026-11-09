// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NATIVE_ENGINE_IMAGES, NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeAreaEffectCommands } from '../src/native/area-effect-commands.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
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
  argv = p.allocate(8, true),
  host = p.allocate(8, true),
  vtable = p.allocate(20, true),
  sender = 17,
  scratchFill = new Uint8Array(12).fill(0xa5),
  packet = p.allocate(24, true),
  secondMessage = [265, 263, 266, 267, 268, 269, 270, 271, 272, 274, 275, 276, 274, 277, 278],
  commands = new Map([
    [0xc4, 13],
    [0xc5, 257],
    [0xc6, 258],
    [0xc8, 259],
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
const observe = (from, target, message, w, l, flags, result) => {
  if (message === 259 || message === 13) statusInput = p.load(result);
  events.push({
    from,
    target,
    message,
    w,
    flags,
    source: l ? Array.from(p.read(l, message === 260 ? 20 : 56)) : null,
    initial:
      message === 13 && commandID !== 0xca
        ? statusInput
        : message === 13 || message === 259
          ? 'caller'
          : null,
  });
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
    words = [0, 1, 0x80000000, 0xffffffff];
  for (const [i, address] of locations.slice(0, -1).entries())
    m.bytes(address, 56).set(Uint8Array.from({ length: 56 }, (_, j) => (i * 23 + j * 37) & 255));
  for (const [id, firstMessage] of commands) {
    commandID = id;
    const isInit = id === 0xc4,
      isReplacement = id === 0xca,
      queriesKind = isInit || isReplacement,
      values = queriesKind
        ? [...Array.from({ length: 33 }, (_, i) => i), ...words.slice(2)]
        : words;
    for (const target of words)
      for (replyWord of values)
        for (const address of queriesKind ? locations : [0])
          for (writeReply of [false, true]) {
            const args = queriesKind ? [target, address] : [target],
              before = vmState(),
              memory = new NativeKCSMemory(p, m);
            events = [];
            let native;
            try {
              native = await callOriginal(id, args, memory.pointer);
            } finally {
              memory.close();
            }
            const followUp = writeReply
                ? isInit
                  ? secondMessage[replyWord - 17]
                  : isReplacement && (replyWord === 26 || replyWord === 27)
                    ? 260
                    : undefined
                : undefined,
              expectedMessages = [firstMessage, ...(followUp ? [followUp] : [])],
              expectedEvents = events;
            equal(
              events.map((event) => event.message),
              expectedMessages,
              'original message IDs',
            );
            if (isInit) equal(events[0].initial, mainTable + 4 * id, 'GCALL slot remains in ECX');
            if (isReplacement) equal(statusInput, host, 'CA kind query starts with caller word');
            if (followUp)
              equal(
                events[1].source,
                address === 0xffffffff
                  ? null
                  : Array.from(m.bytes(address, isReplacement ? 20 : 56)),
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
            if (isReplacement)
              equal(p.allocations.has(statusInput), false, 'CA kind query used caller scratch');
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
          'Original six GCALL wrappers compared with adapter. Observer supplies routing and target replies.',
        receiverBoundary:
          'Original factories, Wipe1/Fade/Wipe2 receivers, per-frame bitmap draws and destructors. Authored caller, bitmaps and view; upload captured before device.',
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
