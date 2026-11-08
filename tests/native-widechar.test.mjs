// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { PPIWindowsServices } from '../src/ppi/native-services.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-widechar-golden.json', import.meta.url)),
);
const symbol = { dll: 'KERNEL32.dll', name: 'WideCharToMultiByte' };
const lastErrorCanary = 0x12345678;
const defaultCanary = 0x5a5a5a5a;
const outputCanary = new Uint8Array(128).fill(0xa5);
const inputCanary = new Uint8Array(128).fill(0x5a);

function wideBytes(units) {
  const bytes = new Uint8Array(units.length * 2),
    view = new DataView(bytes.buffer);
  units.forEach((unit, i) => view.setUint16(i * 2, unit, true));
  return bytes;
}

function wideFixture(p, kernel) {
  return {
    p,
    kernel,
    input: p.allocate(128),
    output: p.allocate(128),
    replacement: p.allocate(4),
    used: p.allocate(12),
    api: kernel.resolve(symbol),
  };
}

async function fixture() {
  const p = new PE32Process(await loadUnicorn());
  return wideFixture(p, new PPIWindowsServices(p));
}

function documentedError(codePage, flags, replacement, used, guard) {
  if (guard & 4) return 87;
  if (flags & ~(codePage === 65001 ? 0x80 : 0x760)) return 1004;
  if (codePage === 65001 && (replacement || used)) return 87;
  return null;
}

test('WideCharToMultiByte matches the complete pinned Wine records and the documented Windows argument checks', async () => {
  const { p, kernel, input, output, replacement, used, api } = await fixture();
  let compared = 0,
    documented = 0;
  try {
    for (const row of golden.cases) {
      const [
          cp,
          flags,
          units,
          size,
          capacity,
          custom,
          reportDefault,
          guard,
          originalResult,
          originalError,
          originalUsed,
          prefix,
        ] = row,
        error = documentedError(cp, flags, custom, reportDefault, guard),
        source = guard & 4 ? output : input,
        target = guard & 2 ? 0 : output,
        sourceBytes = wideBytes([...units, 0]),
        customBytes = Uint8Array.of(custom?.[0] ?? 0, custom?.[1] ?? 0, 0xa7, 0x7a),
        label = `${cp}/${flags}/${units}/${size}/${capacity}/${custom}/${reportDefault}/${guard}`;
      p.write(input, inputCanary);
      p.write(output, outputCanary);
      p.write(source, sourceBytes);
      p.write(replacement, customBytes);
      p.store(used, 0x11223344);
      p.store(used + 4, defaultCanary);
      p.store(used + 8, 0x22334455);
      kernel.lastError = lastErrorCanary;
      const before = p.read(output, 128),
        reply = p.call(api, [
          cp,
          flags,
          guard & 1 ? 0 : source,
          size >>> 0,
          target,
          capacity >>> 0,
          custom ? replacement : 0,
          reportDefault ? used + 4 : 0,
        ]);
      assert.equal(reply, error === null ? originalResult : 0, 'result/' + label);
      assert.equal(kernel.lastError, error ?? originalError, 'last error/' + label);
      assert.deepEqual(
        p.read(output, 128),
        error === null ? Uint8Array.from(Buffer.from(prefix.padEnd(256, 'a5'), 'hex')) : before,
        'all output bytes/' + label,
      );
      assert.deepEqual(
        [p.load(used), p.load(used + 4), p.load(used + 8)],
        [0x11223344, error === null ? originalUsed : defaultCanary, 0x22334455],
        'used-default BOOL and both canaries/' + label,
      );
      const expectedInput = inputCanary.slice();
      if (source === input) expectedInput.set(sourceBytes);
      assert.deepEqual(p.read(input, 128), expectedInput, 'read-only input/' + label);
      assert.deepEqual(p.read(replacement, 4), customBytes, 'read-only default character/' + label);
      if (error === null) compared++;
      else documented++;
    }
    assert.equal(compared, 2177);
    assert.equal(documented, 24);
  } finally {
    p.close();
  }
});

