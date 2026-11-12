// SPDX-License-Identifier: MPL-2.0
// Plain-source preparation and one-pass macro emission are separate from
// runtime parameter tokenization and raw command-tail extraction.
import { tokenizeFESByteLine, fesByteView, fesViewBytes } from './tokens.mjs';

export function splitFESLines(source) {
  return fesByteView(source)
    .split(/\r\n|\r|\n/)
    .map(fesViewBytes);
}
export function uncommentFESSource(source) {
  // The native source cleaner is quote/escape blind and does not nest comments.
  // Delete comment bytes, retaining line breaks even across a block comment.
  return fesViewBytes(
    fesByteView(source).replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g, (comment) =>
      comment.replace(/[^\r\n]/g, ''),
    ),
  );
}
export function fesRawTail(source, count) {
  const line = fesByteView(source);
  let at = 0;
  while (count-- > 0) {
    at = line.indexOf(' ', at);
    if (at < 0) return new Uint8Array();
    at++;
  }
  return fesViewBytes(line.slice(at));
}
export function prepareFESSource(source, { tokens = tokenizeFESByteLine } = {}) {
  const lines = splitFESLines(uncommentFESSource(source))
    .map(fesByteView)
    .map((line) => line.replaceAll('\t', ' ').replace(/ +/g, ' ').replace(/^ | $/g, ''))
    .filter(Boolean);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const at = line.startsWith('if(') ? 0 : line.indexOf(' if(');
    if (at === 0 && line.startsWith('if(')) line = 'if (' + line.slice(3);
    else if (at >= 0) line = line.slice(0, at) + ' if (' + line.slice(at + 4);
    let depth = 0,
      output = '';
    for (const character of line) {
      if (character === '(') depth++;
      else if (character === ')') depth--;
      if (character !== ' ' || depth <= 0) output += character;
    }
    lines[index] = output;
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      words = tokens(fesViewBytes(line)),
      first =
        words[0] === undefined
          ? ''
          : fesByteView(words[0]).replace(/[A-Z]/g, (c) => c.toLowerCase());
    const count =
      first === 'if' && words[2] !== undefined
        ? 2
        : first === 'else' && words[1] !== undefined
          ? 1
          : 0;
    if (!count) continue;
    let boundary = -1;
    for (let word = 0; word < count; word++) {
      boundary = line.indexOf(' ', boundary + 1);
      if (boundary < 0) break;
    }
    if (boundary < 0) continue;
    const tail = line.slice(boundary + 1);
    lines[index] = line.slice(0, boundary);
    lines.splice(index + 1, 0, tail, 'endif');
  }
  return lines.map(fesViewBytes);
}

const rawLiterals = Object.freeze({ string: 'raw', character: 'raw' });
export function replaceFESMacros(source, macros, literals = rawLiterals) {
  const line = fesByteView(source);
  if (!(macros instanceof Map)) throw new TypeError('FES macro dictionary must be a Map');
  if (!macros.size) return fesViewBytes(line);
  if (
    !['raw', 'unescape-quote'].includes(literals.string) ||
    !['raw', 'wrap-raw'].includes(literals.character)
  )
    throw new Error('Unknown FES macro literal emission policy');
  let output = '',
    at = 0;
  const pair = (index) => {
    const lead = line.charCodeAt(index),
      trail = line.charCodeAt(index + 1);
    return (
      ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xef)) &&
      ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc))
    );
  };
  while (at < line.length && line.charCodeAt(at)) {
    const start = at,
      character = line[at];
    if (character === '\x1a') break;
    if (line.startsWith('//', at)) {
      const end = line.indexOf('\r\n', at + 2);
      if (end < 0) break;
      at = end;
      continue;
    }
    if (line.startsWith('/*', at)) {
      const end = line.indexOf('*/', at + 2);
      if (end < 0) break;
      at = end + 2;
      continue;
    }
    if (line.startsWith('\\\r\n', at)) {
      at += 3;
      continue;
    }
    if (character === '"') {
      at++;
      let value = '';
      while (at < line.length && line[at] !== '"') {
        if (pair(at)) {
          value += line.slice(at, at + 2);
          at += 2;
        } else {
          if (line[at] === '\\' && line[at + 1] === '"') at++;
          value += line[at++];
        }
      }
      if (line[at] === '"') at++;
      output += literals.string === 'unescape-quote' ? '"' + value + '"' : line.slice(start, at);
      continue;
    }
    if (character === "'") {
      let end = at + 1;
      while (end < line.length && line[end] !== "'") {
        if (line[end] === '\\' && (line[end + 1] === "'" || line[end + 1] === '\\')) end++;
        end++;
      }
      if (line[end] === "'") {
        at = end + 1;
        const lexeme = line.slice(start, at);
        output += literals.character === 'wrap-raw' ? "'" + lexeme + "'" : lexeme;
        continue;
      }
    }
    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(line[at + 1] ?? ''))) {
      const number = /^(?:0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)[fFlLuU]*/.exec(
        line.slice(at),
      );
      if (number) {
        output += number[0];
        at += number[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(character)) {
      const word = /^[A-Za-z_][A-Za-z_\d]*/.exec(line.slice(at))[0];
      output += macros.has(word) ? fesByteView(macros.get(word)) : word;
      at += word.length;
    } else {
      const count = pair(at) ? 2 : 1;
      output += line.slice(at, at + count);
      at += count;
    }
  }
  return fesViewBytes(output);
}
