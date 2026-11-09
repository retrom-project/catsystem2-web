// SPDX-License-Identifier: MPL-2.0
// Complete original 1CC wrapper, selector/path grammar, metadata/decode,
// CPU composition and wrapper/bitmap destruction. No image-factory stub.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { authoredHG3 } from '../tests/fixtures/hg3.mjs';
import {
  imageCompositeFixture,
  originalBitmap,
} from '../tests/fixtures/image-composite-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-image-composite.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Composite oracle requires a frozen engine');
const raw = await imageCompositeFixture(bytes, profile),
  f = await imageCompositeFixture(bytes, profile),
  a = raw.machine,
  b = f.machine,
  block = a.allocate(1024),
  other = b.allocate(1024),
  sources = [
    '',
    'missing.hg3',
    'broken.hg3',
    'probe.hg2',
    'single.hg3',
    'rgb.hg3',
    'x,1.hg3',
    'x,1,2.hg3',
    'x,1,2,3.hg3',
    'x,0,2.hg3',
    'x,1,0,3.hg3',
    'x,0,0.hg3',
    'x,12,23.hg3',
    'x,1,,3.hg3',
    'x,,2.hg3',
    'x,1,9.hg3',
    'x,9,2.hg3',
    'x,0,2,3.hg3',
    'x,1,2,0.hg3',
    'x,1,2,0,0,0.hg3',
    'abc,1,2.hg3',
    'x,"1",2.hg3',
    'x, 1,2.hg3',
    'x,-1,2.hg3',
    'single.hg3:1',
    'dir/x,1,2.hg3',
    'x,' + new Array(64).fill('0').join(',') + '.hg3',
  ],
  check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  put = (at, source) => {
    const value = source instanceof Uint8Array ? source : encodeCP932(source);
    for (const m of [a, b]) m.bytes(at, value.length + 1).set([...value, 0]);
    return at;
  },
  allocations = (p) => [...p.allocations].map(([at, size]) => [at, size, p.read(at, size)]);
let calls = 0,
  comparisons = 0,
  produced = 0;
check(block, other, 'same extended VM block');
check(
  raw.process.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 0x1cc * 4),
  raw.layout.handler,
  'independent frozen slot',
);

async function run(args, clearStack = true) {
  const words = args.length ? [...args] : [a.nativeArgument(0)],
    p = raw.process,
    host = p.allocate(120, true),
    bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(12);
  let control, result;
  raw.requests.length = f.requests.length = 0;
  if (clearStack)
    for (const fixture of [raw, f]) fixture.process.zero(fixture.process.stackTop - 0x6000, 0x6000);
  try {
    p.store(host + 116, raw.view);
    words.forEach((word, i) => p.store(argv + i * 4, word));
    p.write(out, new Uint8Array(12).fill(0xcc));
    control = await raw.engine.call(raw.layout.handler, [bridge.pointer, host, argv, out + 4]);
    result = p.read(out, 12);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
    p.free(host);
  }
  const reply = await f.composites.apply(0x1cc, args, b, { id: 1 }),
    value = new DataView(result.buffer).getUint32(4, true),
    wrapper = reply.value ? await f.memory.wrapper(reply.value) : 0;
  check(reply.control, control, 'complete original control');
  check(wrapper, value, 'actual wrapper identity behind the typed bitmap');
  check(
    [result[0], result[1], result[2], result[3], ...result.subarray(8)],
    new Array(8).fill(0xcc),
    'output canaries',
  );
  check(b.memory, a.memory, 'whole VM data/stack');
  check(b.shared, a.shared, 'whole shared data');
  check(b.blocks, a.blocks, 'all extended blocks');
  check(f.requests, raw.requests, 'actual file candidate order and profile path encoding');
  check(
    originalBitmap(f.process, wrapper),
    originalBitmap(p, value),
    'complete original bitmap metadata and physical row bytes',
  );
  check(allocations(f.process), allocations(p), 'all original live allocations and bytes');
  check(f.factories.refs.contexts.size, 0, '1CC does not create a Script automatic list');
  if (value) {
    produced++;
    check(
      f.process.load(wrapper + f.layout.wrapperReferences),
      1,
      'the original single wrapper reference is adopted',
    );
    check(f.images.get(reply.value).owner, null, 'no invented Script ownership');
    await raw.buffers.releaseBitmapPointer(value);
    await f.images.release(reply.value);
    check(allocations(f.process), allocations(p), 'original wrapper/bitmap/pixel destruction');
    check(f.process.allocations.has(wrapper), false, 'wrapper reference reaches zero');
  }
  calls++;
  return { value: !!reply.value, requests: [...f.requests] };
}
try {
  for (let seed = 0; seed < 8; seed++) {
    for (const fixture of [raw, f]) {
      for (const [index, initial] of fixture.frames.entries()) {
        const frame = {
          ...initial,
          offsetX: ((seed + index) % 4) - 1,
          offsetY: (seed * 3 + index) % 3,
          baseX: seed - index,
          baseY: index - seed,
          bpp: (seed + index) % 3 ? 32 : 24,
          rgba: Uint8Array.from(initial.rgba, (value, at) =>
            at % 4 === 3
              ? [0, 1, 127, 128, 254, 255][(seed + index) % 6]
              : (value + seed * 23) & 255,
          ),
        };
        fixture.files.set(`x_${'0'.repeat(index)}${index + 1}.hg3`, authoredHG3([frame]));
      }
    }
    for (const at of [0, 512, 4608, 0x80000020, block + 32])
      for (const source of sources) await run([put(at, source)]);
  }
  for (const at of [0, 0x80000020, block + 32])
    for (const source of [
      Uint8Array.of(0x82, 0xff, 0x41),
      new TextEncoder().encode('日本語.hg3'),
      Uint8Array.of(120, 44, 255, 46, 104, 103, 51),
    ])
      await run([put(at, source)]);
  for (const fixture of [raw, f]) fixture.files.set('item_07.hg3', fixture.files.get('single.hg3'));
  put(512, 'item_%02d[G16].hg3');
  a.store(16, 7);
  b.store(16, 7);
  check((await run([512])).value, true, 'original integer formatter');
  put(512, '%s[H32]');
  put(0x80000020, 'single.hg3');
  check((await run([512])).value, true, 'original recursive shared formatter');
  for (const m of [a, b]) {
    m.nativeArgumentBase = 2048;
    m.store(2048, 512);
  }
  await run([]);
  // The game helper reads a narrow basename as UTF-16. Its overread can see
  // previous local stack bytes. Match that history without patching helpers.
  await run([put(512, 'single.hg3')]);
  await run([put(512, 'x,1,2.hg3')], false);
  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    produced,
    original: raw.layout,
    boundaries: [
      'Mounted category resolution/IFile opener',
      'Authored initialized view without a file cache',
      'Explicit zero caller stack for case isolation; one retained-history pair',
    ],
    coverage:
      'Complete original wrapper, extension/selector grammar, HG2/HG3 metadata and decode, two-pass multi-layer CPU composition, reference counts, typed handle adoption, no automatic list, exact physical pixels, whole VM/heap/canaries and original destruction',
    notCovered: [
      '2BF/2C0 render-source arrays',
      'Full initialized-view cache and fresh World are tested separately',
    ],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Image composite passed ${calls} calls/${comparisons} comparisons/${produced} produced wrappers`,
  );
} finally {
  await f.engine.close();
  await raw.engine.close();
}
