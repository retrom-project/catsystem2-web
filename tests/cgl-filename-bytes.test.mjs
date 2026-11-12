// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CGGallery, GalleryLibrary, readCGList } from '../src/gallery.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { hg3 } from './helpers.mjs';

const alias = Uint8Array.of(0x87, 0x90),
  canonical = Uint8Array.of(0x81, 0xe0),
  decoder = new TextDecoder('shift_jis'),
  text = (value) => new TextEncoder().encode(value);
function cgl(width) {
  const header = width === 256 ? 4 : 0,
    sectionLength = 12 + 72 + width * 2,
    bytes = Buffer.alloc(header + sectionLength * 2),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header) view.setUint32(0, 0x004c4743, true);
  for (let index = 0; index < 2; index++) {
    const section = header + sectionLength * index,
      group = section + 12;
    view.setUint32(section, index ? 0 : sectionLength, true);
    view.setInt32(section + 4, index, true);
    view.setUint32(section + 8, 1, true);
    bytes.set(text('List' + index), group + 4);
    view.setUint32(group + 68, 2, true);
    bytes.set(alias, group + 72);
    bytes.set(canonical, group + 72 + width);
  }
  return bytes;
}
async function open(bytes) {
  return new GalleryLibrary({ read: async () => bytes, readEntry: async () => null }).open(
    'state.dat',
    80,
    'list.cgl',
  );
}

test('CGL variant spans preserve both record widths, relative section offsets and same-decoded aliases', async () => {
  assert.equal(decoder.decode(alias), decoder.decode(canonical));
  assert.notDeepEqual(encodeCP932(decoder.decode(alias)), alias);
  for (const width of [64, 256]) {
    const bytes = cgl(width),
      gallery = await open(bytes);
    for (let section = 0; section < 2; section++) {
      const group = gallery.group('List' + section, section),
        start = (width === 256 ? 4 : 0) + (12 + 72 + width * 2) * section + 84;
      assert.deepEqual(group.variantRecords, [
        { offset: start, length: 2 },
        { offset: start + width, length: 2 },
      ]);
      assert.deepEqual(
        gallery.variantBytes(gallery.selectVariant('List' + section, 0, section)),
        alias,
      );
      assert.deepEqual(
        gallery.variantBytes(gallery.selectVariant('List' + section, 1, section)),
        canonical,
      );
    }
  }
});

test('CGL bytes keep one owned list authority and return owned ordinary Uint8Arrays without another selection', async () => {
  const input = cgl(64),
    original = new Uint8Array(input),
    gallery = await open(input);
  assert.equal(gallery.listBytes.constructor, Uint8Array);
  input.fill(0);
  assert.deepEqual(gallery.listBytes, original);
  gallery.registry.register(decoder.decode(alias));
  let groupReads = 0,
    seenReads = 0;
  const group = gallery.group.bind(gallery),
    has = gallery.registry.hasReference.bind(gallery.registry);
  gallery.group = (...args) => {
    groupReads++;
    return group(...args);
  };
  gallery.registry.hasReference = (...args) => {
    seenReads++;
    return has(...args);
  };
  const selected = gallery.selectVariant('List0', 1, 0, true);
  gallery.list.groups.includes = () => {
    throw new Error('variant query rescanned groups');
  };
  const bytes = gallery.variantBytes(selected);
  assert.deepEqual(bytes, canonical);
  assert.equal(bytes.constructor, Uint8Array);
  bytes.fill(0);
  assert.deepEqual(gallery.variantBytes(selected), canonical);
  assert.deepEqual([groupReads, seenReads], [1, 2]);
  delete gallery.list.groups.includes;
  const state = gallery.snapshot();
  state.listBytes = Buffer.from(state.listBytes);
  const fresh = CGGallery.restore(state);
  state.listBytes.fill(0);
  assert.equal(fresh.listBytes.constructor, Uint8Array);
  assert.deepEqual(fresh.listBytes, original);
  assert.deepEqual(fresh.variantBytes(fresh.selectVariant('List0', 0)), alias);
  const saved = fresh.snapshot();
  saved.listBytes.fill(0);
  assert.deepEqual(fresh.listBytes, original);
});

