// SPDX-License-Identifier: MPL-2.0
// A finite, data-only JavaScript program. Source is never passed to the host VM.
export function scriptError(kind, location, detail) {
  const error = new Error(
    `${kind}: ${detail} (${location.source}:${location.line}:${location.column})`,
  );
  error.name = kind === 'Unsupported JavaScript syntax' ? 'SyntaxError' : 'Error';
  error.location = { ...location };
  return error;
}

const reserved = new Set(
  'var function return if else true false null new while for do switch break continue try catch throw this let const class with delete typeof void in instanceof yield async await'.split(
    ' ',
  ),
);
const precedence = new Map([
  ['===', 1],
  ['!==', 1],
  ['+', 2],
  ['-', 2],
  ['*', 3],
  ['/', 3],
]);

function tokenize(source, name) {
  let at = 0,
    line = 1,
    column = 1;
  const tokens = [],
    location = () => ({ source: name, line, column, offset: at }),
    take = () => {
      const char = source[at++];
      if (char === '\n') {
        line++;
        column = 1;
      } else column++;
      return char;
    },
    fail = (where, detail) => {
      throw scriptError('Unsupported JavaScript syntax', where, detail);
    };
  while (at < source.length) {
    if (/\s/.test(source[at])) {
      take();
      continue;
    }
    if (source.startsWith('//', at)) {
      while (at < source.length && take() !== '\n') {
        /* Consume the comment. */
      }
      continue;
    }
    if (source.startsWith('/*', at)) {
      const start = location();
      take();
      take();
      while (at < source.length && !source.startsWith('*/', at)) take();
      if (at === source.length) fail(start, 'unterminated comment');
      take();
      take();
      continue;
    }
    const start = location();
    let value = '',
      kind;
    if (/[A-Za-z_$]/.test(source[at])) {
      while (at < source.length && /[\w$]/.test(source[at])) value += take();
      kind = reserved.has(value) ? 'keyword' : 'identifier';
    } else if (/\d/.test(source[at])) {
      const match = /^(?:\d+(?:\.\d*)?)(?:[eE][+-]?\d+)?/.exec(source.slice(at))[0];
      for (let i = 0; i < match.length; i++) take();
      value = Number(match);
      kind = 'literal';
    } else if (source[at] === '"' || source[at] === "'") {
      const quote = take();
      while (at < source.length && source[at] !== quote) {
        let char = take();
        if (char === '\n' || char === '\r') fail(start, 'newline in string');
        if (char === '\\') {
          char = take();
          const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
          if (char === 'u' || char === 'x') {
            const count = char === 'u' ? 4 : 2;
            let hex = '';
            for (let i = 0; i < count; i++) hex += take() ?? '';
            if (!new RegExp(`^[0-9a-fA-F]{${count}}$`).test(hex))
              fail(start, 'invalid string escape');
            char = String.fromCharCode(Number.parseInt(hex, 16));
          } else char = escapes[char] ?? char;
        }
        value += char;
      }
      if (take() !== quote) fail(start, 'unterminated string');
      kind = 'literal';
    } else {
      value = ['===', '!==', '++'].find((op) => source.startsWith(op, at)) ?? source[at];
      if (
        ![
          '===',
          '!==',
          '++',
          '+',
          '-',
          '*',
          '/',
          '!',
          '=',
          '(',
          ')',
          '{',
          '}',
          ';',
          ',',
          '.',
        ].includes(value)
      )
        fail(start, `token ${value}`);
      for (let i = 0; i < value.length; i++) take();
      kind = 'punctuation';
    }
    tokens.push({ kind, value, location: start });
  }
  tokens.push({ kind: 'end', value: '', location: location() });
  return tokens;
}

