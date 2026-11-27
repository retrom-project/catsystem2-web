// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-motion-fes-consumer-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));

async function open({
  initialize = true,
  profile = golden.profile,
  source = golden.inputs.source,
} = {}) {
  return modernParticleMessageWorld(
    profile,
    {
      'startup.xml': bytes(golden.inputs.startup),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['mot-consumer23.kcs', bytes(golden.inputs.currentProgram)],
      ]),
      'images.int': bytes(golden.inputs.supportImagesArchive),
      'motion.int': kif([['consumer.kcs', bytes(golden.inputs.motionProgram)]]),
      'fes.int': kif([['mot-consumer.fes', new TextEncoder().encode(source)]]),
    },
    { initialize },
  );
}

function holder(world) {
  const fes = [...world.objects.objects.values()].find((record) => record.kind === 34),
    instance = fes.implementation.player.root;
  return { instance, object: instance.byKey.get('holder') };
}

async function compare(world, caller, phase) {
  const { object } = holder(world),
    task = world.graphics.get(object.nativeTaskID),
    draws = [];
  for (const key of ['x', 'y', 'z', 'width', 'height', 'color', 'display'])
    assert.equal(object[key === 'display' ? 'displayValue' : key], golden.object[key], key);
  await task.drawGPU({ drawGeometry: (triangles) => draws.push(triangles) });
  assert.equal(draws.length, 1);
  const vertices = draws[0].flatMap((triangle) => triangle.vertices),
    bounds = [
      Math.min(...vertices.map((vertex) => vertex.x)),
      Math.min(...vertices.map((vertex) => vertex.y)),
      Math.max(...vertices.map((vertex) => vertex.x)),
      Math.max(...vertices.map((vertex) => vertex.y)),
    ];
  assert.deepEqual(bounds, golden.bounds);
  assert(vertices.every((vertex) => vertex.color === golden.object.color));
  assert.deepEqual(
    [caller.machine.load(96), caller.machine.load(100)],
    phase === 2 ? [7, 9] : [0, 0],
    'real callback and Main210 consume the changed CPLANE position',
  );
}

for (const coldAt of [null, 0, 1, 2]) {
  test(`SDK23 declared MOT reaches its CPLANE consumer in the start frame${coldAt === null ? '' : ' with independent cold after phase' + coldAt}`, async () => {
    let world = await open(),
      caller = await world.spawnScript('mot-consumer23', { initialExecute: false });
    try {
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      for (let phase = 0; phase < 3; phase++) {
        await world.objects.update(caller.id, 600 + phase);
        await compare(world, caller, phase);
        if (phase === coldAt) {
          const id = caller.id,
            checkpoint = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open({ initialize: false });
          await world.restore(checkpoint);
          caller = world.runtime.scheduler.tasks.get(id);
          await compare(world, caller, phase);
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

for (const [name, profile, body, position] of [
  [
    'queued react completes decode before one MOT update',
    golden.profile,
    'holder custom 7 9\nreact\nholder custom 13 15\nnext IDLE',
    [13, 15],
  ],
  ['waiting still updates its attached MOT', golden.profile, 'holder custom 7 9\nwait 2', [7, 9]],
  [
    'finished decoding applies its final attached MOT',
    golden.profile,
    'holder custom 7 9\nexit 7',
    [7, 9],
  ],
  [
    'decode exception does not run an unconditional MOT update',
    golden.profile,
    'holder custom 7 9\nnext NO_SUCH_BLOCK',
    [0, 0],
  ],
  [
    'another build retains its before-decode phase',
    'sdk-4.01-engine-2.6.1.74',
    'holder custom 7 9\nnext IDLE',
    [0, 0],
  ],
]) {
  test(name, async () => {
    const world = await open({
      profile,
      source: golden.inputs.source.replace(
        'holder custom 7 9\r\nnext IDLE',
        body.replaceAll('\n', '\r\n'),
      ),
    });
    let updates = 0;
    try {
      // An observation around the real collection driver, with ordinary loaded
      // Script/parser/MOT/graphics objects throughout the test.
      world.host.nativeFESLoaded = (_record, player) => {
        const driver = player.root.runtime.motions,
          update = driver.update.bind(driver);
        driver.update = (...args) => {
          updates++;
          return update(...args);
        };
      };
      const caller = await world.spawnScript('mot-consumer23', { initialExecute: false });
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      if (name.startsWith('decode exception'))
        await assert.rejects(world.objects.update(caller.id, 600), /NO_SUCH_BLOCK/);
      else await world.objects.update(caller.id, 600);
      const { object } = holder(world);
      assert.deepEqual([object.x, object.y], position);
      assert.equal(updates, name.startsWith('decode exception') ? 0 : 1);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
