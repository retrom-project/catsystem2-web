// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { floatBits } from '../src/kcs.mjs';

async function fixture() {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    exported = kernel.register('D3D9.dll', 'AuthoredAdd', {
      count: 2,
      fn: ([a, b]) => (a + b) >>> 0,
    }),
    handle = kernel.registerHostModule(
      'D3D9.dll',
      new Map([
        ['AuthoredAdd', exported],
        [17, exported],
      ]),
    ),
    input = p.allocate(256, true),
    output = p.allocate(512, true),
    call = (name, args = []) => p.callAsync(kernel.resolve({ dll: 'KERNEL32.dll', name }), args);
  return { p, kernel, exported, handle, input, output, call };
}
test('explicit platform DLLs resolve real exports through A/W delay-loading without accepting unavailable modules', async () => {
  const { p, kernel, exported, handle, input, output, call } = await fixture();
  try {
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W';
      for (const name of ['d3d9', 'D3D9.DLL', 'C:\\Windows\\System32\\d3d9.dll']) {
        kernel.writeString(input, name, wide);
        assert.equal(await call(`GetModuleHandle${suffix}`, [input]), handle);
        assert.equal(await call(`LoadLibrary${suffix}`, [input]), handle);
        assert.equal(await call(`LoadLibraryEx${suffix}`, [input, 0, 0x800]), handle);
      }
      for (const flags of [1, 2, 0x10000000]) {
        assert.equal(await call(`LoadLibraryEx${suffix}`, [input, 0, flags]), 0);
        assert.equal(kernel.lastError, 87);
      }
      assert.equal(await call(`LoadLibraryEx${suffix}`, [input, 1, 0]), 0);
      assert.equal(kernel.lastError, 87);
      kernel.writeString(input, 'unavailable.dll', wide);
      assert.equal(await call(`LoadLibrary${suffix}`, [input]), 0);
      assert.equal(await call(`LoadLibraryEx${suffix}`, [input, 0, 0]), 0);
      assert.equal(kernel.lastError, 126);
      const path = 'C:\\catsystem2-web\\d3d9.dll';
      for (const capacity of [0, 1, 5, 128]) {
        p.write(output, new Uint8Array(512).fill(0xa5));
        const result = await call(`GetModuleFileName${suffix}`, [handle, output + 4, capacity]);
        assert.equal(result, capacity === 0 ? 0 : Math.min(path.length, capacity));
        const expected = new Uint8Array(512).fill(0xa5);
        if (capacity) {
          const string = path.slice(0, capacity - 1);
          if (wide)
            for (let i = 0; i <= string.length; i++)
              new DataView(expected.buffer).setUint16(4 + i * 2, string.charCodeAt(i) || 0, true);
          else expected.set([...new TextEncoder().encode(string), 0], 4);
        }
        assert.deepEqual(p.read(output, 512), expected);
      }
    }
    kernel.writeString(input, 'AuthoredAdd');
    assert.equal(await call('GetProcAddress', [handle, input]), exported);
    assert.equal(await call('GetProcAddress', [handle, 17]), exported);
    assert.equal(await p.callAsync(exported, [0xffffffff, 2]), 1);
    kernel.writeString(input, 'authoredadd');
    assert.equal(await call('GetProcAddress', [handle, input]), 0);
    assert.equal(kernel.lastError, 127);
    assert.equal(await call('GetProcAddress', [handle, 18]), 0);
    assert.equal(kernel.lastError, 127);
    for (let i = 0; i < 20; i++) assert.equal(await call('FreeLibrary', [handle]), 1);
    assert.equal(
      kernel.hostModules.byHandle(handle).references,
      1,
      'the explicit provider keeps its own process reference',
    );
    assert.throws(() => kernel.registerHostModule('d3d9.dll', {}), /duplicate/);
    assert.throws(() => kernel.registerHostModule('invalid.dll', { bad: 0 }), /actual guest/);
  } finally {
    p.close();
  }
});
test('checkpointed platform module identities and references rebind to a fresh kernel and real host traps', async () => {
  const first = await fixture();
  let second,
    firstClosed = false;
  try {
    first.kernel.writeString(first.input, 'd3d9.dll');
    for (let i = 0; i < 3; i++) await first.call('LoadLibraryExA', [first.input, 0, 0]);
    const saved = structuredClone(first.kernel.snapshot());
    second = await fixture();
    second.kernel.restore(saved);
    assert.equal(second.kernel.moduleHandle('D3D9.dll'), first.handle);
    assert.equal(second.kernel.hostModules.byHandle(first.handle).references, 4);
    first.p.close();
    firstClosed = true;
    second.kernel.writeString(second.input, 'AuthoredAdd');
    const target = await second.call('GetProcAddress', [first.handle, second.input]);
    assert.equal(await second.p.callAsync(target, [7, 11]), 18);
    await second.call('FreeLibrary', [first.handle]);
    assert.equal(second.kernel.hostModules.byHandle(first.handle).references, 3);
    assert.equal(first.kernel.hostModules.byHandle(first.handle).references, 4);
  } finally {
    second?.p.close();
    if (!firstClosed) first.p.close();
  }
});

