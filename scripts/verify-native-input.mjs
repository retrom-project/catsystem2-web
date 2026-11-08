// SPDX-License-Identifier: MPL-2.0
// Execute original Input constructors, handlers, list sorting, key queries,
// routing helpers and frame code. Window/device I/O is an explicit boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeInput, nativeInput, nativeInputBitmapMask } from '../src/native/input.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, report] = process.argv.slice(2);
if (!report)
  throw new Error('Usage: node scripts/verify-native-input.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Input oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  configuration = new NativeConfiguration({ profile }),
  engine = await NativeEngineProcess.open({
    profile,
    bytes,
    configuration,
    standardLibraries: false,
    trace: true,
  }),
  p = engine.process,
  f = sdk
    ? {
        ctor: 0x4c2c60,
        handler: 0x4c38f0,
        frame: 0x4c30b0,
        baseFrame: 0x4b8ea0,
        device: 0x5bfa80,
        position: 0x5c0e80,
        view: 0x54e080,
        warpView: 0x54e940,
        warp: 0x5c1130,
        cursor: 0x54e830,
        route: 0x4c44f0,
        repeat: 0x4c46b0,
        hover: 0x4c47d0,
        drag: 0x4c4410,
        click: 0x4c4910,
        query: 0x5c0ef0,
        beginThread: 0x639e78,
        alpha: 0x4c2fa0,
      }
    : {
        ctor: 0x5e69a0,
        handler: 0x5e7680,
        frame: 0x5e6df0,
        baseFrame: 0x5dcc80,
        device: 0x70e6f0,
        position: 0x70fbf0,
        view: 0x676f90,
        warpView: 0x677840,
        warp: 0x70fea0,
        cursor: 0x677730,
        route: 0x5e8160,
        repeat: 0x5e8320,
        hover: 0x5e8440,
        drag: 0x5e8080,
        click: 0x5e85a0,
        query: 0x70fc60,
        beginThread: 0x7a13b8,
        alpha: 0x5e6ce0,
      },
  task = p.allocate(5400, true),
  renderer = p.allocate(200, true),
  device = p.allocate(18640, true),
  name = p.allocate(64, true),
  out = p.allocate(4, true),
  buffer = p.allocate(1024, true),
  vft = p.allocate(32, true),
  canary = 0x34c5a67b,
  main = sdk ? 0xb3c900 : 0xa2dd38;
let model,
  originalTrace = [],
  modelTrace = [],
  rawTransport = [],
  wrapperMode = false,
  pointer = { x: 0, y: 0, inside: 0 },
  foreground = true,
  consumer = 9,
  missing = -1,
  passed = 0,
  threadStarted = false;
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
const rawMessage = (m) => (sdk && m >= 37 ? m - 2 : m);
const readWords = (a, n) => Array.from({ length: n }, (_, i) => p.load(a + i * 4));
const memory = {
  load: (a) => p.load(a),
  store: (a, v) => p.store(a, v),
  bytes: (a, n) => p.read(a, n),
  write: (a, b) => p.write(a, b),
  string: (a) => p.string(a),
};
const writeString = (a, s) => p.write(a, encodeCP932(s + '\0'));
const rect = (a) => readWords(a, 4).map((v) => v | 0);
const targetReply = (target, message, w, l, ctx) => {
  let payload;
  if (message === 6)
    payload = {
      from: ctx ? readWordsFrom(ctx.payload, w, 2) : rect(w).slice(0, 2),
      to: ctx ? readWordsFrom(ctx.payload, l, 2) : rect(l).slice(0, 2),
    };
  return {
    trace: payload ? [target, message, payload] : [target, message, w, l],
    routed: target !== missing,
    result: target === consumer ? 0 : 1,
  };
};
const readWordsFrom = (m, a, n) => Array.from({ length: n }, (_, i) => m.load(a + i * 4) | 0);
const rawSend = p.trap(
  'input engine routing boundary',
  7,
  async ([sender, target, message, w, l, flags, result]) => {
    let canonical = sdk && message >= 35 ? message + 2 : message;
    if (message === 11) {
      originalTrace.push([0, 22, 0, p.load(l + 16)]);
      return 1;
    }
    if (wrapperMode) {
      let payload;
      if (canonical === 126)
        payload = { owner: p.load(l), mask: p.load(l + 8), bounds: rect(l + 12) };
      rawTransport.push({
        sender,
        target,
        message: canonical,
        w: canonical === 141 ? 0 : w,
        l:
          canonical === 126
            ? payload
            : canonical === 129 && l
              ? rect(l)
              : canonical === 141 || canonical === 148
                ? 'output'
                : l,
        flags,
      });
      if (canonical === (sdk ? 32 : 34)) {
        p.store(result, 5);
        return 1;
      }
      await engine.callFromHost(
        f.handler,
        [sender, rawMessage(canonical), w, l, flags, result],
        task,
      );
      return 1;
    }
    const reply = targetReply(target, canonical, w, l);
    rawTransport.push({ sender, target, message: canonical, w, l, flags });
    originalTrace.push(reply.trace);
    if (reply.routed) p.store(result, reply.result);
    return Number(reply.routed);
  },
);
engine.patch(sdk ? 0x8a6910 : 0x8772a0, 'KCS VM pointer translation boundary', 1, ([a]) => a, {
  calleePops: true,
});
engine.patch(f.device, 'window input-device lookup', 1, () => device);
engine.patch(f.baseFrame, 'previously verified Base frame boundary', 2, () => 1, {
  calleePops: true,
});
engine.patch(
  f.position,
  'window pointer sample',
  2,
  ([x, y]) => {
    p.store(x, pointer.x);
    p.store(y, pointer.y);
    return pointer.inside;
  },
  { calleePops: true },
);
engine.patch(f.view, 'screen-to-virtual view service', 2, () => 1, { calleePops: true });
engine.patch(f.warpView, 'virtual-to-screen view service', 2, () => 1, { calleePops: true });
engine.patch(
  f.warp,
  'window cursor warp service',
  2,
  ([x, y]) => {
    pointer.x = x | 0;
    pointer.y = y | 0;
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  f.cursor,
  'renderer cursor visibility service',
  1,
  ([value]) => {
    p.store(renderer + 48, value);
    originalTrace.push(['cursor', Boolean(value)]);
    return 1;
  },
  { calleePops: true },
);
engine.patch(f.beginThread, 'Win32 dialog thread boundary', 3, () => {
  threadStarted = true;
  return 0x42;
});
engine.patch(sdk ? 0x4a82f0 : 0x5cac90, 'input diagnostic logger', 0, () => 0);
engine.patch(
  sdk ? 0x54e2e0 : 0x6771f0,
  'renderer cursor-image boundary',
  3,
  ([name, x, y]) => {
    originalTrace.push(['cursor-image', p.string(name, !sdk), x, y]);
    return 0;
  },
  { calleePops: true },
);
engine.registerWindows('USER32.dll', 'GetForegroundWindow', {
  count: 0,
  fn: () => (foreground ? 0x1234 : 0),
});
engine.registerWindows('USER32.dll', 'SetRectEmpty', {
  count: 1,
  fn: ([a]) => {
    p.write(a, new Uint8Array(16));
    return 1;
  },
});
engine.registerWindows('USER32.dll', 'IsRectEmpty', {
  count: 1,
  fn: ([a]) => {
    const [x, y, r, b] = rect(a);
    return Number(x >= r || y >= b);
  },
});
engine.registerWindows('USER32.dll', 'PtInRect', {
  count: 3,
  fn: ([a, x, y]) => {
    const [left, top, right, bottom] = rect(a);
    return Number((x | 0) >= left && (x | 0) < right && (y | 0) >= top && (y | 0) < bottom);
  },
});
async function reset({ fps = 60 } = {}) {
  p.write(task, new Uint8Array(5400));
  p.write(device, new Uint8Array(18640));
  p.write(renderer, new Uint8Array(200));
  engine.kernel.locks.set(device + 18608, 0);
  pointer = { x: 0, y: 0, inside: 0 };
  foreground = true;
  consumer = 9;
  missing = -1;
  originalTrace = [];
  modelTrace = [];
  writeString(name, 'Authored input');
  await engine.call(f.ctor, [1, name, fps, renderer, 0x1234], task);
  p.write(vft, p.read(p.load(task), 32));
  p.store(vft + 16, rawSend);
  p.store(task, vft);
  p.store(renderer + 48, 1);
  model = new NativeInput({
    frameRate: fps,
    configuration,
    cursor: (visible) => {
      modelTrace.push(['cursor', Boolean(visible)]);
      return Number(visible);
    },
    textInput: () => new Promise(() => {}),
    services: {
      notifyCursor: (visible) => modelTrace.push([0, 22, 0, visible]),
      warp: () => {},
      devicePointer: () => device,
      cursorImage: (name, x, y) => modelTrace.push(['cursor-image', name, x, y]),
      killTouch: () => {},
      touchHold: () => {},
      cancelWheel: () => {},
    },
    dispatch: async (target, message, w, l, ctx) => {
      const reply = targetReply(target, message, w, l, ctx);
      modelTrace.push(reply.trace);
      return reply;
    },
  });
}
function regions() {
  const list = p.load(task + 4948),
    head = p.load(list),
    result = [];
  for (let node = p.load(head); node !== head; node = p.load(node)) {
    const alpha = p.load(node + 52),
      width = p.load(node + 56),
      height = p.load(node + 60);
    result.push({
      owner: p.load(node + 8),
      priority: p.load(node + 12),
      mask: p.load(node + 16),
      bounds: rect(node + 20),
      active: p.load(node + 36),
      enabled: p.load(node + 40),
      hoverEnabled: p.load(node + 44),
      dragEnabled: p.load(node + 64),
      alpha: alpha
        ? { width, height, bytes: [...p.read(alpha, Math.ceil(width / 8) * height)] }
        : null,
    });
  }
  return result;
}
function state() {
  return {
    held: readWords(task + 116, 320),
    previous: readWords(task + 1724, 320),
    captures: readWords(task + 3004, 80),
    handled: readWords(task + 3324, 320),
    enabled: readWords(task + 4604, 80),
    source: p.load(task + 4952),
    previousX: p.load(task + 4932) | 0,
    previousY: p.load(task + 4936) | 0,
    dragX: p.load(task + 4940) | 0,
    dragY: p.load(task + 4944) | 0,
    dragging: !!p.load(task + 4924),
    cursorEnabled: p.load(task + 5236),
    cursorVisible: !!p.load(task + 5240),
    cursorAutoHide: p.load(task + 5244),
    cursorHideFrames: p.load(task + 5248),
    idleFrames: p.load(task + 5252),
    forceCursor: !!p.load(task + 5256),
    changed: !!p.load(task + 5260),
    cursorBlocked: p.load(task + 5264),
    textStatus: p.load(task + 5216),
    text: p.string(task + 4960),
    textBytes: p.read(task + 4960, 256),
    pulses: Array.from({ length: 80 }, (_, i) => p.load(device + 888 + 108 * i)),
    warp: p.load(task + 5224)
      ? {
          x: p.load(task + 5228) | 0,
          y: p.load(task + 5232) | 0,
          remaining: p.load(task + 5224),
          started: p.load(task + 5220),
        }
      : null,
    regions: regions(),
  };
}
function modelState() {
  const state = model;
  return Object.fromEntries(
    Object.keys(globalShape).map((k) => [
      k,
      k === 'warp'
        ? state.warp?.remaining
          ? state.warp
          : null
        : k === 'regions'
          ? model.ordered().map((r) =>
              Object.fromEntries(
                Object.keys(
                  globalShape.regions[0] || {
                    owner: 0,
                    priority: 0,
                    mask: 0,
                    bounds: 0,
                    active: 0,
                    enabled: 0,
                    hoverEnabled: 0,
                    dragEnabled: 0,
                    alpha: 0,
                  },
                ).map((key) => [
                  key,
                  key === 'alpha' && r.alpha ? { ...r.alpha, bytes: [...r.alpha.bytes] } : r[key],
                ]),
              ),
            )
          : ArrayBuffer.isView(state[k])
            ? k === 'textBytes'
              ? state[k]
              : [...state[k]]
            : state[k],
    ]),
  );
}
let globalShape;
function verify(label) {
  globalShape = state();
  compare(modelState(), globalShape, label + '/state');
  compare(modelTrace, originalTrace, label + '/trace');
  modelTrace = [];
  originalTrace = [];
}
async function message(message, w = 0, l = 0) {
  p.store(out, canary);
  const before = p.read(buffer, 1024).slice();
  const handled = await engine.call(f.handler, [7, rawMessage(message), w, l, 0, out], task),
    result = p.load(out),
    after = p.read(buffer, 1024).slice();
  p.write(buffer, before);
  const actual = await model.message(message, w, l, { memory });
  compare(Number(actual === undefined), handled, `message${message}/handled`);
  compare(
    actual === undefined || actual === NATIVE_UNWRITTEN_WORD ? canary : actual,
    result,
    `message${message}/result`,
  );
  compare(p.read(buffer, 1024), after, `message${message}/memory`);
  verify(`message${message}`);
}
async function register(owner, priority, bounds = [0, 0, 0, 0], mask = 7) {
  p.write(buffer, new Uint8Array(64));
  p.store(buffer, owner);
  p.store(buffer + 8, mask);
  bounds.forEach((v, i) => p.store(buffer + 12 + i * 4, v));
  await message(126, priority, buffer);
}
function key(index, slot, source, repeat = 1) {
  model.key(index, source !== 0, source, slot);
  for (let i = 0; i < 4; i++) model.repeatEnabled[index * 4 + i] = repeat;
  const offset = 108 * index;
  p.store(device + 804 + offset, repeat);
  p.store(device + 9444 + offset, repeat);
  p.store(device + 872 + offset + 4 * slot, source);
  p.store(device + 9512 + offset + 4 * slot, source);
}
async function frame(n) {
  model.pointer(pointer.x, pointer.y, pointer.inside);
  model.foreground = foreground;
  compare(await engine.call(f.frame, [n, 0], task), await model.tick(n), `frame${n}/return`);
  verify(`frame${n}`);
}
try {
  await reset();
  verify('constructor');
  for (const [owner, priority, bounds] of [
    [4, 0, [0, 0, 50, 50]],
    [9, 10, [10, 10, 30, 30]],
    [7, 0xffffffff, [-10, -10, 0, 0]],
    [4, 10, [0, 0, 20, 20]],
  ])
    await register(owner, priority, bounds);
  for (const [m, w, l] of [
    [128, 4, 10],
    [132, 9, 3],
    [133, 9, 0],
    [133, 99, 0],
    [134, 99, 0],
    [135, 9, 0],
    [153, 7, 0],
    [131, 7, 1],
    [129, 7, 0],
    [130, 4, buffer + 200],
    [130, 99, buffer + 200],
    [127, 0, 4],
    [145, 0, 0],
    [150, 79, 0xffffffff],
    [151, 0, 0],
    [142, 1, 123],
    [148, 0, buffer + 200],
    [149, 0, 0],
    [152, 0, 0],
    [159, 0, buffer + 200],
    [158, 0, 0],
    [143, 0, 0],
  ])
    await message(m, w, l);
  await reset({ fps: 30 });
  await message(142, 1, 0xffffffff);
  await message(138, 6, 10 | (20 << 16));
  for (let n = 0; n < 8; n++) await frame(n);
  for (let trial = 0; trial < 18; trial++) {
    await reset();
    await register(4, 1, [0, 0, 50, 50]);
    await register(9, 2, [10, 10, 30, 30]);
    await register(7, 3, [0, 0, 0, 0], 1).catch((e) => {
      throw e;
    });
    // The last empty rectangle is deliberately valid for keyboard, not hover.
    model.get(7).bounds = [0, 0, 0, 0];
    let node = p.load(p.load(p.load(task + 4948)));
    while (p.load(node + 8) !== 7) node = p.load(node);
    p.write(node + 20, new Uint8Array(16));
    consumer = [9, 4, -1][trial % 3];
    missing = trial % 4 === 0 ? 9 : -1;
    pointer = { x: 15, y: 15, inside: trial % 2 };
    model.repeatStart = 3;
    model.repeatInterval = 2;
    p.store(task + 1396, 3);
    p.store(task + 1400, 2);
    for (let n = 1; n <= 14; n++) {
      if (n === 1) {
        key(0, 0, trial % 2 ? 2 : 1);
        key(2, 1, 1);
      }
      if (n === 4) {
        pointer.x = 40;
        pointer.y = 20;
      }
      if (n === 8) key(0, 0, 0);
      if (n === 9) key(2, 1, 0);
      if (n === 10) {
        key(1, 2, 16);
        model.pointerActivation = true;
        p.store(device + 780, 1);
      }
      if (n === 11) key(1, 2, 0);
      if (n === 12) {
        await message(145);
        await message(142, 1, 2);
      }
      await frame(n);
    }
  }
  await reset();
  await register(9, 1, [0, 0, 20, 20]);
  pointer = { x: 4, y: 5, inside: 0 };
  model.pointer(4, 5);
  for (const m of [
    91, 125, 136, 137, 138, 140, 144, 146, 147, 154, 155, 156, 157, 158, 159, 19, 3, 123456,
  ]) {
    if (m === 125) await message(m, buffer + 200, buffer + 204);
    else if (m === 91) await message(m, 0, buffer + 200);
    else if (m === 137 || m === 138) await message(m, 0, 4 | (5 << 16));
    else if (m === 147) {
      writeString(buffer, 'Authored cursor');
      await message(m, buffer, 3 | (7 << 16));
    } else if (m === 154) {
      await message(m, 0, 6);
      await message(144, 0);
      await frame(2);
    } else await message(m, m === 146 ? 9 : 0, 0);
  }
  for (const text of ['Authored', '日本語', '', 'x'.repeat(255)]) {
    writeString(buffer, text);
    threadStarted = false;
    await message(139, 0, buffer);
    compare(threadStarted, true, 'text dialog scheduled');
    await message(140);
    await message(141, 0, buffer + 512);
  }
  await reset();
  wrapperMode = true;
  const wrapperArgs = p.allocate(16, true),
    wrapperOut = p.allocate(4, true),
    wrapperCalls = [];
  const mockWorld = {
    engineMessages: { layout: { rootStart: sdk ? 30 : 32 } },
    nativeTaskID: () => 1,
    sendNativeEngine: async (target, sender, message, w = 0, l = 0, ctx = {}) => {
      const m = ctx.payload ?? memory;
      let payload;
      if (message === 126)
        payload = { owner: m.load(l), mask: m.load(l + 8), bounds: readWordsFrom(m, l + 12, 4) };
      wrapperCalls.push({
        sender: ctx.nativeSender ?? sender,
        target,
        message,
        w: message === 141 ? 0 : w,
        l:
          message === 126
            ? payload
            : message === 129 && l
              ? readWordsFrom(m, l, 4)
              : message === 141 || message === 148
                ? 'output'
                : l,
        flags: 0,
      });
      if (message === (sdk ? 32 : 34)) return 5;
      return model.message(message, w, l, { memory: m });
    },
  };
  for (const [id, args, pulseCount] of [
    [0x90, [0x1234, 0xffffffff, buffer + 32, 7]],
    [0x92, [1, 3]],
    [0x93, [1, 0]],
    [0x93, [1, buffer + 32]],
    [0x94, [1, 2]],
    [0x95, [buffer + 300, buffer + 304]],
    [0x96, [1, 2, 3]],
    [0x96, [0xffffffff, 0x8000, 0xffffffff]],
    [0x97, [buffer + 400]],
    [0x98, []],
    [0x99, [buffer + 512]],
    [0x9a, [1, 100]],
    ...[0, 1, 12, 79].flatMap((index) => [0, 1, 3, 5].map((pulses) => [0x11d, [index], pulses])),
    [0x11e, []],
    [0x18b, [buffer + 400, 1, 2]],
    [0x18b, [buffer + 400, 0xffffffff, 0x8000]],
    [0x18c, []],
    [0x91, []],
  ]) {
    if (id === 0x11d) {
      for (let slot = 0; slot < 4; slot++) key(args[0], slot, 0x80000000 >>> slot);
      model.pulses[args[0]] = pulseCount;
      p.store(device + 888 + args[0] * 108, pulseCount);
      p.store(device + 9528 + args[0] * 108, pulseCount);
    }
    if (id === 0x11e) {
      for (const region of model.regions) region.active = 1;
      const head = p.load(p.load(task + 4948));
      for (let node = p.load(head); node !== head; node = p.load(node)) p.store(node + 36, 1);
    }
    [0, 1, 20, 30].forEach((v, i) => p.store(buffer + 32 + i * 4, v));
    writeString(buffer + 400, 'Authored dialog');
    args.forEach((v, i) => p.store(wrapperArgs + i * 4, v));
    p.store(wrapperOut, canary);
    rawTransport = [];
    wrapperCalls.length = 0;
    const before = p.read(buffer, 1024).slice(),
      control = await engine.call(p.load(main + id * 4), [0, task, wrapperArgs, wrapperOut]),
      expectedResult = p.load(wrapperOut),
      after = p.read(buffer, 1024).slice();
    p.write(buffer, before);
    const actual = await nativeInput(id, args, memory, { id: 1 }, mockWorld);
    compare(actual.control, control, `wrapper${id}/control`);
    compare(actual.value ?? canary, expectedResult, `wrapper${id}/result`);
    compare(wrapperCalls, rawTransport, `wrapper${id}/calls`);
    compare(p.read(buffer, 1024), after, `wrapper${id}/memory`);
    verify(`wrapper${id}`);
  }
  wrapperMode = false;
  for (const authorMode of [0, 1]) {
    await reset();
    configuration.authorMode = authorMode;
    const bindings = new NativeInputBindings(model, configuration);
    for (let index = 0; index < 80; index++) {
      const row = configuration.keys.rows[index];
      row.enabled = Number(index % 3 !== 2);
      for (const [category, offset, repOffset] of [
        ['keyboard', 4, 24],
        ['touch', 8, 40],
        ['joypad', 12, 56],
        ['mouse', 16, 72],
      ]) {
        for (let slot = 0; slot < 4; slot++) {
          const code =
            category === 'keyboard' ? 65 + ((index + slot) % 3) : 1 + ((index + slot) % 5);
          row[category][slot] = code;
          row[`rep_${category}`][slot] = (index + slot) % 4;
          for (const base of [784, 9424]) {
            p.write(device + base + 108 * index + offset + slot, Uint8Array.of(code));
            p.store(device + base + 108 * index + repOffset + slot * 4, (index + slot) % 4);
            p.store(device + base + 108 * index, row.enabled);
          }
        }
      }
    }
    for (let step = 0; step < 32; step++) {
      const category = ['keyboard', 'mouse', 'joypad', 'touch'][step % 4],
        code = category === 'keyboard' ? 65 + (step % 3) : 1 + (step % 5),
        down = step % 7 !== 0,
        source =
          category === 'mouse' && step % 8 === 1
            ? 16
            : category === 'keyboard'
              ? 1
              : category === 'mouse'
                ? 2
                : category === 'joypad'
                  ? 4
                  : 8,
        callback =
          category === 'keyboard'
            ? sdk
              ? 0x5c0bc0
              : 0x70f930
            : category === 'joypad'
              ? sdk
                ? 0x5c0ac0
                : 0x70f830
              : sdk
                ? 0x5c0cc0
                : 0x70fa30;
      await engine.call(
        callback,
        category === 'keyboard' || category === 'joypad'
          ? [code, Number(down)]
          : [code, Number(down), source],
        device,
      );
      bindings.apply(category, code, down, source);
      const sampled = [],
        live = [],
        repeat = [];
      for (let i = 0; i < 80; i++) {
        sampled.push(...readWords(device + 872 + 108 * i, 4));
        live.push(...readWords(device + 9512 + 108 * i, 4));
        repeat.push(p.load(device + 804 + 108 * i));
      }
      compare([...bindings.sampled], sampled, `physical/${authorMode}/${step}/sampled`);
      compare([...bindings.live], live, `physical/${authorMode}/${step}/live`);
      compare([...bindings.repeat], repeat, `physical/${authorMode}/${step}/repeat`);
      if (step % 5 === 4) {
        await engine.call(sdk ? 0x5c1170 : 0x70fee0, [], device);
        bindings.finishFrame();
      }
    }
  }
  for (const bpp of [3, 4])
    for (const [width, height, canvasWidth, canvasHeight, offsetX, offsetY] of [
      [5, 3, 0, 0, 0, 0],
      [5, 3, 9, 5, 2, 1],
      [5, 3, 4, 2, -2, -1],
      [9, 5, 1, 1, 8, 4],
    ]) {
      const raw = p.allocate(64, true),
        stride = (width * bpp + 3) & ~3,
        data = p.allocate(stride * height, true),
        output = p.allocate(12, true),
        rgba = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
          i % 7 ? (i * 37) & 255 : 0,
        );
      [width, height, data, 0, stride, bpp, canvasWidth, canvasHeight, offsetX, offsetY].forEach(
        (v, i) => p.store(raw + 4 + i * 4, v),
      );
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          p.write(
            data + y * stride + x * bpp,
            rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + bpp),
          );
      try {
        await engine.call(f.alpha, [raw, output]);
        const nativeWidth = p.load(output + 4),
          nativeHeight = p.load(output + 8),
          nativeBytes = p.read(p.load(output), Math.ceil(nativeWidth / 8) * nativeHeight),
          modelMask = await nativeInputBitmapMask({
            width,
            height,
            state: { canvasWidth, canvasHeight, offsetX, offsetY, bpp },
            pixels: async () => rgba,
          });
        compare(
          [modelMask.width, modelMask.height, [...modelMask.bytes]],
          [nativeWidth, nativeHeight, [...nativeBytes]],
          `bitmap-alpha/${bpp}/${canvasWidth}/${offsetX}`,
        );
        p.free(p.load(output));
      } finally {
        p.free(raw);
        p.free(data);
        p.free(output);
      }
    }
  console.log(`Native input passed ${passed}/${passed}`);
  await fs.writeFile(
    report,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Original Input ctor/message/list/frame/key query/routing; window and renderer device I/O are explicit host boundaries. Authored regions and physical key snapshots.',
        patches: engine.patches,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await engine.close();
}
