// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_IMAGE_COMMAND_CONTRACTS } from '../src/native/image-commands.mjs';
import { imageCommandsFixture } from '../tests/fixtures/image-commands-fixture.mjs';
import { installNativeRasterKernels } from '../src/native/raster-kernel.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-image-commands.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (key) => NATIVE_ENGINE_IMAGES[key].sha256 === sha256,
  );
if (!profile) throw new Error('Image commands require a frozen engine');
const raw = await imageCommandsFixture(bytes, profile),
  f = await imageCommandsFixture(bytes, profile),
  index = Number(profile.startsWith('sdk-')),
  pointers = new Map(),
  covered = new Map();
installNativeRasterKernels(f.engine);
let calls = 0,
  comparisons = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  comparisons++;
}
for (const fixture of [raw, f]) {
  const allocate = fixture.engine.kernel.heapAllocate.bind(fixture.engine.kernel);
  fixture.engine.kernel.heapAllocate = (heap, flags, size, ...rest) => {
    const pointer = allocate(heap, flags, size, ...rest);
    if (pointer && !(flags & 8) && fixture.allocationByte != null)
      fixture.process.write(pointer, new Uint8Array(size).fill(fixture.allocationByte));
    return pointer;
  };
  fixture.destination = fixture.images.create(4, 3, 1);
  fixture.source = fixture.images.create(4, 3, 1);
  fixture.alias = fixture.images.alias(fixture.source, 2);
  fixture.block = fixture.machine.allocate(1024);
  for (const handle of [fixture.destination, fixture.source, fixture.alias]) {
    const wrapper = await fixture.memory.wrapper(handle);
    if (fixture === raw) pointers.set(handle, wrapper);
    else check(wrapper, pointers.get(handle), 'persistent wrapper identity');
  }
}
const h = raw.destination,
  s = raw.source,
  alias = raw.alias;
