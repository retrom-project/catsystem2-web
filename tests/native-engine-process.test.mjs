// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import {
  NativeEngineProcess,
  NativeEngineWindows,
  NATIVE_ENGINE_IMAGES,
} from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_CONFIGURATION_MEMORY_LAYOUTS } from '../src/native/config-memory.mjs';
import { serializeNativePreferences } from '../src/native/preferences.mjs';
import { readNativeStartupPreferences } from '../src/native/engine-preferences.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { memoryGame } from './helpers.mjs';

for (const [profile, variable, encoding] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'Shift_JIS'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'UTF-8'],
])
  test(
    `${profile} native game defaults use the qualified config mount before live preferences`,
    { skip: !process.env[variable] },
    async () => {
      const executable = new Uint8Array(await readFile(process.env[variable])),
        xml = (limit) =>
          new TextEncoder().encode(
            `<?xml version="1.0" encoding="${encoding}"?><document><MESSAGE><log_limit>${limit}</log_limit></MESSAGE></document>`,
          ),
        game = memoryGame({
          'engine.exe': executable,
          'gamedef.xml': xml(117),
          'config.int/gamedef.xml': xml(321),
        }),
        reads = [],
        preferences = new NativeConfiguration({ profile, uiLanguage: 0x411 }),
        make = () => {
          const random = new ParticleRandom(),
            configuration = new NativeConfiguration({ profile, uiLanguage: 0x411 });
          new DataView(configuration.blocks[1].buffer).setUint32(9 * 4, 513, true);
          return new NativeWorld({
            profile,
            game,
            bootstrapOwner: { glyphs: {} },
            configuration,
            images: {},
            host: {},
            audio: {},
            random,
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage: {
              read: async (path) => {
                reads.push(path);
                return game.read(path);
              },
            },
          });
        },
        read = (engine, address) => {
          const offset =
            NATIVE_CONFIGURATION_MEMORY_LAYOUTS[profile].blocks[1] -
            NATIVE_ENGINE_IMAGES[profile].settingsOffset;
          return engine.process.load(address + offset + 9 * 4);
        };
      new DataView(preferences.blocks[1].buffer).setUint32(9 * 4, 647, true);
      preferences.setField('screen.width', 913);
      preferences.setField('general.disableMovie', 1);
      const world = make(),
        fresh = make();
      try {
        const engine = await world.ensureNativeEngine();
        assert.ok(reads.includes('config.int/gamedef.xml'));
        assert.ok(!reads.includes('gamedef.xml'));
        assert.equal(read(engine, engine.refs.defaultSettings), 321);
        assert.equal(read(engine, engine.refs.settings), 513);
        await readNativeStartupPreferences(engine, (name) => {
          assert.equal(name, 'setup.xml');
          return serializeNativePreferences(preferences);
        });
        assert.equal(read(engine, engine.refs.settings), 647);
        assert.equal(world.configuration.getField('screen.width'), 913);
        assert.equal(world.configuration.getField('general.disableMovie'), 1);
        const saved = engine.snapshot(),
          restored = await fresh.ensureNativeEngine();
        assert.equal(read(restored, restored.refs.settings), 513);
        restored.restore(saved);
        assert.equal(read(restored, restored.refs.defaultSettings), 321);
        assert.equal(read(restored, restored.refs.settings), 647);
        assert.equal(fresh.configuration.getField('screen.width'), 913);
      } finally {
        await fresh.close();
        await world.close();
      }
    },
  );

