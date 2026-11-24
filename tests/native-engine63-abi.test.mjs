// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { defaultFESWorld, drawPixels, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'rebellions-jp-engine-2.6.1.63';

const mainProgram = (id, width) =>
  kcsProgram([
    [37, 0x82345678],
    ...Array.from({ length: width }, (_, index) => [37, [0x13, 80 + index * 4]]),
    [43, id, width * 4],
    [59],
  ]);

async function executeMain(world, id, argv, setup = () => {}, result) {
  const task = await world.spawnScript(`main-${id}.kcs`, {
    parent: world.main.id,
    initialExecute: false,
  });
  try {
    const machine = task.machine;
    argv.forEach((word, index) => machine.store(80 + index * 4, word));
    setup(machine);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, machine.floor + (result === undefined ? 4 : 8));
    if (result !== undefined) assert.equal(machine.pop(), result);
    assert.equal(machine.pop(), 0x82345678);
  } finally {
    await world.objects.release(task.id);
  }
}

async function run(instructions, diagnostic) {
  const runtime = new NativeRuntime({
    profile,
    read: async () => kcsProgram(instructions),
    services: { diagnostic },
  });
  const task = await runtime.spawn('abi-probe.kcs');
  return { runtime, task, machine: task.machine };
}

test('2.6.1.63 Main stubs preserve their original three result behaviors', async () => {
  const table = nativeABI(profile).tables.main.entries;
  const noops = table.filter((entry) => entry.status === 'reserved');
  const zeros = table.filter((entry) => entry.status === 'constant-zero');
  const unwritten = [140, 142, 549].map((id) => table[id]);
  assert.equal(noops.length, 80);
  assert.equal(zeros.length, 19);
  const cases = [...noops, ...zeros, ...unwritten];
  const markerAddress = (index) => 512 + index * 4;
  const resultAddress = (index) => 1024 + index * 4;
  const marker = 0x82345678;

  // The fixed scripts exercise ignored calls with zero to seven argument words.
  for (let words = 0; words <= 7; words++) {
    const instructions = cases.flatMap((entry, index) => [
      [37, marker],
      ...Array.from({ length: words }, (_, word) => [37, 0xffa0b000 + word]),
      [43, entry.id, words * 4],
      ...(entry.status === 'reserved' ? [] : [[38, resultAddress(index)]]),
      [38, markerAddress(index)],
    ]);
    const diagnostics = [];
    const { runtime, task, machine } = await run([...instructions, [59]], (event) =>
      diagnostics.push(event),
    );
    machine.bytes(1024, cases.length * 4).fill(0xa5);
    machine.store(508, 0x3b46d32d);
    const stack = machine.sp;
    await runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, stack);
    assert.equal(machine.load(508), 0x3b46d32d);
    for (const [index, entry] of cases.entries()) {
      const noResult = entry.status === 'reserved';
      const zero = entry.status === 'constant-zero';
      assert.equal(runtime.calls.get(`main:${entry.id}`), 1);
      assert.equal(entry.signature.argumentWords, null);
      assert.equal(entry.signature.parameters.kind, 'ignored');
      assert.equal(entry.signature.resultWritten, zero);
      assert.deepEqual(entry.controlCodes, noResult ? [2] : [1]);
      assert.equal(machine.load(markerAddress(index)), marker);
      assert.equal(
        machine.load(resultAddress(index)),
        noResult ? 0xa5a5a5a5 : zero ? 0 : NATIVE_RESULT_SENTINEL,
      );
    }
    assert.equal(diagnostics.length, 3);
    assert.ok(diagnostics.every((event) => event.type === 'native-result-sentinel'));
  }
});

test('2.6.1.63 GCALL still rejects the adjacent unreviewed native slot', async () => {
  const args = [17, 18, 19, 20, 21, 22],
    { runtime, task } = await run([...args.map((arg) => [37, arg]), [43, 599, 24], [59]]);
  await assert.rejects(
    () => runtime.scheduler.execute(task),
    (error) => {
      assert.ok(error instanceof UnsupportedKCSNative);
      assert.equal(error.details.profile, profile);
      assert.equal(error.details.table, 'main');
      assert.equal(error.details.id, 599);
      assert.deepEqual(error.details.args, args);
      return true;
    },
  );
});

test('2.6.1.63 Main 6 returns the original DWORD through GCALL', async () => {
  const words = [0, 0x80000000, 0xffffffff, NATIVE_RESULT_SENTINEL, 0x7fc00001];
  const instructions = words.flatMap((word, index) => [
    [37, word],
    [43, 6, 4],
    [38, 256 + index * 4],
  ]);
  const { runtime, task, machine } = await run([...instructions, [59]]);
  await runtime.scheduler.execute(task);
  assert.deepEqual(
    words.map((_, index) => machine.load(256 + index * 4)),
    words,
  );
  assert.equal(machine.sp, machine.floor);
});