async function reset(bpp = 4, seed = 0) {
  for (const fixture of [raw, f]) {
    const p = fixture.process;
    for (const handle of [h, s]) {
      const pointer = await fixture.memory.pointer(handle);
      await fixture.memory.call(fixture.memory.layout.clearAttributes, [], pointer);
      // Original configure reuses an existing allocation without growing it.
      // Every authored case starts with a correctly sized fresh pixel buffer.
      fixture.buffers.releaseData(p.load(pointer + 12));
      p.store(pointer + 12, 0);
      await fixture.memory.call(fixture.memory.layout.configure, [4, 3, bpp], pointer);
      for (const [at, word] of [
        [28, 8],
        [32, 7],
        [36, seed % 3],
        [40, (seed >> 1) % 3],
        [44, seed % 3],
        [48, 1],
        [52, -2],
        [56, 0],
        [60, 0],
        [64, 4],
        [68, 3],
        [76, 0],
        [84, seed % 3],
      ])
        p.store(pointer + at, word);
      const stride = p.load(pointer + 20),
        data = p.load(pointer + 12);
      p.write(
        data,
        Uint8Array.from({ length: stride * 3 }, (_, i) => (i * 37 + handle * 19 + seed) & 255),
      );
      const attribute = p.allocate(20);
      try {
        for (const id of [7, 65535]) {
          [id, -20, 30, -40, 0xff800123].forEach((v, i) => p.store(attribute + i * 4, v));
          await fixture.memory.call(fixture.memory.layout.attribute, [id, 0, attribute], pointer);
        }
      } finally {
        p.free(attribute);
      }
    }
    fixture.uploads.length = 0;
    fixture.machine.memory.fill(0xa5);
    fixture.machine.shared.fill(0x5a);
    for (const block of fixture.machine.blocks) block.fill(0x3c);
  }
}
function bitmapState(fixture, handle) {
  const p = fixture.process,
    ptr = p.load(pointers.get(handle));
  return {
    fields: [4, 8, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 76, 80, 84].map((at) =>
      p.load(ptr + at),
    ),
    pixels: p.read(p.load(ptr + 12), p.load(ptr + 20) * p.load(ptr + 8)),
    attributes: fixture.images.get(handle).state.attributes,
  };
}
function uploadState(fixture) {
  return fixture.uploads.map(({ args }) => ({
    args: args.slice(1),
    handle: [...pointers].find(([, w]) => fixture.process.load(w) === args[0])?.[0],
  }));
}
function fillWords(machine, address, words) {
  words.forEach((word, i) => machine.store((address + i * 4) >>> 0, word));
}
async function original(spec, args) {
  const p = raw.process,
    m = raw.machine,
    words = [...args];
  let list;
  if ((spec.id === 0x73 && words[5]) || (spec.id === 0x74 && words[0] && words[5])) {
    if (words[0]) words[0] = pointers.get(words[0]);
    words[5] = pointers.get(words[5]);
  } else if (spec.id === 0x219 && words[0] && words[1]) {
    words[0] = pointers.get(words[0]);
    words[1] = pointers.get(words[1]);
  } else if (spec.id !== 0x73 && spec.id !== 0x74 && spec.id !== 0x219 && words[0]) {
    words[0] = pointers.get(words[0]);
  }
  if (spec.id === 0x78 && words[0]) {
    list = m.bytes(words[1], words[2] * 12).slice();
    for (let i = 0; i < words[2]; i++) {
      const at = (words[1] + i * 12) >>> 0,
        handle = m.load(at);
      if (handle) m.store(at, pointers.get(handle));
    }
  }
  const bridge = new NativeKCSMemory(p, m),
    argv = p.allocate(words.length * 4),
    out = p.allocate(12),
    host = p.allocate(120, true);
  try {
    words.forEach((v, i) => p.store(argv + i * 4, v));
    p.write(out, new Uint8Array(12).fill(0xcc));
    p.store(host + 116, raw.view);
    const control = await raw.engine.call(spec.handlers[index], [
      bridge.pointer,
      host,
      argv,
      out + 4,
    ]);
    check([...p.read(out, 4), ...p.read(out + 8, 4)], Array(8).fill(0xcc), 'raw output canaries');
    return { control, ...(control === 1 ? { value: p.load(out + 4) } : {}) };
  } finally {
    bridge.close();
    if (list) m.bytes(args[1], list.length).set(list);
    p.free(out);
    p.free(argv);
    p.free(host);
  }
}
async function run(spec, args) {
  // The original BPP3 horizontal blur writes only one byte per pixel into
  // uninitialized scratch storage; the vertical pass then consumes the rest.
  // Give both allocators an explicit matching byte pattern for this scoped
  // differential. The product keeps its actual original heap behavior.
  for (const fixture of [raw, f])
    fixture.allocationByte =
      spec.id === 0x21a ? ((covered.get(spec.id) ?? 0) % 2 ? 0xa7 : 0) : null;
  const expected = await original(spec, args),
    actual = await f.commands.apply(spec.id, args, f.machine, { id: 1 });
  for (const fixture of [raw, f]) fixture.allocationByte = null;
  calls++;
  covered.set(spec.id, (covered.get(spec.id) ?? 0) + 1);
  check(actual, expected, 'reply/' + spec.id.toString(16));
  check(f.machine.memory, raw.machine.memory, 'complete VM data and stack');
  check(f.machine.shared, raw.machine.shared, 'complete shared VM');
  check(f.machine.blocks, raw.machine.blocks, 'complete extended blocks');
  for (const handle of [h, s, alias])
    check(
      bitmapState(f, handle),
      bitmapState(raw, handle),
      'bitmap bytes and attributes/' + spec.id.toString(16) + '/' + covered.get(spec.id),
    );
  check(uploadState(f), uploadState(raw), 'explicit native view upload boundary');
}
try {
  const rects = [
    [0, 0, 4, 3],
    [1, 1, 2, 1],
    [-1, 0, 3, 2],
    [0, -1, 2, 3],
    [3, 2, 4, 3],
    [0, 0, 0, 1],
  ];
  // Warm-up uses the real mounted file and view in native-image-commands.spec.mjs.
  for (const spec of NATIVE_IMAGE_COMMAND_CONTRACTS.filter(({ id }) => id !== 0x2a9)) {
    await reset();
    await run(
      spec,
      spec.id === 0x73
        ? [0x41414141, 0, 0, 0, 0, 0]
        : spec.id === 0x74
          ? [0, 0, 0, 0, 0, 0x41414141]
          : spec.id === 0x219
            ? [0, 0x41414141]
            : [0],
    );
    for (const bpp of [2, 3, 4])
      for (let n = 0; n < 36; n++) {
        await reset(bpp, n);
        const at = [512, raw.machine.data.length + 128, 0x80000040, raw.block + 64][n % 4];
        let args;
        switch (spec.id) {
          case 0x73:
          case 0x74:
            args = [
              spec.id === 0x73 && n % 7 === 0 ? 0 : h,
              ...rects[n % 6],
              n % 5 === 0 ? h : n % 3 === 0 ? alias : s,
              ...rects[(n + 1) % 6],
            ];
            break;
          case 0x78:
            for (const fixture of [raw, f]) {
              fillWords(fixture.machine, at, [s, -1, 0, alias, 2, 1, 0, 0, 0, h, 1, -1]);
              fillWords(fixture.machine, at + 64, rects[n % 6]);
            }
            args = [h, at, n % 5, at + 64];
            break;
          case 0x1be:
            for (const fixture of [raw, f]) {
              fillWords(fixture.machine, at, rects[n % 6]);
              if (n % 5 === 0)
                fixture.process.write(
                  fixture.process.load(fixture.process.load(pointers.get(h)) + 12),
                  new Uint8Array(fixture.process.load(fixture.process.load(pointers.get(h)) + 16)),
                );
            }
            args = [h, at];
            break;
          case 0x218:
            args = [
              h,
              [0, 7, 65535, 0x10007, 19][n % 5],
              at,
              at + (n % 3 === 0 ? 0 : 4),
              at + 8,
              at + 12,
              at + 16,
            ];
            break;
          case 0x219:
            // A populated self-copy can invalidate the original iterator.
            args = n % 3 === 0 ? [s, h] : [h, n % 2 === 0 ? alias : s];
            break;
          case 0x21a:
            args = [h, [-1, 0, 1, 2, 3, 256][n % 6], [-1, 0, 1, 2, 3, 256][(n + 1) % 6]];
            break;
        }
        await run(spec, args);
      }
    if (spec.id === 0x219) {
      await reset();
      for (const fixture of [raw, f])
        await fixture.memory.call(
          fixture.memory.layout.clearAttributes,
          [],
          await fixture.memory.pointer(h),
        );
      await run(spec, [h, h]);
    }
    if (spec.id === 0x21a)
      for (const bpp of [3, 4]) {
        await reset(bpp);
        for (const fixture of [raw, f]) {
          const pointer = fixture.process.load(pointers.get(h));
          fixture.process.store(pointer + 28, 0);
          fixture.process.store(pointer + 32, 0);
        }
        await run(spec, [h, 0, 0]);
      }
    await reset();
    raw.machine.nativeArgumentBase = f.machine.nativeArgumentBase = 7000;
    const adjacent =
      spec.id === 0x73 || spec.id === 0x74
        ? [h, 0, 0, 4, 3, s, 0, 0, 4, 3]
        : spec.id === 0x78
          ? [h, 768, 2, 832]
          : spec.id === 0x218
            ? [h, 7, 512, 516, 520, 524, 528]
            : spec.id === 0x219
              ? [h, alias]
              : spec.id === 0x21a
                ? [h, 1, 2]
                : [h, 832];
    for (const fixture of [raw, f]) {
      fillWords(fixture.machine, 7000, adjacent);
      fillWords(fixture.machine, 768, [s, 0, 0, alias, 1, 1]);
      fillWords(fixture.machine, 832, [0, 0, 4, 3]);
    }
    // Compare a complete raw argument frame with a GCALL that supplies no
    // declared words and must read its still-mapped adjacent stack frame.
    for (const fixture of [raw, f]) fixture.allocationByte = spec.id === 0x21a ? 0xa7 : null;
    const expected = await original(spec, adjacent),
      actual = await f.commands.apply(spec.id, [], f.machine, { id: 1 });
    for (const fixture of [raw, f]) fixture.allocationByte = null;
    calls++;
    covered.set(spec.id, (covered.get(spec.id) ?? 0) + 1);
    check(actual, expected, 'adjacent native argument frame');
    check(f.machine.memory, raw.machine.memory, 'adjacent whole VM');
    for (const handle of [h, s, alias])
      check(bitmapState(f, handle), bitmapState(raw, handle), 'adjacent original image bytes');
  }
  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    covered: Object.fromEntries([...covered].map(([id, n]) => [id.toString(16), n])),
    scope:
      'Seven complete original image wrappers. Raw reference keeps original raster execution; host side uses independently verified raster kernels. Both bitmap representations, source/destination/self aliases, BPP2/3/4, offsets, clipping, raw alpha/blend metadata, full native row bytes, attributes, four VM domains, source guards and output canaries are compared. Filter calls explicitly supply matching zero/A7 HeapAlloc bytes because the original BPP3 horizontal pass leaves most scratch channels unwritten; actual production heap contents are retained. Main73 screen upload is an explicit boundary here; full-view GPU is separate.',
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Image commands passed ${calls} calls/${comparisons} comparisons`);
} finally {
  await f.engine.close();
  await raw.engine.close();
}
