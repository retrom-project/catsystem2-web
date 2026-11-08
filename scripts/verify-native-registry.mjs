// SPDX-License-Identifier: MPL-2.0
// Execute every registry wrapper, its formatter and (game) wide conversion.
// ADVAPI32 is an explicit platform boundary, separately checked against Wine.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_REGISTRY_CONTRACTS, NativeRegistry } from '../src/native/registry.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { configurationQueryMachine } from '../tests/fixtures/configuration-query-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-registry.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Registry oracle requires a frozen engine');
const raw = await NativeEngineProcess.open({ bytes, profile }),
  engine = await NativeEngineProcess.open({ bytes, profile }),
  reference = await NativeRegistry.open(raw),
  model = await NativeRegistry.open(engine),
  a = configurationQueryMachine(),
  b = configurationQueryMachine(),
  block = a.allocate(1024),
  otherBlock = b.allocate(1024),
  index = Number(profile.startsWith('sdk-')),
  specs = new Map(NATIVE_REGISTRY_CONTRACTS.map((spec) => [spec.id, spec])),
  covered = new Map();
let calls = 0,
  comparisons = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
check(block, otherBlock, 'same extended VM block');
for (const spec of NATIVE_REGISTRY_CONTRACTS)
  check(
    raw.process.load(NATIVE_PROFILES[profile].tables.main.va + spec.id * 4),
    spec.handlers[index],
    'actual frozen table slot',
  );
const text = (address, value) => {
  const bytes = value instanceof Uint8Array ? value : encodeCP932(value);
  for (const machine of [a, b]) machine.bytes(address, bytes.length + 1).set([...bytes, 0]);
  return address;
};
async function run(id, args) {
  const spec = specs.get(id),
    words = Array.from(args);
  while (words.length < spec.words) words.push(a.nativeArgument(words.length));
  const p = raw.process,
    bridge = new NativeKCSMemory(p, a),
    params = p.allocate(words.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    words.forEach((word, i) => p.store(params + i * 4, word));
    p.store(out, 0xcccccccc);
    control = await raw.call(spec.handlers[index], [bridge.pointer, 0, params, out]);
    value = p.load(out);
  } finally {
    bridge.close();
    p.free(out);
    p.free(params);
  }
  const reply = await model.apply(id, args, b, { id: 1 });
  check(reply, { control, value }, 'complete native control/result');
  check(b.memory, a.memory, 'whole VM data/stack');
  check(b.shared, a.shared, 'whole shared memory');
  check(b.blocks, a.blocks, 'whole extended blocks');
  check(model.snapshot(), reference.snapshot(), 'complete hive and open handles');
  check(
    engine.kernel.calls.get('advapi32.dll!RegCloseKey'),
    raw.kernel.calls.get('advapi32.dll!RegCloseKey'),
    'native key closure',
  );
  calls++;
  covered.set(id, (covered.get(id) ?? 0) + 1);
  return value;
}
try {
  for (const base of [512, 4608, 0x80000040, block + 32]) {
    for (const key of [
      'RetromOracle\\Nested',
      'retromoracle\\nested',
      '',
      'With/Slash',
      '..',
      '日本語',
      new TextEncoder().encode('日本語'),
      Uint8Array.of(0x82, 0xff, 0x41),
      '\\bad',
    ]) {
      const keyAddress = text(base, key);
      for (const name of ['Value', 'VALUE', '', 'a\\b', '日本語', Uint8Array.of(0x94)]) {
        const nameAddress = text(base + 96, name);
        await run(0xc0, [keyAddress, nameAddress]);
        for (const value of [0, 1, 0xffffffff, 0x80000000, 0x12345678]) {
          await run(0xc2, [keyAddress, nameAddress, value]);
          await run(0xc0, [keyAddress, nameAddress]);
          for (const capacity of [0, 1, 3, 4, 8, 0xffffffff]) {
            for (const machine of [a, b]) machine.bytes(base + 256, 80).fill(0xa5);
            await run(0xc1, [keyAddress, nameAddress, base + 256, capacity]);
          }
        }
      }
    }
    const keyAddress = text(base, 'RetromOracle\\RawStrings'),
      nameAddress = text(base + 96, 'String');
    for (const value of [
      '',
      'A',
      'AB',
      'ABC',
      '日本語',
      'not %G[0] formatted',
      Uint8Array.of(0x82),
      Uint8Array.of(0x82, 0x20, 0x7f),
      new TextEncoder().encode('猫犬'),
      Uint8Array.of(65, 0, 66),
    ]) {
      const dataAddress = text(base + 192, value);
      for (const machine of [a, b]) machine.bytes(base + 240, 8).fill(0x5a);
      await run(0xc3, [keyAddress, nameAddress, dataAddress]);
      await run(0xc0, [keyAddress, nameAddress]);
      for (const capacity of [0, 1, 2, 3, 4, 7, 8, 16, 64, 0xffffffff]) {
        for (const machine of [a, b]) machine.bytes(base + 256, 80).fill(0xa5);
        await run(0xc1, [keyAddress, nameAddress, base + 256, capacity]);
      }
      await run(0xc1, [keyAddress, nameAddress, 0x7f000000, 0]);
    }
    for (const which of [0, 1]) {
      const key = text(base, 'RetromOracle\\Alias'),
        name = text(base + 96, 'String'),
        source = text(base + 192, 'ABCD');
      await run(0xc3, [key, name, source]);
      await run(0xc1, [key, name, which ? name : key, 64]);
    }
  }
  // Real formatter strings and consumed GCALL words remain byte-oriented.
  text(512, 'RetromOracle\\%d[G0]');
  text(608, 'name_%d[G4]');
  for (const machine of [a, b]) {
    machine.store(0, 17);
    machine.store(4, 9);
  }
  await run(0xc2, [512, 608, 0xdeadbeef]);
  text(512, 'retromoracle\\17');
  text(608, 'NAME_9');
  check(await run(0xc0, [512, 608]), 1, 'DWORD query returns success, not the stored DWORD');
  for (const spec of NATIVE_REGISTRY_CONTRACTS) {
    text(512, 'RetromOracle\\Adjacent');
    text(608, 'adjacent');
    text(704, 'ABCDE');
    const words =
      spec.id === 0xc2
        ? [512, 608, 0x87654321]
        : spec.id === 0xc3
          ? [512, 608, 704]
          : spec.id === 0xc1
            ? [512, 608, 800, 64]
            : [512, 608];
    for (const machine of [a, b]) {
      machine.nativeArgumentBase = 2048;
      words.forEach((word, i) => machine.store(2048 + i * 4, word));
    }
    await run(spec.id, []);
  }
  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    cases: [...covered],
    platformBoundary: 'ADVAPI32 registry; separately compared with pinned Wine ACP932',
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Registry passed ${calls} complete wrappers/${comparisons} comparisons`);
} finally {
  await engine.close();
  await raw.close();
}
