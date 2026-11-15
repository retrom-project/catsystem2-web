// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { notify } from './fixtures/fes-effekseer-world.mjs';
import { kcsProgram, hg3 } from './helpers.mjs';

async function expectMissingHead(instance, invoke, head) {
  const getters = [],
    argument = instance.argumentBytes,
    records = structuredClone(instance.runtime.pendingRecords),
    queuePending = instance.nativeQueuePending,
    commands = instance.player.pending.size;
  instance.argumentBytes = function (token, ...args) {
    getters.push(typeof token === 'string' ? token : new TextDecoder().decode(token));
    return argument.call(this, token, ...args);
  };
  try {
    await assert.doesNotReject(
      async () => invoke(),
      'a missing native record follows whole-row arithmetic',
    );
  } finally {
    instance.argumentBytes = argument;
  }
  assert.deepEqual(getters, [head, head], 'only the two native head getter stages ran');
  assert.deepEqual(instance.runtime.pendingRecords, records);
  assert.equal(instance.nativeQueuePending, queuePending);
  assert.equal(instance.player.pending.size, commands);
}

const ascii = (text) => new TextEncoder().encode(text),
  decode = (bytes) => new TextDecoder().decode(bytes),
  operands = '($20++&0) probe quad.hg3 1+($21++&0) -17+($22++&0)',
  source = `#DEFINE
PARTICLE p[3]
SOUND other
#START
$20=0
$21=0
$22=0
next IDLE
#IDLE
break
next IDLE
#DELETE
p[1] delete
break
#EMPTY
p[99] init ${operands}
$40=++$40
break
#OTHER
other init ${operands}
$41=++$41
break
#APPLY
p param 9
p init ${operands}
p[0] start
p[2] start
$42=++$42
break
`;

async function open(profile) {
  const world = await defaultFESWorld(profile, {
    'screen.fes': ascii(source),
    'ptcl/probe.kcs': kcsProgram([[59]]),
    'quad.hg3': hg3(1, 1, Uint8Array.of(255, 255, 255, 255)),
  });
  try {
    world.graphics.createLogicalDevice();
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return { ...h, world, runtime: h.instance.runtime };
  } catch (error) {
    await world.close();
    throw error;
  }
}

function child(h, object) {
  assert.equal(object.nativeType, 23);
  const resource = object.particleResource,
    record = h.world.objects.objects.get(resource.taskID);
  assert.equal(resource.owner, h.id);
  assert.equal(record.kind, 16);
  assert.equal(record.parent, h.id);
  assert.equal(record.creator, h.id);
  assert.equal(h.world.particles.get(record.id), record.implementation);
  return record;
}

function configured(object) {
  return {
    family: object.family,
    program: object.program,
    texture: object.texture,
    count: object.count,
    priority: object.priority,
    allocationDirty: object.allocationDirty,
    dirty: object.dirty,
    registers: [...object.registers],
  };
}

