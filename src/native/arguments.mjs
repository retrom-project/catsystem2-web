// SPDX-License-Identifier: MPL-2.0
// Original main21B expression arrays/ranges and main21C space-token offsets.
import { nativeReply } from '../kcs/vm.mjs';
import { evaluateNativeExpression } from './expression.mjs';

function mapped(machine, address) {
  try {
    machine.region(address >>> 0, 1);
    return true;
  } catch {
    return false;
  }
}
export function nativeArguments(id, args, machine, services = {}) {
  if (id !== 0x21b && id !== 0x21c) return undefined;
  if (args.length !== (id === 0x21b ? 3 : 2))
    throw new Error(`Native argument decoder 0x${id.toString(16)} has invalid arguments`);
  const byte = (offset) => machine.load((args[0] + offset) >>> 0, 1),
    word = (value) => nativeReply(1, value >>> 0);
  if (id === 0x21c) {
    const index = args[1] >>> 0;
    let at = 0;
    if (!index) return word(0);
    for (let current = 0; current < index; current++) {
      while (byte(at) && byte(at) !== 32) at++;
      if (!byte(at)) return word(-1);
      while (byte(at) === 32) at++;
    }
    return word(at);
  }
  if (!mapped(machine, args[0]) || !mapped(machine, args[1])) return word(0);
  if (services.variables === undefined) return undefined;
  const capacity = args[2] | 0,
    bank = services.variables,
    read = (at, stop) => {
      const bytes = [];
      let value;
      while ((value = byte(at)) && !stop(value)) {
        if (bytes.length === 259)
          throw new RangeError('Native argument expression exceeds its 260-byte scratch buffer');
        bytes.push(value);
        at++;
      }
      return { text: new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)), at };
    },
    evaluate = (text) => {
      if (!bank) throw new Error('Native argument expression requires its caller variable bank');
      return evaluateNativeExpression(text, bank, services.variableExpressionContext);
    },
    write = (index, value) => machine.store((args[1] + index * 4) >>> 0, value);
  if (byte(0) !== 91) {
    if (capacity <= 0) return word(0);
    write(0, evaluate(read(0, () => false).text));
    return word(1);
  }
  let comma = false;
  for (let at = 0, value; (value = byte(at)); at++)
    if (value === 44) {
      comma = true;
      break;
    }
  if (comma) {
    let at = 1,
      count = 0;
    while (count < capacity && byte(at) && byte(at) !== 93) {
      const expression = read(at, (b) => b === 44 || b === 93);
      write(count++, evaluate(expression.text));
      at = expression.at;
      if (byte(at) === 44) at++;
    }
    return word(count);
  }
  const first = read(1, (b) => b === 45 || b === 93),
    start = evaluate(first.text) | 0,
    last = read(first.at + Number(byte(first.at) === 45), (b) => b === 93),
    end = evaluate(last.text) | 0;
  let count = 0;
  for (let value = start; value <= end && count < capacity; value = (value + 1) | 0)
    write(count++, value);
  return word(count);
}
