// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { notify } from './fixtures/fes-effekseer-world.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  decode = (bytes) => new TextDecoder().decode(bytes),
  operands = ['$20++', '2147483647', '16777217', '-2147483648', ...Array(28).fill('0'), '$21++'],
  source = `#DEFINE
PARTICLE p[3]
SOUND sound
#START
$20=7
$21=0
$22=4
$23=11
next IDLE
#IDLE
break
next IDLE
#DELETE
p[1] delete
break
#PARAM
p param ${operands.join(' ')}
$40=++$40
break
#SHORT
p param -9
$41=++$41
break
#EMPTY
p[99] param $22++
$42=++$42
break
#OTHER
sound param $23++
$43=++$43
break
#ZERO
p param
$44=++$44
break
#UNITS
p param 3%
$45=++$45
break
`;

async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': ascii(source) });
  world.ensureNativeEngine = () => {
    throw new Error('PARTICLE param must stay in the default JavaScript path');
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
  assert.equal(object.registers.constructor, Float32Array);
  assert.equal(object.registers.length, 32);
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

function observe(h, objects) {
  const traces = [],
    messages = [],
    soundCalls = [],
    reads = [],
    command = h.runtime.command.bind(h.runtime),
    count = h.instance.collection.count.bind(h.instance.collection),
    lookup = h.instance.collection.lookup.bind(h.instance.collection),
    argument = h.instance.argumentBytes.bind(h.instance),
    write = h.instance.setGlobal.bind(h.instance),
    sound = h.world.fesSound.command.bind(h.world.fesSound),
    send = h.world.sendEngine.bind(h.world);
  let active = null,
    marker = 40;
  h.runtime.command = async (verb, selection, args, context) => {
    if (verb !== 'param') return command(verb, selection, args, context);
    const trace = { events: [] };
    traces.push(trace);
    active = { args, trace };
    try {
      return (trace.result = await command(verb, selection, args, context));
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
  h.instance.argumentBytes = (token) => {
    active?.trace.events.push(['get', active.args.indexOf(token), decode(token)]);
    return argument(token);
  };
  h.instance.setGlobal = (index, value) => {
    active?.trace.events.push(['write', index, value]);
    return write(index, value);
  };
  h.world.fesSound.command = (...args) => {
    soundCalls.push(args[2]);
    return sound(...args);
  };
  h.world.sendEngine = (target, sender, code, w, l, context = {}) => {
    if (code >= 314 && code <= 321) {
      const object = objects.find((item) => item.particleResource.taskID === target);
      messages.push({
        target,
        sender,
        code,
        w,
        l,
        registers: context.registers ? [...context.registers] : null,
        dirty: object?.dirty,
        marker: h.instance.global(marker),
      });
    }
    return send(target, sender, code, w, l, context);
  };
  for (const method of ['read', 'require']) {
    const original = h.world.game[method].bind(h.world.game);
    h.world.game[method] = (name, ...args) => {
      reads.push([method, name]);
      return original(name, ...args);
    };
  }
  return { traces, messages, soundCalls, reads, marker: (value) => (marker = value) };
}

function parsed(trace, expectedIndices, expectedHolders) {
  const getters = trace.events.filter(([kind]) => kind === 'get'),
    lookups = trace.events.filter(([kind]) => kind === 'lookup'),
    firstLookup = trace.events.findIndex(([kind]) => kind === 'lookup'),
    lastGetter = trace.events.findLastIndex(([kind]) => kind === 'get');
  assert.deepEqual(
    getters.map(([, index]) => index),
    expectedIndices,
  );
  assert.deepEqual(
    lookups.map(([, index]) => index),
    expectedHolders,
  );
  assert.ok(firstLookup > lastGetter, 'all present operands are read before any holder lookup');
  assert.equal(trace.result, 0);
}

function packets(h, records, registers) {
  return records.flatMap((record) => [
    { target: record.id, sender: h.id, code: 319, w: 0, l: 0, registers, dirty: true, marker: 1 },
    {
      target: record.id,
      sender: h.id,
      code: 320,
      w: 0,
      l: 255,
      registers: null,
      dirty: true,
      marker: 1,
    },
  ]);
}

for (const profile of profiles) {
  test(`${profile}: normal PARTICLE param reads raw int32 operands once before holders, skips holes/non23 and publishes owned319/320`, async () => {
    const h = await open(profile);
    try {
      assert.equal(h.world.objects.objects.get(h.id).kind, 34);
      const objects = [0, 1, 2].map((index) => h.instance.collection.lookup('p', index)),
        children = objects.map((object) => child(h, object)),
        live = [objects[0], objects[2]],
        liveChildren = [children[0], children[2]],
        observation = observe(h, objects),
        { traces, messages, soundCalls, reads } = observation,
        zero = Array(32).fill(0),
        expected = [7, 2147483648, 16777216, -2147483648, ...Array(28).fill(0)];
      for (const object of objects) assert.deepEqual([...object.registers], zero);
      await notify(h, 'DELETE');
      assert.equal(h.instance.collection.lookup('p', 1), null);
      assert.deepEqual(messages, []);

      await notify(h, 'PARAM');
      assert.deepEqual(traces[0].events[0], ['extent', 3]);
      parsed(
        traces[0],
        Array.from({ length: 32 }, (_, index) => index),
        [0, 1, 2],
      );
      assert.equal(h.instance.global(20), 8);
      assert.equal(h.instance.global(21), 0); // Operand33 is never read or evaluated.
      assert.deepEqual(
        traces[0].events.filter(([kind]) => kind === 'write'),
        [['write', 20, 8]],
      );
      assert.deepEqual(messages, packets(h, liveChildren, expected));
      for (const object of live) {
        assert.deepEqual([...object.registers], expected);
        assert.deepEqual(
          [...new Uint32Array(object.registers.buffer)].slice(1, 4),
          [0x4f000000, 0x4b800000, 0xcf000000],
        );
        assert.equal(object.dirty, false);
        assert.equal(child(h, object).implementation.state.alpha, 256);
      }
      assert.deepEqual([...objects[1].registers], zero);

      messages.length = 0;
      observation.marker(41);
      await notify(h, 'SHORT');
      const short = [-9, ...Array(31).fill(0)];
      parsed(traces.at(-1), [0], [0, 1, 2]);
      assert.deepEqual(messages, packets(h, liveChildren, short));
      for (const object of live) assert.deepEqual([...object.registers], short);

      messages.length = 0;
      await notify(h, 'EMPTY');
      parsed(traces.at(-1), [0], [99]);
      assert.equal(h.instance.global(22), 5);
      assert.equal(h.instance.global(42), 1);
      assert.deepEqual(messages, []);
      await notify(h, 'OTHER');
      parsed(traces.at(-1), [0], [0]);
      assert.equal(h.instance.collection.lookup('sound', 0).nativeType, 9);
      assert.equal(h.instance.global(23), 12);
      assert.equal(h.instance.global(43), 1);
      assert.deepEqual(soundCalls, []);
      assert.deepEqual(messages, []);
      for (const object of live) assert.deepEqual([...object.registers], short);

      observation.marker(44);
      await notify(h, 'ZERO');
      parsed(traces.at(-1), [], [0, 1, 2]);
      assert.deepEqual(messages, packets(h, liveChildren, zero));
      for (const object of live) assert.deepEqual([...object.registers], zero);
      messages.length = 0;

      // A present operand expanding empty is not a missing operand. These two
      // failures assert current expression boundaries, not native error wording.
      await assert.rejects(
        h.runtime.command('param', { nameBytes: ascii('p'), index: -1 }, [ascii('$str0')]),
        /expression/,
      );
      assert.deepEqual(
        traces
          .at(-1)
          .events.filter(([kind]) => kind === 'get')
          .map(([, index]) => index),
        [0],
      );
      assert.equal(
        traces.at(-1).events.some(([kind]) => kind === 'lookup'),
        false,
      );
      await assert.rejects(notify(h, 'UNITS'), /expression/);
      assert.equal(h.instance.global(45), 0);
      assert.deepEqual(
        traces
          .at(-1)
          .events.filter(([kind]) => kind === 'get')
          .map(([, index]) => index),
        [0],
      );
      assert.equal(
        traces.at(-1).events.some(([kind]) => kind === 'lookup'),
        false,
      );
      for (const object of live) {
        assert.deepEqual([...object.registers], zero);
        assert.equal(object.dirty, false);
        assert.equal(Boolean(child(h, object).implementation.bank), false);
      }
      assert.deepEqual(messages, []);
      assert.deepEqual(reads, []);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
