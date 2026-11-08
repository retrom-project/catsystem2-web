// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEmoteDevice } from '../src/emote/native-device.mjs';
import { NativeEmoteBlocks } from '../src/emote/native-blocks.mjs';
import { NativeEmoteMeshBlocks } from '../src/emote/native-mesh.mjs';

const word = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24],
  smallProcess = async () => new PE32Process(await loadUnicorn(), { heapSize: 0x10000 });

function runCPU(p, start, end, limit) {
  p.pendingError = null;
  p.cpu.emu_start(start, end, 0, limit);
  if (p.pendingError) throw p.pendingError;
}

function setWords(registers, words) {
  for (const [name, value] of Object.entries(words)) registers[name] = Uint8Array.from(word(value));
}

test('host budget accounting is read-only when idle, invalid, stopping or insufficient', async () => {
  const p = await smallProcess(),
    code = p.allocate(32, true),
    bytes = Uint8Array.of(0x90, 0x40, 0xc3);
  p.write(code, bytes);
  const initial = p.registers();
  try {
    assert.deepEqual(p.instructionBudget(), { counter: 0n, limit: 0n, active: false });
    assert.equal(p.consumeInstructions(0), false);
    assert.equal(p.consumeInstructions(3), false);
    for (const value of [-1, 0.5, NaN, Infinity, 2 ** 53, '1', null, 1n])
      assert.throws(() => p.consumeInstructions(value), RangeError);
    assert.deepEqual(p.registers(), initial);
    assert.deepEqual(p.read(code, bytes.length), bytes);
    let visits = 0;
    const detach = p.beforeInstruction(code, 'atomic instruction accounting', () => {
      visits++;
      const state = p.registers(),
        memory = p.read(code, bytes.length),
        before = p.instructionBudget();
      assert.deepEqual(before, { counter: 1n, limit: 10n, active: true });
      assert.equal(p.consumeInstructions(Number.MAX_SAFE_INTEGER), false);
      assert.equal(p.consumeInstructions(10), false);
      assert.equal(p.consumeInstructions(0), true);
      assert.deepEqual(p.instructionBudget(), before);
      assert.deepEqual(p.registers(), state);
      assert.deepEqual(p.read(code, bytes.length), memory);
      p.cpu.emu_stop();
      const stopped = p.instructionBudget();
      assert.equal(stopped.active, false);
      assert.equal(p.consumeInstructions(0), false);
      assert.equal(p.consumeInstructions(1), false);
      assert.deepEqual(p.instructionBudget(), stopped);
      assert.deepEqual(p.registers(), state);
      assert.deepEqual(p.read(code, bytes.length), memory);
    });
    runCPU(p, code, code + bytes.length, 10);
    assert.equal(visits, 1);
    detach();
    const stoppedCPU = p.registers(),
      stoppedBudget = p.instructionBudget(),
      pointer = p.budgetTransfer(),
      handle = p.uc.getValue(p.cpu.handle_ptr, '*'),
      query = (args) =>
        p.uc.ccall(
          'uc_emu_budget_query',
          'number',
          ['pointer', 'pointer', 'pointer', 'pointer'],
          args,
        );
    for (const args of [
      [0, pointer, pointer + 8, pointer + 16],
      [handle, 0, pointer + 8, pointer + 16],
      [handle, pointer, 0, pointer + 16],
      [handle, pointer, pointer + 8, 0],
    ])
      assert.equal(query(args), p.uc.ERR_ARG);
    assert.equal(
      p.uc.ccall(
        'uc_emu_budget_consume',
        'number',
        ['pointer', 'number', 'pointer'],
        [0, 0n, pointer],
      ),
      p.uc.ERR_ARG,
    );
    assert.equal(
      p.uc.ccall(
        'uc_emu_budget_consume',
        'number',
        ['pointer', 'number', 'pointer'],
        [handle, 0n, 0],
      ),
      p.uc.ERR_ARG,
    );
    assert.deepEqual(p.registers(), stoppedCPU);
    assert.deepEqual(p.instructionBudget(), stoppedBudget);
  } finally {
    p.close();
  }
});

