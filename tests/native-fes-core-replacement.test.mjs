// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { findFESInitialButton } from '../src/native/fes-button-navigation.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-fes-core-replacement.json', import.meta.url)),
);
function bootstrap() {
  const initial = [];
  for (const [at, text] of [
    [256, 'seed FES'],
    [320, 'seed'],
  ]) {
    const bytes = Buffer.alloc(Math.ceil((text.length + 1) / 4) * 4);
    bytes.write(text);
    for (let atByte = 0; atByte < bytes.length; atByte += 4)
      initial.push([37, bytes.readUInt32LE(atByte)], [38, at + atByte]);
  }
  return kcsProgram([
    [37, 512],
    [43, 209, 4],
    ...initial,
    [37, 34],
    [37, [0x13, 64]],
    [37, 256],
    [43, 66, 12],
    [38, 68],
    [37, [0x13, 68]],
    [37, 320],
    [43, 447, 8],
    [37, 240],
    [43, 71, 4],
    [37, [0x13, 68]],
    [43, 448, 4],
    [37, 240],
    [43, 71, 4],
    [59],
  ]);
}
async function open(build, initialize = true) {
  const inputs = build.inputs,
    bytes = (name) => Buffer.from(inputs[name], 'base64');
  return modernParticleMessageWorld(
    build.profile,
    {
      'startup.xml': bytes('xml'),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['boot.kcs', bootstrap()],
        ['owner.kcs', bytes('owner')],
        ['controller.kcs', bytes('controller')],
      ]),
      'tables.int': kif(
        ['seed', 'first', 'second'].map((name) => [name + '.fes', Buffer.from(inputs[name])]),
      ),
      'motion.int': kif([['consumer.kcs', bytes('motionProgram')]]),
      'images.int': kif([['unused.dat', new Uint8Array(16)]]),
      'scene.int': kif([['unused.dat', new Uint8Array(16)]]),
    },
    { initialize },
  );
}
async function close(world) {
  // The original fixture closes its inner Top/FES tree before the outer
  // supplying Script. Root0 reuse must preserve that bank-provider lifetime.
  const seed = [...world.objects.objects.values()].find((record) => record.name === 'seed FES');
  if (seed) await world.objects.release(seed.id);
  await world.close({ flushFiles: false });
}
function compare(world, phase, observed) {
  const records = [...world.objects.objects.values()],
    supplier = records.find((record) => record.name === 'owner'),
    controller = records.find((record) => record.name === 'controller'),
    business = records.find((record) => record.name === 'business FES');
  assert.equal(Boolean(business), phase.businessAlive);
  assert.equal(world.motionLibrary.scripts.size, phase.cache, 'native cache lifetime');
  for (const row of phase.scripts) {
    const record = row.role === 'bank supplier' ? supplier : controller,
      task = world.runtime.scheduler.tasks.get(record?.id);
    assert(task, row.role + ' remains an actual Script consumer');
    assert.equal(task.machine.load(16), row.marker);
    assert.equal(task.machine.pc, row.pc);
    assert.equal(
      world.resolveTaskID(task.machine.load(row.role === 'bank supplier' ? 88 : 64), record.id),
      record.id,
    );
    if (row.output) assert.deepEqual([task.machine.load(96), task.machine.load(100)], row.output);
  }
  if (!phase.scripts.some((row) => row.role === 'controller')) assert.equal(controller, undefined);
  if (!phase.scripts.some((row) => row.role === 'bank supplier')) assert.equal(supplier, undefined);
  if (controller) {
    assert.equal(controller.parent, business.id);
    const task = world.runtime.scheduler.tasks.get(controller.id),
      planeID = world.resolveTaskID(task.machine.load(72), controller.id),
      plane = world.objects.objects.get(planeID);
    assert.equal(plane.parent, controller.id);
    assert.equal(world.resolveTaskID(task.machine.load(68), controller.id), business.id);
    if (phase.frame >= 3)
      assert.equal(
        new DataView(world.graphics.tasks.get(planeID).graph.kx2.buffer).getUint32(
          MOTION_ABI.color,
          true,
        ) >>> 24,
        128,
      );
  }
  if (business) {
    const implementation = business.implementation,
      planes = records.filter((record) => record.parent === business.id && record.kind === 2);
    assert.equal(implementation.retainedPlayers.size, 0, 'unborrowed old Core metadata reclaimed');
    if (phase.frame === 1) observed.oldPlane = planes[0].id;
    if (phase.frame === 2)
      assert.equal(planes[0].id, observed.oldPlane, 'replacement does not release the task FIFO');
    if (phase.frame === 3) {
      assert.equal(planes.length, 2);
      assert.equal(world.objects.objects.get(observed.oldPlane).destroyRequested, true);
      observed.newPlane = planes.find((record) => record.id !== observed.oldPlane).id;
    }
    if (phase.frame === 4) {
      assert(!world.objects.objects.has(observed.oldPlane));
      assert.equal(planes[0].id, observed.newPlane);
    }
    if (phase.frame >= 2)
      assert.equal(implementation.player.root.runtime.resources.entries.length, 2);
  }
  if (phase.frame >= 5) {
    assert(!world.objects.objects.has(observed.oldPlane));
    assert(!world.objects.objects.has(observed.newPlane));
  }
}
for (const build of golden.builds)
  for (const coldAt of [null, 'initialized', 0, 1, 2, 3, 4, 5, 6])
    test(`SDK${build.version} Core replacement actual Script/FIFO/cache/Root retirement ${coldAt ?? 'normal'}`, async () => {
      let world = await open(build),
        caller = await world.spawnScript('boot.kcs', { initialExecute: false });
      const observed = {};
      const cold = async () => {
        const snapshot = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        const id = caller.id;
        await close(world);
        world = await open(build, false);
        await world.restore(snapshot);
        caller = world.runtime.scheduler.tasks.get(id);
      };
      try {
        caller.machine.store(64, world.nativeTaskID(world.root));
        await world.sendEngine(caller.id, caller.id, 162, 0, 0);
        await world.sendEngine(world.main.id, world.main.id, 162, 0, 0);
        await world.runtime.scheduler.execute(caller);
        if (coldAt === 'initialized') await cold();
        await world.objects.tick(0);
        await world.runtime.scheduler.send(caller.id, [240, 0, 0, 0]);
        for (const phase of build.phases) {
          if (phase.frame) await world.objects.tick(phase.frame);
          compare(world, phase, observed);
          if (phase.frame === coldAt) {
            await cold();
            compare(world, phase, observed);
          }
        }
      } finally {
        await close(world);
      }
    });

