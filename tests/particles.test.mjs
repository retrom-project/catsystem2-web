// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Particles } from '../src/particles.mjs';
import { initialParticle } from '../src/ppi/abi.mjs';
import { projectParticle, particleGeometry } from '../src/ppi/geometry.mjs';
import { particleRenderState } from '../src/render/particles-gl.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
const backend = new URL('../.local/vendor/ppi/unicorn_x86.js', import.meta.url),
  available = existsSync(backend);
let pending;
const unicornFactory = () =>
  (pending ||= (async () => {
    const module = await import(backend);
    return module.default();
  })());
function host() {
  const dll = nativeParticleFixture(),
    stage = {
      frame: 0,
      width: 1280,
      height: 720,
      emitters: {},
      evaluate: (value) => Number(value),
    };
  const game = {
    has: (name) => ['ptclpi/probe.ppi', 'image/quad.hg3'].includes(name),
    require: async (name) => {
      if (name === 'ptclpi/probe.ppi') return dll;
      throw new Error(`Missing ${name}`);
    },
  };
  const images = {
    frame: async () => ({ width: 64, height: 32, rgba: new Uint8Array(64 * 32 * 4) }),
  };
  return new Particles(stage, {
    game,
    images,
    unicornFactory,
    attachment: (_id, { namespace }) => ({
      id: namespace === 'cst' ? 77 : 9,
      base: [32, 16, 0],
      pos: [640, 360, 0],
      disp: 1,
    }),
  });
}

test('particle geometry retains native projection, transform fields, alpha and asymmetric z-shift indexing', () => {
  const p = initialParticle(64, 32),
    options = { width: 1280, height: 720, priority: 10000 };
  let quad = projectParticle(p, options);
  assert.deepEqual(
    quad.map((v) => [v.x, v.y]),
    [
      [0, 0],
      [64, 0],
      [0, 32],
      [64, 32],
    ],
  );
  assert.equal(quad[0].w, Math.fround(0.001));
  p.pos[2] = 500;
  quad = projectParticle(p, { ...options, alpha: 128 });
  assert.deepEqual(
    quad.map((v) => [v.x, v.y]),
    [
      [-640, -360],
      [-512, -360],
      [-640, -296],
      [-512, -296],
    ],
  );
  assert.equal(quad[0].color, 0x7fffffff);
  const a = initialParticle(1, 1),
    b = initialParticle(1, 1);
  a.pos[2] = 50;
  b.pos[2] = -50;
  const sorted = particleGeometry([a, b], { ...options, zShifts: [0.1, 0.2] });
  assert.deepEqual(
    sorted.map((p) => p.index),
    [1, 0],
  );
  assert.equal(sorted[0].vertices[0].z, Math.fround(projectParticle(b, options)[0].z - 0.1));
});

test('PPI34 uses sampler states, with native mirror address defaults and explicit unsupported graphics states', () => {
  const { states, samplers } = particleRenderState(
    3,
    [[19, 2]],
    [
      [1, 4],
      [4, 0xff00ff00],
    ],
  );
  assert.equal(states.get(19), 2);
  assert.equal(states.get(20), 3);
  assert.equal(samplers.get(1), 4);
  assert.equal(samplers.get(2), 2);
  assert.throws(() => particleRenderState(0, [[999, 1]]), /render state/);
  assert.equal(particleRenderState(0, [], [[6, 3]]).samplers.get(6), 3);
  assert.throws(() => particleRenderState(0, [], [[6, 0]]), /filter/);
});

test(
  'CST particle banks execute DLLs, share bank namespaces, retain fade endpoints and save their private state',
  { skip: !available },
  async () => {
    const particles = host();
    let restored;
    try {
      await particles.command('particle3', ['0', 'probe', 'quad', '2', '10000', '1', '4', '5']);
      const bank = particles.get(0);
      assert.equal(bank.instance.hasFrame, false);
      assert.equal(bank.instance.attachPlane, 77);
      assert.deepEqual([...bank.instance.registers.slice(0, 3)], [4, 5, 0]);
      particles.update(100);
      assert.equal(bank.instance.frame, 0);
      particles.update(101);
      assert.equal(bank.instance.before, 0);
      assert.equal(bank.instance.frame, 1);
      await particles.command('particle2', ['0', 'set', '9']);
      assert.deepEqual([...bank.instance.registers.slice(0, 3)], [9, 0, 0]);
      await particles.command('particle', ['0', 'fade', '4', '255', '0']);
      particles.update(101);
      particles.update(103);
      assert.equal(bank.alpha, 128);
      particles.update(105);
      assert.equal(bank.alpha, 0);
      assert.equal(bank.fade, null);
      assert.equal(particles.busy(0), true);
      assert.equal(particles.drawItems().length, 0);
      await particles.command('particle3', ['0', 'alpha']);
      assert.equal(bank.alpha, 255);
      assert.equal(particles.drawItems()[0].priority, 10000);
      const state = particles.snapshot();
      assert.ok(JSON.stringify(state).length < 2 * 1024 * 1024);
      particles.update(107);
      const expected = bank.instance.records();
      restored = host();
      await restored.restore(state);
      restored.update(107);
      assert.deepEqual(restored.get(0).instance.records(), expected);
      await particles.command('particle2', ['0', 'stop']);
      assert.equal(particles.get(0), null);
      assert.equal(particles.runtime.modules.size, 0);
      await assert.rejects(() => particles.command('ptclp', ['0']), /Unknown particle scene/);
    } finally {
      restored?.close();
      particles.close();
    }
  },
);

test(
  'CST particle commands share eight slots while the legacy stop-all clears only the first four',
  { skip: !available },
  async () => {
    const particles = host();
    const load = (slot) =>
      particles.command('particle3', [slot, 'probe', 'quad', '1', '10000', '1']);
    const slots = () => [...particles.banks.keys()];
    try {
      await load('0');
      await load('3');
      await load('4');
      await load('7');
      await particles.command('particle2', ['7', 'set', '6']);
      assert.equal(particles.get(7).instance.registers[0], 6);
      await particles.command('particle', ['stop']);
      assert.deepEqual(slots(), [4, 7]);
      await particles.command('particle', ['4', 'stop']);
      assert.deepEqual(slots(), [7]);
      await particles.command('particle2', ['stop']);
      assert.deepEqual(slots(), []);
      await load('7');
      await particles.command('particle3', ['stop']);
      assert.deepEqual(slots(), []);
      assert.equal(particles.runtime.modules.size, 0);
      await assert.rejects(() => load('8'), /bank/);
      await assert.rejects(() => load('4294967296'), /bank/);
    } finally {
      particles.close();
    }
  },
);

test(
  'particle task load/start/stop/end are separate from main VM native IDs',
  { skip: !available },
  async () => {
    const particles = host();
    try {
      await particles.message('task:45', 0x13a, {
        family: 'plugin',
        program: 'probe',
        texture: 'quad',
        count: 1,
        priority: 5000,
      });
      assert.equal(particles.busy('task:45'), false);
      assert.equal(particles.get('task:45').instance.calls.size, 0);
      await particles.message('task:45', 0x13b);
      particles.update(0);
      assert.equal(await particles.message('task:45', 0x13e), 1);
      await particles.message('task:45', 0x13c);
      assert.equal(particles.busy('task:45'), false);
      assert.ok(particles.get('task:45').loaded);
      await particles.message('task:45', 0x13b);
      particles.update(9);
      assert.equal(particles.get('task:45').instance.frame, 0);
      await particles.message('task:45', 0x13d);
      assert.equal(particles.get('task:45'), null);
    } finally {
      particles.close();
    }
  },
);
