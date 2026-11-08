// SPDX-License-Identifier: MPL-2.0
// Execute complete original wrappers, their real VM translation and formatter.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { nativeTaskCommand, NATIVE_TASK_COMMAND_IDS } from '../src/native/task-command.mjs';
import { nativeDraw } from '../src/native/draw-task.mjs';
import { KCSMachine, encodeCP932 } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-task-commands.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Task command oracle requires a frozen image');
const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  machine = new KCSMachine(
    {
      body: new Binary(Uint8Array.of(59)),
      codeSize: 1,
      data: new Uint8Array(4096),
      stackSize: 1024,
    },
    undefined,
    new Uint8Array(4096),
  ),
  caller = p.allocate(104, true),
  vft = p.allocate(32, true),
  argv = p.allocate(16, true),
  result = p.allocate(12, true),
  table = NATIVE_PROFILES[profile].tables.main.va,
  vm = () => [
    machine.memory.slice(),
    machine.shared.slice(),
    ...machine.blocks.map((b) => b.slice()),
  ];
machine.allocate(4096);
let id,
  events = [],
  outputWord,
  writeQuery = false,
  passed = 0,
  operations = 0;
const messages = new Map([
  [0x28b, [24, 24]],
  [0x28d, [84, 82]],
  [0x28e, [85, 83]],
  [0x28f, [86, 84]],
  [0x291, [307, 302]],
]);
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
function string(memory, address) {
  const out = [];
  for (let at = address; ; at++) {
    const byte = memory.bytes ? memory.bytes(at, 1)[0] : p.read(at, 1)[0];
    if (!byte) return out;
    out.push(byte);
    if (out.length >= 256) throw new Error('Oracle string exceeded original scratch');
  }
}
function receive(sender, target, message, w, l, flags, memory) {
  let data;
  if (id === 0x28e) data = [string(memory, w), string(memory, l)];
  if (id === 0x28f) data = string(memory, l);
  if (id === 0x291) {
    data = memory.load(l);
    if (writeQuery) memory.store(l, outputWord);
  }
  events.push({
    sender,
    target,
    message,
    w: id === 0x28e ? 'firstString' : w,
    l: [0x28e, 0x28f, 0x291].includes(id) ? 'payload' : l,
    flags,
    ...(data === undefined ? {} : { data }),
  });
  return 1;
}
try {
  p.store(caller, vft);
  p.store(caller + 4, 37);
  p.store(
    vft + 16,
    p.trap('task command oracle transport', 7, ([sender, target, message, w, l, flags, out]) => {
      const [canonical, sdkMessage] = messages.get(id);
      assert.equal(message, profile.startsWith('sdk-') ? sdkMessage : canonical);
      p.store(out, 0x75231468);
      return receive(sender, target, canonical, w, l, flags, {
        load: (a) => p.load(a),
        store: (a, n) => p.store(a, n),
      });
    }),
  );
  const sources = [
    encodeCP932(''),
    encodeCP932('猫 %08x[G2048] %% %s[H2048]'),
    new TextEncoder().encode('UTF-8 中文 %s[G3072]'),
    Uint8Array.of(0x81, 0x7f, 0xff, 0x25, 0x25),
    encodeCP932('a'.repeat(255)),
  ];
  for (id of [...NATIVE_TASK_COMMAND_IDS, 0x291])
    for (const target of [0, 1, 0xffffffff, 0x80000000, 19])
      for (const word of [0, 1, 0xffffffff, 0x80000000, 0x12345678])
        for (const [sourceIndex, source] of sources.entries()) {
          for (const region of [machine.memory, machine.shared, ...machine.blocks])
            region.fill(0xa5);
          const address = [128, 0x80000080, machine.memory.length + 128][sourceIndex % 3];
          machine.bytes(address, source.length + 1).set([...source, 0]);
          machine.writeString('日本語', 0x80000800);
          machine.bytes(3072, 5).set([0x81, 0x7f, 0xff, 0x21, 0]);
          machine.store(2048, word);
          machine.fp = 4096;
          const args =
              id === 0x28b
                ? [target]
                : id === 0x28e
                  ? [target, address, 0x80000800]
                  : id === 0x28f
                    ? [target, address]
                    : [target, word],
            before = vm(),
            bridge = new NativeKCSMemory(p, machine);
          writeQuery = sourceIndex % 2 === 0;
          outputWord = word;
          args.forEach((n, i) => p.store(argv + i * 4, n));
          p.write(result, new Uint8Array(12).fill(0xa5));
          events = [];
          let original;
          try {
            const control = await engine.call(p.load(table + id * 4), [
              bridge.pointer,
              caller,
              argv,
              result + 4,
            ]);
            original = { control, ...(control === 1 ? { value: p.load(result + 4) } : {}) };
          } finally {
            bridge.close();
          }
          const expected = structuredClone(events);
          events = [];
          const actual = await (id === 0x291 ? nativeDraw : nativeTaskCommand)(
            id,
            args,
            machine,
            { id: 37 },
            {
              sendNativeEngine: async (target, sender, message, w, l, context) =>
                receive(sender, target, message, w, l, context.flags ?? 0, context.payload),
            },
          );
          compare(actual, original, `${id.toString(16)} complete wrapper reply`);
          compare(events, expected, `${id.toString(16)} task envelope and formatted raw bytes`);
          compare(vm(), before, 'all VM memory domains remain unchanged');
          compare(
            [...p.read(result, 4), ...p.read(result + 8, 4)],
            new Array(8).fill(0xa5),
            'output canaries',
          );
          operations++;
        }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        operations,
        passed,
        scope:
          'Complete original main28B/28D/28E/28F/291, original VM translation and formatter. Exact routing words, target zero, all DWORD extremes, raw CP932/UTF-8/invalid-byte formatted strings from data/shared/blocks, 255-byte scratch, output initialization and optional query writes, full VM and result canaries. Receiver-specific graphics/retained state is checked separately.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original task commands ${passed}/${passed} (${operations} wrapper calls)`);
} finally {
  await engine.close();
}
