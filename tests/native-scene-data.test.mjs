// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { Binary } from '../src/binary.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import {
  NativeSceneData,
  NativeSceneReader,
  NativeSceneHistory,
  nativeSceneData,
} from '../src/native/scene-data.mjs';
import { translation } from './helpers.mjs';

function cst(blocks, packed = true) {
  const lines = blocks.flat(),
    strings = [],
    offsets = [];
  for (const [kind, text, header = [1, kind]] of lines) {
    offsets.push(strings.length);
    strings.push(...header, ...encodeCP932(text), 0);
  }
  const body = new Uint8Array(16 + blocks.length * 8 + lines.length * 4 + strings.length),
    view = new DataView(body.buffer);
  const header = [
    body.length - 16,
    blocks.length,
    blocks.length * 8,
    blocks.length * 8 + lines.length * 4,
  ];
  header.forEach((value, i) => view.setUint32(i * 4, value, true));
  let start = 0;
  blocks.forEach((block, i) => {
    view.setUint32(16 + i * 8, block.length, true);
    view.setUint32(20 + i * 8, start, true);
    start += block.length;
  });
  offsets.forEach((offset, i) => view.setUint32(16 + blocks.length * 8 + i * 4, offset, true));
  body.set(strings, 16 + header[3]);
  const payload = packed ? deflateSync(body) : body,
    file = new Uint8Array(16 + payload.length),
    fileView = new DataView(file.buffer);
  file.set(new TextEncoder().encode('CatScene'));
  fileView.setUint32(8, packed ? payload.length : 0, true);
  fileView.setUint32(12, body.length, true);
  file.set(payload, 16);
  return file;
}
const machine = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(16384),
    stackSize: 1024,
  });
const sample = () =>
  cst([
    [
      [0x30, 'next child'],
      [0x21, '猫'],
      [0x20, '一行'],
      [0x20, '続き'],
      [2, ''],
    ],
    [[0x30, 'return']],
  ]);

test('native CST indexing uses blocks, count sentinels, byte headers and current-position fallbacks', async () => {
  for (const packed of [true, false]) {
    const reader = new NativeSceneReader();
    assert.equal(reader.type(-1, -1), -1);
    assert.equal(
      await reader.load(cst([[[0x20, '猫']], [[0x30, 'A', [3, 0x30, 7, 8]]]], packed)),
      true,
    );
    assert.equal(reader.type(-1, 0), 2);
    assert.equal(reader.type(0, -1), 1);
    assert.equal(reader.type(0, 0), 0x20);
    assert.equal(reader.type(1, 0), -1);
    assert.equal(reader.type(2, 0), -1);
    assert.equal(decoder.decode(reader.text(1, 0)), 'A');
    assert.equal(reader.text(2, 0), null);
    assert.deepEqual(reader.text(-1, -1), encodeCP932('猫'));
    reader.block = 1;
    assert.equal(decoder.decode(reader.text(-1, -1)), 'A');
    assert.equal(await reader.load(new Uint8Array(16)), false);
    assert.equal(reader.type(-1, -1), 2);
  }
});
const decoder = new TextDecoder('shift_jis');

test('CSTL uses registered exact prefixes, block ordinal, first-message joining and UTF-8 bytes', async () => {
  const reader = new NativeSceneReader(['en', 'jp']);
  await reader.load(sample());
  assert.equal(
    reader.loadTranslations(translation(['unknown'], [{ unknown: ['Other', 'No'] }])),
    false,
  );
  assert.equal(
    reader.loadTranslations(
      translation(['en'], [{ en: ['Cat', 'First\x1fSecond\x1f\x1fIgnored'] }]),
    ),
    true,
  );
  assert.equal(new TextDecoder().decode(reader.text(0, 1, { language: 'en' })), 'Cat');
  assert.equal(new TextDecoder().decode(reader.text(0, 2, { language: 'en' })), 'FirstSecond');
  assert.equal(reader.text(0, 3, { language: 'en' }).length, 0);
  assert.deepEqual(reader.text(0, 2, { language: 'EN' }), encodeCP932('一行'));
  assert.equal(new TextDecoder().decode(reader.text(0, 2, { toUTF8: true })), '一行');
  assert.deepEqual(reader.text(0, 0, { language: 'en' }), encodeCP932('next child'));
  assert.equal(reader.messageCount(), 2);
  assert.deepEqual(
    new NativeSceneReader().restore(reader.snapshot()).snapshot(),
    reader.snapshot(),
  );
});

