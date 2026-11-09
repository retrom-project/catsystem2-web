// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { NativeVariableBank, nativeBank } from '../src/native/bank.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';

const [exe, output] = process.argv.slice(2);
if (!exe || !output)
  throw new Error(
    'Usage: node scripts/verify-native-variable-primitives.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(exe)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_PROFILES).find((key) => NATIVE_PROFILES[key].sha256 === sha256);
if (!profile) throw new Error('Variable primitive oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ profile, bytes, standardLibraries: false }),
  p = engine.process,
  table = NATIVE_PROFILES[profile].tables.main.va,
  handlers = [0xd1, 0xd2, 0xd3, 0xd4, 0xd5].map((id) => p.load(table + id * 4)),
  machine = new KCSMachine(
    { codeSize: 1, data: new Uint8Array(512), stackSize: 32 },
    null,
    new Uint8Array(128),
  ),
  argv = p.allocate(8, true),
  out = p.allocate(4, true),
  sentinel = 0x17ab9335;
const results = [];
let comparisons = 0;
engine.patch(sdk ? 0x4a82f0 : 0x5cac90, 'variable diagnostics', 0, () => 0);
try {
  const block = machine.allocate(96);
  for (const [address, text] of [
    [0, '2 + 5'],
    [32, '@ * 2%'],
    [0x80000000, '$0 + @'],
    [block, '3 % 2'],
    [block + 16, ''],
    [block + 32, '0 && 7'],
  ])
    machine.writeString(text, address);
  const vm = new NativeKCSMemory(p, machine);
  try {
    for (const capacity of [null, 0, 1, 5, 16, 31, 257]) {
      const model = new NativeVariableBank(),
        caller = p.allocate(168, true),
        services = { variables: model, allowVariableInitialization: capacity !== null };
      p.store(caller + 164, Number(capacity === null));
      const invoke = async (id, args) => {
        args.forEach((word, i) => p.store(argv + i * 4, word));
        p.store(out, sentinel);
        const before = p.load(caller + 104),
          control = await engine.call(handlers[id - 0xd1], [vm.pointer, caller, argv, out]),
          result = p.load(out),
          after = p.load(caller + 104);
        let expected;
        try {
          expected = nativeBank(id, args, machine, services);
        } catch (error) {
          expected = { error: error.message };
        }
        const actualState = after && [
            p.load(after + 4),
            p.load(after + 20),
            !!p.load(after + 24),
            Array.from({ length: p.load(after + 4) }, (_, i) => p.load(p.load(after) + i * 4)),
          ],
          expectedState = model.words && [
            model.capacity,
            model.contextValue,
            model.dirty,
            [...model.words],
          ],
          actual = [control, result, actualState || null, !before || before === after],
          wanted = [expected.control, expected.value ?? sentinel, expectedState, true],
          equal = JSON.stringify(actual) === JSON.stringify(wanted);
        comparisons += 4 + model.capacity;
        results.push({
          capacity,
          id,
          args,
          control,
          result,
          equal,
          ...(equal ? {} : { actual, wanted, expected }),
        });
      };
      // No bank exists before the constructor and the disabled branch never
      // creates one. A later constructor call cannot replace an existing bank.
      await invoke(0xd2, [0]);
      await invoke(0xd3, [0, 7]);
      await invoke(0xd4, [23]);
      await invoke(0xd5, [0]);
      await invoke(0xd1, [capacity ?? 9]);
      await invoke(0xd1, [13]);
      for (const index of [0, 1, 4, Math.max(0, (capacity ?? 0) - 1), capacity ?? 0, 0xffffffff]) {
        await invoke(0xd3, [index, (0xcafe1300 + index) >>> 0]);
        await invoke(0xd2, [index]);
      }
      for (const context of [0, 7, 0xffffffff]) {
        await invoke(0xd4, [context]);
        // D5's expression interpreter can dereference variable indices
        // without bounds checks. Only the VM source address is optional.
        for (const address of [
          0,
          32,
          ...(capacity > 0 ? [0x80000000] : []),
          block,
          block + 16,
          block + 32,
          0x7fffffff,
          0xffffffff,
        ])
          await invoke(0xd5, [address]);
      }
      const bank = p.load(caller + 104);
      if (bank) await engine.call(sdk ? 0x5d8ce0 : 0x728830, [], bank);
      p.free(caller);
    }
  } finally {
    vm.close();
  }
  const failures = results.filter((row) => !row.equal);
  await writeFile(
    output,
    JSON.stringify({ profile, sha256, handlers, comparisons, results }, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({ profile, calls: results.length, comparisons, failures: failures.length }),
  );
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 3)));
} finally {
  await engine.close();
}
