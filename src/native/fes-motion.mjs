// SPDX-License-Identifier: MPL-2.0
// Built-in FES handlers at their 7488D0/5E8EF0 motion-manager boundary.
import { degreeToRadian } from '../ppi/numeric.mjs';
import { MOTION_ABI } from '../motion/abi.mjs';

export function buildNativeFESMotion(verb, args, state, evaluate, options = {}) {
  const value = (i, fallback = 0) =>
      args[i] === undefined ? fallback : evaluate(args[i], fallback) | 0,
    frame = () => Math.fround(Math.max(0, value(0, 30))),
    angle = (i) => degreeToRadian(value(i)),
    real = (i, fallback = 0) => Math.fround(value(i, fallback));
  let file,
    registers,
    group = 0;
  switch (verb) {
    case 'arc':
    case 'mcarc':
      file = verb === 'arc' ? 'motArc' : 'mcArc';
      registers = [frame(), angle(1), angle(2), real(3), real(4), 0];
      group = Number(verb === 'mcarc');
      break;
    case 'pend':
      file = 'motPend';
      registers = [frame(), real(1, 1), angle(2), angle(3), angle(4)];
      break;
    case 'mcpend':
      file = 'mcPend';
      registers = [frame(), angle(1), angle(2), angle(3)];
      group = 1;
      break;
    case 'blend': {
      let color;
      if (options.sound) {
        // The original sound branch leaves the command-source pointer in the
        // local that graphical branches replace with their previous ARGB.
        if (!Number.isInteger(options.commandPointer))
          throw new Error('Native FES sound blend requires its command-source address');
        color = options.commandPointer >>> 0;
      } else {
        if (!(state instanceof Uint8Array) || state.length !== MOTION_ABI.objectSize)
          throw new Error('Native FES blend requires the current KX2 state');
        color = new DataView(state.buffer, state.byteOffset, state.byteLength).getUint32(
          MOTION_ABI.color,
          true,
        );
      }
      file = 'pColor';
      registers = [real(0, 255), (color >>> 16) & 255, (color >>> 8) & 255, color & 255];
      break;
    }
    default:
      return undefined;
  }
  return { file, registers, group, delay: options.delay >>> 0 };
}