for (const [profile, variable, openFile, wide] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x4b22c0, false],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x5d57a0, true],
])
  test(
    `${profile} original file server continues an open loose file in a fresh engine`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        content = Uint8Array.of(17, 83, 0, 47, 10, 255, 21),
        reads = [],
        mount = (mounted) =>
          NativeEngineProcess.open({
            profile,
            bytes,
            bootstrapOwner: { glyphs: {} },
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            readFile: async (path) => {
              if (path !== 'dir/loose.bin') return null;
              reads.push(path);
              return mounted ? content : null;
            },
          }),
        first = await mount(true),
        { process: p } = first,
        name = p.allocate(64, true),
        destination = p.allocate(8, true),
        server = first.refs.fileServer;
      let fresh;
      try {
        first.kernel.writeString(name, 'dir\\loose.bin', wide);
        const file = await p.callAsync(openFile, [name, 1], server);
        assert.ok(file);
        assert.deepEqual(reads, ['dir/loose.bin']);
        const table = p.load(file),
          read = p.load(table + 12),
          destroy = p.load(table);
        assert.equal(await p.callAsync(read, [destination, 3], file), 3);
        assert.deepEqual(p.read(destination, 3), content.subarray(0, 3));
        const saved = first.snapshot();
        await p.callAsync(destroy, [1], file);
        assert.equal(first.kernel.files.size, 0);

        fresh = await mount(false);
        fresh.restore(saved);
        assert.equal(fresh.refs.fileServer, server);
        const restored = fresh.process;
        assert.equal(await restored.callAsync(read, [destination, 8], file), 4);
        assert.deepEqual(restored.read(destination, 4), content.subarray(3));
        assert.equal(await restored.callAsync(read, [destination, 8], file), 0);
        await restored.callAsync(destroy, [1], file);
        assert.equal(fresh.kernel.files.size, 0);
        assert.deepEqual(reads, ['dir/loose.bin'], 'restore continues the saved open descriptor');
      } finally {
        await fresh?.close();
        await first.close();
      }
      for (const engine of [first, fresh]) {
        assert.equal(engine.refs.fileServer, undefined);
        assert.equal(engine.process.allocations.has(server), false);
      }
    },
  );

for (const [profile, variable, encoding] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'Shift_JIS'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'UTF-8'],
])
  test(
    `${profile} original Engine construction parses startup and retains its distinct default Settings`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        source = new TextEncoder().encode(
          `<?xml version="1.0" encoding="${encoding}"?><document><SCREEN><v_width>913</v_width><v_height>617</v_height></SCREEN></document>`,
        ),
        requests = [],
        make = async () => {
          const configuration = new NativeConfiguration({ profile, uiLanguage: 0x411 });
          Object.assign(configuration.screen, { virtualWidth: 1237, virtualHeight: 719 });
          return NativeEngineProcess.open({
            profile,
            bytes,
            configuration,
            bootstrapOwner: {},
            readFile: async (name) => {
              requests.push(name);
              return name === 'config/startup.xml' ? source : null;
            },
          });
        },
        engine = await make(),
        image = NATIVE_ENGINE_IMAGES[profile],
        offset = engine.configurationMemory.layout.virtualSize - image.settingsOffset,
        values = ({ refs, process }) => [
          process.load(refs.defaultSettings + offset),
          process.load(refs.settings + offset),
        ];
      let restored;
      try {
        assert.deepEqual(values(engine), [(617 << 16) | 913, (719 << 16) | 1237]);
        assert.ok(requests.includes('config/startup.xml'));
        assert.equal(engine.textWindows.objects.size, 0);
        restored = await make();
        restored.restore(engine.snapshot());
        assert.deepEqual(values(restored), values(engine));
        await restored.releaseOwner();
        assert.equal(restored.process.load(image.ownerGlobal), 0);
        assert.equal(engine.process.load(image.ownerGlobal), engine.refs.owner);
        assert.deepEqual(values(engine), [(617 << 16) | 913, (719 << 16) | 1237]);
      } finally {
        await restored?.close();
        await engine.close();
      }
    },
  );

test('queued native messages keep separate contexts and nested calls restore their parent context', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    seen = [],
    inner = p.trap('authored context child', 0, () => {
      seen.push(engine.currentMessageContext.context.value);
      return 7;
    }),
    outer = p.trap('authored context parent', 0, async () => {
      const original = engine.currentMessageContext;
      await Promise.resolve();
      assert.equal(engine.currentMessageContext, original);
      await engine.callFromHost(inner, [], undefined, {
        messageContext: { receiver: 99, context: { value: original.context.value + 10 } },
      });
      assert.equal(engine.currentMessageContext, original);
      seen.push(original.context.value);
      return original.context.value;
    });
  try {
    const first = { receiver: 1, context: { value: 1 } },
      second = { receiver: 2, context: { value: 2 } };
    assert.deepEqual(
      await Promise.all([
        engine.call(outer, [], undefined, { messageContext: first }),
        engine.call(outer, [], undefined, { messageContext: second }),
      ]),
      [1, 2],
    );
    assert.deepEqual(seen, [11, 1, 12, 2]);
    assert.equal(engine.currentMessageContext, undefined);
  } finally {
    await engine.close();
  }
});

