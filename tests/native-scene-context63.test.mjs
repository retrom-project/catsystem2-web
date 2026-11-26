// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import golden from './fixtures/native-scene-context63-golden.json' with { type: 'json' };
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';

function sceneFile() {
  const blocks = [
      [
        [0xf0, '本文'],
        [0xf1, '0x2a'],
        [0x20, '最初の本文'],
      ],
      [
        [0x21, '語り手'],
        [0x20, '終わり'],
      ],
    ],
    lines = blocks.flat(),
    offsets = [],
    strings = [];
  for (const [kind, text] of lines) {
    offsets.push(strings.length);
    strings.push(1, kind, ...encodeCP932(text), 0);
  }
  const body = new Uint8Array(16 + blocks.length * 8 + lines.length * 4 + strings.length),
    view = new DataView(body.buffer),
    stringAt = blocks.length * 8 + lines.length * 4;
  [body.length - 16, blocks.length, blocks.length * 8, stringAt].forEach((value, i) =>
    view.setUint32(i * 4, value, true),
  );
  let start = 0;
  blocks.forEach((block, i) => {
    view.setUint32(16 + i * 8, block.length, true);
    view.setUint32(20 + i * 8, start, true);
    start += block.length;
  });
  offsets.forEach((value, i) => view.setUint32(16 + blocks.length * 8 + i * 4, value, true));
  body.set(strings, 16 + stringAt);
  const packed = deflateSync(body),
    file = new Uint8Array(16 + packed.length),
    header = new DataView(file.buffer);
  file.set(new TextEncoder().encode('CatScene'));
  header.setUint32(8, packed.length, true);
  header.setUint32(12, body.length, true);
  file.set(packed, 16);
  return file;
}

const ptr = (address) => [0x23, address],
  handle = (address) => [0x13, address];
function program(rows, strings = []) {
  return kcsProgram(
    [
      ...rows.flatMap(([id, args, resultAt]) => [
        ...args.map((arg) => [37, arg]),
        [43, id, args.length * 4],
        ...(resultAt === undefined ? [] : [[38, resultAt]]),
      ]),
      [59],
    ],
    strings,
  );
}

