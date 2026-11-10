// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeEngineFiles, NATIVE_MEMORY_FILE_LAYOUTS } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { memoryGame, kif, kcsProgram } from './helpers.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { NativeResourceCache } from '../src/native/resource-cache.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} mounted IFile keeps original read, seek, close and checkpoint state`,
    { skip: !process.env[variable] },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable])),
        bytes = Uint8Array.of(11, 22, 33, 44, 55, 66),
        layout = NATIVE_MEMORY_FILE_LAYOUTS[profile],
        create = async () => {
          const engine = await NativeEngineProcess.open({ profile, bytes: exe }),
            world = {
              game: memoryGame({ 'fonts/authored.bin': bytes, claimed: bytes }),
              async getNativeFeature(name) {
                if (engine.features.has(name)) return engine.features.get(name);
                if (name === 'data-buffers') return new NativeDataBuffers(engine);
                throw new Error(`Unknown authored native feature ${name}`);
              },
            };
          engine.kernel.registerFiles('authored temporary namespace', {
            read: async (path) => (path === 'claimed' ? null : undefined),
          });
          const files = new NativeEngineFiles(engine, world);
          return { engine, world, files };
        },
        first = await create();
      let second;
      try {
        const p = first.engine.process,
          source = p.allocate(128, true),
          out = p.allocate(32, true),
          path = 'fonts/authored.bin';
        if (layout.wide) {
          path.split('').forEach((c, i) => p.write(source + i * 2, [c.charCodeAt(0), 0]));
        } else p.write(source, encodeCP932(path + '\0'));
        const pointer = await first.engine.call(layout.open, [source, 3], 0),
          vtable = p.load(pointer),
          data = p.load(pointer + layout.data),
          invoke = (engine, offset, args = []) =>
            engine.call(vtable ? engine.process.load(vtable + offset) : 0, args, pointer);
        assert.ok(pointer && data);
        assert.equal(
          p.load(data - 4),
          1,
          'the original hidden heap reference belongs to this file',
        );
        assert.equal(await invoke(first.engine, 36), bytes.length);
        assert.equal(await invoke(first.engine, 12, [out, 4]), 4);
        assert.deepEqual(p.read(out, 4), bytes.subarray(0, 4));
        const saved = first.engine.snapshot();
        second = await create();
        await second.world.getNativeFeature('data-buffers');
        second.engine.restore(saved);
        assert.equal(await invoke(second.engine, 12, [out, 8]), 2);
        assert.deepEqual(second.engine.process.read(out, 2), bytes.subarray(4));
        assert.equal(await invoke(second.engine, 12, [out, 1]), 0xffffffff);
        assert.equal(
          await invoke(second.engine, 24, [100]),
          bytes.length - 1,
          'original seek clamps to the last byte rather than EOF',
        );
        assert.equal(await invoke(second.engine, 12, [out, 1]), 1);
        assert.equal(second.engine.process.read(out, 1)[0], 66);
        assert.equal(await invoke(second.engine, 8), 1);
        assert.equal(second.engine.process.allocations.has(data - 4), false);
        await invoke(second.engine, 0, [1]);
        assert.equal(second.engine.process.allocations.has(pointer), false);
        assert.equal(
          await first.files.read('claimed'),
          null,
          'a temporary provider can own a missing path without mounted fallback',
        );
        assert.equal(await first.files.read('missing'), null);
        await assert.rejects(first.files.open(source, 2), /search mode 2/);
        await invoke(first.engine, 0, [1]);
      } finally {
        await second?.engine.close();
        await first.engine.close();
      }
    },
  );

