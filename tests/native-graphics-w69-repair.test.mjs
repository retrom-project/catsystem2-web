// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { parseXML } from '../src/xml.mjs';
const legacy = [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
];
const modern = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const ignored = 0x70000001,
  marker = 0x6931f00d;
const call = (w, id, args, task = w.main) => w.runtime.native('main', id, args, task.machine, task);
const words = (id, args) => [...args.map((value) => [37, value]), [43, id, args.length * 4]];
for (const profile of legacy)
  test(profile + ' Main121 keeps its separate neutral owner and four-word contract', async () => {
    const code = kcsProgram([
      [37, marker],
      ...words(121, [ignored, 100, 100, 100]),
      ...words(121, [0, 12, 34, 56]),
      ...words(713, [ignored, 100, 100, 100]),
      [59],
    ]);
    const w = await dataWorld(profile, { 'tone-repair.kcs': code });
    try {
      const t = await w.spawnScript('tone-repair.kcs', {
          parent: w.main.id,
          initialExecute: false,
        }),
        floor = t.machine.sp;
      await w.runtime.scheduler.execute(t);
      assert.equal(t.machine.halted, true);
      assert.equal(t.machine.sp, floor + 4);
      assert.equal(t.machine.load(floor), marker);
      await assert.rejects(call(w, 121, [ignored, 100, 100], t), /four argument words/);
      await assert.rejects(call(w, 121, [ignored, 101, 100, 100], t), /bitmap.*handle/i);
      const handle = (await call(w, 112, [1, 1], t)).value;
      await call(w, 117, [handle, 0, 0, 1, 1, 0xff204060], t);
      await call(w, 121, [handle, 50, 50, 50], t);
      assert.deepEqual(Array.from(await w.graphics.images.get(handle).pixels()), [16, 32, 48, 255]);
      await call(w, 114, [handle], t);
    } finally {
      await w.close({ flushFiles: false });
    }
  });
test('modern Main121 still consumes a real bitmap while shared Main713 neutral remains owner-free', async () => {
  for (const profile of modern) {
    const w = await dataWorld(profile);
    try {
      await assert.rejects(call(w, 121, [ignored, 100, 100, 100]), /bitmap.*handle/i);
      assert.equal((await call(w, 713, [ignored, 100, 100, 100])).control, 2);
    } finally {
      await w.close({ flushFiles: false });
    }
  }
});

async function image(w, handle) {
  return w.graphics.images.get(handle);
}
function bytes(view) {
  return Buffer.from(view).toString('base64');
}

test('Main116 keeps live destination pixels, buffer and frame across overwrite, clone and release on all profiles', async () => {
  for (const profile of [...legacy, ...modern]) {
    const w = await dataWorld(profile);
    try {
      const source = (await call(w, 112, [2, 2])).value,
        target = (await call(w, 112, [4, 4])).value;
      await call(w, 117, [source, 0, 0, 2, 2, 0xff336699]);
      await call(w, 117, [target, 0, 0, 4, 4, 0xff102030]);
      const b = await image(w, target),
        held = await b.pixels(),
        frame = await b.frame(),
        buffer = held.buffer;
      const span = new Uint8Array(buffer, held.byteOffset, held.byteLength);
      await Promise.resolve();
      await call(w, 116, [target, 0, 0, 4, 4, source, 0, 0, 2, 2]);
      assert.equal(await b.pixels(), held);
      assert.equal((await b.pixels()).buffer, buffer);
      assert.equal(frame.rgba, held);
      assert.deepEqual(Array.from(span.slice(0, 4)), [51, 102, 153, 255]);
      span.set([4, 5, 6, 255]);
      assert.deepEqual(Array.from((await b.pixels()).slice(0, 4)), [4, 5, 6, 255]);
      (await b.pixels()).set([7, 8, 9, 255], 4);
      assert.deepEqual(Array.from(span.slice(4, 8)), [7, 8, 9, 255]);
      const clone = (await call(w, 118, [target])).value,
        copied = await (await image(w, clone)).pixels(),
        saved = bytes(copied);
      assert.notEqual(copied.buffer, buffer);
      await call(w, 117, [target, 0, 0, 4, 4, 0xffaabbcc]);
      assert.deepEqual(Array.from(held.slice(0, 4)), [170, 187, 204, 255]);
      assert.equal(bytes(copied), saved);
      await call(w, 114, [source]);
      await call(w, 114, [target]);
      assert.equal(bytes(await (await image(w, clone)).pixels()), saved);
      await call(w, 114, [clone]);
    } finally {
      await w.close({ flushFiles: false });
    }
  }
});

