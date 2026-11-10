// SPDX-License-Identifier: MPL-2.0
// Authored, deterministic virtual files and FES host boundaries for save tests.
import { SaveSlotFiles } from './save-slot-files.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeFESObjectRuntime } from '../../src/native/fes-objects.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { NativeStringBank } from '../../src/native/string-bank.mjs';
import { NativeSaveSlots } from '../../src/native/save-slots.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';

export async function saveSlotFixture(
  bytes,
  profile,
  { directory = 'authored', files = new SaveSlotFiles() } = {},
) {
  const engine = await NativeEngineProcess.open({ bytes, profile, ...files.options() }),
    handles = new NativeHandles(),
    strings = new NativeStringBank(),
    stringBank = handles.add('string-bank', strings),
    globals = new Map(),
    record = { id: 1, kind: 34, context: { contextName: directory, stringBank } },
    world = {
      profile,
      runtime: { handles },
      objects: { objects: new Map([[record.id, record]]) },
      graphics: {},
      getNativeFeature: async (name) => {
        const feature = engine.features.get(name);
        if (!feature) throw new Error(`Authored fixture has no feature ${name}`);
        return feature;
      },
    },
    instance = {
      runtimeID: record.id,
      objects: [],
      player: { strings: [] },
      value: (text) => {
        if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16) >>> 0;
        if (/^-?\d+$/.test(text)) return Number(text) >>> 0;
        throw new Error(`Authored expression is not an integer: ${text}`);
      },
      argumentBytes: (text) => encodeCP932(text),
      setGlobal: (index, value) => globals.set(index >>> 0, value >>> 0),
    };
  new NativeDataBuffers(engine, { handles });
  const runtime = new NativeFESObjectRuntime(engine, world);
  const slots = new NativeSaveSlots(world);
  return { engine, files, handles, strings, globals, record, world, instance, runtime, slots };
}
