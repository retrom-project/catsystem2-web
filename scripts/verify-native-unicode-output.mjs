// SPDX-License-Identifier: MPL-2.0
// Complete original game40F/410 handlers versus the browser adapter. The raw
// side retains the original IAT calls; only their explicit OS services differ.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from '../tests/helpers.mjs';
import {
  AuthoredClipboard,
  UNICODE_OUTPUT_PROFILE as profile,
  unicodeOutputFixture,
} from '../tests/fixtures/unicode-output-fixture.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-unicode-output.mjs FIXED_GAME_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== NATIVE_ENGINE_IMAGES[profile].sha256)
  throw new Error('Unicode-output oracle requires the frozen game engine');
const original = await NativeEngineProcess.open({ profile, bytes }),
  model = await unicodeOutputFixture(bytes),
  p = original.process,
  originalClipboard = new AuthoredClipboard(),
  originalLogs = [],
  globalAllocations = new Map(),
  a = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024)),
  b = model.machine,
  gates = [0xb8f188, 0xb8f194, 0xb8f18c],
  prior = [0x12345678, 0, 0x34567890],
  host = (dll, name, count, fn) => original.registerWindows(dll, name, { count, fn }),
  encoder = new TextEncoder(),
  source = (text) => encoder.encode(text),
  cases = [
    '',
    'plain',
    '日本語 中文',
    '\\n',
    '\\\\n',
    '\\n\\nlast',
    '\r\n',
    '%',
    '%%',
    '%%%',
    '%%%%',
    '100%% finished',
    '%s[G1024]',
    '%s[L1024]',
    '%s[H64]',
    '%.2s[G1024]',
    '%08x[G512]',
    '%f[G512]',
    'a'.repeat(400),
    '\ufeffBOM',
    '😀astral',
    'a😀b',
    'a'.repeat(100) + '猫'.repeat(100),
  ].map(source);
for (const prefix of [
  0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe7, 0xef, 0xf0, 0xf4, 0xf5, 0xf8, 0xfc,
  0xff,
])
  cases.push(Uint8Array.of(65, prefix, 0x80, 0x80, 0x80, 66));
cases.push(Uint8Array.of(65, 0xff, 0xff, 66), Uint8Array.of(0xff, 0xff));
let allocationFailure = false,
  comparisons = 0,
  calls = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
