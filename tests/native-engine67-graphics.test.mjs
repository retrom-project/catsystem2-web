// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCP932, floatBits } from '../src/kcs.mjs';
import { openImage } from '../src/formats/hg3.mjs';
import { MOTION_ABI, motionVector, setMotionVector } from '../src/motion/abi.mjs';
import { NULL_NATIVE_TEXTURE } from '../src/native/texture-layout.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { hg3, kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67',
  target = [0x13, 80];

test('2.6.1.67 KCS loads a CP932 formatted bitmap with physical layered offsets', async (t) => {
  const background = Uint8ClampedArray.of(34, 56, 78, 255),
    foreground = Uint8ClampedArray.of(14, 210, 83, 255),
    pixels = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(background, i);
  const base = hg3(3, 3, pixels),
    overlay = hg3(1, 1, foreground);
  new DataView(base.buffer).setUint32(16, 7, true);
  new DataView(overlay.buffer).setInt32(48, 1, true);
  const world = await dataWorld(profile, {
    '底.hg3': base,
    '重.hg3': overlay,
    'bitmap-load.kcs': kcsProgram(
      [
        [37, 0x15e43871],
        [37, 288],
        [43, 111, 4],
        [38, 80],
        [37, 352],
        [43, 111, 4],
        [38, 84],
        [59],
      ],
      [
        [288, 'missing.hg3 底:%d[G152].hg3 重.hg3'],
        [352, 'missing.hg3'],
      ],
    ),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('bitmap-load.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    machine = task.machine,
    floor = machine.sp;
  machine.store(152, 7);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0x15e43871);
  assert.equal(machine.load(84), 0);
  const handle = machine.load(80),
    bitmap = world.graphics.images.get(handle);
  assert.equal(bitmap.owner, task.id);
  assert.equal(bitmap.state.bpp, 4);
  pixels.set(foreground, (2 * 3 + 1) * 4);
  assert.deepEqual(await bitmap.pixels(), pixels);
  assert.deepEqual(
    [...world.runtime.handles.records]
      .filter(([, record]) => record.type === 'bitmap' && record.value.owner === task.id)
      .map(([id]) => id),
    [handle],
  );
});

test('2.6.1.67 KCS prepares owned screen targets and captures only the requested index', async (t) => {
  const range = [floatBits(1.25), floatBits(9.5)],
    program = (...calls) =>
      kcsProgram([
        [37, 0x4af36828],
        ...calls.flatMap(([id, ...args]) => [
          ...args.map((arg) => [37, arg]),
          [43, id, args.length * 4],
        ]),
        [59],
      ]),
    world = await dataWorld(profile, {
      'prepare.kcs': program([858, 2], [859, 1, ...range], [859, 2, ...range]),
      'capture.kcs': program([568, ...range]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const rendering = world.screenEffects.rendering,
    revision = (id) => world.stageRenderer.surfaces.get(id).revision ?? 0;
  world.graphics.view.configure({
    clientWidth: 4,
    clientHeight: 3,
    drawingRectangle: [0, 0, 4, 3],
  });
  const execute = async (filename) => {
    const task = await world.spawnScript(filename, {
        parent: world.main.id,
        initialExecute: false,
      }),
      floor = task.machine.sp;
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, floor + 4);
    assert.equal(task.machine.load(floor), 0x4af36828);
  };
  await execute('prepare.kcs');
  const owned = rendering.captures.slice();
  assert.equal(owned.length, 2);
  assert.deepEqual(owned.map(revision), [0, 1]);
  await execute('capture.kcs');
  assert.deepEqual(rendering.captures, owned);
  assert.deepEqual(owned.map(revision), [1, 1]);
  assert.deepEqual(world.stageRenderer.surfacePixels(owned[0]), new Uint8Array(4 * 3 * 4));
  world.configuration.fields.general.renderTargetCount = 0;
  await execute('capture.kcs');
  assert.deepEqual(owned.map(revision), [1, 1]);
});

test('2.6.1.67 KCS reads live capture counters and writes a CP932 line at the original file position', async (t) => {
  const files = new Map([
      ['line.log', Uint8Array.of(0x61, 0x62, 0x63, 0)],
      ['locked.log', Uint8Array.of(0xaa)],
    ]),
    world = await dataWorld(
      profile,
      {
        'recording.kcs': kcsProgram([
          [43, 565, 0],
          [38, 128],
          [43, 566, 0],
          [38, 132],
          [37, 256],
          [37, 320],
          [43, 567, 8],
          [37, 384],
          [37, 320],
          [43, 567, 8],
          [59],
        ]),
      },
      {
        storage: {
          read: async (name) => files.get(name) ?? null,
          stat: async (name) => ({ attributes: Number(name === 'locked.log') }),
          write: async (name, bytes) => files.set(name, bytes.slice()),
        },
      },
    );
  t.after(() => world.close({ flushFiles: false }));
  world.screenCapture.restore({ recording: 3, counter: 0xfffffffe, prefix: 'owned' });
  const task = await world.spawnScript('recording.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine;
  m.writeString('line.log', 256);
  m.writeString('行%d[G512]', 320);
  m.writeString('locked.log', 384);
  m.store(512, 7);
  await world.runtime.scheduler.execute(task);
  assert.deepEqual([m.load(128), m.load(132)], [3, 0xfffffffe]);
  assert.deepEqual(files.get('line.log'), encodeCP932('abc行7\r\n'));
  assert.deepEqual(files.get('locked.log'), Uint8Array.of(0xaa));
});

test('2.6.1.67 KCS capture produces an opaque owned bitmap and copies it through the CSS thumbnail', async (t) => {
  const capture = [0x13, 80],
    thumbnail = [0x13, 84],
    file = [0x13, 88],
    clone = [0x13, 92],
    loaded = [0x13, 96],
    call = (id, args, at) => [
      ...args.map((arg) => [37, arg]),
      [43, id, args.length * 4],
      ...(at === undefined ? [] : [[38, at]]),
    ];
  const world = await dataWorld(profile, {
    'thumbnail.kcs': kcsProgram([
      ...call(113, [], 80),
      ...call(112, [2, 2], 84),
      ...call(116, [thumbnail, 0, 0, 2, 2, capture, 0, 0, 2, 2]),
      ...call(112, [1, 1], 136),
      ...call(116, [[0x13, 136], 0, 0, 1, 1, capture, 0, 0, 2, 2]),
      ...call(116, [thumbnail, 0, 0, 2, 2, 0, 0, 0, 2, 2]),
      ...call(118, [thumbnail], 92),
      ...call(118, [0], 100),
      ...call(238, [0x2400], 88),
      ...call(241, [0, 7, clone], 104),
      ...call(241, [file, 7, 0], 108),
      ...call(241, [file, 7, clone], 112),
      ...call(251, [file, 9], 116),
      ...call(251, [file, 7], 96),
      ...call(114, [capture]),
      ...call(114, [thumbnail]),
      ...call(114, [clone]),
      ...call(362, [loaded, 128, 132]),
      [59],
    ]),
    'inactive.kcs': kcsProgram([...call(113, [], 80), [59]]),
    'rgb.kcs': kcsProgram([...call(241, [file, 8, clone], 112), ...call(251, [file, 8], 96), [59]]),
  });
  const stage = world.stageRenderer,
    originalGPU = stage.gpu,
    originalRender = stage.render,
    frames = [];
  t.after(async () => {
    stage.gpu = originalGPU;
    stage.render = originalRender;
    await world.close({ flushFiles: false });
  });
  stage.gpu = {
    primaryTarget: { width: 2, height: 2 },
    pixels: () =>
      Uint8Array.of(20, 40, 60, 25, 70, 90, 110, 60, 120, 140, 160, 80, 200, 210, 220, 10),
  };
  stage.render = (scene, _audio, _items, { present }) => frames.push({ scene, present });
  const task = await world.spawnScript('thumbnail.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    stack = m.sp;
  await world.runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(frames, [{ scene: world.graphics.stage, present: false }]);
  assert.deepEqual(
    [100, 104, 108, 112, 116, 128, 132].map((at) => m.load(at)),
    [0, 0, 0, 1, 0, 2, 2],
  );
  const images = world.graphics.images,
    bitmap = images.get(m.load(96));
  assert.notEqual(m.load(92), m.load(96));
  assert.equal(bitmap.owner, task.id);
  for (const at of [80, 84, 92]) assert.throws(() => images.get(m.load(at)), /released|unknown/i);
  const expected = Uint8ClampedArray.of(
    120,
    140,
    160,
    255,
    200,
    210,
    220,
    255,
    20,
    40,
    60,
    255,
    70,
    90,
    110,
    255,
  );
  assert.deepEqual(await bitmap.pixels(), expected);
  assert.deepEqual(await images.get(m.load(136)).pixels(), Uint8ClampedArray.of(20, 40, 60, 255));
  const css = world.runtime.handles.get(m.load(88), 'global-file'),
    compressed = css.read(7),
    hg = await openImage(compressed);
  assert.deepEqual(compressed.subarray(0, 4), Uint8Array.of(72, 71, 45, 50));
  assert.equal(hg.frame(0).bpp, 32);
  bitmap.state.bpp = 3;
  const second = await world.spawnScript('rgb.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  second.machine.store(88, m.load(88));
  second.machine.store(92, m.load(96));
  await world.runtime.scheduler.execute(second);
  assert.equal(second.machine.load(112), 1);
  assert.equal((await openImage(css.read(8))).frame(0).bpp, 24);
  const rgb = images.get(second.machine.load(96));
  assert.equal(rgb.state.bpp, 4);
  assert.deepEqual(await rgb.pixels(), expected);
  world.graphics.view.active = false;
  const inactive = await world.spawnScript('inactive.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await world.runtime.scheduler.execute(inactive);
  assert.equal(inactive.machine.load(80), 0);
  assert.equal(frames.length, 1);
});

function planeProgram(calls) {
  return kcsProgram([
    [37, 0x72394ca1],
    ...calls.flatMap(([id, args]) => [...args.map((arg) => [37, arg]), [43, id, args.length * 4]]),
    [59],
  ]);
}

test('2.6.1.67 plane GCALLs create a textured region and preserve its transform selectors', async (t) => {
  const size = [4.5, 3.25].map(floatBits);
  const world = await dataWorld(profile, {
    'shape.kcs': planeProgram([
      [78, [0, ...size]],
      [78, [target, ...size]],
    ]),
    'transform.kcs': planeProgram([
      [84, [target, ...[6, 7, 8].map(floatBits), 0]],
      [85, [target, ...[3, 5].map(floatBits), 0]],
      [93, [target, ...[-5, 10, 15].map(floatBits), 0]],
      [101, [target, ...[2, 3, 4].map(floatBits), 1]],
      [94, [target, -1]],
    ]),
    'opaque.kcs': planeProgram([[94, [target, 256]]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const owner = world.main.id;
  const id = await world.objects.create({ kind: 2, parent: owner });
  const plane = world.graphics.get(id);
  const execute = async (name) => {
    const task = await world.spawnScript(name, { parent: owner, initialExecute: false });
    const { machine } = task;
    const floor = machine.sp;
    machine.store(80, world.nativeTaskID(id));
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0x72394ca1);
  };
  await execute('shape.kcs');
  assert.deepEqual(plane.state.shapeWords, [0, 0, 0, ...size, 32, 1, 0xffffffff]);
  assert.equal(plane.graph.width, 4.5);
  assert.equal(plane.graph.height, 3.25);
  assert.equal(plane.graph.vram, true);
  setMotionVector(plane.graph.kx2, MOTION_ABI.base, [0, 0, 61]);
  await execute('transform.kcs');
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.pos), [6, 7, 8]);
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.base), [3, 5, 61]);
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.rotation), [-5, 10, 15]);
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.scale), [2, 3, 4]);
  const view = new DataView(plane.graph.kx2.buffer);
  assert.equal(view.getUint32(MOTION_ABI.color, true), 0x00ffffff);
  await execute('opaque.kcs');
  assert.equal(view.getUint32(MOTION_ABI.color, true), 0xffffffff);
});

test('2.6.1.67 plane GCALLs set coordinates on a loaded graph and expand divided mesh vertices', async (t) => {
  const source = [0x23, 120],
    triangles = [
      [3, [0, 2, 0], [0, 0, 2], [1, 2, 3], [0, 1, 0], [0, 0, 1]],
      [7, [-4, 6, 0], [1, 0, -7], [0, 1, 3], [0, 0, 1], [1, 0, 0]],
    ];
  const world = await dataWorld(profile, {
    'mode-before.kcs': planeProgram([
      [466, [0, 128]],
      [466, [target, 128]],
    ]),
    'mesh.kcs': planeProgram([
      [467, [0, 0, -1]],
      [467, [target, source, triangles.length]],
    ]),
    'mode-after.kcs': planeProgram([[466, [target, 128]]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    id = await world.objects.create({ kind: 2, parent }),
    plane = world.graphics.get(id);
  const run = async (name) => {
    const task = await world.spawnScript(name, { parent, initialExecute: false }),
      { machine } = task,
      floor = machine.sp;
    machine.store(80, world.nativeTaskID(id));
    triangles.forEach(([texture, ...columns], index) => {
      const at = 120 + index * 64;
      machine.store(at, texture);
      columns.flat().forEach((value, word) => machine.store(at + 4 + word * 4, floatBits(value)));
    });
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0x72394ca1);
  };
  await run('mode-before.kcs');
  assert.equal(plane.graph, null);
  assert.equal(plane.state.coordMode, 0);
  await run('mesh.kcs');
  assert.equal(plane.graph.type, 3);
  assert.equal(plane.graph.style.coordMode, 0);
  assert.deepEqual(
    plane.graph.mesh,
    triangles.map(([textureID, x, y, z, u, v], id) => ({
      id,
      textureID,
      vertices: x.map((value, vertex) => ({
        x: value,
        y: y[vertex],
        z: z[vertex],
        u: u[vertex],
        v: v[vertex],
        color: 0,
      })),
    })),
  );
  assert.deepEqual(plane.graph.bounds, { minimum: [-4, -7, 0], maximum: [6, 2, 3] });
  await run('mode-after.kcs');
  assert.equal(plane.graph.style.coordMode, 128);
});

test('2.6.1.67 graph matrix GCALL copies all 16 words to the selected transform', async (t) => {
  const matrix = Array.from({ length: 16 }, (_, index) => floatBits(index / 4 - 3)),
    texture = matrix.slice().reverse(),
    world = await dataWorld(profile, {
      'matrices.kcs': planeProgram([
        [344, [0, 0, 0]],
        [78, [target, floatBits(8), floatBits(6)]],
        [344, [target, [0x23, 120], 0]],
        [344, [target, [0x23, 184], 7]],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    id = await world.objects.create({ kind: 2, parent }),
    task = await world.spawnScript('matrices.kcs', { parent, initialExecute: false }),
    { machine } = task,
    floor = machine.sp;
  machine.store(80, world.nativeTaskID(id));
  [...matrix, ...texture].forEach((value, index) => machine.store(120 + index * 4, value));
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0x72394ca1);
  const { graph } = world.graphics.get(id),
    words = (object) =>
      Array.from({ length: 16 }, (_, index) =>
        new DataView(object.buffer).getUint32(MOTION_ABI.matrix + index * 4, true),
      );
  assert.equal(graph.matrixExplicit, true);
  assert.equal(graph.textureMatrixExplicit, true);
  assert.deepEqual(words(graph.kx2), matrix);
  assert.deepEqual(words(graph.textureTransform), texture);
});

test('2.6.1.67 graph queries report F32 dimensions and bounds only from SimplePlane', async (t) => {
  const base = [0x13, 84],
    size = [
      [0x23, 120],
      [0x23, 124],
    ],
    bounds = [
      [0x23, 128],
      [0x23, 132],
      [0x23, 136],
      [0x23, 140],
    ],
    world = await dataWorld(profile, {
      'geometry.kcs': planeProgram([
        [343, [0, ...size]],
        [343, [base, ...size]],
        [345, [0, ...bounds]],
        [78, [target, floatBits(8.5), floatBits(6.25)]],
        [343, [target, ...size]],
        [345, [target, ...bounds]],
      ]),
      'base-size.kcs': planeProgram([[343, [base, ...size]]]),
      'base-bounds.kcs': planeProgram([[345, [base, ...bounds]]]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    targetID = world.nativeTaskID(await world.objects.create({ kind: 2, parent })),
    baseID = world.nativeTaskID(await world.objects.create({ kind: 6, parent }));
  const marker = 0x12345678;
  const create = async (name) => {
    const task = await world.spawnScript(name, { parent, initialExecute: false });
    task.machine.store(80, targetID);
    task.machine.store(84, baseID);
    for (let at = 120; at < 144; at += 4) task.machine.store(at, marker);
    return task;
  };
  const values = (task) => Array.from({ length: 6 }, (_, i) => task.machine.load(120 + i * 4));
  const program = await create('geometry.kcs');
  await world.runtime.scheduler.execute(program);
  assert.deepEqual(values(program), [8.5, 6.25, 0, 0, 8.5, 6.25].map(floatBits));
  const baseSize = await create('base-size.kcs');
  await world.runtime.scheduler.execute(baseSize);
  assert.deepEqual(values(baseSize), Array(6).fill(marker));
  const baseBounds = await create('base-bounds.kcs');
  await assert.rejects(world.runtime.scheduler.execute(baseBounds), /bounds reply was unwritten/);
  assert.deepEqual(values(baseBounds), Array(6).fill(marker));
});

test('2.6.1.67 plane GCALLs apply blend selectors and update their retained display state', async (t) => {
  const receiver = [0x13, 84],
    world = await dataWorld(profile, {
      'setup.kcs': planeProgram([
        [78, [target, floatBits(8), floatBits(6)]],
        [78, [receiver, floatBits(3), floatBits(4)]],
        [103, [target, 0xa9873210]],
        [402, [0, 5]],
      ]),
      'bind.kcs': planeProgram([[102, [target, receiver]]]),
      'release.kcs': planeProgram([[80, [target]]]),
      ...Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6, -1].map((mode) => [
          `blend-${mode}.kcs`,
          planeProgram([[402, [target, mode]]]),
        ]),
      ),
    });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    id = await world.objects.create({ kind: 2, parent }),
    receivingID = await world.objects.create({ kind: 2, parent }),
    plane = world.graphics.get(id),
    receivingPlane = world.graphics.get(receivingID);
  const run = async (name) => {
    const task = await world.spawnScript(name, { parent, initialExecute: false }),
      floor = task.machine.sp;
    task.machine.store(80, world.nativeTaskID(id));
    task.machine.store(84, world.nativeTaskID(receivingID));
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, floor + 4);
  };
  await run('setup.kcs');
  assert.equal(plane.state.frameStep, 0xa9873210);
  assert.equal(receivingPlane.state.shown, true);
  await run('bind.kcs');
  assert.equal(plane.state.imageIndex, world.nativeTaskID(receivingID));
  assert.equal(receivingPlane.state.shown, false);
  for (const [mode, expected] of [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 0],
    [0, 0],
    [-1, 0],
  ]) {
    await run(`blend-${mode}.kcs`);
    assert.equal(plane.graph.style.blendMode, expected);
  }
  const loaded = plane.graph;
  await run('release.kcs');
  assert.notEqual(plane.graph, loaded);
  assert.equal(plane.graph.vram, false);
  assert.deepEqual(plane.state.rect, [0, 0, 0, 0]);
});

test('2.6.1.67 texture GCALLs release intersecting pages and allocate missing pages', async (t) => {
  const world = await dataWorld(
    profile,
    {
      'outside.kcs': planeProgram([
        [541, [-1, 0, 1, 1]],
        [541, [2, 0, 0, 1]],
      ]),
      'release.kcs': planeProgram([
        [541, [2, 0, 1, 1]],
        [541, [2, 0, 1, 1]],
      ]),
      'allocate.kcs': planeProgram([[542, []]]),
    },
    { initialize: false },
  );
  t.after(() => world.close({ flushFiles: false }));
  const texture = world.configuration.fields.texture;
  texture.size.set([2, 2]);
  texture.grid.set([2, 1]);
  texture.areas[0].set([0, 0, 2, 1]);
  texture.bppY.set([0, 1]);
  await world.initialize('case.kcs');
  await world.graphics.fill(0, 0, 4, 2, 0xff343638);
  const left = await world.graphics.meshTexture(0),
    right = await world.graphics.meshTexture(1);
  const run = async (name) => {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      floor = task.machine.sp;
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, floor + 4);
    assert.equal(task.machine.load(floor), 0x72394ca1);
  };
  await run('outside.kcs');
  assert.equal(await world.graphics.meshTexture(0), left);
  assert.equal(await world.graphics.meshTexture(1), right);
  await run('release.kcs');
  assert.equal(await world.graphics.meshTexture(0), left);
  assert.equal(await world.graphics.meshTexture(1), NULL_NATIVE_TEXTURE);
  await run('allocate.kcs');
  const cleared = await world.graphics.meshTexture(1);
  assert.equal(await world.graphics.meshTexture(0), left);
  assert.notEqual(cleared, right);
  assert.deepEqual([...cleared.rgba], Array(16).fill(0));
  assert.deepEqual([...left.rgba.subarray(0, 4)], [52, 54, 56, 255]);
});

test('2.6.1.67 bitmap GCALLs own decoded pixels and copy original frame metadata and clipped extent', async (t) => {
  const rgba = Uint8Array.of(17, 34, 51, 255, 68, 85, 102, 255),
    source = hg3(2, 1, rgba),
    packed = [0x13, 80],
    bitmap = [0x13, 84],
    destination = [0x13, 88],
    invalid = [0x13, 92],
    run = (calls) =>
      kcsProgram(
        [
          [37, 0xe1c2a2f8],
          ...calls.flatMap(([id, args, output]) => [
            ...args.map((arg) => [37, arg]),
            [43, id, args.length * 4],
            ...(output === undefined ? [] : [[38, output]]),
          ]),
          [59],
        ],
        [
          [480, '背景.hg3'],
          [512, 'unknown.hg3'],
          [544, 'missing.hg3'],
        ],
      ),
    world = await dataWorld(profile, {
      '背景.hg3': source,
      'unknown.hg3': Uint8Array.of(68, 65, 84, 65),
      'bitmap-load.kcs': run([
        [365, [480], 80],
        [365, [512], 92],
        [365, [544], 96],
        [368, [0, 0, 224], 100],
        [368, [packed, 0, 264], 104],
        [368, [invalid, 0, 304], 108],
        [364, [packed, 0], 84],
        [364, [0, 0], 112],
        [112, [4, 1], 88],
      ]),
      'bitmap-query.kcs': run([
        [362, [bitmap, 128, 132]],
        [372, [bitmap, 11, 9], 96],
        [362, [bitmap, 136, 140]],
        [373, [bitmap, -3, 2], 100],
        [363, [bitmap, 144, 148]],
        [374, [bitmap, 5, -4], 104],
        [371, [bitmap, 152, 156], 108],
        [370, [bitmap, -3, 2], 112],
        [370, [bitmap, 99, 99], 116],
        [373, [bitmap, 0, 0], 120],
        [362, [0, 160, 164]],
      ]),
      'bitmap-blend.kcs': run([
        [367, [destination, 0, 0, 1, 1, bitmap, 0, 0, 2, 1]],
        [369, [bitmap, 0xff808080]],
        [366, [packed]],
        [366, [invalid]],
      ]),
      'bitmap-release.kcs': run([
        [114, [bitmap]],
        [114, [destination]],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const buffers = world.runtime.imageDataBuffers,
    images = world.graphics.images,
    execute = async (name, handles = []) => {
      const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
        { machine } = task,
        floor = machine.sp;
      handles.forEach((handle, i) => machine.store(80 + i * 4, handle));
      machine.bytes(128, 40).fill(0xa5);
      machine.bytes(224, 120).fill(0xa5);
      await world.runtime.scheduler.execute(task);
      assert.equal(machine.sp, floor + 4);
      assert.equal(machine.load(floor), 0xe1c2a2f8);
      return task;
    };
  const loaded = await execute('bitmap-load.kcs'),
    { machine } = loaded,
    handles = [80, 84, 88, 92].map((at) => machine.load(at)),
    pointer = buffers.pointer(handles[0]),
    foreground = images.get(handles[1]),
    target = images.get(handles[2]);
  assert.deepEqual(
    [96, 100, 104, 108, 112].map((at) => machine.load(at)),
    [0, 0, 1, 0, 0],
  );
  assert.deepEqual(buffers.data(pointer), source);
  assert.equal(foreground.owner, loaded.id);
  assert.equal(foreground.state.bpp, 4);
  assert.deepEqual(machine.bytes(224, 40), new Uint8Array(40).fill(0xa5));
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => machine.load(264 + i * 4)),
    [0, 0, 2, 1, 2, 1, 4, 0, 0, 0xa5a5a5a5],
  );
  assert.deepEqual(machine.bytes(304, 36), new Uint8Array(36));
  const { machine: queried } = await execute('bitmap-query.kcs', handles);
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => queried.load(128 + i * 4) | 0),
    [2, 1, 11, 9, -3, 2, 5, -4, 0, 0],
  );
  assert.deepEqual(
    [96, 100, 104, 108, 112, 116, 120].map((at) => queried.load(at)),
    [1, 1, 1, 1, 255, 0, 1],
  );
  await target.fill(0, 0, 4, 1, 0xff102030);
  await execute('bitmap-blend.kcs', handles);
  assert.deepEqual(
    await target.pixels(),
    Uint8ClampedArray.of(...rgba, 16, 32, 48, 255, 16, 32, 48, 255),
  );
  assert.deepEqual(
    await foreground.pixels(),
    Uint8ClampedArray.of(8, 17, 25, 255, 34, 42, 51, 255),
  );
  assert.throws(() => buffers.require(pointer), /released/);
  await execute('bitmap-release.kcs', handles);
  assert.equal(world.runtime.handles.records.has(handles[1]), false);
  assert.equal(world.runtime.handles.records.has(handles[2]), false);
});
