// SPDX-License-Identifier: MPL-2.0
// Compile the shared numerical operation sequence to standard WebAssembly
// f32 operations. No reassociation, fast-math, host eval or third-party binary.
import { BICUBIC_OPERATIONS } from './bicubic-operations.mjs';

const unsigned = (value) => {
  const bytes = [];
  do {
    const next = value & 127;
    value >>>= 7;
    bytes.push(next | (value ? 128 : 0));
  } while (value);
  return bytes;
};
const signed = (value) => {
  const bytes = [];
  let more;
  do {
    const next = value & 127;
    value >>= 7;
    more = !((value === 0 && !(next & 64)) || (value === -1 && next & 64));
    bytes.push(next | (more ? 128 : 0));
  } while (more);
  return bytes;
};
const name = (text) => [text.length, ...new TextEncoder().encode(text)],
  section = (id, bytes) => [id, ...unsigned(bytes.length), ...bytes],
  register = (index, lane = 0) => 1 + index * 4 + lane,
  iteration = 33,
  absoluteBits = 34,
  scratch = [35, 36, 37, 38],
  coordinates = 0x1000,
  stackInput = 0x200,
  controlInput = 0x300,
  registers = 0x400,
  oneInput = 0x500;
let compiled;

function compile() {
  const code = [],
    emit = (...bytes) => code.push(...bytes),
    constant = (value) => emit(0x41, ...signed(value)),
    get = (local) => emit(0x20, ...unsigned(local)),
    set = (local) => emit(0x21, ...unsigned(local)),
    zero = () => emit(0x43, 0, 0, 0, 0),
    loadAt = (address) => {
      constant(address);
      emit(0x2a, 2, 0);
    },
    returnFailure = () => {
      constant(0);
      emit(0x0f);
    },
    normal = (local) => {
      // Zero is valid. Reject nonfinite values and anything closer to the
      // normal/subnormal boundary than 2*FLT_MIN. This includes underflow
      // which rounds up to FLT_MIN; the exact-status interpreter handles it.
      get(local);
      emit(0xbc);
      constant(0x7fffffff);
      emit(0x71, 0x22, absoluteBits);
      constant(0);
      emit(0x47, 0x04, 0x40);
      get(absoluteBits);
      constant(0x01000000);
      emit(0x49);
      get(absoluteBits);
      constant(0x7f800000);
      emit(0x4f, 0x72, 0x04, 0x40);
      returnFailure();
      emit(0x0b, 0x0b);
    },
    memoryValue = (local, address) => {
      loadAt(address);
      set(local);
      normal(local);
    },
    coordinateAddress = (component) => {
      get(iteration);
      constant(8);
      emit(0x6c);
      constant(coordinates + component * 4);
      emit(0x6a);
    },
    coordinateValue = (component) => {
      coordinateAddress(component);
      emit(0x2a, 2, 0);
    },
    move = (d, s) => {
      for (let i = 0; i < 4; i++) {
        get(register(s, i));
        set(register(d, i));
      }
    },
    scalarLoad = (d, address) => {
      memoryValue(register(d), address);
      for (let i = 1; i < 4; i++) {
        zero();
        set(register(d, i));
      }
    },
    arithmetic = (d, operation, loadOperand) => {
      get(d);
      set(scratch[0]);
      loadOperand();
      set(scratch[1]);
      normal(scratch[1]);
      get(scratch[0]);
      get(scratch[1]);
      emit(operation);
      set(d);
      normal(d);
      if (operation === 0x94) {
        // A zero product with nonzero inputs could have underflowed to zero.
        get(d);
        zero();
        emit(0x5b);
        for (const local of scratch.slice(0, 2)) {
          get(local);
          zero();
          emit(0x5c, 0x71);
        }
        emit(0x04, 0x40);
        returnFailure();
        emit(0x0b);
      }
    };
  // The public function is (count:i32)->success:i32, with 32 f32 register
  // locals, two integer temporaries and four parallel-shuffle temporaries.
  emit(3, 32, 0x7d, 2, 0x7f, 4, 0x7d);
  for (let i = 0; i < 32; i++) {
    loadAt(registers + i * 4);
    set(i + 1);
  }
  for (const index of [2, 7]) for (let lane = 0; lane < 4; lane++) normal(register(index, lane));
  constant(0);
  set(iteration);
  emit(0x02, 0x40, 0x03, 0x40);
  get(iteration);
  get(0);
  emit(0x4f, 0x0d, 1);
  for (const [operation, d, a, b] of BICUBIC_OPERATIONS) {
    if (operation === 'stack') scalarLoad(d, stackInput + a - 24);
    else if (operation === 'control') scalarLoad(d, controlInput + a * 4);
    else if (operation === 'one') scalarLoad(d, oneInput);
    else if (operation === 'move') move(d, a);
    else if (operation === 'table')
      for (let i = 0; i < 4; i++) memoryValue(register(d, i), stackInput + a - 24 + i * 4);
    else if (operation === 'coordAdd') arithmetic(register(d), 0x92, () => coordinateValue(a));
    else if (operation === 'controlMul')
      arithmetic(register(d), 0x94, () => loadAt(controlInput + a * 4));
    else if (['scalarAdd', 'scalarSub', 'scalarMul'].includes(operation))
      arithmetic(
        register(d),
        { scalarAdd: 0x92, scalarSub: 0x93, scalarMul: 0x94 }[operation],
        () => get(register(a)),
      );
    else if (operation === 'add' || operation === 'multiply')
      for (let i = 0; i < 4; i++)
        arithmetic(register(d, i), operation === 'add' ? 0x92 : 0x94, () =>
          a === 8 ? loadAt(stackInput + 24 + i * 4) : get(register(a, i)),
        );
    else if (operation === 'shuffle' || operation === 'unpack') {
      const source =
        operation === 'unpack'
          ? [register(d), register(a), register(d, 1), register(a, 1)]
          : [
              register(d, b & 3),
              register(d, (b >>> 2) & 3),
              register(a, (b >>> 4) & 3),
              register(a, (b >>> 6) & 3),
            ];
      for (let i = 0; i < 4; i++) {
        get(source[i]);
        set(scratch[i]);
      }
      for (let i = 0; i < 4; i++) {
        get(scratch[i]);
        set(register(d, i));
      }
    } else if (operation === 'store') {
      coordinateAddress(d);
      get(register(a));
      emit(0x38, 2, 0);
    } else throw new Error('Unknown bicubic kernel operation ' + operation);
  }
  get(iteration);
  constant(1);
  emit(0x6a);
  set(iteration);
  emit(0x0c, 0, 0x0b, 0x0b);
  for (let i = 0; i < 32; i++) {
    constant(registers + i * 4);
    get(i + 1);
    emit(0x38, 2, 0);
  }
  constant(1);
  emit(0x0b);
  const bytes = Uint8Array.from([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]),
    ...section(3, [1, 0]),
    ...section(5, [1, 1, 1, ...unsigned(129)]),
    ...section(7, [2, ...name('memory'), 2, 0, ...name('run'), 0, 0]),
    ...section(10, [1, ...unsigned(code.length), ...code]),
  ]);
  return new WebAssembly.Module(bytes);
}

export class BicubicKernel {
  constructor() {
    const instance = new WebAssembly.Instance((compiled ??= compile()));
    this.memory = instance.exports.memory;
    this.run = instance.exports.run;
    this.hits = 0;
  }
  execute({ mxcsr, count, stack, control, registerValues, one, bytes }) {
    // Precision is already sticky. The guarded kernel cannot add any other
    // exception bit, so the complete original MXCSR remains unchanged.
    if ((mxcsr & 0xffe0) !== 0x1fa0) return null;
    const required = coordinates + bytes.length;
    if (this.memory.buffer.byteLength < required)
      this.memory.grow(Math.ceil((required - this.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(this.memory.buffer),
      floats = new Float32Array(this.memory.buffer);
    memory.set(stack, stackInput);
    memory.set(control, controlInput);
    floats.set(registerValues.subarray(0, 32), registers / 4);
    floats[oneInput / 4] = one;
    memory.set(bytes, coordinates);
    if (!this.run(count)) return null;
    this.hits++;
    return {
      bytes: memory.subarray(coordinates, required),
      registers: floats.subarray(registers / 4, registers / 4 + 32),
    };
  }
}
