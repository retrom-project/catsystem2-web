// SPDX-License-Identifier: MPL-2.0
// Explicit original-FES evidence composition. This file is never shipped.
import { NativeDataBuffers as ConsumerDataBuffers } from './data-buffer-projection.mjs';
import {
  NativeDataBuffers as OriginalDataBuffers,
  NATIVE_DATA_BUFFER_LAYOUTS,
} from './data-buffer.mjs';
import { installNativeHG3Delta } from './hg3-delta.mjs';
import { NativeFESDrawProjection } from './fes-draw-projection.mjs';
import { NativeImageOwnerProjection } from './image-owner-projection.mjs';
import { NativeDisplayLogProjection } from './text-log-projection.mjs';
import { NativeFESTextProjection } from './fes-text-projection.mjs';
import { NativeFESScreenEffectProjection } from './fes-screen-effect-projection.mjs';
import { NativeRetainedDraw } from '../src/native/retained-draw.mjs';
import { NativeDrawTask } from '../src/native/draw-task.mjs';
import { bitsFloat } from '../src/kcs.mjs';
import { nativeDataArgument } from '../src/native/data-text.mjs';

class OriginalFESDataBuffers extends ConsumerDataBuffers {
  constructor(engine, options) {
    super(engine, options);
    this.layout = NATIVE_DATA_BUFFER_LAYOUTS[engine.profile];
    if (engine.module) this.detachHG3Delta = installNativeHG3Delta(engine);
  }
  close() {
    this.detachHG3Delta?.();
    super.close();
  }
}
for (const method of ['metadataPointer', 'decodePointer', 'decodeBitmapPointer', 'fileMetadata'])
  OriginalFESDataBuffers.prototype[method] = OriginalDataBuffers.prototype[method];

class OriginalFESRetainedInput extends NativeRetainedDraw {
  async bind(draw, key, fields, context = {}) {
    const kind = fields.slice(0, 4).findIndex(Boolean);
    if (kind < 0) return false;
    const projection = context.nativePointer
        ? await this.world.getNativeFeature('fes-draw-projection')
        : null,
      inputToken = projection ? projection.identity(fields) : fields[kind];
    let record = this.record(draw, key);
    if (!record || (kind !== 2 && (record.kind !== kind || record.inputToken !== inputToken))) {
      let source;
      if (context.nativePointer) {
        source = await projection.importSource(fields);
      } else if (kind === 0) source = await this.fromBitmap(fields[0]);
      else if (kind === 1) source = await this.fromData(fields[1]);
      else if (kind === 2) source = this.sources.retain(fields[2]);
      else source = this.fromOwner(fields[3]);
      if (!source) return false;
      if (record) await this.sources.release(record.source);
      record = {
        surface: draw.record.id,
        key: key >>> 0,
        kind,
        input: fields[kind],
        inputToken,
        source,
      };
      this.items.set(this.key(draw, key), record);
    }
    if (projection && kind === 0) await projection.refreshBitmap(fields[0]);
    const source = this.sources.get(record.source);
    Object.assign(source, {
      position: fields.slice(4, 6).map(bitsFloat),
      base: fields.slice(6, 8).map(bitsFloat),
      rotation: bitsFloat(fields[8]),
      scale: fields.slice(9, 11).map(bitsFloat),
      baseAlpha: fields[11] >>> 0,
      baseShown: fields[12] >>> 0,
      mode: fields[13] >>> 0,
    });
    if (fields[14]) source.aux = fields[14];
    source.revision++;
    return this.pull(draw, record);
  }
  async update(...args) {
    await super.update(...args);
    this.world.nativeEngine?.features.get('fes-draw-projection')?.publish();
  }
}
class OriginalFESDrawInput extends NativeDrawTask {
  async message(words, context = {}) {
    const [sender, message, w, l] = words;
    if (context.nativePointer && [280, 282].includes(message) && this.state.renderer) {
      const memory =
          context.payload ?? this.world.objects.machine(context.nativeSenderWorldID ?? sender),
        fields = Array.from({ length: 15 }, (_, i) => memory.load(l + i * 4));
      await this.retained().bind(this, (sender | (w << 16)) >>> 0, fields, context);
      return 0;
    }
    return super.message(words, context);
  }
}
export function installFESProjectionOracle(world) {
  const register = (name, factory) => world.nativeFeatureFactories.set(name, factory);
  world.retainedDraw = new OriginalFESRetainedInput(world);
  world.objects.factories.set(15, (record) => {
    const task = new OriginalFESDrawInput(world.graphics, record);
    world.graphics.drawTasks.set(record.id, task);
    return task;
  });
  register(
    'data-buffers',
    (engine) =>
      new OriginalFESDataBuffers(engine, {
        source: world.runtime.imageDataBuffers,
        handles: world.runtime.handles,
        read: world.runtime.read,
        diagnostic: (detail) => world.host.nativeDiagnostic?.(detail),
      }),
  );
  register('retained-draw', (engine) => {
    engine.registerFeature('retained-draw', world.retainedDraw);
    return world.retainedDraw;
  });
  register('fes-draw-projection', async (engine) => {
    await world.getNativeFeature('graphics-platform');
    return new NativeFESDrawProjection(engine, world);
  });
  register('image-owner-projection', async (engine) => {
    for (const name of ['engine-files', 'data-buffers', 'retained-draw', 'graphics-platform'])
      await world.getNativeFeature(name);
    return new NativeImageOwnerProjection(engine, world);
  });
  register('display-log-projection', (engine) => new NativeDisplayLogProjection(engine, world));
  register('fes-text-projection', (engine) => new NativeFESTextProjection(engine, world));
  register(
    'fes-screen-effect-projection',
    (engine) => new NativeFESScreenEffectProjection(engine, world),
  );
  const releaseOwner = world.imageOwners.release.bind(world.imageOwners);
  world.imageOwners.release = async (handle) => {
    await world.nativeEngine?.features.get('image-owner-projection')?.releaseModel(handle);
    return releaseOwner(handle);
  };
  const applyLog = world.displayLogs.apply.bind(world.displayLogs);
  world.displayLogs.apply = async (id, args, machine, task) => {
    if (id === 0x2b9) {
      const handle = nativeDataArgument(args, machine, 0);
      if (handle) await world.nativeEngine?.features.get('display-log-projection')?.release(handle);
    }
    return applyLog(id, args, machine, task);
  };
  return world;
}
