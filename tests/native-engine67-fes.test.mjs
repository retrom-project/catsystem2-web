// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67',
  fes = [0x13, 80],
  draw = [0x13, 84],
  file = [0x13, 88],
  tag = 0x87654321,
  word = 0x89abcdef;

function nativeProgram(calls, strings = []) {
  return kcsProgram(
    [
      [37, 0x862afb3d],
      ...calls.flatMap(([id, args, result]) => [
        ...args.map((value) => [37, value]),
        [43, id, args.length * 4],
        ...(result === undefined ? [] : [[38, result]]),
      ]),
      [59],
    ],
    strings,
  );
}

test('2.6.1.67 FES GCALLs update the interpreter, reach authored events and transfer its local bank', async (t) => {
  const world = await dataWorld(profile, {
    'screen.fes': encodeCP932(`#DEFINE
VIEW marker[2]
#START
$8=73
next HOLD
#HOLD
#IDLE
#PING
$10=91
break
#marker.PING
$10=92
break
#_LOAD_
$11=84
next IDLE
`),
    'fes-open.kcs': nativeProgram(
      [
        [449, [fes, draw]],
        [447, [fes, 128]],
        [448, [fes]],
        [450, [fes, 160], 92],
        [450, [fes, 192], 96],
        [451, [fes, 0x96a81234]],
        [630, [fes, 224, 256, 0]],
        [645, [fes, 511, word]],
        [645, [fes, 512, 0xff0044ff]],
        [645, [fes, 0xffffffff, 0x923490ff]],
        [646, [fes, 511], 100],
        [646, [fes, 512], 104],
        [646, [fes, 0xffffffff], 108],
        [649, [0, tag, fes], 112],
        [649, [file, tag, fes], 116],
        [647, [fes, 0x80000001]],
      ],
      [
        [128, 'screen'],
        [160, 'IDLE'],
        [192, 'ABSENT'],
        [224, 'PING'],
        [256, ''],
      ],
    ),
    'fes-reload.kcs': nativeProgram(
      [
        [647, [fes, 0]],
        [630, [fes, 224, 256, 1]],
        [645, [fes, 511, 19]],
        [650, [0, tag, fes], 100],
        [650, [file, 0x7744, fes], 104],
        [646, [fes, 511], 108],
        [650, [file, tag, fes], 112],
        [646, [fes, 511], 116],
        [448, [fes]],
      ],
      [
        [224, 'PING'],
        [256, 'marker'],
      ],
    ),
  });
  t.after(() => world.close({ flushFiles: false }));
  const owner = world.main.id;
  const drawID = await world.objects.create({ kind: 15, parent: owner });
  await world.sendEngine(drawID, owner, 279, 32, 24);
  await world.sendEngine(drawID, owner, 283);
  const fesID = await world.objects.create({ kind: 34, parent: owner });
  const child = world.objects.objects.get(fesID).implementation;
  const globalFile = new NativeGlobalFile(0, 0x80000);
  const fileHandle = world.runtime.handles.add('global-file', globalFile);
  const bank = world.runtime.variableBank(world.main);
  bank.initialize(64);
  const execute = async (name) => {
    const task = await world.spawnScript(name, { parent: owner, initialExecute: false });
    const { machine } = task;
    const floor = machine.sp;
    machine.store(80, world.nativeTaskID(fesID));
    machine.store(84, world.nativeTaskID(drawID));
    machine.store(88, fileHandle);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0x862afb3d);
    return machine;
  };
  const opened = await execute('fes-open.kcs');
  assert.equal(world.graphics.fesSurfaces.get(drawID).get(fesID), child.player);
  assert.equal(child.variableBank(), bank);
  assert.equal(bank.get(8), 73);
  assert.equal(bank.get(10), 91);
  assert.equal(child.player.root.label, 'IDLE');
  assert.equal(child.player.saveObject, 0x96a81234);
  assert.equal(child.sleepValue, 0x80000001);
  assert.deepEqual(
    [92, 96, 100, 104, 108, 112, 116].map((address) => opened.load(address)),
    [1, 0, word, 0, 0, 0, 1],
  );
  const saved = new DataView(globalFile.read(tag).buffer);
  assert.equal(saved.byteLength, 2048);
  assert.equal(saved.getUint32(2044, true), word);
  const loaded = await execute('fes-reload.kcs');
  assert.equal(child.sleepValue, 0);
  assert.equal(bank.get(10), 92);
  assert.equal(bank.get(11), 84);
  assert.equal(child.player.root.local(511) >>> 0, word);
  assert.deepEqual(
    [100, 104, 108, 112, 116].map((address) => loaded.load(address)),
    [0, 0, 19, 1, word],
  );
});

