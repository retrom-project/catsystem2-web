// SPDX-License-Identifier: MPL-2.0
// Main188 uses the original rich-text parser, including its default state.
import { nativeABI } from '../src/native/abi/index.mjs';
import { nativeReply } from '../src/kcs/vm.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const bindings = {
  'nekopara-vol3-engine-2.6.1.76': {
    construct: 0x692520,
    set: 0x693250,
    parse: 0x6932a0,
    extract: 0x694920,
    destroy: 0x692a90,
  },
  'sdk-4.01-engine-2.6.1.74': {
    construct: 0x569030,
    set: 0x569d40,
    parse: 0x569d90,
    extract: 0x56b4a0,
    destroy: 0x569580,
  },
};
const utf8 = {
  construct: 0x697e00,
  set: 0x698a90,
  parse: 0x698b80,
  extract: 0x69a300,
  destroy: 0x6983a0,
};
export async function nativePlainText(id, args, machine, world) {
  if (id !== 0x188 && id !== 0x419) return undefined;
  if (args.length !== 2) throw new Error('Native plain-text extraction expects two arguments');
  const service = world.runtime.services,
    bytes = service.formatBytes
      ? service.formatBytes(args[1], machine)
      : encodeCP932(service.format(args[1], machine)),
    runtime = await world.getNativeFeature('text'),
    p = runtime.process,
    layout =
      id === 0x419 && nativeABI(world.profile).capabilities.utf8Text
        ? utf8
        : id === 0x188
          ? bindings[world.profile]
          : null;
  if (!layout) throw new Error('Plain-text extraction requires a reviewed native profile');
  let mapped = false,
    constructed = false;
  try {
    machine.region(args[0] >>> 0, 1);
    mapped = true;
  } catch {
    /* Original VM translates this address to NULL. */
  }
  // Both original temporary objects fit this buffer. The engine constructor
  // and destructor own their containers; no replacement parser is involved.
  const core = p.allocate(0x300, true),
    input = p.allocate(bytes.length + 1, true),
    output = p.allocate(Math.max(8192, bytes.length * 2 + 1), true);
  try {
    p.write(input, Uint8Array.from([...bytes, 0]));
    await runtime.call(layout.construct, [], core);
    constructed = true;
    if (!mapped) return nativeReply(1, 0);
    await runtime.call(layout.set, [input], core);
    await runtime.call(layout.parse, [], core);
    await runtime.call(layout.extract, [output], core);
    const result = p.stringBytes(output);
    machine.bytes(args[0], result.length + 1).set([...result, 0]);
    return nativeReply(1, result.length);
  } finally {
    try {
      if (constructed) await runtime.call(layout.destroy, [], core);
    } finally {
      p.free(output);
      p.free(input);
      p.free(core);
    }
  }
}
export function installNativePlainText(world) {
  for (const id of nativeABI(world.profile).capabilities.utf8Text ? [0x188, 0x419] : [0x188])
    world.runtime.register('main', id, (args, machine) =>
      nativePlainText(id, args, machine, world),
    );
}