// Current ownership counterexamples use the already implemented typed BUTTON
// hit consumer, with TYPE0: they prove no GDI glyph, new native row or GPU pixel.
for (const build of golden.builds)
  for (const coldAt of ['normal', 'pending', 'retained'])
    test(`SDK${build.version} Core-owned BUTTON initial identity survives task FIFO handoff ${coldAt}`, async () => {
      const source = (x) =>
          new TextEncoder().encode(
            `#DEFINE\nBUTTON b\n#OBJECT SIZE POS TYPE DISP ENABLE\nb 4,3 ${x},10 0 1 1\n#START\nnext IDLE\n#IDLE\n`,
          ),
        files = {
          'screen.fes': source(10),
          'other.fes': source(40),
          'empty.fes': new TextEncoder().encode('#START\nnext IDLE\n#IDLE\n'),
        };
      let world = await defaultFESWorld(build.profile, files),
        { id, task } = await loadDefaultFES(world);
      const first = task.player.root.collection.lookup('b'),
        firstGeneration = task.player.nativeCoreGeneration;
      try {
        await task.initialize(world.main.context.variableBank);
        if (coldAt === 'pending') {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await defaultFESWorld(build.profile, files, { initialize: false });
          await world.restore(state);
          task = world.objects.objects.get(id).implementation;
          assert.equal(task.player.root, null);
          assert(task.pendingPlayer);
        }
        await task.loadSource('other');
        const next = task.player.root.collection.lookup('b');
        assert.equal(first.handle, next.handle, 'independent Core graphs reuse local handles');
        assert.notEqual(first, next);
        assert.equal(task.retainedPlayers.size, 1);
        if (coldAt !== 'pending')
          assert.equal(
            task.retainedPlayers.get(firstGeneration).root.collection.lookup('b'),
            first,
          );
        if (coldAt === 'retained') {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await defaultFESWorld(build.profile, files, { initialize: false });
          await world.restore(state);
          task = world.objects.objects.get(id).implementation;
        }
        const instance = task.player.root,
          entries = instance.runtime.resources.entries,
          hit = await findFESInitialButton(instance, world, Int32Array.of(10, 10), () => true);
        assert.deepEqual(hit, { nameBytes: Uint8Array.of(98), index: 0 });
        assert.notEqual(entries[0].initialCore, entries[1].initialCore);
        assert.equal(instance.player.nativeInitialObject(entries[0]).object.x, 10);
        assert.equal(instance.player.nativeInitialObject(entries[1]).object.x, 40);
        await task.initialize(world.main.context.variableBank);
        await task.loadSource('empty');
        assert.equal(
          task.retainedPlayers.size,
          2,
          'only two live initial borrowers retain old Core metadata',
        );
        await task.syncObjects();
        assert.equal(task.player.root.runtime.resources.entries.length, 0);
        assert.equal(task.retainedPlayers.size, 0, 'last FIFO borrower releases its old Core');
        const bank = world.runtime.variableBank(world.main);
        assert.equal(
          [...bank.contexts.keys()].filter((key) => String(key).startsWith('fes:')).length,
          1,
        );
        await world.objects.release(id);
        assert.equal(
          [...bank.contexts.keys()].filter((key) => String(key).startsWith('fes:')).length,
          0,
        );
      } finally {
        await world.close({ flushFiles: false });
      }
    });