class Parser {
  constructor(source, name) {
    this.tokens = tokenize(source, name);
    this.at = 0;
    this.depth = 0;
  }
  get token() {
    return this.tokens[this.at];
  }
  fail(token = this.token, detail = `token ${token.value || '<end>'}`) {
    throw scriptError('Unsupported JavaScript syntax', token.location, detail);
  }
  is(value) {
    const kind = reserved.has(value) ? 'keyword' : 'punctuation';
    return this.token.kind === kind && this.token.value === value;
  }
  accept(value) {
    if (!this.is(value)) return false;
    return this.tokens[this.at++];
  }
  expect(value) {
    return this.accept(value) || this.fail();
  }
  identifier() {
    if (this.token.kind !== 'identifier') this.fail();
    return this.tokens[this.at++];
  }
  endStatement() {
    if (!this.accept(';') && !this.is('}') && this.token.kind !== 'end') this.fail();
  }
  body() {
    const statements = [];
    while (this.token.kind !== 'end' && !this.is('}')) statements.push(this.statement());
    return statements;
  }
  function(declaration) {
    const token = this.expect('function'),
      name = declaration ? this.identifier().value : '';
    this.expect('(');
    const params = [];
    if (!this.is(')'))
      do {
        params.push(this.identifier().value);
      } while (this.accept(','));
    if (new Set(params).size !== params.length) this.fail(token, 'duplicate parameters');
    this.expect(')');
    this.expect('{');
    this.depth++;
    const body = this.body();
    this.expect('}');
    this.depth--;
    return { type: 'function', name, params, body, location: token.location };
  }
  statement() {
    const token = this.token;
    if (this.is('function'))
      return { type: 'declaration', fn: this.function(true), location: token.location };
    if (this.accept('{')) {
      const body = this.body();
      this.expect('}');
      return { type: 'block', body, location: token.location };
    }
    if (this.accept('var')) {
      const bindings = [];
      do {
        const name = this.identifier().value;
        bindings.push({ name, init: this.accept('=') ? this.expression() : null });
      } while (this.accept(','));
      this.endStatement();
      return { type: 'var', bindings, location: token.location };
    }
    if (this.accept('return')) {
      if (!this.depth || this.token.location.line !== token.location.line)
        this.fail(token, 'return placement or automatic semicolon insertion');
      const value = this.is(';') || this.is('}') ? null : this.expression();
      this.endStatement();
      return { type: 'return', value, location: token.location };
    }
    if (this.accept('if')) {
      this.expect('(');
      const condition = this.expression();
      this.expect(')');
      const yes = this.statement(),
        no = this.accept('else') ? this.statement() : null;
      return { type: 'if', condition, yes, no, location: token.location };
    }
    if (this.accept(';')) return { type: 'block', body: [], location: token.location };
    const value = this.expression();
    this.endStatement();
    return { type: 'expression', value, location: token.location };
  }
  expression(minimum = 0) {
    let left = this.primary();
    while (
      this.token.kind === 'punctuation' &&
      precedence.has(this.token.value) &&
      precedence.get(this.token.value) >= minimum
    ) {
      const token = this.tokens[this.at++],
        right = this.expression(precedence.get(token.value) + 1);
      left = { type: 'binary', operator: token.value, left, right, location: token.location };
    }
    if (!minimum && this.accept('=')) {
      if (left.type !== 'identifier' && left.type !== 'member')
        this.fail(this.token, 'assignment target');
      left = {
        type: left.type === 'member' ? 'member-assignment' : 'assignment',
        ...(left.type === 'member' ? { target: left.target } : {}),
        name: left.name,
        value: this.expression(),
        location: left.location,
      };
    }
    return left;
  }
  primary() {
    const token = this.token;
    let value;
    if (this.accept('++')) {
      const name = this.identifier();
      return { type: 'increment', name: name.value, prefix: true, location: token.location };
    }
    if (token.kind === 'punctuation' && ['!', '-', '+'].includes(token.value)) {
      this.at++;
      return {
        type: 'unary',
        operator: token.value,
        value: this.primary(),
        location: token.location,
      };
    }
    if (this.accept('new')) {
      const name = this.identifier();
      this.expect('(');
      const args = [];
      if (!this.is(')'))
        do {
          args.push(this.expression());
        } while (this.accept(','));
      this.expect(')');
      value = {
        type: 'construct',
        target: { type: 'identifier', name: name.value, location: name.location },
        args,
        location: token.location,
      };
    } else if (this.is('function')) value = this.function(false);
    else if (this.accept('(')) {
      value = this.expression();
      this.expect(')');
    } else if (token.kind === 'literal') {
      this.at++;
      value = { type: 'literal', value: token.value, location: token.location };
    } else if (token.kind === 'keyword' && ['true', 'false', 'null'].includes(token.value)) {
      this.at++;
      value = {
        type: 'literal',
        value: token.value === 'null' ? null : token.value === 'true',
        location: token.location,
      };
    } else {
      const id = this.identifier();
      value = { type: 'identifier', name: id.value, location: id.location };
    }
    for (;;) {
      if (this.accept('.')) {
        const name = this.identifier();
        value = { type: 'member', target: value, name: name.value, location: name.location };
      } else if (this.accept('(')) {
        const args = [];
        if (!this.is(')'))
          do {
            args.push(this.expression());
          } while (this.accept(','));
        this.expect(')');
        value = { type: 'call', target: value, args, location: value.location };
      } else if (this.accept('++')) {
        if (value.type !== 'identifier') this.fail(token, 'increment target');
        value = { type: 'increment', name: value.name, prefix: false, location: value.location };
      } else return value;
    }
  }
}

