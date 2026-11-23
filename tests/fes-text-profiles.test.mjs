// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { NativeFESTextLayout } from '../src/native/fes-text-layout.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { hg3, u32 } from './helpers.mjs';
import { append, files } from './fixtures/fes-log-model.mjs';

const utf8 = (text) => new TextEncoder().encode(text),
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part])),
  corpora = [utf8('あ'), encodeCP932('猫'), Uint8Array.of(0xc2, 0xa5)];

test('unreviewed STRING layouts report the profile and object type', () => {
  const profile = 'bokutomo-engine-2.6.1.67';
  assert.throws(() => new NativeFESTextLayout({ profile, type: 21 }), {
    message: `Unrecovered FES text layout object type 21 for ${profile}`,
  });
});

test('ABI 2.6.1.23 FES STRING publishes its 188-byte packet and draws and restores CP932', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    source = encodeCP932('折り返し'),
    body = encodeCP932(`#DEFINE
STRING text
#OBJECT SIZE POS PRI DISP
text 48,24 4,4 60001 1
#START
text layout vdraw 0
text layout color 32 64 128
text layout size 8
text layout frame 0
text layout shadow 0 0
text str 折り返し
text draw
text skip
next IDLE
#IDLE
#RESET
text reset
break
`),
    world = await defaultFESWorld(profile, { 'screen.fes': body });
  let fresh;
  try {
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    await task.tick();
    const text = instance.collection.lookup('text', 0),
      child = world.objects.objects.get(text.nativeTaskID),
      writer = await child.implementation.writer(),
      raw = () => new DataView(child.implementation.text.config.buffer);
    assert.equal(child.kind, 48);
    assert.equal(child.parent, instance.runtimeID);
    assert.equal(raw().byteLength, 188);
    assert.deepEqual(
      [0, 4, 8, 12, 24, 176, 180, 184].map((at) => raw().getUint32(at, true)),
      [188, 48, 24, 0xff804020, 8, 0, 0, 1],
    );
    assert.deepEqual(writer.parser.source, source);
    assert.ok(writer.frame().rgba.some((value) => value !== 0));
    await task.player.notify('RESET');
    await task.syncObjects();
    assert.deepEqual(
      [4, 8, 12, 24, 184].map((at) => raw().getUint32(at, true)),
      [48, 24, 0xff804020, 24, 1],
    );

    fresh = await defaultFESWorld(profile, {}, { initialize: false });
    await fresh.restore(world.snapshot());
    const restored = fresh.objects.objects.get(child.id).implementation;
    assert.deepEqual(restored.text.config, child.implementation.text.config);
    assert.deepEqual((await restored.writer()).parser.source, source);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('ABI 2.6.1.63 FES STRING sends the 200-byte configuration and draws retained CP932 text', async () => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    source = encodeCP932('折り返し'),
    body = encodeCP932(`#DEFINE
STRING text
#OBJECT SIZE POS PRI DISP
text 48,24 4,4 60001 1
#START
text layout vdraw 0
text layout scrolltype 1
text layout wipewidth 6
text layout color 32 64 128
text layout size 8
text layout frame 0
text layout shadow 0 0
text str 折り返し
text draw
text skip
next IDLE
#IDLE
#RESET
text reset
break
`),
    world = await defaultFESWorld(profile, { 'screen.fes': body });
  let fresh;
  try {
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    await task.tick();
    const text = instance.collection.lookup('text', 0),
      child = world.objects.objects.get(text.nativeTaskID),
      writer = await child.implementation.writer(),
      packet = new DataView(child.implementation.text.config.buffer);
    assert.equal(child.kind, 48);
    assert.equal(child.parent, instance.runtimeID);
    assert.equal(packet.byteLength, 200);
    assert.deepEqual(
      [0, 4, 8, 12, 16, 28, 104, 108, 180, 196].map((at) => packet.getUint32(at, true)),
      [200, 1, 48, 24, 0xff804020, 8, 0, 1, 6, 1],
    );
    assert.deepEqual(writer.parser.source, source);
    assert.ok(writer.frame().rgba.some((value) => value !== 0));
    await task.player.notify('RESET');
    await task.syncObjects();
    const reset = new DataView(child.implementation.text.config.buffer);
    assert.deepEqual(
      [4, 8, 12, 16, 28, 180, 196].map((at) => reset.getUint32(at, true)),
      [1, 48, 24, 0xff804020, 24, 6, 1],
    );
    fresh = await defaultFESWorld(profile, {}, { initialize: false });
    await fresh.restore(world.snapshot());
    const restored = fresh.objects.objects.get(child.id);
    assert.deepEqual(restored.implementation.text.config, child.implementation.text.config);
    assert.deepEqual((await restored.implementation.writer()).parser.source, source);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('ABI 2.6.1.63 NVSTRING retains both CP932 section writers and the divided view on reset', async () => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    source = encodeCP932('折り返し'),
    secondary = encodeCP932('猫'),
    body = encodeCP932(`#DEFINE
NVSTRING text
#OBJECT SIZE POS PRI DISP DIV
text 72,32 4,4 60001 1 18
#START
text reset
text layout size 8
text layout frame 0
text layout shadow 0 0
text insert
text apend 折り返し
text name 猫
text draw
text skip
next IDLE
#IDLE
#RESET
text reset
break
`),
    world = await defaultFESWorld(profile, { 'screen.fes': body });
  let fresh;
  try {
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    await task.tick();
    const text = instance.collection.lookup('text', 0),
      child = world.objects.objects.get(text.nativeTaskID),
      writer = await child.implementation.writer(),
      readPacket = () => new DataView(child.implementation.text.config.buffer),
      dimensions = () =>
        [0, 4, 8, 12, 20, 24, 212, 220, 224].map((at) => readPacket().getUint32(at, true));
    assert.equal(child.kind, 49);
    assert.equal(child.parent, instance.runtimeID);
    assert.equal(readPacket().byteLength, 456);
    assert.deepEqual(dimensions(), [456, 72, 32, 18, 54, 32, 0, 18, 32]);
    assert.deepEqual(writer.main[0].parser.source, source);
    assert.deepEqual(writer.sub[0].parser.source, secondary);
    assert.ok(writer.frame().rgba.some((value) => value !== 0));
    await task.player.notify('RESET');
    await task.syncObjects();
    assert.deepEqual(dimensions(), [456, 72, 32, 18, 54, 32, 0, 18, 32]);
    fresh = await defaultFESWorld(profile, {}, { initialize: false });
    await fresh.restore(world.snapshot());
    const restored = fresh.objects.objects.get(child.id).implementation;
    assert.deepEqual(restored.text.config, child.implementation.text.config);
    assert.deepEqual((await restored.writer()).sub[0].parser.source, secondary);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('ABI 2.6.1.23 NVSTRING publishes two compact CP932 layouts and restores their pixels', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    source = encodeCP932('折り返し'),
    secondary = encodeCP932('猫'),
    body = encodeCP932(`#DEFINE
NVSTRING text
#OBJECT SIZE VRAM POS PRI DISP DIV
text 72,32 2,6 4,4 60001 1 18
#START
text reset
text layout size 8
text layout frame 0
text layout shadow 0 0
text layout color 32 64 128 0 0 0 255 255 255
text insert
text apend 折り返し
text name 猫
text draw
text skip
next IDLE
#IDLE
#RESET
text reset
break
`),
    world = await defaultFESWorld(profile, { 'screen.fes': body });
  let fresh;
  try {
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    await task.tick();
    const text = instance.collection.lookup('text', 0),
      child = world.objects.objects.get(text.nativeTaskID),
      writer = await child.implementation.writer(),
      defaults = new DataView((await world.text.core.defaultPacket('nv')).buffer),
      words = (offsets) => {
        const view = new DataView(child.implementation.text.config.buffer);
        return offsets.map((at) => view.getUint32(at, true));
      };
    assert.equal(child.kind, 49);
    assert.equal(child.parent, instance.runtimeID);
    assert.equal(child.implementation.text.config.length, 432);
    assert.deepEqual(
      [0, 4, 8, 28, 32, 128, 200, 208, 212, 216, 220, 316, 396].map((at) =>
        defaults.getUint32(at, true),
      ),
      [432, 800, 600, 800, 600, 1, 0, 800, 600, 800, 600, 0, 0],
    );
    assert.deepEqual(
      words([
        0, 4, 8, 12, 20, 24, 28, 32, 36, 48, 200, 208, 212, 216, 220, 224, 236, 388, 392, 396,
      ]),
      [432, 72, 32, 18, 54, 32, 54, 32, 0xff804020, 8, 0, 18, 32, 18, 32, 0xff804020, 8, 2, 6, 1],
    );
    assert.deepEqual(writer.main[0].parser.source, source);
    assert.deepEqual(writer.sub[0].parser.source, secondary);
    const frame = writer.frame();
    assert.ok(frame.rgba.some((alpha, i) => i % 4 === 3 && (i >>> 2) % 72 < 18 && alpha));
    assert.ok(frame.rgba.some((alpha, i) => i % 4 === 3 && (i >>> 2) % 72 >= 18 && alpha));
    await task.player.notify('RESET');
    await task.syncObjects();
    assert.deepEqual(
      words([4, 8, 12, 20, 24, 36, 48, 200, 208, 212, 224, 236, 388, 392, 396]),
      [72, 32, 18, 54, 32, 0xff804020, 24, 0, 18, 32, 0xff804020, 24, 2, 6, 1],
    );
    fresh = await defaultFESWorld(profile, {}, { initialize: false });
    await fresh.restore(world.snapshot());
    const restored = fresh.objects.objects.get(child.id).implementation,
      rebuilt = await restored.writer();
    assert.deepEqual(restored.text.config, child.implementation.text.config);
    assert.deepEqual(rebuilt.sub[0].parser.source, secondary);
    assert.deepEqual(rebuilt.frame(), writer.frame());
  } finally {
    await fresh?.close();
    await world.close();
  }
});

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

test('semantic profile setter owns its explicit complete bytes value, appends once and treats direct JS strings as UTF8', () => {
  for (const profile of profiles) {
    const layout = new NativeFESTextLayout({ profile, type: 21 }),
      source = Buffer.from([0x81, 0x80, 65, 0, 66]);
    let reads = 0;
    layout.apply('prof', ['index', source], () => ++reads);
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
  test(`${profile}: prepared FES profile tails retain internal and trailing spaces through default decoding and fresh restore`, async () => {
    const line = utf8('text layout prof ++$10 ABC  LATE_1 X EXTRA  '),
      tail = utf8('ABC  $str1 X EXTRA  '),
      body = join(
        utf8(
          '#MACRO\nLATE_1 $str1\n#DEFINE\nSTRING text\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n#QUERY\n',
        ),
        line,
        utf8('\nbreak\n'),
      ),
      compressed = deflateSync(body),
      world = await defaultFESWorld(profile, {
        'screen.fes': join(
          utf8('FES\0'),
          Uint8Array.from([...u32(compressed.length), ...u32(body.length), ...u32(0)]),
          compressed,
        ),
      });
    let fresh;
    try {
      const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
      bank.setBytes(1, utf8('$str1'));
      world.configuration.scriptReplacements.add(utf8('X'), utf8('XX'));
      const h = await loadDefaultFES(world);
      bank.setBytes(1, utf8('changed bank value'));
      await h.task.syncObjects();
      const object = h.instance.collection.lookup('text', 0);
      h.instance.setGlobal(10, 0);
      assert.deepEqual(h.instance.program.blocks.QUERY[0], line);
      await h.task.player.notify('QUERY');
      assert.equal(h.instance.global(10), 1);
      assert.deepEqual(object.nativeTextState.layout.profiles.prof, { index: 1, bytes: tail });
      const saved = world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (name !== 'case.kcs') throw new Error(`prepared profile restore read ${name}`);
        return read(name);
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = task.player.root.collection.lookup('text', 0),
        calls = captureProfiles(fresh, [restored]);
      assert.deepEqual(task.player.root.program.blocks.QUERY[0], line);
      assert.deepEqual(restored.nativeTextState.layout.profiles.prof, { index: 1, bytes: tail });
      await task.syncObjects();
      assert.deepEqual(
        calls.map((call) => call.bytes),
        [tail],
      );
      assert.equal(task.player.root.global(10), 1);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile}: default layout profiles keep shared raw bytes across mixed targets, holes, raw-tail boundaries and fresh restore`, async () => {
    const lines = [
        '#MACRO\nLATE_1 $str1\n#DEFINE\nSTRING mixed[5]\n#OBJECT SIZE\nmixed 24,16\n#START\nnext IDLE\n#IDLE\n',
        ...corpora.map((bytes, i) =>
          join(utf8(`#RAW${i}\nmixed layout prof ++$10 `), bytes, utf8(' IGNORED\nbreak\n')),
        ),
        '#BANK\nmixed layout prof ++$10 LATE_1 X\nbreak\n#DROP\nmixed layout d_prof ++$10 LATE_1 X\nbreak\n#NONE\nmixed[2] layout prof ++$10 LATE_1\nbreak\n#MISSING\nmixed[0] layout prof ++$10\nbreak\n',
      ],
      world = await defaultFESWorld(profile, {
        'screen.fes': join(...lines.map((line) => (typeof line === 'string' ? utf8(line) : line))),
      });
    let fresh;
    try {
      const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id)),
        bankBytes = join(encodeCP932('猫'), Uint8Array.of(0xc2, 0xa5), utf8('X'));
      bank.setBytes(1, utf8('$str1'));
      world.configuration.scriptReplacements.add(utf8('X'), utf8('XX'));
      const h = await loadDefaultFES(world),
        { instance } = h,
        collection = instance.collection;
      bank.setBytes(1, bankBytes);
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
      for (const [i, sourceBytes] of corpora.entries()) {
        const bytes = join(sourceBytes, utf8(' IGNORED'));
        instance.setGlobal(10, 0);
        reads.length = calls.length = 0;
        await h.task.player.notify(`RAW${i}`);
        assert.equal(instance.global(10), 1);
        assert.equal(reads.filter((value) => Buffer.from(value).equals(sourceBytes)).length, 0);
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
          bytes: join(corpora[0], utf8(' IGNORED'), corpora[1], utf8(' IGNORED')),
        });
      await h.task.syncObjects();
      assert.deepEqual(
        calls.map((call) => call.bytes),
        [
          join(corpora[0], utf8(' IGNORED'), corpora[1], utf8(' IGNORED')),
          join(corpora[0], utf8(' IGNORED'), corpora[1], utf8(' IGNORED')),
        ],
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
      assert.equal(reads.filter((value) => Buffer.from(value).equals(utf8('$str1'))).length, 0);
      assert.equal(calls.length, 0);
      instance.setGlobal(10, 0);
      reads.length = 0;
      await h.task.player.notify('BANK');
      const expected = utf8('$str1 X');
      assert.equal(instance.global(10), 1);
      assert.equal(reads.filter((value) => Buffer.from(value).equals(utf8('$str1'))).length, 0);
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
      const bytes = join(encodeCP932('猫'), Uint8Array.of(0xc2, 0xa5), utf8(' $str1 X EXTRA')),
        authored = join(encodeCP932('猫'), Uint8Array.of(0xc2, 0xa5), utf8(' LATE_1 X EXTRA')),
        world = await defaultFESWorld(profile, {
          ...files,
          'screen.fes': join(
            utf8(
              `#MACRO\nLATE_1 $str1\n#DEFINE\n${type} log\n#OBJECT COUNT POS2 SIZE2 PRI\nlog 2 area:0 area:0 60000\n#START\nnext IDLE\n#IDLE\n#BIND\nlog setlog $0\nbreak\n#PROF\nlog layout prof ++$10 `,
            ),
            authored,
            utf8('\nbreak\n#DROP\nlog layout d_prof ++$10 '),
            authored,
            utf8('\nbreak\n'),
          ),
          'area.hg3': regions(),
        });
      try {
        world.configuration.scriptReplacements.add(utf8('X'), utf8('XX'));
        const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id)),
          originalProfile = bank.getBytes(1);
        bank.setBytes(1, utf8('$str1'));
        const h = await loadDefaultFES(world);
        if (originalProfile === undefined) bank.entries.delete(1);
        else bank.setBytes(1, originalProfile);
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
