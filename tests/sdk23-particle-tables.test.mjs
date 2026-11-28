// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { deserializeCheckpoint, serializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-particle-tables-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
async function open(version, initialize = true) {
  const world = await modernParticleMessageWorld(
    golden.profile,
    {
      'startup.xml': bytes(golden.inputs.startup),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['p1-main.kcs', bytes(golden.inputs.mainProgram)],
      ]),
      'images.int': bytes(golden.inputs.imagesArchive),
      'ptcl.int': kif([['p1-table.kcs', bytes(golden.inputs.particlePrograms[version - 1])]]),
    },
    { initialize },
  );
  // The native device port is a host capability, not serialized task state.
  world.graphics.createLogicalDevice();
  return world;
}
const bufferNames = [
  'quads',
  'backupQuads',
  'bases',
  'positions',
  'rotations',
  'scales',
  'visibility',
];
function compare(world, caller, expected, version) {
  const id = world.resolveTaskID(caller.machine.load(40), caller.id),
    task = world.particles.get(id),
    original = expected.particle;
  assert.equal(Boolean(task), original.alive, expected.label + ' owner');
  assert.deepEqual(
    [160, 164, 168].map((at) => caller.machine.load(at)),
    expected.caller,
  );
  if (!task) return;
  const bank = task.bank,
    instance = bank.instance;
  assert.equal(instance.table, `particle-v${version}`);
  assert.equal(bank.count, original.count);
  assert.equal(Number(task.active), original.active);
  assert.equal(instance.fps, original.fps);
  assert.equal(bank.nativeAtlas.width, original.dimensions[0]);
  assert.equal(bank.nativeAtlas.height, original.dimensions[1]);
  assert(bank.nativeAtlas.pointer);
  assert.deepEqual([...new Uint32Array(instance.registers.buffer)], original.registers);
  for (const [index, name] of bufferNames.entries()) {
    const actual = instance[name];
    assert.deepEqual(
      new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength),
      bytes(original.buffers[index].bytes),
      expected.label + ' initialized ' + name,
    );
  }
  if (expected.phase >= 2) {
    assert.equal(instance.frame, original.current);
    assert.equal(instance.before, original.before, 'completed task copies current into before');
    assert.deepEqual(
      Array.from({ length: 16 }, (_, i) => instance.machine.load(64 + i * 4)),
      original.results,
    );
    assert.deepEqual(
      Array.from({ length: 32 }, (_, i) => instance.machine.load(128 + i * 4)),
      original.registerCopy,
    );
  }
}

for (const build of golden.versions) {
  for (const coldAt of [null, 0, 1, 2, 3, 4, 5]) {
    test(`SDK23 loaded Particle v${build.version} finite table bridge${coldAt === null ? '' : ` with independent cold at${coldAt}`}`, async () => {
      let world = await open(build.version),
        caller = await world.spawnScript('p1-main', { initialExecute: false });
      const calls = [],
        observed = new WeakSet(),
        observe = () => {
          const id = world.resolveTaskID(caller.machine.load(40), caller.id),
            instance = world.particles.get(id)?.bank?.instance;
          if (!instance || observed.has(instance)) return;
          observed.add(instance);
          const native = instance.native.bind(instance);
          instance.native = (id, args, machine) => {
            const reply = native(id, args, machine);
            calls.push({
              id,
              particle: instance.now,
              args: [...args],
              control: reply.control,
              resultWritten: reply.control === 1,
              ...(reply.control === 1 ? { value: reply.value } : {}),
            });
            return reply;
          };
        };
      try {
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        for (const row of build.rows) {
          await world.objects.update(caller.id, row.frame);
          compare(world, caller, row, build.version);
          observe();
          if (row.phase === coldAt) {
            const id = caller.id,
              saved = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await open(build.version, false);
            await world.restore(saved);
            caller = world.runtime.scheduler.tasks.get(id);
            compare(world, caller, row, build.version);
            observe();
          }
        }
        assert.deepEqual(
          calls,
          build.particleCalls,
          'actual loaded VM arguments/control/results per particle',
        );
        assert.equal(world.particles.host.banks.size, 0);
        assert.equal(world.particles.textures.owned.size, 0);
      } finally {
        await world.close({ flushFiles: false });
      }
    });
  }
}
