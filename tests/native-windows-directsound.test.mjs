// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { installNativeDirectSound } from '../src/native/windows-directsound.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const api = (engine, name, ...args) =>
  engine.call(engine.kernel.resolve({ dll: 'KERNEL32.dll', name }), args);
const com = (engine, pointer, slot, ...args) => {
  const p = engine.process;
  return engine.call(p.load(p.load(pointer) + slot * 4), [pointer, ...args]);
};
const PCM = [0x00020001, 44100, 176400, 0x00100004];

test('DirectSound primary buffer keeps its identity, PCM and cooperative level after a fresh restore', async () => {
  const unicorn = await loadUnicorn(),
    make = () => {
      const engine = new NativeEngineProcess(unicorn);
      installNativeDirectSound(engine, () => true);
      return engine;
    },
    engine = make(),
    p = engine.process,
    out = p.allocate(4, true),
    desc = p.allocate(36, true),
    format = p.allocate(18, true),
    written = p.allocate(4, true),
    pcm = (process) => PCM.map((_, index) => process.load(format + index * 4));
  let fresh;
  try {
    const module = engine.kernel.moduleHandle('dsound.dll'),
      name = p.allocate(32, true);
    engine.kernel.writeString(name, 'DirectSoundCreate8');
    const create = await api(engine, 'GetProcAddress', module, 11);
    assert.equal(create, await api(engine, 'GetProcAddress', module, name));
    assert.ok(create);
    assert.equal(await engine.call(create, [0, out, 1]), 0x80040110);
    assert.equal(p.load(out), 0);
    assert.equal(await engine.call(create, [0, out, 0]), 0);
    const device = p.load(out);
    p.store(desc, 36);
    p.store(desc + 4, 1);
    p.store(desc + 8, 32);
    assert.equal(await com(engine, device, 3, desc, out, 0), 0x80070057);
    assert.equal(p.load(out), 0);
    p.store(desc + 8, 0);
    assert.equal(await com(engine, device, 3, desc, out, 0), 0);
    const primary = p.load(out);
    assert.equal(await com(engine, primary, 5, format, 18, written), 0);
    assert.equal(p.load(written), 18);
    assert.deepEqual(pcm(p), [0x00020001, 22050, 44100, 0x00080002]);
    assert.equal(await com(engine, primary, 5, format, 5, written), 0x80070057);
    assert.equal(p.load(written), 0);
    assert.equal(await com(engine, primary, 5, 0, 0, written), 0);
    assert.equal(p.load(written), 18);
    PCM.forEach((word, index) => p.store(format + index * 4, word));
    assert.equal(await com(engine, primary, 14, format), 0x88780046);
    assert.equal(await com(engine, device, 6, 0, 2), 0);
    assert.equal(await com(engine, primary, 14, format), 0);
    p.store(format + 8, 44100);
    assert.equal(await com(engine, primary, 14, format), 0x80070057);
    assert.equal(await com(engine, device, 3, desc, out, 0), 0);
    assert.equal(p.load(out), primary);
    assert.equal(await com(engine, primary, 2), 1);
    const buffer8 = p.allocate(16, true);
    [0x6825a449, 0x4d827524, 0xe3500f92, 0x1eabb36a].forEach((word, index) =>
      p.store(buffer8 + index * 4, word),
    );
    assert.equal(await com(engine, primary, 0, buffer8, out), 0x80004002);
    assert.equal(p.load(out), 0);

    fresh = make();
    fresh.restore(engine.snapshot());
    assert.equal(await com(fresh, primary, 5, format, 18, written), 0);
    assert.deepEqual(pcm(fresh.process), PCM);
    assert.equal(await com(fresh, primary, 14, format), 0);
    assert.equal(await com(fresh, primary, 2), 0);
    assert.equal(await com(fresh, device, 3, desc, out, 0), 0);
    assert.equal(fresh.process.load(out), primary);
    assert.equal(await com(fresh, device, 2), 0);
    assert.equal(await com(fresh, primary, 5, format, 18, written), 0);
    assert.equal(await com(fresh, primary, 2), 0);
    assert.equal(fresh.process.allocations.has(primary), false);
    assert.equal(fresh.process.allocations.has(device), false);
    assert.equal(await com(engine, primary, 2), 0);
    assert.equal(await com(engine, device, 2), 0);
  } finally {
    await fresh?.close();
    await engine.close();
  }
});

for (const [profile, variable, delayImport, initialize, ownerBytes] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x865d37, 0x4aa3f0, 0x150],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x7c5373, 0x5cd370, 0x250],
]) {
  test(
    `${profile} resolves its original DirectSound delay import and initializes the primary PCM format`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ profile, bytes }),
        p = engine.process,
        owner = p.allocate(ownerBytes, true);
      let available = true;
      try {
        installNativeDirectSound(engine, () => available);
        assert.equal(await engine.call(delayImport, [0, owner + 4, 0]), 0);
        const device = p.load(owner + 4),
          format = p.allocate(18, true);
        assert.ok(device);
        assert.equal(await com(engine, device, 6, 0, 2), 0);
        assert.equal(await engine.call(initialize, [], owner), 1);
        const primary = p.load(owner + 8);
        assert.ok(primary);
        assert.equal(await com(engine, primary, 5, format, 18, 0), 0);
        assert.deepEqual(
          PCM.map((_, index) => p.load(format + index * 4)),
          PCM,
        );
        assert.equal(await com(engine, primary, 2), 0);
        assert.equal(await com(engine, device, 2), 0);
        available = false;
        assert.equal(await engine.call(delayImport, [0, owner + 4, 0]), 0x88780078);
        assert.equal(p.load(owner + 4), 0);
        assert.equal(engine.kernel.calls.get('dsound.dll!DirectSoundCreate8'), 2);
      } finally {
        await engine.close();
      }
    },
  );
}