test('native data heaps and stacks stay nonexecutable while explicit executable pages survive a fresh checkpoint', async () => {
  const open = async () =>
      new NativeEngineProcess(await loadUnicorn(), { profile: 'nekopara-vol3-engine-2.6.1.76' }),
    first = await open(),
    p = first.process,
    code = p.allocate(16, true),
    oldProtection = p.allocate(4, true),
    protect = first.kernel.resolve({ dll: 'KERNEL32.dll', name: 'VirtualProtect' });
  let second;
  try {
    p.write(code, [0xb8, 7, 0, 0, 0, 0xc3]);
    assert.throws(() => p.call(code), /FETCH_PROT|protected|fetch/i);
    p.write(p.stackBottom, [0xb8, 9, 0, 0, 0, 0xc3]);
    assert.throws(() => p.call(p.stackBottom), /FETCH_PROT|protected|fetch/i);
    assert.equal(p.call(protect, [code, 16, 0x40, oldProtection]), 1);
    assert.equal(p.load(oldProtection), 4);
    assert.equal(p.call(code), 7);
    const saved = first.snapshot();
    second = await open();
    second.kernel.resolve({ dll: 'KERNEL32.dll', name: 'VirtualProtect' });
    second.restore(saved);
    assert.equal(second.process.call(code), 7);
    assert.throws(
      () => second.process.call(second.process.stackBottom),
      /FETCH_PROT|protected|fetch/i,
    );
    assert.equal(second.process.call(protect, [code, 16, 4, oldProtection]), 1);
    assert.throws(() => second.process.call(code), /FETCH_PROT|protected|fetch/i);
    // Removing a transient override during restore must return this page to
    // its original RW heap protection, rather than a blanket RWX default.
    const writable = first.process.allocate(8192, true),
      page = Math.ceil(writable / 4096) * 4096;
    first.process.write(page, [0xb8, 11, 0, 0, 0, 0xc3]);
    const dataState = first.snapshot();
    assert.equal(p.call(protect, [page, 16, 0x40, oldProtection]), 1);
    assert.equal(p.call(page), 11);
    first.restore(dataState);
    assert.throws(() => p.call(page), /FETCH_PROT|protected|fetch/i);
  } finally {
    await second?.close();
    await first.close();
  }
});

test('native asynchronous host services resume the existing stack and retain stdcall cleanup', async () => {
  const p = new PE32Process(await loadUnicorn());
  try {
    let calls = 0;
    const fn = p.trap('authored async host', 2, async ([a, b]) => {
      calls++;
      await Promise.resolve();
      assert.throws(() => p.snapshot(), /running/);
      return a + b;
    });
    assert.equal(await p.callAsync(fn, [5, 7]), 12);
    assert.equal(calls, 1);
    assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0, p.stackTop);
    assert.equal(await p.callAsync(fn, [11, 13]), 24);
    assert.equal(calls, 2);
  } finally {
    p.close();
  }
});
test('late Windows registration updates both the imported callback and its stack ABI', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, { now: () => 0, epoch: 0 });
  try {
    const before = kernel.resolve({ dll: 'USER32.dll', name: 'AuthoredSum' });
    const after = kernel.register('USER32.dll', 'AuthoredSum', {
      count: 3,
      fn: ([a, b, c]) => a + b + c,
    });
    assert.equal(before, after);
    assert.equal(p.call(before, [2, 3, 5]), 10);
    assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0, p.stackTop);
  } finally {
    p.close();
  }
});
test('native file reads await mounted bytes and checkpoint the open handle position', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, {
      now: () => 0,
      epoch: 0,
      readFile: async (path) => (path === 'data/model.psb' ? Uint8Array.of(1, 2, 3, 4, 5) : null),
    }),
    name = p.allocate(64, true),
    out = p.allocate(16, true);
  try {
    kernel.writeString(name, 'data\\model.psb');
    const create = kernel.resolve({ dll: 'KERNEL32.dll', name: 'CreateFileA' }),
      read = kernel.resolve({ dll: 'KERNEL32.dll', name: 'ReadFile' });
    const handle = await p.callAsync(create, [name, 0x80000000, 1, 0, 3, 0x80, 0]);
    assert.notEqual(handle, 0xffffffff);
    assert.equal(p.call(read, [handle, out, 2, out + 8, 0]), 1);
    assert.deepEqual([...p.read(out, 2)], [1, 2]);
    const state = kernel.snapshot();
    p.call(read, [handle, out, 2, out + 8, 0]);
    assert.deepEqual([...p.read(out, 2)], [3, 4]);
    kernel.restore(state);
    p.call(read, [handle, out, 3, out + 8, 0]);
    assert.deepEqual([...p.read(out, 3)], [3, 4, 5]);
    assert.equal(p.load(out + 8), 3);
    assert.throws(() => kernel.path('../escape'), /escaped/);
  } finally {
    p.close();
  }
});