test('Main116 borrowed destination retains original transparent-cell and same-backing traversal results', async () => {
  const golden = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile(new URL('./fixtures/native-sdk23-bitmap-area-root-chain.json', import.meta.url)),
  );
  const original = golden.copyCases[0],
    files = Object.fromEntries(original.files.map(([name, b]) => [name, Buffer.from(b, 'base64')]));
  const w = await dataWorld(original.profile, files);
  try {
    const t = await w.spawnScript(original.script, { parent: w.main.id, initialExecute: false });
    let held;
    for (const row of original.rows) {
      await w.runtime.scheduler.execute(t);
      if (row.index === 0) held = await (await image(w, t.machine.load(68))).pixels();
      if (row.index < 3) {
        const fresh = await (await image(w, t.machine.load(68))).pixels();
        assert.equal(fresh, held);
        assert.equal(bytes(held), row.bitmaps.find((x) => x.slot === 68).bitmap.rgba);
      }
      for (const expected of row.bitmaps)
        assert.equal(
          bytes(await (await image(w, t.machine.load(expected.slot))).pixels()),
          expected.bitmap.rgba,
        );
    }
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('Main735 copyPhysicalRows keeps borrowed aliases live after owner release without changing existing packed-copy output', async () => {
  const golden = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile(new URL('./fixtures/native-sdk23-bitmap-area-root-chain.json', import.meta.url)),
  );
  const files = Object.fromEntries(
    golden.files.map(([name, b]) => [name, Buffer.from(b, 'base64')]),
  );
  const expected = golden.copyCases[0].rows[1].bitmaps.find((x) => x.slot === 68).bitmap.rgba;
  for (const profile of legacy) {
    const w = await modernParticleMessageWorld(profile, files, {
      startup: parseXML(files['startup.xml'].toString()),
    });
    try {
      w.main.machine.bytes(1024, 10).set(Buffer.from('owned.hg3\0'));
      const source = (await call(w, 710, [1024])).value,
        target = (await call(w, 733, [6, 4])).value;
      await call(w, 736, [target, 0, 0, 6, 4, 0xff284968]);
      const handle = w.imageOwners.get(target).bitmap,
        b = await image(w, handle),
        held = await b.pixels();
      const alias = w.graphics.images.alias(handle, w.main.id),
        aliasBitmap = await image(w, alias);
      await call(w, 735, [source, 0, 0, 6, 4, target, 0, 0, 4, 3]);
      assert.equal(await b.pixels(), held);
      assert.equal((await aliasBitmap.pixels()).buffer, held.buffer);
      assert.equal(bytes(held), expected);
      await call(w, 711, [source]);
      await call(w, 711, [target]);
      held.set([3, 6, 9, 255]);
      assert.deepEqual(Array.from((await aliasBitmap.pixels()).slice(0, 4)), [3, 6, 9, 255]);
      await call(w, 114, [alias]);
    } finally {
      await w.close({ flushFiles: false });
    }
  }
});

test('independent cold preserves bitmap alias topology and subsequent live copy; explicit resize may replace allocation', async () => {
  let w = await dataWorld(legacy[0]);
  try {
    const source = (await call(w, 112, [2, 2])).value,
      target = (await call(w, 112, [4, 4])).value;
    const alias = w.graphics.images.alias(target, w.main.id),
      mainID = w.main.id;
    await call(w, 117, [source, 0, 0, 2, 2, 0xff336699]);
    const held = await (await image(w, target)).pixels();
    await call(w, 116, [target, 0, 0, 4, 4, source, 0, 0, 2, 2]);
    assert.equal((await (await image(w, target)).pixels()).buffer, held.buffer);
    const state = structuredClone(w.snapshot()),
      fresh = await dataWorld(legacy[0], {}, { initialize: false });
    await fresh.restore(state);
    await w.close({ flushFiles: false });
    w = fresh;
    const t = w.runtime.scheduler.tasks.get(mainID),
      b = await image(w, target),
      live = await b.pixels();
    assert.notEqual(live.buffer, held.buffer);
    assert.equal((await (await image(w, alias)).pixels()).buffer, live.buffer);
    await call(w, 117, [source, 0, 0, 2, 2, 0xffabcdef], t);
    await call(w, 116, [alias, 0, 0, 4, 4, source, 0, 0, 2, 2], t);
    assert.equal(await b.pixels(), live);
    assert.deepEqual(Array.from(live.slice(0, 4)), [171, 205, 239, 255]);
    await call(w, 372, [target, 4, 4], t);
    await call(w, 122, [target, 2, 2], t);
    assert.deepEqual([b.width, b.height], [2, 2]);
    assert.notEqual((await b.pixels()).buffer, live.buffer);
    assert.equal((await (await image(w, alias)).pixels()).buffer, (await b.pixels()).buffer);
  } finally {
    await w.close({ flushFiles: false });
  }
});
