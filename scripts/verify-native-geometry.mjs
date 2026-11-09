// SPDX-License-Identifier: MPL-2.0
// Complete original matrix/vector wrappers; no arithmetic helper is replaced.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeGeometry, NATIVE_GEOMETRY_CONTRACTS } from '../oracle/geometry.mjs';
import { NativeMatrices } from '../oracle/matrix.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { KCSMachine, floatBits } from '../src/kcs/vm.mjs';
import { Binary } from '../src/binary.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-geometry.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Geometry oracle requires a frozen engine image');
const original = await NativeEngineProcess.open({ bytes, profile }),
  engine = await NativeEngineProcess.open({ bytes, profile }),
  p = original.process,
  q = engine.process,
  world = { objects: { machine: () => null } },
  geometry = new NativeGeometry(engine, world),
  matrices = new NativeMatrices(engine),
  rawMatrices = new NativeMatrices(original),
  index = Number(profile.startsWith('sdk-')),
  machine = () =>
    new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(4096),
        stackSize: 4096,
      },
      {},
      new Uint8Array(1024),
    ),
  a = machine(),
  b = machine(),
  block = a.allocate(1024),
  otherBlock = b.allocate(1024),
  globalA = await original.call(rawMatrices.operations.identity, [0]),
  globalB = await engine.call(matrices.operations.identity, [0]),
  covered = new Map();
let calls = 0,
  comparisons = 0,
  seed = 0x174bb9af;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
  check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  };
check(block, otherBlock, 'same extended VM address');
check(globalA, globalB, 'same native current matrix address');
const reset = () => {
    for (const m of [a, b]) {
      m.memory.fill(0xa5);
      m.shared.fill(0x5a);
      for (const bytes of m.blocks) bytes.fill(0x3c);
    }
  },
  put = (address, values) => {
    for (const m of [a, b]) values.forEach((word, i) => m.store((address + i * 4) >>> 0, word));
  },
  matrix = [2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 5, -3, 7, 1].map(floatBits),
  global = (values) => {
    p.write(globalA, new Uint8Array(new Uint32Array(values).buffer));
    q.write(globalB, new Uint8Array(new Uint32Array(values).buffer));
  };
async function run(spec, args) {
  const words = Array.from(args);
  while (words.length < spec.words) words.push(a.nativeArgument(words.length));
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    words.forEach((word, i) => p.store(argv + i * 4, word));
    p.store(out, 0xcccccccc);
    control = await original.call(spec.handlers[index], [bridge.pointer, 0, argv, out]);
    value = p.load(out);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
  }
  const reply = await geometry.apply(spec.id, args, b, { id: 17 });
  calls++;
  covered.set(spec.id, (covered.get(spec.id) ?? 0) + 1);
  check(reply.control, control, 'control ' + spec.id.toString(16));
  if (control === 1) check(reply.value, value, 'raw result word');
  check(b.memory, a.memory, 'all data/stack and canaries');
  check(b.shared, a.shared, 'all shared bytes');
  check(b.blocks, a.blocks, 'all extended bytes');
  check(q.read(globalB, 64), p.read(globalA, 64), 'current native matrix');
}
try {
  const bases = [0, 4160, 0x80000000, block];
  for (const spec of NATIVE_GEOMETRY_CONTRACTS) {
    for (let n = 0; n < 128; n++) {
      reset();
      const base = bases[n % 4],
        source = (base + 128) >>> 0;
      let values = Array.from({ length: 16 }, () => floatBits(((next() % 200001) - 100000) / 331));
      if (n < 16) {
        const exceptional = [
          0, 0x80000000, 0x3f800000, 0xbf800000, 0x7f800000, 0xff800000, 0x7fc12345, 0x7f812345, 1,
          0x80000001, 0x007fffff, 0x807fffff, 0x7f7fffff, 0xff7fffff, 0x00800000, 0x80800000,
        ];
        values = Array.from({ length: 16 }, (_, i) => exceptional[(n + i) % exceptional.length]);
      }
      if (spec.id === 0x15e) {
        if (n % 5 === 0) values = matrix;
        if (n % 7 === 0) values.fill(0);
      }
      put(base, values);
      put(
        source,
        Array.from({ length: 16 }, (_, i) => values[15 - i]),
      );
      if (spec.id === 0x165)
        put(source, [n < 16 ? values[0] : floatBits(((next() % 20001) - 10000) / 997)]);
      let args = [base, source].slice(0, spec.words);
      // Both complete and partially overlapping operands preserve the original
      // sequential copy/SSE read order, rather than an invented memmove.
      if (spec.words === 2 && n >= 16 && n % 3 === 0)
        args[1] = (base + [0, 4, 8, 16, 32][n % 5]) >>> 0;
      if (n >= 96 && spec.words === 2) {
        const elsewhere = bases[(n + 1) % 4];
        put(elsewhere, matrix);
        args[1] = elsewhere;
      }
      if (spec.id === 0x15e && n % 11 === 0) {
        global(values);
        args[0] = 0xffffffff;
      }
      await run(spec, args);
    }
    // Missing declared arguments still read adjacent live GCALL stack words.
    reset();
    put(128, matrix);
    put(256, matrix);
    a.nativeArgumentBase = b.nativeArgumentBase = 6000;
    put(6000, [128, 256]);
    await run(spec, []);
  }
  global(matrix);
  await run(NATIVE_GEOMETRY_CONTRACTS[0], [0xffffffff]);
  const saved = structuredClone({ engine: engine.snapshot(), machine: b.snapshot() }),
    fresh = await NativeEngineProcess.open({ bytes, profile });
  try {
    const fg = new NativeGeometry(fresh, world),
      fm = machine();
    new NativeMatrices(fresh);
    fresh.restore(saved.engine);
    fm.restore(saved.machine);
    check(fresh.process.read(globalB, 64), q.read(globalB, 64), 'fresh original current matrix');
    for (const spec of NATIVE_GEOMETRY_CONTRACTS) {
      const args = spec.words === 1 ? [0] : [0, 128];
      reset();
      put(0, matrix);
      put(128, matrix);
      fm.restore(b.snapshot());
      const left = await geometry.apply(spec.id, args, b, { id: 17 }),
        right = await fg.apply(spec.id, args, fm, { id: 17 });
      check(right, left, 'fresh result');
      check(fm.memory, b.memory, 'fresh continuation bytes');
      check(fresh.process.read(globalB, 64), q.read(globalB, 64), 'fresh native global state');
    }
  } finally {
    await fresh.close();
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        covered: Object.fromEntries([...covered].map(([id, n]) => [id.toString(16), n])),
        scope:
          'All nine original wrappers and D3DX/SSE helpers, raw special float words, all VM regions, overlap, adjacent GCALL arguments, native current matrix and fresh-process continuation; only normal CRT/OS services provided',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native geometry passed ${calls} complete wrappers / ${comparisons} comparisons`);
} finally {
  await engine.close();
  await original.close();
}