function observe(h, objects) {
  const traces = [],
    messages = [],
    reads = [],
    command = h.runtime.command.bind(h.runtime),
    count = h.instance.collection.count.bind(h.instance.collection),
    lookup = h.instance.collection.lookup.bind(h.instance.collection),
    argument = h.instance.argumentBytes.bind(h.instance),
    value = h.instance.value.bind(h.instance),
    write = h.instance.setGlobal.bind(h.instance),
    sound = h.world.fesSound.command.bind(h.world.fesSound),
    send = h.world.sendEngine.bind(h.world);
  let active = null;
  h.runtime.command = async (verb, selection, args, context) => {
    if (verb !== 'init') return command(verb, selection, args, context);
    const trace = {
      name: decode(selection.nameBytes),
      events: [],
      filenames: [],
      valueCalls: 0,
      soundCalls: [],
      before: objects.map(configured),
    };
    traces.push(trace);
    active = { trace, args };
    try {
      const result = await command(verb, selection, args, context);
      trace.result = result;
      trace.after = objects.map(configured);
      return result;
    } finally {
      active = null;
    }
  };
  h.instance.collection.count = (name) => {
    const result = count(name);
    active?.trace.events.push(['extent', result]);
    return result;
  };
  h.instance.collection.lookup = (name, index = 0) => {
    active?.trace.events.push(['lookup', index]);
    return lookup(name, index);
  };
  // The normal row-bank stage happens before this command observer. These
  // events describe only the original init wrapper's operand readers/evaluator.
  h.instance.argumentBytes = (token) => {
    const index = active?.args.indexOf(token);
    active?.trace.events.push(['get', index]);
    const bytes = argument(token);
    if (active && (index === 1 || index === 2)) active.trace.filenames.push(decode(bytes));
    return bytes;
  };
  h.instance.value = (...args) => {
    if (active) active.trace.valueCalls++;
    return value(...args);
  };
  h.instance.setGlobal = (index, result) => {
    active?.trace.events.push(['write', index]);
    return write(index, result);
  };
  h.world.fesSound.command = (...args) => {
    active?.trace.soundCalls.push(args[2]);
    return sound(...args);
  };
  h.world.sendEngine = async (target, sender, code, w, l, context = {}) => {
    const record = h.world.objects.objects.get(target),
      object = objects.find((item) => item.particleResource.taskID === target),
      entry =
        record?.kind === 16 && code >= 314 && code <= 321
          ? {
              target,
              sender,
              code,
              w,
              l,
              marker: h.instance.global(42),
              spec: context.spec && { ...context.spec, registers: [...context.spec.registers] },
              registers: context.registers && [...context.registers],
              allocationDirty: object?.allocationDirty,
              dirty: object?.dirty,
              pendingStart: object?.pendingStart,
              bankBefore: Boolean(record.implementation.bank),
            }
          : null,
      result = await send(target, sender, code, w, l, context);
    if (entry)
      messages.push({ ...entry, result, bankStartedAfter: record.implementation.bank?.started });
    return result;
  };
  for (const method of ['read', 'require']) {
    const original = h.world.game[method].bind(h.world.game);
    h.world.game[method] = (name, ...args) => {
      reads.push([method, name]);
      return original(name, ...args);
    };
  }
  return { traces, messages, reads };
}

function parsed(trace, holders) {
  assert.equal(trace.result, 0);
  assert.equal(trace.valueCalls, 0); // Numeric operands use direct signed int32 evaluation.
  assert.deepEqual(trace.soundCalls, []);
  assert.deepEqual(trace.filenames, ['probe', 'quad.hg3']);
  assert.deepEqual(
    trace.events.filter(([kind]) => kind === 'get' || kind === 'write'),
    [
      ['get', 0],
      ['write', 20],
      ['get', 1],
      ['get', 2],
      ['get', 3],
      ['write', 21],
      ['get', 4],
      ['write', 22],
    ],
  );
  assert.deepEqual(
    trace.events.filter(([kind]) => kind === 'lookup').map(([, index]) => index),
    holders,
  );
  assert.ok(
    trace.events.findIndex(([kind]) => kind === 'lookup') >
      trace.events.findLastIndex(([kind]) => kind === 'write'),
  );
}

const particleReads = (reads) =>
  reads.filter(([, name]) => /probe\.kcs$|quad\.hg3$|\.ppi$|ptclpi/i.test(name));

