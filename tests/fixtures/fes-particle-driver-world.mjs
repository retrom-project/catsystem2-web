// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { authoredPPIRegistry } from './ppi-js-fixture.mjs';
import { nativeParticleFixture } from './ppi-native-fixture.mjs';
import { kcsProgram } from '../helpers.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { FESParticleDriver, initializeFESParticle } from '../../src/native/fes-particle-driver.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
export async function particleWorld(profile, { initialize = true } = {}) {
  const world = await dataWorld(
    profile,
    {
      'ptclpi/probe.ppi': nativeParticleFixture(),
      'ptcl/probe.kcs': kcsProgram([[59]]),
    },
    { initialize: false },
  );
  world.game.width = world.graphics.stage.width = 8;
  world.game.height = world.graphics.stage.height = 8;
  world.particles.host.registry = authoredPPIRegistry(['probe']);
  world.objects.register(1002, (record) => {
    const base = world.base(record),
      instance = { runtimeID: record.id, objects: [] },
      driver = new FESParticleDriver(world),
      api = {
        instance,
        driver,
        message: (words, context) => base.message(words, context),
        async tick() {},
        snapshot: () => ({ objects: structuredClone(instance.objects) }),
        restore(state) {
          instance.objects = structuredClone(state.objects);
        },
      };
    return api;
  });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function setupParticle(world) {
  const ownerID = await world.objects.create({
      kind: 1002,
      parent: world.main.id,
      nativeID: 417,
      name: 'FES particle owner',
    }),
    api = world.objects.objects.get(ownerID).implementation,
    object = initializeFESParticle({
      nativeType: 23,
      key: 'emitter:0',
      handle: 0x1001,
      deleted: false,
    });
  api.instance.objects.push(object);
  const sync = (options) => api.driver.update(api.instance, object, options),
    task = () => world.particles.get(object.particleResource.taskID);
  return { ownerID, api, object, sync, task };
}
export async function attachPlane(world, parent) {
  const id = await world.objects.create({ kind: 2, parent, nativeID: 991 }),
    packet = new NativeGraphicsPacket();
  [0, 0, 0, floatBits(8), floatBits(6), 32, 1, 0xffffffff].forEach((v, i) =>
    packet.store(i * 4, v),
  );
  await world.graphics.send(id, parent, 42, 0, 0, packet);
  return { nativeType: 3, nativeTaskID: id };
}
