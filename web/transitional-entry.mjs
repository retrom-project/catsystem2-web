// SPDX-License-Identifier: MPL-2.0
// Explicit composition for the original-execution oracle.
import { CatSystem2 as JavaScriptPlayer } from '../src/engine.mjs';
import { NativeWorld as JavaScriptWorld } from '../src/native/world.mjs';
import {
  NativeEngineProcess,
  NATIVE_ENGINE_IMAGES,
  nativeImageIdentity,
} from '../oracle/engine-process.mjs';
import { invokeRegion, syncViewGeometry } from '../oracle/transitional-exe.mjs';
import { installOriginalWorldFeatures } from '../oracle/native-world-features.mjs';
import { parsePE32 } from '../oracle/ppi-pe32.mjs';
import {
  transitionalHeapSize,
  transitionalCheckpointBytes,
  transitionalCheckpointLimit,
} from '../oracle/transitional-heap.mjs';

import {
  installOriginalWorldRuntime,
  snapshotOriginalWorld,
  hasOriginalWorldCheckpoint,
  restoreOriginalWorld,
  bindOriginalWorldMachines,
  closeOriginalWorld,
} from '../oracle/native-world-runtime.mjs';
import { OriginalNativeWindow } from '../oracle/window-original.mjs';

import {
  ownsOriginalWorld,
  originalWorldOperation,
  originalWorldState,
} from '../oracle/world-operations.mjs';
import { createOriginalInputBrowserServices } from '../oracle/input-browser-original.mjs';
export const transitionalExe = Object.freeze({
  ownsWorld: ownsOriginalWorld,
  directShow: (world) => world.nativeEngine?.features.get('directshow'),
  worldOperation: originalWorldOperation,
  worldState: originalWorldState,
  createInputBrowserServices: createOriginalInputBrowserServices,
  installWorldRuntime: installOriginalWorldRuntime,
  createWindow: (world) => new OriginalNativeWindow(world),
  snapshotWorld: snapshotOriginalWorld,
  hasWorldCheckpoint: hasOriginalWorldCheckpoint,
  restoreWorld: restoreOriginalWorld,
  bindWorldMachines: bindOriginalWorldMachines,
  closeWorld: closeOriginalWorld,
  installWorldFeatures: installOriginalWorldFeatures,
  readTextResource: async (world, pointer) =>
    (await world.getNativeFeature('data-buffers')).data(pointer),
  checkpointBytes: transitionalCheckpointBytes,
  checkpointLimit: transitionalCheckpointLimit,
  async open(options) {
    const engine = await NativeEngineProcess.open({
      ...options,
      heapSize: options.heapSize ?? transitionalHeapSize(options.profile),
    });
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
