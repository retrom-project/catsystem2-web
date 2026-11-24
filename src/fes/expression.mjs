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
  return evaluateTokens(tokens, text, context, depth, false);
}

function evaluateTokens(tokens, text, context, depth, operand) {
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
    if (operand && token?.kind === 'number') node = token;
    else if (token === '(') {
      node = expression(1);
      required(')');
    } else if (['$', '\\', '#'].includes(token)) {
      let index;
      if (take('(')) {
        index = expression(1);
        required(')');
      } else {
        const number = tokens[at++];
        if (operand && number?.kind === 'number') index = number;
        else if (/^\d+$/.test(number || '')) index = { kind: 'number', value: Number(number) };
        else if (!operand && context.macro?.(number) !== undefined)
          index = { kind: 'macro', value: context.macro(number) };
        else throw new Error(`Invalid variable index in ${text}`);
      }
      node = { kind: 'variable', local: token === '\\', index };
    } else if (/^(0x[\da-f]+|\d+)$/i.test(token))
      node = { kind: 'number', value: Number(token) | 0 };
    else {
      if (operand && token?.kind !== 'identifier')
        throw new Error(`Unsupported FES operand token in ${text}`);
      let index;
      if (take('[')) {
        index = expression(1);
        required(']');
      }
      node = operand ? { ...token, index } : { kind: 'identifier', name: token, index };
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
      if (operand) return context.valueLookup(node.nameBytes, node.index ? run(node.index) : 0) | 0;
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
      if (node.left.kind === 'number' && context.discardLiteralAssignmentWrites) {
        // The original interpreter evaluates the right operand and reports
        // zero when the left operand has no variable reference.
        run(node.right);
        return 0;
      }
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

// Normal common numeric operands own raw tokens. Independent String callers
// retain evaluate's tokenizer and macro behavior above.
const operandOperators = [
  ...assignments,
  ...Object.keys(precedence),
  '++',
  '--',
  '!',
  '~',
  '(',
  ')',
  '[',
  ']',
  '$',
  '\\',
  '#',
].sort((a, b) => b.length - a.length);
const asciiLetter = (byte) =>
  (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte === 95;
const asciiDigit = (byte) => byte >= 48 && byte <= 57;
function operandTokens(bytes, context) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('FES numeric operands require raw bytes');
  const tokens = [];
  for (let at = 0; at < bytes.length; ) {
    const byte = bytes[at];
    if (!byte || byte === 26) break;
    if ([9, 10, 13, 32].includes(byte)) {
      at++;
      continue;
    }
    if (byte === 92 && bytes[at + 1] === 13 && bytes[at + 2] === 10) {
      at += 3;
      continue;
    }
    if (byte === 47 && bytes[at + 1] === 47) {
      at += 2;
      while (at < bytes.length && bytes[at] && !(bytes[at] === 13 && bytes[at + 1] === 10)) at++;
      continue;
    }
    if (byte === 47 && bytes[at + 1] === 42) {
      at += 2;
      while (at < bytes.length && bytes[at] && !(bytes[at] === 42 && bytes[at + 1] === 47)) at++;
      if (bytes[at] !== 42) throw new Error('Unproved FES operand comment domain');
      at += 2;
      continue;
    }
    if (byte === 39) {
      let word = 0,
        closed = false;
      at++;
      while (at < bytes.length && bytes[at]) {
        // Both original helpers shift the WORD before testing the closing quote.
        word = (word << 8) & 0xffff;
        if (bytes[at] === 39) {
          at++;
          closed = true;
          break;
        }
        if (bytes[at] === 92 && [39, 92].includes(bytes[at + 1])) at++;
        word = (word | ((bytes[at++] << 24) >> 24)) & 0xffff;
      }
      if (!closed) throw new Error('Unproved FES character-literal domain');
      tokens.push({ kind: 'number', value: word });
      continue;
    }
    if (byte === 34) {
      let closed = false;
      at++;
      while (at < bytes.length && bytes[at]) {
        // A high narrow byte may own a trail5C. Do not classify it as an escape.
        if (bytes[at] >= 128) throw new Error('Unproved FES double-quote literal domain');
        if (bytes[at] === 34) {
          at++;
          closed = true;
          break;
        }
        at += bytes[at] === 92 && bytes[at + 1] === 34 ? 2 : 1;
      }
      if (!closed) throw new Error('Unproved FES double-quote literal domain');
      tokens.push({ kind: 'number', value: 0 }); // Original id15 has no integer value case.
      continue;
    }
    if (asciiDigit(byte)) {
      let value = 0;
      if (byte === 48 && [88, 120].includes(bytes[at + 1])) {
        at += 2;
        while (at < bytes.length) {
          const b = bytes[at],
            digit = asciiDigit(b)
              ? b - 48
              : b >= 65 && b <= 70
                ? b - 55
                : b >= 97 && b <= 102
                  ? b - 87
                  : -1;
          if (digit < 0) break;
          value = (value << 4) | digit | 0;
          at++;
        }
      } else while (asciiDigit(bytes[at])) value = (Math.imul(value, 10) + bytes[at++] - 48) | 0;
      if (bytes[at] === 46) throw new Error('Unproved FES operand floating-literal domain');
      tokens.push({ kind: 'number', value });
      continue;
    }
    if (byte === 64) {
      tokens.push({ kind: 'number', value: (context.system?.('@') ?? 0) | 0 });
      at++;
      continue;
    }
    if (asciiLetter(byte)) {
      const name = [];
      while (at < bytes.length) {
        if (asciiLetter(bytes[at]) || asciiDigit(bytes[at])) name.push(bytes[at++]);
        else if (bytes[at] === 92 && [39, 34].includes(bytes[at + 1])) {
          name.push(bytes[at + 1]);
          at += 2;
        } else break;
      }
      if (name.length > 31) throw new Error('Unproved FES numeric name scratch domain');
      tokens.push({
        kind: 'identifier',
        name: String.fromCharCode(...name),
        nameBytes: Uint8Array.from(name),
      });
      continue;
    }
    const operator = operandOperators.find((op) =>
      [...op].every((c, i) => bytes[at + i] === c.charCodeAt(0)),
    );
    if (operator) {
      tokens.push(operator);
      at += operator.length;
      continue;
    }
    if (byte >= 128) throw new Error('Unsupported FES numeric name byte 0x' + byte.toString(16));
    throw new Error('Unsupported FES numeric operand byte 0x' + byte.toString(16));
  }
  return tokens;
}
export function evaluateOperand(bytes, context) {
  const tokens = operandTokens(bytes, context);
  if (!tokens.length) return 0;
  const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return evaluateTokens(tokens, text, context, 0, true);
}
