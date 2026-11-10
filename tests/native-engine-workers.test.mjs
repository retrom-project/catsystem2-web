// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { installNativeEngineWorkers } from '../src/native/engine-workers.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const MOVIE = 'authored/cross-page.avi';
const BLOCK = 0x400000;
const PROFILES = [
  [
    'nekopara-vol3-engine-2.6.1.76',
    'CATSYSTEM2_ENGINE_EXE',
    { stream: 0x705730, construct: 0x6fc8e0, play: 0x6fd5e0, stop: 0x6fdb90, log: 0x5cac90 },
  ],
  [
    'sdk-4.01-engine-2.6.1.74',
    'CATSYSTEM2_SDK_EXE',
    { stream: 0x5bd580, construct: 0x5bae30, play: 0x5bbac0, stop: 0x5bc090, log: 0x4a82f0 },
  ],
];

async function workerEngine(profile, bytes) {
  const engine = await NativeEngineProcess.open({ profile, bytes }),
    p = engine.process,
    workers = installNativeEngineWorkers(engine);
  for (const [name, definition] of nativeRectangleDefinitions(p))
    engine.registerWindows('USER32.dll', name, definition);
  return { engine, p, workers };
}

const callVirtual = (engine, object, offset, args) => {
  const p = engine.process;
  return engine.call(p.load(p.load(object) + offset), args, object);
};

const exitCode = async (engine, handle, output) => {
  const api = engine.resolve({ dll: 'KERNEL32.dll', name: 'GetExitCodeThread' });
  engine.process.store(output, 0xabcdef01);
  const result = await engine.call(api, [handle, output]);
  return [result, engine.process.load(output)];
};

for (const [profile, variable, construct, insert, enter, leave, destroy] of [
  [PROFILES[0][0], PROFILES[0][1], 0x5db190, 0x5db310, 0x5db550, 0x5db5e0, 0x5db1c0],
  [PROFILES[1][0], PROFILES[1][1], 0x4b7650, 0x4b77d0, 0x4b7a10, 0x4b7aa0, 0x4b7680],
])
  test(
    `${profile} original CThread transfers its copied lock to the tree node`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        { process: p, kernel } = engine,
        thread = p.allocate(0x118, true),
        baseline = kernel.locks.size;
      try {
        assert.equal(await engine.call(construct, [], thread), thread);
        assert.equal(await engine.call(insert, [0], thread), 1);
        assert.equal(await engine.call(insert, [0], thread), 0);
        const head = p.load(p.load(thread + 8)),
          node = p.load(head + 4),
          lock = node + 20;
        assert.equal(kernel.locks.size, baseline + 1);
        assert.equal(kernel.locks.get(lock), 0);
        await engine.call(enter, [0], thread);
        await engine.call(enter, [0], thread);
        assert.equal(kernel.locks.get(lock), 2);
        assert.equal(kernel.lockOwners.get(lock), 1);
        await engine.call(leave, [0], thread);
        await engine.call(leave, [0], thread);
        await engine.call(destroy, [], thread);
        assert.equal(kernel.locks.size, baseline);
        assert.equal(kernel.lockOwners.has(lock), false);
      } finally {
        await engine.close();
      }
    },
  );

