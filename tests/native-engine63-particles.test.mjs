// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { bitsFloat, floatBits, readKCS } from '../src/kcs.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'rebellions-jp-engine-2.6.1.63';

const call = (id, words = []) => [...words.map((word) => [37, word]), [43, id, words.length * 4]];

async function particle(version, instructions, options = {}) {
  const bytes = kcsProgram([...instructions, [59]]);
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, version, true);
  return new ParticleScriptInstance(await readKCS(bytes), {
    profile,
    count: 2,
    width: 24,
    height: 12,
    screenWidth: 1280,
    screenHeight: 720,
    priority: 1200,
    ...options,
  });
}

test('2.6.1.63 Particle v1 fixed aliases use the frame, screen, register and position owners', async () => {
  const ptcl = await particle(
    1,
    [
      ...call(1),
      [38, 16],
      ...call(2),
      [38, 20],
      ...call(5, [24, 28]),
      ...call(34),
      [38, 32],
      ...call(6, [0x80000000]),
      [38, 36],
      ...call(7, [0]),
      [38, 40],
      ...call(35, [64]),
      ...call(36),
      [38, 208],
      ...call(27, [2, -7, 13].map(floatBits)),
      ...call(28, [212, 216, 220]),
      ...call(38, [floatBits(1000), 224, 228, 232, 236]),
    ],
    { registers: [0.625, -1.5] },
  );
  const m = ptcl.machine;
  assert.equal(ptcl.table, 'particle-v1');
  m.store(60, 0x8c8c8c8c);
  m.store(192, 0x73737373);
  m.store(240, 0xa6a6a6a6);
  const readWords = (addresses) => addresses.map((address) => m.load(address));
  ptcl.update(17);
  assert.deepEqual(readWords([16, 20, 24, 28]), [17, 0xffffffff, 1280, 720]);
  const firstRandom = m.load(32);
  assert.ok(bitsFloat(firstRandom) > 0 && bitsFloat(firstRandom) < 1);
  assert.deepEqual(readWords([36, 40, 60, 64, 68, 188, 192]), [
    0x80000000,
    floatBits(1),
    0x8c8c8c8c,
    floatBits(0.625),
    floatBits(-1.5),
    0,
    0x73737373,
  ]);
  assert.deepEqual(readWords([208, 212, 216, 220]), [1, ...[2, -7, 13].map(floatBits)]);
  assert.deepEqual([...ptcl.positions], [2, -7, 13, 0, 2, -7, 13, 0]);
  const [left, top, right, bottom] = readWords([224, 228, 232, 236]).map(bitsFloat);
  assert.ok(left < right && top < bottom);
  assert.ok(Math.abs(left + right - 1280) < 0.01);
  assert.ok(Math.abs(top + bottom - 720) < 0.01);
  assert.equal(m.load(240), 0xa6a6a6a6);
  ptcl.update(24);
  assert.deepEqual(readWords([16, 20]), [24, 17]);
  assert.notEqual(m.load(32), firstRandom);
  assert.ok([...ptcl.calls.values()].every((calls) => calls === 4));
});

test('2.6.1.63 Particle v1 aliases transform and replace the original 112-byte quad', async () => {
  const at = 128,
    ptcl = await particle(
      1,
      [
        ...call(30, [at]),
        ...call(25, [at, ...[2, -3, 7].map(floatBits)]),
        ...call(26, [at, ...[3, 4, 5].map(floatBits)]),
        ...call(22, [at, 0]),
        ...call(23, [at, 0]),
        ...call(24, [at, 0]),
        ...call(31, [at]),
      ],
      { count: 1 },
    );
  const before = ptcl.vertices(0);
  const m = ptcl.machine;
  m.store(at - 4, 0x12345678);
  m.store(at + 112, 0x87654321);
  ptcl.update(0);
  const after = ptcl.vertices(0);
  assert.deepEqual(
    after,
    before.map((v) => ({ ...v, x: (v.x + 2) * 3, y: (v.y - 3) * 4, z: (v.z + 7) * 5 })),
  );
  assert.equal(m.load(at - 4), 0x12345678);
  assert.equal(m.load(at + 112), 0x87654321);
  assert.equal(m.sp, m.floor);
});

for (const version of [1, 2])
  test(`2.6.1.63 Particle v${version} visibility uses unsigned slot bounds and raw DWORD flags`, async () => {
    const ptcl = await particle(version, [
      ...call(39, [0, 0x8899aabb]),
      ...call(39, [1, 7]),
      ...call(39, [2, 0]),
      ...call(39, [0xffffffff, 0xfeed1234]),
      ...call(40),
      [38, 20],
      ...call(21, [0x80000000]),
      [38, 24],
    ]);
    const m = ptcl.machine;
    const count = ptcl.count;
    ptcl.update(250);
    assert.deepEqual(
      [...ptcl.visibility].map((word) => word >>> 0),
      [0x8899aabb, 7],
    );
    assert.equal(m.load(20), count - 1);
    assert.equal(m.load(24), 0x80000000);
    assert.equal(m.sp, m.floor);
    // Invoke the original zero-count query directly through its own KCS call.
    const empty = await particle(version, [...call(40)], { count: 0 });
    empty.machine.step();
    assert.equal(empty.machine.pop(), 0xffffffff);
  });

