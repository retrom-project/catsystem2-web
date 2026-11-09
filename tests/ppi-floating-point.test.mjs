// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process, parsePE32 } from '../src/ppi/pe32.mjs';
import { NativePPIRuntime } from '../src/ppi/native.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import {
  FLOATING_POINT_REGISTERS,
  captureFloatingPoint,
  restoreFloatingPoint,
} from '../src/ppi/floating-point.mjs';

test('complete x87 metadata and SIMD registers retain their exact ABI widths through process restore', async () => {
  const unicorn = await loadUnicorn(),
    p = new PE32Process(unicorn),
    fresh = new PE32Process(unicorn);
  try {
    const state = captureFloatingPoint(p);
    for (const [name, value] of [
      ['FIP', 0x8877665544332211n],
      ['FCS', 0x23n],
      ['FDP', 0x1122334455667788n],
      ['FDS', 0x2bn],
      ['FOP', 0x321n],
    ]) {
      const index = FLOATING_POINT_REGISTERS.findIndex(([register]) => register === name);
      for (let at = 0; at < state[index].length; at++)
        state[index][at] = Number((value >> BigInt(at * 8)) & 255n);
    }
    restoreFloatingPoint(p, state);
    assert.deepEqual(captureFloatingPoint(p), state);
    const saved = p.snapshot();
    for (const [name, size] of FLOATING_POINT_REGISTERS)
      assert.equal(saved.registers[name].byteLength, size, name);
    fresh.restore(structuredClone(saved));
    assert.deepEqual(captureFloatingPoint(fresh), state);
  } finally {
    fresh.close();
    p.close();
  }
});

test('PPI loader and exports use the engine thread floating-point context through fresh sandbox restore', async () => {
  const unicorn = await loadUnicorn(),
    owner = new PE32Process(unicorn),
    freshOwner = new PE32Process(unicorn),
    bytes = nativeParticleFixture(),
    pe = parsePE32(bytes),
    options = {
      unicornFactory: loadUnicorn,
      name: 'authored-thread.ppi',
      count: 1,
      width: 8,
      height: 8,
      screenWidth: 8,
      screenHeight: 8,
      now: () => 0,
      epoch: 0,
      nativeThread: () => owner,
    },
    runtime = await NativePPIRuntime.open(options),
    p = runtime.process,
    observed = [],
    detaches = [pe.entry, pe.exports.get(1).address].map((rva) =>
      p.beforeInstruction(pe.base + rva, 'authored floating-point loader ' + rva, () =>
        observed.push(p.cpu.reg_read_i32(p.uc.X86_REG_FPCW) & 0xffff),
      ),
    );
  let fresh;
  try {
    owner.cpu.reg_write_i32(owner.uc.X86_REG_FPCW, 0x7f);
    owner.cpu.reg_write_i32(owner.uc.X86_REG_MXCSR, 0x1f80);
    const instance = await runtime.create(bytes, options);
    assert.deepEqual(observed, [0x7f, 0x7f]);
    for (const detach of detaches.splice(0)) detach();
    const code = p.allocate(96, true);
    // FNSTCW observes the caller; FLDCW/LDMXCSR, SIMD writes and FLD1 modify
    // real emulated CPU state, including an intentionally retained x87 value.
    p.write(
      code,
      [
        0x83, 0xec, 8, 0xd9, 0x7c, 0x24, 0, 0x8b, 0x44, 0x24, 0, 0x8b, 0x51, 12, 0x89, 0x42, 112,
        0xc7, 4, 0x24, 0x7f, 0x0b, 0, 0, 0xd9, 0x2c, 0x24, 0xc7, 0x44, 0x24, 4, 0xa0, 0x5f, 0, 0,
        0x0f, 0xae, 0x54, 0x24, 4, 0x66, 0x0f, 0xef, 0xc0, 0x66, 0x0f, 0x76, 0xc9, 0xd9, 0xe8, 0x83,
        0xc4, 8, 0xc2, 12, 0,
      ],
    );
    p.store(instance.module.base + 0x2108, code);
    instance.update(0);
    assert.equal(p.load(instance.particleAddress + 112) & 0xffff, 0x7f);
    assert.equal(owner.cpu.reg_read_i32(owner.uc.X86_REG_FPCW) & 0xffff, 0xb7f);
    assert.equal(owner.cpu.reg_read_i32(owner.uc.X86_REG_MXCSR) >>> 0, 0x5fa0);
    assert([...owner.cpu.reg_read(owner.uc.X86_REG_XMM0, 16)].every((byte) => byte === 0));
    assert([...owner.cpu.reg_read(owner.uc.X86_REG_XMM1, 16)].every((byte) => byte === 255));
    assert.equal((owner.cpu.reg_read_i32(owner.uc.X86_REG_FPSW) >>> 11) & 7, 7);
    assert.deepEqual(
      owner.cpu.reg_read(owner.uc.X86_REG_FIP, 8),
      p.cpu.reg_read(p.uc.X86_REG_FIP, 8),
    );
    const saved = runtime.snapshot();
    freshOwner.restore(owner.snapshot());
    freshOwner.cpu.reg_write_i32(freshOwner.uc.X86_REG_FPCW, 0x77f);
    fresh = await NativePPIRuntime.fromSnapshot(saved, {
      ...options,
      nativeThread: () => freshOwner,
      readPlugin: async () => bytes,
    });
    assert.equal(freshOwner.cpu.reg_read_i32(freshOwner.uc.X86_REG_FPCW) & 0xffff, 0x77f);
    const restored = [...fresh.instances.values()][0];
    restored.update(1);
    assert.equal(fresh.process.load(restored.particleAddress + 112) & 0xffff, 0x77f);
    assert.equal((freshOwner.cpu.reg_read_i32(freshOwner.uc.X86_REG_FPSW) >>> 11) & 7, 6);
    assert.equal((owner.cpu.reg_read_i32(owner.uc.X86_REG_FPSW) >>> 11) & 7, 7);
    assert.equal(owner.cpu.reg_read_i32(owner.uc.X86_REG_FPCW) & 0xffff, 0xb7f);
  } finally {
    for (const detach of detaches) detach();
    fresh?.close();
    runtime.close();
    freshOwner.close();
    owner.close();
  }
});