for (const [profile, variable, abi] of PROFILES) {
  test(
    `${profile} MemStream prefetches across all three native blocks and closes after a fresh restore`,
    { skip: !process.env[variable] },
    async () => {
      const source = new Uint8Array(3 * BLOCK + 37),
        bytes = new Uint8Array(await readFile(process.env[variable])),
        reads = [];
      for (const [index, offset] of [0, BLOCK, 2 * BLOCK, 3 * BLOCK, source.length - 1].entries())
        source[offset] = 0x21 + index;
      const make = async () => {
        const result = await workerEngine(profile, bytes),
          buffers = new NativeDataBuffers(result.engine);
        new NativeEngineFiles(result.engine, {
          game: {
            async read(path) {
              reads.push(path);
              return path === MOVIE ? source : null;
            },
          },
          getNativeFeature: async (name) => {
            assert.equal(name, 'data-buffers');
            return buffers;
          },
        });
        return result;
      };
      const original = await make();
      let fresh;
      try {
        const { engine, p, workers } = original,
          stream = p.allocate(384, true),
          output = p.allocate(4, true),
          name = p.allocate(64, true),
          destination = p.allocate(source.length, true),
          lockCount = engine.kernel.locks.size;
        p.write(name, encodeCP932(MOVIE + '\0'));
        assert.equal(await engine.call(abi.stream, [name, -1, output, 1], stream), stream);
        assert.equal(p.load(output), 1);
        assert.deepEqual(reads, [MOVIE]);
        const thread = p.load(stream + 380),
          handle = p.load(thread),
          blocks = [0, 16, 32].map((offset) => p.load(stream + 320 + offset));
        assert.deepEqual(await exitCode(engine, handle, output), [1, 259]);
        assert.equal(await workers.step(handle), true);
        assert.equal(engine.kernel.locks.size, lockCount + 2);
        assert.equal(p.load(stream + 360), 1);
        const checkpoint = engine.snapshot();
        fresh = await make();
        fresh.p.trap('authored transient before worker restore', 0, () => 0);
        fresh.engine.restore(checkpoint);
        for (const current of [original, fresh]) {
          const { engine, p, workers } = current;
          assert.equal(
            await callVirtual(engine, stream, 8, [destination, source.length, 0, output]),
            0,
          );
          assert.equal(p.load(output), source.length);
          assert.deepEqual(p.read(destination, source.length), source);
          // The fourth block must have arrived through the original consumer's
          // Sleep(1) boundary. It now occupies the first ring slot.
          assert.equal(p.load(stream + 324), 37);
          assert.equal(p.load(stream + 332), 37);
          assert.equal(await callVirtual(engine, stream, 4, [source.length + 1, 0]), 1);
          assert.equal(p.load(stream + 40), source.length);
          assert.equal(await callVirtual(engine, stream, 4, [BLOCK - 3, 0]), 0);
          assert.equal(await callVirtual(engine, stream, 8, [destination, 16, 0, output]), 0);
          assert.equal(p.load(output), 16);
          assert.deepEqual(p.read(destination, 16), source.slice(BLOCK - 3, BLOCK + 13));
          await callVirtual(engine, stream, 0, [1]);
          assert.equal(p.allocations.has(stream), false);
          assert.equal(p.allocations.has(thread), false);
          assert.ok(blocks.every((pointer) => !p.allocations.has(pointer - 4)));
          assert.equal(engine.kernel.locks.size, lockCount);
          assert.deepEqual(workers.snapshot().threads, []);
          assert.deepEqual(await exitCode(engine, handle, output), [0, 0xabcdef01]);
        }
        assert.deepEqual(reads, [MOVIE]);
      } finally {
        await fresh?.engine.close();
        await original.engine.close();
      }
    },
  );

  test(
    `${profile} original kcVideo completion resumes its running-state poll and joins after stop`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        make = async () => {
          const result = await workerEngine(profile, bytes),
            { engine, p } = result,
            host = {
              pending: [],
              waits: [],
              seeks: [],
              states: [],
              runs: 0,
              stops: 0,
              state: 0,
              runState: 0,
              position: 0n,
            },
            com = (name, methods) => {
              const pointer = p.allocate(4, true),
                table = p.allocate(64, true);
              p.store(pointer, table);
              for (const [offset, [count, fn]] of Object.entries(methods))
                p.store(
                  table + Number(offset),
                  p.trap(`authored movie ${name}+${offset}`, count, fn),
                );
              return pointer;
            };
          engine.patch(abi.log, 'authored worker diagnostic', 0, () => 0);
          const control = com('control', {
              28: [
                1,
                () => {
                  host.runs++;
                  host.state = host.runState;
                  return 0;
                },
              ],
              32: [1, () => 0],
              36: [
                1,
                () => {
                  host.stops++;
                  return 0;
                },
              ],
              40: [
                3,
                ([, , out]) => {
                  p.store(out, host.state);
                  host.states.push(host.state);
                  return 0;
                },
              ],
              60: [
                1,
                () => {
                  host.state = 0;
                  return 0;
                },
              ],
            }),
            event = com('event', {
              36: [
                3,
                ([, timeout, out]) => {
                  host.waits.push(timeout);
                  const code = host.pending.shift();
                  if (!code) return 0x80004005;
                  p.store(out, code);
                  return 0;
                },
              ],
            }),
            seeking = com('seeking', {
              36: [2, () => 0],
              48: [
                2,
                ([, out]) => {
                  p.store(out, Number(host.position & 0xffffffffn));
                  p.store(out + 4, Number(host.position >> 32n));
                  return 0;
                },
              ],
              56: [
                5,
                ([, at, flags, end, endFlags]) => {
                  assert.deepEqual([flags, end, endFlags], [5, 0, 0]);
                  host.position = BigInt(p.load(at)) | (BigInt(p.load(at + 4)) << 32n);
                  host.seeks.push(host.position);
                  return 0;
                },
              ],
            });
          return { ...result, control, event, seeking, host };
        };
      const original = await make();
      let fresh;
      try {
        const { engine, p, workers, host, control, event, seeking } = original,
          movie = p.allocate(436, true),
          output = p.allocate(4, true);
        await engine.call(abi.construct, [], movie);
        p.store(movie + 8, control);
        p.store(movie + 12, seeking);
        p.store(movie + 16, event);
        p.store(movie + 368, 1);
        assert.equal(await engine.call(abi.play, [2], movie), 1);
        const thread = p.load(movie + 388),
          handle = p.load(thread),
          initialRuns = host.runs;
        assert.deepEqual(await exitCode(engine, handle, output), [1, 259]);
        assert.equal(await workers.step(handle), true);
        assert.deepEqual(host.waits, [200]);
        assert.equal(p.load(movie + 392), 2);
        host.position = 18400000n;
        host.runState = 2;
        host.pending.push(1);
        assert.equal(await workers.step(handle), true);
        assert.deepEqual(host.waits, [200, 200]);
        assert.deepEqual(host.seeks, [0n]);
        assert.deepEqual(host.states, [0, 2]);
        assert.equal(host.runs, initialRuns + 1);
        assert.equal(p.load(movie + 372), 1);
        assert.equal(p.load(movie + 392), 1);
        assert.equal(workers.threads.get(handle).polling, true);
        fresh = await make();
        fresh.engine.restore(engine.snapshot());
        fresh.host.state = 2;
        for (const { p, workers, host } of [original, fresh]) {
          host.waits.length = 0;
          host.states.length = 0;
          host.pending.push(1);
          const before = host.runs;
          assert.equal(await workers.step(handle), true);
          assert.deepEqual(host.waits, []);
          assert.deepEqual(host.states, [2]);
          assert.deepEqual(host.pending, [1]);
          assert.equal(host.runs, before);
          assert.equal(p.load(movie + 372), 1);
          assert.equal(p.load(movie + 392), 1);
        }
        assert.equal(await fresh.engine.call(abi.stop, [], movie), 1);
        assert.equal(fresh.host.stops, 1);
        assert.equal(fresh.p.load(movie + 388), 0);
        assert.equal(fresh.p.allocations.has(thread), false);
        assert.deepEqual(fresh.workers.snapshot().threads, []);
        assert.deepEqual(await exitCode(fresh.engine, handle, output), [0, 0xabcdef01]);
        host.state = 1;
        assert.equal(await workers.step(handle), true);
        assert.deepEqual(host.states, [2, 1]);
        assert.deepEqual(host.waits, []);
        assert.deepEqual(host.seeks, [0n]);
        assert.equal(host.runs, initialRuns + 2);
        assert.equal(workers.threads.get(handle).polling, undefined);
        assert.equal(await workers.step(handle), false);
        assert.deepEqual(await exitCode(engine, handle, output), [1, 0]);
        assert.equal(p.load(movie + 372), 0);
        assert.equal(p.load(movie + 392), 0);
        assert.equal(await workers.step(handle), false);
        assert.deepEqual(host.waits, [200]);
      } finally {
        await fresh?.engine.close();
        await original.engine.close();
      }
    },
  );
}