test('2.6.1.63 Particle reaches the recovered logger and retains its invalid-format diagnostic', async () => {
  const ptcl = await particle(1, [...call(0, [128])]);
  ptcl.machine.writeString('particle logger', 128);
  ptcl.machine.run();
  assert.deepEqual(
    ptcl.messages.map(({ text }) => text),
    ['particle logger'],
  );
  assert.equal(ptcl.calls.get(0), 1);
  const invalid = await particle(1, [...call(0, [128])]);
  invalid.machine.writeString('%n[G512]', 128);
  assert.throws(() => invalid.update(0), /Unsupported native format/);
  assert.deepEqual([...invalid.visibility], [1, 1]);
  assert.deepEqual(invalid.messages, []);
});

test('2.6.1.63 Main and Particle read the owning Top frame rate after restore', async (t) => {
  const emitter = kcsProgram([
    ...call(3, [60]),
    [38, 64],
    ...call(4),
    [38, 68],
    ...call(48, [72, 76]),
    [59],
  ]);
  new DataView(emitter.buffer).setUint16(8, 2, true);
  const files = { 'ptcl/rate.kcs': emitter, 'rate.kcs': kcsProgram([...call(7), [38, 64], [59]]) };
  const world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  const owner = await world.objects.create({ kind: 1, name: '47Hz Top', frameRate: 47 });
  const main = await world.spawnScript('rate.kcs', { parent: owner });
  await world.runtime.scheduler.execute(main);
  assert.equal(main.machine.load(64), 47);
  const emitterID = await world.objects.create({ kind: 16, parent: owner });
  const task = world.particles.get(emitterID);
  world.graphics.createLogicalDevice();
  await task.load({ family: 'script', program: 'rate', count: 1, priority: 0 });
  await world.sendEngine(emitterID, main.id, 0x141, 0, 1234);
  world.particles.host.start(task.key);
  assert.equal(task.bank.instance.attachPlane, 1234);
  assert.equal(world.graphics.attachment(1234), null);
  for (const at of [72, 76]) task.bank.instance.machine.store(at, 0xf511638d);
  task.tick(0);
  assert.deepEqual(
    [64, 68, 72, 76].map((at) => task.bank.instance.machine.load(at)),
    [47, 47, 0, 0],
  );

  const restored = await dataWorld(profile, files, { initialize: false });
  t.after(() => restored.close({ flushFiles: false }));
  await restored.restore(world.snapshot());
  const after = restored.particles.get(emitterID);
  after.tick(1);
  assert.deepEqual(
    [64, 68].map((at) => after.bank.instance.machine.load(at)),
    [47, 47],
  );
});

test('2.6.1.63 Particle UV preserves untouched quad words and exit stops the script', async () => {
  for (const version of [1, 2]) {
    const ptcl = await particle(
      version,
      [
        ...call(29, [floatBits(1.75), 0x7f802004, floatBits(36), 0x7f801234]),
        ...call(32),
        [37, 1],
        [38, 64],
      ],
      { count: 2, width: 32, height: 64 },
    );
    const before = ptcl.vertices(0);
    ptcl.machine.store(64, 0xa51d3e77);
    assert.equal(ptcl.update(0).active, false);
    assert.equal(ptcl.calls.get(29), 2);
    assert.equal(ptcl.calls.get(32), 2);
    const uv = [
      [1.25, 1.25],
      [35.5, 1.25],
      [1.25, 35.5],
      [35.5, 35.5],
    ];
    for (let i = 0; i < 2; i++)
      assert.deepEqual(
        ptcl.vertices(i),
        before.map((vertex, j) => ({ ...vertex, u: uv[j][0] / 32, v: uv[j][1] / 64 })),
      );
    assert.equal(ptcl.machine.load(64), 0xa51d3e77);
    assert.equal(ptcl.machine.sp, ptcl.machine.floor);
    assert.equal(ptcl.update(1).executed, 0);
  }
});

test('2.6.1.63 Particle v2 copies complete quad banks and queries the renderer owner', async () => {
  const ptcl = await particle(
    2,
    [
      ...call(44),
      ...call(45, [0x91a6b874]),
      ...call(46),
      [38, 64],
      ...call(47),
      [38, 68],
      ...call(48, [72, 76]),
      ...call(48, [80, 80]),
    ],
    {
      attachPlane: 101,
      attachmentDevicePresent: () => true,
      attachment: (id) => {
        assert.equal(id, 101);
        return { registrationWord: 0x81234567, base: [1.28125, -0] };
      },
    },
  );
  const backup = Uint8Array.from(ptcl.quads, (_, at) => at & 255);
  ptcl.backupQuads.set(backup);
  ptcl.machine.store(84, 0x71936db1);
  ptcl.update(0);
  assert.deepEqual(ptcl.quads, backup);
  assert.deepEqual(ptcl.backupQuads, backup);
  assert.deepEqual(
    [64, 68, 72, 76, 80, 84].map((at) => ptcl.machine.load(at)),
    [101, 0x81234567, 0x3fa40000, 0x80000000, 0x80000000, 0x71936db1],
  );
  assert.equal(ptcl.machine.sp, ptcl.machine.floor);
});

