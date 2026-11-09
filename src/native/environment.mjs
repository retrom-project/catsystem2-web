// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';

export function nativeEnvironment(id, args, machine, services = {}) {
  const count = new Map([
    [8, 2],
    [0x189, 1],
    [0x190, 2],
    [0x2e3, 2],
    [0x3aa, 0],
  ]).get(id);
  if (count === undefined) return undefined;
  if (args.length !== count)
    throw new Error(`KCS environment native 0x${id.toString(16)} expects ${count} arguments`);
  if (id === 8) {
    if (!services.screen) return undefined;
    const [width, height] = services.view
      ? services.view.virtualSize()
      : [services.screen.width, services.screen.height];
    machine.store(args[0], width);
    machine.store(args[1], height);
  } else if (id === 0x2e3) {
    if (!services.view) return undefined;
    const [x, y] = services.view.border();
    machine.store(args[0], x);
    machine.store(args[1], y);
  } else if (id === 0x189) {
    if (!services.systemMenu?.setEnabled) return undefined;
    services.systemMenu.setEnabled(0x77, args[0] !== 0);
  } else if (id === 0x3aa) {
    const loaded = services.soundConfiguration?.loaded ?? services.soundConfigurationAvailable;
    if (loaded === undefined) return undefined;
    return nativeReply(1, Number(loaded));
  } else {
    if (!services.read || !services.format || !services.sound?.primary) return undefined;
    const file = services.format(args[1], machine);
    return Promise.resolve(services.read(file, 'sound')).then((bytes) => {
      if (bytes) {
        const sound = services.sound.primary();
        if (!sound) throw new Error('Native base task does not expose its sound task');
        sound.loadLoopPoints(bytes);
      } else
        services.diagnostic?.({
          native: id,
          resource: file,
          error: 'Loop point resource was not found',
        });
      return nativeReply(2);
    });
  }
  return nativeReply(2);
}
