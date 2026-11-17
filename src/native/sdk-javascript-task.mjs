// SPDX-License-Identifier: MPL-2.0
import { originalOwner, originalFeature } from './original-adapter.mjs';
import { nativeABI } from './abi/index.mjs';
import { NormalSDKJavaScriptTask, normalSDKJavaScriptCommand } from './sdk-javascript-normal.mjs';
const COMMANDS = new Set([0x3ce, 0x3cf, 0x3d0, 0x3ee]);
export function installNativeSDKJavaScriptTasks(world) {
  if (!nativeABI(world.profile).capabilities.embeddedJavaScript) return;
  world.objects.register(55, async (record, _objects, options) => {
    if (originalOwner(world))
      return originalFeature(world, 'sdk-javascript-tasks', 'create', record, options);
    return new NormalSDKJavaScriptTask(world, record);
  });
  for (const id of COMMANDS.keys())
    world.runtime.register('main', id, async (args, machine, task) => {
      if (originalOwner(world))
        return originalFeature(world, 'sdk-javascript-tasks', 'command', id, args, machine, task);
      return normalSDKJavaScriptCommand(world, id, args, machine, task);
    });
}
