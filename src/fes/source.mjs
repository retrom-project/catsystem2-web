// SPDX-License-Identifier: MPL-2.0
// Plain-source preparation and one-pass macro emission are separate from
// runtime parameter tokenization and raw command-tail extraction.
import { tokenizeFESLine } from './tokens.mjs';

export function splitFESLines(text) {
  return text.split('\0', 1)[0].split(/\r\n|\r|\n/);
}
export function uncommentFESSource(text) {
  // The native source cleaner is quote/escape blind and does not nest comments.
  // Delete comment bytes, retaining line breaks even across a block comment.
  return text.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g, (comment) =>
    comment.replace(/[^\r\n]/g, ''),
  );
}
export function fesRawTail(line, count) {
  let at = 0;
  while (count-- > 0) {
    at = line.indexOf(' ', at);
    if (at < 0) return '';
    at++;
  }
  return line.slice(at);
}
export function prepareFESSource(text, { tokens = tokenizeFESLine } = {}) {
  const lines = splitFESLines(uncommentFESSource(text.split('\0', 1)[0]))
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
      words = tokens(line),
      first = words[0]?.toLowerCase();
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
  return lines;
}

const rawLiterals = Object.freeze({ string: 'raw', character: 'raw' });
export function replaceFESMacros(line, macros, literals = rawLiterals) {
  if (!(macros instanceof Map)) throw new TypeError('FES macro dictionary must be a Map');
  if (!macros.size) return line;
  if (
    !['raw', 'unescape-quote'].includes(literals.string) ||
    !['raw', 'wrap-raw'].includes(literals.character)
  )
    throw new Error('Unknown FES macro literal emission policy');
  let output = '',
    at = 0;
  while (at < line.length && line.charCodeAt(at)) {
    const start = at,
      character = line[at];
    if (character === '"' || character === "'") {
      at++;
      while (at < line.length && line[at] !== character) {
        if (line[at] === '\\' && line[at + 1] === character) at++;
        at++;
      }
      if (line[at] === character) at++;
      const lexeme = line.slice(start, at);
      output +=
        character === '"' && literals.string === 'unescape-quote'
          ? lexeme.replaceAll('\\"', '"')
          : character === "'" && literals.character === 'wrap-raw'
            ? "'" + lexeme + "'"
            : lexeme;
      continue;
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
      output += macros.get(word) ?? word;
      at += word.length;
    } else {
      output += character;
      at++;
    }
  }
  return output;
}
