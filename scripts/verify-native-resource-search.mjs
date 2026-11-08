// SPDX-License-Identifier: MPL-2.0
// Runs the original resource search dispatcher. Only physical file/archive
// open, archive membership, and their descriptor ownership cross the boundary.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { nativeUpdatePriority } from '../src/native/resource-search.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-resource-search.mjs EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Resource search requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  abi = sdk
    ? {
        open: 0x4b22c0,
        loose: 0x4b3320,
        archive: 0x4b4ef0,
        membership: 0x4b40b0,
        slotBytes: 304,
        dir: 1064,
        exists: 1324,
        groups: 0x13504,
        overrides: 0x13508,
        groupRows: 40,
        rowSlot: 40,
        rowDirectory: 44,
        rowExists: 108,
      }
    : {
        open: 0x5d57a0,
        loose: 0x5d6d20,
        archive: 0x5d8850,
        membership: 0x5d79c0,
        slotBytes: 604,
        dir: 1104,
        exists: 1624,
        groups: 156168,
        overrides: 156172,
        groupRows: 72,
        rowSlot: 72,
        rowDirectory: 76,
        rowExists: 204,
      },
  engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  owner = p.allocate(0x30000, true),
  source = p.allocate(1024, true),
  descriptors = new Map(),
  readers = new Map(),
  results = [];
const normalize = (name) => name.replaceAll('\\', '/').toLowerCase(),
  physical = new Map([
    ['same.bin', 100],
    ['loose-a/same.bin', 101],
    ['loose-b/same.bin', 102],
    ['list-a/same.bin', 111],
    ['list-b/same.bin', 112],
    ['list-b/only-b.bin', 113],
  ]),
  archiveFiles = [
    new Map([
      ['same.bin', 11],
      ['only-a.bin', 12],
    ]),
    new Map([
      ['same.bin', 21],
      ['only-b.bin', 22],
    ]),
    new Map([['same.bin', 31]]),
  ];
const writeString = (at, value) => {
    if (sdk) p.write(at, encodeCP932(value + '\0'));
    else {
      const data = new Uint8Array((value.length + 1) * 2),
        view = new DataView(data.buffer);
      for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
      p.write(at, data);
    }
  },
  list = (nodes) => {
    const container = p.allocate(8, true),
      sentinel = p.allocate(16, true);
    p.store(container, sentinel);
    p.store(container + 4, nodes.length);
    p.store(sentinel, nodes[0] ?? sentinel);
    p.store(sentinel + 4, nodes.at(-1) ?? sentinel);
    for (let i = 0; i < nodes.length; i++) {
      p.store(nodes[i], nodes[i + 1] ?? sentinel);
      p.store(nodes[i] + 4, nodes[i - 1] ?? sentinel);
    }
    return container;
  };
const read = (at) => p.string(at, !sdk);
let attempts = [];
const vtable = p.allocate(8, true),
  destructor = p.trap('authored file destructor', 1, ([flags]) => {
    const at = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
    descriptors.delete(at);
    if (flags & 1) p.free(at);
    return at;
  }),
  open = p.trap('authored physical file or archive entry', 2, ([name, flags]) => {
    assert.equal(flags, 257);
    const at = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
      descriptor = descriptors.get(at),
      path = normalize(read(name));
    attempts.push([descriptor.archive, path]);
    descriptor.value =
      descriptor.archive === -1 ? physical.get(path) : archiveFiles[descriptor.archive].get(path);
    return Number(descriptor.value !== undefined);
  });
