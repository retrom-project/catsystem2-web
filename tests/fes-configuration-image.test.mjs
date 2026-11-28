// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { hg3 } from './helpers.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';

const utf8 = (value) => new TextEncoder().encode(value),
  decoder = new TextDecoder('shift_jis'),
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part])),
  game = profiles[1],
  pixel = (n) => Uint8Array.of(n, 34, 51, 255);
function language(world, prefix = 'old') {
  Object.assign(world.configuration.language, {
    entries: [{ prefix, name: prefix, code: 1041 }],
    default: 0,
    ui: 0,
    main: 0,
  });
}
async function freshWorld(profile, state) {
  const world = await defaultFESWorld(profile, {}, { initialize: false }),
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    if (name !== 'case.kcs') throw new Error('configuration image restore read ' + name);
    return read(name);
  };
  try {
    await world.restore(state);
    return world;
  } catch (error) {
    await world.close();
    throw error;
  }
}

test('Game pre-notify visits all ten live image families in current key order and keeps proven RET/no-instance families unchanged through fresh restore', async () => {
  const declarations = [
      ['IMAGE', 'z'],
      ['BUTTON', 'a'],
      ['PANEL', 'm'],
      ['SAVEPANEL', 'b'],
      ['BGTABLE', 'y'],
      ['BGTABLE2', 'c'],
      ['CHTABLE', 'x'],
      ['CHTABLE2', 'd'],
      ['CHTABLE3', 'w'],
      ['IMGWND', 'e'],
    ],
    source =
      '#DEFINE\n' +
      declarations.map(([type, name]) => type + ' ' + name).join('\n') +
      '\nCIMAGE ignored\nSOUND snd\nSCROLL ctrl\nNVSTRING nv\nPLANE plane\nNUMIMG holes[2]\n#START\nnext IDLE\n#IDLE\n#MES_CHANGECONFIG\nbreak\n',
    world = await defaultFESWorld(game, { 'screen.fes': utf8(source) });
  let fresh;
  try {
    const h = await loadDefaultFES(world),
      noops = h.instance.objects.filter(
        (object) => !declarations.some(([, name]) => name === object.baseName),
      ),
      before = noops.map((object) => [object.handle, object.dirty]),
      calls = [],
      refresh = world.imagesFES.configurationChanged.bind(world.imagesFES),
      notify = h.task.player.notify.bind(h.task.player);
    world.imagesFES.configurationChanged = (object) => {
      calls.push(object.baseName);
      return refresh(object);
    };
    h.task.player.notify = (label, ...args) => {
      calls.push(label);
      return notify(label, ...args);
    };
    assert.equal(await world.sendEngine(h.id, world.main.id, 19), NATIVE_UNWRITTEN_WORD);
    const expected = declarations
      .map(([, name]) => name)
      .sort()
      .concat('MES_CHANGECONFIG');
    assert.deepEqual(calls, expected);
    assert.deepEqual(
      noops.map((object) => [object.handle, object.dirty]),
      before,
    );
    assert.equal(h.instance.collection.lookup('holes', 0), null);
    for (const [type, name] of declarations) {
      const object = h.instance.collection.lookup(name, 0);
      assert.deepEqual(object.fileSourceBytes, new Uint8Array(), type);
      assert.deepEqual(object.fileBytes, new Uint8Array(), type);
      assert.equal(Object.getOwnPropertyDescriptor(object, 'file').enumerable, false);
    }
    fresh = await freshWorld(game, world.snapshot());
    const freshCalls = [],
      freshRefresh = fresh.imagesFES.configurationChanged.bind(fresh.imagesFES);
    fresh.imagesFES.configurationChanged = (object) => {
      freshCalls.push(object.baseName);
      return freshRefresh(object);
    };
    await fresh.sendEngine(h.id, fresh.main.id, 19);
    assert.deepEqual(freshCalls, expected.slice(0, -1));
    assert.equal(world.nativeEngine, undefined);
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

for (const profile of profiles)
  test(`${profile}: default message19 retains its ABI image/notification/FIFO order and actual Draw/D5 pixels through fresh restore`, async () => {
    const isGame = profile === game,
      source =
        '#DEFINE\nIMAGE z\nIMAGE a\nSTRING text\n#OBJECT FILE POS PRI DISP\nz ' +
        (isGame ? 'tile_%LANG%' : 'tile_old') +
        ' 6,4 60000 1\na ' +
        (isGame ? 'tile_%LANG%' : 'tile_old') +
        ' 3,4 60001 1\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n#MES_CHANGECONFIG\nz load tile_notify\ntext layout fontind 11 NotificationFace\nbreak\n',
      world = await defaultFESWorld(profile, {
        'screen.fes': utf8(source),
        'tile_old.hg3': hg3(1, 1, pixel(17)),
        'tile_new.hg3': hg3(1, 1, pixel(68)),
        'tile_notify.hg3': hg3(1, 1, pixel(119)),
      });
    let fresh;
    try {
      if (isGame) language(world);
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const initial = await drawPixels(world, h.surface),
        calls = [],
        image = world.imagesFES.configurationChanged.bind(world.imagesFES),
        text = world.text.fes.configurationChanged.bind(world.text.fes),
        notify = h.task.player.notify.bind(h.task.player);
      world.imagesFES.configurationChanged = (object) => {
        calls.push(['image', object.key]);
        return image(object);
      };
      world.text.fes.configurationChanged = (object) => {
        calls.push(['text', object.key]);
        return text(object);
      };
      h.task.player.notify = (label, ...args) => {
        calls.push(['notify', label]);
        return notify(label, ...args);
      };
      world.configuration.fields.font.name = 'CurrentFace';
      if (isGame) world.configuration.language.entries[0].prefix = 'new';
      await world.sendEngine(h.id, world.main.id, 19);
      assert.deepEqual(
        calls,
        isGame
          ? [
              ['image', 'a'],
              ['image', 'z'],
              ['notify', 'MES_CHANGECONFIG'],
              ['text', 'text'],
            ]
          : [['text', 'text']],
      );
      const a = h.instance.collection.lookup('a', 0),
        z = h.instance.collection.lookup('z', 0),
        object = h.instance.collection.lookup('text', 0);
      assert.deepEqual(
        [a.file, z.file],
        isGame ? ['tile_new', 'tile_notify'] : ['tile_old', 'tile_old'],
      );
      if (isGame) {
        assert.deepEqual(a.fileSourceBytes, utf8('tile_%LANG%'));
        assert.deepEqual(z.fileSourceBytes, utf8('tile_notify'));
      } else assert.equal(Object.hasOwn(a, 'fileSourceBytes'), false);
      await h.task.syncObjects();
      const pixels = await drawPixels(world, h.surface),
        expected = new Uint8ClampedArray(128 * 96 * 4);
      expected.set(pixel(isGame ? 68 : 17), (4 * 128 + 3) * 4);
      expected.set(pixel(isGame ? 119 : 17), (4 * 128 + 6) * 4);
      assert.deepEqual(pixels, expected);
      if (isGame) assert.notDeepEqual(pixels, initial);
      else assert.deepEqual(pixels, initial);
      const writer = await world.graphics.get(object.nativeTaskID).writer();
      assert.deepEqual(writer.config, world.text.fes.layout(object).config());
      fresh = await freshWorld(profile, world.snapshot());
      const task = fresh.objects.objects.get(h.id).implementation;
      assert.deepEqual(await drawPixels(fresh, h.surface), pixels);
      await fresh.sendEngine(h.id, fresh.main.id, 19);
      await task.syncObjects();
      assert.deepEqual(await drawPixels(fresh, h.surface), pixels);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

test('Game FILE bank/SCRIPT bytes are expanded once into SOURCE and language callbacks/fresh restore never replay them', async (t) => {
  const original = join(Uint8Array.of(0x87, 0x90), utf8('X_%LANG%')),
    expanded = join(Uint8Array.of(0x87, 0x90), utf8('XX_%LANG%')),
    old = join(Uint8Array.of(0x87, 0x90), utf8('XX_old')),
    current = join(Uint8Array.of(0x87, 0x90), utf8('XX_'), encodeCP932('猫')),
    source =
      '#DEFINE\nIMAGE picture[2]\n#OBJECT FILE POS PRI DISP\npicture $str0 3,4 60000 1\n#START\nnext IDLE\n#IDLE\n#LOAD\npicture load $str0\nbreak\n',
    world = await defaultFESWorld(game, {
      'screen.fes': utf8(source),
      [(decoder.decode(old) + '.hg3').toLowerCase()]: hg3(1, 1, pixel(17)),
      [(decoder.decode(current) + '.hg3').toLowerCase()]: hg3(1, 1, pixel(68)),
    });
  let fresh;
  try {
    language(world);
    const requests = [],
      readCategory = world.game.readCategory.bind(world.game);
    world.game.readCategory = (name, category) => {
      if (category === 'image') requests.push(name);
      return readCategory(name, category);
    };
    const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
    bank.setBytes(0, original);
    world.configuration.scriptReplacements.add(utf8('X'), utf8('XX'));
    const h = await loadDefaultFES(world);
    await h.task.tick();
    for (const object of h.instance.objects) {
      assert.deepEqual(object.fileSourceBytes, expanded);
      assert.deepEqual(object.fileBytes, old);
    }
    const calls = [],
      expand = bank.expandBytes.bind(bank),
      apply = world.configuration.scriptReplacements.apply.bind(
        world.configuration.scriptReplacements,
      ),
      command = h.instance.runtime.command.bind(h.instance.runtime);
    let active = false;
    bank.expandBytes = (bytes) => {
      if (active) calls.push('bank');
      return expand(bytes);
    };
    world.configuration.scriptReplacements.apply = (bytes) => {
      if (active) calls.push('SCRIPT');
      return apply(bytes);
    };
    h.instance.runtime.command = async (...args) => {
      active = true;
      try {
        return await command(...args);
      } finally {
        active = false;
      }
    };
    await h.task.player.notify('LOAD');
    assert.deepEqual(calls, ['bank', 'SCRIPT', 'bank', 'SCRIPT']);
    calls.length = 0;
    world.configuration.language.entries[0].prefix = '猫';
    active = true;
    await world.sendEngine(h.id, world.main.id, 19);
    active = false;
    assert.deepEqual(calls, []);
    for (const object of h.instance.objects) {
      assert.deepEqual(object.fileSourceBytes, expanded);
      assert.deepEqual(
        object.fileBytes,
        join(Uint8Array.of(0x87, 0x90), utf8('XX_'), encodeCP932('猫')),
      );
      assert.equal(Object.keys(object).includes('file'), false);
    }
    active = true;
    await h.task.syncObjects();
    active = false;
    assert.deepEqual(calls, [], 'actual image driving does not expand saved FILE again');
    const expectedPixels = new Uint8ClampedArray(128 * 96 * 4);
    expectedPixels.set(pixel(68), (4 * 128 + 3) * 4);
    t.diagnostic(
      JSON.stringify({
        requests,
        resourceKey: decoder.decode(current),
        objects: h.instance.objects.map((o) => ({
          file: o.file,
          disp: o.disp,
          pri: o.pri,
          image: o.imageResource,
          source: o.nativeImageSource,
        })),
      }),
    );
    assert.deepEqual(await drawPixels(world, h.surface), expectedPixels);
    fresh = await freshWorld(game, world.snapshot());
    const root = fresh.objects.objects.get(h.id).implementation.player.root;
    for (const object of root.objects) assert.deepEqual(object.fileSourceBytes, expanded);
    await fresh.sendEngine(h.id, fresh.main.id, 19);
    for (const object of root.objects) assert.deepEqual(object.fileSourceBytes, expanded);
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('Game BGTABLE selects CURRENT once while configuration refresh uses saved SOURCE without reselecting through fresh restore', async () => {
  const names = new Uint8Array(132);
  new DataView(names.buffer).setUint32(0, 1, true);
  names.set(utf8('picked'), 4);
  const world = await defaultFESWorld(game, {
    'screen.fes': utf8(
      '#DEFINE\nBGTABLE table\n#OBJECT TABLE FILE\ntable names source_%LANG%\n#START\nnext IDLE\n#IDLE\n#SELECT\ntable load 0 0\nbreak\n',
    ),
    names,
    'picked.hg3': hg3(1, 1, pixel(17)),
    'source_old.hg3': hg3(1, 1, pixel(68)),
    'source_new.hg3': hg3(1, 1, pixel(119)),
  });
  let fresh;
  try {
    language(world);
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const object = h.instance.collection.lookup('table', 0),
      select = world.imagesFES.selectTable.bind(world.imagesFES);
    let selections = 0;
    world.imagesFES.selectTable = (...args) => {
      selections++;
      return select(...args);
    };
    await h.task.player.notify('SELECT');
    assert.equal(selections, 1);
    assert.deepEqual(object.fileBytes, utf8('picked'));
    assert.deepEqual(object.fileSourceBytes, utf8('source_%LANG%'));
    world.configuration.language.entries[0].prefix = 'new';
    await world.sendEngine(h.id, world.main.id, 19);
    assert.equal(selections, 1);
    assert.deepEqual(object.fileBytes, utf8('source_new'));
    await h.task.syncObjects();
    fresh = await freshWorld(game, world.snapshot());
    fresh.imagesFES.selectTable = () => {
      throw new Error('configuration restore reselected table');
    };
    await fresh.sendEngine(h.id, fresh.main.id, 19);
    const restored = fresh.objects.objects
      .get(h.id)
      .implementation.player.root.collection.lookup('table', 0);
    assert.deepEqual(restored.fileBytes, utf8('source_new'));
    assert.deepEqual(restored.fileSourceBytes, utf8('source_%LANG%'));
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('Game C-locale filename comparison folds original ASCII trail bytes and preserves existing change flags and owned SOURCE/CURRENT', async () => {
  const first = Uint8Array.of(0x82, 0x41),
    second = Uint8Array.of(0x82, 0x61),
    world = await defaultFESWorld(game, {
      'screen.fes': utf8('#DEFINE\nIMAGE picture\n#START\nnext IDLE\n#IDLE\n'),
    });
  let fresh;
  try {
    const h = await loadDefaultFES(world),
      object = h.instance.collection.lookup('picture', 0),
      input = Buffer.from(first);
    h.instance.runtime.setImageFile(object, undefined, input);
    input.fill(0);
    assert.deepEqual(object.fileSourceBytes, first);
    await h.task.syncObjects();
    assert.equal(object.imageChanged, false);
    h.instance.runtime.setImageFile(object, undefined, second);
    assert.deepEqual(object.fileSourceBytes, second);
    assert.deepEqual(object.fileBytes, second);
    assert.equal(object.imageChanged, false, 'the original comparator does not skip CP932 pairs');
    h.instance.runtime.setImageFile(object, undefined, utf8('changed'));
    h.instance.runtime.setImageFile(object, undefined, second);
    assert.equal(object.imageChanged, true);
    await world.sendEngine(h.id, world.main.id, 19);
    assert.equal(object.imageChanged, true, 'equal filenames do not clear an earlier request');
    assert.throws(
      () => h.instance.runtime.setImageFile(object, 'lost bytes'),
      /original narrow bytes/,
    );
    assert.throws(
      () => h.instance.runtime.setImageFile(object, undefined, new Uint8Array(256).fill(65)),
      /256-byte CString/,
    );
    fresh = await freshWorld(game, world.snapshot());
    const restored = fresh.objects.objects
      .get(h.id)
      .implementation.player.root.collection.lookup('picture', 0);
    assert.deepEqual(restored.fileSourceBytes, second);
    assert.deepEqual(restored.fileBytes, second);
    assert.equal(restored.fileBytes.constructor, Uint8Array);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('Game language replacements keep original FILE bytes, separate UI/main fallback and unresolved markers', async () => {
  const sourceName = utf8('猫_%LANG%_%LANG_M%'),
    source = join(
      utf8('#DEFINE\nIMAGE picture\n#OBJECT FILE\npicture '),
      sourceName,
      utf8('\n#START\nnext IDLE\n#IDLE\n'),
    ),
    world = await defaultFESWorld(game, { 'screen.fes': source });
  try {
    Object.assign(world.configuration.language, {
      entries: [
        { prefix: 'U', name: 'UI', code: 1041 },
        { prefix: 'M', name: 'Main', code: 1041 },
        { prefix: 'D', name: 'Default', code: 1041 },
      ],
      default: 2,
      ui: 0,
      main: 1,
    });
    const h = await loadDefaultFES(world),
      object = h.instance.collection.lookup('picture', 0),
      prefix = utf8('猫_');
    assert.deepEqual(object.fileSourceBytes, sourceName);
    assert.deepEqual(object.fileBytes, join(prefix, utf8('U_M')));
    Object.assign(world.configuration.language, { ui: 0xffffffff, main: 0xffffffff });
    await world.sendEngine(h.id, world.main.id, 19);
    assert.deepEqual(object.fileBytes, join(prefix, utf8('D_D')));
    world.configuration.language.default = 0xffffffff;
    await world.sendEngine(h.id, world.main.id, 19);
    assert.deepEqual(object.fileBytes, sourceName, 'missing entries leave markers literal');
    Object.assign(world.configuration.language, { ui: 0, main: 1 });
    world.configuration.language.entries[0].prefix = '%LANG_M%';
    await world.sendEngine(h.id, world.main.id, 19);
    assert.deepEqual(
      object.fileBytes,
      join(prefix, utf8('M_M')),
      'UI runs before the main replacement',
    );
    world.configuration.language.entries[0].prefix = '猫\0ignored';
    await world.sendEngine(h.id, world.main.id, 19);
    assert.deepEqual(object.fileBytes, join(prefix, encodeCP932('猫'), utf8('_M')));
    assert.deepEqual(object.fileSourceBytes, sourceName);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});
