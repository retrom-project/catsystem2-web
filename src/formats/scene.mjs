// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit CatScene, SceneTranslation and FESScript (OWCramer).
import { Binary, inflate, decodeText, boundedCount } from '../binary.mjs';

export async function readScene(bytes) {
  const b = new Binary(bytes, 'CatScene');
  if (!b.magic('CatScene')) throw new Error('Expected CatScene');
  const packed = b.u32(8),
    size = b.u32(12);
  const body = new Binary(
    packed ? await inflate(b.range(16, packed), size) : b.range(16, size),
    'CatScene body',
  );
  const blocks = boundedCount(body.u32(4), 1000000, 'Scene blocks');
  const offsets = 16 + body.u32(8),
    strings = 16 + body.u32(12);
  if (offsets < 16 + blocks * 8 || strings < offsets || (strings - offsets) % 4)
    throw new Error('Invalid scene tables');
  body.range(0, strings);
  const lines = [];
  for (let i = 0; i < (strings - offsets) / 4; i++) {
    const at = strings + body.u32(offsets + i * 4);
    if (body.u8(at) !== 1) throw new Error(`Invalid scene line ${i}`);
    lines.push({ kind: body.u8(at + 1), text: body.str(at + 2) });
  }
  return {
    lines,
    blocks: Array.from({ length: blocks }, (_, i) => [body.u32(20 + i * 8), body.u32(16 + i * 8)]),
  };
}

export function readTranslation(bytes) {
  const b = new Binary(bytes, 'CSTL');
  if (!b.magic('CSTL')) throw new Error('Expected CSTL');
  let at = 8;
  function integer() {
    let n = 0,
      c;
    do {
      c = b.u8(at++);
      n += c;
      if (n > 16000000) throw new Error('CSTL integer exceeds limit');
    } while (c === 255);
    return n;
  }
  function string() {
    const length = integer(),
      s = new TextDecoder().decode(b.range(at, length));
    at += length;
    return s;
  }
  const count = boundedCount(integer(), 256, 'CSTL languages'),
    languages = Array.from({ length: count }, string);
  const messages = boundedCount(integer(), 1000000, 'CSTL messages'),
    result = {};
  for (const lang of languages) result[lang] = [];
  for (let i = 0; i < messages; i++)
    for (const lang of languages) result[lang].push({ speaker: string(), text: string() });
  if (at !== bytes.length) throw new Error('CSTL trailing data');
  return result;
}

export async function readFES(bytes) {
  const b = new Binary(bytes, 'FES'),
    prepared = b.magic('FES\0'),
    body = prepared ? await inflate(b.range(16, b.u32(4)), b.u32(8)) : bytes,
    end = body.indexOf(0),
    source = body.slice(0, end < 0 ? body.length : end);
  // Execution owns these narrow bytes. The decoded text is a diagnostic view;
  // neither codec selection nor BOM handling may rewrite the source body.
  return { bytes: source, text: decodeText(source), prepared };
}
