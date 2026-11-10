// SPDX-License-Identifier: MPL-2.0
import { bitmapMemoryFixture } from './bitmap-memory-fixture.mjs';
import { NativeImageCommands } from '../../oracle/image-commands.mjs';

export async function imageCommandsFixture(bytes, profile) {
  const f = await bitmapMemoryFixture(bytes, profile, { uploadBoundary: true });
  return { ...f, commands: new NativeImageCommands(f.engine, f.world) };
}
