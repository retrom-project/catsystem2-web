// SPDX-License-Identifier: MPL-2.0
import { originalOwner, originalFeature } from './original-adapter.mjs';
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeEngineWord } from './engine-message.mjs';

export const NATIVE_INPUT_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x5f, 2, 2],
    [0x6b, 1, 1],
    [0x18a, 2, 2],
    [0x3a9, 0, 2],
  ].map(([id, words, control]) => Object.freeze({ id, words, control })),
);
export function installNativeInputCommands(world) {
  for (const { id } of NATIVE_INPUT_COMMAND_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) => {
      if ((id === 0x6b || id === 0x3a9) && !originalOwner(world)) {
        const input = nativeEngineWord(
          await world.sendNativeEngine(
            0,
            task.id,
            world.engineMessages.layout.rootStart + 2,
            0,
            0,
            { flags: 0 },
          ),
          'Input task root query',
        );
        if (id === 0x6b) {
          const value = await world.sendNativeEngine(input, task.id, 133, args[0], 0, { flags: 0 });
          return nativeReply(1, nativeEngineWord(value, 'Input active word query'));
        }
        await world.sendNativeEngine(input, task.id, 157, 0, 0, { flags: 0 });
        return nativeReply(2);
      }
      if (id === 0x18a && !originalOwner(world)) {
        if (args[1] && nativeABI(world.profile).input?.bitmapMaskNativeRows)
          world.graphics.images.get(args[1]);
        await world.sendNativeEngine(args[0], task.id, 97, 0, args[1], { flags: 0 });
        return nativeReply(2);
      }
      if (id === 0x5f && !originalOwner(world)) {
        if (args[0] === 0) return nativeReply(2);
        const top = world.engineMessages.closestTop(task.id);
        if (top?.nativeID !== 0)
          throw new Error('Native graph input registration requires an owned zero-ID Top');
        const target = world.objects.objects.get(world.resolveTaskID(args[0], task.id));
        if (target?.kind !== 2)
          throw new Error('Native graph input registration requires a reviewed Graph receiver');
        await world.sendNativeEngine(args[0], task.id, 89, world.nativeTaskID(task.id), args[1], {
          flags: 0,
        });
        return nativeReply(2);
      }
      return originalFeature(world, 'input-commands', 'apply', id, args, machine, task);
    });
}
