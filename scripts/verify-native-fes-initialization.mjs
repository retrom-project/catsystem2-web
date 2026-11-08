// SPDX-License-Identifier: MPL-2.0
// Runs the original FES allocation phase. Object enumeration and the task
// factory are authored boundaries; bitmap constructors, field setters and
// the allocation list are the mounted engine's original instructions.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';

const profiles = [
  {
    flag: '--game',
    profile: 'nekopara-vol3-engine-2.6.1.76',
    initialize: 0x628d60,
    enumerate: 0x7562e0,
    find: 0x755630,
    extra: [36, 37, 38],
    wrapperBytes: 0x218,
    taskFields: { 6: 1768, 13: 492, 14: 524, 15: 520, 21: 992, 29: 1252, 37: 1060 },
    drivers: [
      0x65cd40, 0x65e110, 0x65c750, 0x662580, 0x662220, 0x6627f0, 0x6632c0, 0x65feb0, 0x65fa50,
      0x663b30,
    ],
  },
  {
    flag: '--sdk',
    profile: 'sdk-4.01-engine-2.6.1.74',
    initialize: 0x500390,
    enumerate: 0x5f4590,
    find: 0x5f3b90,
    extra: [],
    wrapperBytes: 0x114,
    taskFields: { 6: 1512, 13: 492, 14: 524, 15: 520, 21: 960, 29: 1188 },
    drivers: [
      0x52cca0, 0x52d970, 0x52c6c0, 0x531f70, 0x531c10, 0x5321e0, 0x532c40, 0x52f8c0, 0x52f460,
    ],
  },
];
for (const abi of profiles) {
  const at = process.argv.indexOf(abi.flag);
  if (at < 0) continue;
  const engine = await NativeEngineProcess.open({
    profile: abi.profile,
    bytes: new Uint8Array(await readFile(process.argv[at + 1])),
  });
  try {
    const p = engine.process,
      types = [
        1,
        2,
        3,
        4,
        6,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        24,
        25,
        28,
        29,
        33,
        ...abi.extra,
      ],
      objects = types.map((type) => {
        const pointer = p.allocate(0x1800, true);
        p.store(pointer + 4, type);
        return { type, pointer, name: `authored_${type}` };
      }),
      task = p.allocate(1536, true),
      vtable = p.allocate(32, true),
      interpreter = p.allocate(256, true),
      list = p.allocate(8, true),
      sentinel = p.allocate(12, true),
      creations = [],
      frameCalls = [];
    p.store(task, vtable);
    p.store(task + 4, 61);
    p.store(task + 104, interpreter);
    p.store(task + 380, interpreter);
    p.store(task + 384, list);
    p.store(list, sentinel);
    p.store(sentinel, sentinel);
    p.store(sentinel + 4, sentinel);
    let index = 0;
    engine.patch(
      abi.enumerate,
      'authored FES initialization queue',
      3,
      ([name, objectIndex, remove]) => {
        if (index === objects.length) return 0;
        assert.equal(remove, 1);
        engine.kernel.writeString(name, objects[index].name);
        p.store(objectIndex, 0);
        index++;
        return 1;
      },
      { calleePops: true },
    );
    engine.patch(
      abi.find,
      'authored FES initialization lookup',
      2,
      ([name]) => {
        const object = objects.find((object) => object.name === p.string(name));
        assert.ok(object);
        return object.pointer;
      },
      { calleePops: true },
    );
    p.store(
      vtable + 16,
      p.trap(
        'authored FES child task factory',
        7,
        ([sender, target, message, kind, name, flags, result]) => {
          assert.deepEqual([sender, target, message, flags], [61, 61, 1, 0]);
          const pointer = p.allocate(128, true),
            id = 100 + creations.length;
          p.store(pointer + 4, id);
          p.store(result, pointer);
          creations.push({ kind, name: p.string(name), id });
          return 1;
        },
      ),
    );
    for (const driver of abi.drivers)
      engine.patch(driver, 'unexpected FES frame driver during initialization', 0, () => {
        frameCalls.push(driver);
        throw new Error(`Initialization invoked frame driver ${driver.toString(16)}`);
      });
    assert.equal(await engine.call(abi.initialize, [], task), 1);
    assert.deepEqual(frameCalls, []);
    assert.deepEqual(
      creations.map(({ kind }) => kind),
      [6, 40, 41, 42, 48, 49, ...(abi.extra.includes(37) ? [63] : [])],
    );
    const bitmapTypes = [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22];
    for (const object of objects) {
      const wrapper = p.load(object.pointer + 244);
      if (bitmapTypes.includes(object.type)) {
        assert.ok(wrapper);
        assert.equal(p.load(wrapper), 0, 'initial wrapper owns no decoded bitmap');
        assert.equal(p.read(wrapper, abi.wrapperBytes).length, abi.wrapperBytes);
      } else assert.equal(wrapper, 0);
      if (Object.hasOwn(abi.taskFields, object.type)) {
        const kind = { 6: 6, 13: 40, 14: 41, 15: 42, 21: 48, 29: 49, 37: 63 }[object.type];
        assert.equal(
          p.load(object.pointer + abi.taskFields[object.type]),
          creations.find((record) => record.kind === kind).id,
        );
      }
    }
    assert.equal(p.load(list + 4), types.length);
    console.log(
      JSON.stringify({
        profile: abi.profile,
        objects: objects.length,
        creations,
        decoded: 0,
        frameCalls: 0,
      }),
    );
  } finally {
    engine.close();
  }
}