p.store(vtable, destructor);
p.store(vtable + 4, open);
engine.patch(
  abi.loose,
  'authored physical IFile constructor',
  0,
  () => {
    const at = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
    p.store(at, vtable);
    descriptors.set(at, { archive: -1 });
    return at;
  },
  { calleePops: true },
);
engine.patch(
  abi.archive,
  'authored archive IFile constructor',
  1,
  ([reader]) => {
    const at = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
    p.store(at, vtable);
    descriptors.set(at, { archive: readers.get(reader) });
    return at;
  },
  { calleePops: true },
);
engine.patch(
  abi.membership,
  'authored override archive membership',
  1,
  ([name]) => {
    const at = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
    return Number(archiveFiles[readers.get(at)].has(normalize(read(name))));
  },
  { calleePops: true },
);
for (const [index, name, directory] of [
  [0, 'a.int', 'loose-a'],
  [1, 'b.int', 'loose-b'],
]) {
  const reader = p.allocate(128, true);
  p.store(reader + 8, 1);
  writeString(reader + 20, name);
  readers.set(reader, index);
  p.store(owner + index * 4, reader);
  writeString(owner + 1024 + index * abi.slotBytes, name);
  writeString(owner + abi.dir + index * abi.slotBytes, directory);
  p.store(owner + abi.exists + index * abi.slotBytes, 1);
}
const rows = [0, 1].map((index) => {
    const row = p.allocate(224, true);
    writeString(row + 8, index ? 'b.int' : 'a.int');
    p.store(row + abi.rowSlot, index);
    writeString(row + abi.rowDirectory, index ? 'list-b' : 'list-a');
    p.store(row + abi.rowExists, 1);
    return row;
  }),
  group = p.allocate(96, true);
writeString(group + 8, 'images.lst');
p.store(group + abi.groupRows, list(rows));
p.store(owner + abi.groups, list([group]));
const overrideReader = p.allocate(128, true),
  overrideNode = p.allocate(12, true),
  emptyOverrides = list([]),
  overrides = list([overrideNode]);
readers.set(overrideReader, 2);
p.store(overrideNode + 8, overrideReader);
try {
  for (const override of [false, true]) {
    p.store(owner + abi.overrides, override ? overrides : emptyOverrides);
    for (const mode of [0, 1, 2, 3, 4, 5])
      for (const path of [
        'same.bin',
        'only-a.bin',
        'a.int/same.bin',
        'a.int/only-b.bin',
        'b.int/same.bin',
        'images.lst/same.bin',
        'images.lst/only-b.bin',
        'missing.int/same.bin',
        'loose-a/same.bin',
      ]) {
        writeString(source, path);
        attempts = [];
        const pointer = await engine.call(abi.open, [source, mode], owner),
          value = pointer ? descriptors.get(pointer)?.value : null;
        if (pointer) await engine.call(destructor, [1], pointer);
        assert.equal(descriptors.size, 0);
        results.push({ override, mode, path, value, attempts });
      }
  }
  const priorityStart = sdk ? 0x43e8b4 : 0x52c4a0,
    priorityEnd = sdk ? 0x43e92b : 0x52c51c,
    wrapper = 0x02000000,
    frameBytes = 0x7000;
  p.map(wrapper, 4096, 'authored resource priority caller', p.uc.PROT_ALL);
  const code = new Uint8Array(18),
    cv = new DataView(code.buffer);
  code.set([0x81, 0xec]);
  cv.setUint32(2, frameBytes, true);
  code[6] = 0xe8;
  cv.setInt32(7, priorityStart - (wrapper + 11), true);
  code.set([0x81, 0xc4], 11);
  cv.setUint32(13, frameBytes, true);
  code[17] = 0xc3;
  p.write(wrapper, code);
  let priorityName;
  const stopPriority = p.beforeInstruction(priorityStart, 'authored update filename input', () => {
    const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
    writeString(sp + (sdk ? 0x8c : 0xc4), priorityName);
  });
  engine.patch(
    priorityEnd,
    'authored update priority output',
    0,
    () => p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
  );
  const priorities = [];
  try {
    for (const suffix of [
      ...Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0')),
      '1x',
      'a1',
      'zz',
      '0x',
      '-1',
    ]) {
      priorityName = `update${suffix}.INT`;
      const value = await engine.call(wrapper);
      assert.equal(value, nativeUpdatePriority(priorityName));
      priorities.push({ name: priorityName, value });
    }
  } finally {
    stopPriority();
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        scope:
          'Complete original resource dispatcher with synthetic native slots/list links. Physical loose/archive open and archive-membership boundaries only; cache disabled, alias map empty.',
        results,
        priorities,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original resource search ${results.length} cases`);
} finally {
  await engine.close();
}
