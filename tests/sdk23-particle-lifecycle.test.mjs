// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseXML } from '../src/xml.mjs';
import { deserializeCheckpoint, serializeCheckpoint } from '../src/checkpoint.mjs';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-particle-lifecycle-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64')),
  fields = ['quads', 'backupQuads', 'positions', 'bases', 'rotations', 'scales', 'visibility'];
async function open(build, initialize = true) {
  const startup = bytes(build.inputs.startup),
    world = await modernParticleMessageWorld(
      golden.profile,
      {
        ...Object.fromEntries(build.inputs.archives.map((row) => [row.name, bytes(row.bytes)])),
        'startup.xml': startup,
      },
      { initialize, startup: parseXML(new TextDecoder().decode(startup)) },
    );
  world.graphics.createLogicalDevice();
  return world;
}
async function compare(world, caller, build, row) {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => caller.machine.load(160 + i * 4)),
    row.caller,
    row.label + ' caller outputs',
  );
  const task = world.particles.get(world.resolveTaskID(caller.machine.load(40), caller.id)),
    original = row.particle;
  assert.equal(Boolean(task), original.alive);
  if (!task) return;
  const bank = task.bank,
    instance = bank.instance;
  assert.equal(Number(task.active), original.active, row.label + ' active');
  assert.equal(instance.fps, original.fps, 'actual task frame rate');
  assert.equal(instance.table, original.scriptVersion === 0x20000 ? 'particle-v2' : 'particle-v1');
  assert.equal(instance.attachPlane, original.attachment === 0xffffffff ? -1 : original.attachment);
  assert.equal(bank.alpha >= 255 ? 256 : bank.alpha, original.alpha);
  for (const [i, key] of fields.entries()) {
    const actual = instance[key];
    assert.deepEqual(
      new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength),
      bytes(original.buffers[i].bytes),
      row.label + ' ' + key,
    );
  }
  if (original.results)
    for (const [at, value] of Object.entries(original.results))
      assert.equal(instance.machine.load(Number(at)), value, row.label + ' local' + at);
  if (row.phase !== 0 && !(build.label === 'v2-restart-rebind' && row.phase === 6)) {
    assert.equal(instance.frame, original.current, row.label + ' clock');
    assert.equal(instance.before, original.before, row.label + ' completed clock');
  }
  if (row.particleDrawCount !== undefined) {
    const draws = [];
    for (const item of world.particles.drawItems())
      await item.drawGPU({
        drawGeometry(geometry, image) {
          for (const quad of geometry) draws.push({ vertices: quad.vertices, image });
        },
      });
    const expected = build.particleDraws.filter((draw) => draw.phase === row.phase);
    assert.equal(draws.length, expected.length, row.label + ' actual default draw eligibility');
    for (const [i, actual] of draws.entries()) {
      const v = actual.vertices;
      assert.deepEqual(
        [
          [v[0], v[1], v[2]],
          [v[2], v[1], v[3]],
        ],
        expected[i].triangles,
        row.label + ' complete projected triangles',
      );
      assert.deepEqual(
        [actual.image.width, actual.image.height],
        [expected[i].atlas.width, expected[i].atlas.height],
      );
      assert.deepEqual(
        actual.image.rgba,
        bytes(expected[i].atlas.rgba),
        row.label + ' bound asymmetric atlas RGBA',
      );
    }
  }
}
for (const build of golden.builds) {
  const coldPoints =
    build.label === 'v2-restart-rebind' ? [null, 0, 1, 2, 3, 4, 5, 6, 7] : [null, 1];
  for (const coldAt of coldPoints)
    test(`SDK23 ${build.label}${coldAt === null ? '' : ` with independent cold at${coldAt}`}`, async () => {
      let world = await open(build),
        caller = await world.spawnScript('p2-main', { initialExecute: false });
      const trace = [],
        observed = new WeakSet(),
        observe = () => {
          const task = world.particles.get(world.resolveTaskID(caller.machine.load(40), caller.id)),
            instance = task?.bank?.instance;
          if (!instance || observed.has(instance)) return;
          observed.add(instance);
          const native = instance.native.bind(instance);
          instance.native = (id, args, machine) => {
            const reply = native(id, args, machine),
              row = {
                table: instance.table,
                id,
                args: [...args],
                particle: instance.now,
                control: reply.control,
                outputWritten: reply.control === 1,
                ...(reply.control === 1 ? { value: reply.value } : {}),
              };
            if ([22, 23, 24, 25, 26, 30].includes(id))
              row.quadOutput = Buffer.from(machine.bytes(args[0], 112)).toString('base64');
            if ([28, 38, 48, 49].includes(id))
              row.outputWords = args.slice(id === 38 ? 1 : 0).map((at) => machine.load(at));
            trace.push(row);
            return reply;
          };
        };
      try {
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        for (const row of build.rows) {
          await world.objects.update(caller.id, row.frame);
          await compare(world, caller, build, row);
          observe();
          if (row.phase === coldAt) {
            const id = caller.id,
              snapshot = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await open(build, false);
            await world.restore(snapshot);
            caller = world.runtime.scheduler.tasks.get(id);
            assert.deepEqual(world.particles.host.random.snapshot(), snapshot.particles.random);
            await compare(world, caller, build, row);
            observe();
          }
        }
        assert.deepEqual(trace, build.particleCalls, 'real VM parameters/control/written results');
        assert.equal(world.particles.host.banks.size, 0);
        assert.equal(world.particles.textures.owned.size, 0);
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}

test('SDK23 all 95 declared Particle entries retain a bounded original caller receipt', async () => {
  const tables = JSON.parse(
      await readFile(new URL('./fixtures/sdk23-particle-tables-golden.json', import.meta.url)),
    ),
    logger = JSON.parse(
      await readFile(new URL('./fixtures/native-legacy-aux-logger-golden.json', import.meta.url)),
    ).builds.find((build) => build.version === '23'),
    abi = nativeABI(golden.profile);
  assert.equal(logger.executableSha256, golden.originalSHA256);
  for (const version of [1, 2]) {
    const table = `particle-v${version}`,
      declared = abi.tables[table].entries,
      calls = [
        ...tables.versions.find((build) => build.version === version).particleCalls,
        ...golden.builds.flatMap((build) =>
          build.particleCalls.filter((row) => row.table === table),
        ),
      ];
    assert(logger.cases.some((row) => row.table === table && row.control === 2));
    const covered = new Set([0]);
    for (const row of calls) {
      const entry = declared[row.id];
      assert.equal(entry.status, 'recovered');
      assert.equal(row.args.length, entry.signature.argumentWords);
      assert(entry.signature.controlCodes.includes(row.control));
      covered.add(row.id);
    }
    assert.equal(covered.size, version === 1 ? 44 : 51);
    assert.deepEqual(
      [...covered].sort((a, b) => a - b),
      declared.map((entry) => entry.id),
    );
  }
});
