// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createD3DContext,
  snapshotD3DContext,
  restoreD3DContext,
} from '../src/render/particles-gl.mjs';
import { advanceD3DContext } from '../src/ppi/render-state.mjs';
import { Binary } from '../src/binary.mjs';
import { bitsFloat, floatBits } from '../src/kcs.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import {
  PPI_ABI,
  PTCL_ABI,
  readPPIParameters,
  writePPIParameters,
  readPPIRecord,
  writePPIRecord,
  readPTCLQuad,
  writePTCLQuad,
  initialParticle,
} from '../src/ppi/abi.mjs';
import {
  PTCL_NATIVE_CONTRACTS,
  PPI_HOST_CONTRACTS,
  particleNativeContract,
} from '../src/ppi/contracts.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import {
  triangleWave,
  roundInteger,
  calcFrame,
  linearInterpolate,
  rotateVector,
  degreeToRadian,
  projectionBounds,
} from '../src/ppi/numeric.mjs';

test('the PPI and KCS vertex ABIs preserve their distinct native byte offsets', () => {
  const record = new Uint8Array(148),
    b = new DataView(record.buffer);
  const p = initialParticle(80, 120);
  p.vertices[0].color = 0x44332211;
  p.base = [1, 2, 3];
  p.pos = [4, 5, 6];
  p.rot = [7, 8, 9];
  p.scale = [10, 11, 12];
  p.disp = -7;
  writePPIRecord(record, p);
  assert.equal(PPI_ABI.vertex.size, 24);
  assert.equal(b.getUint32(12, true), 0x44332211);
  assert.deepEqual([...record.slice(12, 16)], [0x11, 0x22, 0x33, 0x44]);
  assert.equal(b.getFloat32(24, true), 80);
  assert.equal(b.getFloat32(52, true), 120);
  assert.equal(b.getFloat32(96, true), 1);
  assert.equal(b.getFloat32(108, true), 4);
  assert.equal(b.getFloat32(120, true), 7);
  assert.equal(b.getFloat32(132, true), 10);
  assert.equal(b.getInt32(144, true), -7);
  assert.equal(readPPIRecord(record).vertices[2].y, 120);
  const quad = new Uint8Array(PTCL_ABI.quadSize);
  writePTCLQuad(quad, p.vertices);
  const q = new DataView(quad.buffer);
  assert.equal(q.getFloat32(12, true), 1);
  assert.equal(q.getUint32(16, true), 0x44332211);
  assert.equal(q.getFloat32(28, true), 80);
  assert.equal(q.getFloat32(60, true), 120);
  assert.deepEqual(readPTCLQuad(quad), p.vertices);
  assert.throws(() => readPTCLQuad(record, 40), /exceeds buffer/);
});

test('PPI callback payload includes 32 float registers and respects a subarray boundary', () => {
  const all = new Uint8Array(160).fill(0x55),
    record = all.subarray(4, 152);
  writePPIParameters(record, {
    count: 500,
    screenWidth: 1280,
    screenHeight: 720,
    width: 64,
    height: 128,
    values: [50, -5, 5],
  });
  const b = new DataView(all.buffer);
  assert.equal(b.getUint32(4, true), 500);
  assert.equal(b.getFloat32(8, true), 1280);
  assert.equal(b.getFloat32(20, true), 128);
  assert.equal(b.getFloat32(24, true), 50);
  assert.equal(b.getFloat32(148, true), 0);
  assert.equal(all[3], 0x55);
  assert.equal(all[152], 0x55);
  assert.deepEqual(readPPIParameters(record).values.slice(0, 4), [50, -5, 5, 0]);
  assert.throws(() => writePPIParameters(record, { count: 1, values: Array(33) }), /Invalid/);
});

test('PTCL native versions and PPI host versions have independent complete tables', () => {
  assert.equal(PTCL_NATIVE_CONTRACTS.length, 51);
  assert.equal(PPI_HOST_CONTRACTS.length, 35);
  assert.equal(particleNativeContract(0x10000, 43).name, 'triwave');
  assert.throws(() => particleNativeContract(0x10000, 44), /Unknown PTCL/);
  assert.equal(particleNativeContract(0x20000, 44).name, 'ResetVertex');
  assert.equal(particleNativeContract(0x20000, 48).returns, 'long');
  assert.equal(particleNativeContract(0x20000, 48).control, 2);
  assert.equal(particleNativeContract(0x20000, 32).control, 4);
  assert.equal(PPI_HOST_CONTRACTS[31].name, 'SetZShift');
  assert.equal(PPI_HOST_CONTRACTS[34].since, 0x20002);
});

