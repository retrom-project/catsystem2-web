// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeTextRuntime } from '../../oracle/text.mjs';
import { JSTextRuntime } from '../../src/native/text-core.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
const font = new Uint8Array(
  await readFile(new URL('../../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url)),
);
const glyphs = {
  measure: () => {
    throw Error('GDI measured FT font');
  },
  glyph: () => {
    throw Error('GDI rastered FT font');
  },
};
const norm = (b) => {
  b = b.slice();
  for (let i = 0; i < b.length; i += 88) b[i + 6] = b[i + 7] = 0;
  return [...b];
};
for (const f of await engineFixtureSet())
  await test(
    `fixed FreeType metrics and exact pixels: ${f.profile}`,
    { skip: !f.available && f.reason },
    async () => {
      const e = await NativeEngineProcess.open(f),
        world = {
          game: { read: async (path) => (path.endsWith('test.ttf') ? font : null) },
          getNativeFeature: async (n) => e.features.get(n),
        };
      new NativeEngineFiles(e, world);
      const r = new NativeTextRuntime(e, { glyphs }),
        j = new JSTextRuntime(
          { ...e, profile: e.profile, process: e.process, registerFeature() {} },
          { glyphs, world },
        );
      try {
        for (const mode of f.profile.startsWith('sdk-') ? ['cp932'] : ['cp932', 'utf8'])
          for (const size of [12, 24])
            for (const text of ['AB', '\u732b\u3002', '\\$29483;A']) {
              const old = await r.create(mode),
                fresh = await j.create(mode),
                packet = await r.defaultPacket(mode),
                config = packet.slice(4, 4 + old.bindings.configSize),
                v = new DataView(config.buffer);
              v.setUint32(4, 100, true);
              v.setUint32(8, 72, true);
              v.setUint32(32, size, true);
              config.fill(0, 128, config.length - 24);
              if (f.profile.startsWith('sdk-'))
                config.set(new TextEncoder().encode('test.ttf'), 128);
              else
                for (let i = 0; i < 8; i++)
                  v.setUint16(128 + i * 2, 'test.ttf'.charCodeAt(i), true);
              v.setUint32(config.length - (mode === 'utf8' ? 8 : 4), 1, true);
              await old.configure(config);
              await fresh.configure(config);
              await old.append(text);
              await fresh.append(text);
              await old.parse();
              await fresh.parse();
              assert.deepEqual(
                norm(fresh.records()),
                norm(old.records()),
                `${f.profile}/${mode}/${size}/${text} parse`,
              );
              await old.draw(0xffffffff);
              await fresh.draw(0xffffffff);
              assert.deepEqual(
                norm(fresh.records()),
                norm(old.records()),
                `${mode}/${size}/${text} rect`,
              );
              const a = old.frame(),
                b = fresh.frame();
              let mismatches = [];
              for (let i = 0; i < a.rgba.length; i++)
                if (a.rgba[i] !== b.rgba[i]) {
                  mismatches.push([i, a.rgba[i], b.rgba[i]]);
                  if (mismatches.length === 8) break;
                }
              if (mismatches.length) console.log(f.profile, mode, size, text, mismatches);
              assert.deepEqual([...b.rgba], [...a.rgba], `${mode}/${size}/${text} pixels`);
              await old.close();
              await fresh.close();
            }
        console.log(f.profile, 'FT pass');
      } finally {
        await r.close();
        await j.close();
        await e.close();
      }
    },
  );
