// SPDX-License-Identifier: MPL-2.0
// The supplied original constructors run up to their first resource allocation.
// The explicit stopping boundaries isolate capability negotiation and texture
// dimension rounding; they do not validate the remaining graphics constructor.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { nodeGame } from './node-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import {
  negotiateNativeTextureLayout,
  convertNativeTexturePixels,
} from '../src/native/texture-layout.mjs';

const [root, profile, output] = process.argv.slice(2),
  bindings = profile?.startsWith('nekopara')
    ? {
        caps: 0xb8f074,
        graphics: 0x678b60,
        graphicsStop: 0x678c6e,
        texture: 0x680280,
        textureStop: 0x68032a,
        log: 0x5cac90,
        upload: 0x688c60,
        system: 0xb8f04c,
        cpu: 1052,
      }
    : profile?.startsWith('sdk-')
      ? {
          caps: 0xc93b94,
          graphics: 0x54f8e0,
          graphicsStop: 0x54f9ee,
          texture: 0x556ea0,
          textureStop: 0x556f4a,
          log: 0x4a82f0,
          upload: 0x5615b0,
          system: 0xc93b6c,
          cpu: 540,
        }
      : null;
if (!root || !output || !bindings)
  throw new Error(
    'Usage: node scripts/verify-native-texture-layout.mjs FIXED_GAME_DIRECTORY PROFILE IGNORED_REPORT',
  );
const game = await nodeGame(root),
  configuration = new NativeConfiguration({ profile }),
  engine = await NativeEngineProcess.open({ game, profile, configuration }),
  p = engine.process,
  caps = p.allocate(256, true),
  graphics = p.allocate(544, true),
  texture = p.allocate(32, true),
  system = p.allocate(2048, true),
  packet = p.allocate(128, true),
  sourcePixels = p.allocate(16384, true),
  targetPixels = p.allocate(16384, true),
  stopped = new Error('Authored texture oracle allocation boundary');
let passed = 0,
  seed = 0x82ac16ef,
  stoppedAt;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
  invoke = async (address, pointer, phase) => {
    stoppedAt = null;
    await assert.rejects(engine.call(address, [], pointer), (error) => error === stopped);
    assert.equal(stoppedAt, phase);
  };
engine.registerWindows('USER32.dll', 'SetRectEmpty', {
  count: 1,
  fn: ([rectangle]) => {
    p.zero(rectangle, 16);
    return 1;
  },
});
p.store(bindings.caps, caps);
engine.patch(bindings.graphicsStop, 'graphics backing allocation boundary', 0, () => {
  stoppedAt = 'graphics';
  throw stopped;
});
engine.patch(bindings.textureStop, 'texture backing allocation boundary', 0, () => {
  stoppedAt = 'texture';
  throw stopped;
});
engine.patch(bindings.log, 'texture diagnostic log sink', 1, () => 0);
try {
  for (let trial = 0; trial < 240; trial++) {
    const size = [2 ** (1 + (next() % 12)), 2 ** (1 + (next() % 12))],
      maximum = {
        width: 2 ** (1 + (trial % 12)),
        height: 2 ** (1 + (Math.floor(trial / 12) % 12)),
      };
    if (trial % 3 === 0) size[trial % 2] += 1;
    const source = {
        size,
        grid: [1 + (next() % 32), 1 + (next() % 32)],
        areas: Array.from({ length: 8 }, () => Array.from({ length: 4 }, next)),
        bppY: [next(), next()],
        bpp: 32,
      },
      expected = negotiateNativeTextureLayout(source, maximum),
      fields = configuration.fields.texture;
    fields.size.set(source.size);
    fields.grid.set(source.grid);
    fields.bppY.set(source.bppY);
    source.areas.forEach((row, i) => fields.areas[i].set(row));
    p.store(caps + 88, maximum.width);
    p.store(caps + 92, maximum.height);
    await invoke(bindings.graphics, graphics, 'graphics');
    for (const field of ['grid', 'areas', 'bppY'])
      compare(fields[field], expected[field], `graphics ${field}/${trial}`);
    compare(fields.size, expected.configurationSize, `graphics settings size/${trial}`);
    await invoke(bindings.texture, texture, 'texture');
    compare(
      [p.load(texture), p.load(texture + 4)],
      [...expected.size],
      `texture backing size/${trial}`,
    );
    compare(
      fields.size,
      expected.configurationSize,
      `texture manager preserves settings size/${trial}`,
    );
  }
  p.store(bindings.system, system);
  for (const mmx of [0, 1])
    for (const width of [1, 2, 3, 16, 17, 32, 65])
      for (const height of [1, 3, 7]) {
        const input = new Uint8ClampedArray(width * height * 4),
          stride = width * 4 + 8,
          targetStride = width * 2 + 6,
          source = new Uint8Array(stride * height).fill(0x5a),
          target = new Uint8Array(targetStride * height).fill(0xa5);
        for (let i = 0; i < input.length; i++) input[i] = next() & 255;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4,
              out = y * stride + x * 4;
            source.set([input[at + 2], input[at + 1], input[at], input[at + 3]], out);
          }
        p.write(sourcePixels, source);
        p.write(targetPixels, target);
        p.zero(packet, 128);
        for (const [index, value] of [
          [0, 2],
          [1, targetPixels],
          [2, width],
          [3, height],
          [6, width],
          [7, height],
          [8, targetStride],
          [10, 4],
          [11, sourcePixels],
          [12, width],
          [13, height],
          [16, width],
          [17, height],
          [18, stride],
        ])
          p.store(packet + index * 4, value);
        p.store(system + bindings.cpu + 40, mmx);
        compare(
          await engine.call(bindings.upload, [packet]),
          1,
          `original texture upload control/${mmx}/${width}/${height}`,
        );
        const actual = convertNativeTexturePixels(input.slice(), 16),
          expected = new Uint8Array(target),
          view = new DataView(expected.buffer);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4,
              value =
                ((actual[at + 3] / 17) << 12) |
                ((actual[at] / 17) << 8) |
                ((actual[at + 1] / 17) << 4) |
                (actual[at + 2] / 17);
            view.setUint16(y * targetStride + x * 2, value, true);
          }
        compare(
          p.read(targetPixels, expected.length),
          expected,
          `A4R4G4B4 texture upload/${mmx}/${width}/${height}`,
        );
      }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: engine.identity,
        passed,
        scope:
          'Original graphics capability negotiation and texture manager power-of-two rounding stop before resource allocation; logging and SetRectEmpty are explicit host services. Original scalar/MMX A4R4G4B4 upload executes completely with authored system CPU flags, padded rows and pixel buffers. Remaining graphics initialization is outside this probe.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native texture layout differential passed ${passed}/${passed}`);
} finally {
  await engine.close();
}
