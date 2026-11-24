// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { KCSMachine, floatBits, readKCS } from '../src/kcs.mjs';
import { identity } from '../src/motion/matrix.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { screenEffectRawMessage } from '../src/native/screen-effect.mjs';
import { makeWorld } from './fixtures/fes-effect-model-world.mjs';
import { authoredScreenFrame, ScreenVectorGPU } from './fixtures/screen-effects-fixture.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const matrixAddress = 208;
const canary = 0x963f2ba1;

async function worldCall(world, id, args, prepare = () => {}) {
  const program = kcsProgram([
    [37, canary],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const task = { ...world.main, io: null };
  const machine = (task.machine = new KCSMachine(await readKCS(program), {
    native: (number, supplied, caller) =>
      world.runtime.scheduler.native(task, number, supplied, caller),
  }));
  prepare(machine);
  const floor = machine.sp;
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.pop(), canary);
  return machine;
}

test('fixed 2.6.1.23 screen-effect GCALLs initialize the original matrix and rectangle packet owners', async () => {
  for (const [raw, canonical] of [
    [342, 377],
    [343, 378],
    [344, 379],
    [345, 380],
    [346, 381],
  ]) {
    assert.equal(screenEffectRawMessage(profile, canonical), raw);
    assert.equal(mapABIMessage(profile, 'screen', 'canonical', raw), canonical);
  }
  assert.throws(() => screenEffectRawMessage(profile, 382), /Unreviewed ABI message/);
  const world = await makeWorld(profile);
  try {
    const { screen, fields } = world.configuration;
    Object.assign(screen, { width: 16, height: 16, currentWidth: 24, currentHeight: 12 });
    const create = async (kind) => {
      const globalID = await world.objects.create({ kind, parent: world.main.id });
      return {
        target: world.nativeTaskID(globalID),
        owner: world.screenEffects.tasks.get(globalID),
      };
    };
    const matrix = await create(35),
      rectangle = await create(36);
    assert.ok(matrix.owner.state.capability);
    assert.ok(rectangle.owner.state.capability);
    const words = identity().map(floatBits);
    words[7] = 0x7f801234;
    const parameters = [
      0xff812345,
      ...[18.5, 3.125].map(floatBits),
      0xf1807033,
      ...[9, 800].map(floatBits),
    ];
    const m = await worldCall(
      world,
      521,
      [matrix.target, matrixAddress, ...parameters],
      (machine) => {
        machine.store(matrixAddress - 4, canary);
        words.forEach((word, index) => machine.store(matrixAddress + index * 4, word));
        machine.store(matrixAddress + 64, canary);
      },
    );
    assert.deepEqual(matrix.owner.state.params, [...words, 0xffc12345, ...parameters.slice(1)]);
    assert.equal(m.load(matrixAddress - 4), canary);
    assert.equal(m.load(matrixAddress + 28), 0x7f801234);
    assert.equal(m.load(matrixAddress + 64), canary);
    assert.deepEqual([matrix.owner.state.minimum, matrix.owner.state.maximum], [9, 800]);
    matrix.owner.state.firstFrame = false;
    await worldCall(world, 522, [matrix.target, 17]);
    assert.equal(matrix.owner.state.active, 17);
    assert.equal(matrix.owner.state.firstFrame, true);
    await worldCall(world, 522, [matrix.target, 0]);
    assert.equal(matrix.owner.state.active, 0);
    await worldCall(world, 521, [0, 0xffffffff, ...parameters]);
    await assert.rejects(
      worldCall(world, 521, [matrix.target, 0xffffffff, ...parameters]),
      /KCS memory ffffffff/,
    );
    await assert.rejects(worldCall(world, 522, [matrix.target]), /expects 2 arguments/);
    const rectangleWords = [...[4, 8, 10, 12, 2, 1.5, 28, 300].map(floatBits), 0xf0403020];
    await worldCall(world, 523, [rectangle.target, ...rectangleWords]);
    const geometry = rectangle.owner.state.geometry;
    assert.deepEqual(rectangle.owner.state.params, rectangleWords);
    assert.deepEqual([rectangle.owner.state.minimum, rectangle.owner.state.maximum], [28, 300]);
    assert.deepEqual(
      geometry[0].vertices.map(({ x, y, color }) => [x, y, color]),
      [
        [5.5, 5.5, 0xf0403020],
        [20.5, 5.5, 0xf0403020],
        [5.5, 14.5, 0xf0403020],
        [20.5, 14.5, 0xf0403020],
      ],
    );
    await worldCall(world, 524, [rectangle.target, 29]);
    assert.equal(rectangle.owner.state.active, 29);
    await worldCall(world, 523, [
      rectangle.target,
      ...rectangleWords.map((word, index) => (index === 6 ? floatBits(128) : word)),
    ]);
    assert.equal(rectangle.owner.state.minimum, 128);
    assert.equal(rectangle.owner.state.geometry, geometry);
    fields.general.renderTargetCount = 0;
    const disabled = await create(35);
    const prior = disabled.owner.state.params.slice();
    assert.equal(disabled.owner.state.capability, false);
    await worldCall(world, 522, [disabled.target, 99]);
    assert.equal(disabled.owner.state.active, 0);
    assert.deepEqual(disabled.owner.state.params, prior);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 mosaic and break starts preserve stopped receiver clocks', async () => {
  const world = await makeWorld(profile);
  try {
    for (const [kind, id, canonical, raw] of [
      [50, 855, 518, 449],
      [51, 857, 520, 451],
      [52, 861, 522, 453],
    ]) {
      assert.equal(screenEffectRawMessage(profile, canonical), raw);
      assert.equal(mapABIMessage(profile, 'screen', 'canonical', raw), canonical);
      const objectID = await world.objects.create({ kind, parent: world.main.id }),
        target = world.nativeTaskID(objectID),
        task = world.screenEffects.tasks.get(objectID),
        { state, record } = task,
        status = () => world.sendNativeEngine(target, world.main.id, 377);
      assert.equal(state.capability, true);
      Object.assign(state, { duration: 24, start: 2, end: 19, lastElapsed: 15, lastKey: 27 });
      Object.assign(record, { effectiveFrame: 3, pausedFrames: 12 });

      await worldCall(world, id, [0, 0x80000001]);
      assert.equal(await status(), 0);
      await worldCall(world, id, [target, 0x80000001]);
      assert.equal(await status(), 0x80000001);
      assert.deepEqual([state.start, state.end, state.lastElapsed], [0xfffffff7, 15, 0]);

      Object.assign(state, { lastElapsed: 11, lastKey: 19 });
      record.effectiveFrame = 40;
      await worldCall(world, id, [target, 0]);
      assert.equal(await status(), 0);
      assert.deepEqual([state.start, state.end, state.lastElapsed], [0xfffffff7, 15, 11]);
      if (kind !== 52) assert.equal(state.lastKey, 0xffffffff);

      state.capability = false;
      const before = structuredClone(state);
      await worldCall(world, id, [target, 17]);
      assert.deepEqual(state, before);
      await assert.rejects(worldCall(world, id, [target]), /expects 2 arguments/);
      state.capability = true;
      await world.objects.release(objectID);
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 WBreak initializes the original shards and draws the padded capture', async () => {
  const world = await makeWorld(profile);
  try {
    assert.equal(screenEffectRawMessage(profile, 521), 452);
    assert.equal(mapABIMessage(profile, 'screen', 'canonical', 452), 521);
    const width = 13,
      height = 7,
      stage = world.stageRenderer,
      gpu = (stage.gpu = new ScreenVectorGPU(width, height)),
      drawGeometry = gpu.drawGeometry.bind(gpu),
      frames = [];
    gpu.drawGeometry = (geometry, frame, options) => {
      frames.push(frame);
      return drawGeometry(geometry, frame, options);
    };
    Object.assign(world.graphics.view, {
      clientWidth: width,
      clientHeight: height,
      drawingRectangle: [1, 2, 11, 6],
    });
    world.random.real.seed(4357);
    const objectID = await world.objects.create({ kind: 52, parent: world.main.id }),
      target = world.nativeTaskID(objectID),
      task = world.screenEffects.tasks.get(objectID),
      { record, state } = task,
      args = [
        target,
        51,
        floatBits(18.5),
        floatBits(90.75),
        5,
        4,
        floatBits(3.5),
        floatBits(-9.125),
      ],
      expected = [floatBits(18.5), floatBits(90.75), 51, 5, 4, floatBits(3.5), floatBits(-9.125)];
    await worldCall(world, 860, args);
    assert.deepEqual(state.params, expected);
    assert.deepEqual(state.geometry.projectionSize, [16, 8]);
    assert.equal(state.geometry.shards.length, 12);
    assert.equal(world.random.real.index, 48);
    const first = state.geometry.shards[0];
    assert.deepEqual(
      first.source.map(({ x, y, u, v }) => [x, y, u, v]),
      [
        [-0.5, -0.5, 0, 0],
        [4.5, -0.5, 0.3125, 0],
        [-0.5, 3.5, 0, 0.5],
      ],
    );
    assert.deepEqual(first.velocity.map(floatBits), [0xbf9e8a4f, 0xbf1e8a4d, 0, 0]);
    assert.deepEqual(first.omega.map(floatBits), [0xbcaacd5a, 0x3d12aa2e, 0x3cf4f678]);
    const off = args.with(0, 0).with(4, 0);
    await worldCall(world, 860, off);
    const before = structuredClone(state),
      beforeRandom = world.random.snapshot();
    await assert.rejects(worldCall(world, 860, args.with(4, 0)), /grid divides by zero/);
    assert.deepEqual(state, before);
    assert.deepEqual(world.random.snapshot(), beforeRandom);

    const capture = world.screenEffects.rendering.captures[0],
      pixels = new Uint8Array(width * height * 4);
    pixels.set([11, 37, 93, 255], (width * height - 1) * 4);
    stage.writeSurface(capture, pixels);
    Object.assign(record, { effectiveFrame: 222, pausedFrames: 17 });
    await worldCall(world, 861, [target, 17]);
    await task.render();
    record.effectiveFrame = 224;
    await task.render();
    assert.deepEqual([state.start, state.end, state.lastElapsed], [205, 256, 2]);
    assert.deepEqual(
      state.current[0].vertices.map(({ x, y, z, w, color }) => [
        floatBits(x),
        floatBits(y),
        floatBits(z),
        floatBits(w),
        color,
      ]),
      [
        [0xc038efd0, 0xbfeafe58, 0x3effffa7, 0x3a831844, 0xf5ffffff],
        [0x40060bc0, 0xbfc46568, 0x3f000030, 0x3a830c46, 0xf5ffffff],
        [0xc048c948, 0x4009e25c, 0x3efffffc, 0x3a8312b2, 0xf5ffffff],
      ],
    );
    const padded = frames.at(-1);
    assert.equal(frames.at(-2), padded);
    assert.deepEqual([padded.width, padded.height], [16, 8]);
    const corner = (6 * 16 + 12) * 4;
    assert.deepEqual([...padded.rgba.slice(corner, corner + 8)], [11, 37, 93, 255, 0, 0, 0, 255]);
    pixels.set([67, 39, 17, 255], (width * height - 1) * 4);
    stage.writeSurface(capture, pixels);
    await task.render();
    assert.deepEqual([...frames.at(-1).rgba.slice(corner, corner + 4)], [67, 39, 17, 255]);

    record.effectiveFrame = 251;
    await worldCall(world, 860, args.with(1, 40));
    assert.deepEqual([state.start, state.end, state.lastElapsed, state.active], [234, 274, 2, 17]);
    assert.equal(world.random.real.index, 96);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 mosaic GCALLs keep the original modes, texture ownership and five-word fade packet', async () => {
  for (const [main, canonical, raw] of [
    [853, 516, 447],
    [854, 517, 448],
    [856, 519, 450],
  ]) {
    assert.equal(screenEffectRawMessage(profile, canonical), raw, String(main));
    assert.equal(mapABIMessage(profile, 'screen', 'canonical', raw), canonical);
  }
  const probes = [
    [
      50,
      0,
      8,
      4,
      2,
      0,
      2,
      0xffffffff,
      '3db8e196b2cb0c86ef62395c11dcd91968423ea042098cf76af480251014c6cd',
    ],
    [
      50,
      1,
      11,
      6,
      5,
      1,
      5,
      0xffffffff,
      'fe0027493b58ff56bc15c8565442dfb56f5bb4e58a46060183b0b8a6914865dd',
    ],
    [
      51,
      0,
      8,
      4,
      3,
      0,
      3,
      0xa0ffffff,
      '3db8e196b2cb0c86ef62395c11dcd91968423ea042098cf76af480251014c6cd',
    ],
    [
      51,
      1,
      11,
      5,
      6,
      0,
      6,
      0x74ffffff,
      '310ebe7e33e16754a49720d644198659e9f0fafc9cc2fc26b888e57964fd971e',
    ],
    [
      50,
      0,
      1,
      4,
      0,
      0,
      0,
      0xffffffff,
      '6848705b762d74deddf1065e314f2e478103201f7bf749574209a6c11df64c4c',
    ],
    [
      50,
      1,
      0,
      4,
      0,
      0,
      0,
      0xffffffff,
      '1c0dcca9afffb7337ee73d60e26a483567289e3aa1c0fbafa86b1d80d8b8ceee',
    ],
  ];
  const world = await makeWorld(profile);
  try {
    const width = 16,
      height = 8,
      stage = world.stageRenderer,
      gpu = (stage.gpu = new ScreenVectorGPU(width, height)),
      drawGeometry = gpu.drawGeometry.bind(gpu),
      rendering = world.screenEffects.rendering;
    Object.assign(world.graphics.view, { clientWidth: width, clientHeight: height });
    let drawn;
    gpu.drawGeometry = (geometry, frame, options) => {
      drawn = { frame, color: geometry[0].vertices[0].color };
      return drawGeometry(geometry, frame, options);
    };
    for (const [kind, mode, duration, level, sample, slot, key, color, digest] of probes) {
      assert.equal(rendering.prepare(2), true);
      for (const [i, capture] of rendering.captures.entries())
        stage.writeSurface(capture, authoredScreenFrame(width, height, i === 1));
      const objectID = await world.objects.create({ kind, parent: world.main.id }),
        target = world.nativeTaskID(objectID),
        task = world.screenEffects.tasks.get(objectID),
        init = kind === 50 ? 853 : 856,
        start = kind === 50 ? 855 : 857,
        argumentsAt = [target, duration, floatBits(0), floatBits(60000), level, mode],
        packet = [floatBits(0), floatBits(60000), duration, level, mode];
      await worldCall(world, init, argumentsAt.with(0, 0));
      assert.equal(task.state.initialized, false);
      await worldCall(world, init, argumentsAt);
      assert.deepEqual(task.state.params, packet);
      assert.equal(task.state.capability, true);
      if (kind === 50) {
        await worldCall(world, 854, [0]);
        assert.equal(task.state.work[1], undefined);
        await worldCall(world, 854, [target]);
        assert.ok(task.state.work[1]);
      } else {
        await assert.rejects(
          worldCall(world, init, [...argumentsAt, 0x12345678]),
          /expects 6 arguments/,
        );
        await world.sendNativeEngine(target, world.main.id, 519, 0, 0, {
          payload: {
            bytes(at, size) {
              assert.equal(at, 0);
              assert.equal(size, 20);
              return new Uint8Array(Uint32Array.from(packet).buffer);
            },
          },
        });
      }
      assert.deepEqual(rendering.captures, []);
      task.record.effectiveFrame = 0;
      await worldCall(world, start, [target, 1]);
      for (let clock = 0; clock <= sample; clock++) {
        task.record.effectiveFrame = clock;
        await task.render();
      }
      assert.equal(task.state.lastKey, key);
      assert.equal(drawn.color, color);
      assert.equal(drawn.frame, stage.surfaceFrame(task.state.work[slot]));
      assert.equal(createHash('sha256').update(drawn.frame.rgba).digest('hex'), digest);
      assert.equal(task.state.active, Number(sample < duration));
      if (kind === 51) {
        Object.assign(task.record, { effectiveFrame: 100, pausedFrames: 20 });
        await worldCall(world, init, argumentsAt.with(1, 23));
        assert.deepEqual([task.state.start, task.state.end, task.state.active], [80, 103, 1]);
      }
      await world.objects.release(objectID);
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});