test('2.6.1.63 Particle distinguishes a missing renderer group from an unwritten model', async () => {
  const inputs = [...call(48, [64, 68]), ...call(49, [72, 76, 80])];
  const addresses = [64, 68, 72, 76, 80],
    marker = 0x913e72f4;
  const options = { count: 1, attachPlane: 101, attachmentDevicePresent: () => true };
  const absent = await particle(2, inputs, { ...options, attachment: () => null });
  for (const at of addresses) absent.machine.store(at, marker);
  absent.update(0);
  assert.deepEqual(
    addresses.map((at) => absent.machine.load(at)),
    Array(5).fill(0),
  );
  const missingModel = await particle(2, inputs, {
    ...options,
    attachment: () => ({ registrationWord: 0 }),
  });
  for (const at of addresses) missingModel.machine.store(at, marker);
  assert.throws(() => missingModel.update(0), /Particle position requires a live attachment graph/);
  assert.deepEqual(
    addresses.map((at) => missingModel.machine.load(at)),
    Array(5).fill(marker),
  );
});

test('2.6.1.63 both Particle tables use the original initialized scalar words', async () => {
  const cases = [
    [8, [0xe258d727], 0xbf38a998],
    [18, [0x7f801234, 0], 0x7fc01234],
    [37, [0xc3e61996, 0xc44e2c85, 0x446be2e0, 0xc381f7c9, 0xc4444dfd, 0xc1d19b8b], 0x4477bfae],
    [42, [0xe258d727], 0],
    [43, [0x3f800000, 0x40400000], 0x3f2aaaaa],
  ];
  const first = 32;
  for (const version of [1, 2]) {
    const program = cases.flatMap(([id, args], i) => [...call(id, args), [38, first + i * 4]]);
    const ptcl = await particle(version, program, { count: 1 });
    ptcl.update(1);
    assert.deepEqual(
      cases.map((_, i) => ptcl.machine.load(first + i * 4)),
      cases.map(([, , expected]) => expected),
    );
    assert.equal(ptcl.machine.sp, ptcl.machine.floor);
  }
});

test('2.6.1.63 Particle v2 returns the original x87 atan2 and interpolation words', async () => {
  const ptcl = await particle(
    2,
    [
      ...call(12, [0x80000000, 0x80000000]),
      [38, 16],
      ...call(12, [0x7f800000, 0xff800000]),
      [38, 20],
      ...call(12, [0x7f800001, 0xffc22222]),
      [38, 24],
      ...call(41, [3, 13, 0, 10, 7].map(floatBits)),
      [38, 28],
      ...call(41, [0x80000000, floatBits(7), floatBits(-7), floatBits(12), 0x7fc13579]),
      [38, 32],
    ],
    { count: 1 },
  );
  ptcl.update(1);
  assert.deepEqual(
    [16, 20, 24, 28, 32].map((at) => ptcl.machine.load(at)),
    [floatBits(-Math.PI), 0xffc00000, 0xffc22222, floatBits(10), 0x7fc13579],
  );
});

test('2.6.1.63 Particle v2 attachment query preserves the raw coordinate words and guest bounds', async () => {
  const position = [8.75, -0, -24];
  const instructions = call(49, [128, 132, 136]);
  const attachPlane = 405;
  const attachment = (id) => {
    assert.equal(id, attachPlane);
    return { pos: position };
  };
  const run = async (options, words) => {
    const ptcl = await particle(2, instructions, { count: 1, ...options });
    ptcl.machine.store(124, 0xa6789abc);
    ptcl.machine.store(140, 0x74edcba9);
    assert.doesNotThrow(() => ptcl.update(2));
    assert.deepEqual(
      [124, 128, 132, 136, 140].map((index) => ptcl.machine.load(index)),
      [0xa6789abc, ...words, 0x74edcba9],
    );
  };
  await run({ attachPlane: -1, attachment }, [0, 0, 0]);
  await run({ attachPlane, attachmentDevicePresent: () => false, attachment }, [0, 0, 0]);
  await run(
    { attachPlane, attachmentDevicePresent: () => true, attachment },
    position.map(floatBits),
  );
  const missing = await particle(2, instructions, { count: 1, attachPlane });
  missing.machine.store(128, 0xa998c033);
  assert.throws(() => missing.update(2), /requires a live attachment graph/);
  assert.equal(missing.machine.load(128), 0xa998c033);
  const badGuest = await particle(2, call(49, [128, 132, 0x7ffffffc]), {
    count: 1,
    attachment,
    attachPlane,
  });
  badGuest.machine.store(128, 0x8ecdbad5);
  assert.throws(() => badGuest.update(2), /KCS memory 7ffffffc\+4/);
  assert.equal(badGuest.machine.load(128), 0x8ecdbad5);
});
