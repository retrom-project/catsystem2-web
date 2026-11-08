// SPDX-License-Identifier: MPL-2.0
// Execute the original legacy text/retained finish wrappers. Task routing and
// its optional payload write are explicit boundaries; wrapper locals run native.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
const profiles = [
    [
      '--game',
      'nekopara-vol3-engine-2.6.1.76',
      [
        [0x187, 0x652720, 119],
        [0x1c8, 0x6526f0, 120],
        [0x1d0, 0x6446a0, 300],
      ],
    ],
    [
      '--sdk',
      'sdk-4.01-engine-2.6.1.74',
      [
        [0x187, 0x51f320, 117],
        [0x1c8, 0x51f2f0, 118],
        [0x1d0, 0x51cd30, 295],
      ],
    ],
  ],
  reports = [];
for (const [flag, profile, wrappers] of profiles) {
  const index = process.argv.indexOf(flag);
  if (index < 0) continue;
  const engine = await NativeEngineProcess.open({
      profile,
      bytes: new Uint8Array(await readFile(process.argv[index + 1])),
    }),
    p = engine.process,
    caller = p.allocate(32, true),
    vtable = p.allocate(32, true),
    args = p.allocate(16, true),
    result = p.allocate(4, true);
  let expectedMessage,
    writePayload,
    trace,
    comparisons = 0;
  const route = p.trap(
    'authored text/draw transport',
    7,
    ([sender, target, message, w, l, flags, out]) => {
      trace.push({
        sender,
        target,
        message,
        w,
        l: message === expectedMessage && [117, 119].includes(message) ? 'payload' : l,
        flags,
      });
      if (writePayload && [117, 119].includes(message)) p.store(l, 0x12345678);
      if (out) p.store(out, 0xabcd0123);
      return Number(Boolean(target));
    },
  );
  p.store(caller, vtable);
  p.store(caller + 4, 7);
  p.store(vtable + 16, route);
  try {
    for (const [id, entry, message] of wrappers)
      for (const target of [0, 1, 17, 0xffffffff])
        for (const value of [0, 5, 0xffffffff])
          for (const write of [false, true]) {
            expectedMessage = message;
            writePayload = write;
            trace = [];
            [target, value, 0xa5a5a5a5, 0x55555555].forEach((word, i) =>
              p.store(args + i * 4, word),
            );
            const saved = p.read(args, 16).slice();
            p.store(result, 0xcccccccc);
            const control = await engine.call(entry, [0, caller, args, result]);
            assert.equal(control, id === 0x187 ? 1 : 2);
            assert.equal(p.load(result), id === 0x187 ? (write ? 0x12345678 : 0) : 0xcccccccc);
            assert.deepEqual(p.read(args, 16), saved);
            assert.deepEqual(trace, [
              {
                sender: 7,
                target,
                message,
                w: id === 0x1d0 ? value : 0,
                l: id === 0x187 ? 'payload' : id === 0x1c8 ? value : 0,
                flags: 0,
              },
            ]);
            comparisons++;
          }
    reports.push({ profile, comparisons });
    console.log(`${profile}: ${comparisons} original text/draw wrapper calls`);
  } finally {
    for (const ptr of [caller, vtable, args, result]) p.free(ptr);
    await engine.close();
  }
}
if (!reports.length) throw new Error('Supply --game EXE and/or --sdk EXE');
const output = process.argv.indexOf('--report');
if (output >= 0) await writeFile(process.argv[output + 1], JSON.stringify(reports, null, 2) + '\n');
