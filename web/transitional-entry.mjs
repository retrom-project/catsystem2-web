// SPDX-License-Identifier: MPL-2.0
// Composition for the transitional product. src/engine.mjs stays host-free.
import { CatSystem2 as JavaScriptPlayer } from '../src/engine.mjs';
import { NativeWorld as JavaScriptWorld } from '../src/native/world.mjs';
import {
  NativeEngineProcess,
  NATIVE_ENGINE_IMAGES,
  nativeImageIdentity,
} from '../src/native/engine-process.mjs';
import { invokeRegion, syncViewGeometry } from '../oracle/transitional-exe.mjs';
import { parsePE32 } from '../src/ppi/pe32.mjs';

export const transitionalExe = Object.freeze({
  async open(options) {
    const engine = await NativeEngineProcess.open(options);
    engine.transitionalExe = transitionalExe;
    return engine;
  },
  invokeRegion,
  syncViewGeometry,
  async inspectBootstrap(game, profile) {
    const image = NATIVE_ENGINE_IMAGES[profile];
    if (!image) throw new Error(`No reviewed native engine region profile ${profile}`);
    let result = null;
    for (const name of game.names?.('exe') ?? []) {
      const bytes = await game.require(name);
      if ((await nativeImageIdentity(bytes)) !== image.sha256) continue;
      if (result) throw new Error('Multiple matching native engine images');
      const imported = parsePE32(bytes, { allowExecutable: true }).imports.find(
        (symbol) => symbol.name === '?EmoteCreate@@YAPAVIEmoteDevice@@ABUInitParam@1@@Z',
      );
      result = {
        name,
        sha256: image.sha256,
        required: Boolean(imported),
        driver: imported?.dll ?? null,
      };
    }
    return result;
  },
});

export class CatSystem2 extends JavaScriptPlayer {
  constructor(options) {
    super({ ...options, transitionalExe });
  }
}

export class NativeWorld extends JavaScriptWorld {
  constructor(options) {
    super({ ...options, transitionalExe });
  }
}
