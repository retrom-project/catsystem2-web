// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXML, XMLNode } from '../src/xml.mjs';
import { parseNativeXML, findNativeXML, nativeXMLTextBytes } from '../src/native/xml.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'],
  ascii = (text) => new TextEncoder().encode(text),
  join = (...parts) => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  },
  payload = (encoding) =>
    encoding === 'Shift_JIS' ? new Uint8Array([0xfa, 0x40]) : ascii('日本語'),
  xml = (encoding, body) =>
    join(
      ascii(`<?xml version="1.0" encoding="${encoding}"?><document>`),
      body,
      ascii('</document>'),
    );

for (const encoding of ['Shift_JIS', 'UTF-8']) {
  test(`native text byte owner preserves ${encoding} bytes, entities, whitespace and existing node methods`, () => {
    const source = xml(
        encoding,
        join(ascii('<group><value> \r\n\t&amp;'), payload(encoding), ascii(' </value></group>')),
      ),
      document = parseNativeXML(source, encoding),
      value = findNativeXML(document, 'group/value'),
      expected = join(ascii('   &amp;'), payload(encoding), ascii(' '));
    assert.deepEqual(nativeXMLTextBytes(value), expected);
    assert.equal(value.text, new TextDecoder(encoding).decode(expected));
    assert.ok(document instanceof XMLNode);
    assert.equal(document.node('group', 'value'), value);
    assert.equal(document.value('group', 'value'), value.text.trim());
    assert.throws(() => {
      value.text = 'another value';
    }, TypeError);
    assert.equal(Object.hasOwn(value, 'bytes'), false);
    const snapshot = new NativeHandles();
    snapshot.add('xml', document);
    const stored = snapshot.snapshot().records[0][1].value;
    const check = (node) => {
      assert.deepEqual(Object.keys(node).sort(), ['bytes', 'children', 'encoding', 'name']);
      assert.equal(node.encoding, encoding);
      for (const child of node.children) check(child);
    };
    check(stored);
  });

  test(`native empty/duplicate/comment text and C input termination stay exact: ${encoding}`, () => {
    const document = parseNativeXML(
      xml(encoding, ascii('<empty></empty><value>A<!--ignored-->B</value><value>last</value>')),
      encoding,
    );
    assert.deepEqual(nativeXMLTextBytes(findNativeXML(document, 'empty')), new Uint8Array());
    assert.equal(findNativeXML(document, 'value').text, 'last');
    const first = document.children.find((node) => node.name === 'value' && node.text === 'AB');
    assert.deepEqual(nativeXMLTextBytes(first), ascii('AB'));
    const terminated = join(
      xml(encoding, ascii('<value>ok</value>')),
      new Uint8Array([0, 0xff, 0xff]),
    );
    assert.equal(findNativeXML(parseNativeXML(terminated, encoding), 'value').text, 'ok');
  });
}