test('2.6.1.67 authored FES macros preserve CP932 pairs and reconstruct raw character literals', async (t) => {
  const world = await defaultFESWorld(profile, {
    'screen.fes': encodeCP932(`#MACRO
WORD 猫
#DEFINE
STRING message
#OBJECT SIZE POS PRI DISP
message 80,24 4,4 60001 1
#START
message str WORD ソ 'a'
next IDLE
#IDLE
`),
  });
  t.after(() => world.close());
  const { task, instance } = await loadDefaultFES(world);
  await task.tick();
  const text = instance.collection.lookup('message', 0);
  assert.deepEqual(text.nativeTextState.source, encodeCP932("猫 ソ ''a''"));
});

test('2.6.1.67 FES assignment keeps literal writes inert and evaluates their right operands', async (t) => {
  const world = await dataWorld(profile, {
    'expression.fes': encodeCP932(String.raw`#DEFINE
#START
\131 = 10
\130 = 131 = -1
$1 = \130
$2 = \131
$3 = (131 = 7) + 9
\130 = \131 = -1
$4 = \130
$5 = \131
\130 = 131 = (\131 += 2)
$6 = \130
$7 = \131
next HOLD
#HOLD
`),
    'boot-expression.kcs': nativeProgram(
      [
        [447, [fes, 128]],
        [448, [fes]],
      ],
      [[128, 'expression']],
    ),
  });
  t.after(() => world.close({ flushFiles: false }));
  const owner = world.main.id,
    id = await world.objects.create({ kind: 34, parent: owner }),
    task = await world.spawnScript('boot-expression.kcs', {
      parent: owner,
      initialExecute: false,
    }),
    bank = world.runtime.variableBank(task);
  bank.initialize(256);
  bank.words[131] = 0x12345678;
  const receiver = world.objects.objects.get(id).implementation;
  task.machine.store(80, world.nativeTaskID(id));
  await world.runtime.scheduler.execute(task);
  const instance = receiver.player.root;
  assert.equal(instance.label, 'HOLD');
  assert.deepEqual([...bank.words.subarray(1, 8)], [0, 10, 9, 0xffffffff, 0xffffffff, 0, 1]);
  assert.equal(instance.local(130), 0);
  assert.equal(instance.local(131), 1);
  assert.equal(bank.words[131], 0x12345678);
});

