// SPDX-License-Identifier: MPL-2.0
export function nativeInteger64(source) {
  const match = /^([+-]?)(0[xX][\da-f]*|\d+)/i.exec(source);
  if (!match || (!/^0[xX]/.test(match[2]) && source[match[0].length] === '.')) return 0n;
  const digits = match[2],
    value = /^0[xX]$/.test(digits) ? 0n : BigInt(digits);
  return BigInt.asIntN(64, match[1] === '-' ? -value : value);
}

export function readLoopPoints(bytes) {
  const text = new TextDecoder('shift_jis')
    .decode(bytes)
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => comment.replace(/[^\r\n]/g, ''))
    .replace(/\/\/[^\r\n]*/g, '')
    .replaceAll('"', '');
  const records = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const tokens = line.split(/[ \t]+/).filter(Boolean);
    if (!tokens.length) continue;
    records.push({
      file: tokens[0],
      start: tokens[1] === undefined ? 0n : nativeInteger64(tokens[1]),
      end: tokens[2] === undefined ? -1n : nativeInteger64(tokens[2]),
    });
  }
  return records;
}
