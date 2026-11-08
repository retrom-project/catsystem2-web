// SPDX-License-Identifier: MPL-2.0
// Game 531670/532607 and SDK 442A30/44385E dispatch message 0x46C.
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
