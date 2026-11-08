// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCGList,
  parseCGReference,
  CGRegistry,
  CGGallery,
  GalleryLibrary,
} from '../src/gallery.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { memoryGame } from './helpers.mjs';

function list(sections, width = 256) {
  const lengths = sections.map(
    (s) => 12 + s.groups.reduce((n, g) => n + 72 + width * g.variants.length, 0),
  );
  const bytes = new Uint8Array((width === 256 ? 4 : 0) + lengths.reduce((a, b) => a + b, 0));
  const v = new DataView(bytes.buffer),
    text = new TextEncoder();
  let at = 0;
  if (width === 256) {
    v.setUint32(0, 0x004c4743, true);
    at = 4;
  }
  sections.forEach((s, si) => {
    v.setUint32(at, si + 1 < sections.length ? lengths[si] : 0, true);
    v.setInt32(at + 4, s.id, true);
    v.setUint32(at + 8, s.groups.length, true);
    at += 12;
    s.groups.forEach((g, gi) => {
      v.setUint32(at, gi + 1 < s.groups.length ? 72 + width * g.variants.length : 0, true);
      bytes.set(text.encode(g.name), at + 4);
      v.setUint32(at + 68, g.variants.length, true);
      at += 72;
      for (const variant of g.variants) {
        bytes.set(text.encode(variant), at);
        at += width;
      }
    });
  });
  return bytes;
}
const sample = () => [
  {
    id: 0,
    groups: [
      { name: 'Opening', variants: ['ea01,2,0,1', 'ea01,2,1,0'] },
      { name: 'Finale', variants: ['ef01'] },
    ],
  },
  { id: 7, groups: [{ name: 'Opening', variants: ['ea02,1'] }] },
];

test('CGL reads both native record widths, relative section links and group namespaces', () => {
  for (const width of [64, 256]) {
    const parsed = readCGList(list(sample(), width));
    const gallery = new CGGallery(parsed);
    assert.equal(parsed.variantWidth, width);
    assert.equal(gallery.group('oPENING', 7).ordinal, 2);
    assert.equal(gallery.group('oPENING', 7).index, 1);
    assert.equal(gallery.group(2), undefined);
    assert.equal(gallery.group(1, 7).name, 'Finale');
    assert.equal(gallery.index('OPENING'), 0);
    assert.equal(gallery.index('missing'), -1);
    assert.deepEqual(gallery.variants('Opening'), sample()[0].groups[0].variants);
    const truncated = list(sample(), width).subarray(0, 20);
    assert.throws(() => readCGList(truncated), /range|count/);
  }
});

test('CG filename and selector syntax distinguishes list variants from rendered references', () => {
  assert.deepEqual(parseCGReference('ea01,,2,0,12', true), { file: 'ea01_2', selectors: [48, 49] });
  assert.deepEqual(parseCGReference('ea01_2,0,12'), { file: 'ea01_2', selectors: [48, 49] });
  assert.equal(parseCGReference(',,,'), null);
  assert.deepEqual(parseCGReference(' space , 2', true), { file: ' space _ 2', selectors: [] });
});

test('CG registration preserves independent variants, terminal markers and native binary persistence', () => {
  const registry = new CGRegistry();
  registry.registerReference('ea01_2,0,1');
  registry.registerReference('ea01_2,1,0');
  registry.register('ef01');
  assert.equal(registry.has('ea01_2'), false);
  assert.equal(registry.has('EA01_2', [48, 49]), false);
  assert.equal(registry.has('ea01_2', [48, 49]), true);
  assert.equal(registry.has('ea01_2', [48, 49, 0]), false);
  assert.equal(registry.has('ea01_2', [48, 49, 48]), false);
  const restored = new CGRegistry(registry.write());
  assert.deepEqual(restored.write(), registry.write());
  const gallery = new CGGallery(readCGList(list(sample())), restored);
  assert.equal(gallery.variants('Opening', 0, true).length, 2);
  assert.equal(gallery.get('Opening', 1), 'ea01,2,1,0');
  assert.equal(gallery.get('Opening', 2), '');
  assert.equal(gallery.seen('Opening', 7), false);
  assert.equal(gallery.registerGroup('Opening', 7), true);
  assert.equal(gallery.seen('Opening', 7), true);
  assert.equal(gallery.registerGroup('absent'), false);
});

test('native legacy registration leaf accepts numeric zero tails and differs from ASCII zero', () => {
  const bytes = new Uint8Array(68);
  bytes.set(new TextEncoder().encode('plain'), 4);
  const registry = new CGRegistry(bytes);
  assert.equal(registry.has('plain', [0, 0]), true);
  assert.equal(registry.has('plain', [48]), false);
  assert.deepEqual(registry.write(), bytes);
  assert.throws(() => new CGRegistry(bytes.subarray(0, 67)), /range/);
});

test('FES gallery commands share persisted entries while retaining per-instance lists and frame timing', async () => {
  const source = `#START\nreset_frame\ncgreg_init all.dat 0x50 config.int/gallery.dat\ncgreg_t 10 Opening\ncgreg 11 ea01,2,0,1\ncgregnum Opening 12\ncgregmax Opening 13\ncgregtbl Finale 14\ncgreg_getlist 15 999 Opening 0 0\ncgreg_getlist 16 999 1 0 0\n$17=_FRAME_\nwait 5\nexit 0\n`;
  const bytes = list(sample()),
    registry = new CGRegistry();
  registry.registerReference('ea01_2,0,1');
  const entries = new Map([['all.dat:80', registry.write()]]);
  const library = new GalleryLibrary({
    read: async (name) => (name === 'config.int/gallery.dat' ? bytes : null),
    readEntry: async (file, id) => entries.get(`${file}:${id}`),
    writeEntry: async (file, id, data) => entries.set(`${file}:${id}`, data),
  });
  const host = { openGallery: (...args) => library.open(...args) };
  const game = memoryGame({ 'screen.fes': new TextEncoder().encode(source) });
  const player = new FESPlayer(game, {}, host);
  await player.start('screen');
  await player.step();
  assert.deepEqual(
    [10, 11, 12, 13, 14, 17].map((n) => player.globals[n]),
    [1, 1, 1, 2, 1, 0],
  );
  assert.equal(player.strings[15], 'ea01,2,0,1');
  assert.equal(player.strings[16], '');
  assert.equal(player.frameCount, 1);
  assert.equal(player.unsupportedCommands.size, 0);
  const state = player.snapshot(),
    next = new FESPlayer(game, {}, host, player.globals, player.strings);
  await next.restore(state);
  assert.equal(next.root.cgGallery.seen('Opening'), true);
  const other = await library.open('all.dat', 80, 'config.int/gallery.dat');
  other.registerGroup('Opening', 7);
  await library.persist(other);
  assert.equal(new CGRegistry(entries.get('all.dat:80')).hasReference('ea02,1', true), true);
});

test('each cgreg_init reads a fresh registry and does not observe another live instance changing it', async () => {
  let persisted = new CGRegistry().write();
  const library = new GalleryLibrary({
    read: async () => list(sample()),
    readEntry: async () => persisted,
    writeEntry: async (_file, _entry, bytes) => {
      persisted = bytes;
    },
  });
  const first = await library.open('all.dat', 80, 'list.dat');
  first.registerGroup('Opening');
  const second = await library.open('all.dat', 80, 'list.dat');
  assert.equal(second.seen('Opening'), false);
  await library.persist(first);
  const third = await library.open('all.dat', 80, 'list.dat');
  assert.equal(third.seen('Opening'), true);
  assert.equal(second.seen('Opening'), false);
});
