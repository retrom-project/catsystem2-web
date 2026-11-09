// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { floatBits } from '../src/kcs.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, variable, receiver, offset] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x4d06f0, 5],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x5f5eb0, 0],
])
  test(
    profile + ' original particle wrappers route live controls and preserve a fresh task',
    { skip: !process.env[variable] },
    async () => {
      const game = memoryGame({
          'engine.exe': new Uint8Array(await readFile(process.env[variable])),
          'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          'controls.kcs': kcsProgram([[37, [0x14, 48]], [37, [0x14, 52]], [43, 0x113, 8], [59]]),
          'ptcl/emitter.kcs': kcsProgram([[59]]),
          'ptclpi/emitter.ppi': nativeParticleFixture(),
        }),
        make = () => {
          const random = new ParticleRandom();
          return new NativeWorld({
            game,
            profile,
            configuration: new NativeConfiguration({ profile }),
            images: {},
            host: {},
            random,
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage: { read: (name) => game.read(name) },
          });
        },
        world = make();
      let fresh;
      try {
        world.root = await world.objects.create({ kind: 1, name: 'BASE TASK', frameRate: 60 });
        world.main = await world.spawnScript('main.kcs');
        const particle = await world.objects.create({ kind: 16, parent: world.root }),
          target = world.nativeTaskID(particle),
          missing = 0xfecafeee,
          call = (state, id, ...args) =>
            state.runtime.native('main', id, args, state.main.machine, state.main);
        assert.deepEqual(await call(world, 0x112, missing), { control: 1, value: 0 });
        assert.deepEqual(await call(world, 0x113, missing, 0xffffffff), { control: 2 });
        const { process: p } = world.nativeEngine,
          raw = p.allocate(0x600, true),
          payload = p.allocate(128, true),
          out = p.allocate(4, true),
          send = (message, l) => p.call(receiver, [0, message - offset, 0, l, 0, out], raw),
          particleTask = world.particles.get(particle);
        p.store(raw + 108, 1);
        p.store(raw + 876, 1);
        for (const [id, message, field, values] of [
          [0x1aa, 320, 'alpha', [0, 254, 255, 256, 0x7fffffff, 0x80000000, 0xffffffff]],
          [0x1ab, 321, 'attachment', [0, 77, 0xffffffff, 0x80000000]],
        ])
          for (const value of values) {
            assert.equal(send(message, value), 0);
            assert.deepEqual(await call(world, id, target, value), { control: 2 });
            const position = field === 'alpha' ? 852 : 812;
            assert.equal(particleTask.state[field] >>> 0, p.load(raw + position));
          }
        assert.deepEqual(await call(world, 0x110, target), { control: 2 });
        assert.equal(send(315, 0), 0);
        assert.equal(send(318, 0), 0);
        assert.deepEqual(await call(world, 0x112, target), { control: 1, value: p.load(out) });
        const writer = await world.spawnScript('controls.kcs'),
          input = writer.machine.allocate(128),
          words = Uint8Array.from({ length: 128 }, (_, i) => (i * 139 + 97) & 255);
        writer.machine.store(48, target);
        writer.machine.store(52, input);
        writer.machine.bytes(input, 128).set(words);
        p.write(payload, words);
        assert.equal(send(319, payload), 0);
        const feature = world.nativeEngine.features.get('particle-commands'),
          deliver = feature.send.bind(feature),
          receipts = [];
        feature.send = async (packet) => {
          if (packet[2] === 319 - offset)
            receipts.push([packet.slice(0, 4), packet[5], p.read(packet[4], 128)]);
          return deliver(packet);
        };
        await world.tick();
        assert.deepEqual(receipts, [
          [[world.nativeTaskID(writer.id), target, 319 - offset, 0], 0, p.read(raw + 396, 128)],
        ]);
        assert.deepEqual(writer.machine.bytes(input, 128), words);
        p.free(raw);
        p.free(out);
        p.free(payload);
        fresh = make();
        await fresh.restore(structuredClone(world.snapshot()));
        assert.deepEqual(fresh.particles.get(particle).state, particleTask.state);
        assert.deepEqual(await call(fresh, 0x112, target), { control: 1, value: 1 });
        assert.deepEqual(await call(fresh, 0x111, target), { control: 2 });
        assert.deepEqual(await call(fresh, 0x112, target), { control: 1, value: 0 });
        await call(fresh, 0x1ab, target, 0);
        const m = fresh.main.machine,
          values = Float32Array.from({ length: 32 }, (_, i) => 7.5 - i * 1.25);
        m.writeString('emitter', 160);
        m.writeString('', 192);
        values.forEach((value, i) => m.store(256 + 4 * i, floatBits(value)));
        for (const [id, family, file] of [
          [0x10f, 'script', 'ptcl/emitter.kcs'],
          [0x2b5, 'plugin', 'ptclpi/emitter.ppi'],
        ]) {
          assert.deepEqual(await call(fresh, id, target, 160, 192, 2, floatBits(12.25), 256), {
            control: 1,
            value: 1,
          });
          const bank = fresh.particles.get(particle).bank;
          assert.equal(bank.program, file);
          assert.equal(bank.family, family);
          assert.equal(bank.priority, 12.25);
          assert.equal(bank.count, 2);
          assert.equal(bank.started, false);
          assert.deepEqual(bank.registers, values);
        }
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
