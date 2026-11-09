// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../src/native/data-buffer.mjs';
import { NativeSceneCheckpoints } from '../../src/native/scene-checkpoint.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeSceneHistory } from '../../src/native/scene-data.mjs';
import { NativeVariableBank } from '../../src/native/bank.mjs';
import { NativeStringBank } from '../../src/native/string-bank.mjs';
import { importStringBank } from '../../src/native/persistence.mjs';
import { NativeKCSMemory } from '../../src/native/kcs-memory.mjs';
import { NATIVE_EXE_PROFILES } from '../../src/native/catalog.mjs';
import { Binary } from '../../src/binary.mjs';
import { KCSMachine } from '../../src/kcs.mjs';

export async function sceneCheckpointFixture(bytes, profile) {
  const sdk = profile.startsWith('sdk-'),
    f = sdk
      ? {
          variableCtor: 0x5d8bc0,
          variableSet: 0x5d90f0,
          stringCtor: 0x5e1080,
          stringSet: 0x5e1660,
          stringExport: 0x5e1280,
          historyCtor: 0x5dbfa0,
          historyDtor: 0x5dbfc0,
          historyImport: 0x5dc610,
          historyExport: 0x5dc410,
        }
      : {
          variableCtor: 0x728710,
          variableSet: 0x728c40,
          stringCtor: 0x740220,
          stringSet: 0x740800,
          stringExport: 0x740420,
          historyCtor: 0x72d010,
          historyDtor: 0x72d030,
          historyImport: 0x72d680,
          historyExport: 0x72d480,
        },
    configuration = new NativeConfiguration({ profile });
  configuration.variableRanges.local.fill(0);
  configuration.variableRanges.local.set([2, 3, 17, 2, 63, 2]);
  const engine = await NativeEngineProcess.open({ bytes, profile, configuration }),
    p = engine.process,
    files = new Map(),
    world = {
      game: {
        read: async (name) => files.get(name) ?? null,
        readCategory: async (name) => files.get(name) ?? null,
      },
      getNativeFeature: async (name) => {
        const feature = engine.features.get(name);
        if (!feature) throw new Error(`Missing authored feature ${name}`);
        return feature;
      },
    },
    buffers = new NativeDataBuffers(engine),
    engineFiles = new NativeEngineFiles(engine, world),
    feature = new NativeSceneCheckpoints(engine, world),
    variables = new NativeVariableBank(),
    strings = new NativeStringBank(),
    history = new NativeSceneHistory(),
    machine = new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(8192),
        stackSize: 4096,
      },
      undefined,
      new Uint8Array(4096),
    ),
    variable = p.allocate(40, true),
    string = p.allocate(4, true),
    nativeHistory = p.allocate(8, true),
    pair = p.allocate(8, true),
    caller = p.allocate(184, true),
    argv = p.allocate(16),
    out = p.allocate(4),
    scratch = p.allocate(65536, true);
  variables.initialize(64);
  machine.fp = 8192;
  machine.allocate(4096);
  await engine.call(f.variableCtor, [64], variable);
  await engine.call(f.stringCtor, [], string);
  await engine.call(f.historyCtor, [], nativeHistory);
  p.store(pair + 4, nativeHistory);
  p.store(caller + 104, variable);
  p.store(caller + 180, string);
  const word = async (index, value) => {
      await engine.call(f.variableSet, [index, value], variable);
      variables.set(index, value);
    },
    text = async (index, bytes) => {
      p.write(scratch, Uint8Array.from([...bytes, 0]));
      await engine.call(f.stringSet, [index, scratch], string);
      strings.setBytes(index, bytes);
    },
    syncHistory = async () => {
      await engine.call(f.historyDtor, [], nativeHistory);
      await engine.call(f.historyCtor, [], nativeHistory);
      const a = history.encode('seen', true),
        b = history.encode('path', true),
        ap = p.allocate(a.length, true),
        bp = p.allocate(b.length, true);
      p.write(ap, a);
      p.write(bp, b);
      try {
        await engine.call(f.historyImport, [ap, a.length, bp, b.length], nativeHistory);
      } finally {
        p.free(ap);
        p.free(bp);
      }
    },
    readHistory = async () => {
      p.zero(scratch, 8);
      await engine.call(f.historyExport, [0, scratch, 0, scratch + 4, 1], nativeHistory);
      const a = p.load(scratch),
        b = p.load(scratch + 4),
        ap = p.allocate(a, true),
        bp = p.allocate(b, true);
      try {
        await engine.call(f.historyExport, [ap, scratch, bp, scratch + 4, 1], nativeHistory);
        return { seen: p.read(ap, a), path: p.read(bp, b) };
      } finally {
        p.free(ap);
        p.free(bp);
      }
    },
    readBanks = async () => {
      const n = await engine.call(f.stringExport, [0], string);
      p.write(scratch, new Uint8Array(n).fill(0xa5));
      await engine.call(f.stringExport, [scratch], string);
      const bank = new NativeStringBank();
      importStringBank(bank, p.read(scratch, n));
      return {
        words: Array.from({ length: 64 }, (_, i) => p.load(p.load(variable) + i * 4)),
        dirty: Boolean(p.load(variable + 24)),
        strings: [...bank.entries],
      };
    },
    original = async (id, args) => {
      const bridge = new NativeKCSMemory(p, machine);
      try {
        p.zero(argv, 16);
        [pair, ...args].forEach((n, i) => p.store(argv + i * 4, n));
        p.store(out, 0xcccccccc);
        const control = await engine.call(
          p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4),
          [bridge.pointer, caller, argv, out],
        );
        return { control, ...(control === 1 ? { value: p.load(out) } : {}) };
      } finally {
        bridge.close();
      }
    };
  return {
    engine,
    p,
    files,
    feature,
    variables,
    strings,
    history,
    machine,
    word,
    text,
    syncHistory,
    readHistory,
    readBanks,
    original,
    configuration,
    buffers,
    engineFiles,
    caller,
    variable,
    layout: f,
    nativeHistory,
    pair,
  };
}
