// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';

test('verified KCS container and script versions continue without a diagnostic', async () => {
  const warnings = [];
  for (const version of [0, 0x10000, 0x20000]) {
    const bytes = kcsProgram([[59]]);
    new DataView(bytes.buffer).setUint32(8, (version >>> 16) | ((version & 65535) << 16), true);
    const script = await readKCS(bytes, { warn: (message) => warnings.push(message) });
    assert.equal(script.scriptVersion, version);
    assert.equal(script.codeSize, 1);
  }
  assert.deepEqual(warnings, []);
});

test('unverified KCS versions warn once per source digest and preserve decoded behavior', async () => {
  const bytes = kcsProgram([[59]], [[4, 'authored']]),
    warnings = [];
  new DataView(bytes.buffer).setUint32(4, 17, true);
  new DataView(bytes.buffer).setUint16(8, 7, true);
  new DataView(bytes.buffer).setUint16(10, 3, true);
  for (let repeat = 0; repeat < 2; repeat++) {
    const script = await readKCS(bytes, { warn: (message) => warnings.push(message) });
    assert.equal(script.strings.get(4), 'authored');
    assert.equal(script.formatVersion, 17);
    assert.equal(script.scriptVersion, 0x70003);
  }
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /KCS script container: format=17, headerBytes=52, script=7\.3, sha256=[a-f0-9]{64}; continuing/,
  );
  const other = bytes.slice();
  new DataView(other.buffer).setUint16(10, 4, true);
  await readKCS(other, { warn: (message) => warnings.push(message) });
  assert.equal(warnings.length, 2);
});

test('KCS honors a structurally valid declared header length and keeps malformed containers explicit', async () => {
  const base = kcsProgram([[59]], [[4, 'extended header']]),
    bytes = new Uint8Array(base.length + 4),
    warnings = [];
  bytes.set(base.subarray(0, 52));
  bytes.set(base.subarray(52), 56);
  const view = new DataView(bytes.buffer);
  for (const offset of [12, 20, 40]) view.setUint32(offset, view.getUint32(offset, true) + 4, true);
  const script = await readKCS(bytes, { warn: (message) => warnings.push(message) });
  assert.equal(script.header.length, 56);
  assert.equal(script.strings.get(4), 'extended header');
  assert.equal(warnings.length, 1);
  view.setUint32(20, 0xffffffff, true);
  await assert.rejects(readKCS(bytes), /range/);
  view.setUint32(12, 48, true);
  await assert.rejects(readKCS(bytes), /header is shorter/);
  assert.equal(warnings.length, 1);
});
