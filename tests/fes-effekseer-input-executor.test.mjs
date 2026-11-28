// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { open, object, task, step } from './fixtures/fes-effekseer-world.mjs';

const source = `#DEFINE
BUTTON button
EFKPLANE fx
#OBJECT SIZE POS PRI DISP ENABLE
button 8,8 10,10 60000 1 1
#OBJECT FILE DISP PRI
fx scene.efk 1 170
#START
next IDLE
#IDLE
break
next IDLE
#button.FOCUS
fx load other.efk
fx play
break
`;
const recurrence = (state, count) => {
  let word = BigInt(state);
  const values = [];
  for (let i = 0; i < count; i++) {
    word = (214013n * word + 2531011n) & 0xffffffffn;
    values.push(Number((word >> 16n) & 32767n));
  }
  return { state: Number(word), values };
};

test('real World Input hover carries one live entry through FOCUS FILE/Play and ordinary draw Update', async (test) => {
  const h = await open({ text: source }),
    w = h.world;
  try {
    Object.assign(w.configuration.screen, {
      width: 128,
      height: 96,
      currentWidth: 128,
      currentHeight: 96,
      virtualWidth: 128,
      virtualHeight: 96,
    });
    // Ordinary initialization loads FILE but this authored START does not Play.
    await step(h);
    const t = task(h),
      previousLoad = t.currentEffect,
      button = h.instance.collection.lookup('button', 0),
      graph = w.objects.objects.get(button.nativeInputTaskID).implementation,
      inputTask = w.objects.objects.get(w.primaryInputTaskID).implementation,
      input = inputTask.inputState,
      runtime = h.instance.runtime,
      stream = w.effekseer.threads.forThread('frame'),
      initialCRT = stream.snapshot();
    assert.equal(t.manager.sets.size, 0);
    assert.equal(initialCRT.calls, 0);
    assert.equal(object(h).resourcePending, false);
    assert.equal(input, w.input);

    // Negative control only: Input never creates or executes this capability.
    w.effekseer.createExecutor('unused-control');
    const unused = w.effekseer.threads.forThread('unused-control').snapshot(),
      threadIDs = [...w.effekseer.threads.threads.keys()],
      stages = [],
      values = [],
      playStates = [],
      updates = [];
    let actualEntry;
    const recordEntry = (stage, context) => {
      const entry = context.executorEntry;
      assert.equal(w.dispatchContext.executorID(entry), 'frame');
      if (actualEntry === undefined) actualEntry = entry;
      assert.equal(entry, actualEntry, stage + ' uses the actual Input tick entry');
      stages.push(stage);
    };
    const adapterTick = inputTask.tick.bind(inputTask);
    inputTask.tick = async (frame, context) => {
      recordEntry('InputTask.tick', context);
      return adapterTick(frame, context);
    };
    const inputTick = input.tick.bind(input);
    input.tick = async (frame, context) => {
      recordEntry('NativeInput.tick', context);
      return inputTick(frame, context);
    };
    const hover = input.hover.bind(input);
    input.hover = async (x, y, context) => {
      await Promise.resolve();
      recordEntry('NativeInput.hover', context);
      return hover(x, y, context);
    };
    const graphMessage = graph.message.bind(graph);
    graph.message = (...args) => {
      if (args[0][1] === 7) recordEntry('Graph7', args[1]);
      return graphMessage(...args);
    };
    const fesMessage = h.task.message.bind(h.task);
    h.task.message = (...args) => {
      if (args[0][1] === 64) recordEntry('FESTask64', args[1]);
      return fesMessage(...args);
    };
    const inputMessage = h.task.input.message.bind(h.task.input);
    h.task.input.message = (...args) => {
      if (args[0][1] === 64) recordEntry('NativeFESInput64', args[1]);
      return inputMessage(...args);
    };
    const event = h.instance.dispatchEvent.bind(h.instance);
    h.instance.dispatchEvent = async (target, name) => {
      const result = await event(target, name);
      if (target === button && name === 'FOCUS') {
        assert.equal(object(h).resourceFile, 'other.efk');
        assert.equal(object(h).resourcePending, true);
        assert.equal(object(h).playDirty, true);
        stages.push('FOCUS flags');
      }
      return result;
    };
    const visit = runtime.resources.visit.bind(runtime.resources);
    runtime.resources.visit = (entry, semantic, context) => {
      if (semantic.nativeType === 36) recordEntry('FIFO raw36', context);
      return visit(entry, semantic, context);
    };
    const send = w.sendEngine.bind(w);
    w.sendEngine = (target, sender, id, a, b, context) => {
      if (target === t.record.id && (id === 569 || id === 571)) recordEntry('send' + id, context);
      return send(target, sender, id, a, b, context);
    };
    const nextInt = stream.nextInt.bind(stream);
    stream.nextInt = () => {
      const value = nextInt();
      values.push(value);
      return value;
    };
    const play = t.manager.play.bind(t.manager);
    t.manager.play = (...args) => {
      assert.equal(args[2], 'frame');
      const before = stream.snapshot(),
        start = values.length,
        handle = play(...args),
        after = stream.snapshot(),
        expected = recurrence(before.state, after.calls - before.calls);
      assert.deepEqual(values.slice(start), expected.values);
      assert.equal(after.state, expected.state);
      assert.equal(after.calls - before.calls, 1);
      playStates.push({ before, after, values: values.slice(start) });
      stages.push('real Play returned');
      return handle;
    };
    const beforeDraw = t.beforeDrawChildren.bind(t);
    t.beforeDrawChildren = (frame, context) => {
      recordEntry('beforeDrawChildren', context);
      return beforeDraw(frame, context);
    };
    const update = t.manager.update.bind(t.manager);
    t.manager.update = (...args) => {
      const before = stream.snapshot(),
        result = update(...args);
      updates.push({ thread: args[0], delta: args[1], before, after: stream.snapshot() });
      stages.push('real Update returned');
      return result;
    };

    input.pointer(12, 12, 1);
    await w.tick();

    assert.notEqual(t.currentEffect, previousLoad);
    assert.equal(w.effekseer.loads.loads.has(previousLoad), false);
    assert.equal(t.manager.sets.size, 1);
    assert.equal(t.manager.sets.get(0).assetID, t.currentEffect);
    assert.equal(object(h).resourcePending, false);
    assert.equal(object(h).playDirty, false);
    assert.deepEqual(playStates, [
      { before: initialCRT, after: { state: 2745024, calls: 1, seedCalls: 0 }, values: [41] },
    ]);
    assert.equal(updates.length, 1, 'normal draw-phase Update was not skipped');
    assert.equal(updates[0].thread, 'frame');
    assert.equal(updates[0].delta, 1);
    assert.equal(t.manager.sets.get(0).global.updatedFrame, 1);
    assert.equal(t.manager.instances.size, 1, 'the normal first Update keeps root age0');
    assert.equal(t.manager.root(t.manager.sets.get(0)).age, 0);
    const expected = recurrence(initialCRT.state, stream.calls - initialCRT.calls);
    assert.deepEqual(values, expected.values);
    assert.equal(stream.state, expected.state);
    assert.deepEqual(w.effekseer.threads.forThread('unused-control').snapshot(), unused);
    assert.deepEqual([...w.effekseer.threads.threads.keys()], threadIDs);
    assert.deepEqual(stages.slice(0, 11), [
      'InputTask.tick',
      'NativeInput.tick',
      'NativeInput.hover',
      'Graph7',
      'FESTask64',
      'NativeFESInput64',
      'FOCUS flags',
      'FIFO raw36',
      'send569',
      'send571',
      'real Play returned',
    ]);
    assert.ok(stages.indexOf('beforeDrawChildren') > stages.indexOf('real Play returned'));
    assert.throws(() => w.dispatchContext.executorID(actualEntry), /live explicit/);
    assert.equal(JSON.stringify(runtime.resources.snapshot()).includes('executor'), false);
    // Restore prototype methods before checking the real Input state codec.
    delete input.tick;
    delete input.hover;
    assert.equal(JSON.stringify(input.snapshot()).includes('executor'), false);
    assert.deepEqual(w.objects.queue, []);
    assert.equal(w.nativeEngine, undefined);
    w.effekseer.validateReferences();
    test.diagnostic(
      JSON.stringify({ stages, playStates, updates, fullTickCRT: stream.snapshot() }),
    );
  } finally {
    await w.close({ flushFiles: false });
  }
});
