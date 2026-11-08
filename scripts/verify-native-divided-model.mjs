// SPDX-License-Identifier: MPL-2.0
// Authored triangles execute the original clipping, allocation and subdivision.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { nodeGame } from './node-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { decodeNativeMesh } from '../src/native/mesh.mjs';
import {
  clipNativeTriangle,
  divideNativeTriangles,
  nativeDivisionLayout,
} from '../src/native/divided-model.mjs';
import { floatBits } from '../src/kcs.mjs';
import { initialMotionObject, MOTION_ABI, setMotionVector } from '../src/motion/abi.mjs';
import { transformNativeTriangles } from '../src/render/native-geometry.mjs';
import { identity } from '../src/motion/matrix.mjs';

const [root, profile, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-divided-model.mjs FIXED_DIRECTORY PROFILE IGNORED_REPORT',
  );
const engine = await NativeEngineProcess.open({
    game: await nodeGame(root),
    profile,
    configuration: new NativeConfiguration({ profile }),
  }),
  p = engine.process,
  sdk = profile.startsWith('sdk-'),
  abi = sdk
    ? {
        source: 0x559240,
        reserve: 0x559330,
        set: 0x5595e0,
        divided: 0x5597a0,
        configure: 0x55a580,
        attach: 0x5598e0,
        close: 0x559890,
        clip: 0x555c60,
      }
    : {
        source: 0x6826b0,
        reserve: 0x6827a0,
        set: 0x682a70,
        divided: 0x682c30,
        configure: 0x683a10,
        attach: 0x682d70,
        close: 0x682d20,
        clip: 0x67f010,
      },
  source = p.allocate(424, true),
  divided = p.allocate(468, true),
  trianglePtr = p.allocate(48, true),
  rectanglePtr = p.allocate(64, true),
  polygon = p.allocate(256, true);
let seed = 0x91c4b57,
  passed = 0;
const golden = { clip: [], division: [] };
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
  compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  triangleBytes = (triangle) => {
    triangle.forEach((v, i) => {
      p.store(trianglePtr + i * 16, floatBits(v.x));
      p.store(trianglePtr + i * 16 + 4, floatBits(v.y));
      p.store(trianglePtr + i * 16 + 8, floatBits(v.z ?? 0));
      p.store(trianglePtr + i * 16 + 12, v.color ?? 0xffffffff);
    });
  };
