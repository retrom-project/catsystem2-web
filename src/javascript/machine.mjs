// SPDX-License-Identifier: MPL-2.0
import { scriptError } from './program.mjs';

export class JavaScriptMachine {
  constructor(program) {
    this.state = {
      program,
      environments: [],
      cells: [],
      closures: [],
      frames: [],
      waiting: null,
      initialized: false,
      exitCode: null,
    };
    this.environment(0, -1, []);
    this.state.frames.push({ fn: 0, environment: 0, pc: 0, stack: [] });
  }
  environment(fn, parent, args) {
    const { state } = this,
      item = state.program.functions[fn],
      bindings = new Map(),
      id = state.environments.length;
    for (const name of item.locals) {
      bindings.set(name, state.cells.length);
      state.cells.push(undefined);
    }
    for (let i = 0; i < item.params.length; i++)
      state.cells[bindings.get(item.params[i])] = args[i];
    state.environments.push({ parent, bindings });
    return id;
  }
  cell(environment, name) {
    while (environment !== -1) {
      const item = this.state.environments[environment];
      if (item.bindings.has(name)) return item.bindings.get(name);
      environment = item.parent;
    }
    return -1;
  }
  get(environment, name, location) {
    const cell = this.cell(environment, name);
    if (cell !== -1) return this.state.cells[cell];
    if (name === 'undefined') return undefined;
    if (['cfExit', 'cfIsExecMotion', 'CsImage', 'CsPlane', 'CsSound'].includes(name))
      return { host: name };
    throw scriptError('Unsupported JavaScript host import', location, name);
  }
  set(environment, name, value, location) {
    const cell = this.cell(environment, name);
    if (cell === -1)
      throw scriptError('Unsupported JavaScript syntax', location, `undeclared assignment ${name}`);
    this.state.cells[cell] = value;
    return value;
  }
  call(name, args, host) {
    if (this.state.frames.length || this.state.exitCode !== null)
      throw new Error('JavaScript callback requires an idle program');
    const where = { source: this.state.program.source, line: 1, column: 1 },
      value = this.get(0, name, where);
    this.pushCall(value, args, where);
    return this.run(host);
  }
  pushCall(value, args, location) {
    const closure = value && this.state.closures[value.closure];
    if (!closure)
      throw scriptError(
        'Unsupported JavaScript syntax',
        location,
        'call target is not a guest function',
      );
    this.state.frames.push({
      fn: closure.fn,
      environment: this.environment(closure.fn, closure.environment, args),
      pc: 0,
      stack: [],
    });
  }
  resumeHost(value) {
    const { state } = this,
      waiting = state.waiting,
      frame = state.frames.at(-1);
    if (
      !waiting ||
      waiting.depth !== state.frames.length ||
      waiting.pc !== frame?.pc ||
      waiting.stack !== frame.stack.length
    )
      throw new Error('Invalid JavaScript host continuation');
    state.waiting = null;
    frame.stack.push(value);
  }
  run(host, budget = 100000) {
    const { state } = this;
    if (state.waiting) return { status: 'waiting', request: state.waiting.request };
    const complete = (completion, frame) => {
      if (completion?.wait) {
        state.waiting = {
          request: structuredClone(completion.wait),
          depth: state.frames.length,
          pc: frame.pc,
          stack: frame.stack.length,
        };
        return { status: 'waiting', request: state.waiting.request };
      }
      frame.stack.push(completion?.value);
      return null;
    };
    for (let used = 0; state.frames.length && used < budget; used++) {
      const frame = state.frames.at(-1),
        instruction = state.program.functions[frame.fn].code[frame.pc++];
      if (!instruction) throw new Error('Invalid JavaScript instruction pointer');
      const { op, arg, location } = instruction,
        stack = frame.stack;
      switch (op) {
        case 'constant':
          stack.push(arg);
          break;
        case 'get':
          stack.push(this.get(frame.environment, arg, location));
          break;
        case 'set':
          this.set(frame.environment, arg, stack.at(-1), location);
          break;
        case 'pop':
          stack.pop();
          break;
        case 'closure': {
          const id = state.closures.length;
          state.closures.push({ fn: arg, environment: frame.environment });
          stack.push({ closure: id });
          break;
        }
        case 'increment': {
          const before = Number(this.get(frame.environment, arg.name, location)),
            after = before + 1;
          this.set(frame.environment, arg.name, after, location);
          stack.push(arg.prefix ? after : before);
          break;
        }
        case 'unary': {
          const value = stack.pop();
          stack.push(arg === '!' ? !value : arg === '-' ? -value : +value);
          break;
        }
        case 'binary': {
          const right = stack.pop(),
            left = stack.pop();
          if (arg === '===' || arg === '!==') {
            const key = (value) =>
              value && typeof value === 'object' ? Object.keys(value)[0] : null;
            const leftKey = key(left),
              rightKey = key(right);
            const equal =
              leftKey || rightKey
                ? leftKey === rightKey && left[leftKey] === right[rightKey]
                : left === right;
            stack.push(arg === '===' ? equal : !equal);
            break;
          }
          if ((left && typeof left === 'object') || (right && typeof right === 'object'))
            throw scriptError('Unsupported JavaScript syntax', location, 'object coercion');
          switch (arg) {
            case '+':
              stack.push(left + right);
              break;
            case '-':
              stack.push(left - right);
              break;
            case '*':
              stack.push(left * right);
              break;
            case '/':
              stack.push(left / right);
              break;
            case '===':
              stack.push(left === right);
              break;
            case '!==':
              stack.push(left !== right);
              break;
            default:
              throw new Error('Invalid JavaScript binary instruction');
          }
          break;
        }
        case 'unless':
          if (!stack.pop()) frame.pc = arg;
          break;
        case 'jump':
          frame.pc = arg;
          break;
        case 'construct': {
          const args = stack.splice(stack.length - arg, arg),
            target = stack.pop();
          if (
            target?.host !== 'CsImage' &&
            target?.host !== 'CsPlane' &&
            target?.host !== 'CsSound'
          )
            throw scriptError('Unsupported JavaScript syntax', location, 'constructor');
          const result = complete(host({ construct: target.host }, args, location), frame);
          if (result) return result;
          break;
        }
        case 'member-call': {
          const args = stack.splice(stack.length - arg.count, arg.count),
            receiver = stack.pop();
          const result = complete(host({ receiver, member: arg.name }, args, location), frame);
          if (result) return result;
          break;
        }
        case 'call': {
          const args = stack.splice(stack.length - arg, arg),
            target = stack.pop();
          if (target?.host) {
            const result = complete(host(target.host, args, location), frame);
            if (result) return result;
          } else this.pushCall(target, args, location);
          break;
        }
        case 'return': {
          const value = stack.pop();
          state.frames.pop();
          if (state.frames.length) state.frames.at(-1).stack.push(value);
          else {
            state.initialized = true;
            return { status: 'returned', value };
          }
          break;
        }
        default:
          throw new Error(`Invalid JavaScript instruction ${op}`);
      }
    }
    return { status: state.frames.length ? 'paused' : 'returned' };
  }
  snapshot() {
    if (this.state.frames.length || this.state.waiting)
      throw new Error('JavaScript checkpoint requires a settled callback');
    return structuredClone(this.state);
  }
  static restore(state) {
    if (
      !state ||
      !Array.isArray(state.program?.functions) ||
      !state.program.functions.length ||
      !Array.isArray(state.environments) ||
      !Array.isArray(state.cells) ||
      !Array.isArray(state.closures) ||
      !Array.isArray(state.frames) ||
      state.frames.length ||
      state.waiting !== null ||
      !state.initialized
    )
      throw new Error('Invalid JavaScript checkpoint');
    for (const [id, environment] of state.environments.entries()) {
      if (
        !(environment.bindings instanceof Map) ||
        !Number.isInteger(environment.parent) ||
        environment.parent < -1 ||
        environment.parent >= id ||
        [...environment.bindings].some(
          ([name, cell]) =>
            typeof name !== 'string' ||
            !Number.isInteger(cell) ||
            cell < 0 ||
            cell >= state.cells.length,
        )
      )
        throw new Error('Invalid JavaScript lexical environment');
    }
    for (const closure of state.closures)
      if (
        !Number.isInteger(closure.fn) ||
        !state.program.functions[closure.fn] ||
        !Number.isInteger(closure.environment) ||
        !state.environments[closure.environment]
      )
        throw new Error('Invalid JavaScript closure');
    for (const value of state.cells)
      if (
        typeof value === 'function' ||
        (value &&
          typeof value === 'object' &&
          (Object.keys(value).length !== 1 ||
            !(
              (Number.isInteger(value.closure) && state.closures[value.closure]) ||
              value.host === 'cfExit' ||
              value.host === 'CsImage' ||
              value.host === 'CsPlane' ||
              value.host === 'CsSound' ||
              (Number.isSafeInteger(value.hostObject) && value.hostObject > 0)
            )))
      )
        throw new Error('Invalid JavaScript cell');
    const machine = Object.create(JavaScriptMachine.prototype);
    machine.state = structuredClone(state);
    return machine;
  }
}
