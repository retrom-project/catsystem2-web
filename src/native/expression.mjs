// SPDX-License-Identifier: MPL-2.0
// Integer expression contracts recovered from the native kcInterpriter.
import { encodeCP932 } from '../kcs/strings.mjs';

const symbols = new Map([
  ['#', 1],
  ['$', 2],
  ['$$', 3],
  ['\\', 4],
  ['!', 128],
  ['!=', 129],
  ['%', 130],
  ['&', 131],
  ['&&', 132],
  ['(', 133],
  [')', 134],
  ['*', 135],
  ['+', 136],
  ['++', 137],
  [',', 139],
  ['-', 140],
  ['--', 141],
  ['->', 143],
  ['.', 144],
  ['...', 145],
  ['/', 146],
  [':', 147],
  [';', 148],
  ['<', 149],
  ['<<', 150],
  ['<=', 151],
  ['=', 152],
  ['%=', 153],
  ['&=', 154],
  ['*=', 155],
  ['+=', 156],
  ['-=', 157],
  ['/=', 158],
  ['<<=', 159],
  ['==', 160],
  ['>>=', 161],
  ['^=', 162],
  ['|=', 163],
  ['>', 164],
  ['>=', 165],
  ['>>', 166],
  ['?', 167],
  ['[', 168],
  [']', 169],
  ['^', 170],
  ['{', 171],
  ['|', 172],
  ['||', 173],
  ['}', 174],
  ['~', 175],
]);
const bindings = new Map(
  [
    [0, 0, 0],
    [1, 30, 31],
    [2, 30, 31],
    [3, 30, 31],
    [4, 30, 31],
    [128, 28, 29],
    [129, 19, 18],
    [130, 27, 26],
    [131, 17, 16],
    [132, 11, 10],
    [133, 0, 33],
    [134, 32, 0],
    [135, 27, 26],
    [136, 25, 24],
    [137, 29, 28],
    [138, 28, 29],
    [140, 25, 24],
    [141, 29, 28],
    [142, 28, 29],
    [146, 27, 26],
    [148, 1, 0],
    [149, 21, 20],
    [150, 23, 22],
    [151, 21, 20],
    [152, 4, 5],
    [153, 4, 5],
    [154, 4, 5],
    [155, 4, 5],
    [156, 4, 5],
    [157, 4, 5],
    [158, 4, 5],
    [159, 4, 5],
    [160, 19, 18],
    [161, 4, 5],
    [162, 4, 5],
    [163, 4, 5],
    [164, 21, 20],
    [165, 21, 20],
    [166, 23, 22],
    [168, 0, 33],
    [169, 32, 0],
    [170, 15, 14],
    [172, 13, 12],
    [173, 9, 8],
    [175, 0, 29],
    [176, 28, 29],
    [177, 28, 29],
    [190, -1, 0],
  ].map(([id, left, right]) => [id, { left, right }]),
);
const arity = (id) =>
  [1, 2, 3, 4, 128, 137, 141, 175, 176, 177].includes(id)
    ? 2
    : [138, 142].includes(id)
      ? 1
      : [171, 174].includes(id)
        ? 0
        : 3;
const digit = (b) => b >= 48 && b <= 57;
const alpha = (b) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 95;
const pair = (b, trail) =>
  ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef)) &&
  ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc));

