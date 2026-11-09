// SPDX-License-Identifier: MPL-2.0
// Original D0, GCALL, formatter, script-version getter and Game Top receiver.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import {
  NATIVE_ENGINE_MESSAGE_LAYOUTS,
  NATIVE_UNWRITTEN_WORD,
} from '../src/native/engine-message.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeTaskDump, NATIVE_TASK_DUMP } from '../src/native/task-dump.mjs';
import { encodeCP932, KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-task-dump.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (key) => NATIVE_ENGINE_IMAGES[key].sha256 === sha256,
  );
if (!profile) throw new Error('Task dump oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  spec = sdk ? NATIVE_TASK_DUMP.sdk : NATIVE_TASK_DUMP.game,
  table = NATIVE_PROFILES[profile].tables.main.va,
  opcodes = sdk ? 0xc53d00 : 0xb49a00,
  raw = await NativeEngineProcess.open({ profile, bytes }),
  model = await NativeEngineProcess.open({ profile, bytes }),
  p = raw.process,
  vtable = p.allocate(20, true),
  host = p.allocate(8, true),
  argv = p.allocate(4),
  out = p.allocate(12),
  referenceHeader = p.allocate(52),
  root = sdk ? 0 : p.allocate(656),
  sender = 0xf0000003,
  task = { id: 7 },
  outgoing = 0x87654321,
  canary = new Uint8Array(12).fill(0xa5),
  expectedOut = canary.slice();
new DataView(expectedOut.buffer).setUint32(4, 0, true);
let originalPacket,
  actualPacket,
  route,
  rawVM,
  originalFrame,
  calls = 0,
  gcallCalls = 0,
  comparisons = 0,
  gameTopCalls = 0;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  domains = (m) => [m.memory, m.shared, ...m.blocks].map((part) => part.slice()),
  feature = new NativeTaskDump(model, {
    objects: { machine: () => null },
    nativeTaskID: () => sender,
    sendNativeEngine: async (target, origin, message, w, l, context) => {
      compare(origin, task.id, 'canonical calling task');
      actualPacket = [
        context.nativeSender,
        target,
        message,
        w,
        context.flags,
        context.payload.stringBytes(l, false, true),
      ];
      context.nativeRouted = route !== 0;
      return route === 2 ? outgoing : NATIVE_UNWRITTEN_WORD;
    },
  });
p.store(
  vtable + 16,
  p.trap(
    'independent task dump packet observer',
    7,
    async ([from, to, message, w, l, flags, result]) => {
      originalPacket = [from, to, message, w, flags, p.stringBytes(l, false, true)];
      if (rawVM) originalFrame = [p.load(rawVM + 16), p.load(rawVM + 24)];
      if (route === 2) p.store(result, outgoing);
      if (route === 1 && !sdk) {
        const record = p.read(root, 656),
          before = p.load(result);
        compare(
          await raw.callFromHost(
            NATIVE_ENGINE_MESSAGE_LAYOUTS[profile].root,
            [from, message, w, l, flags, result],
            root,
          ),
          0,
          'Game Top handles raw 36',
        );
        compare(p.load(result), before, 'Game Top leaves the packet result unwritten');
        compare(p.read(root, 656), record, 'Game Top leaves the complete record alone');
        gameTopCalls++;
      }
      return Number(route !== 0);
    },
  ),
);
p.store(host, vtable);
p.store(host + 4, sender);
if (root) p.write(root, new Uint8Array(656).fill(0x5a));

try {
  compare(p.load(table + 4 * NATIVE_TASK_DUMP.id), spec.address, 'frozen native slot');
  const device = sdk ? 0xf68 : 0x2368,
    sound = p.allocate(device + 4, true),
    dump = p.allocate(64, true);
  for (const message of [15, 16]) {
    p.write(out, canary);
    compare(
      await raw.call(sdk ? 0x4c7130 : 0x5eb670, [sender, message, 0, dump, 0, out + 4], sound),
      0,
      'sound with no device handles the dump query',
    );
    compare(p.read(out, 12), expectedOut, 'sound with no device reports zero bytes');
    compare(p.read(dump, 64), new Uint8Array(64), 'sound with no device writes no dump record');
  }
  for (const version of [null, 0, 0x10203, 0x83ff1234, 0xffff0001, 0xffffffff]) {
    const source = kcsProgram([[43, NATIVE_TASK_DUMP.id, 4], [59]]),
      header = new DataView(source.buffer),
      literals = [
        new Uint8Array(),
        encodeCP932('著者-css.dat'),
        encodeCP932('debug-%08x[G512].css'),
        encodeCP932('%s[L1024]'),
        new TextEncoder().encode('UTF-8 猫 %%'),
        Uint8Array.of(0x81, 0x7f, 0xff, 0x2e, 0x63),
        new Uint8Array(255).fill(0x61),
      ];
    header.setUint16(8, version >>> 16, true);
    header.setUint16(10, version, true);
    p.write(referenceHeader, source.subarray(0, 52));
    const script = await readKCS(source),
      m = new KCSMachine(script, {}, new Uint8Array(1024)),
      block = m.allocate(512),
      code = p.allocate(script.body.bytes.length);
    if (version === null) delete script.header;
    p.write(code, script.body.bytes);
    try {
      for (const address of [0, 256, 0x80000020, block + 128])
        for (const literal of literals)
          for (route = 0; route < 3; route++) {
            m.writeStringBytes(literal, address);
            m.store(512, 0x80000000);
            m.writeString('内側-%u[G512].css', m.fp + 1024);
            m.nativeArgumentBase = m.sp;
            m.store(m.sp, address);
            const before = domains(m),
              bridge = new NativeKCSMemory(p, m),
              vm = bridge.pointer;
            p.store(vm + 8, version === null ? 0 : referenceHeader);
            p.store(argv, address);
            p.write(out, canary);
            try {
              const control = await raw.call(spec.address, [vm, host, argv, out + 4]);
              compare(control, 1, 'original D0 control');
              compare(p.read(out, 12), expectedOut, 'zero result and both canaries');
              compare(
                originalPacket.slice(0, 5),
                [sender, 0, spec.message, version ?? 0, 0],
                'wire',
              );
              if (!address && literal === literals[0] && !route) {
                rawVM = vm;
                p.store(vm + 12, code);
                p.store(vm + 16, 1);
                p.store(vm + 24, m.sp + 4);
                p.store(vm + 56, table);
                p.store(vm + 60, host);
                compare(
                  await raw.call(p.load(opcodes + 43 * 4), [vm]),
                  1,
                  'original GCALL continues',
                );
                compare(originalFrame, [11, m.sp], 'original PC and popped SP inside the callback');
                compare(p.load(vm + 24), m.sp + 4, 'original GCALL pushes one result');
                compare(p.load(p.load(vm + 20) + m.sp), 0, 'original GCALL pushes zero');
                p.store(p.load(vm + 20) + m.sp, address);
                rawVM = 0;
                gcallCalls++;
              }
              compare(
                await feature.apply(route === 2 ? [] : [address], m, task),
                { control, value: 0 },
                'adapter',
              );
              compare(
                actualPacket,
                originalPacket,
                'original packet and complete formatted filename bytes',
              );
              compare(domains(m), before, 'adapter leaves all VM domains intact');
            } finally {
              bridge.close();
            }
            compare(domains(m), before, 'original wrapper leaves all VM domains intact');
            calls++;
          }
    } finally {
      p.free(code);
    }
  }
  const report = {
    profile,
    sha256,
    calls,
    gcallCalls,
    gameTopCalls,
    comparisons,
    scope:
      'Original D0 wrapper and adapter, original VM formatter/getter, exact packet and result with canaries, raw and formatted filenames in all VM regions, zero and null metadata, recipient output/routing variants. The original GCALL additionally proves the in-callback PC/SP. Game raw36 executes the complete original Top receiver. SDK complete writer and real KCS tree are exercised by the World test.',
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Original task dump ${comparisons}/${comparisons} (${calls} wrapper cases, ${gcallCalls} GCALL)`,
  );
} finally {
  await model.close();
  await raw.close();
}