test('native random golden: 1024 uint32 and float32 outputs cross the 624-word twist', () => {
  // Executed original 2.6.1.76 PE instructions under qemu-i386, seed4357.
  // Hashes cover little-endian words, including the float32 conversion in PPF.
  const random = new ParticleRandom(4357);
  const integers = new DataView(new ArrayBuffer(4096)),
    reals = new DataView(new ArrayBuffer(4096));
  for (let i = 0; i < 1024; i++) {
    integers.setUint32(i * 4, random.rand(), true);
    reals.setFloat32(i * 4, random.frand(), true);
  }
  assert.equal(
    createHash('sha256').update(new Uint8Array(integers.buffer)).digest('hex'),
    '20cb731c856e758cb79975c86f748462d10361d2af76a04b021df45ce58e2e03',
  );
  assert.equal(
    createHash('sha256').update(new Uint8Array(reals.buffer)).digest('hex'),
    '216de8e6297cb128218d6b5fb72dc01f00e6d0734ba758b423e37c9cd47e9644',
  );
});

test('integer and real random streams are independent and save every state word', () => {
  const a = new ParticleRandom(1, 2),
    b = new ParticleRandom(1, 2);
  for (let i = 0; i < 700; i++) a.frand();
  assert.equal(a.rand(), b.rand());
  const state = JSON.parse(JSON.stringify(a.snapshot()));
  const sequence = Array.from({ length: 1000 }, () => [a.rand(), a.frand()]);
  a.restore(state);
  assert.deepEqual(
    Array.from({ length: 1000 }, () => [a.rand(), a.frand()]),
    sequence,
  );
  state.integer.words[0] = -1;
  assert.throws(() => a.restore(state), /Invalid native/);
});

test('native numeric golden preserves signed triwave and floor(x+0.5) rounding', () => {
  const inputs = [-2, -1, 0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 10];
  const expected = [1, 0.5, 0, 0.25, 0.5, 1, 0.5, -0, -0.5, -1, -0.5, 0, 1];
  assert.deepEqual(
    inputs.map((n) => triangleWave(n, 8)),
    expected,
  );
  assert.equal(triangleWave(2, -8), 1);
  assert.ok(Number.isNaN(triangleWave(0, 0)));
  assert.deepEqual(
    [-2.5, -1.5, -0.5, 0.49, 0.5, 1.5, 2147483648, 1e30].map(roundInteger),
    [-2, -1, 0, 0, 1, 2, -2147483648, -2147483648],
  );
});

test('frame scaling, clamped interpolation, and rotations follow native conventions', () => {
  assert.equal(calcFrame(0, 30), 0);
  assert.equal(calcFrame(1, 30), 1);
  assert.equal(calcFrame(60, 30), 30);
  assert.equal(calcFrame(0xffffffff, 30), 0xffffffff);
  assert.equal(linearInterpolate(10, 20, 2, 4, 3), 15);
  assert.equal(linearInterpolate(10, 20, 2, 4, 1), 10);
  assert.equal(linearInterpolate(10, 20, 2, 4, 5), 20);
  const rotated = rotateVector([0, 1, 0], 'z', degreeToRadian(90));
  assert.ok(Math.abs(rotated[0] - 1) < 1e-6);
  assert.ok(Math.abs(rotated[1]) < 1e-6);
  assert.equal(rotated[2], 0);
});

