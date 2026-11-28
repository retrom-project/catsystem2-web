// SPDX-License-Identifier: MPL-2.0
import { M2Blink } from './m2-blink.mjs';
import { M2Inertia } from './m2-inertia.mjs';
import { M2Actions } from './m2-actions.mjs';
import { M2Lip } from './m2-lip.mjs';
import { M2Splines } from './m2-splines.mjs';
const f = Math.fround;

export class M2Controllers {
  constructor(model, random) {
    this.model = model;
    this.blink = new M2Blink(random);
    this.lip = new M2Lip();
    this.actions = new M2Actions(model);
    this.spline = new M2Splines(model.profiles.splines);
    this.setPose(model.pose);
  }
  setPose(pose) {
    if (this.definition !== pose.face) {
      this.definition = pose.face;
      this.inertia = new M2Inertia(pose.face);
    }
    this.blink.select(pose.face, this.model.variables.codes);
    this.lip.select(pose.face, this.model.variables.codes);
  }
  beforeUpdate(frame, { active, initial }) {
    if (initial) this.lip.prime();
    if (!active) return;
    const { animation, variables, position } = this.model;
    const write = (name, value) => {
      if (!variables.pins.has(name))
        animation.setVariable(name, f(value * (variables.scales.get(name) ?? variables.scale)));
    };
    this.blink.flush(write);
    this.lip.flush(write);
    this.inertia.update(
      frame,
      position[0],
      position[1],
      (name) => animation.variable(name),
      this.model.positionInitialized,
    );
    for (const name of this.inertia.springs.keys())
      animation.setVariable(name, this.inertia.contribution(name));
    this.spline.update(
      frame,
      (name) => this.inertia.materials[name],
      (name, value) => animation.setVariable(name, value),
    );
    this.actions.update(frame);
  }
  afterUpdate(frame, { active }) {
    if (active) {
      this.blink.update(frame);
      this.lip.update(this.soundFrame ?? frame);
    }
  }
  snapshot() {
    return {
      inertia: this.inertia.snapshot(),
      blink: this.blink.snapshot(),
      actions: this.actions.snapshot(),
      spline: this.spline.snapshot(),
      lip: this.lip.snapshot(),
      soundFrame: this.soundFrame ?? null,
    };
  }
  restore(state) {
    this.inertia.restore(state.inertia);
    this.blink.restore(state.blink);
    this.actions.restore(state.actions);
    this.spline.restore(state.spline);
    this.lip.restore(state.lip);
    this.soundFrame = state.soundFrame;
  }
}
