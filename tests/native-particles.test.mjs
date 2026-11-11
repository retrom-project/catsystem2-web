// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { NativeBufferMemory } from '../src/native/buffer-memory.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { installNativeParticles, NATIVE_PARTICLE_IDS } from '../src/native/particles.mjs';
import { KCSMachine, floatBits } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { memoryGame } from './helpers.mjs';
const backend = new URL('../.local/vendor/ppi/unicorn_x86.js', import.meta.url),
  available = existsSync(backend);
let pending;
const unicornFactory = () => (pending ||= import(backend).then((module) => module.default()));

function script() {
  const header = new Uint8Array(52),
    view = new DataView(header.buffer),
    body = new Uint8Array([59]);
  header.set([75, 67, 83, 0]);
  view.setUint32(4, 2, true);
  view.setUint16(8, 2, true);
  view.setUint32(12, 52, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, 53, true);
  view.setUint32(32, 256, true);
  view.setUint32(36, 256, true);
  view.setUint32(40, 53, true);
  view.setUint32(48, 1, true);
  return new Uint8Array([...header, ...deflateSync(body)]);
}
function setup() {
  const files = new Map([
      ['ptcl/probe.kcs', script()],
      ['ptclpi/probe.ppi', nativeParticleFixture()],
    ]),
    handlers = new Map(),
    objects = new NativeObjects(),
    machine = new KCSMachine({
      body: new Binary(new Uint8Array([59])),
      codeSize: 1,
      data: new Uint8Array(4096),
      stackSize: 256,
    }),
    stage = { width: 8, height: 8, frame: 0, emitters: {} },
    world = {
      frame: 0,
      objects,
      images: { frame: async () => ({ width: 8, height: 8, rgba: new Uint8Array(256).fill(255) }) },
      random: new ParticleRandom(),
      host: {},
      game: {
        width: 8,
        height: 8,
        has: (name) => name === 'image/quad.hg3' || files.has(name),
        require: async (name) => {
          if (!files.has(name)) throw new Error(`Missing fixture ${name}`);
          return files.get(name);
        },
      },
      runtime: {
        imageDataBuffers: { process: new NativeBufferMemory() },
        register: (_table, id, handler) => handlers.set(id, handler),
        services: { format: (address, current) => current.string(address) },
      },
      graphics: {
        stage,
        attachment: (id) => (id === 77 ? { base: [1, 2, 3], pos: [4, 5, 6], display: true } : null),
      },
      base: (record) => ({
        message: ([, message]) => {
          if (message === 3) {
            record.destroyRequested = true;
            return 0;
          }
          throw new Error(`unknown base message ${message}`);
        },
      }),
      sendNativeEngine(target, sender, message, w, l, context) {
        context.nativeRouted = Boolean(this.objects.objects.get(target));
        return this.particles.send(target, sender, message, w, l, context);
      },
    };
  objects.machine = () => machine;
  installNativeParticles(world, { unicornFactory, atlas: undefined });
  machine.writeString('probe', 32);
  machine.writeString('quad', 64);
  for (let i = 0; i < 32; i++) machine.store(128 + i * 4, floatBits(i + 0.5));
  const call = (id, args) => handlers.get(id)(args, machine, { id: 900 });
  return { world, machine, call, handlers };
}

test('native particle factory and main PTCL wrappers route real task IDs, raw registers and attachment state', async () => {
  const { world, machine, call, handlers } = setup();
  assert.deepEqual([...handlers.keys()], NATIVE_PARTICLE_IDS);
  const id = await world.objects.create({ kind: 16 }),
    task = world.particles.get(id);
  assert.equal(task.bank, null);
  await call(0x110, [id]);
  assert.equal((await call(0x112, [id])).value, 1);
  await call(0x111, [id]);
  await call(0x1aa, [id, 128]);
  await call(0x1ab, [id, 77]);
  assert.equal((await call(0x10f, [id, 32, 64, 2, floatBits(10000), 128])).value, 1);
  assert.equal(task.bank.family, 'script');
  assert.equal(task.bank.started, false);
  assert.equal(task.bank.alpha, 128);
  assert.equal(task.bank.instance.attachPlane, 77);
  assert.deepEqual(
    [...task.bank.registers],
    Array.from({ length: 32 }, (_, i) => i + 0.5),
  );
  assert.equal((await call(0x110, [id])).control, 2);
  await world.objects.tick(5);
  assert.equal(task.bank.instance.frame, 0);
  await world.objects.tick(8);
  assert.equal(task.bank.instance.before, 0);
  assert.equal(task.bank.instance.frame, 3);
  assert.equal(world.particles.drawItems().length, 1);
  machine.store(128, floatBits(9));
  await call(0x113, [id, 128]);
  assert.equal(task.bank.registers[0], 9);
  await world.objects.release(id);
  assert.equal(world.particles.host.banks.size, 0);
  world.particles.close();
});