export function compileJavaScript(source, name) {
  const parser = new Parser(source, name),
    body = parser.body();
  if (parser.token.kind !== 'end') parser.fail();
  const program = { source: name, functions: [] };
  const compile = (fn) => {
    const id = program.functions.length,
      item = { name: fn.name, params: fn.params, locals: [...fn.params], code: [] },
      declarations = [],
      emit = (op, arg, location = fn.location) => {
        const at = item.code.length;
        item.code.push({ op, arg, location });
        return at;
      };
    program.functions.push(item);
    const collect = (statement, topLevel) => {
      if (statement.type === 'var')
        for (const { name } of statement.bindings) item.locals.push(name);
      if (statement.type === 'declaration') {
        if (!topLevel)
          throw scriptError(
            'Unsupported JavaScript syntax',
            statement.location,
            'block or conditional function declaration',
          );
        item.locals.push(statement.fn.name);
        declarations.push(statement.fn);
      }
      if (statement.type === 'block') statement.body.forEach((child) => collect(child, false));
      if (statement.type === 'if') {
        collect(statement.yes, false);
        if (statement.no) collect(statement.no, false);
      }
    };
    fn.body.forEach((statement) => collect(statement, true));
    item.locals = [...new Set(item.locals)];
    const expression = (node) => {
      const where = node.location;
      switch (node.type) {
        case 'literal':
          emit('constant', node.value, where);
          break;
        case 'identifier':
          emit('get', node.name, where);
          break;
        case 'function':
          emit('closure', compile(node), where);
          break;
        case 'assignment':
          expression(node.value);
          emit('set', node.name, where);
          break;
        case 'member-assignment':
          expression(node.target);
          expression(node.value);
          emit('member-set', node.name, where);
          break;
        case 'increment':
          emit('increment', { name: node.name, prefix: node.prefix }, where);
          break;
        case 'unary':
          expression(node.value);
          emit('unary', node.operator, where);
          break;
        case 'binary':
          expression(node.left);
          expression(node.right);
          emit('binary', node.operator, where);
          break;
        case 'construct':
          expression(node.target);
          node.args.forEach(expression);
          emit('construct', node.args.length, where);
          break;
        case 'call':
          if (node.target.type === 'member') {
            expression(node.target.target);
            node.args.forEach(expression);
            emit('member-call', { name: node.target.name, count: node.args.length }, where);
          } else {
            expression(node.target);
            node.args.forEach(expression);
            emit('call', node.args.length, where);
          }
          break;
        default:
          throw scriptError('Unsupported JavaScript syntax', where, node.type);
      }
    };
    const statement = (node) => {
      switch (node.type) {
        case 'declaration':
          break;
        case 'block':
          node.body.forEach(statement);
          break;
        case 'var':
          for (const { name, init } of node.bindings)
            if (init) {
              expression(init);
              emit('set', name, node.location);
              emit('pop');
            }
          break;
        case 'expression':
          expression(node.value);
          emit('pop');
          break;
        case 'return':
          if (node.value) expression(node.value);
          else emit('constant', undefined);
          emit('return');
          break;
        case 'if': {
          expression(node.condition);
          const skip = emit('unless', 0, node.location);
          statement(node.yes);
          const end = emit('jump', 0);
          item.code[skip].arg = item.code.length;
          if (node.no) statement(node.no);
          item.code[end].arg = item.code.length;
          break;
        }
        default:
          throw scriptError('Unsupported JavaScript syntax', node.location, node.type);
      }
    };
    for (const declaration of declarations) {
      emit('closure', compile(declaration));
      emit('set', declaration.name);
      emit('pop');
    }
    fn.body.forEach(statement);
    emit('constant', undefined);
    emit('return');
    return id;
  };
  compile({
    name: '<program>',
    params: [],
    body,
    location: { source: name, line: 1, column: 1, offset: 0 },
  });
  return program;
}