test('platform exports restore by symbol and ABI after trap and module registration order changes', async () => {
  const unicorn = await loadUnicorn(),
    first = new NativeEngineProcess(unicorn, { profile: 'authored' }),
    fresh = new NativeEngineProcess(unicorn, { profile: 'authored' });
  const install = (engine, reverse = false) => {
    const p = engine.process,
      k = engine.kernel,
      add = k.register('D3D9.dll', 'AuthoredAdd', { count: 2, fn: ([a, b]) => (a + b) >>> 0 }),
      scale = k.register('DSOUND.dll', 'AuthoredScale', {
        count: 1,
        real: true,
        fn: ([v]) => v / 2,
      }),
      modules = [
        [
          'D3D9.dll',
          new Map([
            ['AuthoredAdd', add],
            [17, add],
          ]),
        ],
        [
          'DSOUND.dll',
          new Map([
            ['AuthoredScale', scale],
            [3, scale],
          ]),
        ],
      ];
    for (const [name, exports] of reverse ? modules.reverse() : modules)
      k.registerHostModule(name, exports);
    return { add, scale, input: p.allocate(128, true) };
  };
  try {
    const a = install(first);
    const getProc = first.kernel.resolve({ dll: 'KERNEL32.dll', name: 'GetProcAddress' }),
      load = first.kernel.resolve({ dll: 'KERNEL32.dll', name: 'LoadLibraryA' });
    first.kernel.writeString(a.input, 'd3d9.dll');
    const d3d = await first.process.callAsync(load, [a.input]);
    const saved = structuredClone(first.snapshot());
    fresh.process.trap('authored earlier transient trap', 0, () => 0xdeadbeef);
    const b = install(fresh, true);
    assert.notEqual(b.add, a.add);
    assert.notEqual(fresh.kernel.moduleHandle('d3d9.dll'), d3d);
    fresh.restore(saved);
    const p = fresh.process,
      k = fresh.kernel;
    k.writeString(a.input, 'AuthoredAdd');
    assert.equal(await p.callAsync(getProc, [d3d, a.input]), a.add);
    assert.equal(await p.callAsync(getProc, [d3d, 17]), a.add);
    assert.equal(await p.callAsync(a.add, [7, 11]), 18);
    assert.equal(k.hostModules.byHandle(d3d).references, 2);
    const sound = k.moduleHandle('dsound.dll');
    assert.equal(await p.callAsync(getProc, [sound, 3]), a.scale);
    await p.callAsync(a.scale, [7]);
    assert.equal(p.load(p.traps.get(a.scale).resultAddress), floatBits(3.5));
    assert.equal(k.resolve({ dll: 'D3D9.dll', name: 'AuthoredAdd' }), a.add);
    assert.equal(await p.callAsync(a.add, [0xffffffff, 2]), 1);
    assert.equal(first.kernel.hostModules.byHandle(d3d).references, 2);
    assert.equal(await first.process.callAsync(a.add, [2, 3]), 5);
  } finally {
    await fresh.close();
    await first.close();
  }
});

test('platform export restoration rejects a changed provider ABI and a mismatched saved target', async () => {
  const f = await fixture();
  try {
    const saved = structuredClone(f.kernel.snapshot()),
      altered = structuredClone(saved);
    altered.hostModules.modules[0][1].exports[0][1].binding.args = 1;
    assert.throws(() => f.kernel.restore(altered), /matching platform provider/);
    const shifted = structuredClone(saved);
    shifted.hostModules.modules[0][1].exports[0][1].address += 32;
    assert.throws(() => f.kernel.restore(shifted), /matching platform provider/);
    f.kernel.restore(saved);
    assert.equal(f.kernel.hostModules.byHandle(f.handle).exports.get('AuthoredAdd'), f.exported);
  } finally {
    f.p.close();
  }
});
