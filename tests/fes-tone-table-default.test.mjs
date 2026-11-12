// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { FESImageTable } from '../src/native/fes-image-table-model.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { readFESDefinitionRecord } from '../src/native/fes-definitions.mjs';
import { setFESImageFile } from '../src/native/fes-image-driver.mjs';
import { hg3 } from './helpers.mjs';

const ascii = (s) => new TextEncoder().encode(s),
  join = (...parts) => {
    const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) {
      result.set(part, at);
      at += part.length;
    }
    return result;
  },
  keyA = Uint8Array.of(0x81, 0x7f, 0x58),
  keyB = Uint8Array.of(0xfa, 0x40, 0x59),
  tones = join(ascii('#A(11,12,13)\n'), keyA, ascii('\n#B(21,22,23)\n'), keyB, ascii('\n'));

function names() {
  const result = new Uint8Array(132);
  new DataView(result.buffer).setUint32(0, 1, true);
  result.set(keyA, 4);
  result.set(keyB, 36);
  return result;
}
function traceRuntime(h, world) {
  const calls = [],
    runtime = h.instance.runtime,
    bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
  let active = false;
  const instrument = (object, name, record) => {
    const original = object[name].bind(object);
    object[name] = (...args) => {
      if (active) record(...args);
      return original(...args);
    };
  };
  instrument(bank, 'expandBytes', (source) =>
    calls.push(['bank', Buffer.from(source).toString('hex')]),
  );
  instrument(world.configuration.scriptReplacements, 'apply', (source) =>
    calls.push(['SCRIPT', Buffer.from(source).toString('hex')]),
  );
  instrument(h.instance, 'value', (source) => calls.push(['eval', String(source)]));
  instrument(h.instance.collection, 'count', () => calls.push(['count']));
  instrument(h.instance.collection, 'lookup', (_name, index) => calls.push(['lookup', index]));
  instrument(h.instance, 'setGlobal', (index, value) => calls.push(['write', index, value]));
  const command = runtime.command.bind(runtime);
  runtime.command = async (...args) => {
    calls.length = 0;
    active = true;
    try {
      return await command(...args);
    } finally {
      active = false;
    }
  };
  return calls;
}

test('definition FILE records own plain bytes independently of Buffer and Uint8Array callers', () => {
  for (const make of [Buffer.from, (source) => new Uint8Array(source)]) {
    const source = make(Uint8Array.of(0x81, 0x7f, 0x58, 0, 0x59)),
      record = readFESDefinitionRecord([0], [source], {
        evaluate: Number,
        reference: () => {
          throw new Error('FILE must not resolve an object reference');
        },
      });
    assert.equal(Object.getPrototypeOf(record.fileBytes), Uint8Array.prototype);
    source.fill(0);
    assert.deepEqual(record.fileBytes, keyA);
  }
});