test('2.6.1.67 named FES word GCALLs format CP932 dictionary keys and keep receiver failures visible', async (t) => {
  const world = await dataWorld(profile, {
    'named.fes': encodeCP932('#DEFINE\n#START\nnext HOLD\n#HOLD\n'),
    'named.kcs': nativeProgram(
      [
        [447, [fes, 128]],
        [448, [fes]],
        [882, [fes, 160, 0xc73222f0]],
        [883, [fes, 160], 100],
        [883, [fes, 192], 104],
        [882, [fes, 160, 0x86521eed]],
        [883, [fes, 160], 108],
        [882, [fes, 0xffffffff, 4]],
        [883, [fes, 0xffffffff], 112],
      ],
      [
        [128, 'named'],
        [160, '表示状態'],
        [192, '存在しない名前'],
      ],
    ),
    'missing-owner.kcs': nativeProgram([[883, [0xfffffff0, 128], 100]], [[128, '表示状態']]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const owner = world.main.id,
    fesID = await world.objects.create({ kind: 34, parent: owner }),
    task = await world.spawnScript('named.kcs', { parent: owner, initialExecute: false }),
    { machine } = task,
    floor = machine.sp;
  world.runtime.variableBank(world.main).initialize(64);
  machine.store(80, world.nativeTaskID(fesID));
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0x862afb3d);
  assert.deepEqual(
    [100, 104, 108, 112].map((at) => machine.load(at)),
    [0xc73222f0, 0, 0x86521eed, 0],
  );
  const receiver = world.objects.objects.get(fesID).implementation;
  assert.equal(receiver.nativeDictionary.get(encodeCP932('表示状態')), 0x86521eed);
  assert.equal(receiver.nativeDictionary.get(new Uint8Array()), 0);
  const missing = await world.spawnScript('missing-owner.kcs', {
    parent: owner,
    initialExecute: false,
  });
  await assert.rejects(() => world.runtime.scheduler.execute(missing), /unwritten output pointer/);
});

test('2.6.1.67 CP932 STRING uses its own packet, signed position, page limit and font ownership in KCS', async (t) => {
  const address = 240,
    textAddress = 512,
    value = [0x13, 100],
    result = 104,
    target = [0x13, 80],
    bindings = [
      [611, [target, address]],
      [612, [target, address]],
      [613, [target, address]],
      [614, [target, textAddress]],
      [615, [target]],
      [616, [target], result],
      [617, [target]],
      [618, [target]],
      [619, [target, value]],
      [620, [target, value]],
      [621, [target, 0xabcd0041, 1]],
      [695, [target, value]],
      [884, [target], result],
    ];
  const glyphs = {
    measure: (_font, text) => ({
      width: text.length * 5,
      height: 10,
      ascent: 7,
      descent: 3,
      averageWidth: 5,
      maximumWidth: 8,
    }),
    glyph: () => ({
      width: 4,
      height: 6,
      originX: 0,
      originY: 6,
      advanceX: 5,
      advanceY: 0,
      alpha: new Uint8Array(24).fill(255),
    }),
  };
  const world = await dataWorld(
    profile,
    Object.fromEntries(bindings.map((entry) => [`string-${entry[0]}.kcs`, nativeProgram([entry])])),
    { glyphs },
  );
  t.after(() => world.close({ flushFiles: false }));
  world.graphics.createLogicalDevice();
  const task = await world.objects.create({ kind: 48, parent: world.root }),
    owner = world.graphics.get(task),
    nativeID = world.nativeTaskID(task);
  Object.assign(world.configuration.fields.font, {
    name: 'ＭＳ ゴシック',
    weight: 1,
    rightdown: 3,
    around: 2,
    prop: 1,
    fix: 17,
  });
  new DataView(world.configuration.blocks[1].buffer).setUint32(56, 1, true);
  async function call(id, prepare = () => {}, receiver = nativeID) {
    const caller = await world.spawnScript(`string-${id}.kcs`, {
      parent: world.main.id,
      initialExecute: false,
    });
    const { machine } = caller,
      floor = machine.sp;
    machine.store(80, receiver);
    machine.store(result, 0xcafec784);
    prepare(machine);
    assert.equal((await world.runtime.scheduler.execute(caller)).status, 'halted');
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.pop(), 0x862afb3d);
    return machine;
  }
  const preparePacket = (machine, size) => {
    machine.bytes(address - 4, 208).fill(0xbd);
    machine.store(address, size);
  };
  const initial = await call(611, (machine) => preparePacket(machine, 200)),
    record = initial.bytes(address, 200).slice();
  assert.equal(
    createHash('sha256').update(record).digest('hex'),
    'fce5d9e192eba7f8e6afeb8cbafe68bf5b3fd7998ba773cbb7091eb95c77622a',
  );
  assert.equal(initial.load(address - 4), 0xbdbdbdbd);
  assert.equal(initial.load(address + 200), 0xbdbdbdbd);
  const wrongSize = await call(611, (machine) => preparePacket(machine, 199));
  assert.deepEqual([...wrongSize.bytes(address + 4, 196)], Array(196).fill(0xbd));
  await assert.rejects(call(616), /initialized writer/);
  await assert.rejects(
    call(884, () => {}, 0x9abcdef0),
    /initialized 32-bit output/,
  );
  await call(613, (machine) => preparePacket(machine, 200));
  assert.equal(await owner.writer(), null);
  await call(612, (machine) => preparePacket(machine, 199));
  assert.ok(await owner.writer());
  assert.equal(owner.graph, null);
  const configure = (machine, x = -7) => {
    machine.bytes(address, 200).set(record);
    machine.store(address + 4, 0);
    machine.store(address + 8, 96);
    machine.store(address + 12, 48);
    machine.store(address + 188, x);
    machine.store(address + 192, -8);
  };
  await call(612, configure);
  const writer = await owner.writer();
  assert.deepEqual([writer.pixels.width, writer.pixels.height], [96, 48]);
  assert.deepEqual(owner.text.vram, [-7, -8]);
  assert.deepEqual(motionVector(owner.graph.textureTransform, MOTION_ABI.pos), [-7, -8, 0]);
  const append = (source) => call(614, (machine) => machine.writeString(source, textAddress));
  await append('文字%%');
  assert.deepEqual(writer.parser.source, encodeCP932('文字%'));
  await call(618);
  await call(613, (machine) => configure(machine, -19));
  assert.equal(await owner.writer(), writer);
  assert.deepEqual(owner.text.vram, [-19, -8]);
  assert.deepEqual(writer.parser.source, encodeCP932('文字%'));
  await append('B');
  await call(619, (machine) => machine.store(100, 0));
  assert.equal(owner.text.pageLimit, 0);
  await call(617);
  assert.equal(writer.parser.rows.findLast((row) => row[1] === 66)[15], 0);
  assert.ok(writer.frame().rgba.some((value) => value !== 0));
  assert.equal(
    (await call(616)).load(result),
    1,
    JSON.stringify(writer.parser.rows.map((row) => [row[1], row[15]])),
  );
  assert.equal((await call(884)).load(result), 0);
  await call(619, (machine) => machine.store(100, 1));
  await call(617);
  assert.equal(writer.parser.rows.findLast((row) => row[1] === 66)[15], 1);
  assert.equal((await call(616)).load(result), 0);
  writer.maximumTime = 13;
  writer.lastFrame = 87;
  await call(695, (machine) => machine.store(100, 21));
  assert.deepEqual([writer.speedValue, writer.baseTime, writer.baseFrame], [21, 13, 87]);
  writer.maximumTime = 29;
  await call(695, (machine) => machine.store(100, 21));
  assert.equal(writer.baseTime, 13);
  await call(621);
  assert.equal(writer.fontImages.size, 0);
  const buffers = world.runtime.imageDataBuffers,
    bytes = await encodeHG2(
      { width: 2, height: 2, rgba: new Uint8ClampedArray(16).fill(255) },
      { id: 1 },
    ),
    pointer = buffers.createPointer(bytes),
    handle = buffers.handle(pointer);
  await call(620, (machine) => machine.store(100, 0));
  assert.equal(buffers.owns(pointer), true);
  await call(620, (machine) => machine.store(100, handle));
  assert.equal(buffers.owns(pointer), false);
  assert.deepEqual(writer.imageFont, bytes);
  await call(621);
  assert.deepEqual([...writer.fontImages], [[65, 1]]);
  assert.deepEqual(await world.engineMessages.dispatchNative(world.main.id, nativeID, 467), {
    routed: true,
    handled: false,
    result: NATIVE_UNWRITTEN_WORD,
  });
  await call(615);
  assert.equal(writer.parser.source.length, 0);
  assert.deepEqual([owner.text.active, owner.text.elapsed, owner.text.pageLimit], [false, 0, 0]);
  assert.ok(writer.frame().rgba.every((value) => value === 0));
});
