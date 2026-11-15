// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { notify } from './fixtures/fes-effekseer-world.mjs';

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
  source = `#DEFINE
PARTICLE p[3]
SOUND sound
CIMAGE image
PLANE carrier
DRAW effect
#OBJECT SIZE COLOR DISP
image 1,1 0 0
#OBJECT SIZE
carrier 1,1
#OBJECT PARENT
effect carrier
#START
next IDLE
#IDLE
break
next IDLE
#DELETE
p[1] delete
break
#GATES
sound start $20++ 1/0 $str0
image start $20++ 1/0 $str0
effect start $20++ 1/0 $str0
$40=++$40
break
#MISSING
p[99] start $20++ 1/0 $str0
$42=++$42
break
#BEGIN
p start $21++ 1/0 3% $str0
$41=++$41
break
`;

async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': ascii(source) });
  world.ensureNativeEngine = () => {
    throw new Error('PARTICLE start must stay in the default JavaScript path');
  };
  try {
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
  assert.equal(Boolean(record.implementation.bank), false);
  return record;
}

function observe(h, objects, others) {
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
    send = h.world.sendEngine.bind(h.world),
    fields = (object) => object && [object.pendingStart, object.running, object.allocationDirty];
  let active = null;
  h.runtime.command = async (verb, selection, args, context) => {
    if (verb !== 'start') return command(verb, selection, args, context);
    const name = decode(selection.nameBytes),
      other = others.get(name),
      trace = {
        name,
        operands: args.map(decode),
        events: [],
        getters: [],
        evaluations: 0,
        writes: [],
        soundCalls: [],
        before: fields(other),
      };
    traces.push(trace);
    active = trace;
    try {
      const result = await command(verb, selection, args, context);
      trace.result = result;
      trace.after = fields(other);
      return result;
    } finally {
      active = null;
    }
  };
  h.instance.collection.count = (name) => {
    const result = count(name);
    active?.events.push(['extent', result]);
    return result;
  };
  h.instance.collection.lookup = (name, index = 0) => {
    active?.events.push(['lookup', index]);
    return lookup(name, index);
  };
  // Row-bank expansion and selection parsing precede this command observer.
  // Only operand reads/evaluation inside the original wrapper are counted.
  h.instance.argumentBytes = (token) => {
    active?.getters.push(token);
    return argument(token);
  };
  h.instance.value = (...args) => {
    if (active) active.evaluations++;
    return value(...args);
  };
  h.instance.setGlobal = (index, result) => {
    active?.writes.push([index, result]);
    return write(index, result);
  };
  h.world.fesSound.command = (...args) => {
    active?.soundCalls.push(args[2]);
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
              pendingStart: object?.pendingStart,
              running: object?.running,
              bank: Boolean(record.implementation.bank),
              marker: h.instance.global(41),
            }
          : null,
      result = await send(target, sender, code, w, l, context);
    if (entry) messages.push({ ...entry, result });
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

function noOperands(trace) {
  assert.equal(trace.result, 0);
  assert.ok(trace.operands.includes('1/0')); // An extra operand would fail if evaluated.
  assert.deepEqual(trace.getters, []);
  assert.equal(trace.evaluations, 0);
  assert.deepEqual(trace.writes, []);
  assert.deepEqual(trace.soundCalls, []);
  assert.deepEqual(trace.after, trace.before);
}

for (const profile of profiles) {
  test(`${profile}: normal PARTICLE start skips NULL/non23 without operand reads and requests owned315 then318 through the existing bankless adapter`, async () => {
    const h = await open(profile);
    try {
      assert.equal(h.world.objects.objects.get(h.id).kind, 34);
      const objects = [0, 1, 2].map((index) => h.instance.collection.lookup('p', index)),
        children = objects.map((object) => child(h, object)),
        others = new Map(
          ['sound', 'image', 'effect'].map((name) => [name, h.instance.collection.lookup(name, 0)]),
        ),
        { traces, messages, reads } = observe(h, objects, others);
      assert.deepEqual(
        [...others.values()].map((object) => object.nativeType),
        [9, 1, 7],
      );
      for (const object of objects) {
        assert.equal(object.pendingStart, false);
        assert.equal(object.running, false);
      }
      await notify(h, 'DELETE');
      assert.equal(h.instance.collection.lookup('p', 1), null);
      assert.equal(h.world.objects.objects.get(children[1].id), children[1]);
      assert.deepEqual(messages, []);

      // No particle is running yet, so wrong-class/empty selections do not
      // introduce a start request or an ordinary running-state318 poll.
      await notify(h, 'GATES');
      assert.equal(traces.length, 3);
      await expectMissingHead(h.instance, () => notify(h, 'MISSING'), 'p[99]');
      assert.equal(traces.length, 3);
      assert.equal(h.instance.global(20), 0, 'the orphaned value is outside the final root');
      assert.equal(h.instance.global(42), 1);
      assert.deepEqual(messages, []);
      assert.equal(
        await h.runtime.command(
          'start',
          { nameBytes: ascii('p'), index: 99 },
          ['$20++', '1/0', '$str0'].map(ascii),
        ),
        0,
      );
      assert.equal(h.instance.global(40), 1);
      assert.deepEqual(
        traces.map(({ name }) => name),
        ['sound', 'image', 'effect', 'p'],
      );
      for (const trace of traces) noOperands(trace);
      assert.deepEqual(
        traces.map(({ events }) => events),
        [[['lookup', 0]], [['lookup', 0]], [['lookup', 0]], [['lookup', 99]]],
      );
      assert.deepEqual(messages, []);

      await notify(h, 'BEGIN');
      const request = traces.at(-1);
      noOperands(request);
      assert.ok(request.operands.includes('3%'));
      assert.deepEqual(request.events, [
        ['extent', 3],
        ['lookup', 0],
        ['lookup', 1],
        ['lookup', 2],
      ]);
      assert.equal(h.instance.global(41), 1);
      assert.deepEqual(
        messages,
        [children[0], children[2]].flatMap((record) => [
          {
            target: record.id,
            sender: h.id,
            code: 315,
            w: 0,
            l: 0,
            pendingStart: false,
            running: false,
            bank: false,
            marker: 1,
            result: 0,
          },
          {
            target: record.id,
            sender: h.id,
            code: 318,
            w: 0,
            l: 0,
            pendingStart: false,
            running: true,
            bank: false,
            marker: 1,
            result: 1,
          },
        ]),
      );
      for (const index of [0, 2]) {
        assert.equal(child(h, objects[index]), children[index]);
        assert.equal(objects[index].pendingStart, false);
        assert.equal(objects[index].running, true);
      }
      assert.equal(objects[1].pendingStart, false);
      assert.equal(objects[1].running, false);
      assert.equal(
        reads.some(
          ([, name]) =>
            /^(?:@cat\/)?(?:ptcl|ptclpi|image)\//i.test(name) ||
            /\.(?:ppi|hg[23]|png|jpe?g)$/i.test(name),
        ),
        false,
      );
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
