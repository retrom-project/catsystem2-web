// SPDX-License-Identifier: MPL-2.0
// CST's original script uses native207 grouping before expression evaluation.
// A group runs to its closing parenthesis or the end of the command string.
export function cstCondition(source) {
  source = source.split('\0')[0];
  const start = source.indexOf('(');
  if (start < 0) throw new Error(`Invalid CST condition: ${source}`);
  let level = 0;
  for (let at = start; at < source.length; at++) {
    if (source[at] === '(') level++;
    else if (source[at] === ')' && --level === 0)
      return {
        expression: source.slice(start, at + 1),
        command: source.slice(at + 1).trim(),
        closed: true,
      };
  }
  return { expression: source.slice(start), command: '', closed: false };
}
export function cstCommandBody(source) {
  while (/^if\s*\(/.test(source)) source = cstCondition(source).command;
  return source;
}
