// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../oracle/raster-kernel-projection.mjs';

for (const [profile, fixture] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} CRT repeats preserve every instruction cutoff, memory fault and fresh continuation`,
    { skip: !process.env[fixture] },
    async () => {
      const options = {
          profile,
          bytes: new Uint8Array(await readFile(process.env[fixture])),
          heapSize: 0x200000,
        },
        engine = await NativeEngineProcess.open(options),
        p = engine.process,
        kernels = new NativeRasterKernels(engine),
        bytes = Uint8Array.from({ length: 0x7000 }, (_, i) => (i * 73 + 17) & 255),
        arena = p.allocate(bytes.length),
        source = Math.ceil(arena / 4096) * 4096 + 0x1000,
        destination = source + 0x3000,
        initial = p.registers(),
        fills = [
          { address: kernels.abi.stosByte, width: 1, hit: 'stosByte' },
          { address: kernels.abi.stosWord, width: 4, hit: 'stosWord' },
        ],
        copies = [0x2a, 0x21e, 0x27c, 0x2a2, 0x2c0, 0x3a4, 0x3ff, 0x429, 0x45b].map(
          (offset, i) => ({ address: kernels.abi.memcpy + offset, width: i ? 4 : 1, hit: 'movs' }),
        );
      let fresh;
      const read = (name, process = p) =>
          process.cpu.reg_read_i32(process.uc['X86_REG_' + name]) >>> 0,
        state = (process) => ({
          registers: process.registers(),
          pc: read('EIP', process),
          bytes: process.read(arena, bytes.length),
          budget: process.instructionBudget(),
        }),
        run = (site, enabled, budget, settings) => {
          kernels.enabled = enabled;
          p.write(arena, bytes);
          p.writeRegisters(initial);
          for (const [name, value] of Object.entries({
            EAX: 0xa1664dc2,
            EFLAGS: 0x8d7,
            ECX: 7,
            ESI: source + 129,
            EDI: destination + 129,
            ...settings,
          }))
            p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
          p.pendingError = null;
          let fault;
          try {
            p.cpu.emu_start(site.address, site.address + 2, 0, budget);
          } catch (error) {
            fault = String(error);
          }
          if (p.pendingError) throw p.pendingError;
          return { ...state(p), fault };
        };
      try {
        for (const site of [...fills, ...copies]) {
          const trace = [],
            hook = p.cpu.hook_add(
              p.uc.HOOK_CODE,
              () => trace.push(read('ECX')),
              null,
              site.address,
              site.address,
            );
          try {
            p.invalidateExecutable(site.address, site.address + 2);
            for (const flags of [0x8d7, 0xcd7]) {
              for (const count of [0, 1, 2, 7]) {
                const settings = { EFLAGS: flags, ECX: count };
                trace.length = 0;
                const reference = run(site, false, 0, settings),
                  originalVisits = trace.slice();
                assert.equal(reference.fault, undefined);
                assert.equal(reference.pc, site.address + 2);
                const budgets = Array.from({ length: originalVisits.length + 2 }, (_, i) => i + 1);
                for (const budget of [...budgets, 0]) {
                  const native = run(site, false, budget, settings),
                    before = kernels.hits[site.hit],
                    complete = !budget || budget >= originalVisits.length,
                    name = `0x${site.address.toString(16)}, ECX=${count}, flags=${flags}, budget=${budget}`;
                  assert.equal(native.pc, site.address + (complete ? 2 : 0), name);
                  assert.equal(read('ECX'), complete ? 0 : originalVisits[budget], name);
                  assert.equal(
                    native.budget.counter,
                    BigInt(budget ? Math.min(budget + 1, originalVisits.length) : 0),
                    name,
                  );
                  assert.deepEqual(run(site, true, budget, settings), native, name);
                  assert.equal(
                    kernels.hits[site.hit] - before,
                    Number(complete && count > 0),
                    name,
                  );
                }
              }
            }
          } finally {
            p.cpu.hook_del(hook);
            p.invalidateExecutable(site.address, site.address + 2);
          }
        }
        for (const site of [...fills, ...copies.slice(0, 2)]) {
          const copy = site.hit === 'movs',
            page = (copy ? source : destination) + 4096,
            settings = { [copy ? 'ESI' : 'EDI']: page - site.width, ECX: 3 };
          p.cpu.mem_protect(page, 4096, copy ? 0 : p.uc.PROT_READ);
          try {
            // One native transfer completes before the protected page. A
            // cutoff before the fault must leave that transfer observable.
            const beforeFault = run(site, false, 1, settings),
              fault = run(site, false, 4, settings);
            assert.equal(beforeFault.fault, undefined);
            assert.match(fault.fault, copy ? /READ_PROT/i : /WRITE_PROT/i);
            assert.equal(fault.pc, site.address);
            assert.equal(read('ECX'), 2);
            const before = kernels.hits[site.hit];
            assert.deepEqual(run(site, true, 1, settings), beforeFault);
            assert.deepEqual(run(site, true, 4, settings), fault);
            assert.equal(kernels.hits[site.hit], before);
          } finally {
            p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
          }
        }
        const site = copies[1],
          overlap = { ESI: source + 128, EDI: source + 132 },
          overlapping = run(site, false, 8, overlap);
        assert.deepEqual(run(site, true, 8, overlap), overlapping);
        const partial = run(site, true, 2, { ECX: 5 }),
          saved = engine.snapshot();
        assert.equal(partial.pc, site.address);
        assert.equal(read('ECX'), 3);
        kernels.enabled = false;
        p.cpu.emu_start(site.address, site.address + 2, 0, 4);
        const original = state(p);
        fresh = await NativeEngineProcess.open(options);
        const restored = new NativeRasterKernels(fresh);
        fresh.restore(saved);
        assert.deepEqual(fresh.process.read(arena, bytes.length), partial.bytes);
        fresh.process.cpu.emu_start(site.address, site.address + 2, 0, 4);
        if (fresh.process.pendingError) throw fresh.process.pendingError;
        assert.deepEqual(state(fresh.process), original);
        assert.equal(restored.hits.movs, 1);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
}
