// SPDX-License-Identifier: MPL-2.0
import { nativeXML } from './xml.mjs';

export function installNativeScriptXML(world) {
  for (const id of [0x24e, 0x24f, 0x250, 0x251])
    world.runtime.register('main', id, (args, machine) =>
      nativeXML(id, args, machine, world.runtime.services),
    );
}
