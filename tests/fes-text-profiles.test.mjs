// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { NativeFESTextLayout } from '../src/native/fes-text-layout.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { hg3 } from './helpers.mjs';
import { append, files } from './fixtures/fes-log-model.mjs';

const utf8 = (text) => new TextEncoder().encode(text),
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part])),
  corpora = [utf8('あ'), encodeCP932('猫'), Uint8Array.of(0xc2, 0xa5)];

function regions() {
  const frame = hg3(24, 16, new Uint8Array(24 * 16 * 4)),
    output = new Uint8Array(frame.length * 2 - 12),
    view = new DataView(output.buffer);
  output.set(frame);
  output.set(frame.subarray(12), frame.length);
  view.setUint32(12, frame.length - 12, true);
  view.setUint32(frame.length + 4, 1, true);
  return output;
}

function captureProfiles(world, objects) {
  const calls = [];
  for (const object of objects) {
    const task = world.graphics.get(object.nativeTaskID);
    for (const method of ['profileEncoded', 'category']) {
      const writer = world.text.core.get(task.text.writer),
        invoke = writer[method].bind(writer);
      writer[method] = (index, bytes) => {
        calls.push({ handle: object.handle, method, index, bytes: new Uint8Array(bytes) });
        return invoke(index, bytes);
      };
    }
  }
  return calls;
}

test('layout profile owns exact byte copies, appends once, preserves each index read and treats direct JS strings as UTF8', () => {
  for (const profile of profiles) {
    const layout = new NativeFESTextLayout({ profile, type: 21 }),
      source = Buffer.from([0x81, 0x80, 65, 0, 66]);
    let reads = 0;
    layout.apply('prof', ['index', source, 'ignored'], () => ++reads);
    source.fill(0);
    assert.equal(reads, 1);
    assert.equal(layout.profiles.prof.index, 1);
    assert.deepEqual(layout.profiles.prof.bytes, Uint8Array.of(0x81, 0x80, 65));
    assert.equal(Object.getPrototypeOf(layout.profiles.prof.bytes), Uint8Array.prototype);
    layout.apply('prof', [2, 'あ']);
    assert.equal(layout.profiles.prof.index, 2);
    assert.deepEqual(layout.profiles.prof.bytes, join(Uint8Array.of(0x81, 0x80, 65), utf8('あ')));
    const restored = new NativeFESTextLayout(layout.snapshot());
    layout.profiles.prof.bytes.fill(0);
    assert.deepEqual(restored.profiles.prof.bytes, join(Uint8Array.of(0x81, 0x80, 65), utf8('あ')));
    assert.equal(restored.profiles.prof.text, undefined);
  }
});

