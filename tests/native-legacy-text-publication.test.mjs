// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LegacyTextState } from '../src/native/legacy-text-state.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

function state({ escape = 1, width = 64, height = 64, left = 0 } = {}) {
  const text = new LegacyTextState(),
    words = new Int32Array(282);
  words[2] = width;
  words[3] = height;
  words[6] = 10;
  words[7] = 6;
  words[11] = left;
  words[15] = 32;
  words[20] = escape;
  text.configure(new Uint8Array(words.buffer), 282);
  text.clear();
  return text;
}

test('append success follows glyph branches rather than cell or style mutations', () => {
  for (const [source, escape, expected, codes] of [
    ['A', 1, 1, [65]],
    ['あ', 1, 1, [0x82a0]],
    ['\\\\', 0, 1, [92, 92]],
    ['\\\\', 1, 0, [92]],
    ['\\n', 1, 0, [0]],
    ['[\\\\/B]', 1, 0, [92, 66]],
    [']', 1, 1, [93]],
    ['A\\\\', 1, 1, [65, 92]],
    ['\\f12;\\c17;', 1, 0, []],
  ]) {
    const text = state({ escape });
    assert.equal(text.append(encodeCP932(source)), expected, source);
    assert.deepEqual(
      text.rows.map((r) => r[0]),
      codes,
      source,
    );
    if (source === '\\f12;\\c17;') {
      assert.equal(text.w(183), 12);
      assert.equal(text.w(46), 17);
    }
  }
});

test('a failed clipped glyph may add a newline without requesting publication', () => {
  for (const [source, escape] of [
    ['A', 1],
    ['あ', 1],
    ['A', 0],
  ]) {
    const text = state({ width: 8, height: 10, left: 7, escape });
    assert.equal(text.append(encodeCP932(source)), 0, source);
    assert.deepEqual(
      text.rows.map((r) => r[0]),
      [0],
      source,
    );
    assert.equal(text.w(460), 10);
  }
  const text = state({ width: 8, height: 10 });
  assert.equal(text.append(encodeCP932('AA')), 1);
  assert.deepEqual(
    text.rows.map((r) => r[0]),
    [65, 0],
  );
});

const profiles = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-stringplane-state.json', import.meta.url)),
).profiles;
for (const version of ['74', '76']) {
  test(
    'SDK' +
      version +
      ' actual append GCALL preserves unpublished bitmap through cold and later normal raster',
    async () => {
      const program = kcsProgram([
          ...Array.from({ length: 4 }, () => [
            [37, [0x13, 2048]],
            [37, 128],
            [43, 124, 8],
            [37, 3968],
            [43, 71, 4],
            [38, 2360],
          ]).flat(),
          [59],
        ]),
        glyphs = {
          measure() {
            throw Error('No fallback measure');
          },
          glyph() {
            throw Error('No fallback glyph');
          },
        },
        make = (initialize = true) =>
          dataWorld(
            profiles[version].profile,
            { 'publication.kcs': program },
            { glyphs, initialize },
          ),
        close = async (w) => {
          for (const t of w.runtime.scheduler.tasks.values())
            w.runtime.scheduler.cancel(t.id, false);
          await w.close({ flushFiles: false });
        },
        w = await make();
      let fresh;
      try {
        w.graphics.createLogicalDevice();
        const task = await w.spawnScript('publication.kcs', {
            parent: w.main.id,
            initialExecute: false,
          }),
          m = task.machine,
          call = (id, args) => w.runtime.native('main', id, args, m, task);
        m.bytes(128, 2).set([84, 0]);
        const id = (await call(66, [8, w.nativeTaskID(task.id), 128])).value;
        m.store(2048, id);
        profiles[version].cases
          .find((r) => r.id === 123)
          .header.forEach((n, i) => m.store(640 + 4 * i, n));
        m.store(800, 0);
        await call(123, [id, 640, 800]);
        await call(125, [id]);
        await call(599, [id, 6, 8, 10, 12, 14]);
        const atlas = (await call(112, [4, 2])).value;
        await call(117, [atlas, 0, 0, 4, 2, 0xff4070a0]);
        await call(136, [id, atlas]);
        for (const code of [92, 65]) await call(137, [id, code, 0, 0, 2, 2]);
        await call(114, [atlas]);
        await call(126, [id, 0, 0]);
        const ownerFor = (world, t) =>
            world.objects.objects.get(world.resolveTaskID(t.machine.load(2048), t.id))
              .implementation,
          owner = ownerFor(w, task),
          bitmap = w.graphics.images.get(owner.bitmap),
          before = [...(await bitmap.pixels())],
          revision = bitmap.state.revision,
          advance = async (world, t, source) => {
            const bytes = encodeCP932(source);
            t.machine.bytes(128, bytes.length + 1).set([...bytes, 0]);
            if (t.machine.waiting?.kind === 'message')
              await world.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
            else await world.runtime.scheduler.execute(t);
            assert.equal(t.machine.waiting?.kind, 'message');
          },
          pending = async (world, t) => {
            const o = ownerFor(world, t),
              b = world.graphics.images.get(o.bitmap);
            assert.deepEqual(
              o.text.rows.map((r) => [r[0], r[9]]),
              [
                [92, 0],
                [0, 0],
              ],
            );
            assert.deepEqual([...(await b.pixels())], before);
            assert.equal(b.state.revision, revision);
            assert.equal(o.text.w(183), 12);
            assert.equal(o.text.w(46), 17);
          };
        await advance(w, task, '\\\\');
        assert.deepEqual(
          owner.text.rows.map((r) => [r[0], r[9]]),
          [[92, 0]],
        );
        assert.deepEqual([...(await bitmap.pixels())], before);
        assert.equal(bitmap.state.revision, revision);
        await advance(w, task, '\\n');
        await advance(w, task, '\\f12;\\c17;');
        await pending(w, task);
        const snapshot = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
        fresh = await make(false);
        await fresh.restore(snapshot);
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        await pending(fresh, restored);
        for (const [world, t] of [
          [w, task],
          [fresh, restored],
        ]) {
          await advance(world, t, 'A');
          const o = ownerFor(world, t),
            b = world.graphics.images.get(o.bitmap);
          assert.deepEqual(
            o.text.rows.map((r) => [r[0], r[9]]),
            [
              [92, 1],
              [0, 0],
              [65, 1],
            ],
          );
          assert.notDeepEqual([...(await b.pixels())], before);
          assert.equal(b.state.revision, revision + 1);
        }
        assert.deepEqual(
          [...(await w.graphics.images.get(owner.bitmap).pixels())],
          [...(await fresh.graphics.images.get(ownerFor(fresh, restored).bitmap).pixels())],
        );
      } finally {
        if (fresh) await close(fresh);
        await close(w);
      }
    },
  );
}
