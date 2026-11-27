// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-fes-inherited.json', import.meta.url)),
);
const filesFor = (kind) => {
  const part = golden[kind];
  return {
    'case.kcs': kcsProgram([[43, 65, 0], [59]]),
    'inherited-parent.kcs': kcsProgram(part.parentInstructions),
    [kind === 'copy' ? 'inherited-child.kcs' : 'inherited-clean.kcs']: kcsProgram(
      part.childInstructions,
    ),
    ...Object.fromEntries(
      Object.entries(part.sources).map(([name, text]) => [name, new TextEncoder().encode(text)]),
    ),
  };
};
async function open(kind) {
  const world = await dataWorld(golden.profile, filesFor(kind));
  await world.runtime.native('main', 209, [512], world.main.machine, world.main);
  world.main.machine.writeString('inherited-parent.kcs', 800);
  await world.runtime.native(
    'main',
    143,
    [world.nativeTaskID(world.main.id), 800, 0],
    world.main.machine,
    world.main,
  );
  return world;
}
async function cold(world, kind) {
  const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
  await world.close({ flushFiles: false });
  const fresh = await dataWorld(golden.profile, filesFor(kind), { initialize: false });
  await fresh.restore(state);
  return fresh;
}
function compareVM(machine, expected, label) {
  for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], expected[key], label);
}
function childID(world) {
  return world.resolveTaskID(world.main.machine.load(36), world.main.id);
}
for (const coldAt of [null, 2, 4, 7]) {
  test(`SDK23 inherited child VM copies FES words and continues${coldAt === null ? '' : ` across independent cold after ${coldAt}`}`, async () => {
    let world = await open('copy');
    try {
      for (let i = 0; i < 12; i++) {
        await world.objects.update(world.main.id, 300 + i);
        const id = childID(world),
          child = world.runtime.scheduler.tasks.get(id),
          bank = world.runtime.variableBank(world.main),
          expected = golden.copy.rows[i];
        if (expected) {
          compareVM(world.main.machine, expected.parentVM, expected.label);
          assert.equal(bank.get(41), expected.continuation, expected.label);
          if (expected.child) {
            assert(child);
            compareVM(child.machine, expected.child.vm, expected.label);
            assert.deepEqual(
              Array.from({ length: 16 }, (_, j) => child.machine.load(96 + j * 4)),
              expected.child.outputs,
              expected.label,
            );
          }
        }
        assert.equal(
          bank.context(world.main.id),
          null,
          'supplier owns its bank without an inherited private context',
        );
        if (i <= 10) {
          assert(child, 'child remains loaded through its close-request frame');
          assert.equal(child.context.variableBank, world.main.context.variableBank);
          assert(bank.context(id), 'Main143 registers the actual inherited Script context');
          if (i >= 2) {
            assert.equal(bank.context(id).words[0], 0xfedcba98);
            assert.equal(bank.context(id).words[511], 0x1234abcd);
            assert.equal(
              bank.context(id).words[1],
              0,
              'later FES callback does not alias saved child words',
            );
            assert.equal(bank.context(id).names.size, 0, 'word copy excludes named storage');
          }
        } else {
          assert.equal(child, undefined);
          assert.equal(
            bank.context(id),
            null,
            'normal child retirement unregisters its private context',
          );
        }
        const fes = [...world.objects.objects.values()].filter((r) => r.kind === 34);
        assert.equal(
          fes.length,
          [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0][i],
          `normal live route order includes same-frame later-FES retirement at ${i}`,
        );
        if (i === 7)
          assert.equal(
            bank.contexts.size,
            1,
            'only inherited child context remains after first FES',
          );
        if (i === 8) {
          const owner = fes[0],
            key = owner.implementation.variableContextKey();
          assert.equal(owner.context.variableBank, child.context.variableBank);
          assert.equal(
            bank.context(key).words[0],
            41,
            'new FES lifetime has its own fresh private words',
          );
        }
        if (i >= 10)
          assert.equal(bank.get(41), 0x23410002, 'child executes after new FES has retired');
        if (i === coldAt) world = await cold(world, 'copy');
      }
      assert.equal(world.runtime.variableBank(world.main).contexts.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
for (const coldAt of [null, 2]) {
  test(`SDK23 normal later-created FES cleanup matches native daughter${coldAt === null ? '' : ' with independent cold'}`, async () => {
    let world = await open('cleanup');
    try {
      for (const [i, row] of golden.cleanup.rows.entries()) {
        await world.objects.update(world.main.id, row.frame);
        const bank = world.runtime.variableBank(world.main);
        compareVM(world.main.machine, row.parentVM, row.label);
        assert.equal(world.main.machine.load(96), row.output, row.label);
        assert.equal(bank.get(41), row.continuation, row.label);
        if (row.child) {
          const child = world.runtime.scheduler.tasks.get(childID(world));
          assert(child);
          compareVM(child.machine, row.child.vm, row.label);
        }
        if (i === 2)
          assert.equal(
            [...world.objects.objects.values()].filter((r) => r.kind === 34).length,
            0,
            'FES retires later in the same real parent walk',
          );
        if (i === coldAt) world = await cold(world, 'cleanup');
      }
      assert.equal(world.runtime.variableBank(world.main).contexts.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('SDK23 Script subtree and full Top preserve their different null-route sweep boundaries', async () => {
  for (const subtree of [true, false]) {
    let world = await open('copy'),
      firstID;
    const initialTopFrame = world.engineMessages.closestTop(world.main.id).lastFrame;
    try {
      for (let i = 0; i < 12; i++) {
        if (subtree) await world.objects.update(world.main.id, 300 + i);
        else await world.objects.tick(300 + i);
        const top = world.engineMessages.closestTop(world.main.id);
        if (i === 0) firstID = world.main.machine.load(32);
        if (i === 7) {
          assert.equal(
            world.engineMessages.lookupPath(top, firstID).found,
            subtree,
            'only a Top update prunes its null routes',
          );
          assert.equal(
            top.lastFrame,
            subtree ? initialTopFrame : 307,
            'selected child update never advances an ancestor',
          );
          world = await cold(world, 'copy');
          assert.equal(
            world.engineMessages.lookupPath(world.engineMessages.closestTop(world.main.id), firstID)
              .found,
            subtree,
            'cold preserves present-null versus absent',
          );
        }
        if (i === 8) {
          const fes = [...world.objects.objects.values()].find((r) => r.kind === 34);
          if (subtree)
            assert(
              fes.nativeID > world.main.machine.load(36),
              'reserved null IDs keep the new FES after its child caller',
            );
          else
            assert.equal(
              fes.nativeID,
              firstID,
              'full Top cleanup permits the lowest free native key',
            );
        }
        if (i === 9)
          assert.equal(
            [...world.objects.objects.values()].filter((r) => r.kind === 34).length,
            subtree ? 0 : 1,
            'close timing follows actual native key order',
          );
      }
      assert.equal(world.runtime.variableBank(world.main).contexts.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  }
});
