// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeTextRuntime } from '../../oracle/text.mjs';
import { JSTextRuntime } from '../../src/native/text-core.mjs';
const glyphs = {
  measure: (_f, text) => ({
    width: text.length * 4,
    height: 8,
    ascent: 6,
    descent: 2,
    averageWidth: 4,
    maximumWidth: 8,
  }),
  glyph: () => ({
    width: 5,
    height: 2,
    originX: -1,
    originY: 2,
    advanceX: 7,
    advanceY: 0,
    alpha: Uint8Array.of(0, 64, 128, 192, 255, 255, 192, 128, 64, 0),
  }),
};
const norm = (b) => {
  b = b.slice();
  for (let i = 0; i < b.length; i += 88) b[i + 6] = b[i + 7] = 0;
  return [...b];
};
for (const f of await engineFixtureSet())
  await test(
    `incremental append, page, configure, clocks and NV sections: ${f.profile}`,
    { skip: !f.available && f.reason },
    async () => {
      const e = await NativeEngineProcess.open(f),
        r = new NativeTextRuntime(e, { glyphs }),
        j = new JSTextRuntime(
          { ...e, profile: e.profile, process: e.process, registerFeature() {} },
          { glyphs, rate: 10 },
        );
      e.process.store(e.refs.settings + (f.profile.startsWith('sdk-') ? 47380 : 50044), 10);
      try {
        for (const mode of f.profile.startsWith('sdk-') ? ['cp932', 'nv'] : ['cp932', 'utf8', 'nv'])
          for (const type of [0, 1]) {
            const a = await r.create(mode),
              b = await j.create(mode),
              packet = await r.defaultPacket(mode),
              cfg = packet.slice(4, 4 + a.bindings.configSize),
              v = new DataView(cfg.buffer);
            if (mode === 'nv') {
              v.setUint32(0, 128, true);
              v.setUint32(4, 128, true);
              for (const at of [8, 24 + a.runtime.bindings('cp932').configSize]) {
                v.setInt32(at, at === 8 ? 24 : 0, true);
                v.setInt32(at + 8, at === 8 ? 128 : 24, true);
                v.setInt32(at + 12, 128, true);
              }
              for (const at of [24, 40 + a.runtime.bindings('cp932').configSize]) {
                v.setUint32(at + 4, 128, true);
                v.setUint32(at + 8, 128, true);
                v.setUint32(at + 112, 2, true);
              }
            } else {
              v.setUint32(0, type, true);
              v.setUint32(4, 128, true);
              v.setUint32(8, 128, true);
              v.setUint32(112, 2, true);
            }
            const both = async (method, ...args) => {
              const x = await a[method](...args),
                y = await b[method](...args);
              if (['draw', 'remaining', 'speed', 'lineCount', 'endPosition'].includes(method))
                assert.deepEqual(y, x, `${mode}/${type}/${method}`);
              assert.deepEqual(
                norm(b.records()),
                norm(a.records()),
                `${mode}/${type}/${method} records`,
              );
              if (a.config) {
                assert.deepEqual(b.frame(), a.frame(), `${mode}/${type}/${method} pixels`);
              }
              return y;
            };
            await both('configure', cfg);
            if (mode === 'nv') await both('section');
            await both('append', 'A\\w3;B');
            await both('remaining');
            await both('endPosition');
            await both('parse');
            await both('draw', 1);
            await both('speed', 20);
            await both('draw', 3);
            await both('mark');
            await both('append', 'C');
            await both('draw', 7, 0);
            await both('draw', 9, -1);
            if (mode !== 'nv') {
              await both('shift', 5);
              await both('configure', cfg);
              await both('append', 'D');
              await both('draw', 20, -1);
            } else {
              await both('append', '\\r\\rX');
              await both('appendSecondary', 'Y');
              await both('draw', 15);
              await both('section');
              await both('append', '[猫/ねこ]Z');
              await both('appendSecondary', 'Sub');
              await both('draw', 30);
              await both('configure', cfg);
              await both('redraw');
              await both('draw', 40);
            }
            await both('clear');
            if (mode === 'nv') await both('section');
            await both('append', 'E');
            await both('draw', 0xffffffff);
            await a.close();
            await b.close();
          }
        console.log(f.profile, 'sequence pass');
      } finally {
        await r.close();
        await j.close();
        await e.close();
      }
    },
  );
