// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeUnicodeOutput } from '../../src/native/unicode-output.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
export const UNICODE_OUTPUT_PROFILE = 'nekopara-vol3-engine-2.6.1.76';

export class AuthoredClipboard {
  constructor() {
    this.events = [];
    this.contents = 'previous';
    this.available = true;
    this.acceptEmpty = true;
    this.acceptWrite = true;
    this.opened = false;
  }
  open(owner) {
    this.events.push(['open', owner]);
    if (!this.available || this.opened) return false;
    this.opened = true;
    return true;
  }
  empty() {
    this.events.push(['empty']);
    if (!this.opened || !this.acceptEmpty) return false;
    this.contents = '';
    return true;
  }
  write(text) {
    this.events.push(['write', text]);
    if (!this.opened || !this.acceptWrite) return false;
    this.contents = text;
    return true;
  }
  close() {
    this.events.push(['close']);
    const previous = this.opened;
    this.opened = false;
    return previous;
  }
}
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
