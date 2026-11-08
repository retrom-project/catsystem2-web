// SPDX-License-Identifier: MPL-2.0
// Execute selected CG functions from a private, fixed EXE. CRT allocation/copy
// services are supplied by the harness. No game entrypoint or CG function is
// replaced. The executable and raw resulting records remain outside Git.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Binary } from '../src/binary.mjs';
import { CGRegistry, CGGallery, parseCGReference, readCGList } from '../src/gallery.mjs';
import { registerNativeCG } from '../src/native/gallery.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

const [exe, output, ...lists] = process.argv.slice(2);
if (!exe || !output)
  throw new Error(
    'Usage: node scripts/verify-native-gallery.mjs FIXED_EXE IGNORED_REPORT [CGL_FILES...]',
  );
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
const redirect = (at, name, count, callback) => {
  const target = p.trap(name, 0, () => {
    const sp = p.cpu.reg_read_i32(u.X86_REG_ESP) >>> 0;
    return callback(Array.from({ length: count }, (_, i) => p.load(sp + 4 + i * 4)));
  });
  const bytes = new Uint8Array(5);
  bytes[0] = 0xe9;
  new DataView(bytes.buffer).setUint32(1, target - at - 5, true);
  p.write(at, bytes);
};
redirect(0x79ea57, 'operator new', 1, ([size]) => p.allocate(size, true));
redirect(0x6f81d0, 'free', 1, ([address]) => {
  p.free(address);
});
redirect(0x6a49d0, 'reference-counted heap allocation', 2, ([, size]) => p.allocate(size, true));
redirect(0x6a4b00, 'reference-counted heap release', 1, ([address]) => {
  p.free(address);
});
for (const at of [0x6a7210, 0x79d9c0, 0x79f2a0])
  redirect(at, 'memcpy/memmove', 3, ([d, s, n]) => {
    p.write(d, p.read(s, n));
    return d;
  });
const put = (data) => {
  const at = p.allocate(data.length, true);
  p.write(at, data);
  return at;
};
const string = (text) => put(Uint8Array.from([...encodeCP932(text), 0]));
const words = (values) => put(new Uint8Array(Uint32Array.from(values).buffer));
const context = p.allocate(16, true);
p.call(0x790ba0, [], context);
const registry = new CGRegistry(),
  cases = [];