test('suspended host callbacks can enter the same guest while retaining the outer stack and floating registers', async () => {
  const p = new PE32Process(await loadUnicorn());
  try {
    const inner = p.allocate(16, true),
      outer = p.allocate(64, true);
    p.write(inner, [0x8b, 0x44, 0x24, 0x04, 0x03, 0x44, 0x24, 0x08, 0xc2, 0x08, 0x00]);
    const host = p.trap('authored nested service', 2, async (args) => {
      const before = p.registers();
      const value = await p.callFromHost(inner, args);
      assert.deepEqual(p.registers(), before);
      return value;
    });
    const code = Uint8Array.of(0x6a, 8, 0x6a, 5, 0xe8, 0, 0, 0, 0, 0x83, 0xc0, 1, 0xc3);
    new DataView(code.buffer).setInt32(5, host - outer - 9, true);
    p.write(outer, code);
    assert.equal(await p.callAsync(outer), 14);
    assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0, p.stackTop);
    await assert.rejects(p.callFromHost(inner, [1, 2]), /suspended/);
  } finally {
    p.close();
  }
});

test('Win32 Unicode conversion preserves a leading BOM as data', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, { now: () => 0, epoch: 0 }),
    input = p.allocate(16, true),
    output = p.allocate(16, true);
  try {
    p.write(input, [0xef, 0xbb, 0xbf, 0x41]);
    const convert = kernel.resolve({ dll: 'KERNEL32.dll', name: 'MultiByteToWideChar' });
    assert.equal(p.call(convert, [65001, 0, input, 4, output, 8]), 2);
    assert.deepEqual([...p.read(output, 4)], [255, 254, 65, 0]);
    assert.equal(p.string(output, true), '\ufeffA');
  } finally {
    p.close();
  }
});
test('native file writes retain seek holes and flush the exact bytes through their mounted provider', async () => {
  let written;
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, {
      now: () => 0,
      epoch: 0,
      readFile: async () => null,
      writeFile: async (path, bytes) => {
        written = [path, bytes.slice()];
      },
    }),
    name = p.allocate(64, true),
    data = p.allocate(8, true);
  try {
    kernel.writeString(name, 'm2setting.xml');
    p.write(data, [9, 8]);
    const resolve = (name) => kernel.resolve({ dll: 'KERNEL32.dll', name }),
      handle = await p.callAsync(resolve('CreateFileA'), [name, 0x40000000, 1, 0, 2, 0x80, 0]);
    assert.equal(p.call(resolve('SetFilePointer'), [handle, 3, 0, 0]), 3);
    assert.equal(p.call(resolve('WriteFile'), [handle, data, 2, data + 4, 0]), 1);
    assert.equal(p.load(data + 4), 2);
    assert.equal(written, undefined);
    assert.equal(await p.callAsync(resolve('CloseHandle'), [handle]), 1);
    assert.equal(written[0], 'm2setting.xml');
    assert.deepEqual([...written[1]], [0, 0, 0, 9, 8]);
  } finally {
    p.close();
  }
});

