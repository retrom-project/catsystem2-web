// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeTextRuntime } from '../../oracle/text.mjs';
import { NativeTextParser } from '../../src/native/text-parser.mjs';
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
for (const fixture of await engineFixtureSet())
  await test(
    `parser placement, kinsoku and ruby records: ${fixture.profile}`,
    { skip: !fixture.available && fixture.reason },
    async () => {
      const e = await NativeEngineProcess.open(fixture),
        runtime = new NativeTextRuntime(e, { glyphs });
      try {
        for (const mode of fixture.profile.startsWith('sdk-') ? ['cp932'] : ['cp932', 'utf8'])
          for (const options of [
            [64, 0, 0, 0],
            [48, 1, 0, 0],
            [36, 1, 1, 1],
          ])
            for (const text of [
              'AB',
              'ABCDEFGHIJK',
              '猫です。',
              'A\\nB',
              '[猫/ねこ]です',
              '\\pcABC',
              'A\\pcBC',
              'A\\prBC',
              'A\\x12;B',
              'A\\y12;B',
              '\\iAB',
              'A\\n\\iBC',
              'a b c',
              '（猫）の台詞。',
              'あいう。！！次',
              '「猫の日本語。」',
              '……ああああああ',
              'A\\f12;BC[猫/ねこ]D',
              'A\\x1;B',
              'A\\x2;B',
              '\\$8212; A',
            ]) {
              const writer = await runtime.create(mode),
                cfg = (await runtime.defaultPacket(mode)).subarray(4, -12).slice(),
                v = new DataView(cfg.buffer);
              v.setUint32(4, options[0], true);
              v.setUint32(8, 96, true);
              v.setUint32(104, options[1], true);
              v.setUint32(80, options[2], true);
              v.setUint32(108, options[3], true);
              const parser = new NativeTextParser({
                profile: fixture.profile,
                mode,
                glyphs,
                config: cfg,
              });
              await writer.configure(cfg);
              parser.appendText(text);
              await writer.append(text);
              parser.parse();
              await writer.parse();
              const bytes = writer.records();
              for (let i = 0; i < bytes.length; i += 88) {
                bytes[i + 6] = bytes[i + 7] = 0;
              }
              if (Buffer.compare(parser.bytes(), bytes)) {
                const words = (b) =>
                  Array.from({ length: b.length / 88 }, (_, i) =>
                    Array.from({ length: 22 }, (_, j) =>
                      new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(
                        i * 88 + j * 4,
                        true,
                      ),
                    ),
                  );
                console.log(
                  text,
                  'JS',
                  JSON.stringify(words(parser.bytes())),
                  'X86',
                  JSON.stringify(words(bytes)),
                );
              }
              assert.deepEqual(
                [...parser.bytes()],
                [...bytes],
                fixture.profile + '/' + mode + '/' + options + ' ' + text,
              );
              await writer.close();
            }
        console.log(fixture.profile, 'basic placement pass');
      } finally {
        await runtime.close();
        await e.close();
      }
    },
  );