test('an atomic shortcut preserves every budget cutoff and uncounted execution', async () => {
  const p = await smallProcess(),
    code = p.allocate(64, true),
    data = p.allocate(32, true);
  p.write(code, [0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xff, 0x07, 0x40, 0x90]);
  p.cpu.reg_write_i32(p.uc.X86_REG_EDI, data);
  p.cpu.reg_write_i32(p.uc.X86_REG_EAX, 0x7fffffff);
  p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x203);
  const initial = p.registers();
  let enabled = false,
    accepted = 0;
  const detach = p.beforeInstruction(code, 'six exact no-ops', () => {
    if (!enabled) return;
    const budget = p.instructionBudget();
    assert.equal(budget.counter, budget.limit ? 1n : 0n);
    if (p.consumeInstructions(5)) {
      accepted++;
      p.cpu.reg_write_i32(p.uc.X86_REG_EIP, code + 6);
    }
  });
  try {
    for (const limit of [0, ...Array.from({ length: 12 }, (_, i) => i + 1)]) {
      const run = (useShortcut) => {
        enabled = useShortcut;
        p.zero(data, 32);
        p.writeRegisters(initial);
        runCPU(p, code, code + 10, limit);
        return { registers: p.registers(), bytes: p.read(data, 32), budget: p.instructionBudget() };
      };
      assert.deepEqual(run(true), run(false), `budget ${limit}`);
    }
    assert.ok(accepted > 0);
    const detachUnlimited = p.beforeInstruction(code + 9, 'uncounted accounting', () => {
      assert.deepEqual(p.instructionBudget(), { counter: 0n, limit: 0n, active: true });
      assert.equal(p.consumeInstructions(Number.MAX_SAFE_INTEGER), true);
      assert.deepEqual(p.instructionBudget(), { counter: 0n, limit: 0n, active: true });
    });
    enabled = false;
    runCPU(p, code, code + 10, 0);
    detachUnlimited();
  } finally {
    detach();
    p.close();
  }
});

test('enabling counting invalidates code translated in an uncounted segment', async () => {
  const p = await smallProcess(),
    code = p.allocate(64, true),
    program = [
      0xb8,
      0xff,
      0xff,
      0xff,
      0x7f,
      0x40,
      0xeb,
      24,
      ...Array(24).fill(0xcc),
      0x31,
      0xd2,
      0x01,
      0xc2,
      0x90,
    ],
    addresses = [0, 5, 6, 32, 34, 36, 37];
  p.write(code, program);
  const read = (name) => p.cpu.reg_read_i32(p.uc['X86_REG_' + name]) >>> 0;
  try {
    // Keep the same translated instructions, with no writes or new hooks,
    // while toggling between counted and uncounted execution.
    for (const limit of [0, 2, 0, 5, 0, 1, 6, 0, 2]) {
      p.cpu.reg_write_i32(p.uc.X86_REG_EDX, 0xdeadbeef);
      p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x203);
      runCPU(p, code, code + program.length, limit);
      assert.equal(read('EIP'), code + addresses[limit || 6]);
      assert.equal(read('EAX'), limit === 1 ? 0x7fffffff : 0x80000000);
      assert.equal(read('EDX'), limit === 1 || limit === 2 ? 0xdeadbeef : 0x80000000);
      assert.equal(read('EFLAGS'), limit === 1 ? 0x203 : limit === 2 ? 0xa97 : 0x286);
      assert.deepEqual(p.instructionBudget(), {
        counter: BigInt(limit && limit < 6 ? limit + 1 : limit),
        limit: BigInt(limit),
        active: false,
      });
    }
  } finally {
    p.close();
  }
});

