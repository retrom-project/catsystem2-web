// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeABI, validateABI } from '../src/native/abi/index.mjs';
import { nativeSignatureDifferences } from '../src/native/abi/signature.mjs';
import { compareNativeSignatures } from '../scripts/compare-native-abi.mjs';

const sdk = nativeABI('sdk-4.01-engine-2.6.1.74'),
  game = nativeABI('nekopara-vol3-engine-2.6.1.76');
const main = (abi, id) => abi.tables.main.entries[id].signature;

test('the eight reviewed lexical aliases normalize types without changing write knowledge', () => {
  for (const id of [6, 27, 28, 30, 31, 38, 39, 49]) {
    const differences = nativeSignatureDifferences(main(sdk, id), main(game, id));
    assert.ok(
      differences.every((field) => field === 'resultWritten'),
      `0x${id.toString(16)}`,
    );
  }
  assert.deepEqual(main(sdk, 6).result, { kind: 'bits', bits: 32, description: 'u32' });
  assert.equal(main(game, 6).result.kind, 'bits');
  assert.equal(main(sdk, 27).result.addressSpace, 'vm');
  assert.equal(main(game, 28).parameters[0].type.addressSpace, 'vm');
});

test('byte-count and byte-offset results retain units rather than becoming element counts', () => {
  for (const abi of [sdk, game]) {
    for (const id of [30, 31, 38, 39]) {
      assert.equal(main(abi, id).result.kind, 'integer');
      assert.equal(main(abi, id).result.signed, false);
      assert.equal(main(abi, id).result.unit, 'byte-count');
    }
    assert.equal(main(abi, 49).result.unit, 'byte-offset');
    assert.equal(main(abi, 30).parameters[0].type.direction, 'out');
    assert.equal(main(abi, 31).parameters[0].type.direction, 'in');
  }
});

test('raw byte copies, real inout append and conditional XML output remain distinct', () => {
  for (const abi of [sdk, game]) {
    assert.equal(main(abi, 13).parameters[0].type.target.encoding, 'bytes');
    assert.equal(main(abi, 13).parameters[0].type.direction, 'out');
    assert.equal(main(abi, 15).parameters[0].type.direction, 'inout');
    const output = main(abi, 0x251).parameters[1].type;
    assert.equal(output.direction, 'out');
    assert.equal(output.writePolicy, 'conditional');
    assert.equal(output.target.encoding, abi === sdk ? 'CP932' : 'UTF-8');
  }
  assert.equal(main(game, 0x40f).parameters[0].type.target.decoderContract, 'native-permissive');
});

test('unknown, ignored and variadic argument evidence is retained in reviewed declarations', () => {
  assert.equal(main(sdk, 0x52).parameters, null);
  assert.equal(main(sdk, 0).parameters.kind, 'ignored');
  assert.equal(main(sdk, 0).argumentWords, null);
  const formatted = main(sdk, 0x7c).parameters.at(-1).type;
  assert.equal(formatted.kind, 'variadic');
  assert.equal(formatted.role, 'format-arguments');
  assert.equal(formatted.elementType.kind, 'unknown');
});

test('signature comparisons expose real encoding differences and unresolved semantic slots', () => {
  const comparison = compareNativeSignatures(game, sdk).tables.find(
    (table) => table.name === 'main',
  );
  const xml = comparison.entries.find((entry) => entry.id === 0x251);
  assert.equal(xml.relation, 'declaration-difference');
  assert.ok(xml.differences.includes('parameters'));
  assert.equal(
    comparison.entries.find((entry) => entry.id === 0x52).relation,
    'unresolved-semantic',
  );
  assert.equal(
    comparison.entries.find((entry) => entry.id === 0x38a).relation,
    'different-name-or-enablement',
  );
});

test('ABI validation catches divergent mirrored type declarations', () => {
  const invalid = structuredClone(sdk);
  invalid.tables.main.entries[13].parameters[0].type.direction = 'in';
  assert.throws(() => validateABI(invalid), /Mirrored declaration fields disagree/);
});
