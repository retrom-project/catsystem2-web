// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'rebellions-jp-engine-2.6.1.63';

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
