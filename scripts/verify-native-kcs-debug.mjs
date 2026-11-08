// SPDX-License-Identifier: MPL-2.0
// Original opcode/deque and Script debug-query handlers. The debugger's
// externally initialized symbol/scope containers are authored probe inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Binary } from '../src/binary.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-kcs-debug.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Debug oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ bytes, profile, trace: true }),
  p = engine.process,
  source = new Uint8Array(512 + 148 * 128),
  records = source.subarray(512),
  recordView = new DataView(records.buffer, records.byteOffset, records.byteLength),
  machine = new KCSMachine({
    body: new Binary(source),
    codeSize: 512,
    data: new Uint8Array(4096),
    stackSize: 4096,
    debugOffset: 512,
    debugSize: 148 * 128,
  }),
  bridge = new NativeKCSMemory(p, machine),
  vm = bridge.pointer,
  code = p.allocate(512, true),
  header = p.allocate(52, true),
  table = sdk ? 0xc53d00 : 0xb49a00,
  symbols = p.allocate(records.length, true),
  script = p.allocate(1024, true),
  out = p.allocate(4, true),
  packet = p.allocate(160, true),
  handler = p.load((sdk ? 0x992ec4 : 0x8cdbe4) + 28),
  rawMessage = (id) => (sdk ? id - 2 : id);
let passed = 0,
  undefinedFrameReads = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
const deque = (values = []) => {
  const d = p.allocate(20, true),
    proxy = p.allocate(8, true),
    map = p.allocate(32, true);
  p.store(proxy, d);
  p.store(d, proxy);
  p.store(d + 4, map);
  p.store(d + 8, 8);
  p.store(d + 16, values.length);
  for (let block = 0; block < Math.ceil(values.length / 4); block++) {
    const at = p.allocate(16, true);
    p.store(map + block * 4, at);
    values.slice(block * 4, block * 4 + 4).forEach((v, i) => p.store(at + i * 4, v));
  }
  return d;
};
const readDeque = (d) =>
  Array.from({ length: p.load(d + 16) }, (_, i) => {
    const index = p.load(d + 12) + i,
      map = p.load(d + 4),
      size = p.load(d + 8);
    return p.load(p.load(map + ((index >>> 2) & (size - 1)) * 4) + (index & 3) * 4);
  });
const locals = deque(),
  scopes = deque([0]);