function tokenize(text, contextValue) {
  const bytes = encodeCP932(text),
    tokens = [];
  const add = (kind, id, value = 0, name) => {
    if (tokens.length >= 256) throw new Error('Native expression token capacity exceeded');
    tokens.push({ kind, id, value: value | 0, name, left: null, right: null });
  };
  for (let at = 0; at < bytes.length; ) {
    const b = bytes[at];
    if (!b || b === 26) break;
    if (b === 92 && bytes[at + 1] === 13 && bytes[at + 2] === 10) {
      at += 3;
      continue;
    }
    if (b === 47 && bytes[at + 1] === 47) {
      while (at < bytes.length && !(bytes[at] === 13 && bytes[at + 1] === 10)) at++;
      continue;
    }
    if (b === 47 && bytes[at + 1] === 42) {
      at += 2;
      while (at < bytes.length && !(bytes[at] === 42 && bytes[at + 1] === 47)) at++;
      at += 2;
      continue;
    }
    if ([9, 10, 13, 32].includes(b)) {
      at++;
      continue;
    }
    if (digit(b)) {
      const start = at;
      if (b === 48 && [88, 120].includes(bytes[at + 1])) {
        at += 2;
        let value = 0;
        while (at < bytes.length && /[\da-f]/i.test(String.fromCharCode(bytes[at])))
          value = (value * 16 + parseInt(String.fromCharCode(bytes[at++]), 16)) | 0;
        add(5, 13, value);
        continue;
      }
      let value = 0;
      while (digit(bytes[at])) value = (Math.imul(value, 10) + bytes[at++] - 48) | 0;
      if (bytes[at] === 46) {
        at++;
        while (digit(bytes[at])) at++;
        if ([70, 102].includes(bytes[at])) at++;
        add(5, 14); // The integer evaluator has no float-value case.
      } else add(5, 13, value);
      if (at <= start) throw new Error('Native expression tokenizer did not advance');
      continue;
    }
    if (b === 39) {
      at++;
      let value = 0,
        closed = false;
      while (at < bytes.length) {
        value = (value << 8) & 0xffff;
        if (bytes[at] === 39) {
          at++;
          closed = true;
          break;
        }
        if (bytes[at] === 92 && [39, 92].includes(bytes[at + 1])) at++;
        value = (value | ((bytes[at++] << 24) >> 24)) & 0xffff;
      }
      if (!closed) throw new Error('Unclosed native character literal');
      add(5, 13, value);
      continue;
    }
    if (b === 34) {
      at++;
      while (at < bytes.length) {
        if (bytes[at] === 34) {
          at++;
          break;
        }
        if ((bytes[at] === 92 && bytes[at + 1] === 34) || pair(bytes[at], bytes[at + 1])) at++;
        at++;
      }
      add(5, 15);
      continue;
    }
    let matched = false;
    for (const length of [3, 2, 1]) {
      const spelling = String.fromCharCode(...bytes.subarray(at, at + length));
      if (spelling.length !== length || !symbols.has(spelling)) continue;
      add(6, symbols.get(spelling));
      at += length;
      matched = true;
      break;
    }
    if (matched) continue;
    if (b === 64) {
      add(5, 13, contextValue);
      at++;
      continue;
    }
    if (alpha(b)) {
      const start = at++;
      while (alpha(bytes[at]) || digit(bytes[at])) at++;
      add(4, 7, 0, String.fromCharCode(...bytes.subarray(start, at)));
      continue;
    }
    add(0, 0);
    at += pair(b, bytes[at + 1]) ? 2 : 1;
  }
  let previousKind = 0,
    previousId = 0;
  for (const token of tokens) {
    if ([1, 2, 3, 4].includes(token.id)) token.kind = 6;
    if (
      [136, 140].includes(token.id) &&
      (!previousKind || [6, 7].includes(previousKind)) &&
      ![134, 169].includes(previousId)
    )
      token.id = token.id === 136 ? 176 : 177;
    if ([137, 141].includes(token.id) && (previousKind === 4 || [134, 169].includes(previousId)))
      token.id = token.id === 137 ? 138 : 142;
    previousKind = token.kind;
    previousId = token.id;
  }
  return tokens;
}

function parse(tokens) {
  const end = { kind: 6, id: 190 },
    operators = [end],
    values = [];
  for (const token of [...tokens, end]) {
    if ([4, 5].includes(token.kind)) {
      values.push(token);
      continue;
    }
    if (token.kind !== 6 && token.kind !== 7) continue;
    if (token.kind === 7) {
      operators.push(token);
      continue;
    }
    for (let reductions = 0; ; reductions++) {
      if (reductions > 512 || !operators.length) throw new Error('Malformed native expression');
      const top = operators.at(-1);
      if ((bindings.get(top.id)?.left ?? 0) < (bindings.get(token.id)?.right ?? 0)) {
        operators.push(token);
        break;
      }
      if (top.id === 133 && token.id === 134) {
        operators.pop();
        break;
      }
      if (top.id === 168 && token.id === 169) {
        operators.pop();
        const index = values.pop();
        if (!values.length) throw new Error('Native expression index has no value');
        values.at(-1).right = index ?? null;
        break;
      }
      if (top === end) throw new Error('Unbalanced native expression');
      operators.pop();
      const count = arity(top.id);
      if (count === 2 || count === 3) top.right = values.pop() ?? null;
      if (count === 1 || count === 3) top.left = values.pop() ?? null;
      values.push(top);
    }
    if (token === end) break;
  }
  return values.at(-1) ?? null;
}

