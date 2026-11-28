// SPDX-License-Identifier: MPL-2.0
// The only implementations of original pointer/feature operations.
export function ownsOriginalWorld(world) {
  return Boolean(world.nativeEngine || world.nativeEngineLoading);
}
export async function originalWorldOperation(world, operation, args) {
  switch (operation) {
    case 'feature': {
      const [name, method, values] = args,
        feature = await world.getNativeFeature(name);
      return feature[method](...values);
    }
    case 'externalWord':
      return (await world.ensureNativeEngine()).process.load(args[0]);
    case 'bitmapHandle': {
      const platform = await world.getNativeFeature('graphics-platform');
      return platform.imageHandle(args[0], args[1]);
    }
    case 'unwrapBitmapWrapper': {
      const platform = await world.getNativeFeature('graphics-platform');
      return platform.imageHandle(platform.process.load(args[0]), args[1]);
    }
    case 'refreshBitmapImports': {
      const platform = await world.getNativeFeature('graphics-platform');
      for (const { wrapper } of args[0])
        platform.imageHandle(platform.process.load(wrapper), args[1]);
      return;
    }
    case 'releaseOwnerImages':
      return world.nativeEngine?.features.get('graphics-platform')?.releaseOwnerImages(args[0]);
    case 'bitmapVRAM': {
      const [source, words, task] = args,
        platform = await world.getNativeFeature('graphics-platform');
      await platform.ensureRenderer();
      return platform.withBitmap(
        source,
        (p) => platform.copyBitmap(p, ...words.slice(6, 10), words[1], words[2]),
        task.id,
      );
    }
    case 'registerTaskOutput': {
      const [out, id] = args,
        p = world.nativeEngine.process,
        tasks = await world.getNativeFeature('task-memory');
      p.store(out, await tasks.pointer(id));
      return (value) => p.store(out, value);
    }
    default:
      throw new Error('Unknown original World adapter operation ' + operation);
  }
}

export function originalWorldState(world, name, args) {
  const engine = world.nativeEngine,
    feature = (key) => engine?.features.get(key);
  switch (name) {
    case 'hasEngine':
      return Boolean(engine);
    case 'profile':
      return engine?.profile;
    case 'fromHost':
      return Boolean(engine?.process.asyncEnabled);
    case 'resourceKernel':
      return engine?.kernel;
    case 'callerAddress':
      return feature('task-memory')?.refs.entries.get(args[0])?.pointer;
    case 'sharedMemory':
      return engine?.process;
    case 'sharedReference': {
      const [nativePointer, memory, address, length] = args;
      return (nativePointer && engine) || (length && memory === engine?.process)
        ? { kind: 'engine', address, length }
        : undefined;
    }
    case 'syncTask':
      return feature('task-memory')?.sync(args[0]);
    case 'releaseMachine':
      return feature('task-memory')?.releaseMachine(args[0]);
    case 'releaseScene':
      return feature('scene-memory')?.release(args[0]);
    case 'releaseOwnerImages':
      return feature('graphics-platform')?.releaseOwnerImages(args[0]);
    case 'syncView':
      return feature('graphics-platform')?.syncView?.();
    case 'movieRelease':
      return feature('plane-movie-projection')?.release(args[0]);
    case 'movieFrame':
      return feature('plane-movie-projection').frame(args[0]);
    case 'bitmapMemory':
      return feature('bitmap-memory');
    case 'forgetImage':
      return feature('graphics-platform')?.forgetImageHandle(args[0]);
    case 'disposeBitmapContext':
      return feature('bitmap-factories')?.disposeContext?.(args[0]);
    case 'registry':
      return feature('registry');
    default:
      throw new Error('Unknown original state observation ' + name);
  }
}
