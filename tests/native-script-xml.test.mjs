// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import test from 'node:test';
import { encodeCP932 } from '../src/kcs/strings.mjs';

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS Script XML retains raw bytes and ownership across a fresh World',
    async () => {
      const sdk = nativeABI(profile).xmlEncoding === 'Shift_JIS',
        encode = sdk ? encodeCP932 : (text) => new TextEncoder().encode(text),
        encoding = sdk ? 'Shift_JIS' : 'UTF-8',
        declaration = `<?xml version="1.0" encoding="${encoding}"?>`,
        text = '日本語の値と&amp;長い文字列',
        file = 'config.int/sample.xml',
        files = {
          [file]: encode(
            declaration +
              `<document><group><word>${text}</word><number>-0x10</number></group><empty></empty></document>`,
          ),
          'malformed.xml': encode('<document><incomplete>'),
        },
        reads = [],
        make = async (initialize = true) => {
          const world = await dataWorld(profile, files, { initialize });
          const read = world.game.read;
          world.game.read = (name) => {
            reads.push(name);
            return read(name);
          };
          return world;
        },
        call = (world, id, ...args) =>
          world.runtime.native(
            'main',
            id,
            args,
            world.main.machine,
            world.main,
            world.runtime.scheduler,
          ),
        first = await make();
      let fresh;
      try {
        const m = first.main.machine;
        m.writeString('config.int/%s[G512].xml', 32);
        m.writeString('sample', 512);
        const opened = await call(first, 0x24e, 32),
          handle = opened.value;
        assert.equal(opened.control, 1);
        assert.ok(handle > 0);
        assert.ok(reads.includes(file));
        assert.ok(first.runtime.handles.get(handle, 'xml'));
        m.writeString('group/number', 128);
        assert.deepEqual(await call(first, 0x250, handle, 73, 128), {
          control: 1,
          value: -16 >>> 0,
        });
        m.writeString('group/word', 128);
        m.bytes(256, 128).fill(0x7e);
        assert.deepEqual(await call(first, 0x251, handle, 256, 128), { control: 2 });
        const expected = Uint8Array.from([...encode(text), 0, 0x7e]);
        assert.deepEqual(m.bytes(256, expected.length), expected);
        m.writeString('missing', 128);
        assert.deepEqual(await call(first, 0x250, handle, 73, 128), { control: 1, value: 73 });
        assert.deepEqual(await call(first, 0x251, handle, 256, 128), { control: 2 });
        assert.deepEqual(m.bytes(256, expected.length), expected);
        assert.deepEqual(await call(first, 0x250, 0, 73, 0x7fffffff), { control: 1, value: 73 });
        assert.deepEqual(await call(first, 0x251, 0, 0x7fffffff, 0x7fffffff), { control: 2 });
        assert.deepEqual(await call(first, 0x24f, 0), { control: 2 });
        assert.deepEqual(await call(first, 0x24e, 0x7fffffff), { control: 1, value: 0 });
        for (const name of ['malformed.xml', 'absent.xml']) {
          m.writeString(name, 32);
          assert.deepEqual(await call(first, 0x24e, 32), { control: 1, value: 0 });
        }

        const sourceReads = reads.filter((name) => name === file).length;
        fresh = await make(false);
        await fresh.restore(structuredClone(first.snapshot()));
        assert.ok(fresh.runtime.handles.get(handle, 'xml'));
        const vm = fresh.main.machine;
        vm.writeString('group/word', 128);
        vm.bytes(512, 128).fill(0x7e);
        await call(fresh, 0x251, handle, 512, 128);
        assert.deepEqual(vm.bytes(512, expected.length), expected);
        assert.equal(reads.filter((name) => name === file).length, sourceReads);
        assert.deepEqual(await call(fresh, 0x24f, handle), { control: 2 });
        assert.throws(() => fresh.runtime.handles.get(handle, 'xml'), /released/);
        assert.throws(() => call(fresh, 0x250, handle, 73, 128), /released/);
        assert.ok(first.runtime.handles.get(handle, 'xml'));
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
