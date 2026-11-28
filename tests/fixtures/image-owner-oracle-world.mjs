// SPDX-License-Identifier: MPL-2.0
// Original Script-owned image list evidence, separate from JS product owners.
import {
  NativeImageOwners,
  NATIVE_IMAGE_OWNER_CONTRACTS,
} from '../../oracle/image-owner-original.mjs';
import { installFESProjectionOracle } from '../../oracle/fes-projection-world.mjs';

export function installImageOwnerOracle(world) {
  installFESProjectionOracle(world);
  world.nativeFeatureFactories.set('image-owners', async (engine) => {
    for (const feature of ['engine-files', 'data-buffers', 'graphics-platform'])
      await world.getNativeFeature(feature);
    return (world.imageOwners = new NativeImageOwners(engine, world));
  });
  for (const { id } of NATIVE_IMAGE_OWNER_CONTRACTS)
    world.runtime.handlers.set(`main:${id}`, async (args, machine, task) =>
      (await world.getNativeFeature('image-owners')).apply(id, args, machine, task),
    );
  return world;
}
