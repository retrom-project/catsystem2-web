// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { multiplyX87Integer, roundX87Single } from '../ppi/x87.mjs';
export const NATIVE_VIEW_GEOMETRY_OPERATIONS = Object.freeze([
  'view.dimensions',
  'view.setCameraNear',
  'view.borderOffset',
  'view.fullPositionCoordinates',
  'view.drawingRectangle',
]);
const f = Math.fround;
const cvtt = (value) =>
  Number.isFinite(value) && value >= -2147483648 && value < 2147483648
    ? Math.trunc(value) | 0
    : -2147483648;
function convert(machine, addresses, view, useX87 = false) {
  // Read each output only immediately before its conversion: aliases see X's write.
  for (const [axis, address] of addresses.entries()) {
    const input = machine.load(address) | 0,
      offset = view.deviceOffset[axis],
      inverse = 1 / view.deviceScale,
      shifted = useX87 ? f(roundX87Single(input - offset)) : f(f(input) - offset),
      device = cvtt(
        useX87 ? roundX87Single(shifted * f(roundX87Single(inverse))) : f(shifted * f(inverse)),
      );
    const ratio =
      view.ratios?.[axis] ??
      f(
        [view.virtualWidth, view.virtualHeight][axis] / [view.clientWidth, view.clientHeight][axis],
      );
    const adjusted = (device - view.windowShift[axis]) | 0;
    machine.store(
      address,
      cvtt(useX87 ? multiplyX87Integer(adjusted, ratio) : f(f(adjusted) * ratio)),
    );
  }
}
export function nativeViewGeometry(
  operation,
  args,
  machine,
  argumentWords,
  graphics,
  screen,
  fullPositionUsesX87,
) {
  const words = Array.from(args);
  while (words.length < argumentWords) words.push(machine.nativeArgument(words.length));
  const [x, y] = words,
    view = graphics.view,
    rect = view.active ? view.drawingRectangle : [0, 0, screen.currentWidth, screen.currentHeight];
  if (operation === 'view.setCameraNear') graphics.setCameraNearWord(x);
  else if (operation === 'view.dimensions') {
    machine.store(x, view.virtualWidth);
    machine.store(y, view.virtualHeight);
  } else if (operation === 'view.drawingRectangle') {
    [rect[0], rect[1], (rect[2] - rect[0]) | 0, (rect[3] - rect[1]) | 0].forEach((word, i) =>
      machine.store(words[i], word),
    );
  } else if (operation === 'view.borderOffset') {
    machine.store(y, 0);
    machine.store(x, 0);
    if (view.active) {
      machine.store(x, cvtt(view.deviceOffset[0]));
      machine.store(y, cvtt(view.deviceOffset[1]));
    }
    machine.store(x, machine.load(x) * 2);
    machine.store(y, machine.load(y) * 2);
    convert(machine, [x, y], view);
  } else {
    machine.store(x, 0);
    const mode = screen.fullPosition >>> 0;
    if (mode === 0)
      machine.store(
        y,
        view.active ? (rect[3] + cvtt(view.deviceOffset[1])) | 0 : screen.currentHeight,
      );
    else if (mode === 1) machine.store(y, screen.fullHeight);
    else if (mode === 2) machine.store(y, screen.virtualHeight);
    if (mode < 2) convert(machine, [x, y], view, fullPositionUsesX87);
  }
  return nativeReply(2);
}
export function installNativeViewGeometry(world) {
  const abi = nativeABI(world.profile);
  for (const entry of abi.tables.main.entries)
    if (NATIVE_VIEW_GEOMETRY_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeViewGeometry(
          entry.name,
          args,
          machine,
          entry.signature.argumentWords,
          world.graphics,
          world.configuration.screen,
          abi.graphics?.fullPositionCoordinatesUseX87,
        ),
      );
}
