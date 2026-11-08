// SPDX-License-Identifier: MPL-2.0
// Original GCALL, original identity and all three empty control-1 wrappers.
// The diagnostic logger is the only substituted callee.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { readKCS, KCSMachine } from '../src/kcs.mjs';
import { nativeStandard } from '../src/native/standard.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, report] = process.argv.slice(2);
if (!report)
  throw new Error('Usage: node scripts/verify-native-gcall-result.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('GCALL result oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({
    bytes,
    profile,
    standardLibraries: false,
    trace: true,
  }),
  p = engine.process,
  table = sdk ? 0xb3c900 : 0xa2dd38,
  opcodes = sdk ? 0xc53d00 : 0xb49a00;
let passed = 0,
  nativeLogs = 0;
const check = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
engine.patch(sdk ? 0x4a82f0 : 0x5cac90, 'GCALL diagnostic logger boundary', 0, () => {
  nativeLogs++;
  return 0;
});
try {
  for (const seed of [0, 1, 0xffffffff, 0xcccccccc, 0x13579bdf, 0x80000000])
    for (const count of [0, 4, 12]) {
      const instructions = [
        [37, seed],
        [43, 6, 4],
      ];
      for (const id of [0x8c, 0x8e, 0x225]) {
        for (let i = 0; i < count / 4; i++) instructions.push([37, (seed + i + 1) >>> 0]);
        instructions.push([43, id, count]);
      }
      instructions.push([59]);
      const script = await readKCS(kcsProgram(instructions)),
        logs = [],
        m = new KCSMachine(script, {
          native: (id, args, machine) => nativeStandard(id, args, machine),
          diagnostic: (event) => logs.push(event),
        });
      for (let i = 0; i < m.memory.length; i++) m.memory[i] = (i * 17 + 3) & 255;
      const bridge = new NativeKCSMemory(p, m),
        code = p.allocate(script.body.bytes.length, true),
        header = p.allocate(52, true),
        vm = bridge.pointer;
      p.write(code, script.body.bytes);
      p.store(header + 16, script.codeSize);
      p.store(vm + 8, header);
      p.store(vm + 12, code);
      p.store(vm + 16, 0);
      p.store(vm + 24, m.sp);
      p.store(vm + 28, m.floor);
      p.store(vm + 56, table);
      nativeLogs = 0;
      try {
        while (m.instruction().op !== 59) {
          const op = m.instruction().op;
          p.store(vm + 16, m.pc + 1);
          check(
            await engine.call(p.load(opcodes + op * 4), [vm]),
            1,
            'original instruction continuation',
          );
          m.step();
          check(
            [m.pc, m.sp, m.floor, m.fp],
            [p.load(vm + 16), p.load(vm + 24), p.load(vm + 28), p.load(vm + 32)],
            'GCALL frame',
          );
          check(m.memory, p.read(p.load(vm + 20), m.memory.length), 'GCALL complete memory');
          check(logs.length, nativeLogs, 'GCALL sentinel diagnostic count');
        }
        check(
          [
            m.load(m.data.length),
            m.load(m.data.length + 4),
            m.load(m.data.length + 8),
            m.load(m.data.length + 12),
          ],
          [seed, 0xcccccccc, 0xcccccccc, 0xcccccccc],
          'fresh sentinel after a previously written result',
        );
      } finally {
        bridge.close();
        p.free(code);
        p.free(header);
      }
    }
  const wrappers = [0x8c, 0x8e, 0x225].map((id) => ({ id, address: p.load(table + id * 4) }));
  console.log(`Native GCALL result passed ${passed}/${passed}`);
  await fs.writeFile(
    report,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        wrappers,
        scope:
          'Complete original GCALL and real 8C/8E/225 handlers, preceded by a real written identity result; per-instruction frame/full-memory comparison and diagnostic counts. Only the logger is replaced.',
        patches: engine.patches,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await engine.close();
}
