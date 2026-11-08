// SPDX-License-Identifier: MPL-2.0
// Actual 1B/1C/ED wrappers and their original allocator/list/translator helpers.
// The VM frame is an authored ABI fixture; heap operations are not substituted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { Binary } from '../src/binary.mjs';
import { nativeStandard } from '../src/native/standard.mjs';
import { NativeTaskMemory } from '../src/native/task-memory.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-vm-memory.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (p) => NATIVE_ENGINE_IMAGES[p].sha256 === sha256,
  );
if (!profile) throw new Error('VM-memory oracle requires a frozen engine');
const engine = await NativeEngineProcess.open({ profile, bytes, trace: true }),
  p = engine.process,
  main = profile.startsWith('sdk-') ? 0xb3c900 : 0xa2dd38,
  vm = p.allocate(1408, true),
  container = p.allocate(8, true),
  head = p.allocate(16, true),
  local = p.allocate(128, true),
  shared = p.allocate(64, true),
  argv = p.allocate(4, true),
  out = p.allocate(4, true),
  m = new KCSMachine(
    { body: new Binary(Uint8Array.of(59)), codeSize: 1, data: new Uint8Array(64), stackSize: 64 },
    {},
    new Uint8Array(64),
  ),
  results = [];
let comparisons = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
p.store(container, head);
p.store(head, head);
p.store(head + 4, head);
p.store(vm + 20, local);
p.store(vm + 36, 128);
p.store(vm + 40, shared);
p.store(vm + 44, 64);
p.store(vm + 48, container);
const nodes = () => {
  const result = [];
  for (let node = p.load(head); node !== head; node = p.load(node)) {
    if (result.length > 2000) throw new Error('Original allocation list does not terminate');
    result.push({ node, pointer: p.load(node + 8), size: p.load(node + 12) });
  }
  return result;
};
const state = () => {
  const rows = nodes();
  check(p.load(container + 4), m.blocks.length, 'list count');
  check(
    rows.map(({ pointer, size }) => ({ size, data: [...p.read(pointer, size)] })),
    m.blocks.map((block) => ({ size: block.length, data: [...block] })),
    'all allocation bytes',
  );
  for (const { pointer } of rows) check(p.load(pointer - 4), 1, 'hidden heap reference');
};
async function call(id, value) {
  p.store(argv, value);
  p.store(out, 0x34dadada);
  const before = m.blocks.length,
    control = await engine.call(p.load(main + id * 4), [vm, 0, argv, out]),
    reply = nativeStandard(id, [value], m);
  check(control, reply.control, 'control');
  check(
    p.load(out),
    id === 0xed ? Number(m.blocks.length < before) : reply.value,
    `result ${id.toString(16)} ${value.toString(16)}`,
  );
  state();
  results.push({
    id,
    value,
    control,
    result: p.load(out),
    sizes: m.blocks.map((block) => block.length),
  });
}
try {
  for (let round = 0; round < 12; round++) {
    for (const size of [0, 1, 3, 0, 8, 4, 0, 16]) await call(0x1b, size);
    for (const address of [0, 127, 128, 129, 130, 131, 132, 0x7fffffff, 0xffffffff])
      await call(round % 2 ? 0xed : 0x1c, address);
    const source = m.blocks.findIndex((block) => block.length > 1);
    if (source >= 0) {
      const raw = nodes()[source];
      m.shared = m.blocks[source];
      p.store(vm + 40, raw.pointer);
      p.store(vm + 44, raw.size);
      await call(0x1c, 0x80000001);
      await call(0xed, 0x80000000);
    }
    m.shared = new Uint8Array(64);
    p.store(vm + 40, shared);
    p.store(vm + 44, 64);
    const rows = nodes();
    for (let i = 0; i < rows.length; i++) {
      const data = Uint8Array.from(
        { length: rows[i].size },
        (_, n) => (round * 17 + i * 31 + n) & 255,
      );
      m.blocks[i].set(data);
      p.write(rows[i].pointer, data);
    }
    for (let i = m.blocks.length - 1; i >= 0; i--) {
      if (!m.blocks[i].length) continue;
      const base =
        m.memory.length + m.blocks.slice(0, i).reduce((sum, block) => sum + block.length, 0);
      await call(0x1c, base);
    }
  }
  const inverse = profile.startsWith('sdk-') ? 0x8a66f0 : 0x877080,
    authored = [p.allocate(16, true), p.allocate(16, true), p.allocate(16, true)];
  for (let trial = 0; trial < 24; trial++) {
    const mapping = {
      memory: { pointer: local, capacity: 16 + trial },
      shared: { pointer: trial % 3 ? local + 8 : shared, capacity: trial % 4 ? 24 : 0 },
      blocks: [
        { pointer: shared + 8, capacity: 8 },
        { pointer: local + 10, capacity: trial % 2 ? 3 : 0 },
        { pointer: shared + 24, capacity: trial % 3 ? 4 : 0 },
      ],
    };
    p.store(vm + 20, mapping.memory.pointer);
    p.store(vm + 36, mapping.memory.capacity);
    p.store(vm + 40, mapping.shared.pointer);
    p.store(vm + 44, mapping.shared.capacity);
    p.store(head, authored[0]);
    p.store(head + 4, authored.at(-1));
    for (let i = 0; i < authored.length; i++) {
      p.store(authored[i], authored[i + 1] ?? head);
      p.store(authored[i] + 4, authored[i - 1] ?? head);
      p.store(authored[i] + 8, mapping.blocks[i].pointer);
      p.store(authored[i] + 12, mapping.blocks[i].capacity);
    }
    for (const storage of [mapping.memory, mapping.shared, ...mapping.blocks])
      for (const offset of [-1, 0, 1, storage.capacity - 1, storage.capacity]) {
        const pointer = (storage.pointer + offset) >>> 0,
          expected = await engine.call(inverse, [pointer], vm),
          actual = NativeTaskMemory.prototype.virtualAddress(mapping, pointer);
        check(actual, expected, 'physical inverse precedence including empty ranges');
      }
  }
} finally {
  await engine.close();
}
await fs.writeFile(
  output,
  JSON.stringify(
    {
      profile,
      sha256,
      comparisons,
      operations: results.length,
      inverseCases: 600,
      boundaries: ['authored VM frame/list initialization', 'CRT/Windows heap'],
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Native VM memory passed ${comparisons} comparisons over ${results.length} operations`);
