// SPDX-License-Identifier: MPL-2.0
// STRTABLE byte cells and FILELIST indexed entries are JS-owned. Neither
// object allocates a renderer or an original data/map object.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { fesNarrowText } from '../fes/tokens.mjs';
import { fesFileListPattern, fesFileListKey, fesFileListEntries } from './fes-file-list.mjs';
import { readFESStringTable, fesStringTableCell } from './fes-string-table.mjs';

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
    return (object.nativeDataState ??= { entries: [] });
  }
  async stringTable(instance, object) {
    const state = (object.nativeDataState ??= { appliedDefinitions: 0, rows: [] }),
      definitions = object.nativeDefinitions ?? [];
    for (; state.appliedDefinitions < definitions.length; state.appliedDefinitions++) {
      const row = definitions[state.appliedDefinitions],
        tokens = row.values,
        column = row.columns.findIndex((token) => fesNarrowText(token) === 'FILE');
      if (column < 0 || tokens[column] === undefined) continue;
      const file = instance.soundArgument(tokens[column]);
      state.rows = [];
      const bytes = await this.world.runtime.read(file, 'config');
      if (bytes?.length) state.rows = readFESStringTable(bytes);
    }
    return state;
  }
  setString(instance, index, bytes, context) {
    if (context?.setStringBytes) {
      context.setStringBytes(index, bytes);
      return true;
    }
    const record = this.world.objects.objects.get(instance.runtimeID),
      handle = record?.context?.stringBank;
    if (!handle) return false;
    this.world.runtime.handles.get(handle, 'string-bank').setBytes(index, bytes);
    return true;
  }
  setGlobal(instance, index, value) {
    const record = this.world.objects.objects.get(instance.runtimeID),
      handle = record?.context?.variableBank;
    if (handle) this.world.runtime.handles.get(handle, 'variable-bank').set(index, value);
    else if (index >= 0) instance.setGlobal(index, value);
  }
  async fileList(instance, object, verb, args, context) {
    const state = await this.initialize(instance, object),
      tokens = args,
      value = (i) =>
        tokens[i] === undefined ? -1 : instance.value(instance.soundArgument(tokens[i]));
    if (verb === 'make') {
      const group = instance.objects.filter((candidate) => candidate.baseName === object.baseName),
        index = group.length === 1 ? 0 : (context?.index ?? object.index ?? 0);
      if (index === -1) return 0; // The original make requires a selected object.
      const policy = nativeABI(this.world.profile).fes.fileList,
        path = tokens.length ? instance.soundArgument(tokens[0]) : '',
        patterns =
          tokens.length > 1
            ? tokens.slice(1).map((token) => instance.argumentBytes(token))
            : [encodeCP932('*.*')],
        entries = new Map(state.entries);
      for (const bytes of patterns) {
        const mask = fesFileListPattern(bytes, policy.patternEncoding),
          prefix = path.replace(/[\\/]+$/, ''),
          files = await this.world.findNativeFiles(`${prefix}\\${mask}`);
        for (const file of files) {
          const key = fesFileListKey(file.name, policy.keyEncoding);
          if (!entries.has(key)) entries.set(key, `${prefix}\\${file.name}`);
        }
      }
      state.entries = [...entries];
    } else if (tokens.length) {
      if (instance.soundArgument(tokens[0]) === 'count') {
        if (tokens[1] !== undefined) this.setGlobal(instance, value(1), state.entries.length);
      } else {
        const entry = fesFileListEntries(state)[value(3) >>> 0],
          found = entry !== undefined;
        if (found) {
          const name =
            instance.soundArgument(tokens[0]) === 'fullpath'
              ? entry[1]
              : entry[1].split(/[\\/]/).at(-1);
          if (!this.setString(instance, value(2), encodeCP932(name), context))
            throw new Error('FES FILELIST string result requires its string bank');
        }
        // Unlike STRTABLE, FILELIST does not suppress a default -1 output.
        this.setGlobal(instance, value(1), Number(found));
      }
    }
    return 0;
  }
  async command(instance, object, verb, args, context) {
    if (object.nativeType === 35 && ['make', 'get'].includes(verb))
      return this.fileList(instance, object, verb, args, context);
    if (object.nativeType === 34 && verb === 'get') {
      const tokens = args,
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
      if (status !== -1) this.setGlobal(instance, status, Number(found));
      return 0;
    }
    throw new Error(`Unimplemented FES ${object.type} command ${verb}`);
  }
  async loadStringTable(_instance, object, file) {
    const state = (object.nativeDataState ??= { appliedDefinitions: 0, rows: [] });
    state.rows = [];
    const bytes = await this.world.runtime.read(file, 'config');
    if (bytes?.length) state.rows = readFESStringTable(bytes);
    return state;
  }
  async close() {}
}

export function installNativeFESData(world) {
  world.dataFES = new NativeFESData(world);
}