function authoredScript(instructions = [[59]], scriptVersion = 0x20000) {
  const bytes = Uint8Array.from(
    instructions.flatMap(([op, ...operands]) => [
      op,
      ...operands.flatMap((operand) => {
        const [mode, value] = Array.isArray(operand) ? operand : [0x23, operand];
        return [mode, value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
      }),
    ]),
  );
  return {
    body: new Binary(bytes),
    codeSize: bytes.length,
    data: new Uint8Array(2048),
    stackSize: 1024,
    scriptVersion,
  };
}

function instance(script = authoredScript(), options = {}) {
  return new ParticleScriptInstance(script, {
    count: 2,
    width: 64,
    height: 128,
    screenWidth: 1280,
    screenHeight: 720,
    priority: 10000,
    ...options,
  });
}

test('particle main restarts its stack while retaining per-effect script globals and snapshots', () => {
  const script = authoredScript([[22, [0x13, 0]], [60], [59]]);
  const p = instance(script);
  p.update(0);
  assert.equal(p.machine.load(0), 2);
  p.update(7);
  assert.equal(p.machine.load(0), 4);
  assert.equal(p.before, 0);
  const saved = p.snapshot();
  p.update(9);
  assert.equal(p.machine.load(0), 6);
  p.restore(saved);
  p.update(9);
  assert.equal(p.machine.load(0), 6);
  p.stop();
  p.update(10);
  assert.equal(p.machine.load(0), 6);
  p.start();
  p.update(0);
  assert.equal(p.machine.load(0), 8);
  assert.equal(p.before, 0xffffffff);
  assert.equal(p.machine.sp, p.machine.data.length);
});

test('PTCL mutates current-particle position and preserves the native all-particle vertex backup', () => {
  const p = instance(),
    m = p.machine;
  const call = (id, args = []) => p.native(id, args, m);
  p.now = 1;
  assert.deepEqual(call(27, [5, 7, 9].map(floatBits)), { control: 2 });
  assert.deepEqual([...p.positions], [0, 0, 0, 0, 5, 7, 9, 0]);
  call(28, [64, 68, 72]);
  assert.deepEqual(
    [64, 68, 72].map((at) => bitsFloat(m.load(at))),
    [5, 7, 9],
  );
  call(30, [128]);
  call(25, [128, ...[1, 2, 3].map(floatBits)]);
  call(31, [128]);
  assert.equal(p.vertices(1)[0].x, 1);
  assert.equal(p.vertices(1)[0].z, 3);
  assert.equal(p.vertices(0)[0].x, 0);
  call(45, [0]);
  p.quads.fill(0);
  call(44, [1]);
  assert.equal(p.vertices(0)[1].x, 64);
  assert.equal(p.vertices(1)[0].x, 1);
  call(39, [0, 0]);
  call(39, [2, 0]);
  assert.deepEqual([...p.visibility], [0, 1]);
  assert.equal(call(40).value, 1);
  call(50, [4]);
  assert.equal(p.blendMode, 4);
  call(50, [99]);
  assert.equal(p.blendMode, 0);
});

test('all 51 declared PTCL native slots have explicit ABI replies and pointer writes', () => {
  const p = instance(undefined, {
      registers: [50, -5, 5],
      attachPlane: 31,
      attachment: () => ({ pos: [10, 20, 30], base: [4, 8, 0], disp: 1 }),
    }),
    m = p.machine;
  m.writeString('particle debug', 1024);
  writePTCLQuad(m.bytes(128, 112), initialParticle(64, 128).vertices);
  const args = new Map([
    [0, [1024]],
    [3, [60]],
    [5, [64, 68]],
    [12, [floatBits(1), floatBits(0)]],
    [16, [floatBits(6.5), floatBits(2)]],
    [18, [floatBits(2), floatBits(3)]],
    [21, [0xfffffffb]],
    [22, [128, floatBits(0)]],
    [23, [128, floatBits(0)]],
    [24, [128, floatBits(0)]],
    [25, [128, 0, 0, 0]],
    [26, [128, ...[1, 1, 1].map(floatBits)]],
    [27, [1, 2, 3].map(floatBits)],
    [28, [64, 68, 72]],
    [29, [1, 2, 3, 4].map(floatBits)],
    [30, [128]],
    [31, [128]],
    [35, [512]],
    [37, [0, 0, 0, 3, 4, 0].map(floatBits)],
    [38, [floatBits(500), 64, 68, 72, 76]],
    [39, [0, 0]],
    [41, [10, 20, 2, 4, 3].map(floatBits)],
    [42, [floatBits(-1.5)]],
    [43, [floatBits(6), floatBits(8)]],
    [44, [0]],
    [45, [1]],
    [48, [80, 84]],
    [49, [88, 92, 96]],
    [50, [2]],
  ]);
  for (const id of [6, 7, 8, 9, 10, 11, 13, 14, 15, 17, 19, 20]) args.set(id, [floatBits(0.5)]);
  for (let id = 0; id < 51; id++) {
    const reply = p.native(id, args.get(id) || [], m);
    assert.ok([1, 2, 4].includes(reply.control));
    if (reply.control === 1) assert.ok(Number.isInteger(reply.value));
    else assert.equal(reply.value, undefined);
  }
  assert.equal(p.calls.size, 51);
  assert.equal(p.messages[0].text, 'particle debug');
  assert.deepEqual(
    [512, 516, 520, 524].map((at) => bitsFloat(m.load(at))),
    [50, -5, 5, 0],
  );
  assert.deepEqual(
    [80, 84, 88, 92, 96].map((at) => bitsFloat(m.load(at))),
    [4, 8, 10, 20, 30],
  );
  assert.equal(p.active, false);
  assert.throws(() => p.native(51, [], m), /Unknown PTCL/);
  assert.throws(() => p.native(27, [], m), /requires 3 arguments/);
  const v1 = instance(authoredScript([[59]], 0x10000));
  assert.throws(() => v1.native(44, [0], v1.machine), /Unknown PTCL/);
});

test('native projection golden keeps priority arithmetic and the zero denominator special case', () => {
  const z = [0, 100, 500, -500, 1000, 1500];
  const golden = [
    [0, 0, 1280, 720],
    [64, 36, 1216, 684],
    [320, 180, 960, 540],
    [-320, -180, 1600, 900],
    [639.3599853515625, 359.6400146484375, 640.6400146484375, 360.3599853515625],
    [640, 360, 640, 360],
  ];
  assert.deepEqual(
    z.map((n) => projectionBounds(n, 1280, 720, 10000)),
    golden,
  );
});

test('native SetTex golden reads float bits and uses the first and third arguments for both axes', () => {
  const p = instance();
  p.native(29, [1, 2, 3, 4], p.machine);
  assert.deepEqual(
    p.vertices(0).flatMap(({ u, v }) => [u, v]),
    [
      -0.0078125, -0.00390625, -0.0078125, -0.00390625, -0.0078125, -0.00390625, -0.0078125,
      -0.00390625,
    ],
  );
  p.native(29, [1, 2, 3, 4].map(floatBits), p.machine);
  assert.deepEqual(
    p.vertices(0).flatMap(({ u, v }) => [u, v]),
    [0.0078125, 0.00390625, 0.0390625, 0.00390625, 0.0078125, 0.01953125, 0.0390625, 0.01953125],
  );
});

test('global D3D state profiles and separate caches match 4356 original-engine calls', () => {
  const oracle = JSON.parse(
    readFileSync(new URL('fixtures/ppi-render-state-golden.json', import.meta.url)),
  );
  let count = 0;
  for (const row of oracle.cases) {
    const context = createD3DContext({ depthStencilEnabled: row.depthStencil }),
      calls = [];
    for (const [drawType, blendMode, force] of row.steps)
      advanceD3DContext(context, {
        drawType,
        blendMode,
        force,
        onCall: (call) => calls.push(call),
      });
    assert.deepEqual(calls, row.calls, JSON.stringify(row.steps));
    count += calls.length;
    assert.deepEqual(restoreD3DContext(snapshotD3DContext(context)), context);
  }
  assert.equal(count, 4356);
  const context = createD3DContext();
  advanceD3DContext(context, {
    renderStates: [
      [28, 1],
      [171, 2],
    ],
    samplerStates: [[1, 4]],
  });
  advanceD3DContext(context);
  assert.equal(context.states.get(28), 1);
  assert.equal(context.states.get(171), 2);
  assert.equal(context.samplers.get(1), 4);
  advanceD3DContext(context, { drawType: 1 });
  assert.equal(context.states.get(28), 0);
  assert.equal(context.samplers.get(1), 2);
});