test('63 own Scene context wrappers execute real GCALLs and round-trip native GAME_SAVE files', async (t) => {
  const profile = golden.profile,
    file = handle(68),
    scene = handle(64),
    types = golden.typeQueries.map(([block, line, expected], i) => [
      221,
      [block, line],
      2096 + i * 4,
      expected,
    ]),
    rows = [
      [220, [0x7fffffff], 2000, 0],
      [221, [0, 0], 2004, 0],
      [222, [0x7fffffff, 0, 0], 2008, 0],
      [223, [0x7fffffff, 1], 2012, 0],
      [224, [0x7fffffff, 1], 2016, 0],
      [227, [0x7fffffff], 2020, 0],
      [228, [0, 0x7fffffff, 0x7fffffff], 2024, 0],
      [229, [0, 0, 0, 0x7fffffff], 2028, 0],
      [230, [0, 0, 0, 0x7fffffff], 2032, 0],
      [234, [73], 2036, 0],
      [231, [0, 0, 0x7fffffff]],
      [232, [0, 0, 0x7fffffff]],
      [233, [73, 0, 0, 0x7fffffff]],
      [219, []],
      [235, [ptr(1728)], 2700, golden.initialFileMarker.value],
      [228, [0, ptr(1792), ptr(1856)], 2704, golden.emptyPath.index],
      [221, [-1, 0], 2040, -1],
      [322, [ptr(256)], 2044, 1],
      [322, [ptr(320)], 2048, 0],
      [220, [ptr(256)], 2052, 1],
      [220, [ptr(320)], 2056, 0],
      ...types,
      [235, [ptr(1024)], 2060, golden.fileMarker.value],
      [222, [ptr(1088), 1, 0], 2064, encodeCP932(golden.text[0]).length],
      [222, [ptr(1152), 0, 2], 2068, encodeCP932(golden.text[1]).length],
      [222, [0xffffffff, 0, 2], 2072, 0],
      [223, [ptr(384), 19], 2200, 1],
      [223, [ptr(512), 17], 2204, 1],
      [227, [ptr(512)], 2208, golden.seen],
      [224, [ptr(384), 4], 2212, 1],
      [224, [ptr(512), 2], 2216, 1],
      [224, [ptr(448), 9], 2220, 1],
      [228, [0, ptr(1216), ptr(1280)], 2224, 0],
      [228, [99, ptr(1344), ptr(1408)], 2228, 1],
      [229, [0, 53, 47, ptr(576)], 2232, 1],
      [230, [0, 53, 47, ptr(1472)], 2236, 1],
      [232, [0, 53, ptr(640)]],
      [231, [0, 53, ptr(704)]],
      [276, [5, ptr(576)]],
      [231, [0, 53, ptr(768)]],
      [230, [0, 53, 5, ptr(1536)], 2240, 1],
      [234, [73], 2244, 0],
      [323, [], 64],
      [329, [scene, ptr(384), 8], 2248, 1],
      [334, [scene, 0, 53, 47, ptr(576)], 2252, 1],
      [335, [scene, 0, 53, 47, ptr(1600)], 2256, 1],
      [337, [scene, 0, 53, ptr(832)]],
      [238, [17], 68],
      [239, [file, 101, 57, 0, 1], 2260, 1],
      [239, [file, 102, 57, 1, 1], 2264, 1],
      [245, [file, ptr(896)], 2268, 1],
    ],
    files = {
      'idle.kcs': kcsProgram([[59]]),
      'owned.cst': sceneFile(),
      'source.kcs': program(rows, [
        [256, 'owned.cst'],
        [320, 'missing.cst'],
        [384, 'Scene01.cst'],
        [448, 'scene02.cst'],
        [512, 'SCENE01.CST'],
        [576, golden.historyString],
        [640, 'A$str47 B$str5 C$strx'],
        [704, 'plain'],
        [768, '$str5'],
        [832, '$str47/$str99'],
        [896, 'save0001.dat'],
      ]),
      'copy.kcs': program(
        [
          [219, []],
          [234, [57], 2096],
          [227, [ptr(256)], 2100],
          [233, [57, 0, 53, ptr(320)]],
        ],
        [
          [256, 'SCENE01.CST'],
          [320, 'A$str47 B$str99 C$strx'],
        ],
      ),
      'reset.kcs': program(
        [
          [225, []],
          [226, []],
          [227, [ptr(256)], 2096],
          [249, [file, 101, 57, 0], 2100],
          [249, [file, 102, 57, 1], 2104],
          [249, [file, 103, 57, 1], 2108],
          [227, [ptr(256)], 2112],
          [230, [0, 53, 47, ptr(512)], 2116],
          [219, []],
          [227, [ptr(256)], 2120],
        ],
        [[256, 'SCENE01.CST']],
      ),
      'cold.kcs': program(
        [
          [219, []],
          [247, [ptr(256)], 68],
          [249, [file, 101, 57, 0], 2096],
          [249, [file, 102, 57, 1], 2100],
          [227, [ptr(320)], 2104],
          [230, [0, 53, 47, ptr(512)], 2108],
          [230, [0, 53, 5, ptr(576)], 2112],
          [220, [ptr(384)], 2116],
          [221, [0, 0]],
          [221, [0, 1]],
          [235, [ptr(640)], 2120],
        ],
        [
          [256, 'save0001.dat'],
          [320, 'scene01.cst'],
          [384, 'owned.cst'],
        ],
      ),
    },
    storage = new NativeFileStorage({ lookup: () => null, read: async () => null }, 'scene63');
  assert.equal(
    createHash('sha256').update(files['owned.cst']).digest('hex'),
    golden.authoredCSTSHA256,
  );
  // An explicitly selected GAME_SAVE owns its file view, independently of account IndexedDB.
  const initial = new NativeGlobalFile(17);
  initial.write(999, Uint8Array.of(1));
  await storage.prepareGameSave([
    {
      path: 'save0001.dat',
      bytes: await initial.file(),
      createdMs: 1700000000000,
      accessedMs: 1700000001000,
      modifiedMs: 1700000002000,
      attributes: 0x80,
    },
  ]);
  const world = await dataWorld(profile, files, { storage }),
    make = async (name, nativeID, targetWorld = world) => {
      const id = await targetWorld.objects.create({ kind: 12, nativeID, parent: targetWorld.root }),
        record = targetWorld.objects.objects.get(id);
      await record.implementation.loadScript(name);
      return targetWorld.runtime.scheduler.tasks.get(id);
    },
    source = await make('source.kcs', 57),
    other = await make('idle.kcs', 73),
    trace = [],
    native = world.runtime.native;
  t.after(() => world.close({ flushFiles: false }));
  world.runtime.native = async function (table, id, args, machine, task, ...rest) {
    const reply = await Reflect.apply(native, this, [table, id, args, machine, task, ...rest]);
    if (golden.entries.includes(id) && task.id === source.id) trace.push([id, reply.control]);
    return reply;
  };
  const floor = source.machine.sp;
  await world.runtime.scheduler.execute(source);
  assert.equal(source.machine.sp, floor);
  for (const [id, args, at, expected] of rows)
    if (expected !== undefined)
      assert.equal(
        source.machine.load(at),
        expected >>> 0,
        `Main${id} ${JSON.stringify(args)} at ${at}`,
      );
  for (const id of golden.entries) {
    if ([225, 226, 233, 249].includes(id)) continue;
    assert(
      trace.some(
        ([actual, control]) => actual === id && golden.nativeControls[id].includes(control),
      ),
      `Main${id}`,
    );
  }
  const m = source.machine;
  assert.equal(m.string(1728), golden.initialFileMarker.name);
  assert.equal(m.string(1792), golden.emptyPath.name);
  assert.equal(m.load(1856), golden.emptyPath.value);
  assert.equal(m.string(1024), golden.fileMarker.name);
  assert.equal(m.string(1088), golden.text[0]);
  assert.equal(m.string(1152), golden.text[1]);
  assert.equal(m.string(1216), golden.path[0].name);
  assert.equal(m.load(1280), golden.path[0].value);
  assert.equal(m.string(1344), golden.path[1].name);
  assert.equal(m.load(1408), golden.path[1].value);
  for (const at of [1472, 1536, 1600]) assert.equal(m.string(at), golden.historyString);
  assert.equal(m.string(640), golden.expanded);
  assert.equal(m.string(832), golden.directExpanded);
  const saved = world.runtime.handles.get(m.load(68), 'global-file'),
    bytes = saved.payload(),
    mask = Buffer.from(golden.historyDefinedMaskHex, 'hex'),
    expected = Uint8Array.from(Buffer.from(golden.historyDefinedPayloadHex, 'hex'));
  assert.equal(bytes.length, golden.historyPayloadBytes);
  // The original strcpy paths leave stack bytes after NUL undefined. Imported
  // tails remain owned file data; new records need only match the defined bytes.
  assert.deepEqual(
    bytes.map((byte, i) => (mask[i] ? byte : 0)),
    expected,
  );
  const exported = storage.exportGameSave();
  assert.equal(exported.files.length, 1);
  assert.equal(exported.files[0].path, 'save0001.dat');
  assert.deepEqual((await NativeGlobalFile.fromFile(exported.files[0].bytes)).payload(), bytes);

  const otherRecord = world.objects.objects.get(other.id);
  await otherRecord.implementation.loadScript('copy.kcs');
  const copy = world.runtime.scheduler.tasks.get(other.id);
  await world.runtime.scheduler.execute(copy);
  assert.equal(copy.machine.load(2096), 1);
  assert.equal(copy.machine.load(2100), golden.seen);
  assert.equal(copy.machine.string(320), golden.crossExpanded);
  const state = structuredClone(world.snapshot()),
    restored = await dataWorld(profile, files, { initialize: false });
  t.after(() => restored.close({ flushFiles: false }));
  await restored.restore(state);
  assert.deepEqual(
    restored.runtime.sceneData(restored.runtime.scheduler.tasks.get(copy.id)).history.snapshot(),
    world.runtime.sceneData(copy).history.snapshot(),
  );
  const sourceRecord = world.objects.objects.get(source.id),
    oldHandle = source.context.sceneData;
  await sourceRecord.implementation.loadScript('reset.kcs');
  const reset = world.runtime.scheduler.tasks.get(source.id);
  reset.machine.store(68, m.load(68));
  await world.runtime.scheduler.execute(reset);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => reset.machine.load(2096 + i * 4)),
    [0, 1, 1, 0, 19, 1, 0],
  );
  assert.equal(reset.machine.string(512), golden.historyString);
  assert.throws(() => world.runtime.handles.get(oldHandle, 'scene-data'), /released/);

  const coldStorage = new NativeFileStorage(
    { lookup: () => null, read: async () => null },
    'scene63-fresh',
  );
  await coldStorage.prepareGameSave(exported.files);
  const fresh = await dataWorld(profile, files, { storage: coldStorage });
  t.after(() => fresh.close({ flushFiles: false }));
  const cold = await make('cold.kcs', 57, fresh);
  await fresh.runtime.scheduler.execute(cold);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => cold.machine.load(2096 + i * 4)),
    [1, 1, 19, 1, 1, 1, 42],
  );
  assert.equal(cold.machine.string(512), golden.historyString);
  assert.equal(cold.machine.string(576), golden.historyString);
  assert.equal(cold.machine.string(640), golden.fileMarker.name);
  const abi = nativeABI(profile);
  for (const id of golden.entries) assert.equal(abi.tables.main.entries[id].status, 'recovered');
  assert.equal(abi.tables.main.entries[688].status, 'unknown');
});