host('USER32.dll', 'OpenClipboard', 1, ([owner]) => Number(originalClipboard.open(owner)));
host('USER32.dll', 'EmptyClipboard', 0, () => Number(originalClipboard.empty()));
host('USER32.dll', 'CloseClipboard', 0, () => Number(originalClipboard.close()));
host('KERNEL32.dll', 'GlobalAlloc', 2, ([flags, size]) => {
  assert.equal(flags, 0x42);
  if (allocationFailure) return 0;
  const pointer = p.allocate(size, true);
  globalAllocations.set(pointer, size);
  return pointer;
});
host('KERNEL32.dll', 'GlobalLock', 1, ([handle]) => (globalAllocations.has(handle) ? handle : 0));
host('KERNEL32.dll', 'GlobalUnlock', 1, () => 0);
host('USER32.dll', 'SetClipboardData', 2, ([format, handle]) => {
  assert.equal(format, 13);
  assert.ok(globalAllocations.has(handle));
  const success = originalClipboard.write(p.string(handle, true));
  if (success) {
    p.free(handle);
    globalAllocations.delete(handle);
  }
  return success ? handle : 0;
});
host('USER32.dll', 'SendMessageW', 4, ([window, message, w, text]) => {
  assert.deepEqual([window, message, w], [1, 0x401, 0]);
  originalLogs.push(p.stringBytes(text).slice());
  return 0;
});
const allocate = model.engine.process.allocate.bind(model.engine.process);
model.engine.process.allocate = (size, zero) => {
  if (
    allocationFailure &&
    model.engine.process.asyncEnabled &&
    model.engine.process.lastTrap === 'native Unicode output allocate'
  )
    throw new Error('Authored GlobalAlloc failure');
  return allocate(size, zero);
};
const raw = async (id) => {
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(4),
    out = p.allocate(4),
    caller = p.allocate(124, true);
  p.store(argv, 256);
  p.store(out, 0xcccccccc);
  p.store(caller + 120, 0x12345678);
  if (id === 0x410) gates.forEach((at) => p.store(at, 1));
  try {
    const control = await original.call(id === 0x410 ? 0x650ad0 : 0x64fc70, [
      bridge.pointer,
      caller,
      argv,
      out,
    ]);
    check(p.load(out), 0xcccccccc, 'void wrapper leaves result word untouched');
    return { control };
  } finally {
    gates.forEach((at, i) => p.store(at, prior[i]));
    bridge.close();
    p.free(caller);
    p.free(out);
    p.free(argv);
  }
};
try {
  a.fp = b.fp = 4096;
  gates.forEach((at, i) => {
    p.store(at, prior[i]);
    model.engine.process.store(at, prior[i]);
  });
  for (const [caseIndex, bytes] of cases.entries())
    for (const mode of [
      'log',
      'clipboard',
      'unavailable',
      'empty-failed',
      'write-failed',
      'allocation-failed',
    ]) {
      const id = mode === 'log' ? 0x410 : 0x40f;
      allocationFailure = mode === 'allocation-failed';
      for (const clipboard of [originalClipboard, model.clipboard]) {
        clipboard.available = mode !== 'unavailable';
        clipboard.acceptEmpty = mode !== 'empty-failed';
        clipboard.acceptWrite = mode !== 'write-failed';
      }
      for (const m of [a, b]) {
        m.memory.fill(0xa5);
        m.shared.fill(0xa5);
        m.bytes(256, bytes.length + 1).set([...bytes, 0]);
        const literal = source(caseIndex % 2 ? 'nested 日本語 100%%' : '%%% tail');
        for (const at of [1024, 5120, 0x80000040])
          m.bytes(at, literal.length + 1).set([...literal, 0]);
        m.store(512, 0x3fa00000);
      }
      const expected = await raw(id),
        actual = await model.feature.invoke(id, [256], b, { id: 9 });
      calls++;
      check(actual, expected, 'original wrapper control/no-result');
      check(model.logs, originalLogs, 'original formatter/UTF8 walker/CRT/CP932 log bytes');
      check(
        model.clipboard.events,
        originalClipboard.events,
        'complete clipboard call order/owner/text',
      );
      check(model.clipboard.contents, originalClipboard.contents, 'external clipboard contents');
      check(model.clipboard.opened, originalClipboard.opened, 'clipboard close/refusal');
      check(b.memory, a.memory, 'all VM data/stack canaries');
      check(b.shared, a.shared, 'all VM shared canaries');
      check(
        model.engine.process.read(0xb8fb50, 2048),
        p.read(0xb8fb50, 2048),
        'complete original formatter scratch/newline mutation',
      );
      check(
        gates.map((at) => model.engine.process.load(at)),
        prior,
        'original console globals restored',
      );
      check(
        [...model.feature.globalAllocations].map(([address, size]) => ({
          size,
          bytes: model.engine.process.read(address, size),
        })),
        [...globalAllocations].map(([address, size]) => ({ size, bytes: p.read(address, size) })),
        'failed SetClipboardData retains original global allocation and initialized padding',
      );
    }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        inputCases: cases.length,
        modes: [
          'log',
          'clipboard',
          'unavailable',
          'empty-failed',
          'write-failed',
          'allocation-failed',
        ],
        scope:
          'Complete original main40F/410 wrappers, original formatter and UTF8/UTF16/CP932 helpers, original CRT wide logging, newline/percent mutation, exact OS call sequencing, failures/global ownership, complete VM/scratch memory and original console gate restoration. Raw side retains IAT calls; model only patches private OS callsites. Clipboard/diagnostic window/global memory are explicit host platform boundaries. Nonterminated >=500-code-unit CRT logger outputs and native rangecheck-abort inputs are not compared as defined text.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original Unicode output differential ${comparisons}/${comparisons}; ${calls} complete handler calls`,
  );
} finally {
  for (const pointer of globalAllocations.keys()) p.free(pointer);
  await original.close();
  await model.engine.close();
}
