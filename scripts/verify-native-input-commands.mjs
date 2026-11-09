// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import {
  NativeInputCommands,
  NATIVE_INPUT_COMMAND_CONTRACTS,
} from '../src/native/input-commands.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';

export async function verifyInputCommands(bytes, profile) {
  const sdk = profile.startsWith('sdk-'),
    rootMessage = sdk ? 32 : 34,
    origin = 5,
    create = async (raw) => {
      const engine = await NativeEngineProcess.open({ bytes, profile }),
        p = engine.process,
        state = { root: 17, query: 1, writeRoot: true, writeQuery: true, routed: true },
        records = [],
        wrappers = new Map(),
        first = p.allocate(92, true),
        second = p.allocate(92, true);
      for (const [h, ptr] of [
        [11, first],
        [12, first],
        [13, second],
      ]) {
        const wrapper = p.allocate(4);
        p.store(wrapper, ptr);
        wrappers.set(h, wrapper);
      }
      const world = {
        nativeTaskID: (id) => id + 0x1200,
        resolveTaskID: (sender, task) => (sender === task + 0x1200 ? task : null),
        getNativeFeature: async (name) => {
          if (name !== 'bitmap-memory') throw new Error('Unexpected input-command feature');
          return {
            wrapper: async (handle) => {
              assert.ok(wrappers.has(handle));
              return wrappers.get(handle);
            },
          };
        },
        sendNativeEngine: async (target, sender, message, w, l, context) => {
          records.push([target, sender, message, w, l, context.flags, context.nativePointer]);
          context.nativeRouted = state.routed;
          return message === rootMessage
            ? state.writeRoot
              ? state.root
              : NATIVE_UNWRITTEN_WORD
            : message === 133 && state.writeQuery
              ? state.query
              : NATIVE_UNWRITTEN_WORD;
        },
      };
      let commands, vtable;
      if (raw) {
        const transport = p.trap(
          'authored original input transport',
          7,
          async ([sender, target, message, w, l, flags, out]) => {
            assert.equal(sender, origin + 0x1200);
            const canonical = sdk && message >= 37 ? message + 2 : message;
            records.push([target, origin, canonical, w, l, flags, true]);
            if (out && canonical === rootMessage && state.writeRoot) p.store(out, state.root);
            if (out && canonical === 133 && state.writeQuery) p.store(out, state.query);
            return Number(state.routed);
          },
        );
        vtable = p.allocate(32, true);
        p.store(vtable + 16, transport);
      } else {
        commands = new NativeInputCommands(engine, world);
        vtable = commands.vtable;
      }
      return { engine, p, state, records, world, wrappers, vtable, commands };
    },
    raw = await create(true),
    host = await create(false);
  let calls = 0,
    comparisons = 0;
  const covered = new Map(),
    check = (a, b, label) => {
      assert.deepEqual(a, b, label);
      comparisons++;
    };
  async function run(spec, args, adjacent = false) {
    for (const f of [raw, host]) {
      f.records.length = 0;
      f.p.write(f.p.stackTop - 8192, new Uint8Array(8192).fill(0xcc));
    }
    const words = [...args],
      p = raw.p;
    if (spec.id === 0x18a && words[1]) words[1] = raw.wrappers.get(words[1]);
    const argv = p.allocate(words.length * 4),
      out = p.allocate(12),
      task = p.allocate(120, true);
    let expected;
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      p.store(task, raw.vtable);
      p.store(task + 4, origin + 0x1200);
      const control = await raw.engine.call(
        spec.handlers[Number(sdk)],
        [0, task, argv, out + 4],
        undefined,
        { task: origin },
      );
      check([p.load(out), p.load(out + 8)], [0xcccccccc, 0xcccccccc], 'raw caller canaries');
      expected = { control, ...(control === 1 ? { value: p.load(out + 4) } : {}) };
      if (control === 2) check(p.load(out + 4), 0xcccccccc, 'original void output');
    } finally {
      p.free(task);
      p.free(out);
      p.free(argv);
    }
    const actual = await host.commands.apply(
      spec.id,
      adjacent ? [] : args,
      { nativeArgument: (i) => args[i] },
      { id: origin },
    );
    calls++;
    covered.set(spec.id, (covered.get(spec.id) ?? 0) + 1);
    check(actual, expected, 'complete original reply');
    check(host.records, raw.records, 'both original task envelopes');
    check(
      [...host.wrappers].map(([h, w]) => [h, host.p.load(w)]),
      [...raw.wrappers].map(([h, w]) => [h, p.load(w)]),
      'persistent bitmap prefix identities',
    );
  }
  try {
    for (const spec of NATIVE_INPUT_COMMAND_CONTRACTS) {
      for (let n = 0; n < 96; n++) {
        const mode = {
          root: [0, 17, 0xffffffff][n % 3],
          query: [0, 1, 0x80000000, 0xffffffff][n % 4],
          writeRoot: n % 5 !== 0,
          writeQuery: n % 7 !== 0,
          routed: n % 2 === 0,
        };
        Object.assign(raw.state, mode);
        Object.assign(host.state, mode);
        const args =
          spec.id === 0x5f
            ? [[0, 17, 0xffffffff][n % 3], [0, 19, 0x80000000, 0xffffffff][n % 4]]
            : spec.id === 0x6b
              ? [[0, 1, 0x80000000, 0xffffffff][n % 4]]
              : spec.id === 0x18a
                ? [[0, 17, 0xffffffff][n % 3], [0, 11, 12, 13][n % 4]]
                : [];
        await run(spec, args);
      }
      const adjacent = { 0x5f: [17, 0xf2345678], 0x6b: [0xffffffff], 0x18a: [0, 12] };
      await run(spec, adjacent[spec.id] ?? [], true);
    }
    return {
      profile,
      calls,
      comparisons,
      covered: Object.fromEntries([...covered].map(([id, n]) => [id.toString(16), n])),
      scope:
        'Four complete original input wrappers. An explicit authored task receiver covers returned/unwritten Root and input queries, successful/failed routes, zero/missing targets, signed DWORD boundaries, literal plane registration flags, optional bitmap prefixes and aliases, output canaries and adjacent argument reads. The raw stack is seeded CC for uninitialized locals. Actual device/bitmap-mask/plane/freshWorld are separate integration tests.',
    };
  } finally {
    await host.engine.close();
    await raw.engine.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filename, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: verify-native-input-commands.mjs FIXED_EXE IGNORED_REPORT');
  const bytes = new Uint8Array(await readFile(filename)),
    sha256 = createHash('sha256').update(bytes).digest('hex'),
    profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
      (key) => NATIVE_ENGINE_IMAGES[key].sha256 === sha256,
    );
  if (!profile) throw new Error('Input commands require a frozen engine');
  const result = await verifyInputCommands(bytes, profile);
  await writeFile(output, JSON.stringify({ ...result, sha256 }, null, 2) + '\n');
  console.log(`Input commands passed ${result.calls} calls/${result.comparisons} comparisons`);
}
