// SPDX-License-Identifier: MPL-2.0
// Executes the mounted PE wrappers. Only task transport, formatting and VM
// address conversion are supplied by this authored boundary probe.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeFES, NATIVE_FES_IDS } from '../src/native/fes.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';

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
    const handles = new NativeHandles(),
      table = NATIVE_EXE_PROFILES[profile].tables.main.va,
      localBank = Uint8Array.from({ length: 2048 }, (_, i) => Math.imul(i, 0x6792) >>> 4);
    let traces = [],
      id,
      args,
      variant,
      transfer;
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
    function transportBank(sender, target, message, size, address, memory) {
      if (message === 344) {
        traces.push({ sender, target, message, size, bytes: memory.read(address, size) });
        return 0;
      }
      traces.push({ sender, target, message, size, buffer: Boolean(address) });
      if (!address) return transfer.capacity;
      memory.write(address, localBank.subarray(0, transfer.written));
      return transfer.written;
    }
    const transport = p.trap(
      'authored FES wrapper transport',
      7,
      ([sender, target, message, w, l, flags, result]) => {
        const canonical = sdk && message >= 326 ? message + 5 : message;
        if (transfer) {
          assert.equal(flags, 0);
          const value = transportBank(sender, target, canonical, w, l, p);
          if (result) p.store(result, value);
          return 1;
        }
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
        runtime: { handles, services: { format: (offset) => formatted(offset) } },
        sendNativeEngine: (target, sender, message, w = 0, l = 0, context = {}) => {
          if (transfer)
            return transportBank(sender, target, message, w, l, {
              read: (at, size) => context.payload.bytes(at, size),
              write: (at, bytes) => context.payload.bytes(at, bytes.length).set(bytes),
            });
          traces.push(normalize(7, args[0], message, w, l, context.payload));
          if (message === 351) context.payload.store(l, 0x12345678);
          return 0x12345678;
        },
      };
    for (id of NATIVE_FES_IDS.filter((id) => counts.has(id)))
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
        const control = await engine.call(p.load(table + id * 4), [0, caller, argv, out]),
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
    const scratch = p.allocate(localBank.length, true),
      tag = 0x28a00001,
      guest = (id, args) => {
        args.forEach((word, i) => p.store(argv + 4 * i, word));
        p.store(out, 0xcccccccc);
        return engine.call(p.load(table + id * 4), [0, caller, argv, out]);
      },
      transfers = [
        { id: 0x289, absent: true },
        { id: 0x289, capacity: 0 },
        { id: 0x289, capacity: 2048, written: 2048 },
        { id: 0x289, capacity: 2048, written: 7 },
        { id: 0x289, capacity: 2048, written: 0 },
        { id: 0x28a, absent: true },
        { id: 0x28a },
        { id: 0x28a, length: 0 },
        { id: 0x28a, length: 3 },
        { id: 0x28a, length: 2048 },
      ];
    p.write(scratch, localBank);
    for (transfer of transfers) {
      assert.equal(await guest(0xee, [0]), 1);
      const guestFile = p.load(out),
        descriptor = p.load(guestFile),
        file = new NativeGlobalFile(),
        handle = handles.add('global-file', file);
      try {
        // The original lookup scans allocated capacity, including uninitialized
        // bytes left by a previous allocation. Author a clean save buffer.
        p.zero(p.load(descriptor), p.load(descriptor + 4));
        if (transfer.length !== undefined) {
          await engine.call(sdk ? 0x624220 : 0x78c160, [tag, scratch, transfer.length], guestFile);
          file.write(tag, localBank.subarray(0, transfer.length));
        }
        traces = [];
        const control = await guest(transfer.id, [transfer.absent ? 0 : guestFile, tag, 19]),
          expected = { control, value: p.load(out) },
          expectedTraces = traces;
        traces = [];
        assert.deepEqual(
          await nativeFES(
            transfer.id,
            [transfer.absent ? 0 : handle, tag, 19],
            memory,
            task,
            world,
          ),
          expected,
          `${profile}: ${JSON.stringify(transfer)}`,
        );
        assert.deepEqual(traces, expectedTraces);
        assert.deepEqual(p.read(p.load(descriptor), p.load(descriptor + 8)), file.payload());
        total++;
      } finally {
        await guest(0xf6, [guestFile]);
        handles.release(handle, 'global-file');
      }
    }
    p.free(scratch);
    console.log(
      `${profile}: ${counts.size * 16 + transfers.length} original FES wrapper cases passed`,
    );
  } finally {
    await engine.close();
  }
}
if (!total) throw new Error('Supply --game and/or --sdk with a mounted frozen executable');
