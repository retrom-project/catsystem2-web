// SPDX-License-Identifier: MPL-2.0
import { originalOwner, originalFeature } from './original-adapter.mjs';
import { nativeABI } from './abi/index.mjs';
// Main 1BD retains the original VM formatter and crosses the browser boundary
// only at its own MessageBox call, independently of other USER32 callers.
import { nativeReply } from '../kcs/vm.mjs';
import { registryDecodeANSI } from './registry-codepage.mjs';
import { formatNativeAt } from '../kcs.mjs';
import { nativeDataString } from './data-text.mjs';
import { decodeWindowsCP932 } from '../ppi/windows-multibyte.mjs';

export function installNativeScriptMessageBox(world) {
  const wide = nativeABI(world.profile).capabilities.unicodeOutput;
  world.runtime.register('main', 0x1bd, async (args, machine, task) => {
    if (originalOwner(world))
      return originalFeature(world, 'script-message-box', 'invoke', args, machine, task);
    const bytes = nativeDataString(formatNativeAt(args[0] ?? machine.nativeArgument(0), machine)),
      message = wide ? decodeWindowsCP932(bytes) : registryDecodeANSI(bytes),
      result = await world.window.action('script-message-box', {
        caption: 'system error',
        message,
      });
    if (result !== 0 && result !== 1)
      throw new TypeError('Script MessageBox requires a Win32 IDOK or failure result');
    return nativeReply(2);
  });
}
