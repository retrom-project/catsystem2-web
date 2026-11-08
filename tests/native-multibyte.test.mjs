// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { PPIWindowsServices } from '../src/ppi/native-services.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-multibyte-golden.json', import.meta.url)),
);
const documentedFlags = (cp, flags) =>
  cp === 65001 ? flags === 0 || flags === 8 : !(flags & ~15) && (flags & 3) !== 3;
async function fixture() {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new PPIWindowsServices(p),
    input = p.allocate(128),
    output = p.allocate(128),
    api = kernel.resolve({ dll: 'KERNEL32.dll', name: 'MultiByteToWideChar' });
  return { p, kernel, input, output, api };
}
test('MultiByteToWideChar reproduces documented CP932/UTF8 calls against full pinned-Wine output buffers', async () => {
  const { p, kernel, input, output, api } = await fixture();
  let compared = 0;
  try {
    for (const row of golden.cases) {
      // Wine accepts forbidden aliasing/flag combinations. Those Windows
      // contracts are verified separately against Microsoft's documented rule.
      if (row.alias || !documentedFlags(row.codePage, row.flags)) continue;
      const source = row.nullInput ? 0 : input,
        target = row.nullOutput ? 0 : output,
        bytes = Uint8Array.from([...Buffer.from(row.input, 'hex'), 0]);
      p.write(input, new Uint8Array(128).fill(0x5a));
      p.write(input, bytes);
      p.write(output, new Uint8Array(128).fill(0xa5));
      kernel.lastError = 0x12345678;
      const result = p.call(api, [
          row.codePage,
          row.flags,
          source,
          row.size >>> 0,
          target,
          row.capacity >>> 0,
        ]),
        label = `${row.codePage}/${row.flags}/${row.input}/${row.size}/${row.capacity}`;
      assert.equal(result, row.result, 'result/' + label);
      assert.equal(kernel.lastError, row.lastError, 'lastError/' + label);
      assert.deepEqual(
        p.read(output, 128),
        Uint8Array.from(Buffer.from(row.outputPrefix.padEnd(256, 'a5'), 'hex')),
        'all output/canary bytes/' + label,
      );
      const original = new Uint8Array(128).fill(0x5a);
      original.set(bytes);
      assert.deepEqual(p.read(input, 128), original, 'input remains read-only');
      compared++;
    }
    assert.equal(
      compared,
      golden.cases.filter((row) => !row.alias && documentedFlags(row.codePage, row.flags)).length,
    );
  } finally {
    p.close();
  }
});

test('all CP932 single bytes and lead/trail pairs match independent permissive and strict Win32 mapping records', async () => {
  const { p, kernel, input, output, api } = await fixture(),
    hash = createHash('sha256'),
    header = new Uint8Array(16),
    view = new DataView(header.buffer);
  let count = 0;
  try {
    for (const flags of [0, 8]) {
      const compare = (bytes) => {
        p.write(input, bytes);
        p.write(output, new Uint8Array(8).fill(0xa5));
        kernel.lastError = 0x12345678;
        const result = p.call(api, [932, flags, input, bytes.length, output, 4]);
        [result, kernel.lastError, p.load(output), p.load(output + 4)].forEach((value, i) =>
          view.setUint32(i * 4, value, true),
        );
        hash.update(header);
        count++;
      };
      for (let byte = 0; byte < 256; byte++) compare(Uint8Array.of(byte));
      for (let first = 0x81; first <= 0xfc; first++)
        if (first <= 0x9f || first >= 0xe0)
          for (let second = 0; second < 256; second++) compare(Uint8Array.of(first, second));
    }
    assert.equal(count, golden.mapping.cases);
    assert.equal(hash.digest('hex'), golden.mapping.sha256);
  } finally {
    p.close();
  }
});

test('Windows rejects aliased source/destination and forbidden UTF8 or mutually exclusive flags', async () => {
  const { p, kernel, input, output, api } = await fixture();
  try {
    p.write(input, [65, 66, 0]);
    for (const [cp, flags] of [
      [932, 3],
      [932, 7],
      [932, 16],
      [65001, 1],
      [65001, 2],
      [65001, 4],
      [65001, 9],
    ]) {
      p.write(output, new Uint8Array(128).fill(0xa5));
      assert.equal(p.call(api, [cp, flags, input, 2, output, 16]), 0);
      assert.equal(kernel.lastError, 1004);
      assert.deepEqual(p.read(output, 128), new Uint8Array(128).fill(0xa5));
    }
    for (const cp of [0, 1, 3, 932, 65001]) {
      assert.equal(p.call(api, [cp, 0, input, 2, input, 16]), 0);
      assert.equal(kernel.lastError, 87);
      assert.deepEqual([...p.read(input, 3)], [65, 66, 0]);
    }
  } finally {
    p.close();
  }
});

test('UTF8 single/pair space and three/four-byte boundary matrices match complete native conversion records', async () => {
  const { p, kernel, input, output, api } = await fixture(),
    hash = createHash('sha256'),
    header = new Uint8Array(16),
    view = new DataView(header.buffer),
    limits = [0, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xff];
  let count = 0;
  try {
    for (const flags of [0, 8]) {
      const compare = (bytes) => {
        p.write(input, bytes);
        p.write(output, new Uint8Array(8).fill(0xa5));
        kernel.lastError = 0x12345678;
        const result = p.call(api, [65001, flags, input, bytes.length, output, 4]);
        [result, kernel.lastError, p.load(output), p.load(output + 4)].forEach((value, i) =>
          view.setUint32(i * 4, value, true),
        );
        hash.update(header);
        count++;
      };
      for (let first = 0; first < 256; first++) compare(Uint8Array.of(first));
      for (let first = 0; first < 256; first++)
        for (let second = 0; second < 256; second++) compare(Uint8Array.of(first, second));
      for (let first = 0xe0; first <= 0xf5; first++)
        for (const second of limits)
          for (const third of limits) compare(Uint8Array.of(first, second, third));
      for (let first = 0xf0; first <= 0xf5; first++)
        for (const second of limits)
          for (const third of limits)
            for (const fourth of limits) compare(Uint8Array.of(first, second, third, fourth));
    }
    assert.equal(count, golden.utf8Mapping.cases);
    assert.equal(hash.digest('hex'), golden.utf8Mapping.sha256);
  } finally {
    p.close();
  }
});