engine.registerWindows('USER32.dll', 'SetRectEmpty', {
  count: 1,
  fn: ([at]) => {
    p.zero(at, 16);
    return 1;
  },
});
engine.registerWindows('USER32.dll', 'IntersectRect', {
  count: 3,
  fn: ([out, a, b]) => {
    const words = [
      Math.max(p.load(a) | 0, p.load(b) | 0),
      Math.max(p.load(a + 4) | 0, p.load(b + 4) | 0),
      Math.min(p.load(a + 8) | 0, p.load(b + 8) | 0),
      Math.min(p.load(a + 12) | 0, p.load(b + 12) | 0),
    ];
    if (words[0] >= words[2] || words[1] >= words[3]) {
      p.zero(out, 16);
      return 0;
    }
    words.forEach((v, i) => p.store(out + i * 4, v));
    return 1;
  },
});
try {
  if (!sdk)
    console.log(
      'edges',
      Array.from({ length: 14 }, (_, i) => p.load(0x8d54bc + i * 4)),
    );
  for (let trial = 0; trial < 320; trial++) {
    const triangle = Array.from({ length: 3 }, () => ({
        x: Math.fround(((next() % 401) - 100) / (trial % 3 ? 1 : 17)),
        y: Math.fround(((next() % 401) - 100) / (trial % 3 ? 1 : 19)),
        color: 0xffed3210,
      })),
      rectangle = [0, 0, 128, 96];
    triangleBytes(triangle);
    [
      [0, 0],
      [128, 0],
      [128, 96],
      [0, 96],
    ].forEach(([x, y], i) => {
      p.store(rectanglePtr + i * 16, floatBits(x));
      p.store(rectanglePtr + i * 16 + 4, floatBits(y));
    });
    const count = await engine.call(abi.clip, [polygon, trianglePtr, rectanglePtr]),
      data = new Float32Array(p.read(polygon, count * 16).buffer),
      original = Array.from({ length: count }, (_, i) => ({ x: data[i * 4], y: data[i * 4 + 1] }));
    compare(clipNativeTriangle(triangle, rectangle), original, `clip polygon/${trial}`);
    if (trial < 24)
      golden.clip.push({
        triangle,
        rectangle,
        expected: Buffer.from(
          Float32Array.from(original.flatMap(({ x, y }) => [x, y])).buffer,
        ).toString('base64'),
      });
  }
  await engine.call(abi.source, [], source);
  await engine.call(abi.reserve, [2], source);
  await engine.call(abi.divided, [], divided);
  for (let trial = 0; trial < 120; trial++) {
    const width = 4 * (1 + (next() % 8)),
      height = 4 * (1 + (next() % 8)),
      grid = [1 + (next() % 4), 1 + (next() % 4)],
      layout = nativeDivisionLayout(
        [width, height],
        grid,
        trial % 2 ? [-32768, -32768, 32768, 32768] : undefined,
      ),
      triangles = Array.from({ length: 2 }, () =>
        Array.from({ length: 3 }, () => ({
          x: Math.fround(((next() % (width * grid[0] * 13)) - 7 * width) / 13),
          y: Math.fround(((next() % (height * grid[1] * 11)) - 5 * height) / 11),
          z: next() % 2,
          color: next(),
        })),
      );
    for (let i = 0; i < triangles.length; i++) {
      triangleBytes(triangles[i]);
      await engine.call(abi.set, [i, trianglePtr], source);
    }
    await engine.call(
      abi.configure,
      [...layout.cellSize, ...layout.cells, ...layout.pageSize],
      divided,
    );
    await engine.call(abi.attach, [source], divided);
    const data = p.load(divided + 336),
      count = p.load(divided + 340),
      original = decodeNativeMesh(p.read(data, count * 80)),
      actual = divideNativeTriangles(triangles, layout);
    compare(actual, original, `divided records/${trial}`);
    if (trial < 12)
      golden.division.push({
        triangles,
        layout,
        position: [0, 0, 0],
        expected: Buffer.from(p.read(data, count * 80)).toString('base64'),
      });
    const state = initialMotionObject(),
      position = [(next() % 31) - 15, (next() % 31) - 15, (next() % 31) - 15],
      base = [(next() % 7) - 3, (next() % 7) - 3, 0],
      scale = [Math.fround((next() % 31) / 16), Math.fround((next() % 31) / 16), 1],
      matrix = identity();
    matrix[0] = Math.fround(0.875);
    matrix[1] = Math.fround(-0.125);
    matrix[4] = Math.fround(0.25);
    matrix[5] = Math.fround(0.75);
    setMotionVector(state, MOTION_ABI.base, base);
    setMotionVector(state, MOTION_ABI.scale, scale);
    setMotionVector(state, MOTION_ABI.pos, position);
    matrix.forEach((v, i) =>
      new DataView(state.buffer).setFloat32(MOTION_ABI.matrix + i * 4, v, true),
    );
    for (const [at, words] of [
      [8, base],
      [24, scale],
      [56, position],
      [104, matrix],
    ])
      words.forEach((v, i) => p.store(source + at + i * 4, floatBits(v)));
    p.store(source + 232, 1);
    p.store(source + 4, 1);
    await engine.call(sdk ? 0x5591a0 : 0x682610, [], source);
    await engine.call(abi.attach, [source], divided);
    const transformed = transformNativeTriangles(triangles, state),
      transformedOriginal = decodeNativeMesh(
        p.read(p.load(divided + 336), p.load(divided + 340) * 80),
      );
    compare(
      divideNativeTriangles(transformed, layout, position),
      transformedOriginal,
      `transformed source/${trial}`,
    );
    if (trial < 12)
      golden.division.push({
        triangles: transformed,
        layout,
        position,
        expected: Buffer.from(p.read(p.load(divided + 336), p.load(divided + 340) * 80)).toString(
          'base64',
        ),
      });
    for (const [at, words] of [
      [8, [0, 0, 0]],
      [24, [1, 1, 1]],
      [56, [0, 0, 0]],
      [104, identity()],
    ])
      words.forEach((v, i) => p.store(source + at + i * 4, floatBits(v)));
    p.store(source + 232, 1);
    p.store(source + 4, 1);
    await engine.call(sdk ? 0x5591a0 : 0x682610, [], source);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: engine.identity,
        passed,
        scope:
          'Original triangle/rectangle clipping and kc2DDivModel allocation/division/UV conversion. Authored geometry; host supplies only USER32 rectangle primitives.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native divided-model differential passed ${passed}/${passed}`);
  if (process.argv.includes('--golden'))
    await writeFile(
      process.argv[process.argv.indexOf('--golden') + 1],
      JSON.stringify(golden, null, 2) + '\n',
    );
} finally {
  await engine.close();
}
