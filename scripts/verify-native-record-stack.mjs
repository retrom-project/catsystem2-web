// SPDX-License-Identifier: MPL-2.0
// Full fixed-record stack wrappers execute against the original heap/copy
// helpers. VM pointer conversion is the only domain service boundary.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_RECORD_STACK_HANDLERS } from '../src/native/record-stack.mjs';
import {
  recordStackSpecifications,
  recordStackOperations,
  recordStackFixture,
  stepRecordStackModel,
} from '../tests/fixtures/record-stack-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!filename || !output)
  throw new Error('Usage: node scripts/verify-native-record-stack.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Record-stack oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({
    profile,
    bytes,
    standardLibraries: false,
    trace: true,
  }),
  p = engine.process,
  handlers = NATIVE_RECORD_STACK_HANDLERS[profile],
  parameters = p.allocate(8, true),
  outputWord = p.allocate(4, true),
  memory = p.allocate(256, true),
  results = [],
  golden = [];
engine.patch(
  profile.startsWith('sdk-') ? 0x8a6910 : 0x8772a0,
  'record-stack VM pointer boundary',
  1,
  ([address]) => (address < 256 ? memory + address : 0),
  { calleePops: true },
);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
for (const specification of recordStackSpecifications) {
  const fixture = recordStackFixture(),
    pointers = new Map();
  for (const operation of recordStackOperations(specification)) {
    const model = stepRecordStackModel(fixture, operation);
    if (model.setup) {
      p.store(pointers.get(model.handle) + 4, model.count);
      continue;
    }
    const args = model.args.map((value, index) =>
      model.id !== 0x35f && (index === 0 || model.id === 0x364)
        ? value
          ? pointers.get(value)
          : 0
        : value,
    );
    args.forEach((value, i) => p.store(parameters + i * 4, value));
    p.write(memory, model.inputMemory);
    const releasedData =
      model.id === 0x360 && model.args[0] ? p.load(pointers.get(model.args[0]) + 16) : 0;
    p.store(outputWord, 0xa5a55a5a);
    const control = await engine.call(handlers[model.id - 0x35f], [0, 0, parameters, outputWord]);
    if (model.id === 0x35f) pointers.set(model.reply.value, p.load(outputWord));
    if (model.id === 0x360 && model.args[0]) {
      const pointer = pointers.get(model.args[0]);
      if (p.allocations.has(pointer))
        throw new Error('Original record stack did not release its descriptor');
      if (releasedData && p.allocations.has(releasedData - 4))
        throw new Error('Original record stack did not release its heap storage');
      pointers.delete(model.args[0]);
    }
    for (const prime of model.primes) {
      const pointer = pointers.get(prime.handle),
        data = p.load(pointer + 16);
      p.write(data + prime.at, Uint8Array.of(prime.value));
    }
    const actual = {
        reply: {
          control,
          ...([1, 3].includes(control)
            ? { value: model.id === 0x35f ? model.reply.value : p.load(outputWord) }
            : {}),
        },
        state: {
          memory: [...p.read(memory, 256)],
          stacks: [...pointers].map(([handle, pointer]) => {
            const [recordSize, count, increment, capacity, data] = Array.from(
              { length: 5 },
              (_, i) => p.load(pointer + i * 4),
            );
            if (p.load(data - 4) !== 1)
              throw new Error('Record-stack data lost its hidden heap reference');
            return [
              handle,
              {
                recordSize,
                count,
                increment,
                capacity,
                data: [...p.read(data, Math.imul(recordSize, capacity) >>> 0)],
              },
            ];
          }),
        },
      },
      expected = { reply: model.reply, state: model.state },
      equal = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ specification, operation, actual, expected, equal });
    golden.push({ specification, operation, hash: hash(actual) });
    if (!equal) console.error(JSON.stringify(results.at(-1)));
  }
}
const report = {
  profile,
  sha256,
  boundaries: ['VM pointer translation', 'CRT/Windows heap'],
  preparation:
    'Only unspecified newly allocated tail bytes are primed as authored inputs; all subsequent capacity bytes are compared.',
  total: results.length,
  passed: results.filter((row) => row.equal).length,
  results,
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--golden'))
  await fs.writeFile(
    new URL('../tests/fixtures/record-stack-golden.json', import.meta.url),
    JSON.stringify({ profile, sha256, cases: golden }, null, 2) + '\n',
  );
console.log(JSON.stringify({ profile, total: report.total, passed: report.passed }));
await engine.close();
if (report.passed !== report.total) process.exitCode = 1;