test('2.6.1.63 FES declares only its original type names and indexes', async () => {
  const source = new TextEncoder().encode(
    '#DEFINE\nview validView\nSTRING validString\nPARTICLE validParticle\n' +
      'CHTABLE3 excess1\nSTRTABLE excess2\nFILELIST excess3\nEFKPLANE excess4\n' +
      'STRING8 excess5\nLOGSTRING8 excess6\n#START\nnext WAIT\n#WAIT\n',
  );
  const world = await dataWorld(profile, { 'types.fes': source });
  try {
    const id = await world.objects.create({ kind: 34, parent: world.main.id });
    const task = world.objects.objects.get(id).implementation;
    await world.sendEngine(id, world.main.id, 331, 0, world.main.context.variableBank);
    await task.loadSource('types');
    const root = task.player.root;
    assert.deepEqual(
      [...root.byKey.values()].map(({ baseName, type }) => [baseName, type]),
      [
        ['validView', 'VIEW'],
        ['validString', 'STRING'],
        ['validParticle', 'PARTICLE'],
      ],
    );
    const memory = world.main.machine;
    memory.writeString('dynamicString', 128);
    memory.store(160, 2);
    await world.sendEngine(id, world.main.id, 338, 128, 20);
    assert.equal(root.byKey.get('dynamicString[0]').nativeType, 21);
    assert.equal(root.byKey.get('dynamicString[1]').nativeType, 21);

    memory.writeString('dynamicM2', 128);
    memory.store(160, 1);
    await world.sendEngine(id, world.main.id, 338, 128, 32);
    assert.equal(root.byKey.get('dynamicM2[0]').nativeType, 33);
    await assert.rejects(
      () => world.sendEngine(id, world.main.id, 338, 128, 33),
      /Unknown FES object factory index 33/,
    );
    assert.equal(root.byKey.size, 6);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS configures, appends and clears the original narrow Text owner', async () => {
  const world = await defaultFESWorld(profile, {
    'main-123.kcs': mainProgram(123, 3),
    'main-124.kcs': mainProgram(124, 2),
    'main-125.kcs': mainProgram(125, 1),
    'main-418.kcs': mainProgram(418, 4),
    'main-557.kcs': mainProgram(557, 2),
  });
  try {
    const id = await world.objects.create({ kind: 8, parent: world.root });
    const target = world.nativeTaskID(id),
      owner = world.legacyText.tasks.get(id),
      text = owner.text,
      append = (bytes) =>
        executeMain(world, 124, [target, 512], (machine) =>
          machine.writeStringBytes(Uint8Array.from(bytes), 512),
        ),
      configureText = (enabled) => (machine) => {
        for (const [index, word] of [
          [2, 96],
          [3, 48],
          [5, 1],
          [6, 12],
          [15, enabled ? 32 : 0],
          [16, 0xffffffff],
        ]) {
          machine.store(256 + index * 4, word);
        }
        machine.writeStringBytes(Uint8Array.of(0xb1, 0x21, 0xfa, 0x40), 512);
        machine.writeString('a'.repeat(254) + 'あ', 768);
      };
    const source = [0x96, 0x7b, 0x95, 0xb6, 0x25, 0x25, 0xfa, 0x40];
    await append(source);
    assert.equal(owner.bitmap, 0);
    assert.equal(text.rows.length, 0);

    await executeMain(world, 418, [target, 256, 512, 768], configureText(false));
    assert.equal(owner.bitmap, 0);
    await executeMain(world, 418, [target, 256, 512, 768], configureText(true));
    assert.equal(owner.owner.configurationBytes, 1128);
    assert.deepEqual([...text.profile(201, 202)], [0xffb1, 0x21, 0xfa40]);
    assert.deepEqual([...text.profile(330, 331)], [0x61, 0x82a0]);
    assert.equal(text.w(330), 255);
    assert.equal(text.w(458) & 0xffff, 0x82a0);
    await executeMain(world, 557, [target, 0xff123456]);
    assert.equal(text.w(470) >>> 0, 0xff123456);

    await append(source);
    assert.deepEqual(
      text.rows.map((row) => row[0]),
      [0x967b, 0x95b6, 0x25, 0xfa40],
    );
    const vram = world.graphics.images.get(world.graphics.vramHandle);
    assert.ok((await vram.pixels()).some((byte) => byte !== 0));
    await executeMain(world, 125, [target]);
    assert.deepEqual(text.rows, []);
    assert.ok((await vram.pixels()).every((byte) => byte === 0));

    await executeMain(world, 123, [target, 256, 512], configureText(true));
    assert.deepEqual([...text.profile(201, 202)], [0xffb1, 0x21, 0xfa40]);
    assert.equal(text.w(330), 0);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS sleep masks active FES outputs on each change of the raw word', async () => {
  const source = new TextEncoder().encode(
    '#DEFINE\nBUTTON button\nCIMAGE red\nPLANE panel\n' +
      '#OBJECT POS SIZE ENABLE DISP PRI\nbutton 0,0 2,2 1 1 100\n' +
      '#OBJECT SIZE COLOR DISP PRI\nred 2,2 4294901760 1 60000\n' +
      '#OBJECT SIZE DISP\npanel 2,2 1\n' +
      '#START\nnext WAIT\n#WAIT\n' +
      '#_FES_SLEEP_\n$1=7\nbreak\n#_FES_WAKE_\n$1=9\nbreak\n',
  );
  const files = { 'screen.fes': source, 'main-647.kcs': mainProgram(647, 2) };
  const world = await defaultFESWorld(profile, files);
  let second;
  try {
    const { id, task, surface, instance } = await loadDefaultFES(world);
    await task.tick();
    const target = world.nativeTaskID(id),
      panel = instance.byKey.get('panel'),
      buttonID = task.input.state.buttons[0][1],
      sleep = (word) => executeMain(world, 647, [target, word]),
      pixel = async (current) => [...(await drawPixels(current, surface)).subarray(0, 4)];
    assert.deepEqual(await pixel(world), [255, 0, 0, 255]);

    await sleep(1);
    assert.equal(task.sleepValue, 1);
    assert.equal(world.inputFor(id).get(buttonID).enabled, 0);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, false);
    assert.deepEqual(await pixel(world), [0, 0, 0, 0]);

    await world.sendEngine(panel.nativeTaskID, id, 47, 0, 1);
    await sleep(1);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, true);
    await sleep(0xffffffff);
    assert.equal(task.sleepValue, 0xffffffff);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, false);
    assert.equal(task.player.globals[1], 0);

    second = await defaultFESWorld(profile, files, { initialize: false });
    await second.restore(structuredClone(world.snapshot()));
    const restored = second.objects.objects.get(id).implementation;
    assert.equal(restored.sleepValue, 0xffffffff);
    assert.equal(restored.input.state.sleeping, true);
    await executeMain(second, 647, [target, 0]);
    assert.equal(restored.sleepValue, 0);
    assert.equal(restored.input.state.sleeping, false);
    assert.equal(restored.player.globals[1], 0);
    assert.equal(second.inputFor(id).get(buttonID).enabled, 1);
    assert.equal(second.graphics.get(panel.nativeTaskID).state.shown, true);
    assert.deepEqual(await pixel(second), [255, 0, 0, 255]);
  } finally {
    await second?.close();
    await world.close();
  }
});

