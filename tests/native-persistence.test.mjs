// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply } from '../src/kcs/vm.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import {
  NativeGlobalFile,
  createGlobalEntries,
  nativePersistence,
  serializeStringBank,
  importStringBank,
} from '../src/native/persistence.mjs';

const machine = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(2048),
    stackSize: 1024,
  });
test('global-file records append duplicate IDs and read the first match through nested snapshots', async () => {
  const file = new NativeGlobalFile(3500);
  file.write(7, Uint8Array.of(1, 2, 3));
  file.write(7, Uint8Array.of(4));
  file.write(8, new Uint8Array());
  assert.deepEqual(file.read(7), Uint8Array.of(1, 2, 3));
  assert.equal(file.read(9), null);
  assert.equal(file.tag, 3500);
  const raw = NativeGlobalFile.fromRaw(file.raw());
  assert.deepEqual(raw.snapshot(), file.snapshot());
  const saved = await file.file(),
    loaded = await NativeGlobalFile.fromFile(saved);
  assert.equal(new Binary(saved).str(0, 4, 'utf-8'), 'CSS');
  assert.deepEqual(loaded.records, file.records);
  file.remove(7);
  assert.deepEqual(file.read(7), Uint8Array.of(4));
  assert.equal(file.capacity, 0x80000 - 11);
  raw.capacity = raw.used;
  raw.remove(8);
  assert.equal(raw.records.length, 3);
});

test('string variable persistence sorts unsigned indices, replaces the bank, and ignores reported padding', () => {
  const bank = new NativeStringBank();
  bank.set(8, '猫');
  bank.set(2, '');
  bank.set(0xffffffff, 'end');
  const bytes = serializeStringBank(bank),
    b = new Binary(bytes);
  assert.equal(b.u32(0), 3);
  assert.equal(b.u32(4), 2);
  assert.equal(b.u32(9), 8);
  const restored = new NativeStringBank();
  restored.set(9, 'old');
  importStringBank(restored, bytes);
  assert.equal(restored.get(9), undefined);
  assert.equal(restored.get(8), '猫');
  assert.equal(restored.get(-1), 'end');
  assert.equal(restored.dirty, true);
});

test('global-file clear retains its tag and restores initial capacity while clones own independent payloads', () => {
  const m = machine(),
    handles = new NativeHandles(),
    services = { handles },
    call = (id, args) => nativePersistence(id, args, m, services),
    source = call(0xee, [0xcafebabe]).value;
  m.bytes(64, 4).set([1, 2, 3, 4]);
  call(0xf4, [source, 7, 4, 64]);
  const copy = call(0x186, [source]).value;
  assert.notEqual(copy, source);
  handles.get(source, 'global-file').read(7)[0] = 90;
  assert.deepEqual(handles.get(copy, 'global-file').read(7), Uint8Array.of(1, 2, 3, 4));
  assert.deepEqual(call(0x185, [source]), { control: 1, value: 1 });
  assert.equal(call(0xf8, [source]).value, 0xcafebabe);
  assert.equal(handles.get(source, 'global-file').used, 0);
  assert.equal(handles.get(source, 'global-file').capacity, 0x80000);
  assert.equal(handles.get(copy, 'global-file').used, 12);
  assert.deepEqual(call(0x185, [0]), { control: 1, value: 0 });
  assert.deepEqual(call(0x186, [0]), { control: 1, value: 0 });
});

test('native global entries bridge shared resource handles and copy bounded guest ranges', () => {
  const handles = new NativeHandles(),
    m = machine(),
    strings = new NativeStringBank();
  const bank = new NativeVariableBank();
  bank.initialize(5);
  bank.words.set([1, 2, 3, 4, 5]);
  const services = { handles, strings, variableBankForTask: (task) => (task === 42 ? bank : null) };
  const { value: handle } = nativePersistence(0xee, [901], m, services);
  const bridge = createGlobalEntries(handles);
  bridge.write(handle, 1, Uint8Array.of(9, 8, 7));
  assert.deepEqual(bridge.read(handle, 1), Uint8Array.of(9, 8, 7));
  m.bytes(200, 10).fill(0xaa);
  assert.deepEqual(nativePersistence(0xfe, [handle, 1, 200, 2], m, services), nativeReply(1, 2));
  assert.deepEqual([...m.bytes(200, 4)], [9, 8, 0xaa, 0xaa]);
  assert.deepEqual(nativePersistence(0xf0, [handle, 2, 42, 3, 9], m, services), nativeReply(1, 1));
  assert.equal(bridge.read(handle, 2).length, 8);
  bank.words.fill(0);
  nativePersistence(0xfa, [handle, 2, 42, 0], m, services);
  assert.deepEqual([...bank.words], [4, 5, 0, 0, 0]);
  strings.set(1, '猫');
  nativePersistence(0xf3, [handle, 3], m, services);
  strings.set(1, 'changed');
  nativePersistence(0xfd, [handle, 3], m, services);
  assert.equal(strings.get(1), '猫');
  assert.deepEqual(nativePersistence(0xf8, [handle], m, services), nativeReply(1, 901));
  nativePersistence(0xf6, [handle], m, services);
  assert.throws(() => bridge.read(handle, 1), /released/);
});

test('disk save services preserve names and timestamp policy, reopen native CSS data, and expose file time', async () => {
  const handles = new NativeHandles(),
    m = machine(),
    disk = new Map();
  const services = {
    handles,
    contextName: 'saves/profile-one',
    format: (at) => m.string(at),
    persistence: {
      read: async (name) => disk.get(name) ?? null,
      write: async (name, bytes, options) => {
        assert.equal(options.updateModified, false);
        disk.set(name, bytes);
        return true;
      },
      stat: async () => ({ modifiedMs: new Date(2020, 2, 4, 5, 6, 7).getTime() }),
      remove: async (name) => disk.delete(name),
    },
  };
  m.writeString('save01.dat', 0);
  const handle = nativePersistence(0xee, [100], m, services).value;
  createGlobalEntries(handles).write(handle, 10, Uint8Array.of(1, 2, 3));
  assert.deepEqual(await nativePersistence(0x407, [handle, 0], m, services), nativeReply(1, 1));
  assert.ok(disk.has('saves/profile-one/save01.dat'));
  const reopened = await nativePersistence(0xf7, [0], m, services);
  assert.deepEqual(createGlobalEntries(handles).read(reopened.value, 10), Uint8Array.of(1, 2, 3));
  assert.deepEqual(
    await nativePersistence(0xff, [0, 100, 104, 108, 112, 116], m, services),
    nativeReply(1, 1),
  );
  assert.deepEqual(
    [100, 104, 108, 112, 116].map((at) => m.load(at)),
    [2020, 3, 4, 5, 6],
  );
  await nativePersistence(0x3de, [0], m, services);
  assert.deepEqual(await nativePersistence(0xf7, [0], m, services), nativeReply(1, 0));
  assert.equal(nativePersistence(0xf7, [0], m, { handles }), undefined);
});
