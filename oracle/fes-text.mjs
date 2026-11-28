// SPDX-License-Identifier: MPL-2.0
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { fesNarrowText } from '../src/fes/tokens.mjs';
// Public FES object bridge. Native state lives once in the shared engine.
export const FES_TEXT_VERBS = new Set(
  'str apend apendmark clear draw isdraw isdrawmark skip reset layout linecnt endpos userfontobj userfont insert getdiv'.split(
    ' ',
  ),
);
export class NativeFESText {
  constructor(service) {
    this.service = service;
    this.world = service.world;
  }
  supports(object) {
    return ['STRING', 'STRING8', 'NVSTRING'].includes(object.type);
  }
  async runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    const runtime = await this.runtime();
    await runtime.create(instance, object);
    if (object.nativeTaskID == null)
      object.nativeTaskID = await this.world.objects.create({
        kind: object.nativeType === 29 ? 49 : object.nativeType === 37 ? 63 : 48,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: object.nativeType === 37 ? 'FE string UTF8' : 'FE string',
      });
    const taskAt = nativeABI(runtime.engine.profile).fes.textTaskWords[object.nativeType];
    runtime.process.store(
      object.nativeObjectPointer + taskAt * 4,
      this.world.nativeTaskID ? this.world.nativeTaskID(object.nativeTaskID) : object.nativeTaskID,
    );
    return runtime;
  }
  async update(instance, object, { configurationDirty = false } = {}) {
    if (object.deleted) return this.close(object);
    const runtime = await this.initialize(instance, object);
    return runtime.runDriver(instance, object, { configurationDirty });
  }
  async command(instance, object, verb, args, context) {
    return (await this.runtime()).command(instance, object, verb, args, context);
  }
  async close(object) {
    if (object.nativeTaskID != null) {
      if (this.world.objects.objects.has(object.nativeTaskID))
        await this.world.objects.destroy(object.nativeTaskID);
      object.nativeTaskID = null;
    }
    if (object.nativeObjectPointer == null) return;
    await (await this.runtime()).destroy(object.nativeObjectPointer);
    object.nativeObjectPointer = null;
  }
}

export function nativeFESTextAdapter(bridge, type) {
  if (!Object.hasOwn(nativeABI(bridge.engine.profile).text.fesLayouts, type) && type !== 29)
    throw new Error('The frozen SDK has no STRING8 object constructor');
  return {
    construct:
      type === 29
        ? bridge.sdk
          ? 0x5f0bd0
          : 0x750ab0
        : bridge.sdk
          ? 0x5ee900
          : type === 37
            ? 0x752eb0
            : 0x74e540,
    driver:
      type === 29
        ? bridge.sdk
          ? 0x52f8c0
          : 0x65feb0
        : bridge.sdk
          ? 0x532c40
          : type === 37
            ? 0x663b30
            : 0x6632c0,
    configurationChanged:
      type === 29
        ? bridge.sdk
          ? 0x5f0ed0
          : 0x750db0
        : bridge.sdk
          ? 0x5ef490
          : type === 37
            ? 0x753aa0
            : 0x74f120,
    verbs: FES_TEXT_VERBS,
    vramOffset: 740,
    canonicalMessage: (message) =>
      mapABIMessage(
        bridge.engine.profile,
        type === 29 ? 'fesNvText' : 'fesText',
        'canonical',
        message,
      ),
    definitionApply: bridge.sdk
      ? type === 29
        ? 0x605410
        : 0x605020
      : type === 29
        ? 0x769220
        : type === 37
          ? 0x7694a0
          : 0x768d90,
    afterDefinition(runtime, instance, object, pointer, rows) {
      const columns = new Set(rows.flatMap((row) => row.columns.map(fesNarrowText))),
        p = runtime.process;
      if (columns.has('POS'))
        [object.x, object.y, object.z] = [48, 52, 56].map((offset) =>
          readFloat(p, pointer + offset),
        );
      if (columns.has('BASE'))
        [object.baseX, object.baseY, object.baseZ] = [64, 68, 72].map((offset) =>
          readFloat(p, pointer + offset),
        );
      if (columns.has('PRI')) object.pri = p.load(pointer + 184) | 0;
      if (columns.has('DISP')) object.disp = !!p.load(pointer + 188);
      if (columns.has('COLOR') || columns.has('BLEND')) {
        object.color = p.load(pointer + 192);
        object.alpha = object.color >>> 24;
      }
    },
    async initialize(runtime, instance, object, pointer) {
      const p = runtime.process;
      await runtime.applyDefinition(
        instance,
        object,
        pointer,
        runtime.sdk
          ? type === 29
            ? 0x605410
            : 0x605020
          : type === 29
            ? 0x769220
            : type === 37
              ? 0x7694a0
              : 0x768d90,
      );
      object.width = p.load(pointer + 176);
      object.height = p.load(pointer + 180);
      pullCommon(runtime, object, pointer);
    },
    beforeDriver(runtime, instance, object, pointer) {
      object.nativeTextInputPosition = [48, 52, 56].map((offset) =>
        readFloat(runtime.process, pointer + offset),
      );
    },
    afterDriver(runtime, instance, object, pointer) {
      object.width = runtime.process.load(pointer + (type === 29 ? 764 : 176));
      object.height = runtime.process.load(pointer + (type === 29 ? 768 : 180));
      for (const [i, key] of ['x', 'y', 'z'].entries())
        object[key] = Math.fround(
          object[key] +
            readFloat(runtime.process, pointer + 48 + 4 * i) -
            object.nativeTextInputPosition[i],
        );
      delete object.nativeTextInputPosition;
    },
  };
}

function readFloat(p, address) {
  const bytes = p.read(address, 4);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true);
}
function pullCommon(runtime, object, pointer) {
  const p = runtime.process,
    f = (offset) => readFloat(p, pointer + offset);
  [object.x, object.y, object.z] = [48, 52, 56].map(f);
  [object.baseX, object.baseY, object.baseZ] = [64, 68, 72].map(f);
  object.pri = p.load(pointer + 184) | 0;
  object.disp = !!p.load(pointer + 188);
  object.color = p.load(pointer + 192);
  object.alpha = object.color >>> 24;
}