const compare = (kind, actual, expected) => {
  assert.deepEqual(actual, expected, kind);
  cases.push({ kind, matched: true });
};
const raw = () => {
  const size = p.call(0x792270, [0], context),
    at = p.allocate(size, true);
  p.call(0x792270, [at], context);
  return p.read(at, size);
};
function authoredList(width) {
  const sections = [
    {
      id: 0,
      groups: [
        { name: 'First', variants: ['ea01,2,0,1', 'plain'] },
        { name: 'Last', variants: ['end,1'] },
      ],
    },
    { id: 7, groups: [{ name: 'Other', variants: ['more,3,1'] }] },
  ];
  const sizes = sections.map(
    (s) => 12 + s.groups.reduce((n, g) => n + 72 + g.variants.length * width, 0),
  );
  const data = new Uint8Array(sizes.reduce((a, b) => a + b, 0) + (width === 256 ? 4 : 0)),
    view = new DataView(data.buffer);
  let at = width === 256 ? 4 : 0;
  if (at) view.setUint32(0, 0x004c4743, true);
  sections.forEach((s, si) => {
    view.setUint32(at, si + 1 < sections.length ? sizes[si] : 0, true);
    view.setUint32(at + 4, s.id, true);
    view.setUint32(at + 8, s.groups.length, true);
    at += 12;
    s.groups.forEach((g, gi) => {
      view.setUint32(at, gi + 1 < s.groups.length ? 72 + g.variants.length * width : 0, true);
      data.set(encodeCP932(g.name), at + 4);
      view.setUint32(at + 68, g.variants.length, true);
      at += 72;
      for (const text of g.variants) {
        data.set(encodeCP932(text), at);
        at += width;
      }
    });
  });
  return data;
}
try {
  const sources = [
    'ea01,2,0,1',
    'ea01,,2,1,0',
    'plain',
    ',,',
    'ef01,1,23',
    'Japanese_名前,7,あ,い',
    'ea01L,2,1',
    'ea01l_2,3,0',
  ];
  for (let n = 0; n < 120; n++) sources.push(`f${n % 11},${n % 4},${n % 3},${n % 5}`);
  for (const source of sources) {
    for (const [at, variant] of [
      [0x791350, true],
      [0x7914a0, false],
    ]) {
      const file = p.allocate(1024, true),
        selectors = p.allocate(1024, true),
        count = p.allocate(4, true);
      const result = p.call(at, [string(source), file, selectors, count]);
      const ref = parseCGReference(source, variant);
      compare(
        `parse:${variant}:${source}`,
        result
          ? {
              file: p.string(file),
              selectors: Array.from(
                { length: p.load(count) },
                (_, i) => p.load(selectors + i * 4) | 0,
              ),
            }
          : null,
        ref,
      );
      if (variant && ref) {
        p.call(0x790ca0, [file, selectors, p.load(count)], context);
        registry.register(ref.file, ref.selectors);
        compare(`serialize:${source}`, raw(), registry.write());
        for (const suffix of [[], [0], [48], [1]]) {
          const probe = [...ref.selectors, ...suffix];
          compare(
            `query:${source}:${suffix}`,
            p.call(0x790e10, [file, words(probe), probe.length], context),
            Number(registry.has(ref.file, probe)),
          );
        }
      }
    }
  }
  const vm = p.allocate(348 * 4, true),
    memory = p.allocate(4096, true),
    result = p.allocate(4, true);
  p.store(vm + 20, memory);
  p.store(vm + 36, 4096);
  for (const source of ['ea02L,2,0,1', 'ea02l_2,3', 'abL_9', 'aaL_b', 'plain', 'ef02,2,1']) {
    p.write(memory + 16, Uint8Array.from([...encodeCP932(source), 0]));
    p.call(0x652e90, [vm, 0, words([context, 16]), result]);
    registerNativeCG(registry, source);
    compare(`native-registration:${source}`, raw(), registry.write());
  }
  const listInputs = [
    ...(await Promise.all(lists.map(async (file) => [file, new Uint8Array(await readFile(file))]))),
    ['authored64', authoredList(64)],
    ['authored256', authoredList(256)],
  ];
  for (const [file, data] of listInputs) {
    const gallery = new CGGallery(readCGList(data), registry);
    p.call(0x790ea0, [put(data), data.length], context);
    for (const group of gallery.list.groups) {
      const found = p.call(0x7927d0, [group.index], context);
      const indexed = gallery.group(group.index);
      compare(
        `group:${group.index}`,
        { name: p.string(found + 4), count: p.load(found + 68) },
        { name: indexed.name, count: indexed.variants.length },
      );
      compare(
        `named-index:${group.ordinal}`,
        p.call(0x791ca0, [group.section, string(group.name.toUpperCase())], context) | 0,
        gallery.index(group.name),
      );
      const named = p.call(0x792760, [group.section, string(group.name.toUpperCase())], context);
      compare(
        `named-group:${group.ordinal}`,
        p.string(named + 4),
        gallery.group(group.name, group.section).name,
      );
      for (const source of group.variants.slice(0, 3)) {
        const ref = parseCGReference(source, true);
        if (ref) {
          p.call(0x790ca0, [string(ref.file), words(ref.selectors), ref.selectors.length], context);
          registry.register(ref.file, ref.selectors);
        }
      }
      compare(
        `seen:${group.index}`,
        p.call(0x791660, [group.index], context),
        Number(gallery.seen(group.index)),
      );
      compare(
        `count:${group.index}`,
        p.call(0x791bb0, [group.index], context),
        gallery.variants(group.index, 0, true).length,
      );
      compare(
        `named-count:${group.ordinal}`,
        p.call(0x791ac0, [group.section, string(group.name)], context),
        gallery.variants(group.name, group.section, true).length,
      );
      for (const n of [0, 1, 3]) {
        const out = p.allocate(1024, true),
          ok = p.call(0x791940, [group.index, n, out], context);
        compare(`list:${group.index}:${n}`, ok ? p.string(out) : '', gallery.get(group.index, n));
      }
    }
    compare(`list-serialization:${file}`, raw(), registry.write());
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        sha256,
        scope:
          'Original CG parser/registration/query/serialization functions; allocation and byte-copy services supplied by harness',
        passed: cases.length,
        cases,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${cases.length}/${cases.length} native CG cases matched`);
} finally {
  p.close();
}
