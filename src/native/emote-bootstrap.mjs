// SPDX-License-Identifier: MPL-2.0
// Discovery reads the mounted PE only. It never enters WinMain, TLS or Steam.
import { NATIVE_ENGINE_IMAGES, nativeImageIdentity } from './engine-process.mjs';
import { parsePE32 } from '../ppi/pe32.mjs';

export const NATIVE_EMOTE_CREATE = '?EmoteCreate@@YAPAVIEmoteDevice@@ABUInitParam@1@@Z';

export async function inspectNativeM2Bootstrap(game, profile) {
  const image = NATIVE_ENGINE_IMAGES[profile];
  if (!image) throw new Error(`No reviewed native engine region profile ${profile}`);
  let result = null;
  for (const name of game.names?.('exe') ?? []) {
    const bytes = await game.require(name);
    if ((await nativeImageIdentity(bytes)) !== image.sha256) continue;
    if (result) throw new Error('Multiple matching native engine images');
    const imported = parsePE32(bytes, { allowExecutable: true }).imports.find(
      (symbol) => symbol.name === NATIVE_EMOTE_CREATE,
    );
    result = {
      name,
      sha256: image.sha256,
      required: Boolean(imported),
      driver: imported?.dll ?? null,
    };
  }
  return result;
}