test('CGL exact-byte queries diagnose missing parsed authority while explicit JS-authored strings retain their CP932 API', () => {
  const parsed = new CGGallery(readCGList(cgl(64))),
    selected = parsed.selectVariant('List0', 0);
  assert.throws(() => parsed.variantBytes(selected), /parsed list-byte span/);
  assert.throws(() => parsed.variantBytes({ group: {}, index: 0 }), /selected variant/);
  const foreign = new CGGallery(readCGList(cgl(64)));
  assert.throws(() => parsed.variantBytes(foreign.selectVariant('List0', 0)), /selected variant/);
  assert.equal(Object.isFrozen(selected), true);
  const authored = new CGGallery({
    groups: [{ index: 0, section: 0, name: 'JS', variants: ['猫'] }],
  });
  assert.equal(authored.get('JS', 0, 0, false), '猫');
  assert.deepEqual(authored.variantBytes(authored.selectVariant('JS', 0)), encodeCP932('猫'));
  assert.equal(authored.selectVariant('JS', 1), null);
});

for (const profile of profiles)
  test(`${profile}: actual loadlist selection carries CGL alias bytes once and fresh World keeps the same list authority`, async () => {
    const model = await open(cgl(64)),
      file = new NativeGlobalFile(),
      name = decoder.decode(alias),
      pixel = Uint8Array.of(17, 34, 51, 255);
    model.registry.register(name);
    file.write(80, model.registry.write());
    const savedFile = await file.file(),
      source =
        '#DEFINE\nIMAGE picture\n#OBJECT FILE POS PRI DISP\npicture first 3,4 60000 1\n#START\ncgreg_init state.dat 80 list.cgl\nnext IDLE\n#IDLE\n#ALIAS\npicture loadlist 999 List0 0 0\nbreak\n#CANONICAL\npicture loadlist 999 List0 1 0\nbreak\n#SEEN\npicture loadlist2 999 List0 1 0\nbreak\n',
      world = await defaultFESWorld(
        profile,
        {
          'screen.fes': text(source),
          'list.cgl': model.listBytes,
          'first.hg3': hg3(1, 1, pixel),
          [name + '.hg3']: hg3(1, 1, pixel),
        },
        {
          storage: {
            read: async (path) => (path === 'state.dat' ? savedFile : null),
            write: async () => true,
          },
        },
      );
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const received = [],
        apply = h.instance.runtime.setImageFile.bind(h.instance.runtime);
      h.instance.runtime.setImageFile = (object, current, bytes) => {
        received.push(new Uint8Array(bytes));
        return apply(object, current, bytes);
      };
      await h.task.player.notify('CANONICAL');
      await h.task.player.notify('ALIAS');
      await h.task.syncObjects();
      assert.deepEqual(received, [canonical, alias]);
      assert.equal(h.instance.collection.lookup('picture', 0).file, name);
      const pixels = await drawPixels(world, h.surface),
        state = world.snapshot();
      fresh = await defaultFESWorld(
        profile,
        {},
        {
          initialize: false,
          storage: {
            read: async () => {
              throw new Error('fresh CGL storage read');
            },
            write: async () => true,
          },
        },
      );
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (path) => {
        if (path === 'case.kcs') return read(path);
        throw new Error('fresh CGL resource read ' + path);
      };
      await fresh.restore(state);
      const task = fresh.objects.objects.get(h.id).implementation,
        root = task.player.root,
        freshReceived = [],
        freshApply = root.runtime.setImageFile.bind(root.runtime);
      root.runtime.setImageFile = (object, current, bytes) => {
        freshReceived.push(new Uint8Array(bytes));
        return freshApply(object, current, bytes);
      };
      assert.deepEqual(root.cgGallery.snapshot(), h.instance.cgGallery.snapshot());
      await task.player.notify('SEEN');
      await task.syncObjects();
      assert.deepEqual(freshReceived, [canonical]);
      assert.deepEqual(await drawPixels(fresh, h.surface), pixels);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
