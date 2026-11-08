// SPDX-License-Identifier: MPL-2.0
// Authored inputs for original main-table motion math; private PE harness is
// deliberately external. Neither fixture assets nor native image bytes enter Git.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { KCSMachine, floatBits } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
import { nativeMotion } from '../src/native/motion.mjs';

const oracle = process.argv[process.argv.indexOf('--oracle') + 1];
if (!process.argv.includes('--oracle'))
  throw new Error('--oracle requires the fixed main motion-math harness');
let seed = 0x42531c82;
const next = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
};
const cases = [];
for (let i = 0; i < 64; i++) {
  cases.push({
    id: 0x13e,
    args: [-75, 150, -10, 25, (next() % 10000) / 100 - 40].map(floatBits),
    memory: new Uint8Array(),
  });
  cases.push({
    id: 0x13f,
    args: [floatBits(((next() % 10000) - 5000) / 16)],
    memory: new Uint8Array(),
  });
}
for (let count = 0; count <= 32; count++)
  for (let iteration = 0; iteration < 12; iteration++) {
    const memory = new Uint8Array(Math.max(4, count * 20)),
      view = new DataView(memory.buffer);
    let x = 0;
    for (let i = 0; i < count; i++) {
      x += iteration === 11 ? 0 : 1 + (next() % 10000) / 313;
      view.setFloat32(i * 20, x, true);
      view.setFloat32(i * 20 + 4, ((next() % 200000) - 100000) / 317, true);
    }
    cases.push({ id: 0x140, args: [0, count], memory });
  }
const report = { cases: cases.length, matched: 0, failures: [] };
for (const [index, { id, args, memory }] of cases.entries()) {
  const header = Buffer.alloc(16 + args.length * 4);
  [id, args.length, memory.length, 0, ...args].forEach((n, i) =>
    header.writeUInt32LE(n >>> 0, i * 4),
  );
  const native = spawnSync(oracle, [], { input: Buffer.concat([header, memory]) });
  if (native.status !== 0 || native.stdout.length !== 16 + memory.length) {
    report.failures.push({ index, id, status: native.status, signal: native.signal });
    continue;
  }
  const script = {
    body: new Binary(new Uint8Array([59])),
    codeSize: 1,
    data: memory,
    stackSize: 0,
  };
  const machine = new KCSMachine(script, {}),
    reply = nativeMotion(id, args, machine);
  const expected = native.stdout.subarray(16),
    actual = Buffer.from(machine.memory);
  if (
    reply.control !== native.stdout.readUInt32LE(0) ||
    (reply.value ?? 0xcccccccc) !== native.stdout.readUInt32LE(4) ||
    !expected.equals(actual)
  )
    report.failures.push({
      index,
      id,
      args,
      control: reply.control,
      value: reply.value,
      differences: Array.from({ length: memory.length / 4 }, (_, i) => i * 4)
        .filter((i) => actual.readUInt32LE(i) !== expected.readUInt32LE(i))
        .map((offset) => ({
          offset,
          native: expected.readUInt32LE(offset),
          web: actual.readUInt32LE(offset),
        })),
    });
  else report.matched++;
}
await mkdir('.local/fes-audit', { recursive: true });
await writeFile('.local/fes-audit/motion-main-math-diff.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, failures: report.failures.slice(0, 5) }, null, 2));
if (report.failures.length) process.exitCode = 1;