test(
  'game wide category filenames match the original resolver and preserve output bounds',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const startup = new TextEncoder().encode(
        '<?xml version="1.0" encoding="UTF-8"?><document><INT><int00><name>image</name><int>絵.int</int><ext>hg2</ext></int00><int01><name>mot</name><int>motion.int</int><ext>kcs</ext></int01><int02><name>plain</name><int></int><ext>bin</ext></int02></INT></document>',
      ),
      game = new GameFiles(
        new Map([
          ['startup.xml', new BlobFile(new Blob([startup]))],
          ['main.kcs', new BlobFile(new Blob([kcsProgram([[59]])]))],
        ]),
      );
    await game.open();
    const engine = await NativeEngineProcess.open({
        profile: 'nekopara-vol3-engine-2.6.1.76',
        bytes: new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      }),
      p = engine.process,
      source = p.allocate(520, true),
      category = p.allocate(64, true),
      output = p.allocate(524, true),
      cases = [
        ['image', 'portrait'],
        ['IMAGE', '立ち絵'],
        ['image', 'portrait.hg3'],
        ['image', 'portrait.'],
        ['mot', 'dummy'],
        ['plain', 'standalone'],
        ['image', 'folder/立ち絵.hg3'],
        ['missing', 'folder\\portrait.hg3'],
        ['image', 'C:\\folder\\portrait.hg3'],
        ['missing', 'portrait'],
      ],
      wide = (text) => {
        const bytes = new Uint8Array((text.length + 1) * 2),
          view = new DataView(bytes.buffer);
        for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
        return bytes;
      },
      invoke = async ([kind, name]) => {
        p.write(source, wide(name));
        p.write(category, encodeCP932(kind + '\0'));
        p.write(output, new Uint8Array(524).fill(0xa5));
        const result = await engine.call(0x5d3b30, [output + 2, source, category]);
        return { result, bytes: p.read(output, 524), path: p.string(output + 2, true) };
      };
    try {
      // Only marshal the authored startup INT records. The original helper,
      // classifier, extension/path parser and Win32 conversions remain live.
      for (const entry of game.nativeResources.entries) {
        const offset = entry.id * 332;
        p.write(engine.refs.owner + 5312 + offset, encodeCP932(entry.name + '\0'));
        p.write(engine.refs.settings + 3964 + offset, encodeCP932(entry.archive + '\0'));
        p.write(engine.refs.settings + 3996 + offset, encodeCP932(entry.extension + '\0'));
      }
      const original = [];
      for (const probe of cases) original.push(await invoke(probe));
      new NativeEngineFiles(engine, { game });
      for (const [i, probe] of cases.entries()) {
        const actual = await invoke(probe);
        assert.deepEqual(actual, original[i], JSON.stringify(probe));
        assert.deepEqual(actual.bytes.slice(0, 2), Uint8Array.of(0xa5, 0xa5));
        assert.deepEqual(actual.bytes.slice(-2), Uint8Array.of(0xa5, 0xa5));
      }
      assert.equal(original[1].path, '絵.int/立ち絵.hg2');
      assert.equal(original.at(-1).result, 0);
      assert.equal(original.at(-1).path, '');
    } finally {
      await engine.close();
    }
  },
);

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original IFile exposes all mount search modes and preload before file candidates`,
    { skip: !process.env[variable] },
    async () => {
      const files = {
          'startup.xml': new TextEncoder().encode(
            '<?xml version="1.0" encoding="UTF-8"?><document><INT><int00><name>image</name><int>a.int</int><ext>bin</ext><dir>loose</dir></int00></INT></document>',
          ),
          'a.int': kif([['same.bin', Uint8Array.of(11)]]),
          'loose/same.bin': Uint8Array.of(101),
          'same.bin': Uint8Array.of(100),
        },
        game = new GameFiles(
          new Map(
            Object.entries(files).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
          ),
        );
      await game.open();
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
          readFile: async (name) => (name === 'loose/same.bin' ? Uint8Array.of(77) : null),
        }),
        resourceCache = new NativeResourceCache({ read: async () => Uint8Array.of(99) }),
        world = {
          game,
          resourceCache,
          async getNativeFeature(name) {
            if (name !== 'data-buffers') throw new Error(`Unknown authored feature ${name}`);
            return engine.features.get(name) ?? new NativeDataBuffers(engine);
          },
        },
        platform = new NativeEngineFiles(engine, world),
        p = engine.process,
        layout = NATIVE_MEMORY_FILE_LAYOUTS[profile],
        name = p.allocate(128, true),
        out = p.allocate(4, true);
      const input = (path) => {
          p.zero(name, 128);
          if (layout.wide) [...path].forEach((c, i) => p.write(name + i * 2, [c.charCodeAt(0), 0]));
          else p.write(name, encodeCP932(path));
        },
        value = async (mode) => {
          const pointer = await engine.call(layout.open, [name, mode], 0);
          if (!pointer) return null;
          const vtable = p.load(pointer),
            data = p.load(pointer + layout.data);
          try {
            assert.equal(await engine.call(p.load(vtable + 12), [out, 1], pointer), 1);
            return p.read(out, 1)[0];
          } finally {
            await engine.call(p.load(vtable), [1], pointer);
            assert.equal(p.allocations.has(data - 4), false);
          }
        };
      try {
        input('a.int/same.bin');
        for (const [mode, expected] of [
          [0, null],
          [1, null],
          [2, 11],
          [3, 77],
          [4, 11],
          [5, null],
          [0x10003, 77],
        ])
          assert.equal(await value(mode), expected, `mode ${mode}`);
        const narrow = p.allocate(128, true),
          readOut = p.allocate(12, true);
        p.write(narrow, encodeCP932('a.int/same.bin\0'));
        for (const [reader, source] of [
          [layout.read, narrow],
          ...(layout.readWide ? [[layout.readWide, name]] : []),
        ]) {
          for (const flags of [3, 0x13, 0x10003, 0x10013]) {
            p.write(readOut, new Uint8Array(12).fill(0xa5));
            assert.equal(
              await engine.call(reader, [source, readOut + 4, flags], 0),
              1,
              `reader ${reader.toString(16)}, flags ${flags}`,
            );
            assert.deepEqual(
              p.read(readOut, 12),
              Uint8Array.of(0xa5, 0xa5, 0xa5, 0xa5, 77, 0xa5, 0xa5, 0xa5, 0xa5, 0xa5, 0xa5, 0xa5),
            );
            assert.equal(
              await engine.call(reader, [source, 0, flags], 0),
              1,
              'NULL output requests only the original file size',
            );
          }
          // The game ANSI reader does not check MultiByteToWideChar's failure
          // before using its stack filename. Fix the test's scratch input so
          // a previous successful read cannot supply that filename.
          p.write(p.stackTop - 0x8000, new Uint8Array(0x8000));
          assert.equal(
            await engine.call(reader, [0, readOut, 0x13], 0),
            0,
            'NULL filename with empty caller scratch does not open a resource',
          );
          assert.equal(
            await engine.call(reader, [source, readOut, 0x10012], 0),
            1,
            'bit 0x10 is removed while archive-only mode 2 remains',
          );
          assert.equal(p.read(readOut, 1)[0], 11);
          assert.equal(
            await engine.call(reader, [source, readOut, 0x10010], 0),
            0,
            'clearing bit 0x10 does not invent a default search mode',
          );
        }
        await resourceCache.queue('a.int/same.bin', 60);
        await resourceCache.start();
        await resourceCache.settle();
        for (const mode of [0, 1, 2, 3, 4, 5])
          assert.equal(await value(mode), 99, `cached ${mode}`);
        await resourceCache.clear();
        input('same.bin');
        assert.equal(await value(1), 100);
        assert.deepEqual(await platform.read('@cat/image/same', 2), Uint8Array.of(11));
        const category = p.allocate(32, true),
          resolved = p.allocate(260, true),
          categoryAddress = profile.startsWith('sdk-') ? 0x4b0830 : 0x5d39e0;
        p.write(category, encodeCP932('image\0'));
        p.write(narrow, encodeCP932('same\0'));
        assert.equal(await engine.call(categoryAddress, [resolved, narrow, category]), 1);
        assert.equal(p.string(resolved), 'a.int/same.bin');
        p.write(narrow, encodeCP932('explicit/path.hg3\0'));
        assert.equal(await engine.call(categoryAddress, [resolved, narrow, category]), 1);
        assert.equal(p.string(resolved), 'explicit/path.hg3');
        p.write(category, encodeCP932('missing-category\0'));
        p.write(narrow, encodeCP932('same\0'));
        assert.equal(await engine.call(categoryAddress, [resolved, narrow, category]), 0);
        assert.equal(p.string(resolved), '');
      } finally {
        await resourceCache.close();
        await engine.close();
      }
    },
  );
