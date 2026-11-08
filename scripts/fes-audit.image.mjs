// SPDX-License-Identifier: MPL-2.0
// Authored bitmap operations against the user's private frozen-PE oracle.
// The oracle and its raw output belong below ignored .local/fes-audit/.
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { NativeBitmap, resampleBitmap } from '../src/native/image.mjs';
import { affineBitmap } from '../src/native/image-affine.mjs';

const oracle = process.argv[2];
if (!oracle)
  throw new Error(
    'Usage: node scripts/fes-audit.image.mjs <private-image-oracle> [private-report.json]',
  );
const wordBuffer = (words) => {
  const bytes = Buffer.alloc(words.length * 4);
  words.forEach((v, i) => bytes.writeUInt32LE(v >>> 0, i * 4));
  return bytes;
};
let seed = 0x47228191;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const pixels = (width, height) =>
  Uint8ClampedArray.from({ length: width * height * 4 }, () => random() >>> 24);
function swapChannels(bytes) {
  const output = new Uint8ClampedArray(bytes);
  for (let i = 0; i < output.length; i += 4)
    [output[i], output[i + 2]] = [output[i + 2], output[i]];
  return output;
}
const bitmap = (rgba, width, height) =>
  new NativeBitmap(null, {
    width,
    height,
    bpp: 4,
    canvasWidth: width,
    canvasHeight: height,
    offsetX: 0,
    offsetY: 0,
    baseX: 0,
    baseY: 0,
    attributes: [],
    clip: [0, 0, width, height],
    rgba,
    source: null,
  });
const findings = [],
  failures = [];
function call(operation, args, memory) {
  const result = spawnSync(oracle, {
    input: Buffer.concat([
      wordBuffer([operation, args.length, memory.length, 0]),
      wordBuffer(args),
      memory,
    ]),
  });
  if (result.status !== 0)
    throw new Error(`Oracle failed (${result.status}/${result.signal}): ${result.stderr}`);
  if (result.stdout.length !== 16 + memory.length)
    throw new Error('Incomplete bitmap oracle result');
  return result.stdout.subarray(16);
}
function compare(name, expected, actual) {
  const index = expected.findIndex((value, i) => value !== actual[i]);
  findings.push({ name, matched: index < 0 });
  if (index >= 0)
    failures.push({
      name,
      index,
      expected: expected[index],
      actual: actual[index],
      expectedBytes: [...expected],
      actualBytes: [...actual],
    });
}