test('a fresh shared process restores late host callbacks and their original floating result addresses', async () => {
  const unicorn = await loadUnicorn(),
    create = () => {
      const engine = new NativeEngineProcess(unicorn, { profile: 'authored', heapSize: 0x100000 });
      engine.registerFeature('authored', {
        snapshot: () => ({}),
        restore() {},
        recoverTrap: ({ name }) =>
          name === 'late float'
            ? { args: 0, real: true, handler: () => 1.25 }
            : name.startsWith('late integer ')
              ? { args: 1, real: false, handler: ([word]) => word + 7 }
              : null,
      });
      return engine;
    },
    first = create(),
    second = create();
  try {
    const p = first.process,
      integer = p.nextTrap;
    for (let i = 0; i < 19; i++) p.trap(`late integer ${i}`, 1, ([word]) => word + 7);
    const real = p.trap('late float', 0, () => 1.25, true),
      output = p.allocate(4),
      code = p.allocate(16),
      instructions = Uint8Array.of(0xd9, 0x1d, 0, 0, 0, 0, 0xc3);
    new DataView(instructions.buffer).setUint32(2, output, true);
    p.write(code, instructions);
    const state = first.snapshot();
    // Fresh feature installation need not replay the runtime allocation order.
    second.process.allocate(4096);
    second.restore(state);
    assert.equal(second.process.nextTrap, p.nextTrap);
    assert.equal(await second.call(integer, [8]), 15);
    await second.call(real);
    await second.call(code);
    assert.equal(new DataView(second.process.read(output, 4).buffer).getFloat32(0, true), 1.25);
    assert.deepEqual(second.process.allocations, p.allocations);
  } finally {
    await second.close();
    await first.close();
  }
});

test('native out-word observation distinguishes an unwritten word from writing its existing value', async () => {
  const p = new PE32Process(await loadUnicorn()),
    out = p.allocate(4, true),
    code = p.allocate(16),
    bytes = Uint8Array.of(0xc7, 0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0xc3);
  new DataView(bytes.buffer).setUint32(2, out, true);
  p.write(code, bytes);
  try {
    const untouched = p.watchWrites(out, 4);
    assert.equal(untouched.written, false);
    untouched.close();
    const native = p.watchWrites(out, 4);
    p.call(code);
    assert.equal(native.written, true);
    native.close();
    const host = p.watchWrites(out, 4);
    p.store(out, 0);
    assert.equal(host.written, true);
    host.close();
    assert.equal(p.writeObservers.size, 0);
  } finally {
    p.close();
  }
});

test('bulk guest transfers retain the original CPU binding bytes and unmapped-range errors', async () => {
  const p = new PE32Process(await loadUnicorn());
  try {
    const pointer = p.allocate(262144),
      bytes = Uint8Array.from({ length: 262144 }, (_, i) => (i * 197 + (i >>> 7)) & 255);
    p.write(pointer, bytes);
    assert.deepEqual(p.cpu.mem_read(pointer, bytes.length), bytes);
    p.cpu.mem_write(pointer + 3, bytes.subarray(17, 65733));
    assert.deepEqual(p.read(pointer, bytes.length), p.cpu.mem_read(pointer, bytes.length));
    const first = p.read(pointer, 100);
    p.zero(pointer, 100);
    assert.notDeepEqual(first, p.read(pointer, 100));
    assert.deepEqual(
      first,
      bytes.subarray(0, 100).map((byte, i) => (i < 3 ? byte : bytes[i + 14])),
    );
    for (const read of [() => p.read(0x40000000, 4), () => p.cpu.mem_read(0x40000000, 4)])
      assert.throws(read);
    for (const write of [
      () => p.write(0x40000000, bytes.subarray(0, 4)),
      () => p.cpu.mem_write(0x40000000, bytes.subarray(0, 4)),
    ])
      assert.throws(write);
  } finally {
    p.close();
  }
});
