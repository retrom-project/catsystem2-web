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
for (const f of await engineFixtureSet())
  await test(
    `gray64 glyphs, shadows and reveal modes: ${f.profile}`,
    { skip: !f.available && f.reason },
    async () => {
      const e = await NativeEngineProcess.open(f),
        r = new NativeTextRuntime(e, { glyphs }),
        j = new JSTextRuntime(
          { ...e, profile: e.profile, process: e.process, registerFeature() {} },
          { glyphs },
        );
      try {
        for (const mode of f.profile.startsWith('sdk-') ? ['cp932'] : ['cp932', 'utf8'])
          for (const [type, shadow, weight] of [
            [0, 0, 400],
            [0, 1, 400],
            [0, 2, 700],
            [1, 0, 400],
            [1, 1, 700],
          ]) {
            const old = await r.create(mode),
              fresh = await j.create(mode),
              packet = await r.defaultPacket(mode);
            assert.deepEqual(
              [...(await j.defaultPacket(mode))],
              [...packet],
              `defaultPacket ${f.profile}/${mode}`,
            );
            const config = packet.slice(4, 4 + old.bindings.configSize),
              v = new DataView(config.buffer);
            if (mode !== 'nv') {
              v.setUint32(0, type, true);
              v.setUint32(4, 64, true);
              v.setUint32(8, 64, true);
            } else {
              v.setUint32(0, 64, true);
              v.setUint32(4, 64, true);
              v.setUint32(16, 64, true);
              v.setUint32(20, 64, true);
              v.setUint32(28, 64, true);
              v.setUint32(32, 64, true);
            }
            await old.configure(config);
            await fresh.configure(config);
            v.setUint32(112, 2, true);
            v.setUint32(config.length - (mode === 'utf8' ? 28 : 24), weight, true);
            v.setUint32(config.length - (mode === 'utf8' ? 24 : 20), Number(shadow === 1), true);
            v.setUint32(config.length - (mode === 'utf8' ? 20 : 16), Number(shadow === 2), true);
            await old.configure(config);
            await fresh.configure(config);
            e.process.store(e.refs.settings + (f.profile.startsWith('sdk-') ? 47380 : 50044), 10);
            fresh.parser.rate = 10;
            await old.append('AB');
            await fresh.append('AB');
            await old.parse();
            await fresh.parse();
            const norm = (b) => {
              b = b.slice();
              for (let i = 0; i < b.length; i += 88) b[i + 6] = b[i + 7] = 0;
              return [...b];
            };
            assert.deepEqual(norm(fresh.records()), norm(old.records()), `${mode}parse`);
            for (const frame of [0, 1, 2, 4, 9, 20, 100, 0xffffffff]) {
              const a = await old.draw(frame),
                b = await fresh.draw(frame);
              if (b !== a)
                console.log(
                  mode,
                  type,
                  shadow,
                  weight,
                  frame,
                  fresh.parser.rows.map((r) => [r[1], r[11], r[12], r[15], r[18]]),
                  Array.from({ length: old.records().length / 88 }, (_, i) =>
                    Array.from({ length: 22 }, (_, j) =>
                      new DataView(old.records().buffer).getInt32(i * 88 + j * 4, true),
                    ),
                  ),
                );
              assert.equal(b, a, `${mode}/${type}/${shadow}/${weight} done at${frame}`);
              assert.deepEqual(
                norm(fresh.records()),
                norm(old.records()),
                `${mode}/${type}/${shadow}/${weight} records at${frame}`,
              );
              const of = old.frame(),
                jf = fresh.frame();
              if (Buffer.compare(Buffer.from(of.rgba), Buffer.from(jf.rgba))) {
                const coords = (b) => {
                  const rows = [];
                  for (let i = 3; i < b.rgba.length; i += 4)
                    if (b.rgba[i])
                      rows.push([
                        ((i - 3) / 4) % b.width,
                        Math.floor((i - 3) / 4 / b.width),
                        ...b.rgba.subarray(i - 3, i + 1),
                      ]);
                  return rows.slice(0, 8);
                };
                console.log('pixel', f.profile, mode, type, frame, coords(jf), coords(of));
              }
              assert.deepEqual(jf, of, `${mode}/${type}/${shadow}/${weight} pixels at${frame}`);
            }
            await old.close();
            await fresh.close();
          }
        console.log(f.profile, 'writers pass');
      } finally {
        await r.close();
        await e.close();
      }
    },
  );
