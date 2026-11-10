// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { plainNativeText } from './text-scanner.mjs';
export async function nativePlainText(id, args, machine, world) {
  if (id !== 0x188 && id !== 0x419) return undefined;
  if (args.length !== 2) throw new Error('Native plain-text extraction expects two arguments');
  if (id === 0x419 && !nativeABI(world.profile).capabilities.utf8Text) return undefined;
  const service = world.runtime.services,
    bytes = service.formatBytes
      ? service.formatBytes(args[1], machine)
      : encodeCP932(service.format(args[1], machine));
  try {
    machine.region(args[0] >>> 0, 1);
  } catch {
    return nativeReply(1, 0);
  }
  const output = plainNativeText(bytes, id === 0x419);
  machine.bytes(args[0], output.length + 1).set([...output, 0]);
  return nativeReply(1, output.length);
}
export function installNativePlainText(world) {
  for (const id of nativeABI(world.profile).capabilities.utf8Text ? [0x188, 0x419] : [0x188])
    world.runtime.register('main', id, (args, machine) =>
      nativePlainText(id, args, machine, world),
    );
}