for (const profile of profiles)
  test(`actual installed ScriptXML0x251 outputs original text bytes and fresh handles keep one owner: ${profile}`, async () => {
    const encoding = nativeABI(profile).xmlEncoding,
      raw = payload(encoding),
      file = 'config.int/raw.xml',
      files = {
        [file]: xml(
          encoding,
          join(ascii('<group><word>&amp;'), raw, ascii('</word><empty></empty></group>')),
        ),
      },
      reads = [],
      make = async (initialize) => {
        const world = await dataWorld(profile, files, { initialize });
        const read = world.game.read;
        world.game.read = (name) => {
          reads.push(name);
          return read(name);
        };
        return world;
      },
      call = (world, id, ...args) =>
        world.runtime.native(
          'main',
          id,
          args,
          world.main.machine,
          world.main,
          world.runtime.scheduler,
        ),
      first = await make(true);
    let fresh;
    try {
      const vm = first.main.machine;
      vm.writeString(file, 32);
      const opened = await call(first, 0x24e, 32),
        handle = opened.value;
      assert.equal(opened.control, 1);
      assert.ok(handle > 0);
      vm.writeString('group/word', 128);
      vm.bytes(256, 64).fill(0x7e);
      assert.deepEqual(await call(first, 0x251, handle, 256, 128), { control: 2 });
      const expected = join(ascii('&amp;'), raw, new Uint8Array([0, 0x7e]));
      assert.deepEqual(vm.bytes(256, expected.length), expected);
      const snapshot = first.snapshot(),
        sourceReads = reads.filter((name) => name === file).length;
      fresh = await make(false);
      await fresh.restore(structuredClone(snapshot));
      const restored = fresh.main.machine;
      restored.writeString('group/word', 128);
      restored.bytes(512, 64).fill(0x7e);
      assert.deepEqual(await call(fresh, 0x251, handle, 512, 128), { control: 2 });
      assert.deepEqual(restored.bytes(512, expected.length), expected);
      assert.equal(reads.filter((name) => name === file).length, sourceReads);
      const node = findNativeXML(fresh.runtime.handles.get(handle, 'xml'), 'group/word');
      assert.throws(() => {
        node.text = 'mutated shadow';
      }, TypeError);
      const returned = nativeXMLTextBytes(node);
      returned.fill(0);
      assert.deepEqual(nativeXMLTextBytes(node), expected.subarray(0, -2));
      restored.writeString('group/empty', 128);
      restored.bytes(640, 8).fill(0x7e);
      await call(fresh, 0x251, handle, 640, 128);
      assert.deepEqual(restored.bytes(640, 2), new Uint8Array([0, 0x7e]));
      await call(fresh, 0x24f, handle);
      assert.throws(() => fresh.runtime.handles.get(handle, 'xml'), /released/);
      assert.ok(first.runtime.handles.get(handle, 'xml'));
    } finally {
      await fresh?.close({ flushFiles: false });
      await first.close({ flushFiles: false });
    }
  });

test('native parser owns plain bytes from Buffer input and returned byte copies cannot change it', () => {
  const source = Buffer.from(
      xml('Shift_JIS', join(ascii('<value>'), payload('Shift_JIS'), ascii('</value>'))),
    ),
    document = parseNativeXML(source, 'Shift_JIS'),
    node = findNativeXML(document, 'value');
  source.fill(0);
  const first = nativeXMLTextBytes(node);
  assert.equal(first.constructor, Uint8Array);
  assert.deepEqual(first, new Uint8Array([0xfa, 0x40]));
  first.fill(0);
  assert.deepEqual(nativeXMLTextBytes(node), new Uint8Array([0xfa, 0x40]));
});

test('native XML handle codec requires the current byte/encoding owner and rebuilds derived views', () => {
  const first = new NativeHandles(),
    document = parseNativeXML(
      xml('Shift_JIS', join(ascii('<value>'), payload('Shift_JIS'), ascii('</value>'))),
      'Shift_JIS',
    ),
    handle = first.add('xml', document),
    snapshot = first.snapshot(),
    fresh = new NativeHandles();
  fresh.restore(structuredClone(snapshot));
  const value = findNativeXML(fresh.get(handle, 'xml'), 'value');
  assert.deepEqual(nativeXMLTextBytes(value), new Uint8Array([0xfa, 0x40]));
  snapshot.records[0][1].value.children[0].bytes.fill(0);
  assert.deepEqual(nativeXMLTextBytes(value), new Uint8Array([0xfa, 0x40]));
  const malformed = fresh.snapshot();
  delete malformed.records[0][1].value.children[0].bytes;
  assert.throws(() => new NativeHandles().restore(malformed), /Invalid native XML checkpoint node/);
});

test('generic parseXML retains its existing writable Unicode text contract', () => {
  const document = parseXML('<document><value>A&amp;B</value></document>');
  const node = document.node('value');
  assert.equal(node.text, 'A&B');
  node.text = 'writable';
  assert.equal(document.value('value'), 'writable');
  assert.throws(() => nativeXMLTextBytes(node), /native node/);
});

test('UTF8 text-leading BOM bytes remain an interior text character and raw output value', () => {
  const expected = join(new Uint8Array([0xef, 0xbb, 0xbf]), ascii('value')),
    document = parseNativeXML(
      xml('UTF-8', join(ascii('<value>'), expected, ascii('</value>'))),
      'UTF-8',
    ),
    node = findNativeXML(document, 'value');
  assert.equal(node.text, '\uFEFFvalue');
  assert.deepEqual(nativeXMLTextBytes(node), expected);
});