test(
  'frozen PPI DLLs retain original particle bytes under both engine x87 precisions',
  { skip: !process.env.CATSYSTEM2_PPI_FIXTURES },
  async () => {
    const golden = JSON.parse(
        await readFile(new URL('./fixtures/ppi-native-controls.json', import.meta.url)),
      ),
      plist = new Uint8Array(
        await readFile(new URL('./fixtures/ppi-native.plist', import.meta.url)),
      ),
      unicorn = await loadUnicorn();
    assert.equal(
      createHash('sha256')
        .update(await readFile(new URL('../scripts/native-ppi-wine-oracle.cpp', import.meta.url)))
        .digest('hex'),
      golden.sourceSHA256,
    );
    for (const row of golden.cases) {
      const owner = new PE32Process(unicorn),
        options = {
          unicornFactory: loadUnicorn,
          name: row.name,
          count: 4,
          width: 64,
          height: 64,
          screenWidth: 1280,
          screenHeight: 720,
          now: () => 0,
          epoch: 0,
          nativeThread: () => owner,
          registers: Array(32).fill(1),
          attachPlane: 31,
          attachment: () => ({ base: [32, 32, 0], pos: [640, 360, 0], disp: 1 }),
          readParticleData: () => plist,
        },
        runtime = await NativePPIRuntime.open(options);
      try {
        owner.cpu.reg_write_i32(owner.uc.X86_REG_FPCW, row.controlWord);
        const bytes = new Uint8Array(
          await readFile(process.env.CATSYSTEM2_PPI_FIXTURES + '/' + row.name),
        );
        assert.equal(createHash('sha256').update(bytes).digest('hex'), row.pluginSHA256);
        const instance = await runtime.create(bytes, options),
          records = [instance.records()];
        for (const frame of [0, 1, 2, 15, 60, 61]) {
          instance.update(frame);
          records.push(instance.records());
          assert.equal(owner.cpu.reg_read_i32(owner.uc.X86_REG_FPCW) & 0xffff, row.controlWord);
        }
        assert.equal(
          createHash('sha256').update(Buffer.concat(records)).digest('hex'),
          row.recordSHA256,
          row.name + ' CW=' + row.controlWord.toString(16),
        );
      } finally {
        runtime.close();
        owner.close();
      }
    }
  },
);

test(
  'SDK full native startup gives PPI the one engine thread before and after a World checkpoint',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      profile = 'sdk-4.01-engine-2.6.1.74',
      create = () => {
        const game = memoryGame({
            'engine.exe': bytes,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
            'ptclpi/authored.ppi': nativeParticleFixture(),
          }),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        Object.assign(configuration.screen, {
          width: 640,
          height: 480,
          currentWidth: 640,
          currentHeight: 480,
          virtualWidth: 640,
          virtualHeight: 480,
        });
        return new NativeWorld({
          game,
          images: {},
          host: {},
          profile,
          random,
          configuration,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = create();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const root = [...world.objects.objects.values()].find((record) => record.kind === 1),
        id = await world.objects.create({
          kind: 16,
          parent: root.id,
          creator: root.id,
          name: 'authored PPI thread',
        }),
        task = world.particles.get(id);
      await task.load({ family: 'plugin', program: 'authored', count: 1, priority: 0 });
      const p = world.nativeEngine.process,
        plugin = task.bank.instance;
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_FPCW) & 0xffff, 0x7f);
      assert.equal(plugin.process.cpu.reg_read_i32(plugin.process.uc.X86_REG_FPCW) & 0xffff, 0x7f);
      plugin.start();
      p.cpu.reg_write_i32(p.uc.X86_REG_FPCW, 0x37f);
      plugin.update(0);
      assert.equal(plugin.process.cpu.reg_read_i32(plugin.process.uc.X86_REG_FPCW) & 0xffff, 0x37f);
      fresh = create();
      await fresh.restore(structuredClone(world.snapshot()));
      const next = fresh.particles.get(id).bank.instance,
        q = fresh.nativeEngine.process;
      q.cpu.reg_write_i32(q.uc.X86_REG_FPCW, 0x7f);
      next.update(1);
      assert.equal(next.process.cpu.reg_read_i32(next.process.uc.X86_REG_FPCW) & 0xffff, 0x7f);
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_FPCW) & 0xffff, 0x37f);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
