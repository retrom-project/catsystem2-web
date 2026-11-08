// SPDX-License-Identifier: MPL-2.0
// Executes original variable-bank construction, context maps, named/private
// accessors, expressions and main 292/293 wrappers in the frozen image.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeVariableBank, nativeBank } from '../src/native/bank.mjs';
import { evaluateNativeExpression } from '../src/native/expression.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, output] = process.argv.slice(2);
if (!filename || !output)
  throw new Error('Usage: node scripts/verify-native-bank-context.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Bank-context oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk-'),
  f = sdk
    ? {
        construct: 0x5d8bc0,
        destroy: 0x5d8ce0,
        register: 0x5d8e30,
        select: 0x5d8f60,
        unregister: 0x5d8fd0,
        set: 0x5d9400,
        get: 0x5d9420,
        nameSet: 0x5d92d0,
        nameGet: 0x5db820,
        nameDelete: 0x5d9390,
        expression: 0x5d9230,
        main: 0xb3c900,
        diagnostic: 0x4a82f0,
      }
    : {
        construct: 0x728710,
        destroy: 0x728830,
        register: 0x728980,
        select: 0x728ab0,
        unregister: 0x728b20,
        set: 0x728f50,
        get: 0x728f70,
        nameSet: 0x728e20,
        nameGet: 0x72b170,
        nameDelete: 0x728ee0,
        expression: 0x728d80,
        main: 0xa2dd38,
        diagnostic: 0x5cac90,
      },
  engine = await NativeEngineProcess.open({
    profile,
    bytes,
    standardLibraries: false,
    trace: true,
  }),
  p = engine.process,
  pointer = p.allocate(40, true),
  caller = p.allocate(112, true),
  argsPointer = p.allocate(8, true),
  resultPointer = p.allocate(4, true),
  stringPointer = p.allocate(256, true),
  model = new NativeVariableBank(),
  results = [];
engine.patch(f.diagnostic, 'variable bank diagnostic boundary', 0, () => 0);
await engine.call(f.construct, [32], pointer);
model.initialize(32);
p.store(caller + 104, pointer);
const text = (value) => {
  p.write(stringPointer, encodeCP932(`${value}\0`));
  return stringPointer;
};
function entries(container) {
  if (!container) return [];
  const head = p.load(container),
    output = [];
  function visit(node) {
    if (p.read(node + 13, 1)[0]) return;
    visit(p.load(node));
    output.push(node);
    visit(p.load(node + 8));
  }
  visit(p.load(head + 4));
  return output;
}
const sorted = (values) => values.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
function nativeState() {
  const contexts = entries(p.load(pointer + 28)).map((node) => {
    const key = p.load(node + 16),
      names = p.load(node + 20),
      words = p.load(node + 24);
    return [
      key,
      {
        words: Array.from({ length: 512 }, (_, i) => p.load(words + i * 4)),
        names: sorted(
          entries(names).map((entry) => [
            [...p.stringBytes(entry + 16)]
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join('') +
              ':' +
              p.load(entry + 48),
            p.load(entry + 52),
          ]),
        ),
        selected: p.load(pointer + 32) === names && p.load(pointer + 36) === words,
      },
    ];
  });
  const active = contexts.find(([, value]) => value.selected)?.[0] ?? null;
  for (const [, value] of contexts) delete value.selected;
  return {
    words: Array.from({ length: 32 }, (_, i) => p.load(p.load(pointer) + i * 4)),
    dirty: Boolean(p.load(pointer + 24)),
    contexts: sorted(contexts),
    selectedContext: active,
  };
}
function modelState() {
  return {
    words: [...model.words],
    dirty: model.dirty,
    contexts: sorted(
      [...model.contexts].map(([key, value]) => [
        key,
        { words: [...value.words], names: sorted([...value.names]) },
      ]),
    ),
    selectedContext: model.selectedContext,
  };
}
const operations = [
  ['select', 1],
  ['unregister', 1],
  ['register', 1],
  ['set', 0, 41],
  ['nameSet', 'alpha', 0, 7],
  ['expression', '$0 = $$0 + alpha'],
  ['expression', '$$0 = $$0 + alpha'],
  ['expression', '\\511 = 100'],
  ['expression', 'alpha + \\0 + \\511'],
  ['register', 2],
  ['set', 0, 83],
  ['nameSet', 'alpha', 2, 19],
  ['expression', 'alpha[2] + $$0'],
  ['nameGet', 'alpha', 0],
  ['register', 1],
  ['get', 0],
  ['select', 1],
  ['get', 0],
  ['select', 999],
  ['get', 0],
  ['unregister', 2],
  ['get', 0],
  ['register', 2],
  ['get', 0],
  ['unregister', 2],
  ['get', 0],
];
let seed = 0x71ca4b28;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
const keys = [0, 1, 2, 7, 0x80000000, 0xffffffff],
  names = ['alpha', 'ALPHA', '日本語', '_EXITCODE_', 'x'];