test('instruction accounting follows each nested asynchronous execution segment', async () => {
  const p = await smallProcess(),
    outer = p.allocate(64, true),
    inner = p.allocate(32, true),
    segments = [];
  p.budget = 100;
  const trap = p.trap('nested budget check', 0, async () => {
    segments.push(['host', p.instructionBudget()]);
    assert.equal(await p.callFromHost(inner), 7);
    segments.push(['suspended', p.instructionBudget()]);
    assert.equal(p.consumeInstructions(0), false);
    return 9;
  });
  p.write(outer, [0x90, 0xe8, ...word(trap - (outer + 6)), 0x90, 0x40, 0xc3]);
  p.write(inner, [0xb8, 7, 0, 0, 0, 0xc3]);
  const detach = [
    p.beforeInstruction(outer, 'outer initial budget', () => {
      segments.push(['outer', p.instructionBudget()]);
      assert.equal(p.consumeInstructions(5), true);
    }),
    p.beforeInstruction(inner, 'nested initial budget', () => {
      segments.push(['inner', p.instructionBudget()]);
      assert.equal(p.consumeInstructions(3), true);
    }),
    p.beforeInstruction(outer + 6, 'outer resumed budget', () => {
      segments.push(['resume', p.instructionBudget()]);
      assert.equal(p.consumeInstructions(2), true);
    }),
  ];
  try {
    assert.equal(await p.callAsync(outer), 10);
    assert.deepEqual(segments, [
      ['outer', { counter: 1n, limit: 100n, active: true }],
      ['host', { counter: 8n, limit: 100n, active: true }],
      ['inner', { counter: 1n, limit: 100n, active: true }],
      ['suspended', { counter: 5n, limit: 100n, active: false }],
      ['resume', { counter: 2n, limit: 100n, active: true }],
    ]);
    assert.deepEqual(p.instructionBudget(), { counter: 6n, limit: 100n, active: false });
  } finally {
    for (const close of detach) close();
    p.close();
  }
});

test('host budget scratch is independent of guest checkpoints and fresh processes', async () => {
  const uc = await loadUnicorn(),
    p = new PE32Process(uc, { heapSize: 0x10000 }),
    copy = new PE32Process(uc, { heapSize: 0x10000 }),
    code = p.allocate(16);
  p.write(code, [0x90, 0xc3]);
  const install = (target) =>
    target.beforeInstruction(code, 'checkpoint budget hook', () => {
      assert.equal(target.consumeInstructions(4), true);
    });
  const detach = install(p),
    detachCopy = install(copy);
  try {
    assert.equal(p.call(code), 0);
    const state = p.snapshot();
    assert.equal(Object.hasOwn(state, 'budgetPointer'), false);
    copy.restore(state);
    assert.deepEqual(copy.instructionBudget(), { counter: 0n, limit: 0n, active: false });
    assert.notEqual(copy.budgetPointer, p.budgetPointer);
    assert.equal(copy.call(code), 0);
    assert.equal(p.call(code), 0);
    assert.deepEqual(copy.instructionBudget(), p.instructionBudget());
  } finally {
    detachCopy();
    detach();
    copy.close();
    p.close();
  }
});

function compareCutoffs({
  p,
  loops,
  arena,
  bytes,
  start,
  end,
  codeStart = start,
  codeEnd = end,
  initial,
}) {
  const run = (enabled, limit) => {
    loops.enabled = enabled;
    p.write(arena, bytes);
    p.writeRegisters(initial);
    runCPU(p, start, end, limit);
    return {
      registers: p.registers(),
      bytes: p.read(arena, bytes.length),
      budget: p.instructionBudget(),
    };
  };
  // Observe the real loop to obtain its dynamic instruction sequence. The
  // expected count and next PC do not come from the shortcut's cost formula.
  const trace = [],
    hook = p.cpu.hook_add(
      p.uc.HOOK_CODE,
      (_cpu, pc) => trace.push(Number(pc)),
      null,
      codeStart,
      codeEnd - 1,
    );
  try {
    p.invalidateExecutable(codeStart, codeEnd);
    run(false, 0);
  } finally {
    p.cpu.hook_del(hook);
    p.invalidateExecutable(codeStart, codeEnd);
  }
  const hits = loops.hits;
  for (let limit = 0; limit <= trace.length + 3; limit++) {
    const expected = run(false, limit),
      next = new DataView(expected.registers.EIP.buffer).getUint32(0, true);
    assert.equal(next, (limit && trace[limit]) || end, `native cutoff ${limit}`);
    assert.equal(expected.budget.counter, BigInt(limit ? Math.min(limit + 1, trace.length) : 0));
    assert.deepEqual(run(true, limit), expected, `shortcut cutoff ${limit}`);
    if (limit && limit < trace.length) assert.equal(loops.hits, hits + 1);
  }
  assert.ok(loops.hits > hits + 1);
}

