// SPDX-License-Identifier: MPL-2.0
// Script-visible f32 words in the normal engine precision/rounding environment.
import { nativeABI } from './abi/index.mjs';
import { nativeReply, bitsFloat, floatBits } from '../kcs/vm.mjs';
import {
  degreeToRadian,
  radianToDegree,
  x87AngleConversion,
  x87Atan2Word,
  x87RemainderWord,
  x87TriangleWaveWord,
} from '../ppi/numeric.mjs';
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
const quiet = (word) => (word | 0x00400000) /* IEEE quiet NaN bit  */ >>> 0;
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
const x87AngleUnit = 2 ** 65;
const x87HalfPi = 0x3243f6a8885a308d3n;
const crtAnglePeriod = 0xc90fdaa22168c235n << 65n;
function nativeReducedTrig(name, value) {
  const magnitude = Math.abs(value),
    x87Limit = name === 'tan' ? 12800 : 90112;
  if (magnitude < x87Limit) return unary[name](value);

  // The initialized CRT dispatches large inputs to x87. FPREM1 first
  // uses the CRT's extended period when the argument exceeds x87's range.
  let scaled = BigInt(magnitude * x87AngleUnit);
  if (magnitude >= 2 ** 63) {
    scaled %= crtAnglePeriod;
    if (scaled * 2n > crtAnglePeriod) scaled -= crtAnglePeriod;
  }

  // Reduce to the nearest quadrant with the processor's 66-bit pi constant
  // before passing a small angle to the portable trigonometric functions.
  const half = x87HalfPi >> 1n,
    turns = (scaled + (scaled < 0n ? -half : half)) / x87HalfPi,
    angle = Number(scaled - turns * x87HalfPi) / x87AngleUnit;
  if (name === 'tan') {
    const tangent = Math.tan(angle),
      result = turns & 1n ? -1 / tangent : tangent;
    return value < 0 ? -result : result;
  }

  const quadrant = Number(turns & 3n) + Number(name === 'cos'),
    result = quadrant & 1 ? Math.cos(angle) : Math.sin(angle),
    negative = Boolean(quadrant & 2) !== (name === 'sin' && value < 0);
  return negative ? -result : result;
}
export function nativeTrigWord(name, word, trigUsesNativeReduction = false) {
  if (nan(word)) return quiet(word);
  const value = bitsFloat(word);
  if (!Number.isFinite(value)) return indefinite;
  return floatBits(
    trigUsesNativeReduction ? nativeReducedTrig(name, value) : unary[name](trigInput(value)),
  );
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
export function scalarArgumentWords(args, machine, count) {
  return Array.from({ length: count }, (_, index) =>
    index < args.length ? args[index] : machine.nativeArgument(index),
  );
}
export function nativeScalarMath(
  operation,
  args,
  machine,
  argumentWords,
  anglesUseX87 = false,
  atan2UsesX87 = false,
  powUsesSSE2Identities = false,
  trigUsesNativeReduction = false,
) {
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
  if (name === 'atan2' && atan2UsesX87) return nativeReply(1, x87Atan2Word(a, b));
  if (name === 'sin' || name === 'cos' || name === 'tan')
    return nativeReply(1, nativeTrigWord(name, a, trigUsesNativeReduction));
  const x = bitsFloat(a),
    y = bitsFloat(b);
  if (name !== 'triangleWave') {
    if (name === 'pow') {
      if (powUsesSSE2Identities) {
        if (nan(a)) return nativeReply(1, quiet(a));
        if (Math.abs(x) === 1 && Math.abs(y) === Infinity) return nativeReply(1, floatBits(1));
      }
      if (y === 0 || (x === 1 && !Number.isNaN(y))) return nativeReply(1, floatBits(1));
    }
    if (nan(a)) return nativeReply(1, quiet(a));
    if (argumentWords > 1 && nan(b)) return nativeReply(1, quiet(b));
  }
  let result;
  if (name === 'fmod') result = nativeRemainder(x, y);
  else if (name === 'pow') result = Math.pow(x, y);
  else if (name === 'atan2') result = Math.atan2(x, y);
  else if (name === 'degreeToRadian')
    result = anglesUseX87 ? x87AngleConversion(x, true) : degreeToRadian(x);
  else if (name === 'radianToDegree')
    result = anglesUseX87 ? x87AngleConversion(x, false) : radianToDegree(x);
  else if (name === 'triangleWave') result = triangle(x, y);
  else result = unary[name](x);
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
  const abi = nativeABI(world.profile);
  for (const entry of abi.tables.main.entries) {
    if (!names.has(entry.name?.replace(/^math\./, ''))) continue;
    if (abi.math?.remainderUsesX87 && entry.name === 'math.fmod') {
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeReply(
          1,
          x87RemainderWord(
            ...(abi.math.scalarArgumentsReadFrame ? scalarArgumentWords(args, machine, 2) : args),
          ),
        ),
      );
      continue;
    }
    if (abi.math?.triangleWaveUsesX87 && entry.name === 'math.triangleWave') {
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeReply(
          1,
          x87TriangleWaveWord(
            ...(abi.math.scalarArgumentsReadFrame ? scalarArgumentWords(args, machine, 2) : args),
          ),
        ),
      );
      continue;
    }
    world.runtime.register('main', entry.id, (args, machine) =>
      nativeScalarMath(
        entry.name,
        args,
        machine,
        entry.signature.argumentWords,
        abi.math?.anglesUseX87,
        abi.math?.atan2UsesX87,
        abi.math?.powUsesSSE2Identities,
        abi.math?.trigUsesNativeReduction,
      ),
    );
  }
}
