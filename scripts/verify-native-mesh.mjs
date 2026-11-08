// SPDX-License-Identifier: MPL-2.0
// Authored divided mesh inputs. Original wrappers and kc2DDivModel affine
// conversion execute in a user-supplied frozen PE.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { nodeGame } from './node-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import {
  nativeMesh,
  packNativeMesh,
  decodeNativeMesh,
  transformNativeMesh,
} from '../src/native/mesh.mjs';
import { MOTION_ABI, initialMotionObject, setMotionVector } from '../src/motion/abi.mjs';
import { floatBits } from '../src/kcs.mjs';
import { identity } from '../src/motion/matrix.mjs';
import { nativeGraphics } from '../src/native/graphics.mjs';

const [root, profile, output] = process.argv.slice(2);
if (!root || !output || !NATIVE_PROFILES[profile])
  throw new Error(
    'Usage: node scripts/verify-native-mesh.mjs FIXED_GAME_DIRECTORY PROFILE IGNORED_REPORT',
  );
const addresses = profile.startsWith('nekopara')
  ? { constructor: 0x682c30, transform: 0x6835a0, matrix: 0x682610, messageDelta: 0 }
  : { constructor: 0x5597a0, transform: 0x55a110, matrix: 0x5591a0, messageDelta: 2 };
const game = await nodeGame(root),
  configuration = new NativeConfiguration({ profile }),
  engine = await NativeEngineProcess.open({ game, profile, configuration }),
  p = engine.process,
  vm = p.allocate(1400, true),
  source = p.allocate(8192, true),
  argsPointer = p.allocate(32, true),
  result = p.allocate(4, true),
  sender = p.allocate(104, true),
  vft = p.allocate(32, true),
  model = p.allocate(468, true),
  nativeOutput = p.allocate(80, true);
engine.registerWindows('USER32.dll', 'SetRectEmpty', {
  count: 1,
  fn: ([rectangle]) => {
    p.zero(rectangle, 16);
    return 1;
  },
});
const golden = [];
let passed = 0,
  seed = 0x3c18fa97,
  captured;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
  number = () => Math.fround(((next() % 20001) - 10000) / 113),
  compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  };
