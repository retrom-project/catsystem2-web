// SPDX-License-Identifier: MPL-2.0
// Executes the mounted PE wrappers. Only task transport, formatting and VM
// address conversion are supplied by this authored boundary probe.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeFES, NATIVE_FES_IDS } from '../src/native/fes.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const counts = new Map([
  [0x1bf, 2],
  [0x1c0, 1],
  [0x1c1, 2],
  [0x1c2, 2],
  [0x1c3, 2],
  [0x1c4, 1],
  [0x1c5, 1],
  [0x1c6, 1],
  [0x276, 4],
  [0x277, 4],
  [0x278, 3],
  [0x285, 3],
  [0x286, 2],
  [0x287, 2],
  [0x298, 3],
  [0x299, 1],
  [0x29a, 1],
  [0x29b, 1],
  [0x29c, 1],
  [0x2e2, 3],
  [0x372, 3],
  [0x373, 2],
]);
let total = 0;
for (const [flag, profile] of [
  ['--game', 'nekopara-vol3-engine-2.6.1.76'],
  ['--sdk', 'sdk-4.01-engine-2.6.1.74'],
]) {
  const at = process.argv.indexOf(flag);
  if (at < 0) continue;
  const bytes = new Uint8Array(await readFile(process.argv[at + 1])),
    engine = await NativeEngineProcess.open({ profile, bytes }),
    p = engine.process,
    sdk = profile.startsWith('sdk-');
  try {
    const vm = p.allocate(2048, true),
      argv = p.allocate(32, true),
      caller = p.allocate(1024, true),
      vtable = p.allocate(32, true),
      out = p.allocate(4, true);
    let traces = [],
      id,
      args,
      variant;
    const string = (address, payload) => (payload ? payload.string(address) : p.string(address)),
      load = (address, payload) => (payload ? payload.load(address) : p.load(address)),
      normalize = (sender, target, message, w, l, payload) => {
        if ([337, 338].includes(message))
          w = w ? { name: string(w, payload), index: load(w + 32, payload) } : null;
        if ([339, 345, 350, 351, 352].includes(message)) w = string(w, payload);
        if ([332, 335, 337, 339].includes(message)) l = string(l, payload);
        if ([346, 347].includes(message)) l = 'caller-private-context';
        if (message === 351) l = 'word-output';
        return { sender, target, message, w, l };
      };
    const transport = p.trap(
      'authored FES wrapper transport',
      7,
      ([sender, target, message, w, l, , result]) => {
        const canonical = sdk && message >= 326 ? message + 5 : message;
        traces.push(
          normalize(sender, target, canonical, w, l, {
            string: (a) => p.string(a),
            load: (a) => p.load(a),
          }),
        );
        if (canonical === 351) p.store(l, 0x12345678);
        if (result) p.store(result, 0x12345678);
        return 1;
      },
    );
    p.store(vtable + 16, transport);
    p.store(caller, vtable);
    p.store(caller + 4, 7);
    p.store(caller + 104, 9);
    engine.patch(
      sdk ? 0x8a6910 : 0x8772a0,
      'authored FES VM pointer',
      1,
      ([offset]) => vm + offset,
      { calleePops: true },
    );
    const formatted = (offset) =>
      variant === 0 ? '' : variant === 1 ? 'authored' : `Authored_${offset}_${variant}`;
    engine.patch(
      sdk ? 0x8a6510 : 0x876ea0,
      'authored FES format boundary',
      2,
      ([offset, dest]) => {
        engine.kernel.writeString(dest, formatted(offset));
        return 1;
      },
      { calleePops: true },
    );
    engine.patch(
      sdk ? 0x4b0830 : 0x5d39e0,
      'authored FES category boundary',
      3,
      ([dest, source]) => {
        engine.kernel.writeString(dest, p.string(source));
        return 1;
      },
      { calleePops: true },
    );
    const task = { id: 7, context: { variableBank: 9 } },
      records = new Map([[7, { exitCode: -1, context: { contextName: 'authored-context' } }]]),
      memory = {
        load: (a) => p.load(vm + a),
        store: (a, v) => p.store(vm + a, v),
        bytes: (a, n) => p.read(vm + a, n),
        string: (a) => p.string(vm + a),
        writeString: (text, a) => p.write(vm + a, encodeCP932(text + '\0')),
      },
      world = {
        objects: { objects: records },
        resolveTaskID: (x) => x,
        runtime: { services: { format: (offset) => formatted(offset) } },
        sendNativeEngine: (_target, _sender, message, w = 0, l = 0, context = {}) => {
          traces.push(normalize(7, args[0], message, w, l, context.payload));
          if (message === 351) context.payload.store(l, 0x12345678);
          return 0x12345678;
        },
      };
    for (id of NATIVE_FES_IDS)
      for (variant = 0; variant < 16; variant++) {
        args = Array.from({ length: counts.get(id) }, (_, i) => (i ? 64 + i * 64 : variant % 4));
        if (id === 0x1c6) args = [64];
        if (id === 0x276) args[3] = variant & 1 ? 0xffffffff : variant;
        if (id === 0x277) {
          args[1] = variant % 39;
          args[3] = variant;
        }
        if (id === 0x285) args[1] = [0, 511, 512, 0xffffffff][variant % 4];
        args.forEach((v, i) => p.store(argv + i * 4, v));
        engine.kernel.writeString(caller + (sdk ? 452 : 712), 'authored-context');
        p.store(caller + 80, 0xcccccccc);
        p.store(out, 0xcccccccc);
        p.zero(vm + 64, 260);
        traces = [];
        const control = await engine.call(
            p.load(NATIVE_PROFILES[profile].tables.main.va + id * 4),
            [0, caller, argv, out],
          ),
          expected = {
            control,
            value: control === 1 ? p.load(out) : null,
            traces,
            exit: id === 0x1c5 ? p.load(caller + 80) : null,
            context: id === 0x1c6 ? p.string(vm + 64) : null,
          };
        traces = [];
        records.get(7).exitCode = 0xcccccccc;
        p.zero(vm + 64, 260);
        const actual = await nativeFES(id, args, memory, task, world);
        assert.deepEqual(
          {
            control: actual.control,
            value: actual.control === 1 ? actual.value : null,
            traces,
            exit: id === 0x1c5 ? records.get(7).exitCode >>> 0 : null,
            context: id === 0x1c6 ? p.string(vm + 64) : null,
          },
          expected,
          `${profile}/0x${id.toString(16)}/${variant}`,
        );
        total++;
      }
    console.log(`${profile}: ${NATIVE_FES_IDS.length * 16} original FES wrapper cases passed`);
  } finally {
    await engine.close();
  }
}
if (!total) throw new Error('Supply --game and/or --sdk with a mounted frozen executable');
