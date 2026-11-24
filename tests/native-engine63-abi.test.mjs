// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { openImage } from '../src/formats/hg3.mjs';
import { floatBits, NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { controlFiles } from './fixtures/control-files.mjs';
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
    setup(machine, task);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, machine.floor + (result === undefined ? 4 : 8));
    if (typeof result === 'function') result(machine.pop());
    else if (result !== undefined) assert.equal(machine.pop(), result);
    assert.equal(machine.pop(), 0x82345678);
    return machine;
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

test('2.6.1.63 KCS shortens live CP932 bytes at its original write boundary', async () => {
  const cases = [
    [23, 3, 2, [0xfa, 0x40, 0, 0, 0x43, 0]],
    [23, 2, 0, [0, 0, 0x41, 0x42, 0x43, 0]],
    [23, 4, 3, [0xfa, 0x40, 0x41, 0, 0, 0]],
    [24, 1, 2, [0xfa, 0x40, 0, 0, 0x43, 0]],
    [24, 2, 3, [0xfa, 0x40, 0x41, 0, 0, 0]],
    [24, 0xffffffff, 5, [0xfa, 0x40, 0x41, 0x42, 0x43, 0]],
  ];
  const instructions = cases.flatMap(([id, limit], index) => [
    [37, 256 + index * 8],
    [37, limit],
    [43, id, 8],
    [38, 512 + index * 4],
  ]);
  const { runtime, task, machine } = await run([...instructions, [59]]);
  cases.forEach((_, index) =>
    machine.bytes(256 + index * 8, 8).set([0xfa, 0x40, 0x41, 0x42, 0x43, 0, 0xa7, 0xa7]),
  );
  await runtime.scheduler.execute(task);
  for (const [index, [, , kept, bytes]] of cases.entries()) {
    assert.equal(machine.load(512 + index * 4), kept);
    assert.deepEqual([...machine.bytes(256 + index * 8, 6)], bytes);
    assert.equal(machine.load(256 + index * 8 + 6, 1), kept === 5 ? 0 : 0xa7);
    assert.equal(machine.load(256 + index * 8 + 7, 1), 0xa7);
  }
});

