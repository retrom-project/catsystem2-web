// SPDX-License-Identifier: MPL-2.0
// Original queue wrappers versus typed handles and the VM/process adapter.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeRecordQueues } from '../oracle/record-queue.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { KCSMachine } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
const [filename, output] = process.argv.slice(2),
  profile = 'nekopara-vol3-engine-2.6.1.76';
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-record-queue.mjs FIXED_GAME_EXE IGNORED_REPORT',
  );
const engine = await NativeEngineProcess.open({
    profile,
    bytes: new Uint8Array(await readFile(filename)),
  }),
  p = engine.process,
  handles = new NativeHandles(),
  world = { profile, runtime: { handles }, objects: { machine: () => null } },
  queues = new NativeRecordQueues(engine, world),
  make = () => {
    const m = new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(4096),
        stackSize: 1024,
      },
      undefined,
      new Uint8Array(4096),
    );
    m.allocate(4096);
    return m;
  },
  source = make(),
  model = make(),
  argv = p.allocate(8),
  out = p.allocate(4),
  table = NATIVE_EXE_PROFILES[profile].tables.main.va,
  state = (m) => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())],
  task = { id: 19 };
let passed = 0,
  operations = 0,
  reference = 0,
  handle = 0;
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
function queue(pointer) {
  if (!pointer) return null;
  const size = p.load(pointer),
    capacity = p.load(pointer + 12),
    offset = p.load(pointer + 16),
    count = p.load(pointer + 20),
    map = p.load(pointer + 8),
    records = [];
  for (let i = 0; i < count; i++) {
    const index = offset + i,
      chunk = p.load(map + 4 * ((index >>> 2) & (capacity - 1))),
      record = p.load(chunk + 4 * (index & 3));
    assert.equal(p.allocations.get(record), size);
    records.push(p.read(record, size));
  }
  return { size, capacity, offset, count, records };
}
async function run(id, tail = []) {
  const input = id === 0x3f2 ? tail : [reference, ...tail],
    actual = id === 0x3f2 ? tail : [handle, ...tail],
    bridge = new NativeKCSMemory(p, source);
  let expected;
  try {
    input.forEach((value, i) => p.store(argv + i * 4, value));
    p.store(out, 0xcccccccc);
    const control = await engine.call(p.load(table + id * 4), [bridge.pointer, 0, argv, out]);
    expected = { control, ...(control === 1 ? { value: p.load(out) } : {}) };
  } finally {
    bridge.close();
  }
  const result = await queues.apply(id, actual, model, task);
  if (id === 0x3f2) {
    reference = expected.value;
    handle = result.value;
    compare(result.control, expected.control, 'constructor control');
  } else compare(result, expected, `complete main${id.toString(16)} wrapper reply`);
  if (id === 0x3f3) {
    reference = 0;
    handle = 0;
  }
  compare(
    state(model),
    state(source),
    'complete VM data/stack/shared/extension blocks and canaries',
  );
  compare(
    queue(handle ? queues.pointer(handle) : 0),
    queue(reference),
    'deque capacity/offset/count and every active record byte',
  );
  operations++;
}
try {
  for (const size of [0, 1, 3, 4, 31, 128]) {
    for (const m of [source, model]) {
      m.memory.fill(0xa5);
      m.shared.fill(0xa5);
      m.blocks[0].fill(0xa5);
    }
    await run(0x3f2, [size]);
    await run(0x400);
    await run(0x3f5, [256]);
    for (let i = 0; i < 110; i++) {
      const address = [0, 0x80000000, source.memory.length][i % 3],
        data = Uint8Array.from({ length: size }, (_, j) => (i * 17 + j * 23) & 255);
      for (const m of [source, model]) m.bytes(address, size).set(data);
      await run(0x3f4, [address]);
      if (i % 5 === 0) await run(0x3f5, [512]);
      if (i % 9 === 0) {
        await run(0x3f4, [0xffffffff]);
        await run(0x3f5, [0xffffffff]);
        await run(0x400);
      }
    }
    for (let i = 0; i < 100; i++)
      await run(0x3f5, [[256, 0x80000200, source.memory.length + 512][i % 3]]);
    await run(0x400);
    await run(0x3f3);
    await run(0x3f4, [0]);
    await run(0x3f5, [0]);
    await run(0x400);
    await run(0x3f3);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: engine.identity,
        operations,
        passed,
        scope:
          'Complete original game3F2/3F3/3F4/3F5/400 wrappers and deque helpers. Typed-handle/VM adapter compared against direct raw calls across all VM byte domains and full canaries, zero/odd/large records, deque block/table growth, wraparound, interleaved push/pop, invalid VM pointers, null handles, empty pop, always-one status and destruction. Byte arithmetic remains original native code; these are adapter/lifecycle comparisons, not an independent deque implementation claim.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original record queue adapter differential ${passed}/${passed} (${operations} wrapper operations)`,
  );
} finally {
  await engine.close();
}