for (const build of golden.builds) {
  test(`SDK${build.version} replacement preserves the other FES owner through independent cold and final Root cleanup`, async () => {
    const source = (color) =>
        new TextEncoder().encode(
          `#DEFINE\nCPLANE p\n#OBJECT SIZE COLOR DISP\np 2,2 ${color} 1\n#START\nnext IDLE\n#IDLE\n`,
        ),
      files = { 'screen.fes': source('0xff336699'), 'other.fes': source('0xff993366') };
    let world = await defaultFESWorld(build.profile, files);
    try {
      const a = await loadDefaultFES(world),
        b = await loadDefaultFES(world);
      await a.task.syncObjects();
      await b.task.syncObjects();
      const bPlane = b.task.player.root.collection.lookup('p').nativeTaskID;
      await a.task.initialize(world.main.context.variableBank);
      await a.task.loadSource('other');
      await a.task.syncObjects();
      assert.equal(b.task.player.root.collection.lookup('p').nativeTaskID, bPlane);
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await defaultFESWorld(build.profile, files, { initialize: false });
      await world.restore(state);
      await world.objects.release(a.id);
      assert(world.objects.objects.has(b.id));
      assert(world.objects.objects.has(bPlane));
      await world.objects.tick(1);
      await world.close({ flushFiles: false });
      assert.equal(world.objects.objects.size, 0);
      assert.equal(world.runtime.handles.records.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`SDK${build.version} current Core checkpoint requires coherent task child and borrowed Core owners`, async () => {
    const source = new TextEncoder().encode(
        '#DEFINE\nBUTTON b\n#OBJECT SIZE TYPE\nb 2,2 0\n#START\nnext IDLE\n#IDLE\n',
      ),
      files = { 'screen.fes': source },
      original = await defaultFESWorld(build.profile, files);
    let restored;
    try {
      const { task, id } = await loadDefaultFES(original);
      await task.initialize(original.main.context.variableBank);
      await task.loadSource('screen');
      // The entry still names an old Core. Dropping its owner must fail,
      // rather than resolving its local handle against the new Core.
      // Test this structural error on a fresh implementation, with all actual
      // world resources restored normally by the full checkpoint controls.
      const snapshot = await deserializeCheckpoint(await serializeCheckpoint(original.snapshot()));
      restored = await defaultFESWorld(build.profile, files, { initialize: false });
      const saved = snapshot.objects.objects.find((object) => object.id === id);
      saved.data.retainedCores = [];
      await assert.rejects(restored.restore(snapshot), /initial Core owner/);
    } finally {
      await original.close({ flushFiles: false });
      await restored?.close({ flushFiles: false });
    }
  });
}
