import { installOriginalStagePresentation } from './stage-present-original.mjs';
import { installOriginalImageImport } from './image-import-original.mjs';
import { NativeGlobalStringsBridge } from './global-strings-bridge.mjs';
import { NativeScriptReplacementsBridge } from './script-replacements-bridge.mjs';
import { NativeRandomMemory } from './random-memory.mjs';
import { NativeInputDevice } from './input-device.mjs';
import { installNativeWindowEvents } from './window-events.mjs';
// SPDX-License-Identifier: MPL-2.0
import { NativeRegistry } from './registry-original.mjs';
import {
  NativeScriptMessageBox,
  NATIVE_SCRIPT_MESSAGE_BOX,
} from './script-message-box-original.mjs';
import { originalVersionQuery } from './version-query-original.mjs';

import { NativeTaskDump } from './task-dump-original.mjs';
import { NativeInputCommands } from './input-commands-original.mjs';
import { NativeTilePlaneCommand } from './tile-plane-command-original.mjs';
import { installOriginalSDKJavaScriptTasks } from './sdk-javascript-task-original.mjs';
import { installNativeTaskMemory } from './task-memory.mjs';
import { NativeSceneMemory } from './scene-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';
import { createNativeDataProjection } from './data-projection-host.mjs';

import { installOriginalGraphics } from './graphics-features.mjs';

export function installOriginalWorldFeatures(world) {
  world.registerNativeFeature(
    'global-strings',
    (engine) => new NativeGlobalStringsBridge(engine, world.globalStrings),
  );
  world.registerNativeFeature(
    'script-replacements',
    (engine) => new NativeScriptReplacementsBridge(engine, world.configuration),
  );
  world.registerNativeFeature(
    'random-memory',
    (engine) => new NativeRandomMemory(engine, world.random),
  );
  world.registerNativeFeature('input-device', (engine) => new NativeInputDevice(engine, world));
  installNativeWindowEvents(world);
  world.registerNativeFeature('bitmap-factories', (engine) => {
    const owner = world.bitmapFactories;
    engine.registerFeature('bitmap-factories', owner);
    return owner;
  });
  world.registerNativeFeature('bitmap-operations', (engine) => {
    const owner = world.bitmapOperations;
    engine.registerFeature('bitmap-operations', owner);
    return owner;
  });
  world.registerNativeFeature('draw-commands', (engine) => {
    const owner = world.drawCommands;
    engine.registerFeature('draw-commands', owner);
    return owner;
  });
  world.registerNativeFeature('image-composites', (engine) => {
    const owner = world.imageComposites;
    engine.registerFeature('image-composites', owner);
    return owner;
  });
  world.registerNativeFeature('image-files', (engine) => {
    const owner = world.imageFiles;
    engine.registerFeature('image-files', owner);
    return owner;
  });
  world.registerNativeFeature('image-owners', (engine) => {
    const owner = world.imageOwners;
    engine.registerFeature('image-owners', owner);
    return owner;
  });
  world.registerNativeFeature('render-sources', (engine) => {
    const owner = world.renderSources;
    engine.registerFeature('render-sources', owner);
    return owner;
  });
  world.registerNativeFeature('screen-capture', (engine) => {
    const owner = world.screenCapture;
    engine.registerFeature('screen-capture', owner);
    return owner;
  });
  world.registerNativeFeature('display-logs', (engine) => {
    const owner = world.displayLogs;
    engine.registerFeature('display-logs', owner);
    return owner;
  });
  world.registerNativeFeature('text', async (engine) =>
    engine.createTextConsumerView(await world.text.runtime()),
  );
  world.registerNativeFeature('legacy-text', (engine) => {
    const owner = world.legacyText;
    owner.originalMemory = () => ({
      load: (at) => engine.process.load(at),
      store: (at, n) => engine.process.store(at, n),
      bytes: (at, n) => engine.process.read(at, n),
    });
    engine.registerFeature('legacy-text', owner);
    return owner;
  });

  world.registerNativeFeature('registry', (engine) => {
    if (!world.storage?.readPlatform || !world.storage?.writePlatform)
      throw new Error('Registry requires persistent browser platform storage');
    return NativeRegistry.open(engine, { world });
  });
  const layout = NATIVE_SCRIPT_MESSAGE_BOX[world.profile];
  if (layout)
    world.registerNativeFeature(
      'script-message-box',
      (engine) => new NativeScriptMessageBox(engine, world, layout),
    );
  world.originalVersionQuery = (...args) => originalVersionQuery(world, ...args);
  installNativeTaskMemory(world);
  installNativeEngineFiles(world);
  world.registerNativeFeature('scene-memory', (engine) => new NativeSceneMemory(engine, world));
  world.registerNativeFeature('task-dump', (engine) => new NativeTaskDump(engine, world));
  world.registerNativeFeature('input-commands', (engine) => new NativeInputCommands(engine, world));
  world.registerNativeFeature(
    'tile-plane-command',
    (engine) => new NativeTilePlaneCommand(engine, world),
  );
  world.registerNativeFeature('bitmap-memory', async (engine) => {
    await world.getNativeFeature('data-buffers');
    if (typeof engine.createBitmapProjection !== 'function')
      throw new Error('Bitmap projection requires the injected original host');
    return engine.createBitmapProjection(world);
  });
  installOriginalSDKJavaScriptTasks(world);
  world.registerNativeFeature('data-buffers', (engine) =>
    createNativeDataProjection(engine, {
      source: world.runtime.imageDataBuffers,
      handles: world.runtime.handles,
      read: world.runtime.read,
      diagnostic: (detail) => world.host.nativeDiagnostic?.(detail),
    }),
  );
  world.runtime.services.dataBuffers = async () =>
    (await world.getNativeFeature('data-buffers')).attachServices({
      handles: world.runtime.handles,
      read: world.runtime.read,
      diagnostic: (detail) => world.host.nativeDiagnostic?.(detail),
    });

  installOriginalGraphics(world);
  installOriginalImageImport(world);
  installOriginalStagePresentation(world);
}
