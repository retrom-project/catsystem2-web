// SPDX-License-Identifier: MPL-2.0
// These are the original FES m2_getconf/m2_setconf manager entry points.
import { encodeCP932 } from '../src/kcs/strings.mjs';
const methods = Object.freeze({
  motion: [0x581300, 0x580f70],
  eff_dif: [0x581370, 0x580fe0],
  eff_iner: [0x5813e0, 0x581050],
  eff_blink: [0x581450, 0x5810c0],
  eff_lip: [0x5814c0, 0x581130],
  fade: [0x581530, 0x5811a0],
  iner_lv: [0x5815a0, 0x581210],
  iner_enable: [0x581600, 0x581290],
  interleave: [0x581660, 0x581670],
});
export class NativeEmoteConfiguration {
  constructor(owner) {
    this.owner = owner;
  }
  get pointer() {
    return this.owner.process.load(0xb9bd98);
  }
  withPart(part, fn) {
    const p = this.owner.process,
      object = p.allocate(24, true),
      bytes = encodeCP932(part + '\0'),
      input = p.allocate(bytes.length);
    p.write(input, bytes);
    try {
      p.call(0x5223d0, [input], object);
      return fn(object);
    } finally {
      p.call(0x522420, [], object);
      p.free(input);
      p.free(object);
    }
  }
  get(name, part) {
    const method = methods[name];
    if (!method || !this.pointer || (name.startsWith('iner_') && part === undefined))
      return undefined;
    if (this.owner.engine.pendingCalls)
      throw new Error('M2 configuration cannot be read during native execution');
    const p = this.owner.process;
    return name.startsWith('iner_')
      ? this.withPart(part, (object) => p.call(method[0], [object], this.pointer))
      : p.call(method[0], [], this.pointer);
  }
  set(name, value, part) {
    const method = methods[name],
      pointer = this.pointer;
    if (
      !pointer ||
      (!method && name !== 'reset') ||
      (name.startsWith('iner_') && part === undefined)
    )
      return false;
    if (this.owner.engine.pendingCalls)
      throw new Error('M2 configuration cannot be changed during native execution');
    const p = this.owner.process;
    if (name === 'reset') p.call(0x581680, [], pointer);
    else if (name.startsWith('iner_'))
      this.withPart(part, (object) =>
        p.call(method[1], [object, (value ?? (name === 'iner_lv' ? 100 : 1)) >>> 0], pointer),
      );
    else p.call(method[1], [(value ?? (name === 'interleave' ? 0 : 1)) >>> 0], pointer);
    return true;
  }
}