test('2.6.1.63 KCS transfers only the selected live Script memory span', async () => {
  const world = await dataWorld(profile, {
    'target.kcs': kcsProgram([[59]]),
    'main-72.kcs': mainProgram(72, 4),
    'main-73.kcs': mainProgram(73, 4),
    'main-76.kcs': mainProgram(76, 0),
  });
  try {
    const peer = await world.spawnScript('target.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      id = world.nativeTaskID(peer.id),
      source = Uint8Array.of(0x41, 0xf2, 0x29, 0x80);
    peer.machine.bytes(254, 8).fill(0x95);
    await executeMain(world, 73, [id, 256, 4, 384], (machine) => machine.bytes(384, 4).set(source));
    assert.deepEqual([...peer.machine.bytes(254, 8)], [0x95, 0x95, ...source, 0x95, 0x95]);
    const copied = await executeMain(world, 72, [id, 256, 4, 512]);
    assert.deepEqual(copied.bytes(512, 4), source);
    await executeMain(world, 76, [], undefined, world.nativeTaskID(world.main.id));
  } finally {
    await world.close();
  }
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

test('2.6.1.63 KCS resolves authored FES labels and binds the full save-object word', async () => {
  const world = await dataWorld(profile, {
    'labels.fes': new TextEncoder().encode('#START\nnext WAIT\n#WAIT\n#FOUND\n'),
    'main-450.kcs': mainProgram(450, 2),
    'main-451.kcs': mainProgram(451, 2),
  });
  try {
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      task = world.objects.objects.get(id).implementation,
      target = world.nativeTaskID(id),
      jump = (text, found) =>
        executeMain(world, 450, [target, 128], (machine) => machine.writeString(text, 128), found);
    await world.sendEngine(id, world.main.id, 331, 0, world.main.context.variableBank);
    await task.loadSource('labels');
    const before = task.player.root.label;
    await jump('ABSENT', 0);
    assert.equal(task.player.root.label, before);
    await jump('FOUND', 1);
    assert.equal(task.player.root.label, 'FOUND');
    await executeMain(world, 451, [target, 0xf1310050]);
    assert.equal(task.player.saveObject, 0xf1310050);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 control calls retain sender-keyed Draw entries and a full task user DWORD', async () => {
  const world = await defaultFESWorld(profile, { 'main-694.kcs': mainProgram(694, 2) });
  try {
    const owner = world.main.id,
      id = await world.objects.create({ kind: 15, parent: owner }),
      target = world.nativeTaskID(id),
      draw = world.graphics.drawTasks.get(id),
      call = (id, argv) => world.runtime.native('main', id, argv, world.main.machine, world.main);
    await executeMain(world, 694, [target, 0xff76013d]);
    assert.equal(world.objects.objects.get(id).userValue, 0xff76013d);

    await world.sendEngine(id, owner, 279, 16, 12);
    await world.sendEngine(id, owner, 283);
    const image = world.graphics.images.create(2, 2, owner),
      one = floatBits(1),
      key = (world.nativeTaskID(owner) | (6 << 16)) >>> 0;
    await call(257, [target, 6, image, one, one, 0, 0, 0, one, one, 255, 1, 0]);
    assert.equal(draw.entry(key).visible, true);
    assert.deepEqual(await call(263, [target, 6, 0]), { control: 2 });
    assert.equal(draw.entry(key).visible, false);
    assert.deepEqual(await call(263, [target, 6, 2]), { control: 2 });
    assert.equal(draw.entry(key).visible, true);
    draw.state.renderer.dirtyRects.length = 0;
    assert.deepEqual(await call(464, [target, 7]), { control: 2 });
    assert.equal(draw.state.renderer.dirtyRects.length, 0);
    assert.deepEqual(await call(464, [target, 6]), { control: 2 });
    assert.ok(draw.state.renderer.dirtyRects.length > 0);
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

test('2.6.1.63 FES pos reads a trailing integer after the original current word', async () => {
  const source = new TextEncoder().encode(
    '#DEFINE\nBUTTON sample\n#OBJECT POS SIZE\nsample 0,0 2,2\n' +
      '#START\nsample pos @+90 @1\nnext WAIT\n#WAIT\nbreak\n',
  );
  const world = await defaultFESWorld(profile, { 'screen.fes': source });
  try {
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    const sample = instance.byKey.get('sample');
    assert.deepEqual([sample.x, sample.y], [90, 1]);
    instance.nativeContext.current = 53;
    for (const [operand, value] of [
      ['@', 53],
      ['@+90', 143],
      ['@12', 12],
      ['@ 1', 1],
      ['@0x12', 18],
    ])
      assert.equal(instance.operandValue(new TextEncoder().encode(operand)), value);
    assert.throws(() => instance.operandValue(new TextEncoder().encode('1 2')), /Unexpected/);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 FES SCROLL sends its original packet and owns its actual children', async () => {
  const { 'scroll.hg2': skin } = await controlFiles(new Uint8Array());
  const source = new TextEncoder().encode(
    '#DEFINE\nSCROLL sample\n#OBJECT FILE POS VRAM PRI PRI_P TYPE DISP ENABLE\n' +
      'sample scroll 4,4 0,0 102 1003 0 1 1\n' +
      '#START\nsample page 0 100 20\nsample pos 10 1\nnext WAIT\n#WAIT\nbreak\n' +
      '#sample.SCRL_P\n$7=@\nbreak\n',
  );
  const world = await defaultFESWorld(profile, { 'scroll.hg2': skin, 'screen.fes': source });
  const outgoing = [];
  const dispatch = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = (target, sender, message, w, l, context) => {
    if (message >= 341 && message <= 346)
      outgoing.push({
        target,
        sender,
        message,
        w,
        l,
        flags: context.flags,
        bytes: context.payload?.data.slice(),
      });
    return dispatch(target, sender, message, w, l, context);
  };
  try {
    const { id, task, instance, surface } = await loadDefaultFES(world);
    await task.tick();
    const object = instance.byKey.get('sample'),
      control = world.objects.objects.get(object.nativeTaskID).implementation,
      target = world.nativeTaskID(control.record.id),
      state = control.model.state;
    assert.ok(
      outgoing.every(
        ({ target: actual, sender, flags }) => actual === target && sender === id && flags === 1,
      ),
    );
    const packet = outgoing.find(({ message }) => message === 341).bytes,
      packetView = new DataView(packet.buffer),
      words = (view, offsets) => offsets.map((offset) => view.getInt32(offset, true));
    assert.equal(packet.length, 292);
    assert.deepEqual(words(packetView, [0, 4, 268, 272, 276, 280, 284, 288]), [
      0,
      world.nativeTaskID(surface),
      0,
      0,
      4,
      4,
      122,
      1003,
    ]);
    assert.equal(
      new TextDecoder().decode(packet.subarray(8, packet.indexOf(0, 8))),
      '@cat/image/scroll',
    );
    const pending = outgoing.slice(outgoing.findIndex(({ message }) => message === 344));
    assert.deepEqual(
      pending.slice(0, 5).map(({ message }) => message),
      [344, 345, 342, 343, 346],
    );
    assert.deepEqual(words(new DataView(pending[0].bytes.buffer), [0, 4, 8]), [0, 100, 20]);
    assert.deepEqual([pending[1].w, pending[1].l], [0, 10]);
    assert.deepEqual(
      [state.direction, state.minimum, state.maximum, state.pageSize, state.value],
      [0, 0, 100, 20, 10],
    );
    assert.equal(control.record.parent, id);
    assert.equal(control.resource.planes.length, 5);
    assert.equal(Object.keys(control.resource.areas).length, 5);
    assert.ok((await drawPixels(world, surface)).some((byte) => byte !== 0));

    const send = (message, w, l, context = {}) => dispatch(target, id, message, w, l, context);
    assert.equal(await send(342, 0, 0), NATIVE_UNWRITTEN_WORD);
    assert.equal(state.shown, false);
    assert.ok(
      Object.values(control.resource.areas).every((area) => !world.inputFor(id).get(area).enabled),
    );
    assert.equal(await send(343, 0, 0x80002000), NATIVE_UNWRITTEN_WORD);
    assert.ok(
      Object.values(control.resource.areas).every(
        (area) => world.inputFor(id).get(area).enabled === 0x80002000,
      ),
    );
    const unreviewed = {};
    assert.equal(await send(355, 0, 0, unreviewed), NATIVE_UNWRITTEN_WORD);
    assert.equal(unreviewed.nativeUnhandled, true);
    assert.equal(state.enabled, true);
    await assert.rejects(
      world.objects.create({ kind: 41, parent: id }),
      /controlResources kind 41/,
    );
  } finally {
    await world.close();
  }
});

test('2.6.1.63 FES SLIDER drives its raw packet, Input flags and Draw skin', async (t) => {
  const { 'area.hg2': area, 'controls.hg2': skin } = await controlFiles(new Uint8Array());
  const source = new TextEncoder().encode(
    '#DEFINE\nPLANE panel\nSLIDER sample\n#OBJECT SIZE VRAM DISP\n' +
      'panel 128,96 2,3 1\n#OBJECT FILE PL POS2 PRI DISP ENABLE\n' +
      'sample controls panel[0] area:7 82 1 1\n' +
      '#START\nsample page 0 100\nsample pos 25\nsample blend 129\nnext WAIT\n#WAIT\nbreak\n',
  );
  const world = await defaultFESWorld(profile, {
    'area.hg2': area,
    'controls.hg2': skin,
    'screen.fes': source,
  });
  t.after(() => world.close());
  const outgoing = [],
    dispatch = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = (target, sender, message, w, l, context) => {
    if (message >= 347 && message <= 355)
      outgoing.push({
        target,
        sender,
        message,
        w,
        l,
        flags: context.flags,
        bytes: context.payload?.data.slice(),
      });
    return dispatch(target, sender, message, w, l, context);
  };
  const { id, task, instance, surface } = await loadDefaultFES(world);
  await task.tick();
  const object = instance.byKey.get('sample'),
    control = world.objects.objects.get(object.nativeTaskID).implementation,
    target = world.nativeTaskID(object.nativeTaskID),
    state = control.model.state,
    input = world.inputFor(id);
  assert.ok(
    outgoing.every(
      (message) => message.target === target && message.sender === id && message.flags === 1,
    ),
  );
  const [load] = outgoing,
    loadView = new DataView(load.bytes.buffer),
    range = new DataView(outgoing.find(({ message }) => message === 350).bytes.buffer);
  assert.equal(load.message, 347);
  assert.equal(load.bytes.length, 292);
  assert.equal(loadView.getUint32(0, true), world.nativeTaskID(surface));
  const filename = new TextEncoder().encode('@cat/image/controls\0');
  assert.deepEqual(load.bytes.slice(4, 4 + filename.length), filename);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => loadView.getInt32(264 + i * 4, true)),
    [102, 16, 12, 88, 24, 2, 3],
  );
  assert.deepEqual(
    outgoing.slice(0, 7).map(({ message }) => message),
    [347, 352, 350, 351, 353, 349, 348],
  );
  assert.deepEqual([range.getInt32(0, true), range.getInt32(4, true)], [0, 100]);
  assert.deepEqual([state.direction, state.value, state.alpha], [0, 25, 129]);
  assert.equal(control.record.parent, id);
  const { thumb, track } = control.resource.areas;
  assert.ok(input.get(thumb) && input.get(track));
  assert.ok((await drawPixels(world, surface)).some((byte) => byte !== 0));

  const send = (message, w = 0, l = 0, context = {}) =>
    dispatch(target, id, message, w, l, context);
  assert.equal(await send(349), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.state, 1);
  assert.equal(input.get(thumb).enabled, 0);
  assert.equal(input.get(track).enabled, 0);
  assert.equal(await send(349, 0, 0x80002000), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.state, 0);
  assert.equal(input.get(thumb).enabled, 0x80002000);
  assert.equal(input.get(track).enabled, 0x80002000);
  assert.equal(await send(352), 0);
  assert.equal(await send(354, 0, 2), NATIVE_UNWRITTEN_WORD);
  assert.equal(await send(355), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.skinTable[0], 2);
  assert.equal(control.resource.current, control.resource.frames.find(([frame]) => frame === 2)[1]);
  const touches = [],
    inputMessage = input.message.bind(input);
  input.message = (message, ...args) => {
    if (message === 155) touches.push(message);
    return inputMessage(message, ...args);
  };
  assert.equal(await send(62, world.nativeTaskID(thumb)), NATIVE_UNWRITTEN_WORD);
  assert.deepEqual(touches, [155]);
  const [, top, right, bottom] = input.get(track).bounds,
    y = (top + bottom) >> 1;
  input.pointer(right - 4, y, 1);
  await world.tick();
  input.key(0, true, 2, 1);
  await world.tick();
  assert.equal(state.dragging, true);
  const draggedValue = state.value;
  assert.ok(draggedValue > 25);
  input.pointer(right - 23, y, 1);
  await world.tick();
  assert.ok(state.value < draggedValue);
  input.key(0, false, 2, 1);
  await world.tick();
  assert.equal(state.dragging, false);
  const unreviewed = {};
  assert.equal(await send(359, 0, 0, unreviewed), NATIVE_UNWRITTEN_WORD);
  assert.equal(unreviewed.nativeUnhandled, true);
});

test('2.6.1.63 KCS preserves nested CSS, narrow strings, HG-2 thumbnails and log records', async () => {
  const world = await defaultFESWorld(
    profile,
    Object.fromEntries(
      [
        [241, 3],
        [242, 3],
        [243, 2],
        [252, 2],
        [253, 2],
        [850, 3],
        [851, 3],
        [852, 0],
      ].map(([id, width]) => [`main-${id}.kcs`, mainProgram(id, width)]),
    ),
  );
  try {
    world.configuration.setField('scene.staticLog', 0x7fedcba9);
    await executeMain(world, 852, [], undefined, 0x7fedcba9);
    const handles = world.runtime.handles,
      file = new NativeGlobalFile(9),
      nested = new NativeGlobalFile(11),
      handle = handles.add('global-file', file),
      inner = handles.add('global-file', nested);
    nested.write(5, Uint8Array.of(0xf1, 0x60));
    await executeMain(world, 242, [handle, 12, 0], undefined, 0);
    await executeMain(world, 242, [handle, 12, inner], undefined, 1);
    assert.deepEqual(file.read(12), nested.raw());
    await executeMain(world, 252, [handle, 12], undefined, (result) => {
      const copy = handles.get(result, 'global-file');
      assert.notEqual(copy, nested);
      assert.deepEqual(copy.read(5), nested.read(5));
    });
    await executeMain(
      world,
      243,
      [handle, 13],
      (_machine, task) => {
        world.runtime.stringBank(task).set(4, '本文');
      },
      1,
    );
    let restored;
    await executeMain(
      world,
      253,
      [handle, 13],
      (_machine, task) => {
        restored = world.runtime.stringBank(task);
        restored.set(4, '別');
      },
      1,
    );
    assert.equal(restored.get(4), '本文');

    const image = world.graphics.images.create(2, 2, world.main.id);
    await world.graphics.images.get(image).fill(0, 0, 2, 2, 0xffa02030);
    await executeMain(world, 241, [handle, 14, image], undefined, 1);
    const hg = await openImage(file.read(14)),
      frame = hg.frame(0);
    await hg.decode(frame);
    assert.deepEqual([...frame.rgba.slice(0, 4)], [0xa0, 0x20, 0x30, 0xff]);

    const sourceLog = world.displayLogs.create(world.main.id),
      targetLog = world.displayLogs.create(world.main.id),
      model = world.displayLogs.get(sourceLog);
    model.blockBase = 9;
    model.rowBase = 13;
    model.blocks.push([0, 1, 2, 3, 4, 5, 0xbad0]);
    await executeMain(world, 850, [handle, 15, sourceLog], undefined, 1);
    const binary = file.read(15),
      view = new DataView(binary.buffer, binary.byteOffset);
    assert.equal(view.getUint32(8, true) - view.getUint32(4, true), 28);
    await executeMain(world, 851, [handle, 15, targetLog], undefined, 1);
    const target = world.displayLogs.get(targetLog);
    assert.deepEqual(target.blocks[0], [0, 1, 2, 3, 4, 5, 0xffffffff]);
    assert.equal(target.blockBase, 9);
    assert.equal(target.rowBase, 13);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 dictionary aliases and F32/word packing use the same live KCS owner', async () => {
  const entryWidths = [0, 1, 3, 2, 1, 1, 2, 2, 3];
  const entries = [
    [515, 0],
    [516, 1],
    [517, 3],
    [518, 2],
    [675, 0],
    [676, 1],
    [833, 1],
    [834, 1],
    ...[885, 894].flatMap((start) => entryWidths.map((width, index) => [start + index, width])),
  ];
  const world = await dataWorld(
    profile,
    Object.fromEntries(entries.map(([id, width]) => [`main-${id}.kcs`, mainProgram(id, width)])),
  );
  const key = (name) => (machine) => machine.writeString(name, 160);
  const call = (id, args, setup, result) => executeMain(world, id, args, setup, result);
  const create = async (id, args = []) => {
    let result;
    await call(id, args, undefined, (word) => (result = word));
    assert.notEqual(result, 0);
    return result;
  };
  try {
    const raw = 0xff812345,
      quiet = 0xffc12345,
      heap = world.runtime.imageDataBuffers.process;
    for (const start of [885, 894]) {
      const expected = start === 885 ? quiet : raw,
        first = await create(start),
        restored = await create(675),
        source = await create(515);
      await call(start + 5, [0], undefined, 0);
      await call(start + 5, [first], undefined, 4);
      await call(start + 2, [first, 160, 7], key('A'));
      await call(start + 2, [first, 160, raw], key('A'));
      await call(start + 3, [first, 160], key('A'), expected);
      await call(start + 3, [first, 160], key('Absent'), 0);
      await call(517, [source, 160, raw], key('A'));
      await call(517, [source, 160, 0x80000000], key('猫'));
      await call(518, [source, 160], key('A'), raw);
      await call(start + 5, [source], undefined, 20);

      const pointer = await create(833, [20]);
      heap.write(pointer, new Uint8Array(20).fill(0xa7));
      await call(start + 6, [source, pointer]);
      assert.deepEqual(
        [...heap.read(pointer, 20)],
        [
          2,
          0,
          0,
          0,
          65,
          0,
          0xa7,
          0xa7,
          0x45,
          0x23,
          (expected >>> 16) & 255,
          255,
          0x94,
          0x4c,
          0,
          0xa7,
          0,
          0,
          0,
          0x80,
        ],
      );
      // Force a signaling NaN in the caller's raw heap to test the importer independently.
      heap.store(pointer + 8, raw);
      await call(517, [restored, 160, 5], key('猫'));
      await call(start + 7, [restored, pointer]);
      await call(start + 3, [restored, 160], key('A'), expected);
      await call(start + 3, [restored, 160], key('猫'), 5);
      const machine = await call(
        start + 8,
        [restored, 1, 192],
        (m) => m.bytes(192, 6).fill(0xa7),
        1,
      );
      assert.deepEqual([...machine.bytes(192, 6)], [0x94, 0x4c, 0, 0xa7, 0xa7, 0xa7]);
      const miss = await call(start + 8, [restored, -1, 192], (m) => m.bytes(192, 6).fill(0xa7), 0);
      assert.deepEqual([...miss.bytes(192, 6)], new Array(6).fill(0xa7));

      await call(start + 4, [first]);
      await call(start + 5, [first], undefined, 4);
      await call(676, [first]);
      await call(start + 1, [restored]);
      await call(516, [source]);
      await call(834, [pointer]);
      for (const handle of [first, source, restored])
        assert.throws(() => world.runtime.handles.get(handle, 'dictionary'), /released/);
    }
    assert.equal(heap.allocations.size, 0);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 scalar calls use the original integer RNG, weekday and signed words', async () => {
  const world = await dataWorld(profile, {
    'main-33.kcs': mainProgram(33, 0),
    'main-786.kcs': mainProgram(786, 3),
    'main-874.kcs': mainProgram(874, 2),
    'main-875.kcs': mainProgram(875, 3),
  });
  try {
    world.random.integer.seed(0x1234abcd);
    const realStream = world.random.real.snapshot();
    const initial = [3804888993, 3299738303, 2206553905, 1412884278, 3143776126, 1571473921];
    for (const expected of initial) await executeMain(world, 33, [], undefined, expected);
    assert.deepEqual(world.random.real.snapshot(), realStream);
    for (const [args, expected] of [
      [[2024, 2, 29], 4],
      [[2024, -3, 40], 2],
      [[-2147483648, 1, 1], 0xfffffffc],
      [[2147483647, 2147483647, 0], 0xfffffffd],
    ])
      await executeMain(world, 786, args, undefined, expected);
    await executeMain(world, 874, [0xabcd8000, 0xcdefffff], undefined, 0xffff8000);
    const memory = await executeMain(world, 875, [0xffff8000, 160, 168], (machine) => {
      machine.store(164, 0xa7a7a7a7);
    });
    assert.deepEqual(
      [memory.load(160), memory.load(164), memory.load(168)],
      [0xffff8000, 0xa7a7a7a7, 0xffffffff],
    );
    const alias = await executeMain(world, 875, [0x00018000, 160, 160]);
    assert.equal(alias.load(160), 1);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS narrow desktop calls use the clipboard boundary and blocking message box', async () => {
  const world = await dataWorld(profile, {
    'main-10.kcs': mainProgram(10, 1),
    'main-445.kcs': mainProgram(445, 1),
  });
  const calls = [];
  let opens = true;
  world.runtime.services.nativeClipboard = {
    open(owner) {
      calls.push(['open', owner]);
      return opens;
    },
    empty() {
      calls.push(['empty']);
      return true;
    },
    write(text) {
      calls.push(['write', text]);
      return true;
    },
    close() {
      calls.push(['close']);
      return true;
    },
  };
  const shown = Promise.withResolvers();
  const acknowledge = Promise.withResolvers();
  world.host.nativeWindowAction = (action) => {
    shown.resolve(action);
    return acknowledge.promise;
  };
  const messageAt = (text) => (machine) => machine.writeString(text, 160);
  try {
    await executeMain(world, 10, [160], messageAt('猫\\n犬'));
    assert.deepEqual(calls.splice(0), [['open', 1], ['empty'], ['write', '猫\r\n犬'], ['close']]);
    opens = false;
    await executeMain(world, 10, [160], messageAt('本文'));
    assert.deepEqual(calls.splice(0), [['open', 1]]);
    const pending = executeMain(world, 445, [160], messageAt('原版の本文'));
    const request = await Promise.race([
      shown.promise,
      pending.then(() => {
        throw new Error('KCS returned before showing its message box');
      }),
    ]);
    assert.deepEqual(request, {
      type: 'script-message-box',
      caption: 'system error',
      message: '原版の本文',
    });
    acknowledge.resolve(1);
    await pending;
  } finally {
    acknowledge.resolve(0);
    await world.close();
  }
});

test('2.6.1.63 KCS loads an ordinary MPEG Plane and borrows its registered movie', async (t) => {
  const source = Uint8Array.of(0, 0, 1, 0xba, 0x21, 0, 1),
    world = await dataWorld(profile, {
      'main-701.kcs': mainProgram(701, 2),
      'main-702.kcs': mainProgram(702, 1),
      'movie/試験.mpg': source,
    });
  t.after(() => world.close({ flushFiles: false }));
  world.game.nativeResources = {
    entries: [{ name: 'movie', directory: 'movie', extension: 'mpg' }],
  };
  const plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: 21 }),
    owner = world.graphics.get(plane),
    calls = [],
    rgba = Uint8Array.of(37, 51, 67, 83, 101, 159, 181, 193);
  let ready = false;
  world.host.nativeMovie = (name, id) => ({
    open(filename, input) {
      assert.equal(filename, name);
      assert.deepEqual(input.bytes, source);
      calls.push(['open', filename, id]);
      return ready;
    },
    close: () => calls.push(['close']),
    configure() {},
    metadata: () => ({ width: 2, height: 1, duration: 200n, alpha: false }),
    frameStamp: () => 11,
    decodedFrame: () => ({ width: 2, height: 1, rgba }),
  });
  assert.equal(mapABIMessage(profile, 'planeMovie', 'raw', 43), 41);
  assert.equal(mapABIMessage(profile, 'planeMovie', 'raw', 87), 84);
  assert.equal(mapABIMessage(profile, 'planeMovie', 'canonical', 41), 43);
  assert.equal(mapABIMessage(profile, 'planeMovie', 'canonical', 84), 87);
  assert.throws(
    () => mapABIMessage(profile, 'planeMovie', 'canonical', 82),
    /Unreviewed ABI message/,
  );
  const load = (name) => executeMain(world, 701, [21, 256], (m) => m.writeString(name, 256)),
    borrow = (id, result) => executeMain(world, 702, [id], undefined, result);
  await executeMain(world, 701, [0, 0xffffffff]);
  await load('試験');
  await borrow(21, 0);
  assert.deepEqual(calls, []);
  world.graphics.createLogicalDevice();
  owner.state.vramType = 2;
  await load('試験');
  await borrow(21, 0);
  assert.deepEqual(calls, []);
  owner.state.vramType = 1;
  await load('試験');
  await borrow(21, 0);
  assert.deepEqual(calls.splice(0), [['open', 'movie/試験.mpg', plane], ['close']]);
  await assert.rejects(load('unknown.avi'), /Unreviewed media type/);

  ready = true;
  await load('試験');
  const graph = owner.graph,
    { handle } = graph.movie,
    record = world.movies.get(handle),
    frame = await world.planeMovies.retainedFrame(graph.movie);
  assert.equal(record.owner, plane);
  assert.deepEqual(
    [graph.type, graph.x, graph.y, graph.z, graph.width, graph.height],
    [3, 0, 0, 0, 2, 1],
  );
  assert.deepEqual(frame.rgba, Uint8ClampedArray.of(37, 51, 67, 255, 101, 159, 181, 255));
  await borrow(21, handle);
  await borrow(0, 0);
  await borrow(0xf1234567, 0);
  owner.state.vramType = 2;
  await load('試験');
  await borrow(21, handle);
  assert.equal(owner.graph, graph);
  await world.objects.release(plane);
  await borrow(21, 0);
  assert.equal(world.runtime.handles.records.has(handle), false);
  assert.equal(world.runtime.handles.records.has(record.bitmap), false);
  assert.deepEqual(calls, [['open', 'movie/試験.mpg', plane], ['close']]);
});

test('2.6.1.63 KCS rotates, translates and scales the original SSE2 matrix words', async (t) => {
  const world = await dataWorld(profile, {
    'main-204.kcs': mainProgram(204, 4),
    'main-205.kcs': mainProgram(205, 4),
    'main-206.kcs': mainProgram(206, 4),
  });
  t.after(() => world.close({ flushFiles: false }));
  const matrix = [
    1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
  ].map(floatBits);
  const angles = [0x3fa80000, 0xbeb6c8b4, 0x3db851de],
    marker = 0x713e8a2e,
    destination = 160,
    prepare = (m) => {
      m.store(destination - 4, marker);
      matrix.forEach((word, i) => m.store(destination + i * 4, word));
      m.store(destination + 64, marker + 2);
    },
    output = (m) => matrix.map((_, i) => m.load(destination + i * 4));
  const rotated = await executeMain(world, 204, [destination, ...angles], prepare);
  assert.deepEqual(
    output(rotated),
    [
      0x3f757ca0, 0xbeab60b3, 0x3f3d4167, 0, 0xbe977cd2, 0x3eb03e1f, 0x3eb2e6fd, 0, 0x3e73ddfc,
      0xbfd1b66f, 0x3f984625, 0, 0x4198305f, 0x4022e479, 0xc0033162, 0x3f800000,
    ],
  );
  assert.equal(rotated.load(destination - 4), marker);
  assert.equal(rotated.load(destination + 64), marker + 2);
  const current = new DataView(world.calculations.matrix.buffer);
  matrix.forEach((word, i) => current.setUint32(i * 4, word, true));
  await executeMain(world, 205, [0xffffffff, ...angles]);
  assert.deepEqual(
    matrix.map((_, i) => current.getUint32(i * 4, true)).slice(12),
    [0x41948000, 0xc107b646, 0xc03a3d71, 0x3f800000],
  );
  const scaled = await executeMain(world, 206, [destination, 1, 0x80000001, 3], prepare);
  assert.deepEqual(
    output(scaled),
    [1, 0, 2, 0, 0, 0, 0x80000001, 0, 0, 0x80000001, 6, 0, 0x11, 8, 0x80000009, 0x3f800000],
  );
  assert.equal(scaled.load(destination - 4), marker);
  assert.equal(scaled.load(destination + 64), marker + 2);
});

test('2.6.1.63 Main201 updates a running Raster without replacing its graph or phase', async (t) => {
  const world = await dataWorld(profile, { 'main-201.kcs': mainProgram(201, 3) });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    plane = await world.objects.create({ kind: 2, parent }),
    raster = await world.objects.create({ kind: 18, parent }),
    hydro = await world.objects.create({ kind: 25, parent }),
    foreign = await world.objects.create({ kind: 6, parent }),
    graph = world.nativeTaskID(plane),
    area = world.areaEffects.tasks.get(raster),
    initial = [graph, 0x80000002, floatBits(3.25), floatBits(8.5), floatBits(14)];
  await world.sendEngine(plane, parent, 41, 0, 0, {
    payload: new NativeGraphicsPacket([...[0, 0, 0, 24, 18, 0, 0].map(floatBits), 0xffffffff]),
  });
  await world.sendEngine(raster, parent, 263, 0, 0, {
    payload: new NativeGraphicsPacket(initial),
  });
  await world.sendEngine(raster, parent, 257);
  await world.tick();
  const renderGraph = world.graphics.tasks.get(plane).graph,
    before = area.snapshot(),
    pointer = 160,
    words = [0x1875abe2, 1, floatBits(7.125), floatBits(3.75), floatBits(35.625)],
    update = (owner, selector, address, packet) =>
      executeMain(world, 201, [world.nativeTaskID(owner), selector, address], (machine) => {
        packet?.forEach((word, i) => machine.store(address + i * 4, word));
      });
  assert.equal(renderGraph.vertexEffectID, raster);
  const caller = await update(raster, 0, pointer, words);
  assert.deepEqual(
    words.map((_, i) => caller.load(pointer + i * 4)),
    words,
  );
  assert.deepEqual(area.state.params, [...initial.slice(0, 2), ...words.slice(2)]);
  assert.deepEqual(
    [
      area.state.geometry.graph,
      area.state.geometry.mode,
      area.state.geometry.converted,
      area.state.geometry.amplitude,
    ],
    [graph, 2, true, 7.125],
  );
  for (const field of ['start', 'lastClock', 'rasterElapsed', 'active'])
    assert.equal(area.state[field], before.state[field]);
  assert.equal(renderGraph.vertexEffectID, raster);
  const updated = area.snapshot();
  await update(raster, 0x80002000, 0xffffffff);
  await update(hydro, 0, 0x7eeeeeb2);
  await update(foreign, 0, 0xffffffff);
  assert.deepEqual(area.snapshot(), updated);
  await assert.rejects(
    executeMain(world, 201, [0x6eeeabce, 0, 0xffffffff]),
    /Area effect query did not write/,
  );
  await assert.rejects(
    update(raster, 0, 0xffffffff),
    /Area geometry initializer has no translated packet/,
  );
  assert.deepEqual(area.snapshot(), updated);
});

test('2.6.1.63 KCS reads and merges the original owned bitmap fields', async () => {
  const world = await dataWorld(profile, {
    'main-119.kcs': mainProgram(119, 3),
    'main-536.kcs': mainProgram(536, 7),
    'main-537.kcs': mainProgram(537, 2),
  });
  try {
    const { images } = world.graphics,
      source = images.create(13, 7, world.main.id),
      target = images.create(2, 3, world.main.id),
      attribute = { id: 7, rect: [10, -20, 30, -40], color: 0xff800123 };
    images.get(source).state.attributes = [attribute];
    images.get(target).state.attributes = [
      { id: 7, rect: [1, 2, 3, 4], color: 0x70 },
      { id: 4, rect: [5, 6, 7, 8], color: 0x71 },
    ];
    const size = await executeMain(world, 119, [source, 176, 180]);
    assert.deepEqual([size.load(176), size.load(180)], [13, 7]);
    const alias = await executeMain(world, 119, [source, 176, 176]);
    assert.equal(alias.load(176), 7);
    const empty = await executeMain(world, 119, [0, 176, 180], (m) => m.bytes(176, 8).fill(0xa7));
    assert.deepEqual([empty.load(176), empty.load(180)], [0, 0]);

    await executeMain(world, 537, [target, source], undefined, 1);
    assert.deepEqual(
      images.get(target).state.attributes.map(({ id }) => id),
      [4, 7],
    );
    assert.notStrictEqual(images.get(target).state.attributes[1], attribute);
    const read = (id, expected) =>
      executeMain(
        world,
        536,
        [target, id, 160, 164, 168, 172, 176],
        (m) => m.bytes(160, 24).fill(0xa7),
        expected,
      );
    const found = await read(0x10007, 1);
    assert.deepEqual(
      [160, 164, 168, 172, 176, 180].map((at) => found.load(at)),
      [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123, 0xa7a7a7a7],
    );
    const absent = await read(8, 0);
    assert.deepEqual([...absent.bytes(160, 24)], new Array(24).fill(0xa7));
    await executeMain(world, 537, [target, 0], undefined, 0);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS routes cursor, Top and exit words through the true local owners', async () => {
  const world = await dataWorld(profile, {
    'main-149.kcs': mainProgram(149, 2),
    'main-150.kcs': mainProgram(150, 3),
    'main-286.kcs': mainProgram(286, 0),
    'main-577.kcs': mainProgram(577, 1),
    'main-651.kcs': mainProgram(651, 1),
  });
  try {
    const { input } = world,
      main = world.objects.objects.get(world.main.id),
      top = world.objects.objects.get(world.root);
    input.pointer(-17, 35);
    const measured = await executeMain(world, 149, [168, 176], (m) => m.store(172, 0x73));
    assert.deepEqual(
      [measured.load(168) | 0, measured.load(172), measured.load(176)],
      [-17, 0x73, 35],
    );
    const region = input.register({ owner: world.main.id, bounds: [0, 0, 10, 20] });
    region.active = 0xa72;
    input.previousX = 4;
    input.previousY = 5;
    input.forceCursor = false;
    await executeMain(world, 286, []);
    assert.deepEqual(
      [region.active, input.previousX, input.previousY, input.forceCursor],
      [0, -1, -1, true],
    );

    const warpPolicy = world.configuration.blocks[2];
    new DataView(warpPolicy.buffer, warpPolicy.byteOffset, warpPolicy.byteLength).setUint32(
      12,
      1,
      true,
    );
    input.foreground = true;
    await executeMain(world, 150, [0x81230009, 0xfedc0007, 0x12345678]);
    assert.deepEqual([input.warp.x, input.warp.y, input.warp.remaining], [9, 7, 0x12345678]);
    const retained = { ...input.warp };
    await executeMain(world, 150, [0xffff, 0xffff, 1]);
    assert.deepEqual(input.warp, retained);
    input.foreground = false;
    await executeMain(world, 150, [8, 6, 2]);
    assert.deepEqual(input.warp, retained);

    await executeMain(world, 577, [0xfefe8100]);
    assert.equal(top.implementation.field, 0xfefe8100);
    main.exitCode = 47;
    await executeMain(world, 651, [main.nativeID]);
    assert.equal(main.exitCode, -1);
  } finally {
    await world.close();
  }
});
