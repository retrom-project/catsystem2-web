// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
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
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 4,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};
const fonts = await Promise.all(
  [4, 3].map((bpp) =>
    encodeHG2(
      {
        bpp,
        width: 3,
        height: 2,
        rgba: Uint8Array.of(
          255,
          0,
          0,
          255,
          0,
          255,
          0,
          128,
          0,
          0,
          255,
          64,
          255,
          255,
          0,
          0,
          0,
          255,
          255,
          192,
          255,
          0,
          255,
          255,
        ),
      },
      { id: 1 },
    ),
  ),
);
for (const f of await engineFixtureSet())
  await test(
    `image-font square cells and missing selectors: ${f.profile}`,
    { skip: !f.available && f.reason },
    async () => {
      const e = await NativeEngineProcess.open(f),
        r = new NativeTextRuntime(e, { glyphs }),
        j = new JSTextRuntime(
          { ...e, profile: e.profile, process: e.process, registerFeature() {} },
          { glyphs },
        );
      try {
        for (const font of fonts)
          for (const mode of f.profile.startsWith('sdk-')
            ? ['cp932', 'nv']
            : ['cp932', 'utf8', 'nv'])
            for (const type of [0, 1])
              for (const selected of [1, 99]) {
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
                if (mode === 'nv') {
                  await old.section();
                  await fresh.section();
                }
                await old.userFont(font);
                await fresh.userFont(font);
                await old.resourceMessage(10, 65, selected);
                await fresh.resourceMessage(10, 65, selected);
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
                for (const frame of [0, 1, 10, 100, 0xffffffff]) {
                  const a = await old.draw(frame),
                    b = await fresh.draw(frame);
                  assert.equal(b, a, `${mode} done at${frame}`);
                  assert.deepEqual(
                    norm(fresh.records()),
                    norm(old.records()),
                    `${mode} records at${frame}`,
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
                  assert.deepEqual(jf, of, `${mode} pixels at${frame}`);
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
