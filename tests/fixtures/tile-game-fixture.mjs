// SPDX-License-Identifier: MPL-2.0
// Authored argument records and a minimal client for the original event API.
export function prepareTileGame(machine, players = 4) {
  machine.bytes(512, 64).fill(0);
  for (let i = 0; i < players - 1; i++) machine.store(512 + i * 4, i);
  for (let i = 0; i < 4; i++) machine.store(544 + i * 4, 25000 + i * 1000);
  return [players, 2, 0, 1, 2, 1, 512, 544];
}

export function tileGameQueryArguments(id, player = 0, index = 0, output = 2048) {
  switch (id) {
    case 0x1d9:
    case 0x1db:
    case 0x1dc:
    case 0x1e1:
    case 0x1e4:
    case 0x1ec:
    case 0x1f3:
    case 0x1f4:
    case 0x1f8:
    case 0x1fc:
      return [];
    case 0x1dd:
    case 0x1de:
    case 0x1df:
    case 0x1f2:
      return [player, output];
    case 0x1e0:
    case 0x1ed:
    case 0x1fa:
      return [index];
    case 0x1e2:
      return [0x021407, output, output + 4, output + 8];
    case 0x1e6:
      return [index, output];
    case 0x1e7:
    case 0x1fe:
      return [player, index, output];
    case 0x1ea:
      return [index, output, output + 4];
    case 0x1eb:
      return [index, 1];
    case 0x1ee:
      return [player, output, output + 4, output + 8, output + 12, output + 16];
    case 0x1ef:
    case 0x1f1:
    case 0x201:
      return [player];
    case 0x1f0:
      return [output, output + 4, output + 8, output + 16];
    case 0x1f6:
    case 0x200:
      return [output];
    default:
      return undefined;
  }
}

export function tileGameEventReply(event) {
  if (event === 10004) return [0x1e3, 1, 2];
  if (event === 20020 || event === 20043) return [0x1da, 0xffffffff];
  if (event === 20021) return [0x1e8, 0];
  if (event === 20066) return [0x1ff, 0];
  return undefined;
}

export const TILE_GAME_COMMAND_CASES = Object.freeze([
  [0x1da, 0xffffffff],
  [0x1e3, 1, 2],
  [0x1e5, 0],
  [0x1e8, 0],
  [0x1e9, 0, 0, 0],
  [0x1f5],
  [0x1f7, 544],
  [0x1f9, 10015, 0, 512],
  [0x1fb, 0],
  [0x1fd, 0, 0],
  [0x1ff, 0],
]);
