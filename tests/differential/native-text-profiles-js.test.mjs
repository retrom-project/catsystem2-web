// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeTextRuntime } from '../../oracle/text.mjs';
import { JSTextRuntime } from '../../src/native/text-core.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
const glyphs = {
  measure: (_f, text) => ({
    width: text.length * 4,
    height: 8,
    ascent: 6,
    descent: 2,
    averageWidth: 4,
    maximumWidth: 8,
  }),
};
const norm = (b) => {
  b = b.slice();
  for (let i = 0; i < b.length; i += 88) b[i + 6] = b[i + 7] = 0;
  return [...b];
};
for (const f of await engineFixtureSet())
  await test(
    `kinsoku profile add/remove/clear sequences: ${f.profile}`,
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
          for (const category of [0, 1, 2, 3, 4]) {
            const a = await r.create(mode),
              b = await j.create(mode),
              cfg = (await r.defaultPacket(mode)).slice(4, 4 + a.bindings.configSize),
              v = new DataView(cfg.buffer);
            v.setUint32(4, 48, true);
            v.setUint32(8, 96, true);
            v.setUint32(108, 1, true);
            await a.configure(cfg);
            await b.configure(cfg);
            for (const phase of [0, 1, 2]) {
              if (phase === 0) {
                await a.profile(category, 'AB（）。……');
                await b.profile(category, 'AB（）。……');
              } else if (phase === 1) {
                const bytes = encodeCP932('XA（。');
                await a.input(Uint8Array.from([...bytes, 0]), (p) =>
                  a.resourceMessage(13, category, p),
                );
                await b.category(category, bytes);
              } else if (!f.profile.startsWith('sdk-')) {
                await a.resourceMessage(19, category, 0);
                await b.resourceMessage(19, category, 0);
              } else continue;
              await a.clear();
              await b.clear();
              await a.append('（AB。……）ABCABCABC');
              await b.append('（AB。……）ABCABCABC');
              await a.parse();
              await b.parse();
              assert.deepEqual(
                norm(b.records()),
                norm(a.records()),
                `${f.profile}/${mode}/${category}/${phase}`,
              );
            }
            await a.close();
            await b.close();
          }
        console.log(f.profile, 'profile add/remove/clear pass');
      } finally {
        await r.close();
        await j.close();
        await e.close();
      }
    },
  );
