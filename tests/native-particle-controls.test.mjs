// SPDX-License-Identifier: MPL-2.0
import { PPIRegistry } from '../src/ppi/plugin-identity.mjs';
import { authoredPPI, authoredPPIRegistry } from './fixtures/ppi-js-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { floatBits } from '../src/kcs.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

test('2.6.1.63 story Particle controls route signed alpha and neutral attachment', async () => {
  const world = await dataWorld('rebellions-jp-engine-2.6.1.63');
  try {
    const particle = await world.objects.create({ kind: 16, parent: world.root }),
      target = world.nativeTaskID(particle),
      task = world.main,
      call = (id, args) => world.runtime.native('main', id, args, task.machine, task),
      state = world.particles.get(particle).state;
    assert.deepEqual(await call(426, [0, 0]), { control: 2 });
    assert.equal(state.alpha, 256);
    for (const [word, alpha] of [
      [254, 254],
      [255, 256],
      [0xffffffff, -1],
    ]) {
      assert.deepEqual(await call(426, [target, word]), { control: 2 });
      assert.equal(state.alpha, alpha);
    }
    assert.deepEqual(await call(427, [target, 77]), { control: 2 });
    assert.equal(state.attachment, 77);
    assert.deepEqual(await call(427, [target, 0]), { control: 2 });
    assert.equal(state.attachment, -1);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 loads, updates and stops a live script Particle bank', async () => {
  const world = await dataWorld('rebellions-jp-engine-2.6.1.63', {
    'ptcl/probe.kcs': kcsProgram([[59]]),
  });
  try {
    world.graphics.createLogicalDevice();
    const particle = await world.objects.create({ kind: 16, parent: world.root }),
      target = world.nativeTaskID(particle),
      task = world.main,
      machine = task.machine,
      call = (id, ...args) => world.runtime.native('main', id, args, machine, task);
    machine.writeString('probe', 160);
    machine.writeString('', 192);
    const registers = Float32Array.from({ length: 32 }, (_, i) => i * 0.5 - 9);
    machine.bytes(256, 128).set(new Uint8Array(registers.buffer));
    assert.deepEqual(await call(271, target, 160, 192, 2, floatBits(12.25), 256), {
      control: 1,
      value: 1,
    });
    const bank = world.particles.get(particle).bank;
    assert.equal(bank.program, 'ptcl/probe.kcs');
    assert.equal(bank.count, 2);
    assert.equal(bank.priority, 12.25);
    assert.deepEqual(bank.registers, registers);
    const unresolvedGraph = 0x12345;
    assert.deepEqual(await call(427, target, unresolvedGraph), { control: 2 });
    assert.equal(bank.attachment, null);
    assert.equal(bank.instance.attachPlane, unresolvedGraph);
    assert.deepEqual(await call(274, 0), { control: 1, value: 0 });
    assert.deepEqual(await call(272, target), { control: 2 });
    assert.deepEqual(await call(274, target), { control: 1, value: 1 });
    assert.equal(bank.instance.attachPlane, unresolvedGraph);
    assert.deepEqual(await call(427, target, 0), { control: 2 });
    assert.equal(bank.instance.attachPlane, -1);
    registers[4] = -111;
    machine.bytes(256, 128).set(new Uint8Array(registers.buffer));
    assert.deepEqual(await call(275, target, 256), { control: 2 });
    assert.deepEqual(bank.registers, registers);
    assert.deepEqual(await call(273, target), { control: 2 });
    assert.deepEqual(await call(274, target), { control: 1, value: 0 });
  } finally {
    await world.close();
  }
});

test('2.6.1.67 KCS Particle load and controls use their original raw World messages', async (t) => {
  const profile = 'bokutomo-engine-2.6.1.67',
    target = [0x13, 512],
    plugin = [0x13, 516],
    marker = 0xa5a5a5a5,
    call = (id, args, output) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      ...(output === undefined ? [] : [[38, output]]),
    ],
    body = kcsProgram(
      [
        [37, marker],
        ...call(271, [target, 2048, 2080, 2, floatBits(12.25), 1024], 520),
        ...call(693, [plugin, 2112, 2080, 2, floatBits(12.25), 1024], 524),
        ...call(274, [target], 528),
        ...call(274, [0x6010aa], 532),
        ...call(427, [target, 0x81234567]),
        ...call(426, [target, 0xffffffff]),
        ...call(272, [target]),
        ...call(272, [plugin]),
        ...call(274, [target], 536),
        ...call(275, [target, 1152]),
        ...call(273, [target]),
        ...call(274, [target], 540),
        [59],
      ],
      [
        [2048, '雪'],
        [2080, ''],
        [2112, 'ptclpi/emitter.ppi'],
      ],
    ),
    world = await dataWorld(profile, {
      'ptcl/雪.kcs': kcsProgram([[59]]),
      'ptclpi/emitter.ppi': nativeParticleFixture(),
      'particle.kcs': body,
    });
  t.after(() => world.close());
  world.graphics.createLogicalDevice();
  world.particles.host.registry = authoredPPIRegistry(['emitter']);
  const first = await world.objects.create({ kind: 16, parent: world.root }),
    second = await world.objects.create({ kind: 16, parent: world.root }),
    task = await world.spawnScript('particle.kcs', { parent: world.root, initialExecute: false }),
    m = task.machine,
    words = Array.from({ length: 32 }, (_, index) => floatBits(index * 0.5 - 9)),
    receipts = [],
    dispatch = world.sendNativeEngine.bind(world);
  for (const [address, id] of [
    [512, first],
    [516, second],
  ])
    m.store(address, world.nativeTaskID(id));
  words[1] = 0xff812345;
  for (let i = 0; i < 32; i++) {
    m.store(1024 + i * 4, words[i]);
    m.store(1152 + i * 4, words[31 - i]);
  }
  world.sendNativeEngine = (target, sender, id, w, l, context) => {
    if (sender === task.id)
      receipts.push({
        id,
        target,
        w,
        l,
        flags: context.flags,
        packet: id === 303 ? context.payload.data.slice() : null,
      });
    return dispatch(target, sender, id, w, l, context);
  };
  const sp = m.sp;
  await world.runtime.scheduler.execute(task);
  assert.equal(m.pop(), marker);
  assert.equal(m.sp, sp);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => m.load(520 + i * 4)),
    [1, 1, 0, 0, 1, 0],
  );
  assert.deepEqual(
    receipts.map(({ id }) => id),
    [303, 303, 307, 307, 310, 309, 304, 304, 307, 308, 305, 307],
  );
  assert.ok(receipts.every(({ w, flags }) => w === 0 && flags === 0));
  for (const [index, { packet }] of receipts.slice(0, 2).entries()) {
    const view = new DataView(packet.buffer);
    assert.equal(packet.length, 656);
    assert.equal(view.getUint32(0, true), index);
    assert.equal(view.getUint32(260, true), 2);
    assert.equal(view.getUint32(264, true), floatBits(12.25));
    assert.equal(view.getUint32(272, true), 0xffc12345);
    assert.equal(view.getUint32(396, true), 0);
  }
  const particle = world.particles.get(first),
    other = world.particles.get(second);
  assert.equal(particle.bank.program, 'ptcl/雪.kcs');
  assert.equal(particle.state.alpha, -1);
  assert.equal(particle.state.attachment >>> 0, 0x81234567);
  assert.equal(particle.bank.attachment, null);
  assert.equal(particle.bank.instance.active, false);
  assert.equal(other.bank.program, 'ptclpi/emitter.ppi');
  assert.equal(other.bank.instance.state.inits, 1);
  words[1] = 0xffc12345;
  assert.deepEqual([...new Uint32Array(particle.bank.registers.buffer)], words.reverse());
  await world.tick();
  assert.equal(other.bank.instance.module.shared.execs, 1);
});

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
            particleRegistry: new PPIRegistry({ implementations: { emitter: authoredPPI } }),
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
        await world.ensureNativeEngine();
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
        const deliver = world.sendNativeEngine.bind(world),
          receipts = [];
        world.sendNativeEngine = async (target, sender, message, w, l, context) => {
          if (message === 319)
            receipts.push([
              [world.nativeTaskID(sender), target, message - offset, w],
              context.flags,
              context.payload.bytes(l, 128).slice(),
            ]);
          return deliver(target, sender, message, w, l, context);
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
