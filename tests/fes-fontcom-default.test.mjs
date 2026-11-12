// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { defaultFESWorld, loadDefaultFES, profiles } from './fixtures/default-fes-world.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { CanvasRenderer } from '../src/render/canvas.mjs';

const ascii = (s) => new TextEncoder().encode(s),
  fonts = [
    { face: 'Fixed', fullName: '固定 幅', charset: 128, pitchAndFamily: 1 },
    { face: 'fixed', fullName: 'duplicate', charset: 128, pitchAndFamily: 1 },
    { face: 'Proportional', fullName: '可変幅', charset: 128, pitchAndFamily: 2 },
    { face: '@Vertical', fullName: '@縦書き', charset: 128, pitchAndFamily: 1 },
    { face: 'Latin', fullName: 'Latin', charset: 0, pitchAndFamily: 1 },
    { face: 'Raster', fullName: 'Raster', charset: 128, pitchAndFamily: 1, type: 1 },
  ];
function traceFrontends(h, world) {
  const calls = [],
    instance = h.instance,
    platform = instance.runtime.platform,
    bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
  let active = false;
  for (const [object, name, category] of [
    [bank, 'expandBytes', 'bank'],
    [world.configuration.scriptReplacements, 'apply', 'SCRIPT'],
    [instance, 'value', 'eval'],
    [instance, 'setGlobal', 'write'],
    [instance.runtime, 'writeString', 'string'],
  ]) {
    const original = object[name].bind(object);
    object[name] = (...args) => {
      if (active)
        calls.push([
          category,
          ...args.map((v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)),
        ]);
      return original(...args);
    };
  }
  const command = platform.command.bind(platform);
  platform.command = (...args) => {
    active = true;
    try {
      return command(...args);
    } finally {
      active = false;
    }
  };
  return { calls, bank, clear: () => (calls.length = 0) };
}
const categories = (calls) => calls.map(([name]) => name);
function preparedFES(bytes) {
  const compressed = deflateSync(bytes),
    packed = new Uint8Array(16 + compressed.length),
    header = new DataView(packed.buffer);
  packed.set(ascii('FES\0'));
  header.setUint32(4, compressed.length, true);
  header.setUint32(8, bytes.length, true);
  packed.set(compressed, 16);
  return packed;
}

