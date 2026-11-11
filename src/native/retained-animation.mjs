// SPDX-License-Identifier: MPL-2.0
// ANM has an independent fixed-width bytecode and the World's integer RNG.
import { truncateFloat32 as trunc } from '../ppi/numeric.mjs';
const f = Math.fround;
const initialOutput = () => ({ frame: 0xffffffff, alpha: 255, display: 1, x: 0, y: 0 });

export class RetainedAnimation {
  constructor(bytes, random) {
    this.random = random;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.length < 32 ||
      view.getUint32(0, true) !==
        0x004d4e41 /* exe-address-check: non-address - little-endian ANM file signature */
    )
      throw new Error('Invalid ANM header');
    const count = view.getUint32(8, true);
    if (!count || count > Math.floor((bytes.length - 32) / 68))
      throw new Error('Invalid ANM instruction count');
    this.headerWord = view.getUint32(4, true);
    this.instructions = Array.from({ length: count }, (_, i) => {
      const at = 32 + i * 68;
      return {
        opcode: view.getUint32(at, true),
        operands: Array.from({ length: 8 }, (_, j) => [
          view.getUint32(at + 4 + j * 8, true),
          view.getUint32(at + 8 + j * 8, true),
        ]),
      };
    });
    this.registers = new Uint32Array(64);
    this.baseFrame = this.startFrame = 0;
    this.speed = 1;
    this.maxFrameKey = 0;
    this.reset();
  }
  reset() {
    this.pc = -1;
    this.duration = 0;
    this.output = initialOutput();
  }
  start(frame) {
    this.baseFrame = this.startFrame = frame >>> 0;
  }
  setVariable(index, value) {
    if (index >>> 0 < 64) this.registers[index >>> 0] = value;
  }
  register(index) {
    if (index >>> 0 >= 64) throw new Error('Invalid ANM bytecode register index');
    return this.registers[index >>> 0];
  }
  setRegister(index, value) {
    this.register(index);
    this.registers[index >>> 0] = value;
  }
  range(low, high) {
    const span = (high - low) >>> 0;
    return span ? ((this.random.rand() % span) + low) >>> 0 : low;
  }
  step(frame, budget = 65536) {
    frame = frame >>> 0 === 0xffffffff ? this.baseFrame : frame >>> 0;
    if (!this.baseFrame) this.baseFrame = frame;
    let elapsed = trunc(f(f((frame - this.baseFrame) | 0) * f(this.speed)));
    const before = Object.values(this.output);
    while (this.pc < this.instructions.length && elapsed >= (this.duration | 0)) {
      if (--budget < 0) throw new Error('ANM instruction budget exhausted');
      if (++this.pc >= this.instructions.length) break;
      const { opcode, operands } = this.instructions[this.pc];
      const values = operands.map(([mode, word]) =>
        mode === 0 || mode === 2 ? word : mode === 1 ? this.register(word) : 0,
      );
      const [a, b, c] = values,
        jump = (target) => {
          if (target & 0x80000000) throw new Error('Invalid ANM negative jump target');
          this.pc = target - 1;
        },
        wait = (low, high) => {
          this.baseFrame = (this.baseFrame + this.duration) >>> 0;
          elapsed = (elapsed - this.duration) | 0;
          this.duration = this.range(low, high);
        };
      switch (opcode) {
        case 0:
          this.output.frame = a;
          wait(b, c);
          break;
        case 1:
          this.setRegister(a, this.range(b, c));
          break;
        case 2:
          if ((this.register(a) | 0) > 0) this.registers[a]--;
          else jump(b);
          break;
        case 3:
          jump(a);
          break;
        case 4:
          if ((a | 0) > 0) jump(b);
          break;
        case 5:
          if (a === b) jump(c);
          break;
        case 6:
          if (a !== b) jump(c);
          break;
        case 7:
          if ((a | 0) > (b | 0)) jump(c);
          break;
        case 8:
          if ((a | 0) < (b | 0)) jump(c);
          break;
        case 9:
          if ((a | 0) >= (b | 0)) jump(c);
          break;
        case 10:
          if ((a | 0) <= (b | 0)) jump(c);
          break;
        case 11:
          this.setRegister(a, this.maxFrameKey);
          break;
        case 12:
          this.output.alpha = a;
          break;
        case 13:
          this.output.display = a;
          break;
        case 14:
          this.output.x = a | 0;
          this.output.y = b | 0;
          break;
        case 15:
          wait(a, b);
          break;
        case 16:
          this.setRegister(a, (this.register(a) + b) >>> 0);
          break;
        case 17:
          this.setRegister(a, (this.register(a) - b) >>> 0);
          break;
        default:
          throw new Error(`Unsupported ANM opcode ${opcode}`);
      }
    }
    return Object.values(this.output).some((word, i) => word !== before[i]);
  }
  snapshot() {
    const { random, ...state } = this;
    void random;
    return structuredClone(state);
  }
  static restore(state, random) {
    return Object.assign(Object.create(RetainedAnimation.prototype), structuredClone(state), {
      random,
    });
  }
}
