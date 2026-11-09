// SPDX-License-Identifier: MPL-2.0
// Full original argument wrappers and expression evaluator; no parser stubs.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { nativeArguments } from '../src/native/arguments.mjs';
import { KCSMachine, encodeCP932 } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-arguments.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Argument decoder oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  bank = p.allocate(40, true),
  caller = p.allocate(184, true),
  argv = p.allocate(12),
  out = p.allocate(4),
  modelBank = new NativeVariableBank(),
  script = {
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(8192),
    stackSize: 4096,
  },
  machine = new KCSMachine(script, undefined, new Uint8Array(4096)),
  model = new KCSMachine(script, undefined, new Uint8Array(4096)),
  table = NATIVE_EXE_PROFILES[profile].tables.main.va,
  state = (m) => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
machine.fp = 8192;
machine.allocate(4096);
await engine.call(sdk ? 0x5d8bc0 : 0x728710, [64], bank);
p.store(caller + 104, bank);
modelBank.initialize(64);
for (let i = 0; i < 64; i++) {
  p.store(p.load(bank) + i * 4, i + 7);
  modelBank.words[i] = i + 7;
}
let passed = 0,
  operations = 0;
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
async function run(id, args, label) {
  model.restore(machine.snapshot());
  model.shared.set(machine.shared);
  const bridge = new NativeKCSMemory(p, machine);
  let expected;
  try {
    args.forEach((n, i) => p.store(argv + i * 4, n));
    p.store(out, 0xcccccccc);
    const control = await engine.call(p.load(table + id * 4), [bridge.pointer, caller, argv, out]);
    expected = { control, value: p.load(out) };
  } finally {
    bridge.close();
  }
  compare(
    nativeArguments(id, args, model, { variables: modelBank }),
    expected,
    `${id.toString(16)}/${label}/result`,
  );
  compare(state(model), state(machine), `${id.toString(16)}/${label}/all VM bytes and canaries`);
  compare(
    [...modelBank.words],
    Array.from({ length: 64 }, (_, i) => p.load(p.load(bank) + 4 * i)),
    `${label}/all bank words`,
  );
  compare(modelBank.dirty, Boolean(p.load(bank + 24)), `${label}/bank dirty`);
  operations++;
}
const reset = (text, at = 512) => {
  machine.memory.fill(0xa5);
  machine.shared.fill(0xa5);
  machine.blocks[0].fill(0xa5);
  machine.writeStringBytes(typeof text === 'string' ? encodeCP932(text) : text, at);
  p.store(bank + 24, 0);
  modelBank.dirty = false;
};
try {
  for (const text of [
    '',
    ' ',
    '   ',
    'alpha',
    'alpha beta',
    ' alpha  beta ',
    'a\tb c',
    'pl stop',
    '(:literal group) after',
    '猫 犬 動物',
    new TextEncoder().encode('中文 日文 string'),
    Uint8Array.of(0x81, 0xff, 32, 65),
  ])
    for (const at of [0, 512, 8192 + 512, 0x80000200, machine.memory.length + 512])
      for (const index of [0, 1, 2, 3, 4, 9, 0xffffffff]) {
        reset(text, at);
        await run(0x21c, [at, index], `token ${JSON.stringify(text)}/${at}/${index}`);
      }
  reset('literal');
  await run(0x21c, [0xffffffff, 0], 'index zero does not dereference failed translation');
  const expressions = [
    '',
    '0',
    '7',
    '-3',
    '1+2*3',
    '$2',
    '0 && $2++',
    '1 || $2++',
    '[$2++, $2+=3, $2]',
    '[1,2,3]',
    '[,1,,2,]',
    '[1-4]',
    '[4-1]',
    '[7]',
    '[]',
    '[-4--2]',
    '[0x7fffffff-0x7fffffff]',
    '[1+1-5]',
    '[1,2',
    '[1 2,3]',
    '[$2, $3, $4]',
    '[0, 0xffffffff, -3]',
    '[2-3]tail',
  ];
  for (const text of expressions)
    for (const at of [512, 0x80000200, machine.memory.length + 512])
      for (const destination of [2048, at, at + 1, at + 4, at - 4])
        for (const capacity of [0, 1, 3, 8, 0xffffffff]) {
          reset(text, at);
          await run(
            0x21b,
            [at, destination, capacity],
            `array ${JSON.stringify(text)}/${at}/${destination}/${capacity}`,
          );
        }
  for (const args of [
    [0xffffffff, 512, 4],
    [512, 0xffffffff, 4],
    [0xffffffff, 0xffffffff, 0],
  ]) {
    reset('[1,2]');
    await run(0x21b, args, 'unmapped translation');
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        operations,
        scope:
          'Complete original main21B/21C, original VM mapping and bank expression evaluator. Space-only start offsets, leading/trailing spaces, tabs/groups, CP932/UTF8/invalid bytes, index-zero failed mapping, list/range expressions, eager bank mutations, signed capacity, integer wrap, missing closing bracket, input/output aliases, all VM domains and complete canaries/variable-bank/dirty state. No parser/formatter/expression boundary is replaced.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original argument decoder differential ${passed}/${passed} (${operations} operations)`,
  );
} finally {
  await engine.close();
}
