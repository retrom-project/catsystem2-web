// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeLPB, nativeLV } from './fixtures/native-lip.mjs';

test(
  'the original LPB and LV drivers parse authored sidecars, reject invalid LPB headers and survive a fresh process',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      open = () => NativeEngineProcess.open({ profile: 'nekopara-vol3-engine-2.6.1.76', bytes }),
      first = await open(),
      p = first.process,
      input = p.allocate(512, true),
      lpb = p.allocate(64, true),
      lv = p.allocate(60, true),
      source = nativeLPB(),
      golden = JSON.parse(
        await readFile(new URL('./fixtures/native-lip-golden.json', import.meta.url), 'utf8'),
      );
    let second;
    try {
      await first.call(0x5a19e0, [], lpb);
      // The LV constructor is inlined in the model installer. This leaf-parser
      // test supplies its established averaging-radius field explicitly.
      p.store(lv + 40, 1);
      p.write(input, source);
      assert.equal(first.identity, golden.engineSHA256);
      assert.equal(await first.call(0x5a1a90, [input, source.length, 0], lpb), golden.lpb.result);
      assert.equal(p.load(lpb + 60), golden.lpb.count);
      const sampleBytes = p.read(p.load(lpb + 52), 32);
      assert.deepEqual([...new Uint32Array(sampleBytes.buffer)], golden.lpb.values);
      assert.deepEqual(
        [...new Uint32Array(p.read(p.load(lpb + 56), 32).buffer)],
        golden.lpb.backup,
      );
      const saved = first.snapshot();
      second = await open();
      second.restore(saved);
      const q = second.process;
      assert.deepEqual(q.read(q.load(lpb + 52), 32), sampleBytes);
      for (const [offset, value, size] of [
        [0, 0, source.length],
        [8, 31, source.length],
        [12, 0, source.length],
        [12, 8, 19],
        [12, 8, 8 * 32 - 1],
      ]) {
        q.write(input, source);
        q.store(input + offset, value);
        assert.equal(await second.call(0x5a1a90, [input, size, 0], lpb), 0);
        for (const field of [48, 52, 56, 60]) assert.equal(q.load(lpb + field), 0);
      }
      const levels = nativeLV();
      q.write(input, levels);
      assert.equal(
        await second.call(0x5a1df0, [input, levels.length + 3, 0], lv),
        golden.lv.result,
      );
      assert.equal(q.load(lv + 56), golden.lv.count);
      assert.deepEqual([...new Uint32Array(q.read(q.load(lv + 48), 32).buffer)], golden.lv.values);
      assert.deepEqual([...new Uint32Array(q.read(q.load(lv + 52), 32).buffer)], golden.lv.backup);
      q.store(lv + 40, 0);
      assert.equal(await second.call(0x5a1df0, [input, levels.length, 0], lv), 1);
      assert.deepEqual(q.read(q.load(lv + 48), 32), levels);
      await second.call(0x5a1a60, [1], lpb);
      await second.call(0x5a1d90, [1], lv);
      assert.equal(q.allocations.has(lpb), false);
      assert.equal(q.allocations.has(lv), false);
      await first.call(0x5a1a60, [1], lpb);
      await first.call(0x5a1d90, [1], lv);
    } finally {
      await second?.close();
      await first.close();
    }
  },
);
