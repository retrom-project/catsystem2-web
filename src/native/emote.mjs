// SPDX-License-Identifier: MPL-2.0
// M2 script state, model decoding, controllers and drawing are owned by JS.
import { nativeABI } from './abi/index.mjs';
import { M2Owner } from './emote-owner.mjs';
import { M2Task, M2PlaceholderTask } from './emote-task.mjs';
import { emoteNative, NATIVE_M2_IDS } from './emote-commands.mjs';
import { installNativeFESM2 } from './emote-fes.mjs';
export { NATIVE_M2_IDS } from './emote-commands.mjs';

export function installNativeM2(world) {
  const owner = (world.m2 = new M2Owner(world)),
    driver = nativeABI(world.profile).plugins.emoteDriver;
  if (driver === 'native') {
    world.objects.register(54, (record) => new M2Task(owner, record));
    for (const id of NATIVE_M2_IDS)
      world.runtime.register('main', id, (args, machine, task) =>
        emoteNative(owner, id, args, machine, task),
      );
  } else if (driver === 'placeholder') {
    world.fesConfiguration.m2 = null;
    world.objects.register(54, (record) => {
      const task = new M2PlaceholderTask(world.graphics, record);
      world.graphics.tasks.set(record.id, task);
      return task;
    });
  } else throw new Error('M2 factory requires a reviewed ABI');
  installNativeFESM2(world);
}