for (const [codePage, strictFlag, expected] of [
  [932, 0x400, golden.cp932Mapping],
  [65001, 0x80, golden.utf8Mapping],
])
  test(`WideCharToMultiByte CP${codePage} matches the complete Unicode-unit mapping digest`, async () => {
    const { p, kernel, input, output, used } = await fixture(),
      convert = kernel.importDefinition(symbol).fn,
      hash = createHash('sha256'),
      record = new Uint8Array(20),
      view = new DataView(record.buffer);
    let count = 0;
    try {
      const sample = (flags, units) => {
        p.write(input, wideBytes(units));
        p.write(output, outputCanary.subarray(0, 8));
        p.store(used, defaultCanary);
        kernel.lastError = lastErrorCanary;
        const result = convert([
          codePage,
          flags,
          input,
          units.length,
          output,
          8,
          0,
          codePage === 932 ? used : 0,
        ]);
        [result, kernel.lastError, p.load(used)].forEach((value, i) =>
          view.setUint32(i * 4, value, true),
        );
        record.set(p.read(output, 8), 12);
        hash.update(record);
        count++;
      };
      for (const flags of [0, strictFlag]) {
        for (let unit = 0; unit < 65536; unit++) sample(flags, [unit]);
        if (codePage === 65001)
          for (let high = 0xd800; high <= 0xdbff; high++)
            for (const low of [0xdc00, 0xdc01, 0xdd00, 0xdfff]) sample(flags, [high, low, 65, 0]);
      }
      assert.equal(count, expected.cases);
      assert.equal(hash.digest('hex'), expected.sha256);
    } finally {
      p.close();
    }
  });

for (const [profile, variable, ansi, utf8] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x6a6020, 0x6a5300],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x5782c0, 0x577ce0],
])
  test(
    `${profile} original conversion callers receive the mounted Windows contract`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        { p, kernel, input, output } = wideFixture(engine.process, engine.kernel),
        definition = kernel.importDefinition(symbol),
        convert = definition.fn,
        calls = [];
      definition.fn = (args) => {
        calls.push(args);
        return convert(args);
      };
      try {
        let ansiCases = 0;
        for (const row of golden.cases) {
          const [cp, flags, units, size, capacity, custom, used, guard, result, error, , prefix] =
            row;
          if (cp !== 932 || flags || size !== -1 || custom || used || guard) continue;
          calls.length = 0;
          p.write(input, wideBytes([...units, 0]));
          p.write(output, outputCanary);
          kernel.lastError = lastErrorCanary;
          const destination = capacity ? output : 0;
          assert.equal(await engine.call(ansi, [destination, capacity, input]), result);
          assert.deepEqual(calls, [[932, 0, input, 0xffffffff, destination, capacity, 0, 0]]);
          assert.equal(kernel.lastError, error);
          assert.deepEqual(
            p.read(output, 128),
            Uint8Array.from(Buffer.from(prefix.padEnd(256, 'a5'), 'hex')),
          );
          ansiCases++;
        }
        assert.equal(ansiCases, 20);
        for (const [source, text] of [
          [Uint8Array.of(0), '\0'],
          [encodeCP932('A猫がパ\0'), 'A猫がパ\0'],
          [Uint8Array.of(0x80, 0xa0, 0), '\u0080\uf8f0\0'],
        ]) {
          const expected = new TextEncoder().encode(text);
          p.write(input, source);
          for (const capacity of [0, 1, 2, 4, 8, 32]) {
            p.write(output, outputCanary);
            kernel.lastError = lastErrorCanary;
            calls.length = 0;
            assert.equal(await engine.call(utf8, [input, output, capacity]), expected.length);
            assert.deepEqual(
              calls.map(([cp, flags, , size, destination, cap, def, used]) => [
                cp,
                flags,
                size,
                destination,
                cap,
                def,
                used,
              ]),
              [
                [65001, 0, text.length, 0, 0, 0, 0],
                ...(capacity >= expected.length
                  ? [[65001, 0, text.length, output, capacity, 0, 0]]
                  : []),
              ],
            );
            const bytes = outputCanary.slice();
            if (capacity >= expected.length) bytes.set(expected);
            assert.deepEqual(p.read(output, 128), bytes);
            assert.equal(kernel.lastError, lastErrorCanary);
          }
        }
        if (!profile.startsWith('sdk-')) {
          const locale = p.allocate(12, true);
          p.store(locale, 932);
          p.store(locale + 4, 2);
          try {
            for (const [unit, expected, result] of [
              [65, [65], 1],
              [0xa5, [0x5c], 1],
              [0x732b, [0x94, 0x4c], 2],
              [0xd800, [0x3f], 0xffffffff],
              [0xfffd, [0x3f], 0xffffffff],
            ]) {
              p.write(output, outputCanary);
              calls.length = 0;
              assert.equal(await engine.call(0x87eb68, [output, unit, 0, locale]), result);
              assert.equal(calls.length, 1);
              assert.deepEqual(calls[0].slice(0, 2), [932, 0]);
              assert.deepEqual(calls[0].slice(3, 7), [1, output, 2, 0]);
              assert.notEqual(calls[0][7], 0, 'CRT checks the actual BOOL output');
              const bytes = outputCanary.slice();
              bytes.set(expected);
              assert.deepEqual(p.read(output, 128), bytes);
            }
          } finally {
            p.free(locale);
          }
        }
      } finally {
        await engine.close();
      }
    },
  );
