// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_IMAGE_OWNER_CONTRACTS } from '../src/native/image-owner.mjs';
import { imageOwnerFixture, imageOwnerFiles } from '../tests/fixtures/image-owner-fixture.mjs';
import { contentAllocations } from '../tests/fixtures/content-databases-fixture.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { floatBits } from '../src/kcs.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-image-owners.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (key) => NATIVE_ENGINE_IMAGES[key].sha256 === sha256,
  );
if (!profile) throw new Error('Image-owner proof requires a frozen engine');
const files = await imageOwnerFiles(),
  raw = await imageOwnerFixture(bytes, profile, files),
  f = await imageOwnerFixture(bytes, profile, files),
  a = raw.machine,
  b = f.machine,
  p = raw.process,
  byID = new Map(NATIVE_IMAGE_OWNER_CONTRACTS.map((spec) => [spec.id, spec])),
  pointers = new Map(),
  covered = new Map();
let comparisons = 0,
  calls = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const put = (value, address = 256) => {
  const bytes = typeof value === 'string' ? encodeCP932(value) : value;
  for (const m of [a, b]) m.writeStringBytes(bytes, address);
};
const blockA = a.allocate(2048),
  blockB = b.allocate(2048);
check(blockA, blockB, 'VM extended region identity');
async function run(id, args, owner = 1) {
  calls++;
  covered.set(id, (covered.get(id) ?? 0) + 1);
  const spec = byID.get(id),
    create = id === 0x2c6 || id === 0x2dd,
    draw = id === 0x2db || id === 0x2dc,
    words = Array.from(args);
  while (!words.length) words.push(a.nativeArgument(0));
  let count = spec.words;
  if (!create && !draw && !words[0] && ![0x2d5, 0x2de, 0x2df, 0x2e0].includes(id)) count = 1;
  if (id === 0x2e0 && !words[0]) count = 5;
  if (id === 0x2de || id === 0x2df) {
    while (words.length < 6) words.push(a.nativeArgument(words.length));
    if (!words[5]) count = 6;
  }
  while (words.length < count) words.push(a.nativeArgument(words.length));
  const handle = words[0];
  if (draw) words[2] = pointers.get(words[2]) ?? 0;
  else if (!create) {
    if (id !== 0x2d5 || (words[0] && words[1])) {
      words[0] = pointers.get(words[0]) ?? 0;
      if (id === 0x2d5) words[1] = pointers.get(words[1]) ?? 0;
    }
    if (id === 0x2de || id === 0x2df) words[5] = pointers.get(words[5]) ?? 0;
  }
  const host = await raw.images.context({ id: owner, machine: a }),
    bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(4),
    packetHost = draw ? p.allocate(160) : 0;
  let control, value;
  try {
    words.forEach((word, i) => p.store(argv + i * 4, word));
    p.store(out, 0xcccccccc);
    if (draw) {
      p.write(packetHost, p.read(host, 160));
      p.store(packetHost, raw.images.vtable);
    }
    control = await raw.images.call(
      spec.handlers[Number(profile.startsWith('sdk-'))],
      [bridge.pointer, packetHost || host, argv, out],
      undefined,
      owner,
    );
    value = p.load(out);
  } finally {
    bridge.close();
    if (packetHost) p.free(packetHost);
    p.free(out);
    p.free(argv);
  }
  const reply = await f.images.apply(id, args, b, { id: owner });
  check(reply.control, control, `control ${id.toString(16)}`);
  if (create) {
    check(!!reply.value, !!value, 'constructor result');
    if (value) {
      pointers.set(reply.value, value);
      check(f.images.pointer(reply.value), value, 'owner identity');
    }
  } else if (control === 1) check(reply.value, value, 'result');
  if (id === 0x2c7) pointers.delete(handle);
  check(b.memory, a.memory, 'whole VM data/stack');
  check(b.shared, a.shared, 'shared');
  check(b.blocks, a.blocks, 'extended blocks');
  check(f.messages, raw.messages, 'original draw packet bytes');
  check(f.uploads, raw.uploads, 'VRAM boundary payload');
  check(contentAllocations(f.process), contentAllocations(p), 'all live original allocations');
  return reply.value;
}
async function load(name = 'probe.hg2', owner = 1) {
  put(name);
  return run(0x2c6, [256], owner);
}
try {
  for (const spec of byID.values()) {
    if ([0x2c6, 0x2dd, 0x2db, 0x2dc].includes(spec.id)) continue;
    const args =
      spec.id === 0x2d5
        ? [0, 0]
        : spec.id === 0x2e0
          ? [0, 1, 2, 3, 4]
          : spec.id === 0x2de || spec.id === 0x2df
            ? [0, 0, 0, 0, 0, 0]
            : [0];
    await run(spec.id, args);
  }
  for (const name of ['missing.hg2', 'empty.hg2', 'broken.hg2', '']) await load(name);
  await run(0x2d5, [0, 0x41414141]);
  await run(0x2d5, [0x41414141, 0]);
  for (const name of [
    'attr.hg3',
    'anim.hg2',
    'composite,1,2.hg2',
    'composite,0,2.hg2',
    'composite,1,0.hg2',
  ]) {
    const h = await load(name);
    if (['attr.hg3', 'anim.hg2', 'composite,1,2.hg2'].includes(name))
      check(!!h, true, 'original image/animation/composite load ' + name);
    if (!h) continue;
    for (const id of [0x2c8, 0x2ca, 0x2cb, 0x2cd]) await run(id, [h, 768, 772]);
    for (const index of [0, 7, 0x10007, 8, 0xffffffff]) {
      for (const m of [a, b]) m.bytes(768, 24).fill(0xa5);
      const result = await run(0x2d4, [h, index, 768, 772, 776, 780, 784]);
      if (name === 'attr.hg3' && (index & 0xffff) === 7) {
        check(result, 1, 'attribute found');
        check(
          Array.from({ length: 5 }, (_, i) => b.load(768 + i * 4)),
          [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123],
          'attribute payload',
        );
        check(b.load(788), 0xa5a5a5a5, 'attribute tail retained');
      }
    }
    for (const id of [0x2ce, 0x2cf, 0x2d0]) await run(id, [h, 1, 2]);
    await run(0x2e1, [h, 1]);
    await run(0x2c7, [h]);
  }
  for (const dims of [
    [0, 0],
    [1, 1],
    [4, 3],
    [7, 5],
  ]) {
    const h = await run(0x2dd, dims);
    for (const id of [0x2c8, 0x2ca, 0x2cb, 0x2cd]) await run(id, [h, 768, 772]);
    await run(0x2d1, [h]);
    await run(0x2e0, [h, 0, 0, dims[0], dims[1], 0xff2b537b]);
    await run(0x2c7, [h]);
  }
  for (let round = 0; round < 5; round++) {
    const h = await load(),
      other = await load('second.hg2');
    for (const address of [768, a.data.length + 64, 0x80000020, blockA + 64]) {
      for (const m of [a, b]) m.bytes(address, 100).fill(0xa5);
      for (const id of [0x2c8, 0x2ca, 0x2cb, 0x2cd]) await run(id, [h, address, address + 4]);
      for (const index of [0, 1, 2, 0xffffffff])
        await run(0x2d4, [h, index, address, address + 4, address + 8, address + 12, address + 16]);
    }
    for (const id of [0x2ce, 0x2cf, 0x2d0]) {
      for (const pair of [
        [0, 0],
        [2, 1],
        [0xffffffff, 0xfffffffe],
        [4, 3],
      ])
        await run(id, [h, ...pair]);
    }
    for (const value of [0, 1, 2, 3, 127, 255, 256, 0xffffffff]) {
      await run(0x2d2, [h, value]);
      await run(0x2d8, [h, value]);
      await run(0x2d1, [h]);
    }
    for (const value of [0, 128, 255, 0xff204060]) await run(0x2e0, [h, 0, 0, 2, 2, value]);
    for (const values of [
      [100, 100, 100],
      [0, 100, 100],
      [100, 0, 100],
      [100, 100, 0],
      [50, 120, 200],
    ])
      await run(0x2c9, [h, ...values]);
    for (const value of [0, 1, 128, 255]) {
      await run(0x2cc, [h, value]);
      await run(0x2d3, [h, value]);
      await run(0x2d9, [h, value]);
    }
    for (const angle of [90, 180, 270]) await run(0x2d3, [h, angle]);
    for (const pair of [
      [0, 0],
      [3, 2],
      [255, 0],
      [0xffffffff, 1],
    ])
      await run(0x2da, [h, ...pair]);
    for (const value of [1, 2, 3, 0, 0xffffffff]) await run(0x2e1, [h, value]);
    for (const target of [other, h]) {
      await run(0x2d5, [target, h]);
      for (const rect of [
        [0, 0, 2, 2],
        [1, 1, 2, 1],
        [0, 0, 4, 3],
      ]) {
        for (const id of [0x2de, 0x2df])
          await run(id, [target, 0, 0, rect[2], rect[3], h, ...rect]);
      }
    }
    for (const id of [0x2db, 0x2dc])
      for (const target of [0, 12, 0xffffffff])
        await run(id, [
          target,
          round,
          h,
          floatBits(3),
          floatBits(-2),
          floatBits(0),
          floatBits(0),
          0,
          floatBits(1),
          floatBits(1),
          300,
          1,
          1,
        ]);
    for (const id of [0x2d6, 0x2d7]) await run(id, id === 0x2d6 ? [h, 2, 2] : [h, 2]);
    await run(0x2d7, [h, 0]);
    await run(0x2c7, [h]);
    await run(0x2c7, [other]);
  }
  put('probe.hg2');
  const retained = await run(0x2c6, [256], 7),
    pointer = pointers.get(retained);
  for (const process of [p, f.process]) process.store(pointer, 2);
  a.nativeArgumentBase = b.nativeArgumentBase = 7000;
  for (const m of [a, b]) m.store(7000, retained);
  await run(0x2c7, [], 7);
  check(f.process.load(pointer), 1, 'external reference survives Script release');
  await raw.images.call(raw.images.releaseAddress, [], pointer, 7);
  await f.images.call(f.images.releaseAddress, [], pointer, 7);
  check(f.process.allocations.has(pointer), false, 'last retained reference destroys owner');
  const leaked1 = await load('probe.hg2', 11),
    leaked2 = await load('second.hg2', 11);
  check(!!leaked1 && !!leaked2, true, 'Script resource fixtures');
  await raw.images.releaseOwner(11);
  await f.images.releaseOwner(11);
  check(
    contentAllocations(f.process),
    contentAllocations(p),
    'Script reload destroys owned list entries',
  );
  await load('probe.hg2', 11);
  await raw.images.releaseOwner(11, { dispose: true });
  await f.images.releaseOwner(11, { dispose: true });
  check(contentAllocations(f.process), contentAllocations(p), 'Script close destroys list');
  check(
    [...covered.keys()].sort((a, b) => a - b),
    [...byID.keys()].sort((a, b) => a - b),
    'every family wrapper',
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        coverage: [...covered].map(([id, calls]) => ({ id, calls })),
        scope:
          'Complete original image-owner wrappers, decoder, CPU operations, HG3 attributes, single/two-layer ANM composition, original allocations and Script list ownership. Authored outer-view record has no device/cache state. VRAM upload/clear and task routing are explicit platform boundaries, not graphics-init or rendered-pixel acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ profile, calls, comparisons }));
} finally {
  await raw.engine.close();
  await f.engine.close();
}
