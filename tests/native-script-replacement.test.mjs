// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeScriptReplacements,
  nativeScriptReplacement,
} from '../src/native/script-replacement.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const xml = (body) =>
  parseNativeXML(
    new TextEncoder().encode(
      '<?xml version="1.0" encoding="utf-8"?><SCRIPT><replace>' + body + '</replace></SCRIPT>',
    ),
  );
test('SCRIPT rules stop at the first incomplete record, keep first duplicate and traverse byte order', () => {
  const document = xml(
      '<r00><find>b</find><rep>c</rep></r00>' +
        '<r01><find>a</find><rep>b</rep></r01><r02><find>a</find><rep>wrong</rep></r02>' +
        '<r03><find>x</find></r03><r04><find>c</find><rep>d</rep></r04>',
    ),
    rules = new NativeScriptReplacements(document);
  assert.equal(rules.entries.size, 2);
  assert.equal(new TextDecoder().decode(rules.apply(encodeCP932('aba'))), 'ccc');
  for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
    const configuration = new NativeConfiguration({ profile, startup: document });
    assert.deepEqual(configuration.scriptReplacements.apply(encodeCP932('a')), encodeCP932('c'));
  }
});
test('SCRIPT native writes preserve original tail bytes and source alias semantics', () => {
  const rules = new NativeScriptReplacements(xml('<r00><find>\\_</find><rep> </rep></r00>')),
    bytes = new Uint8Array(128).fill(0xa5),
    machine = { bytes: (at, size) => bytes.subarray(at, at + size) },
    services = {
      configuration: { scriptReplacements: rules },
      formatBytes: () => encodeCP932('猫\\_a tail'),
    };
  assert.deepEqual(nativeScriptReplacement(0x3ea, [16, 16], machine, services), { control: 2 });
  const result = encodeCP932('猫 a tail');
  assert.deepEqual(bytes.subarray(16, 16 + result.length + 1), Uint8Array.from([...result, 0]));
  assert.equal(bytes[16 + result.length + 1], 0); // previous longer strcpy terminator
  const empty = new NativeScriptReplacements();
  bytes.fill(0xa5);
  empty.write(machine, 0, new Uint8Array());
  assert.deepEqual([...bytes.subarray(0, 3)], [0, 0xa5, 0xa5]);
  rules.write(machine, 0, new Uint8Array());
  assert.deepEqual([...bytes.subarray(0, 3)], [0, 0, 0xa5]);
});
test('SCRIPT startup rules retain each profile XML byte encoding through fresh configuration', () => {
  const document = xml('<r00><find>猫</find><rep>日本語</rep></r00>');
  for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
    const encode = profile.startsWith('sdk')
        ? encodeCP932
        : (text) => new TextEncoder().encode(text),
      configuration = new NativeConfiguration({ profile, startup: document });
    assert.deepEqual(
      configuration.scriptReplacements.apply(encode('猫 猫')),
      encode('日本語 日本語'),
    );
  }
});