for (const profile of profiles) {
  test(`${profile}: default layout profiles keep shared raw bytes across mixed targets, holes, single-token boundaries and fresh restore`, async () => {
    const lines = [
        '#DEFINE\nSTRING mixed[5]\n#OBJECT SIZE\nmixed 24,16\n#START\nnext IDLE\n#IDLE\n',
        ...corpora.map((bytes, i) =>
          join(utf8(`#RAW${i}\nmixed layout prof ++$10 `), bytes, utf8(' IGNORED\nbreak\n')),
        ),
        '#BANK\nmixed layout prof ++$10 $str1\nbreak\n#DROP\nmixed layout d_prof ++$10 $str1\nbreak\n#NONE\nmixed[2] layout prof ++$10 $str1\nbreak\n#MISSING\nmixed[0] layout prof ++$10\nbreak\n',
      ],
      world = await defaultFESWorld(profile, {
        'screen.fes': join(...lines.map((line) => (typeof line === 'string' ? utf8(line) : line))),
      });
    let fresh;
    try {
      const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id)),
        bankBytes = join(encodeCP932('猫'), Uint8Array.of(0xc2, 0xa5), utf8('X'));
      bank.setBytes(1, bankBytes);
      world.configuration.scriptReplacements.add(utf8('X'), utf8('XX'));
      const h = await loadDefaultFES(world),
        { instance } = h,
        collection = instance.collection;
      for (const [index, type] of [
        [2, 'NVSTRING'],
        [3, 'VIEW'],
        ...(profile === profiles[1] ? [[4, 'STRING8']] : []),
      ]) {
        await collection.remove(collection.lookup('mixed', index));
        instance.createObjects(FES_OBJECT_DEFINITION_ORDER.indexOf(type), 'mixed', index + 1);
      }
      await collection.remove(collection.lookup('mixed', 1));
      await instance.applyObjects('#OBJECT SIZE', 'mixed 24,16');
      await h.task.syncObjects();
      const objects = [0, 4].map((index) => collection.lookup('mixed', index)),
        calls = captureProfiles(world, objects),
        reads = [],
        expand = bank.expandBytes.bind(bank);
      bank.expandBytes = (bytes) => {
        reads.push(new Uint8Array(bytes));
        return expand(bytes);
      };
      for (const [i, bytes] of corpora.entries()) {
        instance.setGlobal(10, 0);
        reads.length = calls.length = 0;
        await h.task.player.notify(`RAW${i}`);
        assert.equal(instance.global(10), 1);
        assert.equal(reads.filter((value) => Buffer.from(value).equals(bytes)).length, 1);
        for (const object of objects)
          assert.deepEqual(object.nativeTextState.layout.profiles.prof, { index: 1, bytes });
        assert.equal(collection.lookup('mixed', 2).nativeTextState.layout, undefined);
        await h.task.syncObjects();
        assert.deepEqual(
          calls.map((call) => call.bytes),
          [bytes, bytes],
        );
        assert.ok(calls.every((call) => call.method === 'profileEncoded' && call.index === 1));
      }
      instance.setGlobal(10, 0);
      calls.length = 0;
      await h.task.player.notify('RAW0');
      await h.task.player.notify('RAW1');
      for (const object of objects)
        assert.deepEqual(object.nativeTextState.layout.profiles.prof, {
          index: 2,
          bytes: join(corpora[0], corpora[1]),
        });
      await h.task.syncObjects();
      assert.deepEqual(
        calls.map((call) => call.bytes),
        [join(corpora[0], corpora[1]), join(corpora[0], corpora[1])],
      );
      assert.ok(calls.every((call) => call.index === 2));
      const target = objects[1],
        encoded = Uint8Array.of(0x81, 0xff, 0x80, 65),
        packet = join(encoded, Uint8Array.of(0));
      calls.length = 0;
      await world.sendEngine(
        target.nativeTaskID,
        h.id,
        target.nativeType === 37 ? 485 : 465,
        2,
        0,
        {
          payload: { bytes: (at, length) => packet.subarray(at, at + length) },
        },
      );
      assert.deepEqual(
        calls.map((call) => call.bytes),
        [encoded],
      );
      instance.setGlobal(10, 0);
      reads.length = calls.length = 0;
      await h.task.player.notify('NONE');
      assert.equal(instance.global(10), 1);
      assert.equal(reads.filter((value) => Buffer.from(value).equals(utf8('$str1'))).length, 1);
      assert.equal(calls.length, 0);
      instance.setGlobal(10, 0);
      reads.length = 0;
      await h.task.player.notify('BANK');
      const expected = join(bankBytes, utf8('X'));
      assert.equal(instance.global(10), 1);
      assert.equal(reads.filter((value) => Buffer.from(value).equals(utf8('$str1'))).length, 1);
      for (const object of objects)
        assert.deepEqual(object.nativeTextState.layout.profiles.prof.bytes, expected);
      const saved = world.snapshot();
      bank.setBytes(1, utf8('changed after capture'));
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (name !== 'case.kcs') throw new Error(`profile restore read ${name}`);
        return read(name);
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = [0, 4].map((index) => task.player.root.collection.lookup('mixed', index)),
        restoredCalls = captureProfiles(fresh, restored);
      for (const object of restored)
        assert.deepEqual(object.nativeTextState.layout.profiles.prof.bytes, expected);
      await task.syncObjects();
      assert.deepEqual(
        restoredCalls.map((call) => call.bytes),
        [expected, expected],
      );
      assert.equal(task.player.root.global(10), 1);
      instance.setGlobal(10, 0);
      bank.setBytes(1, bankBytes);
      calls.length = 0;
      await h.task.player.notify('DROP');
      for (const object of objects)
        assert.deepEqual(object.nativeTextState.layout.profiles.d_prof.bytes, expected);
      await h.task.syncObjects();
      assert.deepEqual(
        calls.filter((call) => call.method === 'category').map((call) => call.bytes),
        [expected, expected],
      );
      await assert.rejects(h.task.player.notify('MISSING'), /requires profile text/);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  for (const type of profile === profiles[0] ? ['LOGSTRING'] : ['LOGSTRING', 'LOGSTRING8'])
    test(`${profile}: default ${type} prof owns exact bytes only in its original main-child subset`, async () => {
      const bytes = join(encodeCP932('猫'), Uint8Array.of(0xc2, 0xa5)),
        world = await defaultFESWorld(profile, {
          ...files,
          'screen.fes': join(
            utf8(
              `#DEFINE\n${type} log\n#OBJECT COUNT POS2 SIZE2 PRI\nlog 2 area:0 area:0 60000\n#START\nnext IDLE\n#IDLE\n#BIND\nlog setlog $0\nbreak\n#PROF\nlog layout prof ++$10 `,
            ),
            bytes,
            utf8('\nbreak\n#DROP\nlog layout d_prof ++$10 '),
            bytes,
            utf8('\nbreak\n'),
          ),
          'area.hg3': regions(),
        });
      try {
        const h = await loadDefaultFES(world);
        await h.task.syncObjects();
        await h.task.syncObjects();
        const object = h.instance.collection.lookup('log', 0),
          log = world.displayLogs.create(h.id),
          model = world.displayLogs.get(log);
        append(world.displayLogs, model, 'A');
        append(world.displayLogs, model, 'B');
        h.instance.setGlobal(0, log);
        await h.task.player.notify('BIND');
        const children = object.slots.flatMap((slot) =>
            [slot.main, slot.secondary]
              .filter((handle) => handle !== null)
              .map((handle) => h.instance.collection.graph.get(handle)),
          ),
          calls = captureProfiles(world, children);
        h.instance.setGlobal(10, 0);
        await h.task.player.notify('PROF');
        assert.equal(h.instance.global(10), 1);
        assert.equal(object.slots.length, 2);
        for (const slot of object.slots) {
          const main = h.instance.collection.graph.get(slot.main);
          assert.deepEqual(main.nativeTextState.layout.profiles.prof, { index: 1, bytes });
          if (slot.secondary !== null) {
            const secondary = h.instance.collection.graph.get(slot.secondary);
            assert.equal(secondary.nativeTextState.layout.profiles.prof, undefined);
          }
        }
        await h.task.syncObjects();
        assert.deepEqual(
          calls.map((call) => call.handle),
          object.slots.map((slot) => slot.main),
        );
        assert.ok(calls.every((call) => Buffer.from(call.bytes).equals(bytes)));
        calls.length = 0;
        await h.task.player.notify('DROP');
        assert.equal(h.instance.global(10), 2);
        for (const slot of object.slots)
          assert.equal(
            h.instance.collection.graph.get(slot.main).nativeTextState.layout.profiles.d_prof,
            undefined,
          );
        await h.task.syncObjects();
        assert.equal(calls.length, 0);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
      }
    });
}
