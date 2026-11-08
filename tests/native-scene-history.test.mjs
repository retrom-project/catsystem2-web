// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSceneData, NativeSceneHistory, nativeSceneData } from '../src/native/scene-data.mjs';
import {
  encodeNativeSceneHistory,
  decodeNativeSceneHistory,
} from '../src/native/scene-history.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeGlobalFile, createGlobalEntries } from '../src/native/persistence.mjs';

test('history encoding preserves current record fields, duplicate string keys and unused tails', () => {
  const h = new NativeSceneHistory();
  h.appendPath('main', 7);
  h.setString(0, 3, 4, Uint8Array.of(65, 66));
  const entry = h.path[0];
  entry.strings[0][1].fill(0xab, 10);
  entry.strings.push(['3:4', Uint8Array.from({ length: 64 }, (_, i) => (i ? 0 : 67))]);
  entry.extra = Uint8Array.of(9, 8, 7, 6);
  const bytes = h.encode('path', true),
    view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 4 + 48 + 2 * 72 + 4);
  assert.equal(view.getUint32(0, true), 0);
  assert.equal(view.getUint32(36, true), 7);
  assert.equal(view.getUint32(40, true), 2);
  assert.equal(view.getUint32(44, true), 4);
  assert.equal(view.getUint32(48, true), 192);
  const decoded = decodeNativeSceneHistory(bytes);
  assert.equal(decoded[0].strings.length, 2);
  assert.deepEqual(encodeNativeSceneHistory(decoded, true), bytes);
  h.decode('path', bytes);
  assert.deepEqual(h.getString(0, 3, 4).bytes, Uint8Array.of(65, 66));
});

test('native history importer accepts 40-byte records and preserves the seen extra-data source', () => {
  const old = new Uint8Array(40 + 72),
    view = new DataView(old.buffer);
  old.set(new TextEncoder().encode('old-scene'));
  view.setUint32(32, 9, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, 2, true);
  view.setUint32(44, 5, true);
  old[48] = 65;
  const list = decodeNativeSceneHistory(old);
  assert.equal(list[0].scene, 'old-scene');
  assert.equal(list[0].value, 9);
  assert.equal(list[0].strings[0][0], '2:5');
  const h = new NativeSceneHistory();
  h.markSeen('main', 1);
  h.seen[0].extra = Uint8Array.of(1, 2, 3);
  const bytes = h.encode('seen', true);
  assert.throws(() => decodeNativeSceneHistory(bytes, { side: 'seen' }), /null companion/);
  const companion = Uint8Array.from({ length: 100 }, (_, i) => i);
  assert.deepEqual(
    decodeNativeSceneHistory(bytes, { side: 'seen', companionPath: companion })[0].extra,
    Uint8Array.of(48, 49, 50),
  );
});

test('scene persistence natives write original history bytes through the shared CTS entry service', () => {
  const handles = new NativeHandles(),
    source = new NativeSceneData(),
    destination = new NativeSceneData();
  source.history.markSeen('main', 12);
  source.history.appendPath('main', 10);
  const sourceHandle = handles.add('scene-data', source),
    destinationHandle = handles.add('scene-data', destination),
    file = handles.add('global-file', new NativeGlobalFile(33));
  const services = {
    handles,
    globalEntries: createGlobalEntries(handles),
    sceneDataForTask: (id) => (id === 42 ? source : null),
  };
  assert.equal(nativeSceneData(0xef, [file, 1, 42, 0, 0], null, services).value, 1);
  assert.deepEqual(services.globalEntries.read(file, 1), source.history.encode('seen'));
  assert.equal(nativeSceneData(0x182, [file, 1, destinationHandle, 0], null, services).value, 1);
  assert.equal(destination.history.seenValue('MAIN'), 12);
  assert.equal(nativeSceneData(0x181, [file, 2, sourceHandle, 1, 0], null, services).value, 1);
  services.sceneDataForTask = () => destination;
  assert.equal(nativeSceneData(0xf9, [file, 2, 42, 1], null, services).value, 1);
  assert.equal(destination.history.path[0].value, 10);
  assert.equal(nativeSceneData(0xf9, [file, 3, 42, 1], null, services).value, 0);
});

test('path extra data uses the native CTS memory record and separate copy operations', () => {
  const handles = new NativeHandles(),
    first = new NativeSceneData(),
    second = new NativeSceneData(),
    a = handles.add('scene-data', first),
    b = handles.add('scene-data', second),
    file = new NativeGlobalFile(77);
  file.write(9, Uint8Array.of(1, 2, 3));
  const save = handles.add('global-file', file),
    services = { handles };
  first.history.appendPath('first', 1);
  second.history.appendPath('second', 2);
  nativeSceneData(0x3d2, [a, save], null, services);
  const extracted = nativeSceneData(0x3d3, [a, 0], null, services).value;
  assert.equal(handles.get(extracted, 'global-file').tag, 77);
  assert.deepEqual(handles.get(extracted, 'global-file').read(9), Uint8Array.of(1, 2, 3));
  nativeSceneData(0x3d5, [b, a], null, services);
  assert.deepEqual(second.history.path[0].extra, first.history.path[0].extra);
  nativeSceneData(0x3e1, [b, a], null, services);
  assert.equal(second.history.path[0].scene, 'first');
  assert.equal(second.history.path[0].extra, null);
  let initialized = 0;
  assert.deepEqual(nativeSceneData(0xdb, [], null, { initializeSceneData: () => initialized++ }), {
    control: 2,
  });
  assert.equal(initialized, 1);
});