for (const profile of profiles) {
  for (const terminator of ['trailing-space', 'NUL-after-space']) {
    test(`${profile} prepared zlib FES fontcom search ${terminator} evaluates output but does not search or write a result`, async () => {
      const prefix =
          '#START\r\nnext IDLE\r\n#IDLE\r\n#INIT\r\nfontcom init\r\nbreak\r\n#QUERY\r\nfontcom search ++$10 ',
        source = ascii(
          prefix +
            (terminator === 'trailing-space'
              ? '\r\nbreak\r\n\0'
              : '\0ignored-suffix\r\n$11=101\r\n'),
        ),
        world = await defaultFESWorld(profile, { 'screen.fes': preparedFES(source) });
      world.host.nativeFontFamilies = () => [
        { face: 'Empty', fullName: '', charset: 128, pitchAndFamily: 1 },
      ];
      try {
        const h = await loadDefaultFES(world),
          t = traceFrontends(h, world);
        assert.ok(h.instance.runtime instanceof FESCoordinator);
        assert.equal(h.instance.program.sources[0].prepared, true);
        assert.deepEqual(h.instance.program.blocks.QUERY[0], ascii('fontcom search ++$10 '));
        assert.equal(
          h.instance.program.blocks.QUERY.length,
          terminator === 'trailing-space' ? 2 : 1,
        );
        await h.task.tick();
        await h.task.player.notify('INIT');
        assert.deepEqual(h.instance.runtime.platform.fonts.names, [new Uint8Array()]);
        let searches = 0;
        const search = h.instance.runtime.platform.fonts.search.bind(
          h.instance.runtime.platform.fonts,
        );
        h.instance.runtime.platform.fonts.search = (...args) => {
          searches++;
          return search(...args);
        };
        h.instance.setGlobal(10, 9);
        t.clear();
        await h.task.player.notify('QUERY');
        assert.equal(
          searches,
          0,
          'native tail getter returns NULL when the third space points to NUL',
        );
        assert.equal(
          h.instance.global(10),
          10,
          'the output-index increment remains; no aliased lookup output overwrites it',
        );
        assert.equal(h.instance.global(11), 0, 'bytes after source NUL are not parsed or executed');
        assert.deepEqual(t.calls, [
          ['bank', Buffer.from(ascii('search')).toString('hex')],
          ['SCRIPT', Buffer.from(ascii('search')).toString('hex')],
          ['bank', Buffer.from(ascii('++$10')).toString('hex')],
          ['SCRIPT', Buffer.from(ascii('++$10')).toString('hex')],
          ['eval', '++$10'],
          ['write', 10, 10],
        ]);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
      }
    });
  }
  test(`${profile} ordinary fontcom gates outputs and owns one synchronous current enumeration`, async () => {
    const source = ascii(
        '#START\nnext IDLE\n#IDLE\n#UNINITIALIZED\nfontcom count ++$10\nfontcom get ++$10 ++$10\nfontcom search ++$10 $str1\nfontcom default ++$10\nbreak\n#INIT\nfontcom init ++$10\nbreak\n#COUNT\nfontcom count ++$10\nbreak\n#GET\nfontcom get 0 3\nfontcom get -1 4\nbreak\n#SEARCH\nfontcom search 5 固定 幅\nfontcom search 6 $str1\nfontcom search 7\nbreak\n#DEFAULT\nfontcom default 8\nbreak\n#UNKNOWN\nfontcom INIT ++$10\nfontcom unknown ++$10\nbreak\n',
      ),
      // FES file bodies keep authored source bytes. Encode Japanese operands as
      // the original narrow ABI, independently of JS-authored UTF8 source.
      world = await defaultFESWorld(profile, {
        'screen.fes': encodeCP932(new TextDecoder().decode(source)),
      });
    let enumerations = 0,
      defaults = 0;
    world.host.nativeFontFamilies = () => {
      enumerations++;
      return fonts;
    };
    const defaultBytes = Buffer.from(encodeCP932('既定'));
    world.host.nativeDefaultFontBytes = () => {
      defaults++;
      return defaultBytes;
    };
    try {
      const h = await loadDefaultFES(world),
        t = traceFrontends(h, world);
      assert.ok(h.instance.runtime instanceof FESCoordinator);
      assert.equal(typeof h.task.player.runtimeFactory, 'function');
      await h.task.tick();
      h.instance.setGlobal(10, 0);
      for (const name of ['UNINITIALIZED', 'UNKNOWN']) {
        t.clear();
        await h.task.player.notify(name);
        assert.equal(h.instance.global(10), 0);
        assert.ok(t.calls.every(([name, value]) => name !== 'eval' && value !== '++$10'));
      }
      assert.equal(enumerations, 0);
      assert.equal(defaults, 0);
      world.configuration.font.prop = 0;
      t.clear();
      await h.task.player.notify('INIT');
      assert.deepEqual(categories(t.calls), ['bank', 'SCRIPT']);
      assert.equal(enumerations, 2);
      assert.equal(h.instance.runtime.platform.fonts.names.length, 1);
      t.clear();
      await h.task.player.notify('COUNT');
      assert.deepEqual(categories(t.calls), [
        'bank',
        'SCRIPT',
        'bank',
        'SCRIPT',
        'eval',
        'write',
        'write',
      ]);
      assert.equal(h.instance.global(1), 1);
      assert.equal(h.instance.global(10), 1);
      await h.task.player.notify('GET');
      assert.deepEqual(t.bank.getBytes(3), encodeCP932('固定 幅'));
      assert.deepEqual(t.bank.getBytes(4), new Uint8Array());
      t.bank.setBytes(1, encodeCP932('固定 幅'));
      world.configuration.scriptReplacements.add(ascii('$str1'), ascii('SHOULD_NOT_RUN'));
      h.instance.setGlobal(7, 777);
      t.clear();
      await h.task.player.notify('SEARCH');
      assert.deepEqual(
        [5, 6, 7].map((i) => h.instance.global(i)),
        [0, -1, 777],
      );
      assert.equal(t.calls.filter(([name]) => name === 'bank').length, 6);
      assert.equal(t.calls.filter(([name]) => name === 'SCRIPT').length, 6);
      assert.ok(
        !t.calls.some(
          ([name, text]) => name === 'bank' && text === Buffer.from(ascii('$str1')).toString('hex'),
        ),
      );
      await h.task.player.notify('DEFAULT');
      assert.deepEqual(t.bank.getBytes(8), encodeCP932('既定'));
      assert.equal(defaults, 1);
      defaultBytes.fill(0);
      assert.deepEqual(t.bank.getBytes(8), encodeCP932('既定'));
      world.configuration.font.prop = 1;
      await h.task.player.notify('INIT');
      assert.equal(enumerations, 4);
      assert.equal(h.instance.runtime.platform.fonts.names.length, 2);
      assert.equal(h.instance.runtime.pendingRecords.length, 0);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });

  test(`${profile} fresh font enumeration restore never enumerates, reloads FES or reads default Settings`, async (t) => {
    const source = ascii(
        '#START\nnext IDLE\n#IDLE\n#INIT\nfontcom init\nbreak\n#QUERY\nfontcom count 1\nfontcom get 0 2\nbreak\n',
      ),
      world = await defaultFESWorld(profile, { 'screen.fes': source });
    let enumerations = 0,
      fresh;
    world.host.nativeFontFamilies = () => {
      enumerations++;
      return fonts;
    };
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      world.configuration.font.prop = 0;
      await h.task.player.notify('INIT');
      const state = structuredClone(world.snapshot());
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = async (name) => {
        const bytes = await read(name);
        reads.push({
          name,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        return bytes;
      };
      fresh.host.nativeFontFamilies = () => {
        throw new Error('enumeration must not replay');
      };
      fresh.host.nativeDefaultFontBytes = () => {
        throw new Error('defaults must not be borrowed for saved enumeration');
      };
      await fresh.restore(state);
      const task = fresh.objects.objects.get(h.id).implementation,
        instance = task.player.root,
        bank = fresh.runtime.stringBank(fresh.objects.objects.get(fresh.main.id));
      await task.player.notify('QUERY');
      assert.equal(instance.global(1), 1);
      assert.deepEqual(bank.getBytes(2), encodeCP932('固定 幅'));
      assert.equal(enumerations, 2);
      assert.deepEqual(
        reads.map(({ name }) => name),
        ['case.kcs'],
      );
      t.diagnostic('fresh scheduler read: ' + JSON.stringify(reads));
      const names = instance.runtime.platform.fonts.names;
      await fresh.objects.release(h.id);
      assert.equal(instance.runtime.platform.fonts.names, null);
      assert.ok(names.length > 0);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} fontcom preserves complete evaluation/output order and the real renderer catalog mount`, async () => {
    const world = await defaultFESWorld(profile, { 'screen.fes': ascii('#START\n#IDLE\n') });
    const previous = world.bootstrapOwner;
    try {
      const renderer = Object.create(CanvasRenderer.prototype);
      renderer.fontMetadata = [
        {
          windows: { charset: 128, pitchAndFamily: 1, type: 4 },
          weight: 400,
          records: [
            { id: 1, platform: 3, language: 0x411, text: 'Family' },
            { id: 4, platform: 3, language: 0x411, text: '固定 幅' },
          ],
        },
      ];
      let enumerations = 0;
      world.bootstrapOwner = {
        fontFamilies() {
          assert.equal(this, world.bootstrapOwner);
          enumerations++;
          return renderer.nativeFontFamilies(0x411);
        },
      };
      const h = await loadDefaultFES(world),
        t = traceFrontends(h, world);
      h.instance.execute(ascii('fontcom init'), [], 0);
      assert.equal(enumerations, 2);
      t.clear();
      h.instance.setGlobal(10, 9);
      h.instance.execute(ascii('fontcom count ++$10'), [], 0);
      assert.deepEqual(t.calls, [
        ['bank', Buffer.from(ascii('count')).toString('hex')],
        ['SCRIPT', Buffer.from(ascii('count')).toString('hex')],
        ['bank', Buffer.from(ascii('++$10')).toString('hex')],
        ['SCRIPT', Buffer.from(ascii('++$10')).toString('hex')],
        ['eval', '++$10'],
        ['write', 10, 10],
        ['write', 10, 1],
      ]);
      t.clear();
      h.instance.execute(ascii('fontcom get ++$10'), [], 0);
      assert.deepEqual(
        t.calls.filter(([kind]) => ['eval', 'write', 'string'].includes(kind)),
        [
          ['eval', '++$10'],
          ['write', 10, 2],
        ],
      );
      t.clear();
      h.instance.execute(ascii('fontcom get ++$10 ++$10'), [], 0);
      assert.deepEqual(
        t.calls.filter(([kind]) => ['eval', 'write', 'string'].includes(kind)),
        [
          ['eval', '++$10'],
          ['write', 10, 3],
          ['eval', '++$10'],
          ['write', 10, 4],
          ['string', 4, ''],
        ],
      );
      t.clear();
      h.instance.execute(ascii('fontcom search ++$10'), [], 0);
      assert.deepEqual(
        t.calls.filter(([kind]) => ['eval', 'write'].includes(kind)),
        [
          ['eval', '++$10'],
          ['write', 10, 5],
        ],
      );
      t.clear();
      h.instance.execute(ascii('fontcom search 10 $str1'), [], 0);
      assert.deepEqual(
        t.calls.filter(([kind]) => ['eval', 'write'].includes(kind)),
        [
          ['eval', '10'],
          ['write', 10, -1],
        ],
      );
      assert.equal(t.calls.filter(([kind]) => kind === 'bank').length, 2);
      t.bank.setBytes(12, ascii('KEEP'));
      assert.throws(
        () => h.instance.execute(ascii('fontcom default 12'), [], 0),
        /data view is unavailable/,
      );
      assert.deepEqual(t.bank.getBytes(12), ascii('KEEP'));
      h.instance.setGlobal(10, 11);
      world.host.nativeDefaultFontBytes = () => {
        t.calls.push(['read-default']);
        return Buffer.from(ascii('DEFAULT'));
      };
      t.clear();
      h.instance.execute(ascii('fontcom default ++$10'), [], 0);
      assert.deepEqual(
        t.calls.filter(([kind]) => ['eval', 'write', 'read-default', 'string'].includes(kind)),
        [
          ['eval', '++$10'],
          ['write', 10, 12],
          ['read-default'],
          ['string', 12, Buffer.from(ascii('DEFAULT')).toString('hex')],
        ],
      );
      assert.equal(world.nativeEngine, undefined);
    } finally {
      if (previous === undefined) delete world.bootstrapOwner;
      else world.bootstrapOwner = previous;
      await world.close();
    }
  });

  test(`${profile} font second-pass shrinking owns only written rows and growth refuses undefined overflow`, async () => {
    const world = await defaultFESWorld(profile, { 'screen.fes': ascii('#START\n#IDLE\n') });
    try {
      const h = await loadDefaultFES(world),
        platform = h.instance.runtime.platform;
      let pass = 0;
      world.configuration.font.prop = 1;
      world.host.nativeFontFamilies = () => (++pass === 1 ? fonts : [fonts[0]]);
      assert.deepEqual(h.instance.execute(ascii('fontcom init'), [], 0), {});
      assert.equal(platform.fonts.names.length, 1);
      pass = 0;
      world.host.nativeFontFamilies = () => (++pass === 1 ? [fonts[0]] : fonts);
      assert.throws(
        () => h.instance.execute(ascii('fontcom init'), [], 0),
        /grew beyond its capacity/,
      );
      assert.equal(platform.fonts.names, null);
      world.host.nativeFontFamilies = () => [];
      h.instance.execute(ascii('fontcom init'), [], 0);
      assert.deepEqual(platform.fonts.names, []);
      h.instance.execute(ascii('fontcom count 1'), [], 0);
      h.instance.execute(ascii('fontcom get 0 2'), [], 0);
      h.instance.execute(ascii('fontcom search 3 name'), [], 0);
      assert.equal(h.instance.global(1), 0);
      assert.equal(h.instance.global(3), -1);
      const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
      assert.deepEqual(bank.getBytes(2), new Uint8Array());
      delete world.host.nativeFontFamilies;
      assert.throws(
        () => h.instance.execute(ascii('fontcom init'), [], 0),
        /platform font family data view/,
      );
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });
}
