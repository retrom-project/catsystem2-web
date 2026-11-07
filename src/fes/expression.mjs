// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESExpression (OWCramer).
const precedence = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '<': 7,
  '>': 7,
  '<=': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
};
const operations = {
  '||': (a, b) => Number(!!a || !!b),
  '&&': (a, b) => Number(!!a && !!b),
  '|': (a, b) => a | b,
  '^': (a, b) => a ^ b,
  '&': (a, b) => a & b,
  '==': (a, b) => Number(a === b),
  '!=': (a, b) => Number(a !== b),
  '<': (a, b) => Number(a < b),
  '>': (a, b) => Number(a > b),
  '<=': (a, b) => Number(a <= b),
  '>=': (a, b) => Number(a >= b),
  '<<': (a, b) => a << b,
  '>>': (a, b) => a >> b,
  '+': (a, b) => (a + b) | 0,
  '-': (a, b) => (a - b) | 0,
  '*': Math.imul,
  '/': (a, b) => (b ? (a / b) | 0 : 0),
  '%': (a, b) => (b ? a % b : 0),
};
export function evaluate(text, context, depth = 0) {
  if (depth > 32) throw new Error('Expression macro recursion');
  const tokens =
    text.match(/0x[\da-f]+|\d+|[a-z_][a-z_\d]*|\|\||&&|==|!=|<=|>=|<<|>>|[^\s]/gi) || [];
  let at = 0;
  const take = (token) => tokens[at] === token && (++at, true);
  function primary() {
    const t = tokens[at++];
    if (t === undefined) throw new Error(`Incomplete expression: ${text}`);
    if (t === '-') return -primary() | 0;
    if (t === '+') return primary();
    if (t === '!') return Number(!primary());
    if (t === '~') return ~primary();
    if (t === '(') {
      const v = expression(1);
      if (!take(')')) throw new Error(`Missing ')' in ${text}`);
      return v;
    }
    if (t === '$' || t === '\\' || t === '#') {
      const index = take('(')
        ? (() => {
            const v = expression(1);
            if (!take(')')) throw new Error('Invalid variable index');
            return v;
          })()
        : Number(tokens[at++]);
      return t === '\\' ? context.local(index) : context.global(index);
    }
    if (/^(0x[\da-f]+|\d+)$/i.test(t)) return Number(t) | 0;
    const system = context.system?.(t);
    if (system !== undefined && system !== null) return system;
    const macro = context.macro?.(t);
    if (macro !== undefined) return evaluate(macro, context, depth + 1);
    let index;
    if (take('[')) {
      index = expression(1);
      if (!take(']')) throw new Error('Invalid object index');
    }
    return context.objectHandle?.(t, index) || 0;
  }
  function expression(min) {
    let v = primary();
    while ((precedence[tokens[at]] || 0) >= min) {
      const op = tokens[at++],
        right = expression(precedence[op] + 1);
      v = operations[op](v, right);
    }
    return v;
  }
  const value = expression(1);
  if (at !== tokens.length) throw new Error(`Unexpected '${tokens[at]}' in expression ${text}`);
  return value | 0;
}

export function assign(text, context) {
  const compact = text.replace(/\s/g, '');
  function target(lhs) {
    const local = lhs[0] === '\\',
      s = lhs.slice(1),
      n = s.startsWith('(') ? evaluate(s, context) : Number(s);
    if (!Number.isInteger(n)) throw new Error(`Invalid assignment: ${text}`);
    return {
      get: () => (local ? context.local(n) : context.global(n)),
      set: (v) => (local ? context.setLocal(n, v | 0) : context.setGlobal(n, v | 0)),
    };
  }
  const postfix = /^(.*)(\+\+|--)$/.exec(compact);
  if (postfix) {
    const t = target(postfix[1]);
    t.set(t.get() + (postfix[2] === '++' ? 1 : -1));
    return;
  }
  const compound = /^(.*?)([+\-*/%|&^])=(.*)$/.exec(compact);
  if (compound) {
    const t = target(compound[1]);
    t.set(operations[compound[2]](t.get(), evaluate(compound[3], context)));
    return;
  }
  const parts = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < compact.length; i++) {
    if (compact[i] === '(') depth++;
    if (compact[i] === ')') depth--;
    if (
      !depth &&
      compact[i] === '=' &&
      compact[i + 1] !== '=' &&
      !'=<>!'.includes(compact[i - 1] || ' ')
    ) {
      parts.push(compact.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(compact.slice(start));
  if (parts.length < 2) throw new Error(`Invalid assignment: ${text}`);
  const v = evaluate(parts.pop(), context);
  for (const lhs of parts) target(lhs).set(v);
}

export function condition(line) {
  const start = line.indexOf('(');
  let depth = 0;
  if (start < 0) throw new Error(`Invalid condition: ${line}`);
  for (let i = start; i < line.length; i++) {
    if (line[i] === '(') depth++;
    if (line[i] === ')' && --depth === 0)
      return [line.slice(start + 1, i), line.slice(i + 1).trim()];
  }
  throw new Error(`Unclosed condition: ${line}`);
}
