// SPDX-License-Identifier: MPL-2.0
// Compare the original main wrappers with the shared-process matrix adapter.
// Matrix arithmetic and D3DX CPU selection run in the supplied original PE.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeMatrices } from '../oracle/matrix.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { KCSMachine, floatBits } from '../src/kcs/vm.mjs';
import { Binary } from '../src/binary.mjs';

const [exe, output] = process.argv.slice(2);
if (!exe || !output)
  throw new Error('Usage: node scripts/verify-native-matrices.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(exe)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_EXE_PROFILES).find(([, p]) => p.sha256 === sha256);
if (!profile) throw new Error('Native matrix oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({
    bytes,
    profile: profile[0],
    configuration: new NativeConfiguration({ profile: profile[0] }),
  }),
  p = engine.process,
  matrices = new NativeMatrices(engine),
  table = profile[1].tables.main.va,
  vm = p.allocate(1400, true),
  memory = p.allocate(1024, true),
  args = p.allocate(16, true),
  result = p.allocate(4, true),
  machine = new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(1024),
    stackSize: 64,
  });
p.store(vm + 20, memory);
p.store(vm + 36, 1024);
let seed = 0x47aca771,
  passed = 0;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
  compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  };
try {
  for (let n = 0; n < 120; n++) {
    const address = [0, 4, 64, 256][n % 4],
      initial = new Uint8Array(1024),
      view = new DataView(initial.buffer);
    for (let i = 0; i < 16; i++)
      view.setFloat32(address + i * 4, ((next() % 10000) - 5000) / 317, true);
    for (let id = 0xcc; id <= 0xcf; id++) {
      const values = [
          address,
          ...Array.from({ length: 3 }, () => floatBits(((next() % 100000) - 50000) / 2317)),
        ],
        input = id === 0xcf ? values.slice(0, 1) : values;
      p.write(memory, initial);
      machine.memory.set(initial);
      input.forEach((value, i) => p.store(args + i * 4, value));
      const control = await engine.call(p.load(table + id * 4), [vm, 0, args, result]),
        reply = await matrices.apply(id, input, machine);
      compare(reply.control, control, `control/${n}/${id}`);
      compare(machine.memory.subarray(0, 1024), p.read(memory, 1024), `matrix/${n}/${id}`);
    }
  }
  const globalPointer = await engine.call(matrices.operations.identity, [0]);
  await matrices.apply(
    0xcc,
    [0xffffffff, floatBits(0.1), floatBits(0.7), floatBits(-1.3)],
    machine,
  );
  const saved = engine.snapshot(),
    restored = await NativeEngineProcess.open({
      bytes,
      profile: profile[0],
      configuration: new NativeConfiguration({ profile: profile[0] }),
    });
  try {
    const after = new NativeMatrices(restored);
    restored.restore(saved);
    compare(
      restored.process.read(globalPointer, 64),
      p.read(globalPointer, 64),
      'fresh-process current matrix restore',
    );
    const input = [0xffffffff, floatBits(0.2), floatBits(-1.4), floatBits(3)];
    await matrices.apply(0xcd, input, machine);
    await after.apply(0xcd, input, machine);
    compare(
      restored.process.read(globalPointer, 64),
      p.read(globalPointer, 64),
      'fresh-process matrix continuation',
    );
  } finally {
    await restored.close();
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile: profile[0],
        sha256,
        passed,
        scope:
          'Original mainCC..CF wrappers versus shared-process native helpers; all arithmetic and D3DX dispatch original, reviewed Windows platform boundaries supplied',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native matrix adapter differential passed ${passed}/${passed}`);
} finally {
  await engine.close();
}
