// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_WINDOW_COMMAND_CALLBACKS = Object.freeze({
  'sdk-4.01-engine-2.6.1.74': 0x442a30,
  'nekopara-vol3-engine-2.6.1.76': 0x531670,
});

const scriptMessages = new Map([
    [0x34d, 0x469],
    [0x34e, 0x46a],
    [0x34f, 0x46b],
  ]),
  postedCommands = new Map([
    [0x469, 40012],
    [0x46a, 40021],
    [0x46b, 40002],
  ]);
const menuCommands = new Map([
  [0, 119],
  [1, 40045],
  [2, 40002],
  [10, 40008],
  [11, 40009],
  [12, 40021],
  [13, 40034],
  [20, 40027],
  [21, 40057],
  [22, 40011],
  [30, 40041],
  [31, 40019],
  [32, 40037],
]);
export function nativeWindowMenuCommand(selector) {
  return menuCommands.get(selector >>> 0) ?? null;
}
export function nativeWindowMessageCommand(message, selector) {
  if (message === 0x46c) return nativeWindowMenuCommand(selector);
  return postedCommands.get(message) ?? null;
}
export function nativeWindowLanguageCommand(command) {
  if (command < 40065 || command > 40094) return null;
  const index = command - 40065;
  return { field: ['ui', 'main', 'sub'][Math.floor(index / 10)], index: index % 10 };
}
export function installNativeWindowCommands(world) {
  for (const [id, message] of scriptMessages)
    world.runtime.register('main', id, () => {
      world.window.post(message);
      return nativeReply(2);
    });
}
