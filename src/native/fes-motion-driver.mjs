// SPDX-License-Identifier: MPL-2.0
import { initialMotionObject } from '../motion/abi.mjs';
import { MotionTarget } from '../motion/target.mjs';
import { motionRegisters } from '../motion/definitions.mjs';
import { fesMotionState, applyFESMotionState } from './fes-motion-model.mjs';

export function createFESMotionTarget(library, instance, object) {
  let target;
  target = new MotionTarget(library, {
    initialState: initialMotionObject(),
    readState: () => fesMotionState(object) ?? target.manager.base,
    writeState: (bytes) => applyFESMotionState(instance, object, bytes),
  });
  return target;
}

// The registry supplies targets so the existing JS sound adapter can remain
// their sole owner. Graph owns child order; this driver never uses draw keys.
export class FESMotionDriver {
  constructor(graph, targetFor) {
    if (!graph || typeof targetFor !== 'function')
      throw new TypeError('FES motion driver requires its object graph and target registry');
    this.graph = graph;
    this.targetFor = targetFor;
  }
  busy(object) {
    for (const current of this.graph.postorder(object))
      if (this.targetFor(current, false)?.busy()) return true;
    return false;
  }
  prepare(object) {
    const idle = !this.busy(object),
      target = this.targetFor(object, true);
    if (idle) {
      const snapshot = fesMotionState(object);
      if (snapshot) target.manager.base.set(snapshot);
    }
    return target;
  }
  add(object, file, options = {}) {
    return this.prepare(object).add(
      file,
      { ...options, delay: object.motionDelay >>> 0 },
      { refreshBase: false },
    );
  }
  subcommand(object, definition, args, evaluate) {
    const target = this.prepare(object),
      registers = motionRegisters(definition, args, target.manager.base, evaluate);
    return target.add(
      definition.file,
      { registers, group: 0, delay: object.motionDelay >>> 0 },
      { refreshBase: false },
    );
  }
  update(object, frame) {
    for (const current of this.graph.postorder(object))
      this.targetFor(current, false)?.update(frame);
  }
  stop(object) {
    const order = this.graph.postorder(object);
    for (const current of order) this.targetFor(current, false)?.manager.skip();
    // All scripts see skip before any callback runs. Stop advances at frame0,
    // even when that frame was already visited, and only clears the root.
    for (const current of order) this.targetFor(current, false)?.update(0, { force: true });
    this.targetFor(object, false)?.clear();
    object.motionDelay = 0;
  }
  async restore(object, state) {
    await this.targetFor(object, true).restore(state);
  }
}
