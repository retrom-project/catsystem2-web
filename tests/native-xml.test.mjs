// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply } from '../src/kcs.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { nativeXML, findNativeXML, parseNativeXML } from '../src/native/xml.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { parseXML } from '../src/xml.mjs';

function setup(text) {
  const m = new KCSMachine({
    body: new Binary(Uint8Array.from([59])),
    codeSize: 1,
    data: new Uint8Array(2048),
    stackSize: 1024,
  });
  const handles = new NativeHandles();
  const services = {
    handles,
    format: (at, vm) => vm.string(at),
    read: async () => new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?>' + text),
  };
  m.writeString('config.int/settings.xml', 32);
  return { m, handles, services };
}
test('native XML paths preserve case, skip only document and search duplicate siblings for a complete match', () => {
  const xml = parseXML(
    '<document><group><other>1</other></group><group><value>42</value></group><Group><value>71</value></Group></document>',
  );
  assert.equal(findNativeXML(xml, '//group///value/').text, '42');
  assert.equal(findNativeXML(xml, 'Group/value').text, '71');
  assert.equal(findNativeXML(xml, 'GROUP/value'), null);
  assert.equal(findNativeXML(xml, 'document/group/value'), null);
  const root = parseXML('<settings><value>19</value></settings>');
  assert.equal(findNativeXML(root, 'settings/value').text, '19');
  assert.equal(findNativeXML(root, 'value'), null);
});
test('native XML integer fallback applies only to absent nodes, and text reads leave absent destinations intact', async () => {
  const { m, services } = setup(
    '<document><a>not an integer</a><b>-0x10</b><c>名前</c></document>',
  );
  const { value: handle } = await nativeXML(0x24e, [32], m, services);
  m.writeString('missing', 128);
  assert.deepEqual(nativeXML(0x250, [handle, 73, 128], m, services), nativeReply(1, 73));
  m.writeString('a', 128);
  assert.deepEqual(nativeXML(0x250, [handle, 73, 128], m, services), nativeReply(1, 0));
  m.writeString('b', 128);
  assert.deepEqual(nativeXML(0x250, [handle, 73, 128], m, services), nativeReply(1, -16));
  m.writeString('keep', 256);
  m.writeString('missing', 128);
  nativeXML(0x251, [handle, 256, 128], m, services);
  assert.equal(m.string(256), 'keep');
  m.writeString('c', 128);
  m.bytes(256, 32).fill(0x7e);
  nativeXML(0x251, [handle, 256, 128], m, services);
  assert.equal(m.string(256), '名前');
  assert.equal(m.load(261, 1), 0x7e); // strcpy writes one terminator
  assert.deepEqual(nativeXML(0x24f, [handle], m, services), nativeReply(2));
  assert.throws(() => nativeXML(0x250, [handle, 0, 128], m, services), /released/);
});
test('XML native handles reconstruct node records across a new instance without re-reading the resource', async () => {
  const { m, handles, services } = setup('<document><value>87</value></document>');
  const opened = await nativeXML(0x24e, [32], m, services);
  const restored = new NativeHandles();
  restored.restore(handles.snapshot());
  m.writeString('value', 128);
  assert.deepEqual(
    nativeXML(0x250, [opened.value, 0, 128], m, { ...services, handles: restored }),
    nativeReply(1, 87),
  );
  restored.release(opened.value, 'xml');
  assert.equal(handles.get(opened.value, 'xml').name, 'document');
  assert.deepEqual(
    await nativeXML(0x24e, [32], m, { ...services, read: async () => null }),
    nativeReply(1, 0),
  );
});
test('native XML profiles keep SDK Shift_JIS and game UTF-8 declarations and normalize text without trimming', () => {
  const utf8 = new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8"?><document><v> 12\r\n\t </v></document>',
  );
  assert.equal(findNativeXML(parseNativeXML(utf8, 'UTF-8'), 'v').text, ' 12   ');
  assert.throws(() => parseNativeXML(utf8, 'Shift_JIS'), /profile encoding/);
  const sjis = encodeCP932(
    '<?xml version="1.0" encoding="Shift_JIS"?><document><v>名前</v></document>',
  );
  assert.equal(findNativeXML(parseNativeXML(sjis, 'Shift_JIS'), 'v').text, '名前');
  assert.throws(() => parseNativeXML(new TextEncoder().encode('<document/>')), /declaration/);
});