p.store(vm + 20, source);
p.store(vm + 36, 8192);
p.store(sender, vft);
p.store(sender + 4, 7);
p.store(
  vft + 16,
  p.trap('mesh engine-message boundary', 7, ([from, target, message, w, l]) => {
    message += addresses.messageDelta;
    captured = {
      from,
      target,
      message,
      w,
      ...(message === 83 ? { bytes: p.read(l, w * 80) } : { l }),
    };
    return 1;
  }),
);
try {
  for (const count of [0, 1, 2, 7, 31]) {
    const input = new Uint8Array(count * 64),
      view = new DataView(input.buffer);
    for (let at = 0; at < input.length; at += 4) view.setUint32(at, next(), true);
    p.write(source + 256, input);
    [8, 256, count].forEach((word, i) => p.store(argsPointer + i * 4, word));
    const original = await engine.call(
      p.load(NATIVE_PROFILES[profile].tables.main.va + 0x1d3 * 4),
      [vm, sender, argsPointer, result],
    );
    let actual;
    const reply = await nativeMesh(
      0x1d3,
      [8, 256, count],
      { bytes: (at, size) => p.read(source + at, size) },
      { id: 7 },
      {
        sendNativeEngine: async (target, from, message, w, l, { payload: memory }) => {
          actual = { from, target, message, w, bytes: memory.bytes(l, w * 80).slice() };
        },
      },
    );
    compare(reply.control, original, 'divided mesh wrapper control');
    // The wrapper leaves three color words per triangle uninitialized.
    for (const packet of [actual, captured])
      for (let index = 0; index < count; index++)
        for (const at of [20, 44, 68]) packet.bytes.fill(0, index * 80 + at, index * 80 + at + 4);
    compare(actual, captured, 'divided mesh wrapper packet');
  }
  for (const word of [0, 1, 2, 3, 0x80000000, 0xffffffff]) {
    [8, word].forEach((value, i) => p.store(argsPointer + i * 4, value));
    const original = await engine.call(
      p.load(NATIVE_PROFILES[profile].tables.main.va + 0x1d2 * 4),
      [vm, sender, argsPointer, result],
    );
    let actual;
    const reply = await nativeMesh(
      0x1d2,
      [8, word],
      null,
      { id: 7 },
      {
        sendNativeEngine: async (target, from, message, w, l) => {
          actual = { from, target, message, w, l };
        },
      },
    );
    compare(reply.control, original, 'mesh projection mode control');
    compare(actual, captured, 'mesh projection mode packet');
  }
  const replyWords = [0x3f800000, 0xc0000000, 0x40400000, 0x40800000, 0x40a00000, 0x40c00000],
    machine = {
      load: (at) => p.load(source + at),
      store: (at, value) => p.store(source + at, value),
    };
  p.store(
    vft + 16,
    p.trap('graph parameter message boundary', 7, ([from, target, message, w, l, flags]) => {
      message += addresses.messageDelta;
      captured = {
        from,
        target,
        message,
        flags,
        ...(message === 81 ? { w, l } : {}),
        ...(message === 57 ? { w, matrix: p.read(l, 64) } : {}),
      };
      if (message === 75) {
        p.store(w, replyWords[0]);
        p.store(l, replyWords[1]);
      }
      if (message === 76)
        for (let i = 0; i < 3; i++) {
          p.store(w + i * 4, replyWords[i]);
          p.store(l + i * 4, replyWords[i + 3]);
        }
      return 1;
    }),
  );
  for (let trial = 0; trial < 12; trial++)
    for (const [id, parameters] of [
      [0x157, [8, 512, 520]],
      [0x158, [8, 256, trial]],
      [0x159, [8, 512, 520, 528, 536]],
      [0x192, [8, trial]],
    ]) {
      for (let i = 0; i < 16; i++) p.store(source + 256 + 4 * i, next());
      parameters.forEach((value, i) => p.store(argsPointer + i * 4, value));
      const before = p.read(source, 8192),
        control = await engine.call(p.load(NATIVE_PROFILES[profile].tables.main.va + id * 4), [
          vm,
          sender,
          argsPointer,
          result,
        ]),
        originalBytes = p.read(source, 8192);
      let actual;
      p.write(source, before);
      const reply = await nativeGraphics(
        id,
        parameters,
        machine,
        { id: 7 },
        {
          sendNativeEngine: async (target, from, message, w, l, { payload: memory, flags }) => {
            actual = {
              from,
              target,
              message,
              flags,
              ...(message === 81 ? { w, l } : {}),
              ...(message === 57 ? { w, matrix: memory.bytes(l, 64).slice() } : {}),
            };
            if (message === 75) {
              memory.store(w, replyWords[0]);
              memory.store(l, replyWords[1]);
            }
            if (message === 76)
              for (let i = 0; i < 3; i++) {
                memory.store(w + i * 4, replyWords[i]);
                memory.store(l + i * 4, replyWords[i + 3]);
              }
            return 1;
          },
        },
      );
      compare(reply.control, control, `graph parameter wrapper control/${id}`);
      compare(actual, captured, `graph parameter wrapper packet/${id}`);
      compare(p.read(source, 8192), originalBytes, `graph parameter wrapper memory/${id}`);
    }
  await engine.call(addresses.constructor, [], model);
  const data = p.allocate(80, true),
    cache = p.allocate(80, true);
  p.store(model + 336, data);
  p.store(model + 340, 1);
  p.store(model + 400, cache);
  p.store(model + 388, 1);
  for (let trial = 0; trial < 240; trial++) {
    const input = new Uint8Array(64),
      inputView = new DataView(input.buffer),
      bytes = initialMotionObject(),
      view = new DataView(bytes.buffer),
      base = [number(), number(), number()],
      position = [number(), number(), number()],
      scale = [number() / 20, number() / 20, number() / 20],
      matrix =
        trial % 3
          ? Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? Number(i === 15) : number() / 100))
          : identity();
    inputView.setUint32(0, trial, true);
    for (let i = 1; i < 16; i++) inputView.setFloat32(i * 4, number(), true);
    const record = packNativeMesh(input, 1),
      records = decodeNativeMesh(record),
      color = next();
    p.write(data, record);
    p.store(model + 4, 1);
    p.store(model + 392, color);
    setMotionVector(bytes, MOTION_ABI.base, base);
    setMotionVector(bytes, MOTION_ABI.pos, position);
    setMotionVector(bytes, MOTION_ABI.scale, scale);
    view.setUint32(MOTION_ABI.color, color, true);
    matrix.forEach((value, i) => view.setFloat32(MOTION_ABI.matrix + 4 * i, value, true));
    for (const [at, values] of [
      [8, base],
      [24, scale],
      [56, position],
      [104, matrix],
    ])
      values.forEach((value, i) => p.store(model + at + 4 * i, floatBits(value)));
    p.store(model + 232, 1);
    await engine.call(addresses.matrix, [], model);
    compare(
      await engine.call(addresses.transform, [0, nativeOutput, 1], model),
      1,
      'divided mesh transform control',
    );
    const native = decodeNativeMesh(p.read(nativeOutput, 80)),
      actual = transformNativeMesh(records, bytes, { matrixExplicit: true });
    compare(actual, native, `divided mesh affine/${trial}`);
    if (trial < 24)
      golden.push({
        source: Buffer.from(input).toString('base64'),
        state: Buffer.from(bytes).toString('base64'),
        expected: Buffer.from(p.read(nativeOutput, 80)).toString('base64'),
      });
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: NATIVE_PROFILES[profile].sha256,
        passed,
        scope:
          'Original main157/158/159/192/1D2/1D3 message packing and kc2DDivModel affine transform. Host engine-message delivery is explicit; wrapper uninitialized color words are excluded.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native mesh differential passed ${passed}/${passed}`);
  if (process.argv.includes('--golden')) {
    const path = process.argv[process.argv.indexOf('--golden') + 1];
    if (!path) throw new Error('--golden requires an authored fixture output path');
    await writeFile(path, JSON.stringify(golden, null, 2) + '\n');
  }
} finally {
  await engine.close();
}
