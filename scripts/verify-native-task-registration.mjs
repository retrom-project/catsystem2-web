// SPDX-License-Identifier: MPL-2.0
// Original KCS wrappers, Top factory and ordered-map registration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_ENGINE_MESSAGE_LAYOUTS } from '../src/native/engine-message.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, report] = process.argv.slice(2);
if (!filename || !report)
  throw new Error('Usage: node scripts/verify-native-task-registration.mjs FIXED_EXE REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (key) => NATIVE_ENGINE_IMAGES[key].sha256 === sha256,
  );
if (!profile) throw new Error('Task registration oracle requires a frozen image');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  layout = NATIVE_ENGINE_MESSAGE_LAYOUTS[profile],
  table = sdk ? 0xb3c900 : 0xa2dd38,
  lookup = sdk ? 0x4b9690 : 0x5dd450,
  faultPC = sdk ? 0x4b9cd1 : 0x685ec1,
  machine = new KCSMachine(await readKCS(kcsProgram([[59]], [[64, 'Authored child']]))),
  memory = new NativeKCSMemory(p, machine),
  name = p.allocate(32, true),
  top = p.allocate(656, true),
  out = p.allocate(12, true),
  argv = p.allocate(12, true);
let comparisons = 0,
  allocated = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const u32 = (at) => p.load(at);
const idOf = (pointer) => u32(pointer + 4);
const map = (owner) => {
  const head = u32(u32(owner + 8)),
    walk = (node) =>
      node === head
        ? []
        : [...walk(u32(node)), [u32(node + 16), u32(node + 20)], ...walk(u32(node + 8))];
  return new Map(walk(u32(head + 4)));
};
const find = async (owner, id) => {
  p.store(out + 4, NATIVE_RESULT_SENTINEL);
  return [await engine.call(lookup, [id, out + 4], owner), u32(out + 4)];
};
const call = async (owner, id, ...args) => {
  allocated = 0;
  p.write(out, new Uint8Array(12).fill(0xcc));
  args.forEach((word, i) => p.store(argv + i * 4, word));
  const slot = table + id * 4,
    control = await engine.call(u32(slot), [memory.pointer, owner, argv, out + 4], slot);
  check(u32(out), NATIVE_RESULT_SENTINEL, 'prefix canary');
  check(u32(out + 8), NATIVE_RESULT_SENTINEL, 'suffix canary');
  check(control, 1, 'original query/creation control');
  return u32(out + 4);
};
for (const [address, count] of sdk
  ? [
      [0x4c2c60, 5],
      [0x4c62b0, 3],
    ]
  : [
      [0x5e69a0, 5],
      [0x5ea210, 3],
    ])
  engine.patch(
    address,
    'device task Base-only constructor boundary',
    count,
    (args) =>
      engine.callFromHost(
        layout.baseCtor,
        args.slice(0, 3),
        p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
      ),
    { calleePops: true },
  );
const stop = p.beforeInstruction(
  sdk ? 0x4bb053 : 0x5dec93,
  'observe original Top factory return',
  () => {
    allocated = p.cpu.reg_read_i32(p.uc.X86_REG_EAX) >>> 0;
  },
);
try {
  p.write(name, new TextEncoder().encode('Authored Top\0'));
  await engine.call(layout.rootCtor, [0, name, 60, 0, 0], top);
  p.store(top + 64, 1);
  p.store(top + 100, 203);
  const make = async (caller, kind, target, value, parent) => {
    check(await call(caller, 0x42, kind, target, 64), value, 'Main42 output word');
    const pointer = allocated;
    assert.ok(pointer && p.allocations.has(pointer), 'the original factory allocated a task');
    check(u32(pointer + 12), parent, 'original parent field');
    check(u32(pointer + 100), 203, 'original factory inherits the Top clock');
    check(u32(pointer + 64), kind, 'original factory kind');
    return pointer;
  };
  const caller = await make(top, 0, 0, 3, top),
    sibling = await make(caller, 0, 0, 4, top),
    under = await make(caller, 17, idOf(caller), 5, caller),
    id = 6;
  p.store(out + 4, NATIVE_RESULT_SENTINEL);
  check(
    await engine.call(layout.send, [idOf(caller), 0, 2, idOf(caller), caller, 0, out + 4], caller),
    1,
    'duplicate reaches the original Base registration handler',
  );
  check(u32(out + 4), 0, 'an existing key rejects the same original pointer');
  const first = await make(caller, 0, idOf(under), id, 0);
  check(idOf(first), id);
  check(map(top).get(id), caller, 'ancestor remembers the first branch');
  check(map(caller).get(id), under, 'immediate ancestor remembers the rejected branch');
  check(map(under).size, 0, 'the receiver did not register the child');
  check(await find(top, id), [0, under], 'lookup misses and retains the last pointer');
  check(await call(caller, 0x4d, id), 1, 'existence tests the ancestor map');
  check(await call(caller, 0x4a, id), 0xffffffff, 'ordinary routing still misses');
  check(await call(caller, 0x4b, 1), id, 'direct child enumeration reads the alias key');
  const visits = [0, 0],
    underTable = u32(under),
    detach = [8, 12].map((offset, i) =>
      p.beforeInstruction(u32(underTable + offset), 'observe aliased frame visit', () => {
        if (p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0 === under) visits[i]++;
      }),
    );
  try {
    await engine.call(u32(u32(caller) + 8), [204, out + 4], caller);
    await engine.call(u32(u32(caller) + 12), [204], caller);
    check(visits, [2, 2], 'both route keys visit the same direct child');
    check(u32(first + 100), 203, 'unattached task never receives the frame');
  } finally {
    detach.forEach((remove) => remove());
  }

  const repeated = await make(caller, 0, idOf(under), id, 0);
  assert.notEqual(repeated, first);
  check(idOf(repeated), id, 'unreachable allocation does not reserve the ID');
  const rejected = await make(caller, 0, idOf(caller), NATIVE_RESULT_SENTINEL, 0);
  check(idOf(rejected), id, 'direct duplicate writes NULL to the factory reply');
  const local = await make(caller, 0, idOf(sibling), id, sibling);
  check(await find(sibling, id), [1, local], 'a different direct parent accepts the same ID');
  check(map(top).get(id), caller, 'the existing ancestor entry is retained');
  check(await call(caller, 0x4a, id), 0xffffffff);
  check(await call(sibling, 0x4a, id), 0);
  await make(caller, 0, 0, NATIVE_RESULT_SENTINEL, 0);
  await make(caller, 0, 0x1234, id, 0);

  await engine.call(u32(u32(under)), [1], under);
  check(p.allocations.has(under), false);
  check(map(caller).get(5), 0, 'unregister clears the original task key');
  check(map(caller).get(id), under, 'the other key retains the released address');
  check(u32(under + 8), 0, 'the deleted branch no longer has a task map');
  p.budget = 50000;
  await assert.rejects(find(top, id), /instruction budget exhausted/);
  p.cpu.mem_protect(0, 4096, 0);
  try {
    await assert.rejects(find(top, id), (error) => error.nativeFault?.pc === faultPC);
  } finally {
    p.cpu.mem_protect(0, 4096, p.uc.PROT_ALL);
  }
  await writeFile(
    report,
    JSON.stringify(
      {
        profile,
        sha256,
        comparisons,
        faultPC,
        boundary:
          'Original wrappers, Top factory, receivers and task maps. Input and sound use the original Base constructor in place of device setup.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Native task registration passed ${comparisons} comparisons and both stale-pointer checks`,
  );
} finally {
  stop();
  memory.close();
  await engine.close();
}