for (const profile of profiles) {
  test(`${profile} default tone query preserves drawn HG3 pixels and fresh resource ownership`, async () => {
    const source =
        '#DEFINE\nBGTABLE table\n#OBJECT TABLE FILE POS PRI DISP\ntable names tile.hg3 2,3 60001 1\n#START\nnext IDLE\n#IDLE\n#SELECT\ntable load 0 0\nbreak\n#TONE\ntable tonetbl colors\ntable gettonetbl 1 2 3\nbreak\n',
      names = new Uint8Array(132);
    new DataView(names.buffer).setUint32(0, 1, true);
    names.set(ascii('tile.hg3'), 4);
    const world = await defaultFESWorld(profile, {
      'screen.fes': ascii(source),
      names,
      'tile.hg3': hg3(2, 1, Uint8Array.of(17, 34, 51, 255, 90, 120, 150, 255)),
      colors: ascii('#A(12,34,56)\ntile.hg3'),
    });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      await h.task.player.notify('SELECT');
      await h.task.syncObjects();
      const before = await drawPixels(world, h.surface),
        expected = new Uint8ClampedArray(128 * 96 * 4);
      expected.set([17, 34, 51, 255, 90, 120, 150, 255], (3 * 128 + 2) * 4);
      assert.deepEqual(before, expected);
      await h.task.player.notify('TONE');
      await h.task.syncObjects();
      assert.deepEqual(
        [1, 2, 3].map((i) => h.instance.global(i)),
        [12, 34, 56],
      );
      assert.deepEqual(
        await drawPixels(world, h.surface),
        before,
        'query table does not apply an automatic bitmap tint',
      );
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      await fresh.restore(structuredClone(world.snapshot()));
      assert.deepEqual(await drawPixels(fresh, h.surface), before);
      const task = fresh.objects.objects.get(h.id).implementation;
      await task.player.notify('TONE');
      assert.deepEqual(
        [1, 2, 3].map((i) => task.player.root.global(i)),
        [100, 100, 100],
        'missing source replaces only the tone owner after restore',
      );
      await task.syncObjects();
      assert.deepEqual(
        await drawPixels(fresh, h.surface),
        before,
        'tone replacement leaves restored image ownership unchanged',
      );
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} default BGTABLE FILE bytes and selectors query one saved authority in a fresh World`, async (t) => {
    const source = join(
        ascii('#DEFINE\nBGTABLE bg\nBGTABLE2 bg2\n#OBJECT TABLE FILE\nbg names '),
        keyA,
        ascii('\nbg2 names2 '),
        keyB,
        ascii(
          '\n#START\nnext IDLE\n#IDLE\n#TONE\nbg tonetbl colors\nbg2 tonetbl colors\nbreak\n#QUERY\nbg gettonetbl 1 2 3\nbg2 gettonetbl 4 5 6\nbreak\n#SELECT\nbg load 0 1\nbg2 load 0 0\nbreak\n#REMOVE\nbg delete\nbg2 delete\nbreak\n',
        ),
      ),
      world = await defaultFESWorld(profile, {
        'screen.fes': source,
        names: Buffer.from(names()),
        names2: Buffer.from(
          join(encodeCP932('○,description,'), keyA, ascii(','), keyB, ascii('\n')),
        ),
        colors: tones,
      });
    let fresh;
    const originalOwners = [];
    try {
      const definitionReads = [],
        bank = world.runtime.stringBank(world.objects.objects.get(world.main.id)),
        expand = bank.expandBytes.bind(bank);
      bank.expandBytes = (bytes) => {
        definitionReads.push(Buffer.from(bytes).toString('hex'));
        return expand(bytes);
      };
      const h = await loadDefaultFES(world),
        { instance } = h,
        runtime = instance.runtime,
        bg = instance.byKey.get('bg'),
        bg2 = instance.byKey.get('bg2');
      originalOwners.push(bg, bg2);
      for (const key of [keyA, keyB])
        assert.equal(
          definitionReads.filter((hex) => hex === Buffer.from(key).toString('hex')).length,
          1,
        );
      assert.ok(runtime instanceof FESCoordinator);
      assert.equal(typeof h.task.player.runtimeFactory, 'function');
      assert.deepEqual([bg.nativeType, bg2.nativeType], [16, 17]);
      assert.deepEqual(bg.fileBytes, keyA);
      assert.deepEqual(bg2.fileBytes, keyB);
      assert.notDeepEqual(
        encodeCP932(bg.file),
        keyA,
        'a decoded resource view cannot reconstruct the query key',
      );
      for (const object of [bg, bg2]) {
        const descriptor = Object.getOwnPropertyDescriptor(object, 'file');
        assert.equal(descriptor.enumerable, false);
        assert.equal(descriptor.set, undefined);
        assert.throws(() => {
          object.file = 'independent-write';
        }, TypeError);
      }
      for (const [object, value] of [
        [bg, keyB],
        [bg2, keyA],
      ]) {
        const caller = Buffer.from(value);
        setFESImageFile(object, undefined, caller);
        caller.fill(0);
        assert.deepEqual(object.fileBytes, value);
        assert.equal(Object.getPrototypeOf(object.fileBytes), Uint8Array.prototype);
      }
      const argumentBytes = instance.argumentBytes.bind(instance),
        produced = [];
      instance.argumentBytes = (token) => {
        const result = Buffer.from(argumentBytes(token));
        if (result.equals(Buffer.from(keyA)) || result.equals(Buffer.from(keyB)))
          produced.push(result);
        return result;
      };
      try {
        await instance.applyObjects('#OBJECT FILE', join(ascii('bg '), keyA));
        await instance.applyObjects('#OBJECT FILE', join(ascii('bg2 '), keyB));
      } finally {
        instance.argumentBytes = argumentBytes;
      }
      assert.equal(produced.length, 2);
      for (const caller of produced) caller.fill(0);
      assert.deepEqual(bg.fileBytes, keyA);
      assert.deepEqual(bg2.fileBytes, keyB);
      const providers = [];
      world.game.nativeCandidates = (path, mode) => {
        providers.push([path, mode]);
        assert.equal(path, 'colors');
        assert.equal(mode, 3);
        return [
          { hit: { file: { read: async () => tones.slice() }, offset: 0, size: tones.length } },
        ];
      };
      await h.task.player.notify('TONE');
      assert.deepEqual(providers, [
        ['colors', 3],
        ['colors', 3],
      ]);
      assert.notEqual(bg.toneTable, bg2.toneTable);
      await h.task.player.notify('QUERY');
      assert.deepEqual(
        [1, 2, 3, 4, 5, 6].map((i) => instance.global(i)),
        [11, 12, 13, 21, 22, 23],
      );
      const selected = [],
        original = FESImageTable.prototype.select;
      FESImageTable.prototype.select = function (...args) {
        const result = original.apply(this, args);
        selected.push({ type: this.type, result });
        return result;
      };
      try {
        await h.task.player.notify('SELECT');
      } finally {
        FESImageTable.prototype.select = original;
      }
      assert.equal(selected.length, 2, 'one existing selection result is stored per object');
      for (const selection of selected) selection.result.fill(0);
      assert.deepEqual(bg.fileBytes, keyB);
      assert.deepEqual(bg2.fileBytes, keyA);
      for (const object of [bg, bg2])
        assert.equal(Object.getPrototypeOf(object.fileBytes), Uint8Array.prototype);
      await h.task.player.notify('QUERY');
      assert.deepEqual(
        [1, 2, 3, 4, 5, 6].map((i) => instance.global(i)),
        [21, 22, 23, 11, 12, 13],
      );
      assert.deepEqual(
        bg.toneRGB,
        [100, 100, 100],
        'query table does not automatically change explicit image tint',
      );
      const snapshot = structuredClone(world.snapshot()),
        saved = runtime.snapshot();
      for (const record of saved.collection.objects) {
        assert.equal(Object.hasOwn(record.state, 'file'), false);
        assert.ok(record.state.fileBytes instanceof Uint8Array);
        assert.ok(record.state.toneTable.files instanceof Map);
      }
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const forbidden = [],
        schedulerReads = [],
        read = fresh.game.read.bind(fresh.game),
        kcs = await world.game.read('case.kcs'),
        kcsSHA = createHash('sha256').update(kcs).digest('hex');
      fresh.game.read = fresh.game.require = async (path) => {
        // The existing scheduler restores its KCS program from the mounted game.
        // Tone/FILE/table state must need no authored FES or tone source at all.
        if (path === 'case.kcs') {
          const bytes = await read(path);
          schedulerReads.push({
            name: path,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
          return bytes;
        }
        forbidden.push(path);
        throw new Error('fresh tone restore attempted source read');
      };
      const select = FESImageTable.prototype.select,
        step = KCSMachine.prototype.step;
      let restoredSteps = 0;
      FESImageTable.prototype.select = () => {
        throw new Error('fresh tone restore replayed a selector');
      };
      KCSMachine.prototype.step = function (...args) {
        restoredSteps++;
        return step.apply(this, args);
      };
      try {
        await fresh.restore(snapshot);
        const task = fresh.objects.objects.get(h.id).implementation,
          root = task.player.root;
        assert.ok(root.runtime instanceof FESCoordinator);
        assert.deepEqual(root.runtime.snapshot(), saved);
        await task.player.notify('QUERY');
        assert.deepEqual(
          [1, 2, 3, 4, 5, 6].map((i) => root.global(i)),
          [21, 22, 23, 11, 12, 13],
        );
        assert.deepEqual(root.byKey.get('bg').fileBytes, keyB);
        assert.equal(
          Object.getOwnPropertyDescriptor(root.byKey.get('bg'), 'file').enumerable,
          false,
        );
        const owners = [root.byKey.get('bg'), root.byKey.get('bg2')];
        await task.player.notify('REMOVE');
        assert.equal(root.collection.lookup('bg'), null);
        assert.equal(root.collection.lookup('bg2'), null);
        assert.deepEqual(
          owners.map((object) => object.toneTable),
          [null, null],
        );
      } finally {
        FESImageTable.prototype.select = select;
        KCSMachine.prototype.step = step;
      }
      assert.deepEqual(forbidden, []);
      assert.deepEqual(schedulerReads, [{ name: 'case.kcs', bytes: kcs.length, sha256: kcsSHA }]);
      assert.equal(
        restoredSteps,
        0,
        'scheduler restore loads metadata without replaying KCS instructions',
      );
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
      t.diagnostic(
        JSON.stringify({
          definitionFileExpansions: 2,
          toneProviders: providers,
          selectors: selected.length,
          freshToneSourceReads: forbidden.length,
          restoredKCSSteps: restoredSteps,
          existingSchedulerReads: schedulerReads,
        }),
      );
    } finally {
      await fresh?.close();
      await world.close();
      for (const object of originalOwners) assert.equal(object.toneTable, null);
    }
  });

  test(`${profile} default whole tone commands expand once before bounds, retain holes and publish ordered globals`, async (t) => {
    const source =
        '#DEFINE\nBGTABLE mixed[5]\nVIEW ignored\n#OBJECT FILE\nmixed file\n#START\nnext IDLE\n#IDLE\n#INITIAL\nmixed tonetbl initial\nbreak\n#LOAD\nmixed tonetbl $str1\nbreak\n#QUERY\nmixed gettonetbl ++$10 ++$10 ++$10\nbreak\n#ALIAS\nmixed gettonetbl 5 5 5\nbreak\n#IGNORED\nignored tonetbl $str1\nignored gettonetbl ++$10 ++$10 ++$10\nbreak\n#MISSINGARG\nmixed tonetbl\nbreak\n#MISSING\nmixed[0] tonetbl missing\nbreak\n#EMPTY\nmixed[0] tonetbl empty\nbreak\n#EMPTYNAME\nmixed[0] tonetbl $str2\nbreak\n#DEFAULT\nmixed[0] gettonetbl 1 2 3\nbreak\n',
      world = await defaultFESWorld(profile, { 'screen.fes': ascii(source) });
    try {
      const h = await loadDefaultFES(world),
        { instance } = h,
        collection = instance.collection,
        bank = world.runtime.stringBank(world.objects.objects.get(world.main.id)),
        providers = [],
        opens = [];
      bank.setBytes(1, ascii('colorsX'));
      bank.setBytes(2, new Uint8Array());
      world.configuration.scriptReplacements.add(ascii('X'), ascii('XX'));
      let colorRead = 0;
      world.game.nativeCandidates = (path, mode) => {
        providers.push([path, mode]);
        assert.equal(mode, 3);
        if (path === 'missing' || path === '') return [];
        let body;
        if (path === 'initial') body = ascii('#A(7,8,9)\nfile');
        else if (path === 'empty') body = new Uint8Array();
        else {
          assert.equal(
            path,
            'colorsXX',
            'the provider sees unchanged expanded filename, no category/suffix',
          );
          const object = collection.objects.find((object) => object.index === (colorRead ? 2 : 0));
          assert.equal(object.toneTable, null, 'each owner is cleared before its own read');
          const r = ++colorRead * 10 + 1;
          body = ascii(`#A(${r},${r + 1},${r + 2})\nfile`);
        }
        return [
          {
            hit: {
              offset: 0,
              size: body.length,
              file: {
                read: async () => {
                  opens.push(path);
                  return body;
                },
              },
            },
          },
        ];
      };
      await h.task.player.notify('INITIAL');
      for (const [index, type] of [
        [1, 'VIEW'],
        [2, 'BGTABLE2'],
      ]) {
        await collection.remove(collection.lookup('mixed', index));
        instance.createObjects(FES_OBJECT_DEFINITION_ORDER.indexOf(type), 'mixed', index + 1);
      }
      await instance.applyObjects('#OBJECT FILE', 'mixed[2] file');
      await collection.remove(collection.lookup('mixed', 3));
      const trace = traceRuntime(h, world);
      await h.task.player.notify('LOAD');
      assert.equal(colorRead, 2);
      assert.deepEqual(
        trace.map((entry) => entry[0]),
        ['bank', 'SCRIPT', 'count', 'lookup', 'lookup', 'lookup', 'lookup'],
      );
      assert.deepEqual(
        trace.filter((entry) => entry[0] === 'lookup'),
        [
          ['lookup', 0],
          ['lookup', 1],
          ['lookup', 2],
          ['lookup', 3],
        ],
      );
      assert.equal(collection.lookup('mixed', 4).toneTable.groups.get('#a')[0], 7);
      instance.setGlobal(10, 0);
      await h.task.player.notify('QUERY');
      assert.equal(instance.global(10), 3);
      assert.deepEqual(
        [1, 2, 3].map((i) => instance.global(i)),
        [21, 22, 23],
      );
      const expression = Buffer.from(ascii('++$10')).toString('hex'),
        expectedQuery = (start) => [
          ['bank', expression],
          ['SCRIPT', expression],
          ['eval', '++$10'],
          ['write', 10, start + 1],
          ['bank', expression],
          ['SCRIPT', expression],
          ['eval', '++$10'],
          ['write', 10, start + 2],
          ['bank', expression],
          ['SCRIPT', expression],
          ['eval', '++$10'],
          ['write', 10, start + 3],
          ['count'],
          ['lookup', 0],
          ['write', start + 1, 11],
          ['write', start + 2, 12],
          ['write', start + 3, 13],
          ['lookup', 1],
          ['lookup', 2],
          ['write', start + 1, 21],
          ['write', start + 2, 22],
          ['write', start + 3, 23],
          ['lookup', 3],
        ];
      assert.deepEqual(trace, expectedQuery(0));
      instance.setGlobal(10, 7);
      await h.task.player.notify('QUERY');
      assert.deepEqual(
        trace,
        expectedQuery(7),
        'destination10 also receives RGB after all three expression counter writes',
      );
      const counterOutputTrace = structuredClone(trace);
      assert.deepEqual(
        [8, 9, 10].map((i) => instance.global(i)),
        [21, 22, 23],
      );
      await h.task.player.notify('ALIAS');
      assert.equal(instance.global(5), 23);
      assert.deepEqual(
        trace.filter((entry) => entry[0] === 'write'),
        [
          ['write', 5, 11],
          ['write', 5, 12],
          ['write', 5, 13],
          ['write', 5, 21],
          ['write', 5, 22],
          ['write', 5, 23],
        ],
      );
      const before = providers.length;
      instance.setGlobal(10, 0);
      await h.task.player.notify('IGNORED');
      assert.equal(instance.global(10), 3);
      assert.equal(providers.length, before);
      assert.deepEqual(trace, [
        ['bank', expression],
        ['SCRIPT', expression],
        ['eval', '++$10'],
        ['write', 10, 1],
        ['bank', expression],
        ['SCRIPT', expression],
        ['eval', '++$10'],
        ['write', 10, 2],
        ['bank', expression],
        ['SCRIPT', expression],
        ['eval', '++$10'],
        ['write', 10, 3],
        ['lookup', 0],
      ]);
      await h.task.player.notify('MISSINGARG');
      assert.deepEqual(trace, []);
      assert.equal(providers.length, before);
      await h.task.player.notify('MISSING');
      assert.equal(collection.lookup('mixed', 0).toneTable, null);
      await h.task.player.notify('DEFAULT');
      assert.deepEqual(
        [1, 2, 3].map((i) => instance.global(i)),
        [100, 100, 100],
      );
      await h.task.player.notify('EMPTY');
      assert.ok(collection.lookup('mixed', 0).toneTable);
      assert.equal(collection.lookup('mixed', 0).toneTable.files.size, 0);
      await h.task.player.notify('EMPTYNAME');
      assert.equal(collection.lookup('mixed', 0).toneTable, null);
      assert.deepEqual(providers.slice(-3), [
        ['missing', 3],
        ['empty', 3],
        ['', 3],
      ]);
      assert.equal(world.nativeEngine, undefined);
      t.diagnostic(
        JSON.stringify({
          providers,
          reads: opens.length,
          wholeEligibleReads: colorRead,
          missingOpens: 2,
          counterOutputTrace,
        }),
      );
    } finally {
      await world.close();
    }
  });
}
