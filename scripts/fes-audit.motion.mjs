// SPDX-License-Identifier: MPL-2.0
// Differential inputs are independently authored; the PE harness stays local.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { Binary } from '../src/binary.mjs';
import { floatBits } from '../src/kcs.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';

const oracle = process.argv[process.argv.indexOf('--oracle') + 1];
if (!process.argv.includes('--oracle'))
  throw new Error('--oracle requires the fixed native generic harness');
const profile = process.argv.includes('--sdk')
  ? 'sdk-4.01-engine-2.6.1.74'
  : 'nekopara-vol3-engine-2.6.1.76';
const f = Math.fround;
let seed = 0x1f03d52b;
function number() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return f(((seed % 200001) - 100000) / 997);
}
function fixtures(id, iteration) {
  const memory = new Uint8Array(512),
    view = new DataView(memory.buffer);
  const put = (offset, values) =>
    values.forEach((n, i) => view.setFloat32(offset + i * 4, n, true));
  put(0, Array.from({ length: 64 }, number));
  let args;
  if (id === 0) {
    memory.set([77, 79, 84, 0]);
    args = [0];
  } else if (id <= 17) {
    let a = number(),
      b = number();
    if ([4, 5].includes(id)) a = f(a / 101);
    if (id === 12 || id === 13) a = Math.abs(a);
    if (id === 13) b = f((iteration % 7) - 3);
    if (id === 16) args = [(a * 100) | 0];
    else args = [7, 11, 13].includes(id) ? [floatBits(a), floatBits(b)] : [floatBits(a)];
  } else if (id <= 20) args = [0, 4, 8, floatBits(f(number() / 30))];
  else if (id <= 22) args = [0, 4, 8, ...[number(), number(), number()].map(floatBits)];
  else if ([23, 24, 25, 43].includes(id))
    args = [0, ...[number(), number(), number()].map(floatBits)];
  else if ([26, 27, 31, 34, 35].includes(id)) {
    args = [0];
    if (id === 27 && iteration % 4 === 0) memory.fill(0, 0, 64);
    if (id === 31 && iteration === 0) put(0, [0, 0, 0, 0]);
    if (id === 31 && iteration === 1) put(0, [1, 0, 0, 0]);
  } else if ([28, 29, 30, 32, 33, 36, 37].includes(id)) args = [0, 64];
  else if ([38, 39, 40].includes(id)) args = [];
  else if (id === 41) args = [-50, 75, -10, 90, f(number())].map(floatBits);
  else if (id === 42) args = [number(), f((iteration + 1) * 2.5)].map(floatBits);
  else if (id === 44) {
    args = [0, 64, 128];
    put(128, [number() / 20, number() / 20, number() / 20]);
  }
  return { memory, args };
}
const reports = [];
for (let id = 0; id < 45; id++) {
  const result = { id, cases: 0, matched: 0, mismatches: [], errors: [] };
  for (let iteration = 0; iteration < 24; iteration++) {
    const { memory, args } = fixtures(id, iteration);
    const header = Buffer.alloc(16 + args.length * 4);
    [id, args.length, memory.length, 0, ...args].forEach((value, i) =>
      header.writeUInt32LE(value >>> 0, i * 4),
    );
    const native = spawnSync(oracle, [], { input: Buffer.concat([header, memory]) });
    if (native.status !== 0 || native.stdout.length !== 16 + memory.length) {
      result.errors.push({
        iteration,
        source: 'native',
        status: native.status,
        signal: native.signal,
      });
      continue;
    }
    result.cases++;
    try {
      const script = {
        name: 'authored-native-probe',
        body: new Binary(new Uint8Array([59])),
        codeSize: 1,
        data: memory,
        stackSize: 0,
      };
      const instance = new MotionInstance(script, { profile });
      const reply = instance.native(id, args, instance.machine);
      const output = Buffer.from(instance.machine.memory),
        expected = native.stdout.subarray(16);
      const differences = [];
      for (let offset = 0; offset < expected.length; offset += 4)
        if (output.readUInt32LE(offset) !== expected.readUInt32LE(offset))
          differences.push({
            offset,
            native: expected.readUInt32LE(offset),
            web: output.readUInt32LE(offset),
          });
      if (
        reply.control !== native.stdout.readUInt32LE(0) ||
        (reply.value ?? 0xcccccccc) !== native.stdout.readUInt32LE(4)
      )
        differences.push({
          control: reply.control,
          nativeControl: native.stdout.readUInt32LE(0),
          value: reply.value ?? 0xcccccccc,
          nativeValue: native.stdout.readUInt32LE(4),
        });
      if (differences.length) result.mismatches.push({ iteration, args, differences });
      else result.matched++;
    } catch (error) {
      result.errors.push({ iteration, source: 'web', message: error.message });
    }
  }
  reports.push(result);
}
const totals = {
  profile,
  ids: reports.length,
  cases: reports.reduce((n, r) => n + r.cases, 0),
  matched: reports.reduce((n, r) => n + r.matched, 0),
  errors: reports.reduce((n, r) => n + r.errors.length, 0),
  mismatches: reports.reduce((n, r) => n + r.mismatches.length, 0),
  failedIDs: reports
    .filter((r) => r.errors.length || r.mismatches.length)
    .map((r) => ({
      id: r.id,
      matched: r.matched,
      cases: r.cases,
      errors: r.errors.length,
      mismatches: r.mismatches.length,
    })),
};
await mkdir('.local/fes-audit', { recursive: true });
await writeFile(
  `.local/fes-audit/motion-native-diff-${profile}.json`,
  JSON.stringify({ totals, reports }, null, 2),
);
console.log(JSON.stringify(totals, null, 2));
if (totals.errors || totals.mismatches) process.exitCode = 1;
