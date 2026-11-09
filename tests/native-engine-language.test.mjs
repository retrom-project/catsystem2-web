// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';

test(
  'SDK startup parses optional language.txt in native memory and releases it after restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      catalogue = encodeCP932(
        '$TITLE$\r\n日本語ラベル\r\n$EMPTY$\r\n$empty$\r\n$TITLE$\r\nDuplicate\r\n' +
          '$LONG-AUTHORED-LABEL$\r\nAn authored value longer than the inline capacity\r\n',
      ),
      open = (source, reads) =>
        NativeEngineProcess.open({
          profile,
          bytes,
          bootstrapOwner: { glyphs: {} },
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          readFile: async (path) => {
            reads.push(path);
            return path === 'language.txt' ? source : null;
          },
        }),
      lookup = (engine, label) => {
        const p = engine.process,
          input = p.allocate(128, true);
        try {
          engine.kernel.writeString(input, label);
          const address = p.call(0x47ecf0, [input]);
          return { text: p.string(address), original: address === input };
        } finally {
          p.free(input);
        }
      },
      reads = [],
      engine = await open(catalogue, reads);
    let fresh;
    const state = engine.refs.startupLanguage;
    try {
      assert.equal(reads[0], 'language.txt', 'original file probe precedes the Engine owner');
      assert.equal(state.loaded, true);
      assert.deepEqual(lookup(engine, '$TITLE$Fallback'), {
        text: '日本語ラベル',
        original: false,
      });
      assert.deepEqual(lookup(engine, '$EMPTY$Fallback'), { text: '', original: false });
      assert.deepEqual(lookup(engine, '$UNKNOWN$Fallback'), { text: 'Fallback', original: false });
      assert.deepEqual(lookup(engine, 'Without a key'), { text: 'Without a key', original: true });
      assert.equal(
        lookup(engine, '$LONG-AUTHORED-LABEL$Fallback').text,
        'An authored value longer than the inline capacity',
      );
      assert.equal(engine.kernel.files.size, 0);
      const checkpoint = engine.snapshot();
      fresh = await open(null, []);
      assert.equal(fresh.refs.startupLanguage.loaded, false);
      assert.equal(lookup(fresh, '$TITLE$Fallback').text, 'Fallback');
      fresh.restore(checkpoint);
      assert.deepEqual(fresh.refs.startupLanguage, state);
      assert.deepEqual(lookup(fresh, '$TITLE$Fallback'), { text: '日本語ラベル', original: false });
    } finally {
      await fresh?.close();
      await engine.close();
    }
    for (const instance of [engine, fresh]) {
      assert.equal(instance.process.allocations.has(state.head), false);
      assert.equal(instance.refs.startupLanguage, undefined);
    }
  },
);
