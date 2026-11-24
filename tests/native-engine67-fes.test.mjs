// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCP932 } from '../src/kcs/strings.mjs';
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