test('particle inheritance retains the routing context and native registration identity', async () => {
  const { world } = setup(),
    id = await world.objects.create({ kind: 16 }),
    task = world.particles.get(id),
    context = { nativeNewTask: 91, nativeSenderWorldID: 900, flags: 1 };
  const words = [900, 2, 4, 91];
  task.base.message = (received, forwarded) => {
    assert.deepEqual(received, words);
    assert.equal(forwarded, context);
    forwarded.nativeUnhandled = true;
    return undefined;
  };
  assert.equal(await task.message(words, context), undefined);
  assert.equal(context.nativeUnhandled, true);
  await world.objects.release(id);
  world.particles.close();
});

test(
  'native PPI tasks execute repeated equal-frame callbacks and checkpoint one shared guest process',
  { skip: !available },
  async () => {
    const a = setup();
    let b;
    try {
      const ids = [
        await a.world.objects.create({ kind: 16 }),
        await a.world.objects.create({ kind: 16 }),
      ];
      for (const id of ids) {
        await a.call(0x2b5, [id, 32, 64, 2, floatBits(10000), 128]);
        await a.call(0x110, [id]);
      }
      const first = a.world.particles.get(ids[0]),
        second = a.world.particles.get(ids[1]);
      assert.equal(first.bank.instance.module, second.bank.instance.module);
      await a.world.objects.tick(5);
      await a.world.objects.tick(5);
      assert.equal(first.bank.instance.particles()[0].disp, 3);
      assert.equal(second.bank.instance.particles()[0].disp, 4);
      await a.call(0x111, [ids[0]]);
      await a.call(0x111, [ids[0]]);
      const p = second.bank.instance;
      assert.equal(p.process.load(p.module.base + 0x2128), 2);
      await a.call(0x110, [ids[0]]);
      const objectState = a.world.objects.snapshot(),
        particleState = a.world.particles.snapshot();
      await a.world.objects.tick(12);
      const expected = ids.map((id) => a.world.particles.get(id).bank.instance.records());
      b = setup();
      await b.world.objects.restore(objectState);
      await b.world.particles.restore(particleState);
      await b.world.objects.tick(12);
      for (const [index, id] of ids.entries())
        assert.deepEqual(b.world.particles.get(id).bank.instance.records(), expected[index]);
      await a.world.objects.release(ids[0]);
      assert.equal(p.process.load(p.module.base + 0x2128), 2); // Destruction releases without an extra Stop.
      assert.equal(p.process.load(p.module.base + 0x2124), 1);
    } finally {
      for (const owner of [a, b].filter(Boolean)) {
        for (const id of [...owner.world.objects.objects.keys()])
          await owner.world.objects.release(id);
        owner.world.particles.close();
      }
    }
  },
);

test(
  'the complete NativeWorld saves live PPI tasks and restores their shared DLL execution',
  { skip: !available },
  async () => {
    const make = () => {
      const profile = 'nekopara-vol3-engine-2.6.1.76',
        game = memoryGame({ 'main.kcs': script(), 'ptclpi/probe.ppi': nativeParticleFixture() }),
        random = new ParticleRandom(),
        configuration = new NativeConfiguration({ profile });
      game.width = 8;
      game.height = 8;
      return new NativeWorld({
        game,
        random,
        configuration,
        profile,
        host: {},
        images: {
          frame: async () => ({ width: 8, height: 8, rgba: new Uint8Array(256).fill(255) }),
        },
        storage: {
          read: (name) => game.read(name),
          write: async () => true,
          remove: async () => true,
          stat: async () => null,
        },
        motionLibrary: new MotionLibrary(game, { profile, random }),
      });
    };
    const first = make();
    let second;
    try {
      await first.initialize('main.kcs');
      const machine = first.main.machine;
      machine.writeString('probe', 32);
      machine.writeString('', 64);
      const call = (id, args) =>
          first.runtime.native('main', id, args, machine, first.main, first.runtime.scheduler),
        a = await first.objects.create({ kind: 16, parent: first.root }),
        b = await first.objects.create({ kind: 16, parent: first.root });
      for (const id of [a, b]) {
        await call(0x2b5, [id, 32, 64, 2, floatBits(10000), 128]);
        await call(0x110, [id]);
      }
      await first.tick();
      const saved = structuredClone(first.snapshot());
      await first.tick();
      await first.tick();
      const expected = [a, b].map((id) => first.particles.get(id).bank.instance.records());
      second = make();
      await second.restore(saved);
      await second.tick();
      await second.tick();
      for (const [index, id] of [a, b].entries())
        assert.deepEqual(second.particles.get(id).bank.instance.records(), expected[index]);
      assert.equal(second.particles.host.runtime.modules.size, 1);
      assert.equal(second.particles.drawItems().length, 2);
      assert.deepEqual(second.graphics.d3dContext, first.graphics.d3dContext);
    } finally {
      await first.close();
      await second?.close();
    }
  },
);
