// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runSDK63CSSConsumer } from './fixtures/sdk63-css-consumer-world.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk63-records-css-consumers.json', import.meta.url)),
);
for (const scenario of [
  { name: 'normal original-shaped writer and independent reader' },
  ...fixture.cold.map((coldAt) => ({ name: 'cold ' + coldAt.join('/'), coldAt })),
  { name: 'original native CSS file into independent current reader', nativeFile: true },
])
  test('SDK63 CG/log/record-stack CSS consumers ' + scenario.name, async () => {
    await runSDK63CSSConsumer(fixture, scenario, ({ world, task, kind, frame }) => {
      const m = task.machine,
        owner = (slot, type) => world.runtime.handles.get(m.load(slot), type);
      if (kind === 'writer' && frame === 0) {
        assert.deepEqual(
          [m.load(256), m.load(260)],
          [1, 1],
          'real CGL group and L_ alias register',
        );
        assert.deepEqual([m.load(2240), m.load(2244)], [0x89abcdef, 0x10203040]);
        assert.deepEqual([m.load(2272), m.load(2276)], [0x11223344, 0x55667788]);
        assert.equal(m.string(2048), '名前A');
        assert.equal(m.string(2112), '本文One');
        assert.equal(m.string(2304), '名前A', 'actual Scene text feeds the log speaker consumer');
      }
      if (kind === 'writer' && frame === 1) {
        assert.equal(m.load(316), 0, 'clearing the source CG owner changes a later query');
        for (const [slot, type] of [
          [64, 'global-file'],
          [72, 'cg-registration'],
          [76, 'display-log'],
          [80, 'scene-data'],
          [84, 'record-stack'],
          [88, 'record-stack'],
        ])
          assert.throws(() => owner(slot, type), /released/);
      }
      if (kind === 'reader' && frame === 0) {
        assert.throws(() => owner(64, 'global-file'), /released/);
        assert.deepEqual(
          [m.load(272), m.load(276)],
          [1, 1],
          'new CG owner reads saved keys despite changed CGL source',
        );
        assert.deepEqual([m.load(2432), m.load(2436)], [0x11223344, 0x55667788]);
        assert.deepEqual([m.load(2464), m.load(2468)], [0x89abcdef, 0x10203040]);
        assert.equal(m.load(300), 0, 'reconstructed LIFO is empty after two meaningful pops');
        assert.equal(m.string(2304), '名前A');
      }
      if (kind === 'reader' && frame === 1) {
        assert.equal(m.string(2048), '名前C');
        assert.equal(m.string(2112), '差替本文');
        assert.equal(
          m.string(2496),
          '名前C',
          'new parsed Scene can append after every source owner is gone',
        );
        assert.equal(m.load(2560, 1), 0, 'clear reaches the subsequent speaker read');
        assert.equal(m.load(340), 2, 'actual VM expression consumes restored CG query results');
        for (const [slot, type] of [
          [72, 'cg-registration'],
          [76, 'display-log'],
          [80, 'scene-data'],
        ])
          assert.throws(() => owner(slot, type), /released/);
      }
    });
  });
