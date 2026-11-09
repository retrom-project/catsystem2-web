// SPDX-License-Identifier: MPL-2.0
// Compare the whole original 1B1 and mounted wrapper at their task transport.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeTilePlaneCommand } from '../src/native/tile-plane-command.mjs';

const [file, report] = process.argv.slice(2);
if (!report)
  throw new Error(
    'Usage: node scripts/verify-native-tile-plane-command.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(file)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('The tiled-plane oracle requires a frozen engine image');

const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  sdk = profile.startsWith('sdk-'),
  main = NATIVE_EXE_PROFILES[profile].tables.main.va,
  address = p.load(main + 0x1b1 * 4),
  task = { id: 701 },
  canaries = new Uint8Array(12).fill(0xa5),
  host = p.allocate(8),
  vtable = p.allocate(20, true),
  argv = p.allocate(20),
  result = p.allocate(12),
  guardPage = 0x78000000,
  zeroArgv = guardPage + 4092,
  stackSlots = [44, 40, 36, 68].map((offset) => p.stackTop - offset);
let sender, routed, response, events, localOut;
let comparisons = 0,
  calls = 0;
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const capture = (from, target, message, w, l, flags, out) => {
  localOut = out;
  events.push({
    from,
    target,
    message,
    w,
    flags,
    data: Array.from({ length: 10 }, (_, i) => p.load(l + i * 4)),
    out: p.load(out),
  });
};

try {
  compare(address, sdk ? 0x512cc0 : 0x6405e0, 'frozen main table slot');
  p.map(guardPage, 4096, 'single zero target followed by unmapped memory');
  p.store(zeroArgv, 0);
  p.store(host, vtable);
  p.store(
    vtable + 16,
    p.trap(
      'original tiled plane transport reference',
      7,
      ([from, target, raw, w, l, flags, out]) => {
        compare(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, host, 'native sender object');
        compare(raw, sdk ? 44 : 46, 'raw profile message');
        capture(from, target, 46, w, l, flags, out);
        if (response !== undefined) p.store(out, response);
        return Number(routed);
      },
    ),
  );
  const adapter = new NativeTilePlaneCommand(engine, {
    nativeTaskID(origin) {
      compare(origin, task.id, 'temporary caller uses the World identity');
      return sender;
    },
    sendNativeEngine(target, origin, message, w, l, context) {
      compare(origin, task.id, 'preserved task namespace');
      compare(context.payload, p, 'receiver borrows the live process RAM');
      compare(context.nativePointer && context.fromHost, true, 'native receiver context');
      capture(context.nativeSender, target, message, w, l, context.flags, context.nativeResult);
      context.nativeRouted = routed;
      return response;
    },
  });
  const dimensions = [
      [0x40800000, 0x40400000],
      [0x80000000, 0],
      [0x00000001, 0x007fffff],
      [0x7f800000, 0xff800000],
      [0x7f800001, 0xffc00123],
      [0xc0000000, 0x7f7fffff],
    ],
    counts = [
      [0, 0],
      [1, 3],
      [0x7fffffff, 0x80000000],
      [0xffffffff, 0x10203040],
      [17, 99],
    ],
    scratch = [
      [0, 0, 0, 0x11223344],
      [0x01234567, 0x89abcdef, 0xfedcba98, 0xa5a5a5a5],
      [0x7f800001, 0x80000000, 0xffffffff, 0],
      [32, 1, 0xffffffff, 0xcccccccc],
    ];
  for (const target of [0, 1, 0x12345678, 0x80000000, 0xffffffff])
    for (const size of dimensions)
      for (const count of counts)
        for (const [variant, seed] of scratch.entries()) {
          sender = [0, 17, 0xffffffff, 0x80000000][variant];
          routed = variant !== 0;
          response = [undefined, 0, undefined, 0xff123456][variant];
          const words = [target, ...size, ...count],
            seedStack = () => stackSlots.forEach((at, i) => p.store(at, seed[i])),
            expected = target
              ? [
                  {
                    from: sender,
                    target,
                    message: 46,
                    w: 0,
                    flags: 0,
                    data: [0, 0, 0, ...size, ...seed.slice(0, 3), ...count],
                    out: seed[3],
                  },
                ]
              : [];
          words.forEach((word, i) => p.store(argv + i * 4, word));
          p.store(host + 4, sender);
          p.write(result, canaries);
          seedStack();
          events = [];
          localOut = 0;
          const control = await engine.call(address, [
            guardPage + 4096,
            target ? host : guardPage + 4096,
            target ? argv : zeroArgv,
            result + 4,
          ]);
          compare(control, 2, 'original void control');
          compare(p.read(result, 12), canaries, 'original GCALL result and canaries untouched');
          compare(events, expected, 'whole original envelope and 40-byte packet');
          if (localOut) compare(p.load(localOut), response ?? seed[3], 'original task output');
          const reference = events;
          events = [];
          localOut = 0;
          const length = target ? variant + 2 : variant % 2,
            loaded = [],
            machine = {
              nativeArgument(i) {
                if (i >= (target ? 5 : 1)) throw new Error('read past the native argument range');
                loaded.push(i);
                return words[i];
              },
            };
          seedStack();
          compare(await adapter.apply(words.slice(0, length), machine, task), { control });
          compare(events, reference, 'mounted packet and its original stack scratch');
          compare(
            loaded,
            Array.from({ length: Math.max(0, (target ? 5 : 1) - length) }, (_, i) => length + i),
            'only the originally read adjacent words are fetched',
          );
          if (localOut) compare(p.load(localOut), response ?? seed[3], 'mounted task output');
          calls++;
        }
  await writeFile(report, JSON.stringify({ profile, sha256, calls, comparisons }, null, 2) + '\n');
  console.log(
    `${profile}: ${comparisons} comparisons across ${calls} original and mounted 1B1 calls`,
  );
} finally {
  await engine.close();
}