p.store(vm + 1368, locals);
p.store(vm + 1372, scopes);
p.store(vm + 72, symbols);
p.store(vm + 8, header);
p.store(header + 16, 512);
p.store(vm + 12, code);
p.store(script + 112, vm);
p.store(vm + 24, machine.sp);
p.store(vm + 28, machine.floor);
p.store(vm + 32, machine.fp);
for (let i = 0; i < machine.memory.length; i++) machine.memory[i] = (i * 37 + 11) & 255;
for (let i = 0; i < machine.shared.length; i++) machine.shared[i] = (i * 19 + 7) & 255;
p.write(p.load(vm + 20), machine.memory);
p.write(p.load(vm + 40), machine.shared);
const recordTypes = [0x0a, 0x0b, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x51];
for (let i = 0; i < 128; i++) {
  recordView.setUint32(i * 148, i % 4 === 0 ? 0x80000010 : i * 4, true);
  records[i * 148 + 8] = recordTypes[i % recordTypes.length];
  records[i * 148 + 9] = i % 7 === 0 ? 1 : 0;
  records[i * 148 + 12] = 65 + (i % 26);
}
p.write(symbols, records);
const step = async (op, ...args) => {
  const bytes = Uint8Array.from([
    op,
    ...args.flatMap((v) => [0x23, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24]),
  ]);
  source.set(bytes, 0);
  p.write(code, bytes);
  p.store(vm + 16, 1);
  machine.pc = 0;
  check(await engine.call(p.load(table + op * 4), [vm]), 1, `opcode${op}/control`);
  machine.step();
  check(
    readDeque(locals).map((pointer) => (pointer - symbols) / 148),
    machine.debug.locals,
    `opcode${op}/symbols`,
  );
  check(readDeque(scopes), machine.debug.scopes, `opcode${op}/scopes`);
  check(p.load(vm + 340), machine.debug.functions.length, `opcode${op}/function count`);
  check(
    Array.from({ length: p.load(vm + 340) }, (_, i) => p.load(vm + 344 + i * 4) - p.load(vm + 20)),
    machine.debug.functions,
    `opcode${op}/function addresses`,
  );
  check(
    [p.load(vm + 16), p.load(vm + 24), p.load(vm + 28), p.load(vm + 32)],
    [machine.pc, machine.sp, machine.floor, machine.fp],
    `opcode${op}/frame`,
  );
};
const query = async (id, index) => {
  p.write(
    packet,
    Uint8Array.from({ length: 160 }, (_, i) => (i * 13 + 29) & 255),
  );
  p.store(out, 0xcafebabe);
  const input = p.read(packet, 160),
    expected = input.slice();
  check(
    await engine.call(handler, [3, rawMessage(id), index, packet, 0, out], script),
    0,
    `query${id}/handled`,
  );
  if (!machine.debugSymbol(index, id === 165, expected))
    new DataView(expected.buffer).setUint32(0, 0xffffffff, true);
  check(p.read(packet, 160), expected, `query${id}/${index}/bytes`);
  check(p.load(out), 0xcafebabe, `query${id}/unwritten`);
};
try {
  await step(67, 0, 3);
  for (let i = 0; i < 5; i++) await query(164, i);
  for (let depth = 0; depth < 4; depth++) {
    await step(42, 100, 0);
    const address = 256 + depth * 16;
    machine.writeString(`関数${depth}`, address);
    p.write(p.load(vm + 20) + address, machine.bytes(address, 16));
    await step(66, address);
    await step(67, 10 + depth * 10, 5 + depth);
    for (let i = 0; i < 10; i++) await query(164, i);
    for (let i = 0; i < 5; i++) await query(165, i);
  }
  for (let depth = 3; depth >= 0; depth--) {
    await step(68, 5 + depth);
    await step(44, 0, 0);
  }
  for (const count of [0, 1, 4, 8, 17, 31]) {
    await step(67, 17, count);
    for (let i = 0; i < Math.min(12, count + 1); i++) await query(164, i);
    await step(68, count);
  }
  for (const address of [
    0, 1, 4, 4096, 8191, 8192, 0x80000010, 0x40000010, 0x400fffff, 0x40100000, 0xffffffff,
  ])
    for (const type of recordTypes)
      for (const immediate of [0, 1])
        for (const relative of [0, 1]) {
          const width = [0x29, 0x2e, 0x2f, 0x30].includes(type)
            ? 4
            : [0x2a, 0x2b].includes(type)
              ? 1
              : [0x2c, 0x2d].includes(type)
                ? 2
                : 0;
          let at = address,
            limit = machine.memory.length;
          if (address & 0x40000000) {
            at = address & 0xbfffffff;
            limit = machine.shared.length;
          } else {
            at = address & 0x7fffffff;
            if (relative && at < machine.memory.length) at += machine.fp;
          }
          if (
            !immediate &&
            width &&
            (((address & 0x7fffffff) < machine.memory.length &&
              !(address & 0x40000000) &&
              relative &&
              at + width > limit) ||
              (at < limit && at + width > limit))
          ) {
            undefinedFrameReads++;
            continue;
          }
          const descriptor = Uint8Array.from({ length: 156 }, (_, i) => (i * 7 + 31) & 255),
            v = new DataView(descriptor.buffer);
          v.setUint32(0, address, true);
          descriptor[8] = type;
          descriptor[9] = immediate;
          v.setUint32(152, relative, true);
          p.write(packet, descriptor);
          p.store(out, 0xcafebabe);
          const expected = descriptor.slice();
          machine.debugValue(expected);
          check(
            await engine.call(handler, [3, rawMessage(168), 0, packet, 0, out], script),
            0,
            'value handled',
          );
          check(
            p.read(packet, 156),
            expected,
            `value/${address.toString(16)}/${type}/${immediate}/${relative}`,
          );
          check(p.load(out), 0xcafebabe, 'value unwritten');
        }
  console.log(`Native KCS debug passed ${passed}/${passed}`);
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        undefinedFrameReads,
        scope:
          'Original op67/68, CALL/RETURN debug deques, Script164/165/168 descriptor/value queries; containers are authored debugger initialization. No claim for the external debugger UI/initialization.',
        patches: engine.patches,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  bridge.close();
  await engine.close();
}
