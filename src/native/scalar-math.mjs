// SPDX-License-Identifier: MPL-2.0
// Script-visible f32 words in the normal engine precision/rounding environment.
import { nativeABI } from './abi/index.mjs';
import { nativeReply, bitsFloat, floatBits } from '../kcs/vm.mjs';
import { degreeToRadian, radianToDegree } from '../ppi/numeric.mjs';
const f = Math.fround;
const unary = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ceil: Math.ceil,
  floor: Math.floor,
  sqrt: Math.sqrt,
  log10: Math.log10,
};
const names = new Set([
  ...Object.keys(unary),
  'abs',
  'integerAbs',
  'fmod',
  'pow',
  'degreeToRadian',
  'radianToDegree',
  'triangleWave',
  'atan2',
  'packWords',
  'unpackWords',
]);
const nan = (word) => (word & 0x7fffffff) > 0x7f800000;
const quiet = (word) =>
  (word | 0x00400000) /* exe-address-check: non-address - IEEE quiet NaN bit */ >>> 0;
const indefinite = 0xffc00000;
function nearest(value) {
  const lower = Math.floor(value),
    fraction = value - lower;
  return fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : lower % 2 ? lower + 1 : lower;
}
// Match the pinned oracle's FPREM/FPREM1 double reductions, including partial
// reductions. Its cancellation at huge magnitudes is script-visible. This is
// an oracle-backend limitation, not a claim about hardware x87 accuracy.
export function nativeRemainder(a, b, even = false) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return NaN;
  for (;;) {
    if (a === 0) return 0;
    const difference = Math.floor(Math.log2(Math.abs(a))) - Math.floor(Math.log2(Math.abs(b)));
    if (difference < 0) return a;
    if (difference < 53) return a - b * (even ? nearest(a / b) : Math.trunc(a / b));
    const shift = 2 ** (even ? difference - 50 : difference - (32 + (difference % 32)));
    a -= b * Math.trunc(a / b / shift) * shift;
  }
}
function trigInput(value) {
  // The CRT falls back to FSIN/FCOS/FPTAN for large arguments. At 2^63 the
  // oracle first reduces by its extended-precision 2*pi*2^61 constant.
  return Math.abs(value) >= 2 ** 63 && Number.isFinite(value)
    ? nativeRemainder(value, Number(0xc90fdaa22168c235n), true)
    : value;
}
function triangle(value, period) {
  const n = Math.abs(value),
    quarter = f(Math.abs(period) * 0.25),
    phase = n > 0 ? f(nativeRemainder(n, Math.abs(period))) : 0,
    part = phase > 0 ? f(nativeRemainder(phase, quarter)) : 0,
    wave = f(part / quarter);
  if (quarter > phase) return wave;
  if (f(quarter * 2) > phase) return f(1 - wave);
  if (f(quarter * 3) > phase) return -wave;
  return f(wave - 1);
}
export function nativeScalarMath(operation, args, machine, argumentWords) {
  const name = operation?.replace(/^math\./, '');
  if (!names.has(name)) return undefined;
  const words = Array.from(args);
  while (words.length < argumentWords) words.push(machine.nativeArgument(words.length));
  const [a, b, c] = words;
  if (name === 'unpackWords') {
    machine.store(b, (a << 16) >> 16);
    machine.store(c, a >> 16);
    return nativeReply(2);
  }
  if (name === 'packWords') return nativeReply(1, (a & 65535) | (b << 16));
  if (name === 'integerAbs') return nativeReply(1, Math.abs(a | 0));
  if (name === 'abs') return nativeReply(1, (nan(a) ? quiet(a) : a) & 0x7fffffff);
  const x = bitsFloat(a),
    y = bitsFloat(b);
  if (name !== 'triangleWave') {
    // CRT pow checks identities before NaN propagation.
    if (name === 'pow' && (y === 0 || (x === 1 && !Number.isNaN(y))))
      return nativeReply(1, floatBits(1));
    if (nan(a)) return nativeReply(1, quiet(a));
    if (argumentWords > 1 && nan(b)) return nativeReply(1, quiet(b));
  }
  let result;
  if (name === 'fmod') result = nativeRemainder(x, y);
  else if (name === 'pow') result = Math.pow(x, y);
  else if (name === 'atan2') result = Math.atan2(x, y);
  else if (name === 'degreeToRadian') result = degreeToRadian(x);
  else if (name === 'radianToDegree') result = radianToDegree(x);
  else if (name === 'triangleWave') result = triangle(x, y);
  else result = unary[name](['sin', 'cos', 'tan'].includes(name) ? trigInput(x) : x);
  return nativeReply(
    1,
    Number.isNaN(result)
      ? name === 'triangleWave' && nan(b)
        ? quiet(b)
        : indefinite
      : floatBits(result),
  );
}
export function installNativeScalarMath(world) {
  for (const entry of nativeABI(world.profile).tables.main.entries) {
    if (!names.has(entry.name?.replace(/^math\./, ''))) continue;
    world.runtime.register('main', entry.id, (args, machine) =>
      nativeScalarMath(entry.name, args, machine, entry.signature.argumentWords),
    );
  }
}
