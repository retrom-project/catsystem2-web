// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeTextRuntime } from '../src/native/text.mjs';

const fonts = [
    { face: 'Fixed', fullName: '固定幅', charset: 128, pitchAndFamily: 1 },
    { face: 'Proportional', fullName: '可変幅', charset: 128, pitchAndFamily: 2 },
    { face: '@Vertical', fullName: '@縦書き', charset: 128, pitchAndFamily: 1 },
    { face: 'Latin', charset: 0, pitchAndFamily: 1 },
    { face: 'Raster', charset: 128, pitchAndFamily: 1, type: 1 },
  ],
  glyphs = {
    measure: () => ({ height: 18, ascent: 14, descent: 4, averageWidth: 7, maximumWidth: 13 }),
  };

for (const [profile, variable, construct, destroy, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x578c20, 0x578ca0, 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x6a8760, 0x6a87e0, 'W'],
])
  test(
    `${profile} original font enumeration filters charset, pitch, type and vertical names`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        make = async () => {
          const engine = await NativeEngineProcess.open({ profile, bytes });
          new NativeTextRuntime(engine, { glyphs, fontFamilies: () => fonts });
          return engine;
        },
        engine = await make(),
        p = engine.process,
        pointer = p.allocate(20, true),
        wide = suffix === 'W',
        names = (process) => {
          const rows = process.load(pointer + 16);
          return Array.from({ length: process.load(pointer + 12) }, (_, i) =>
            process.string(rows + i * (wide ? 128 : 64), wide),
          );
        },
        enumName = 'gdi32.dll!EnumFontFamilies' + suffix;
      let restored;
      try {
        for (const [charset, vertical, proportional, expected] of [
          [128, 0, 0, ['固定幅']],
          [128, 0, 1, ['固定幅', '可変幅']],
          [128, 1, 0, ['@縦書き']],
          [0, 0, 1, ['Latin']],
          [129, 0, 1, []],
        ]) {
          assert.equal(
            await engine.call(construct, [0, charset, vertical, proportional], pointer),
            pointer,
          );
          assert.deepEqual(names(p), expected);
          assert.equal(engine.features.get('text').windows.objects.size, 0);
          await engine.call(destroy, [], pointer);
        }
        assert.equal(engine.kernel.calls.get(enumName), 10);
        await engine.call(construct, [0, 128, 0, 1], pointer);
        restored = await make();
        restored.restore(engine.snapshot());
        assert.deepEqual(names(restored.process), ['固定幅', '可変幅']);
        await restored.call(destroy, [], pointer);
        assert.equal(restored.process.load(pointer + 16), 0);
        assert.deepEqual(names(p), ['固定幅', '可変幅']);
        await engine.call(destroy, [], pointer);
      } finally {
        await restored?.close();
        await engine.close();
      }
    },
  );
