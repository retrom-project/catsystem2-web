// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadNativeGameStartupLanguage } from '../src/native/engine-language.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';

function lookupGameLabel(engine, value) {
  const p = engine.process,
    input = p.allocate(128, true);
  try {
    engine.kernel.writeString(input, value, true);
    return p.string(p.call(0x5abe00, [input]), true);
  } finally {
    p.free(input);
  }
}

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

test(
  'game startup owns the original Unicode language fallback tree through restore',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const profile = 'nekopara-vol3-engine-2.6.1.76',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      open = () =>
        NativeEngineProcess.open({
          profile,
          bytes,
          bootstrapOwner: {},
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          readFile: async () => null,
        }),
      engine = await open(),
      { head } = engine.refs.startupLanguage;
    let fresh;
    try {
      assert.equal(engine.process.load(0xbc3880), head);
      assert.equal(lookupGameLabel(engine, '表示'), '表示');
      assert.equal(lookupGameLabel(engine, '$TITLE$日本語の既定値'), '日本語の既定値');
      fresh = await open();
      fresh.restore(engine.snapshot());
      assert.equal(fresh.process.load(0xbc3880), head);
      assert.equal(lookupGameLabel(fresh, '$TITLE$恢复后的文本'), '恢复后的文本');
    } finally {
      await fresh?.close();
      await engine.close();
    }
    for (const instance of [engine, fresh]) {
      assert.equal(instance.process.allocations.has(head), false);
      assert.equal(instance.refs.startupLanguage, undefined);
    }
  },
);

test(
  'game startup selects and restores the original UTF-8 UI catalogue',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const profile = 'nekopara-vol3-engine-2.6.1.76',
      path = process.env.CATSYSTEM2_ENGINE_EXE,
      [bytes, startup] = await Promise.all([
        readFile(path),
        readFile(resolve(dirname(path), 'config/startup.xml')),
      ]),
      document = parseNativeXML(new Uint8Array(startup), 'utf-8'),
      source = new TextEncoder().encode(
        '$TITLE$\r\n作者の表題\r\n$EMPTY$\r\n$empty$\r\n$DUP$\r\n第一次\r\n' +
          '$DUP$\r\n第二次\r\n$LONG-AUTHORED-LABEL$\r\nA value longer than the short string layout\r\n',
      ),
      open = (source, reads) =>
        NativeEngineProcess.open({
          profile,
          bytes,
          bootstrapOwner: {},
          configuration: new NativeConfiguration({ profile, startup: document, uiLanguage: 0x409 }),
          readFile: async (name) => {
            if (name === 'config/startup.xml') return startup;
            reads.push(name);
            return name === 'language_en.txt' ? source : null;
          },
        }),
      reads = [],
      engine = await open(source, reads),
      reference = await open(source, []);
    let fresh;
    try {
      await loadNativeGameStartupLanguage(engine);
      const { process: p } = reference,
        filename = p.allocate(64, true);
      try {
        reference.kernel.writeString(filename, 'language_en.txt', true);
        p.cpu.reg_write_i32(p.uc.X86_REG_EDX, filename);
        assert.equal(await p.callAsync(0x5ab510, [], 0), 1);
      } finally {
        p.free(filename);
      }
      for (const label of [
        '$TITLE$Fallback',
        '$EMPTY$Fallback',
        '$DUP$Fallback',
        '$LONG-AUTHORED-LABEL$Fallback',
        '$UNKNOWN$Fallback',
      ])
        assert.equal(lookupGameLabel(engine, label), lookupGameLabel(reference, label));
      assert.match(lookupGameLabel(engine, '$TITLE$Fallback'), /作者の表題/);
      assert.equal(lookupGameLabel(engine, '$EMPTY$Fallback'), '');
      assert.equal(lookupGameLabel(engine, '$UNKNOWN$Fallback'), 'Fallback');
      assert.deepEqual(
        reads.filter((name) => name.startsWith('language_')),
        ['language_en.txt'],
      );
      assert.equal(engine.refs.startupLanguage.loaded, true);
      assert.equal(engine.refs.startupLanguage.filename, 'language_en.txt');
      assert.equal(engine.kernel.files.size, 0);
      fresh = await open(null, []);
      await loadNativeGameStartupLanguage(fresh);
      assert.equal(fresh.refs.startupLanguage.loaded, false);
      assert.equal(lookupGameLabel(fresh, '$TITLE$Fallback'), 'Fallback');
      fresh.restore(engine.snapshot());
      assert.equal(fresh.refs.startupLanguage.filename, 'language_en.txt');
      assert.equal(fresh.refs.startupLanguage.loaded, true);
      assert.equal(
        lookupGameLabel(fresh, '$TITLE$Fallback'),
        lookupGameLabel(engine, '$TITLE$Fallback'),
      );
    } finally {
      await fresh?.close();
      await reference.close();
      await engine.close();
    }
  },
);
