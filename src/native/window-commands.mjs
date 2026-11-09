// SPDX-License-Identifier: MPL-2.0
// Game 531670 and SDK 442A30 translate private messages into WM_COMMAND.
import { nativeReply } from '../kcs/vm.mjs';

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
export function installNativeWindowCommands(world) {
  for (const [id, message] of scriptMessages)
    world.runtime.register('main', id, () => {
      world.window.post(message);
      return nativeReply(2);
    });
}
