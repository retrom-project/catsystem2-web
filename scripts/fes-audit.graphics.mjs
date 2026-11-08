// SPDX-License-Identifier: MPL-2.0
// Authored transformed triangle/projection cases, no game assets or code.
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { projectNativeTriangle } from '../src/render/native-geometry.mjs';
import { identity, multiply, rotation, scaling, translation } from '../src/motion/matrix.mjs';
const oracle = process.argv[2];
if (!oracle)
  throw new Error(
    'Usage: node scripts/fes-audit.graphics.mjs <private-image-oracle> [private-report.json]',
  );
const words = (values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
  return b;
};
let seed = 0x7977aee4;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8) / 16777216;
const findings = [],
  failures = [];
for (let trial = 0; trial < 480; trial++) {
  const textured = !!(trial & 1),
    width = 801 + (trial % 7),
    height = 603 + (trial % 9),
    coordMode = trial % 3,
    enabled = !(trial % 7 === 0),
    priority = Math.fround(random() * 1500 - 750),
    cameraNear = [0, 1, 1000, 1500][trial % 4];
  const position = [Math.fround(random() * 600), Math.fround(random() * 400), 0],
    screenShift = [Math.fround(random() * 10), Math.fround(random() * -10)];
  let screenMatrix = identity();
  if (trial % 4)
    screenMatrix = multiply(
      multiply(scaling(1.5, 0.5, 1), rotation('z', 0.3)),
      translation(20, 30, 0),
    );
  const triangle = Array.from({ length: 3 }, (_, i) => ({
    x: Math.fround(random() * width),
    y: Math.fround(random() * height),
    z: trial % 5 === 0 ? 0 : trial % 6 === 0 && i === 0 ? 0 : Math.fround(random() * 3000 - 1500),
    color: (0xff000000 + i * 0x553311) >>> 0,
    u: Math.fround(random()),
    v: Math.fround(random()),
  }));
  const input = 256,
    output = 512,
    base = 640,
    pos = 656,
    memory = Buffer.alloc(800);
  memory.writeFloatLE(width * 0.5, 44);
  memory.writeFloatLE(height * 0.5, 48);
  memory.writeFloatLE(cameraNear, 224);
  screenMatrix.forEach((v, i) => memory.writeFloatLE(v, 96 + i * 4));
  screenShift.forEach((v, i) => memory.writeFloatLE(v, 228 + i * 4));
  memory.writeFloatLE(priority, base + 8);
  position.forEach((v, i) => memory.writeFloatLE(v, pos + i * 4));
  triangle.forEach((v, i) => {
    const at = input + i * (textured ? 24 : 16);
    memory.writeFloatLE(v.x, at);
    memory.writeFloatLE(v.y, at + 4);
    memory.writeFloatLE(v.z, at + 8);
    memory.writeUInt32LE(v.color, at + 12);
    if (textured) {
      memory.writeFloatLE(v.u, at + 16);
      memory.writeFloatLE(v.v, at + 20);
    }
  });
  const run = spawnSync(oracle, {
    input: Buffer.concat([
      words([textured ? 5 : 4, 7, memory.length, 0]),
      words([0, input, output, base, pos, coordMode, Number(enabled)]),
      memory,
    ]),
  });
  if (run.status !== 0)
    throw new Error(`Graph projection oracle failed: ${run.status}/${run.signal}`);
  const native = run.stdout.subarray(16 + output, 16 + output + (textured ? 84 : 60)),
    expected = projectNativeTriangle(triangle, {
      textured,
      width,
      height,
      coordMode,
      enabled,
      priority,
      position,
      cameraNear,
      screenMatrix,
      screenShift,
    }),
    js = Buffer.alloc(native.length);
  expected.forEach((v, i) => {
    const at = i * (textured ? 28 : 20);
    [v.x, v.y, v.z, v.w].forEach((n, j) => js.writeFloatLE(n, at + j * 4));
    js.writeUInt32LE(v.color, at + 16);
    if (textured) {
      js.writeFloatLE(v.u, at + 20);
      js.writeFloatLE(v.v, at + 24);
    }
  });
  const index = native.findIndex((v, i) => v !== js[i]);
  findings.push({ trial, matched: index < 0 });
  if (index >= 0)
    failures.push({
      trial,
      index,
      native: native.toString('hex'),
      js: js.toString('hex'),
      parameters: {
        triangle,
        textured,
        width,
        height,
        coordMode,
        enabled,
        priority,
        position,
        cameraNear,
        screenMatrix,
        screenShift,
      },
    });
}
const report = {
  count: findings.length,
  matched: findings.filter((v) => v.matched).length,
  findings,
  failures,
};
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      count: report.count,
      matched: report.matched,
      failures: failures.slice(0, 5).map(({ trial, index }) => ({ trial, index })),
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
