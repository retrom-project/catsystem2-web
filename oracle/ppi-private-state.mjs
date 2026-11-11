// SPDX-License-Identifier: MPL-2.0
// Read-only fields from the reviewed DLL state layouts in the existing oracle.
// No EXE, code write, native probe, patch, or callback is introduced here.
import { floatBits } from '../src/kcs.mjs';
const names = new Set([
  'blur',
  'cmnptcl',
  'dash',
  'em_angry',
  'em_double',
  'em_note',
  'em_question',
  'em_question_a',
  'em_sweat',
  'filmnoise',
  'rain',
  'steam',
]);
function shape(i, name) {
  if (name === 'em_angry' || name === 'em_sweat')
    return { heads: i.count ? 1 : 0, tails: Math.max(0, i.count - 1) };
  if (name === 'dash' || name === 'em_note')
    return { heads: i.state.heads, tails: i.state.tailCount };
  return { heads: i.count, tails: 0 };
}
function jsRow(i, name, n) {
  const s = i.state,
    v = s.particles?.[n];
  if (!v) return null;
  const { heads, tails } = shape(i, name);
  if (n >= heads * (tails + 1)) return null;
  if (name === 'rain')
    return {
      age: v.age,
      phase: v.mark,
      mode: v.mode,
      velocity: [...v.velocity].map(floatBits),
      life: floatBits(v.life),
    };
  if (name === 'steam')
    return { age: v.tick, phase: v.mark, mode: v.mode, life: floatBits(v.path.duration) };
  if (name === 'cmnptcl')
    return {
      life: floatBits(v.life),
      initialLife: floatBits(v.initialLife),
      ...(s.config?.emitterType === 1 ? {} : { velocity: [...v.velocity].map(floatBits) }),
    };
  if (name === 'dash')
    return {
      age: v.tick,
      mode: v.mode,
      ...(n < heads ? { velocity: [...v.velocity].map(floatBits) } : {}),
    };
  if (name === 'blur') return { age: v.tick, delay: v.randomDelay, fade: v.fade };
  if (name === 'filmnoise')
    return { age: v.tick, phase: v.mark, mode: v.mode, life: floatBits(v.life) };
  return {
    age: v.tick,
    phase: v.mark,
    mode: n >= heads && (name === 'em_angry' || name === 'em_sweat') ? v.active : v.mode,
    ...((name === 'em_note' || name === 'em_sweat') && n < heads
      ? {
          life: floatBits((v.path ?? s.path).duration),
          ...(name === 'em_note' ? { durations: [...v.durations] } : {}),
        }
      : {}),
  };
}
function originalRow(i, name, n) {
  const p = i.process,
    table = p.load(i.instance + 0x34),
    heads = p.load(i.instance + 0x38);
  if (!table || !heads) return null;
  let address,
    tail = false;
  if (n < heads) address = p.load(table + n * 16);
  else {
    const tails = p.load(table + 8),
      relative = n - heads;
    if (!tails || relative >= heads * tails) return null;
    const owner = Math.floor(relative / tails),
      children = p.load(table + owner * 16 + 12);
    address = p.load(children + (relative % tails) * 8);
    tail = true;
  }
  if (!address) return null;
  const u = (offset) => p.load(address + offset) >>> 0,
    d = (offset) => p.load(address + offset) | 0,
    vector = (offset) => [u(offset), u(offset + 4), u(offset + 8)];
  if (name === 'rain')
    return { age: d(0), phase: d(4), mode: d(8), velocity: vector(12), life: u(36) };
  if (name === 'steam') return { age: d(0), phase: d(4), mode: d(8), life: u(652) };
  if (name === 'cmnptcl')
    return {
      life: u(248),
      initialLife: u(252),
      ...(p.load(i.instance + 0x50) === 1 ? {} : { velocity: vector(272) }),
    };
  if (name === 'dash') return { age: d(0), mode: d(8), ...(!tail ? { velocity: vector(44) } : {}) };
  if (name === 'blur') return { age: d(0), delay: d(132), fade: d(140) };
  if (name === 'filmnoise') return { age: d(0), phase: d(4), mode: d(8), life: u(16) };
  return {
    age: d(0),
    phase: d(4),
    mode: d(8),
    ...((name === 'em_note' || name === 'em_sweat') && !tail
      ? {
          life: u(name === 'em_note' ? 668 : 652),
          ...(name === 'em_note' ? { durations: [d(684), d(688), d(692)] } : {}),
        }
      : {}),
  };
}
export function reviewedPPIState(i) {
  const name =
    i.pluginIdentity?.name ??
    i.options.name
      .replaceAll('\\', '/')
      .split('/')
      .at(-1)
      .replace(/\.ppi$/, '');
  if (!names.has(name)) return null;
  return Array.from({ length: i.count }, (_, n) =>
    i.process ? originalRow(i, name, n) : jsRow(i, name, n),
  );
}
