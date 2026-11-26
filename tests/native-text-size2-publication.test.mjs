// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { authoredHG3 } from './fixtures/hg3.mjs';
import { nativeBitmapState } from '../src/native/image.mjs';
const profile = 'nekopara-vol3-engine-2.6.1.76';
const font = new Uint8Array(
  await readFile(new URL('../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url)),
);
const rectangles = authoredHG3([
  { id: 0, width: 64, height: 40, rgba: new Uint8Array(64 * 40 * 4) },
  { id: 10, width: 48, height: 24, offsetX: 3, offsetY: 5, rgba: new Uint8Array(48 * 24 * 4) },
]);
const source =
  '#DEFINE\nPLANE pl\nIMAGE uf\nSTRING8 str\n#OBJECT SIZE2 VRAM POS2 DISP PRI\npl rect:0 0,0 rect:0 1 60000\n#OBJECT FILE IDN\nuf absent -1\n#OBJECT SIZE2 VRAM POS2 DISP PRI PARENT\nstr rect:10 3,5 rect:10 1 60300 pl\n#START\nstr layout fontind 1 font.ttf\nstr layout frame 0\nstr userfontobj uf\nstr userfont 34624 1\nstr str AB\nstr draw 0\nnext IDLE\n#IDLE\n#CLEAR\nstr clear\nstr disp 0\nstr layout color 255 255 255 0 33 67 255 255 255\nbreak\n';
async function open(selectedProfile = profile) {
  const world = await defaultFESWorld(
    selectedProfile,
    {
      'screen.fes': new TextEncoder().encode(
        selectedProfile === profile ? source : source.replace('STRING8 str', 'STRING str'),
      ),
      'font.ttf': font,
      'rect.hg3': rectangles,
    },
    { ...(selectedProfile.endsWith('2.6.1.23') ? {} : { glyphs: undefined }), initialize: false },
  );
  const texture = world.configuration.fields.texture;
  texture.size.set([64, 64]);
  texture.grid.set([2, 2]);
  texture.areas[0].set([0, 0, 2, 2]);
  texture.bppY.set([0, 2]);
  texture.dither = 0;
  await world.initialize('case.kcs');
  const h = await loadDefaultFES(world);
  const initialBatches = await watch(world, () => h.task.tick());
  return { world, ...h, initialBatches, object: h.instance.byKey.get('str') };
}
async function watch(world, run) {
  const tickets = new Set();
  let active = true,
    polls = 0;
  const poll = () => {
    if (!active) return;
    assert(++polls < 10000);
    for (const b of world.text.publications.values()) tickets.add(b);
    queueMicrotask(poll);
  };
  queueMicrotask(poll);
  try {
    await run();
  } finally {
    active = false;
  }
  return [...tickets];
}
test('retained SIZE2 mode with prepared geometry reaches the owned empty-clear transaction', async () => {
  const results = [];
  for (const candidate of [false, true]) {
    const h = await open();
    try {
      const s = h.object.nativeTextState,
        task = h.world.graphics.get(h.object.nativeTaskID),
        writer = await task.writer();
      assert.equal(h.initialBatches.length, 0, 'first resource/view preparation stays ordinary');
      assert.equal(h.object.sizePending, true);
      assert.equal(h.object.positionPending, false);
      assert.equal(s.first, false);
      assert.equal(s.fontDirty, false);
      assert.deepEqual([h.object.width, h.object.height], [48, 24]);
      assert.deepEqual([h.object.x, h.object.y], [3, 5]);
      assert.equal(h.object.parent, 'pl');
      assert.equal(writer.imageFont, null);
      assert.equal(writer.fontImages.get(34624), 1);
      const vram = h.world.graphics.images.get(h.world.graphics.vramHandle),
        before = nativeBitmapState(vram).revision;
      if (!candidate) h.world.text.beginPublication = () => null;
      const batches = await watch(h.world, async () => {
        await h.task.player.notify('CLEAR');
        await h.task.syncObjects();
      });
      assert.equal(
        batches.length,
        Number(candidate),
        'persistent SIZE2 is not pending first-only resource IO',
      );
      if (candidate) assert.equal(batches[0].physicalPublications, 1);
      assert.equal(h.object.sizePending, true);
      assert.equal(nativeBitmapState(vram).revision, before + 4);
      results.push({
        vram: vram.snapshot(),
        pages: h.world.graphics.texturePages.snapshot(),
        writer: writer.snapshot(),
        task: task.snapshot(),
        FES: structuredClone(s),
      });
    } finally {
      await h.world.close({ flushFiles: false });
    }
  }
  assert.deepEqual(results[1], results[0]);
});

for (const boundary of ['size-dirty', 'position-reference', 'font-dirty', 'public-page'])
  test(`retained SIZE2 keeps ordinary clear at ${boundary}`, async () => {
    const h = await open();
    try {
      if (boundary === 'size-dirty') {
        h.object.width = 47;
        h.object.sizeDirty = true;
      }
      if (boundary === 'position-reference') h.object.positionPending = true;
      if (boundary === 'font-dirty') h.object.nativeTextState.fontDirty = true;
      if (boundary === 'public-page') h.world.graphics.texturePages.frame(0);
      const batches = await watch(h.world, async () => {
        await h.task.player.notify('CLEAR');
        await h.task.syncObjects();
      });
      assert.equal(batches.length, 0);
      assert.equal(h.object.sizePending, true);
      assert.equal(h.world.text.publications.size, 0);
      assert.equal(h.world.text.flushingPublication, null);
    } finally {
      await h.world.close({ flushFiles: false });
    }
  });

test('a failed retained SIZE2 profile edit settles its preceding output and propagates the failure', async () => {
  const h = await open();
  try {
    const strings = h.world.text.fes,
      layout = strings.layout(h.object);
    await strings.command(h.instance, h.object, 'clear');
    layout.profiles.prof = { index: -1, bytes: Uint8Array.of(65) };
    strings.saveLayout(h.object, layout);
    h.object.nativeTextState.dirty = true;
    await assert.rejects(strings.drive(h.instance, h.object), TypeError);
    assert.equal(h.world.text.publications.size, 0);
    assert.equal(h.world.text.flushingPublication, null);
    assert.equal(h.world.runtime.textPublicationBarrier, null);
    const vram = h.world.graphics.images.get(h.world.graphics.vramHandle);
    assert(vram.snapshot().rgba.every((n) => n === 0));
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

for (const legacy of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
])
  test(`${legacy} native STRING SIZE2 preserves full state and page revisions (legacy GDI stays ordinary)`, async () => {
    const results = [];
    for (const candidate of [false, true]) {
      const h = await open(legacy);
      try {
        if (!candidate) h.world.text.beginPublication = () => null;
        const tickets = await watch(h.world, async () => {
          await h.task.player.notify('CLEAR');
          await h.task.syncObjects();
        });
        assert.equal(tickets.length, Number(candidate && !legacy.endsWith('2.6.1.23')));
        if (candidate && !legacy.endsWith('2.6.1.23'))
          assert.equal(tickets[0].physicalPublications, 1);
        const task = h.world.graphics.get(h.object.nativeTaskID),
          writer = await task.writer(),
          vram = h.world.graphics.images.get(h.world.graphics.vramHandle);
        results.push({
          FES: structuredClone(h.object.nativeTextState),
          task: task.snapshot(),
          writer: writer.snapshot(),
          vram: vram.snapshot(),
          pages: h.world.graphics.texturePages.snapshot(),
        });
      } finally {
        await h.world.close({ flushFiles: false });
      }
    }
    assert.deepEqual(results[1], results[0]);
  });