test('2.6.1.63 KCS stores its FES private bank as one original CSS record', async () => {
  const world = await dataWorld(profile, {
    'bank.fes': new TextEncoder().encode('#START\nnext WAIT\n#WAIT\n'),
    'main-649.kcs': kcsProgram([
      [37, 0x82345678],
      [37, [0x13, 88]],
      [37, 0],
      [37, 0xfedcba98],
      [43, 645, 12],
      [37, [0x13, 88]],
      [37, 511],
      [37, 0x01234567],
      [43, 645, 12],
      [37, [0x13, 80]],
      [37, [0x13, 84]],
      [37, [0x13, 88]],
      [43, 649, 12],
      [59],
    ]),
  });
  try {
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      task = world.objects.objects.get(id).implementation,
      target = world.nativeTaskID(id),
      file = new NativeGlobalFile(),
      handle = world.runtime.handles.add('global-file', file);
    world.runtime.variableBank(world.main).initialize(64);
    await world.sendEngine(id, world.main.id, 331, 0, world.main.context.variableBank);
    await task.loadSource('bank');
    await executeMain(world, 649, [0, 0x63, target], undefined, 0);
    assert.equal(file.read(0x63), null);
    await executeMain(world, 649, [handle, 0x63, target], undefined, 1);
    const persisted = await NativeGlobalFile.fromFile(await file.file());
    const bytes = persisted.read(0x63);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes.length, 2048);
    assert.equal(view.getUint32(0, true), 0xfedcba98);
    assert.equal(view.getUint32(2044, true), 0x01234567);
  } finally {
    await world.close();
  }
});