export function evaluateNativeExpression(text, bank, context = {}) {
  if (!text) return 0;
  const privateWords =
    context.privateWords === undefined ? bank.privateWords : context.privateWords;
  const tree = parse(tokenize(text, bank.contextValue));
  const value = (ref) => {
    if (ref.region) {
      const words = ref.region === 'global' ? bank.words : privateWords;
      if (!words || ref.value >>> 0 >= words.length)
        throw new Error(`Native expression ${ref.region} index ${ref.value} is not mapped`);
      return words[ref.value >>> 0] | 0;
    }
    return ref.value | 0;
  };
  const write = (ref, word) => {
    if (!ref.region) return 0;
    value(ref);
    (ref.region === 'global' ? bank.words : privateWords)[ref.value >>> 0] = word >>> 0;
    if (ref.region === 'global') bank.dirty = true;
    return word | 0;
  };
  const quotient = (a, b) => {
    if (!b || (a === -2147483648 && b === -1))
      throw new RangeError('Native expression division trap');
    return Math.trunc(a / b) | 0;
  };
  function run(node, depth = 0) {
    const out = { value: 0, result: 0 };
    if (!node) return out;
    if (depth > 256) throw new Error('Native expression recursion bound');
    const left = () => run(node.left, depth + 1),
      right = () => run(node.right, depth + 1);
    const id = node.id;
    if (id === 13) return { value: node.value, result: node.value };
    if ([1, 2, 3, 4].includes(id)) {
      if (!node.right) return out;
      const ref = { region: id <= 2 ? 'global' : 'private', value: value(right()) };
      return { ...ref, result: value(ref) };
    }
    if (id === 7) {
      const index = node.right ? value(right()) : 0;
      const found = context.lookup
        ? context.lookup(node.name, index)
        : (bank.getName?.(node.name, index) ?? 0);
      return { value: found | 0, result: found | 0 };
    }
    if ([128, 175, 176, 177].includes(id)) {
      if (!node.right) return out;
      const a = value(right()),
        n = id === 128 ? Number(!a) : id === 175 ? ~a : id === 177 ? -a | 0 : a;
      return { value: n, result: id === 176 ? 0 : n };
    }
    if ([137, 138, 141, 142].includes(id)) {
      if (!(id === 138 || id === 142 ? node.left : node.right)) return out;
      const ref = id === 138 || id === 142 ? left() : right();
      if (!ref.region) return out;
      const old = value(ref),
        next = write(ref, old + (id === 137 || id === 138 ? 1 : -1));
      return {
        value: id === 138 || id === 142 ? old : next,
        result: id === 138 || id === 142 ? old : next,
      };
    }
    if (!node.left || !node.right) return out;
    // Unhandled compiler tokens have an explicit default-zero branch and do not evaluate their children.
    if (
      ![
        129, 130, 131, 132, 135, 136, 140, 146, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158,
        159, 160, 161, 162, 163, 164, 165, 166, 170, 172, 173,
      ].includes(id)
    )
      return out;
    const lhs = left(),
      rhs = right(),
      a = value(lhs),
      b = value(rhs);
    let n;
    switch (id) {
      case 129:
        n = Number(a !== b);
        break;
      case 130:
        if (b) quotient(a, b);
        n = b ? a % b | 0 : 0;
        break;
      case 131:
        n = a & b;
        break;
      case 132:
        n = Number(Boolean(a) && Boolean(b));
        break;
      case 135:
        n = Math.imul(a, b);
        break;
      case 136:
        n = (a + b) | 0;
        break;
      case 140:
        n = (a - b) | 0;
        break;
      case 146:
        n = b ? quotient(a, b) : 0;
        break;
      case 149:
        n = Number(a < b);
        break;
      case 150:
        n = a << b;
        break;
      case 151:
        n = Number(a <= b);
        break;
      case 152:
        n = write(lhs, b);
        break;
      case 153:
        quotient(a, b);
        n = write(lhs, a % b | 0);
        break;
      case 154:
        n = write(lhs, a & b);
        break;
      case 155:
        n = write(lhs, Math.imul(a, b));
        break;
      case 156:
        n = write(lhs, (a + b) | 0);
        break;
      case 157:
        n = write(lhs, (a - b) | 0);
        break;
      case 158:
        n = write(lhs, quotient(a, b));
        break;
      case 159:
        n = write(lhs, a << b);
        break;
      case 160:
        n = Number(a === b);
        break;
      case 161:
        n = write(lhs, a >> b);
        break;
      case 162:
        n = write(lhs, a ^ b);
        break;
      case 163:
        n = write(lhs, a | b);
        break;
      case 164:
        n = Number(a > b);
        break;
      case 165:
        n = Number(a >= b);
        break;
      case 166:
        n = a >> b;
        break;
      case 170:
        n = a ^ b;
        break;
      case 172:
        n = a | b;
        break;
      case 173:
        n = Number(Boolean(a) || Boolean(b));
        break;
    }
    return { value: n | 0, result: n | 0 };
  }
  return run(tree).result | 0;
}
