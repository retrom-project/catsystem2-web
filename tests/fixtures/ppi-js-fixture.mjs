// SPDX-License-Identifier: MPL-2.0
// JS counterpart of the existing authored ppi-native-fixture. It is not a
// replacement for a shipped effect; both exercise transport/lifecycle only.
export const authoredPPI = Object.freeze({
  name: 'authored-js',
  apiVersion: 0x20002,
  construct(i) {
    i.module.shared.constructs = (i.module.shared.constructs ?? 0) + 1;
  },
  init(i) {
    i.state.inits = (i.state.inits ?? 0) + 1;
    i.particle(0).pos.x = i.host.frand();
  },
  exec(i) {
    i.module.shared.execs = (i.module.shared.execs ?? 0) + 1;
    i.particle(0).disp = i.module.shared.execs;
    i.particle(0).pos.x = i.host.frand();
  },
  stop(i) {
    i.module.shared.stops = (i.module.shared.stops ?? 0) + 1;
  },
  destruct(i) {
    i.module.shared.destructs = (i.module.shared.destructs ?? 0) + 1;
  },
});