for (let trial = 0; trial < 180; trial++) {
  const width = 1 + (trial % 13),
    height = 1 + ((trial * 7) % 11),
    rgba = pixels(width, height),
    at = 128;
  const memory = Buffer.alloc(at + rgba.length);
  wordBuffer([
    0,
    width,
    height,
    at,
    rgba.length,
    width * 4,
    4,
    width,
    height,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    width,
    height,
  ]).copy(memory);
  Buffer.from(swapChannels(rgba)).copy(memory, at);
  const rect = [(trial % 7) - 3, (trial % 9) - 4, trial % 17, trial % 15],
    color = random(),
    js = bitmap(rgba, width, height);
  const native = call(0, [0, ...rect, color], memory);
  await js.fill(...rect, color);
  compare(`fill-${trial}`, swapChannels(native.subarray(at)), await js.pixels());
}
for (let trial = 0; trial < 180; trial++) {
  const width = 1 + (trial % 9),
    height = 1 + (trial % 5),
    rgba = pixels(width, height),
    at = 128;
  const memory = Buffer.alloc(at + rgba.length);
  wordBuffer([
    0,
    width,
    height,
    at,
    rgba.length,
    width * 4,
    4,
    width,
    height,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    width,
    height,
  ]).copy(memory);
  Buffer.from(swapChannels(rgba)).copy(memory, at);
  const percent = [-1, 0, 1, 33, 50, 99, 100, 101, 150, 255, 1024, 2147483647].map((v) => v >>> 0),
    values = [
      percent[trial % percent.length],
      percent[(trial * 7 + 1) % percent.length],
      percent[(trial * 3 + 2) % percent.length],
    ];
  const native = call(1, [0, ...values], memory),
    js = bitmap(rgba, width, height);
  await js.tone(...values);
  compare(`tone-${trial}`, swapChannels(native.subarray(at)), await js.pixels());
}
for (let trial = 0; trial < 420; trial++) {
  const dw = 3 + (trial % 7),
    dh = 2 + (trial % 5),
    sw = 1 + (trial % 6),
    sh = 1 + ((trial * 3) % 4);
  const dest = pixels(dw, dh),
    source = pixels(sw, sh),
    a = 128,
    b = a + dest.length,
    memory = Buffer.alloc(b + source.length);
  const alphas = [0, 1, 2, 127, 128, 254, 255];
  for (let i = 3; i < source.length; i += 4)
    source[i] = alphas[(trial + (i >>> 2)) % alphas.length];
  for (let i = 3; i < dest.length; i += 4)
    dest[i] = alphas[(trial * 3 + (i >>> 2)) % alphas.length];
  if (trial % 3 === 0) dest.fill(0);
  const dx = (trial % 5) - 2,
    dy = ((trial * 3) % 5) - 2,
    sx = (trial % 3) - 1,
    sy = ((trial * 5) % 3) - 1;
  const width = 1 + (trial % 8),
    height = 1 + (trial % 6),
    copy = !!(trial & 1),
    alpha = alphas[(trial * 5) % alphas.length],
    flipY = !!(trial & 2);
  const descriptor = new Array(32).fill(0);
  descriptor.splice(0, 10, 4, a, dw, dh, dx, dy, width, height, dw * 4, 0);
  descriptor.splice(10, 11, 4, b, sw, sh, sx, sy, width, height, sw * 4, alpha, Number(flipY));
  wordBuffer(descriptor).copy(memory);
  Buffer.from(swapChannels(dest)).copy(memory, a);
  Buffer.from(swapChannels(source)).copy(memory, b);
  const native = call(copy ? 3 : 2, [0], memory),
    js = bitmap(dest, dw, dh),
    input = bitmap(source, sw, sh);
  await js.blit(input, { dx, dy, sx, sy, width, height, copy, alpha, flipY });
  compare(`blit-${trial}`, swapChannels(native.subarray(a, b)), await js.pixels());
}
for (let trial = 0; trial < 360; trial++) {
  const sw = 1 + (trial % 13),
    sh = 1 + ((trial * 7) % 11),
    dw = 1 + ((trial * 5) % 15),
    dh = 1 + ((trial * 3) % 14),
    source = pixels(sw, sh);
  if (trial % 7 === 0) for (let i = 3; i < source.length; i += 4) source[i] = 0;
  if (trial % 8 === 0) for (let i = 3; i < source.length; i += 4) source[i] = 255;
  const a = 128,
    b = a + dw * dh * 4,
    memory = Buffer.alloc(b + source.length),
    descriptor = new Array(32).fill(0);
  descriptor.splice(0, 10, 4, a, dw, dh, 0, 0, dw, dh, dw * 4, 1);
  descriptor.splice(10, 10, 4, b, sw, sh, 0, 0, sw, sh, sw * 4, 255);
  wordBuffer(descriptor).copy(memory);
  Buffer.from(swapChannels(source)).copy(memory, b);
  const native = call(3, [0], memory);
  compare(
    `resample-${trial}`,
    swapChannels(native.subarray(a, b)),
    resampleBitmap(source, sw, sh, dw, dh),
  );
}
for (let trial = 0; trial < 720; trial++) {
  const dw = 3 + (trial % 17),
    dh = 2 + ((trial * 7) % 13),
    sw = 1 + ((trial * 3) % 11),
    sh = 1 + ((trial * 5) % 9);
  const source = pixels(sw, sh),
    dest = pixels(dw, dh),
    a = 256,
    b = a + dest.length;
  const memory = Buffer.alloc(b + source.length),
    descriptor = new Array(50).fill(0);
  const position = [
    (trial % 13) - 4 + (trial % 4) * 0.25,
    ((trial * 3) % 11) - 3 + (trial % 8) * 0.125,
  ];
  const base = [(trial % 5) - 2 + (trial % 4) * 0.25, ((trial * 5) % 7) - 3 + (trial % 8) * 0.125];
  const rotation = [
    0,
    Math.PI / 2,
    -Math.PI / 2,
    Math.PI,
    -Math.PI,
    Math.PI / 4,
    -Math.PI / 7,
    0.731,
    -8,
    15,
  ][trial % 10];
  const scale = [
    [1, 1],
    [0, 0],
    [2, 0.5],
    [-1, 1],
    [1, -1],
    [-0.5, -1.75],
    [0.8, 1.3],
    [2.275, 0.632],
  ][Math.floor(trial / 10) % 8];
  const alpha = [0, 1, 127, 128, 254, 255][Math.floor(trial / 80) % 6];
  const clip = trial % 3 ? [0, 0, dw, dh] : [1, 1, dw - 1, dh - 1];
  if (trial % 4 === 0) dest.fill(0);
  if (trial % 7 === 0) for (let i = 3; i < source.length; i += 4) source[i] = 255;
  if (trial % 11 === 0) for (let i = 3; i < source.length; i += 4) source[i] = 0;
  const bits = (value) => {
    const bytes = Buffer.alloc(4);
    bytes.writeFloatLE(value);
    return bytes.readUInt32LE();
  };
  descriptor.splice(0, 11, 4, a, dw, dh, ...position.map(bits), ...clip, dw * 4);
  descriptor.splice(12, 6, 4, b, sw, sh, sw * 4, alpha);
  descriptor[20] = 1;
  descriptor.splice(22, 9, 0, 0, sw, sh, ...base.map(bits), bits(rotation), ...scale.map(bits));
  wordBuffer(descriptor).copy(memory);
  Buffer.from(swapChannels(dest)).copy(memory, a);
  Buffer.from(swapChannels(source)).copy(memory, b);
  const native = call(6, [0], memory),
    js = new Uint8ClampedArray(dest);
  affineBitmap(js, dw, dh, source, sw, sh, { position, base, rotation, scale, alpha, clip });
  compare(`affine-${trial}`, swapChannels(native.subarray(a, b)), js);
}
const report = {
  count: findings.length,
  matched: findings.filter((f) => f.matched).length,
  findings,
  failures,
};
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      count: report.count,
      matched: report.matched,
      failures: failures
        .slice(0, 5)
        .map(({ name, index, expected, actual }) => ({ name, index, expected, actual })),
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
