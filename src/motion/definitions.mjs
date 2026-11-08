// SPDX-License-Identifier: MPL-2.0
// FES SUBCOMMAND types and coercion recovered from native 75B020/769940,
// numeric helpers 76AA10/76AB10 and the fixed SDK motion.h interface.
import { MOTION_ABI, motionVector } from './abi.mjs';
import { degreeToRadian } from '../ppi/numeric.mjs';

const f = Math.fround;
const vectors = {
  B: MOTION_ABI.base,
  P: MOTION_ABI.pos,
  V: MOTION_ABI.vram,
  R: MOTION_ABI.rotation,
  S: MOTION_ABI.scale,
};
const parameterTypes = new Set([
  'p',
  ...'BPVRS'
    .split('')
    .flatMap((prefix) =>
      [...'XYZ'].flatMap((axis) => [`${prefix}${axis}`, `${prefix}${axis}`.toLowerCase()]),
    ),
  ...'RGBAX'.split('').flatMap((axis) => [`C${axis}`, `c${axis.toLowerCase()}`]),
]);

export function motionDefinition(name, raw) {
  const divider = raw.words.indexOf(':');
  if (divider < 1) throw new Error(`Invalid MOT definition ${name}`);
  if (!['oneshot', 'continue'].includes(raw.type))
    throw new Error(`Invalid MOT declaration type ${raw.type}`);
  const parameters = raw.words.slice(1, divider).map((word) => {
    const match = /^([a-z]+)\[(.*)\]$/i.exec(word);
    if (!match || !parameterTypes.has(match[1]))
      throw new Error(`Unknown MOT parameter declaration ${word}`);
    return { type: match[1], fallback: match[2] };
  });
  const output = raw.words.slice(divider + 1);
  if (parameters.length > 16 || output.length > 16)
    throw new Error(`MOT definition ${name} exceeds native declaration capacity`);
  return { name, type: raw.type, file: raw.words[0], parameters, output };
}

function parameterValue(parameter, supplied, state, integer) {
  const { type, fallback } = parameter,
    token = supplied || fallback,
    prefix = type[0].toUpperCase(),
    component = type[1]?.toUpperCase(),
    relative = type[0] !== prefix;
  let current = 0,
    percentBase = 0;
  if (type !== 'p' && vectors[prefix]) {
    current = motionVector(state, vectors[prefix])[{ X: 0, Y: 1, Z: 2 }[component]];
    percentBase = prefix === 'S' ? 1 : current;
  } else if (prefix === 'C' && component !== 'X') {
    const shift = { R: 16, G: 8, B: 0, A: 24 }[component];
    const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
    current = (view.getUint32(MOTION_ABI.color, true) >>> shift) & 255;
    percentBase = current;
  }
  // The original parser accepts CX/cx but its conversion switch leaves their
  // register zero. cxr/cxg/cxb/cxa below read current packed-color channels.
  if (prefix === 'C' && component === 'X') return 0;
  const percentage = token.endsWith('%'),
    expression = percentage ? token.slice(0, -1) : token;
  let value = f(integer(expression, Math.trunc(current)));
  if (prefix === 'R') value = degreeToRadian(value);
  if (percentage) value = f(f(value * percentBase) / 100);
  return f(relative && type !== 'p' ? value - current : value);
}

export function motionRegisters(definition, args, state, integer) {
  if (!(state instanceof Uint8Array) || state.length !== MOTION_ABI.objectSize)
    throw new Error('MOT definition needs the current KX2 state');
  const converted = definition.parameters.map((parameter, i) =>
    parameterValue(parameter, args[i], state, integer),
  );
  const color = new DataView(state.buffer, state.byteOffset, state.byteLength).getUint32(
    MOTION_ABI.color,
    true,
  );
  return definition.output.map((token) => {
    const reference = /^\[(\d+)\]$/.exec(token);
    if (reference) {
      const index = Number(reference[1]);
      if (index >= converted.length)
        throw new Error(`MOT ${definition.name} references undeclared parameter ${index}`);
      return converted[index];
    }
    if (/^cx[rgba]$/.test(token))
      return (color >>> { cxr: 16, cxg: 8, cxb: 0, cxa: 24 }[token]) & 255;
    if (token === 'CA') return color >>> 24;
    return f(integer(token, 0));
  });
}
