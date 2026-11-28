// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  inspectNativeTables,
  inspectHandler,
  parseDisassembly,
  extractNativeABI,
} from '../scripts/extract-native-abi.mjs';
import { readPE, sources } from '../scripts/native-audit.mjs';

function fixture() {
  const bytes = Buffer.alloc(0x2600);
  bytes.write('MZ');
  bytes.writeUInt32LE(0x80, 60);
  bytes.write('PE\0\0', 0x80);
  bytes.writeUInt16LE(0x14c, 0x84);
  bytes.writeUInt16LE(2, 0x86);
  bytes.writeUInt16LE(224, 0x94);
  bytes.writeUInt16LE(0x10b, 0x98);
  bytes.writeUInt32LE(0x400000, 0xb4);
  for (const [i, name, rva, raw, size, flags] of [
    [0, '.text', 0x1000, 0x200, 0x400, 0x60000020],
    [1, '.data', 0x8000, 0x600, 0x2000, 0xc0000040],
  ]) {
    const at = 0x178 + i * 40;
    bytes.write(name, at);
    bytes.writeUInt32LE(size, at + 8);
    bytes.writeUInt32LE(rva, at + 12);
    bytes.writeUInt32LE(size, at + 16);
    bytes.writeUInt32LE(raw, at + 20);
    bytes.writeUInt32LE(flags, at + 36);
  }
  for (const [at, count] of [
    [0x600, 256],
    [0xb00, 45],
    [0xc00, 44],
    [0xcb8, 51],
  ])
    for (let i = 0; i < count; i++) bytes.writeUInt32LE(0x401000 + (i % 8) * 16, at + 4 * i);
  return bytes;
}

test('static table discovery uses writable structures, handles aliases and relocates', () => {
  const bytes = fixture(),
    found = inspectNativeTables(bytes);
  assert.equal(found.status, 'candidate');
  assert.deepEqual(
    found.tables.map((t) => [t.name, t.count]),
    [
      ['main', 256],
      ['generic', 45],
      ['particle-v1', 44],
      ['particle-v2', 51],
    ],
  );
  assert.equal(found.tables[0].distinctHandlers, 8);
  assert.equal(found.tables[0].entries[3].handlerVA, '0x00401030');
  const moved = Buffer.from(bytes);
  moved.writeUInt32LE(0x500000, 0xb4);
  for (const table of found.tables)
    for (const entry of table.entries) {
      const pe = readPE(bytes),
        at = pe.offset(Number(table.tableVA) + entry.id * 4);
      moved.writeUInt32LE(Number(entry.handlerVA) + 0x100000, at);
    }
  assert.equal(inspectNativeTables(moved).tables[0].tableVA, '0x00508000');
});

test('ambiguous, malformed and wrapped images never yield an accepted table', () => {
  const bytes = fixture();
  for (let i = 0; i < 45; i++) bytes.writeUInt32LE(0x401000, 0x1200 + 4 * i);
  assert.equal(inspectNativeTables(bytes).status, 'needs-review');
  const wrapped = fixture();
  wrapped.fill(0, 0x1a0, 0x1a8);
  wrapped.write('.bind', 0x1a0);
  assert.equal(inspectNativeTables(wrapped).status, 'needs-unwrapped-sample');
  assert.deepEqual(inspectNativeTables(wrapped).tables, []);
  assert.throws(() => inspectNativeTables(Buffer.from('MZ')), /bounds|offset|buffer/i);
  const truncated = fixture();
  truncated.writeUInt32LE(0xffffff, 0x1b0);
  assert.throws(() => inspectNativeTables(truncated), /exceeds/);
});

test('bounded CFG retains both return controls and reports argument reads as partial', () => {
  const instructions = parseDisassembly(`
  401000: 8b 44 24 0c     mov eax,DWORD PTR [esp+0xc]
  401004: 8b 48 08        mov ecx,DWORD PTR [eax+0x8]
  401007: 85 c9           test ecx,ecx
  401009: 74 07           je 0x401012
  40100b: b8 01 00 00 00  mov eax,0x1
  401010: c3              ret
  401012: 33 c0           xor eax,eax
  401014: c3              ret
`);
  const bytes = fixture(),
    result = inspectHandler(bytes, readPE(bytes), instructions, 0x401000);
  assert.equal(result.complete, true);
  assert.equal(result.signature.parameters, null);
  assert.deepEqual(result.signature.directArgumentByteOffsets, [8]);
  assert.deepEqual(result.signature.controlCodes, [0, 1]);
  assert.equal(result.signature.controlsComplete, true);
  const tail = parseDisassembly('401000: e9 fb ff 00 00 jmp 0x411000');
  assert.equal(inspectHandler(bytes, readPE(bytes), tail, 0x401000).complete, false);
});

test(
  'two reviewed private ABIs agree with address-independent extraction in extended mode',
  {
    skip: process.env.ABI_SURVEY_EXTENDED !== '1',
  },
  async () => {
    const root = process.env.ABI_SURVEY_FIXTURE_ROOT;
    assert.ok(root, 'ABI_SURVEY_FIXTURE_ROOT is required in extended mode');
    for (const source of sources) {
      const path = `${root}/${source.path}`,
        bytes = await readFile(path);
      const found = await extractNativeABI(path);
      assert.equal(found.sha256, source.sha256);
      assert.equal(found.status, 'candidate');
      for (const table of found.tables) {
        assert.equal(Number(table.tableVA), source.tables[table.name]);
        assert.equal(table.count, source.counts[table.name]);
        const pe = readPE(bytes);
        for (const entry of table.entries)
          assert.equal(
            Number(entry.handlerVA),
            bytes.readUInt32LE(pe.offset(Number(table.tableVA) + entry.id * 4)),
          );
      }
    }
  },
);
