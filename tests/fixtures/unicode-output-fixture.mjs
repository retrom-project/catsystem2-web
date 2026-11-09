// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeUnicodeOutput } from '../../oracle/unicode-output.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
export const UNICODE_OUTPUT_PROFILE = 'nekopara-vol3-engine-2.6.1.76';

import { AuthoredClipboard } from './unicode-output-services.mjs';
export { AuthoredClipboard } from './unicode-output-services.mjs';

export async function unicodeOutputFixture(bytes) {
  const engine = await NativeEngineProcess.open({ bytes, profile: UNICODE_OUTPUT_PROFILE }),
    clipboard = new AuthoredClipboard(),
    logs = [],
    world = {
      profile: UNICODE_OUTPUT_PROFILE,
      objects: { machine: () => null },
      runtime: {
        services: {
          nativeWindowHandle: () => 0x12345678,
          nativeClipboard: clipboard,
          nativeDebugOutput: (bytes) => {
            logs.push(bytes.slice());
          },
        },
      },
    },
    feature = new NativeUnicodeOutput(engine, world),
    machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024));
  return { engine, clipboard, logs, world, feature, machine };
}
