// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESExpression (OWCramer).
const precedence = {
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '&': 6,
  '==': 7,
  '!=': 7,
  '<': 8,
  '>': 8,
  '<=': 8,
  '>=': 8,
  '<<': 9,
  '>>': 9,
  '+': 10,
  '-': 10,
  '*': 11,
  '/': 11,
  '%': 11,
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
  '/': (a, b) => {
    if (!b) throw new RangeError('FES division by zero');
    return (a / b) | 0;
  },
  '%': (a, b) => {
    if (!b) throw new RangeError('FES remainder by zero');
    return a % b;
  },
};
const assignments = new Set(['=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<=', '>>=']);

// Parse first, then execute the expression tree. This keeps logical operators
// short-circuiting, and preserves variable references for assignment and ++/--.
export function evaluate(text, context, depth = 0) {
  if (depth > 32) throw new Error('Expression macro recursion');
  const tokens =
    text.match(
      /0x[\da-f]+|\d+|[a-z_][a-z_\d]*|<<=|>>=|\+\+|--|\|\||&&|==|!=|<=|>=|<<|>>|[+\-*/%|&^]=|[^\s]/gi,
    ) || [];
  let at = 0;
  const take = (token) => tokens[at] === token && (++at, true);
  const required = (token) => {
    if (!take(token)) throw new Error(`Missing '${token}' in expression ${text}`);
  };
  function primary() {
    const token = tokens[at++];
    if (token === undefined) throw new Error(`Incomplete expression: ${text}`);
    if (['-', '+', '!', '~', '++', '--'].includes(token))
      return { kind: 'unary', op: token, value: primary() };
    let node;
    if (token === '(') {
      node = expression(1);
      required(')');
    } else if (['$', '\\', '#'].includes(token)) {
      let index;
      if (take('(')) {
        index = expression(1);
        required(')');
      } else {
        const number = tokens[at++];
        if (/^\d+$/.test(number || '')) index = { kind: 'number', value: Number(number) };
        else if (context.macro?.(number) !== undefined)
          index = { kind: 'macro', value: context.macro(number) };
        else throw new Error(`Invalid variable index in ${text}`);
      }
      node = { kind: 'variable', local: token === '\\', index };
    } else if (/^(0x[\da-f]+|\d+)$/i.test(token))
      node = { kind: 'number', value: Number(token) | 0 };
    else {
      let index;
      if (take('[')) {
        index = expression(1);
        required(']');
      }
      node = { kind: 'identifier', name: token, index };
    }
    if (tokens[at] === '++' || tokens[at] === '--')
      node = { kind: 'postfix', op: tokens[at++], value: node };
    return node;
  }
  function expression(min) {
    let node = primary();
    while (at < tokens.length) {
      const op = tokens[at],
        binding = assignments.has(op) ? 1 : precedence[op] || 0;
      if (binding < min) break;
      at++;
      const right = expression(binding + (assignments.has(op) ? 0 : 1));
      node = { kind: 'binary', op, left: node, right };
    }
    return node;
  }
  function reference(node) {
    if (node.kind !== 'variable') throw new Error(`Invalid assignment target in ${text}`);
    const index = run(node.index);
    if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid variable index in ${text}`);
    return {
      get: () => (node.local ? context.local(index) : context.global(index)),
      set: (value) =>
        node.local ? context.setLocal(index, value | 0) : context.setGlobal(index, value | 0),
    };
  }
  function run(node) {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'macro') return evaluate(node.value, context, depth + 1);
    if (node.kind === 'variable') return reference(node).get() | 0;
    if (node.kind === 'identifier') {
      const system = context.system?.(node.name);
      if (system !== undefined && system !== null) return system | 0;
      const macro = context.macro?.(node.name);
      if (macro !== undefined) return evaluate(macro, context, depth + 1);
      const handle = context.objectHandle?.(node.name, node.index ? run(node.index) : undefined);
      if (handle === undefined || handle === null)
        throw new Error(`Unexpected FES expression identifier '${node.name}' in ${text}`);
      return handle | 0;
    }
    if (node.kind === 'postfix' || (node.kind === 'unary' && ['++', '--'].includes(node.op))) {
      const target = reference(node.value),
        old = target.get() | 0,
        value = (old + (node.op === '++' ? 1 : -1)) | 0;
      target.set(value);
      return node.kind === 'postfix' ? old : value;
    }
    if (node.kind === 'unary') {
      const value = run(node.value);
      if (node.op === '-') return -value | 0;
      if (node.op === '+') return value;
      if (node.op === '!') return Number(!value);
      return ~value;
    }
    if (assignments.has(node.op)) {
      const target = reference(node.left),
        value =
          node.op === '='
            ? run(node.right)
            : operations[node.op.slice(0, -1)](target.get(), run(node.right));
      target.set(value);
      return value | 0;
    }
    const left = run(node.left);
    if (node.op === '&&' && !left) return 0;
    if (node.op === '||' && left) return 1;
    return operations[node.op](left, run(node.right)) | 0;
  }
  const tree = expression(1);
  if (at !== tokens.length) throw new Error(`Unexpected '${tokens[at]}' in expression ${text}`);
  return run(tree) | 0;
}

export function assign(text, context) {
  if (!/^(?:\s*(?:\+\+|--))?\s*[$\\#]/.test(text)) throw new Error(`Invalid assignment: ${text}`);
  return evaluate(text, context);
}

export function condition(line) {
  const start = line.indexOf('(');
  let depth = 0;
  if (start < 0) throw new Error(`Invalid condition: ${line}`);
  for (let i = start; i < line.length; i++) {
    if (line[i] === '(') depth++;
    if (line[i] === ')' && --depth === 0)
      return [line.slice(start + 1, i), line.slice(i + 1).replace(/^ +/, '')];
  }
  throw new Error(`Unclosed condition: ${line}`);
}
