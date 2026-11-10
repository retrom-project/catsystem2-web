// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { LegacyTextState } from '../../src/native/legacy-text-state.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
for (const f of await engineFixtureSet())
  await test(
    `legacy 40-byte cells and line-break profiles: ${f.profile}`,
    { skip: !f.available && f.reason },
    async () => {
      const e = await NativeEngineProcess.open(f),
        p = e.process,
        fn = f.profile.startsWith('sdk-') ? 0x4c24d0 : 0x5e6210;
      try {
        for (const options of [
          [96, 0, 0, 0],
          [48, 1, 1, 1],
          [36, 2, 1, 1],
        ])
          for (const source of [
            'AB',
            'ABCDEFGHIJK',
            '猫です。',
            'A\\nB',
            '[猫/ねこ]です',
            'A\\c0x112233;B',
            'A\\f12;BC[猫/ねこ]D',
            'A\\f+2;B\\fsC',
            '「猫の日本語。」',
            '……ああああああ',
            'a b c',
            'ｧabc',
          ]) {
            const js = new LegacyTextState(),
              config = new Uint8Array(1116),
              v = new DataView(config.buffer);
            for (const [at, value] of [
              [8, options[0]],
              [12, 128],
              [16, 4],
              [20, 1],
              [24, 24],
              [28, 12],
              [32, options[2]],
              [36, options[3]],
              [60, 128],
              [64, 0xffffff],
              [76, options[1]],
              [80, 1],
              [88, 1],
            ])
              v.setInt32(at, value, true);
            js.configure(config);
            const object = p.allocate(1904, true),
              rows = p.allocate(128 * 40, true),
              input = encodeCP932(source + '\0'),
              text = p.allocate(input.length, true);
            js.words.forEach((n, i) => p.store(object + i * 4, n));
            p.store(object + 684, rows);
            p.write(text, input);
            const result = await e.call(fn, [text], object);
            js.append(input);
            const native = p.read(rows, p.load(object + 688) * 40);
            if (Buffer.compare(js.bytes(), native)) {
              console.log(
                f.profile,
                options,
                source,
                'JS',
                JSON.stringify(js.rows.map((r) => [...r])),
                'X86',
                JSON.stringify(
                  Array.from({ length: native.length / 40 }, (_, i) => [
                    ...new Int32Array(native.buffer, native.byteOffset + i * 40, 10),
                  ]),
                ),
              );
            }
            assert.deepEqual(
              [...js.bytes()],
              [...native],
              f.profile + '/' + options + '/' + source,
            );
            assert.equal(result, Number(js.rows.length > 0));
            for (const at of [183, 459, 460])
              assert.equal(js.w(at), p.load(object + at * 4) | 0, source + ' word' + at);
            for (const at of [text, rows, object]) p.free(at);
          }
        console.log(f.profile, 'legacy parser pass');
      } finally {
        await e.close();
      }
    },
  );