test('63 imported opaque history tails survive native file reads, Script copies and cold restore', async (t) => {
  const mask = Buffer.from(golden.historyDefinedMaskHex, 'hex'),
    payload = Uint8Array.from(Buffer.from(golden.historyDefinedPayloadHex, 'hex'));
  for (let i = 0; i < payload.length; i++) if (!mask[i]) payload[i] = (i * 13 + 7) & 255;
  const input = NativeGlobalFile.fromPayload(payload, 17),
    storage = new NativeFileStorage(
      { lookup: () => null, read: async () => null },
      'scene63-tails',
    ),
    file = handle(64),
    imported = handle(68),
    files = {
      'import.kcs': program(
        [
          [219, []],
          [247, [ptr(256)], 68],
          [249, [imported, 101, 57, 0], 2048],
          [249, [imported, 102, 57, 1], 2052],
          [238, [17], 64],
          [239, [file, 101, 57, 0, 1], 2056],
          [239, [file, 102, 57, 1, 1], 2060],
        ],
        [[256, 'save0001.dat']],
      ),
      'copy.kcs': program([
        [219, []],
        [234, [57], 2048],
        [238, [17], 64],
        [239, [file, 101, 73, 0, 1], 2052],
        [239, [file, 102, 73, 1, 1], 2056],
      ]),
    };
  await storage.prepareGameSave([
    {
      path: 'save0001.dat',
      bytes: await input.file(),
      createdMs: 1700000000000,
      accessedMs: 1700000001000,
      modifiedMs: 1700000002000,
      attributes: 0x80,
    },
  ]);
  const world = await dataWorld(golden.profile, files, { storage });
  t.after(() => world.close({ flushFiles: false }));
  for (const [name, nativeID, count] of [
    ['import.kcs', 57, 4],
    ['copy.kcs', 73, 3],
  ]) {
    const id = await world.objects.create({ kind: 12, nativeID, parent: world.root }),
      record = world.objects.objects.get(id);
    await record.implementation.loadScript(name);
    const task = world.runtime.scheduler.tasks.get(id);
    await world.runtime.scheduler.execute(task);
    for (let i = 0; i < count; i++) assert.equal(task.machine.load(2048 + i * 4), 1);
    assert.deepEqual(
      world.runtime.handles.get(task.machine.load(64), 'global-file').payload(),
      payload,
    );
  }
  const fresh = await dataWorld(golden.profile, files, { initialize: false });
  t.after(() => fresh.close({ flushFiles: false }));
  await fresh.restore(structuredClone(world.snapshot()));
  const restored = [...fresh.runtime.scheduler.tasks.values()].filter((task) =>
    [57, 73].includes(fresh.nativeTaskID(task.id)),
  );
  assert.equal(restored.length, 2);
  for (const task of restored)
    assert.deepEqual(
      fresh.runtime.handles.get(task.machine.load(64), 'global-file').payload(),
      payload,
    );
});
