// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

test('USER32 cdecl and va_list formatting match 371 pinned Wine full-buffer results including truncation and 64-bit argument consumption', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/windows-format-golden.json', import.meta.url)),
    ),
    p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    output = p.allocate(4096),
    format = p.allocate(4096),
    args = p.allocate(16);
  try {
    assert.equal(golden.cases.length, 371);
    for (const row of golden.cases) {
      const allocations = [],
        words = row.args.map((value) => {
          if (typeof value === 'number') return value;
          const pointer = p.allocate(4096);
          allocations.push(pointer);
          kernel.writeString(pointer, value.text, value.wide);
          return pointer;
        });
      kernel.writeString(format, row.format, row.wide);
      p.zero(args, 16);
      words.forEach((value, i) => p.store(args + i * 4, value));
      try {
        for (const vaList of [false, true]) {
          const name = `${vaList ? 'wvsprintf' : 'wsprintf'}${row.wide ? 'W' : 'A'}`,
            label = `${name} ${JSON.stringify(row.format)} ${JSON.stringify(row.args)}`;
          p.write(output, new Uint8Array(4096).fill(0xa5));
          assert.equal(
            await p.callAsync(
              kernel.resolve({ dll: 'USER32.dll', name }),
              vaList ? [output, format, args] : [output, format, ...words],
            ),
            row.result,
            label,
          );
          assert.equal(
            createHash('sha256').update(p.read(output, 4096)).digest('hex'),
            row.sha256,
            label,
          );
        }
      } finally {
        for (const pointer of allocations) p.free(pointer);
      }
    }
  } finally {
    p.close();
  }
});

test('USER32 ANSI format literals retain CP932 bytes and cross-width strings use the game ANSI code page', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    output = p.allocate(128),
    format = p.allocate(128),
    string = p.allocate(128),
    call = (wide, values) =>
      p.callAsync(kernel.resolve({ dll: 'USER32.dll', name: wide ? 'wsprintfW' : 'wsprintfA' }), [
        output,
        format,
        ...values,
      ]);
  try {
    kernel.writeString(format, '猫:%ls/%d', false);
    kernel.writeString(string, '名前', true);
    assert.equal(await call(false, [string, 7]), 9);
    assert.deepEqual(p.stringBytes(output), encodeCP932('猫:名前/7'));
    kernel.writeString(format, '[%hs]', true);
    kernel.writeString(string, '猫', false);
    assert.equal(await call(true, [string]), 3);
    assert.equal(p.string(output, true), '[猫]');
  } finally {
    p.close();
  }
});
