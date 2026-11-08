// SPDX-License-Identifier: MPL-2.0
// Original rettitle handlers with their event-deque enqueue boundary supplied.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
const profiles = [
    ['--game', 'nekopara-vol3-engine-2.6.1.76', 0x77ee30, 0x77a310, 19],
    ['--sdk', 'sdk-4.01-engine-2.6.1.74', 0x618100, 0x613cc0, 22],
  ],
  reports = [];
for (const [flag, profile, handler, enqueue, event] of profiles) {
  const index = process.argv.indexOf(flag);
  if (index < 0) continue;
  const engine = await NativeEngineProcess.open({
      profile,
      bytes: new Uint8Array(await readFile(process.argv[index + 1])),
    }),
    p = engine.process,
    interpreter = p.allocate(2048, true),
    queue = p.allocate(32, true),
    calls = [];
  p.store(interpreter + 1468, queue);
  engine.patch(
    enqueue,
    'authored FES event deque',
    1,
    ([packet]) => {
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, queue);
      calls.push(Array.from({ length: 5 }, (_, i) => p.load(packet + i * 4)));
      return 1;
    },
    { calleePops: true },
  );
  let comparisons = 0;
  try {
    for (const word of [0, 1, 2, 3, 0xff, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff]) {
      calls.length = 0;
      assert.equal(await engine.call(handler, [interpreter, word, word, word, word]), 0);
      assert.deepEqual(calls, [[event, 0, 0, 0, 0]]);
      comparisons++;
    }
    reports.push({ profile, comparisons });
    console.log(`${profile}: ${comparisons} original rettitle packets`);
  } finally {
    p.free(interpreter);
    p.free(queue);
    await engine.close();
  }
}
if (!reports.length) throw new Error('Supply --game EXE and/or --sdk EXE');
const out = process.argv.indexOf('--report');
if (out >= 0) await writeFile(process.argv[out + 1], JSON.stringify(reports, null, 2) + '\n');
