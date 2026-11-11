// SPDX-License-Identifier: MPL-2.0
// STRTABLE byte cells are JS-owned. FILELIST still uses the original data
// object pending its narrow/wide search-pattern audit. Neither has a renderer.
import { registerNativeFESObjectType } from './fes-objects.mjs';
import { readFESStringTable, fesStringTableCell } from './fes-string-table.mjs';
import { tokenizeNativeFESSoundConfiguration } from './fes-sound-config.mjs';

const ABI = {
  game: {
    35: { construct: 0x765530, apply: 0x769460 },
  },
  sdk: {
    35: { construct: 0x6011f0, apply: 0x605650 },
  },
};

export class NativeFESData {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return [34, 35].includes(object.nativeType);
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    if (object.nativeType === 34) return this.stringTable(instance, object);
    return (await this.world.getNativeFeature('fes-objects')).create(instance, object);
  }
  async stringTable(instance, object) {
    const state = (object.nativeDataState ??= { appliedDefinitions: 0, rows: [] }),
      definitions = object.nativeDefinitions ?? [];
    for (; state.appliedDefinitions < definitions.length; state.appliedDefinitions++) {
      const row = definitions[state.appliedDefinitions],
        tokens = tokenizeNativeFESSoundConfiguration(
          [object.key, ...row.values].join(' '),
          this.world.profile,
        ).slice(1),
        column = row.columns.indexOf('FILE');
      if (column < 0 || tokens[column] === undefined) continue;
      const file = instance.soundArgument(tokens[column]),
        bytes = await this.world.runtime.read(file, 'config');
      state.rows = bytes?.length ? readFESStringTable(bytes) : [];
    }
    return state;
  }
  setString(instance, index, bytes, context) {
    if (context?.setStringBytes) return context.setStringBytes(index, bytes);
    const record = this.world.objects.objects.get(instance.runtimeID),
      handle = record?.context?.stringBank;
    if (!handle) return false;
    this.world.runtime.handles.get(handle, 'string-bank').setBytes(index, bytes);
    return true;
  }
  async command(instance, object, verb, args, context) {
    if (object.nativeType === 34 && verb === 'get') {
      const tokens = tokenizeNativeFESSoundConfiguration(
          [object.baseName, verb, ...args].join(' '),
          this.world.profile,
        ).slice(2),
        value = (i) =>
          tokens[i] === undefined ? -1 : instance.value(instance.soundArgument(tokens[i])),
        state = await this.stringTable(instance, object),
        cell = fesStringTableCell(state.rows, value(0), value(1)),
        output = value(2),
        status = value(3),
        record = this.world.objects.objects.get(instance.runtimeID),
        hasStrings = Boolean(context?.setStringBytes || record?.context?.stringBank);
      const found = cell !== null && hasStrings;
      if (found && output !== -1) this.setString(instance, output, cell, context);
      if (status !== -1) instance.setGlobal(status, Number(found));
      return 0;
    }
    return (await this.world.getNativeFeature('fes-objects')).command(
      instance,
      object,
      verb,
      args,
      {
        ...context,
        setStringBytes: (index, bytes) => {
          const record = this.world.objects.objects.get(instance.runtimeID),
            bank = this.world.runtime.handles.get(record.context.stringBank, 'string-bank');
          bank.setBytes(index, bytes);
        },
      },
    );
  }
  async close(object) {
    if (object.nativeObjectPointer == null) return;
    await (await this.world.getNativeFeature('fes-objects')).destroy(object.nativeObjectPointer);
    object.nativeObjectPointer = null;
  }
}

export function installNativeFESData(world) {
  world.dataFES = new NativeFESData(world);
  registerNativeFESObjectType(world, 34, (runtime) => ({
    size: 44,
    construct: (runtime, instance, object, pointer, args) =>
      runtime.constructBase(instance, object, pointer, args),
    verbs: new Set(runtime.table.keys()),
    vramOffset: null,
    syncObject() {},
  }));
  for (const type of [35])
    registerNativeFESObjectType(world, type, (runtime) => {
      const abi = ABI[runtime.sdk ? 'sdk' : 'game'][type];
      return {
        construct: abi.construct,
        size: 0x34,
        definitionApply: abi.apply,
        verbs: new Set(runtime.table.keys()),
        vramOffset: null,
        async initialize(runtime, instance, object, pointer) {
          await runtime.applyDefinition(instance, object, pointer, abi.apply);
        },
        syncObject() {},
      };
    });
}
