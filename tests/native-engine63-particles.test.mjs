// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { bitsFloat, floatBits, readKCS } from '../src/kcs.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
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

test('2.6.1.63 Particle v2 visibility uses unsigned slot bounds and raw DWORD flags', async () => {
  const ptcl = await particle(2, [
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
  const empty = await particle(2, [...call(40)], { count: 0 });
  empty.machine.step();
  assert.equal(empty.machine.pop(), 0xffffffff);
});

test('2.6.1.63 Particle v1 still refuses an unreviewed same-image alias', async () => {
  const ptcl = await particle(1, [...call(39, [0, 0])]);
  assert.throws(() => ptcl.update(0), /Unreviewed PTCL native .*\/particle-v1\/39/);
  assert.deepEqual([...ptcl.visibility], [1, 1]);
  assert.equal(ptcl.calls.size, 0);
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