for (let i = 0; i < 400; i++) {
  const op = random() % 11,
    key = keys[random() % keys.length],
    index = [0, 1, 2, 511, 512, 0xffffffff][random() % 6],
    value = random(),
    name = names[random() % names.length];
  operations.push(
    op < 3
      ? [
          ['register', key],
          ['select', key],
          ['unregister', key],
        ][op]
      : op === 3
        ? ['set', index, value]
        : op === 4
          ? ['get', index]
          : op === 5
            ? ['nameSet', name, index, value]
            : op === 6
              ? ['nameGet', name, index]
              : op === 7
                ? ['nameDelete', name, index]
                : op === 8
                  ? ['mainSet', index, value]
                  : op === 9
                    ? ['mainGet', index]
                    : ['expression', '$0 += 1'],
  );
}
for (const operation of operations) {
  const [method, ...args] = operation;
  let actual = null,
    expected = null;
  if (['register', 'select', 'unregister'].includes(method)) {
    actual = await engine.call(f[method], args, pointer);
    expected = Number(
      model[
        method === 'register'
          ? 'registerContext'
          : method === 'select'
            ? 'selectContext'
            : 'unregisterContext'
      ](...args),
    );
  } else if (method === 'get') {
    actual = await engine.call(f.get, args, pointer);
    expected = model.getPrivate(...args);
  } else if (method === 'set') {
    await engine.call(f.set, args, pointer);
    model.setPrivate(...args);
  } else if (method.startsWith('name')) {
    const input = [text(args[0]), ...args.slice(1)];
    if (method === 'nameSet') {
      await engine.call(f.nameSet, input, pointer);
      model.setName(...args);
    } else if (method === 'nameDelete') {
      await engine.call(f.nameDelete, input, pointer);
      model.deleteName(...args);
    } else {
      actual = await engine.call(f.nameGet, input, pointer);
      expected = model.getName(...args);
    }
  } else if (method === 'expression') {
    actual = await engine.call(f.expression, [text(args[0])], pointer);
    expected = evaluateNativeExpression(args[0], model) >>> 0;
  } else {
    args.forEach((value, i) => p.store(argsPointer + i * 4, value));
    p.store(resultPointer, 0xa5a55a5a);
    const id = method === 'mainGet' ? 0x292 : 0x293,
      control = await engine.call(p.load(f.main + id * 4), [0, caller, argsPointer, resultPointer]);
    actual = { control, ...(control === 1 ? { value: p.load(resultPointer) } : {}) };
    expected = nativeBank(id, args, {}, { variables: model });
  }
  const a = { result: actual, ...nativeState() },
    b = { result: expected, ...modelState() },
    equal = JSON.stringify(a) === JSON.stringify(b);
  results.push({ operation, actual: a, expected: b, equal });
  if (!equal)
    console.error(
      JSON.stringify({
        operation,
        actual,
        expected,
        stateEqual: JSON.stringify(a.contexts) === JSON.stringify(b.contexts),
        selected: [a.selectedContext, b.selectedContext],
      }),
    );
}
await engine.call(f.destroy, [], pointer);
const report = {
  profile,
  sha256,
  functions: f,
  boundaries: ['CRT/Windows heap and diagnostic output'],
  total: results.length,
  passed: results.filter((row) => row.equal).length,
  results,
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ profile, total: report.total, passed: report.passed }));
await engine.close();
if (report.passed !== report.total) process.exitCode = 1;