const driver = process.env.CATSYSTEM2_EMOTE_DLL,
  deviceOptions = { width: 32, height: 32, now: () => 0, epoch: 0 };

test(
  'bicubic shortcuts preserve complete CPU and arena at every original instruction cutoff',
  { skip: !driver },
  async () => {
    const device = await NativeEmoteDevice.open(
        new Uint8Array(await readFile(driver)),
        deviceOptions,
      ),
      p = device.process,
      loops = new NativeEmoteBlocks(device),
      arena = p.allocate(0x8000, true),
      bytes = new Uint8Array(0x8000),
      data = new DataView(bytes.buffer),
      start = device.module.base + 0x3f2f0,
      end = device.module.base + 0x3f46f;
    for (let at = 0; at < bytes.length; at += 4)
      data.setFloat32(at, (((at * 7) % 39) - 19) / 31, true);
    data.setUint32(0xc00, arena + 0x1000, true);
    data.setUint32(0xc04, arena + 0x1000 + 5 * 8, true);
    for (const [i, v] of [1, 3, 3, 1].entries()) data.setFloat32(0x130 + i * 4, v, true);
    const initial = p.registers();
    setWords(initial, {
      ESP: arena + 0x100,
      EBP: arena + 0x300,
      EDI: arena + 0x800,
      ESI: arena + 0xc00,
      EDX: arena + 0x1000,
      ECX: 1,
      MXCSR: 0x1f80,
      EFLAGS: 0x203,
    });
    // registers() stores the raw bytes for SIMD registers.
    initial.XMM2 = new Uint8Array(Float32Array.of(1, 0, 0, 0).buffer);
    initial.XMM7 = new Uint8Array(Float32Array.of(1, 3, 3, 1).buffer);
    try {
      compareCutoffs({ p, loops, arena, bytes, start, end, initial });
    } finally {
      loops.close();
      device.close();
    }
  },
);

test(
  'mesh shortcuts reserve the final native iteration at every instruction cutoff on both push_back paths',
  { skip: !driver },
  async () => {
    const device = await NativeEmoteDevice.open(
        new Uint8Array(await readFile(driver)),
        deviceOptions,
      ),
      p = device.process,
      loops = new NativeEmoteMeshBlocks(device),
      arena = p.allocate(0x20000, true),
      bytes = new Uint8Array(0x20000),
      data = new DataView(bytes.buffer),
      start = device.module.base + 0x58b44,
      end = device.module.base + 0x58c48;
    for (let at = 0; at < bytes.length; at += 4)
      data.setUint32(at, Math.imul(at, 9121549) >>> 0, true);
    try {
      for (const stack of [0x1000, 0x1e000]) {
        const set = (at, value) => data.setUint32(at, value, true);
        for (const [offset, value] of [
          [0x14, 2],
          [0x1c, arena + 0x4000],
          [0x2c, 5],
          [0x30, arena + 0x6000],
          [0x34, arena + 0x7000],
          [0x38, arena + 0x5000],
          [0x3c, 0x44],
          [0x40, 0x404],
          [0x44, arena + 0x9000],
        ])
          set(stack + offset, value);
        set(0x439c, arena + 0x8000);
        set(0x9000, arena + 0xa000);
        set(0x5000, arena + 0xc000);
        set(0x5004, arena + 0xc000);
        set(0x5008, arena + 0xc000 + 5 * 48);
        const initial = p.registers();
        setWords(initial, {
          EBX: 0x108,
          ECX: arena + 0x5000,
          EDX: 2,
          ESI: 1,
          EDI: 0x808,
          ESP: arena + stack,
          EFLAGS: 0x203,
          MXCSR: 0x1f80,
        });
        compareCutoffs({
          p,
          loops,
          arena,
          bytes,
          start,
          end,
          initial,
          codeStart: start - 4,
          codeEnd: device.module.base + 0x59159,
        });
      }
    } finally {
      loops.close();
      device.close();
    }
  },
);