for (const profile of profiles) {
  test(`${profile}: valid five-operand PARTICLE init evaluates once before holders and loads real PTCL through owned314/319/320/315`, async () => {
    const h = await open(profile);
    try {
      assert.equal(h.world.objects.objects.get(h.id).kind, 34);
      const objects = [0, 1, 2].map((index) => h.instance.collection.lookup('p', index)),
        children = objects.map((object) => child(h, object)),
        { traces, messages, reads } = observe(h, objects),
        zero = Array(32).fill(0),
        registers = [9, ...Array(31).fill(0)];
      for (const record of children) assert.equal(Boolean(record.implementation.bank), false);
      await notify(h, 'DELETE');
      assert.equal(h.instance.collection.lookup('p', 1), null);
      assert.equal(h.world.objects.objects.get(children[1].id), children[1]);

      const beforeEmpty = [20, 21, 22].map((index) => h.instance.global(index)),
        traceCount = traces.length;
      await expectMissingHead(h.instance, () => notify(h, 'EMPTY'), 'p[99]');
      assert.deepEqual(
        [20, 21, 22].map((index) => h.instance.global(index)),
        beforeEmpty,
      );
      assert.equal(traces.length, traceCount);
      assert.equal(h.instance.global(40), 1, 'whole-row arithmetic continues to the following row');
      assert.deepEqual(messages, []);
      assert.deepEqual(particleReads(reads), []);
      assert.equal(
        await h.runtime.command(
          'init',
          { nameBytes: ascii('p'), index: 99 },
          operands.split(' ').map(ascii),
        ),
        0,
      );
      parsed(traces.at(-1), [99]);
      assert.deepEqual(traces.at(-1).after, traces.at(-1).before);
      assert.equal(
        h.instance.global(40),
        1,
        'direct wrapper return0 does not repeat the normal row continuation',
      );
      assert.deepEqual(messages, []);
      assert.deepEqual(particleReads(reads), []);
      await notify(h, 'OTHER');
      parsed(traces.at(-1), [0]);
      assert.equal(h.instance.collection.lookup('other', 0).nativeType, 9);
      assert.deepEqual(traces.at(-1).after, traces.at(-1).before);
      assert.equal(h.instance.global(41), 1);
      assert.deepEqual(messages, []);
      assert.deepEqual(particleReads(reads), []);

      await notify(h, 'APPLY');
      const init = traces.at(-1);
      parsed(init, [0, 1, 2]);
      assert.deepEqual(init.events[0], ['extent', 3]);
      assert.equal(h.instance.global(42), 1);
      for (const index of [0, 2])
        assert.deepEqual(init.after[index], {
          family: 0,
          program: 'probe',
          texture: 'quad.hg3',
          count: 1,
          priority: -17,
          allocationDirty: true,
          dirty: true,
          registers,
        });
      assert.deepEqual(init.after[1], init.before[1]);
      assert.deepEqual(
        messages.map(({ target, sender, code, w, l, marker, result }) => [
          target,
          sender,
          code,
          w,
          l,
          marker,
          result,
        ]),
        [children[0], children[2]].flatMap((record) => [
          [record.id, h.id, 314, 0, 0, 1, 0],
          [record.id, h.id, 319, 0, 0, 1, 0],
          [record.id, h.id, 320, 0, 255, 1, 0],
          [record.id, h.id, 315, 0, 0, 1, 0],
          [record.id, h.id, 318, 0, 0, 1, 1],
        ]),
      );
      for (const entry of messages) {
        if (entry.code === 314) {
          assert.deepEqual(entry.spec, {
            family: 'script',
            program: 'probe',
            texture: 'quad.hg3',
            count: 1,
            priority: -17,
            registers: zero,
            externalDraw: false,
          });
          assert.equal(entry.allocationDirty, true);
          assert.equal(entry.bankBefore, false);
          assert.equal(entry.bankStartedAfter, false);
        } else if (entry.code === 319) {
          assert.deepEqual(entry.registers, registers);
          assert.equal(entry.allocationDirty, false);
          assert.equal(entry.dirty, true);
        } else if (entry.code === 315) assert.equal(entry.pendingStart, false);
      }
      for (const index of [0, 2]) {
        const object = objects[index],
          record = child(h, object),
          bank = record.implementation.bank;
        assert.equal(record, children[index]);
        assert.deepEqual([...object.registers], registers);
        assert.equal(object.allocationDirty, false);
        assert.equal(object.dirty, false);
        assert.equal(bank.family, 'script');
        assert.equal(bank.program, 'ptcl/probe.kcs');
        assert.equal(bank.count, 1);
        assert.deepEqual([...bank.registers], registers);
        assert.deepEqual([...bank.instance.registers], registers);
        assert.ok(bank.nativeAtlas.pointer > 0);
        assert.deepEqual([bank.nativeAtlas.width, bank.nativeAtlas.height], [1, 1]);
      }
      assert.equal(Boolean(children[1].implementation.bank), false);
      assert.ok(particleReads(reads).some(([, name]) => /ptcl\/probe\.kcs$/i.test(name)));
      assert.ok(particleReads(reads).some(([, name]) => /quad\.hg3$/i.test(name)));
      assert.equal(
        reads.some(([, name]) => /\.ppi$|ptclpi/i.test(name)),
        false,
      );
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
