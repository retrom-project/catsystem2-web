// SPDX-License-Identifier: MPL-2.0
import { screenOracleWorld } from './screen-effects-fixture.mjs';
import { NativeAreaEffects } from '../../oracle/area-effect-original.mjs';
import { NativeAreaEffectCommands } from '../../oracle/area-effect-commands-original.mjs';
export async function areaOracleWorld(fixture) {
  const oracle = await screenOracleWorld(fixture),
    world = oracle.world;
  world.registerNativeFeature('area-effects', (engine) => NativeAreaEffects.open(engine, world));
  for (let kind = 17; kind <= 31; kind++)
    world.objects.factories.set(kind, async (record, _objects, options) =>
      (await world.getNativeFeature('area-effects')).create(record, options),
    );
  const area = await world.getNativeFeature('area-effects'),
    commands = new NativeAreaEffectCommands(world.nativeEngine, world);
  return { ...oracle, area, commands };
}
export {
  authoredAreaBitmaps,
  recordAreaUploads,
  areaPixelParameters,
} from './area-effect-cases.mjs';