test('native scene resources keep explicit and task-local results, buffers and path indexes distinct', async () => {
  const m = machine(),
    handles = new NativeHandles(),
    services = {
      handles,
      sceneLanguages: [],
      format: (address) => m.string(address),
      read: (name) => (name === 'main' ? sample() : null),
    };
  const handle = nativeSceneData(0x143, [], m, services).value;
  services.sceneData = handles.get(handle, 'scene-data');
  m.writeString('main', 0);
  assert.equal((await nativeSceneData(0x145, [handle, 0], m, services)).value, 1);
  assert.equal(nativeSceneData(0x146, [handle, -1, 0], m, services).value, 2);
  assert.equal(nativeSceneData(0xdd, [0, 2], m, services).value, 0x20);
  m.writeString('unchanged', 64);
  assert.equal(nativeSceneData(0x147, [handle, 64, 5, 0], m, services).value, 0);
  assert.equal(nativeSceneData(0xde, [64, 5, 0], m, services).value, 9);
  assert.equal(m.string(64), 'unchanged');
  assert.equal(nativeSceneData(0x147, [handle, 64, 0, 2], m, services).value, 4);
  assert.equal(m.string(64), '一行');
  nativeSceneData(0x40d, [handle, 64, 0, 2], m, services);
  assert.equal(new TextDecoder().decode(m.bytes(64, 6)), '一行');
  m.writeString('CHILD.CST', 0);
  assert.equal(nativeSceneData(0x149, [handle, 0, 2], m, services).value, 0);
  assert.equal(nativeSceneData(0x149, [handle, 0, 3], m, services).value, 0);
  m.writeString('next.cst', 0);
  assert.equal(nativeSceneData(0x149, [handle, 0, 4], m, services).value, 1);
  assert.equal(nativeSceneData(0x14d, [handle, -1, 64, 128], m, services).value, 1);
  assert.equal(m.string(64), 'next');
  assert.equal(m.load(128), 4);
  nativeSceneData(0x144, [handle], m, services);
  assert.throws(() => handles.get(handle, 'scene-data'), /released/);
});

test('history preserves unsigned maxima, consecutive path coalescing and clipped string snapshots', () => {
  const h = new NativeSceneHistory();
  h.markSeen('Main', -1);
  h.markSeen('main', 10);
  assert.equal(h.seenValue('MAIN'), 0xffffffff);
  assert.equal(h.appendPath('A', 2), 0);
  assert.equal(h.appendPath('a', 1), 0);
  assert.equal(h.appendPath('B', 4), 1);
  assert.equal(h.appendPath('A', 3), 2);
  assert.equal(h.path[0].value, 2);
  assert.equal(h.setString(-1, 1, 2, new TextEncoder().encode('x'.repeat(80))), true);
  assert.equal(h.getString(2, 1, 2).bytes.length, 62);
  assert.deepEqual(h.getString(2, 1, 3), { found: false, bytes: new Uint8Array() });
  assert.equal(h.getString(0, 1, 2), null);
  h.aliasSeen('main', 'alias');
  assert.equal(h.seenValue('ALIAS'), 0xffffffff);
  assert.deepEqual(new NativeSceneHistory().restore(h.snapshot()).snapshot(), h.snapshot());
});

test('history string substitution snapshots only referenced values and expands once', () => {
  const m = machine(),
    data = new NativeSceneData(),
    strings = new NativeStringBank(),
    handles = new NativeHandles(),
    handle = handles.add('scene-data', data),
    services = { handles, strings };
  data.history.appendPath('main', 1);
  strings.set(3, 'stored $str4');
  strings.set(4, 'late');
  m.writeString('A$str3 B$str4 C$str5', 0);
  nativeSceneData(0x150, [handle, 0, 9, 0], m, services);
  strings.set(3, 'changed');
  nativeSceneData(0x151, [handle, 0, 9, 0], m, services);
  assert.equal(m.string(0), 'Astored $str4 Blate C');
});
