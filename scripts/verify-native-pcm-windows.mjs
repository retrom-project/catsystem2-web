// SPDX-License-Identifier: MPL-2.0
// Run the fixed engine's activity-buffer fill and cursor queries. Only decoder
// reads, DirectSound lock/cursor calls and platform/CRT services are substituted.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Binary } from '../src/binary.mjs';
import { NativePCMWindows } from '../src/native/audio-pcm.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

const [exe, output] = process.argv.slice(2);
if (!exe || !output)
  throw new Error('Usage: node scripts/verify-native-pcm-windows.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(exe)),
  sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0');
const b = new Binary(bytes),
  pe = b.u32(60),
  optional = pe + 24,
  image = new Uint8Array(b.u32(optional + 56));
image.set(b.range(0, b.u32(optional + 60)));
for (let n = 0; n < b.u16(pe + 6); n++) {
  const at = optional + b.u16(pe + 20) + n * 40;
  image.set(b.range(b.u32(at + 20), b.u32(at + 16)), b.u32(at + 12));
}
const u = await loadUnicorn(),
  p = new PE32Process(u);
p.map(0x400000, image.length);
p.write(0x400000, image);
const redirect = (at, count, callback) => {
  const target = p.trap(`external@${at.toString(16)}`, count, callback),
    code = new Uint8Array(5);
  code[0] = 0xe9;
  new DataView(code.buffer).setUint32(1, target - at - 5, true);
  p.write(at, code);
};
for (const address of [0x8c6274, 0x8c6278])
  p.store(
    address,
    p.trap('CriticalSection', 1, () => 0),
  );
redirect(0x5d1b20, 0, () => 0); // DirectSound restore/check, not activity processing.
redirect(0x6a73e0, 0, () => {
  const sp = p.cpu.reg_read_i32(u.X86_REG_ESP) >>> 0,
    [dst, size, byte] = [4, 8, 12].map((n) => p.load(sp + n));
  p.write(dst, new Uint8Array(size).fill(byte));
  return dst;
});
const owner = p.allocate(1024, true),
  device = p.allocate(4, true),
  vft = p.allocate(80, true),
  decoder = p.allocate(4, true),
  decoderVft = p.allocate(16, true),
  pcm = p.allocate(1024 * 1024, true),
  out = p.allocate(320, true);
p.store(owner + 8, device);
p.store(device, vft);
p.store(owner + 128, decoder);
p.store(decoder, decoderVft);
let source = new Uint8Array(),
  region = 0,
  playCursor = 0,
  writeCursor = 0;
p.store(
  vft + 16,
  p.trap('GetCurrentPosition', 3, ([, play, write]) => {
    p.store(play, playCursor);
    p.store(write, writeCursor);
    return 0;
  }),
);
p.store(
  vft + 44,
  p.trap('Lock', 8, ([, , count, first, firstSize, second, secondSize]) => {
    p.store(first, pcm);
    p.store(firstSize, count || region);
    p.store(second, 0);
    p.store(secondSize, 0);
    return 0;
  }),
);
p.store(
  vft + 76,
  p.trap('Unlock', 5, () => 0),
);
p.store(
  decoderVft + 8,
  p.trap('Decoder.Read', 2, ([destination, count]) => {
    const copied = Math.min(source.length, count);
    p.write(destination, source.subarray(0, copied));
    return copied;
  }),
);
let passed = 0;
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
try {
  for (const channels of [1, 2])
    for (const bitsPerSample of [8, 16])
      for (const sampleRate of [8000, 22050, 44100]) {
        const windows = new NativePCMWindows({ channels, bitsPerSample, sampleRate }),
          data = new DataView(new ArrayBuffer(124));
        data.setUint16(110, channels, true);
        data.setUint16(122, bitsPerSample, true);
        p.write(owner, new Uint8Array(data.buffer));
        p.store(owner + 8, device);
        p.store(owner + 128, decoder);
        p.store(owner + 312, 1);
        p.store(owner + 376, windows.halfSecondBytes);
        region = windows.halfSecondBytes * 8;
        source = Uint8Array.from(
          { length: region },
          (_, i) => ((i * 137 + (i >>> 5)) ^ (i >>> 3)) & 255,
        );
        p.zero(owner + 388, 320);
        p.call(0x5d0b40, [0, 0], owner);
        windows.fill(0, source, { initial: true });
        compare(
          p.read(owner + 388, 320),
          new Uint8Array(windows.values.buffer),
          `initial/${channels}/${bitsPerSample}/${sampleRate}`,
        );
        for (const enabled of [false, true])
          for (const offset of [0, windows.halfSecondBytes, windows.halfSecondBytes * 7]) {
            region = windows.halfSecondBytes;
            source = Uint8Array.from({ length: region }, (_, i) => (i * 93 + 17) & 255);
            p.store(owner + 384, Number(enabled));
            p.call(0x5d0b40, [offset, region], owner);
            windows.fill(offset, source, { enabled });
            compare(
              p.read(owner + 388, 320),
              new Uint8Array(windows.values.buffer),
              `refill/${enabled}/${offset}`,
            );
          }
        for (const play of [
          0,
          windows.windowBytes - 1,
          windows.windowBytes,
          windows.windowBytes * 12,
          windows.windowBytes * 79,
          windows.windowBytes * 80,
        ]) {
          playCursor = play;
          for (const playing of [false, true]) {
            p.store(owner + 312, Number(playing));
            compare(
              p.call(0x5d0fe0, [], owner),
              windows.level(playCursor, playing),
              `current/${play}/${playing}`,
            );
          }
          for (const write of [
            0,
            windows.windowBytes * 8,
            windows.windowBytes * 79,
            windows.windowBytes * 80,
          ])
            for (const count of [0, 1, 7, 80, 100]) {
              writeCursor = write;
              p.zero(out, 320);
              const returned = p.call(0x5d1060, [out, count], owner),
                actual = Array.from({ length: returned }, (_, i) => p.load(out + 4 * i));
              compare(
                actual,
                windows.levels(count, playCursor, writeCursor),
                `forward/${play}/${write}/${count}`,
              );
            }
        }
      }
  await writeFile(
    output,
    JSON.stringify(
      {
        sha256,
        passed,
        scope:
          'Original 5D0B40 full-region non-wrapping activity fills and 5D0FE0/5D1060 cursor queries; decoder and DirectSound device calls supplied by harness',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native PCM window differential passed ${passed}/${passed}`);
} finally {
  p.close();
}
