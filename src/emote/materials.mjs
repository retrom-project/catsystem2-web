// SPDX-License-Identifier: MPL-2.0
// Public fixed-function device state recorded by the reviewed DLL oracle.
import { createD3DContext } from '../render/particles-gl.mjs';
export class EmoteMaterials {
  constructor() {
    this.cache = new Map();
  }
  get(blend = 16, stencil = 0, maskWrite = false) {
    const key = `${blend}/${stencil}/${Number(maskWrite)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (blend & ~0x1f || (blend & 15) > 6)
      throw new Error(`Unsupported E-mote blend mode ${blend}`);
    const state = createD3DContext();
    for (const [key, value] of [
      [7, 0],
      [15, 1],
      [19, 5],
      [20, 6],
      [22, 1],
      [24, 0],
      [25, 5],
      [26, 0],
      [27, 1],
      [52, 0],
      [168, 15],
      [194, 0],
      [206, 1],
      [207, 2],
      [208, 6],
      [209, 1],
    ])
      state.states.set(key, value);
    for (const [key, value] of [
      [1, 3],
      [2, 3],
      [5, 2],
      [6, 2],
      [7, 2],
    ])
      state.samplers.set(key, value);
    state.stages.set(
      0,
      new Map([
        [1, (blend & 15) === 6 ? 4 : 5],
        [2, 0],
        [3, 2],
        [4, 4],
        [5, 2],
        [6, 0],
      ]),
    );
    state.stages.set(1, new Map([[1, 1]]));
    const mode = blend & 15;
    if (mode >= 1 && mode <= 5) {
      state.states.set(207, 1);
      state.states.set(208, 2);
      if (mode !== 3) state.states.set(20, 2);
      if (mode === 2 || mode === 5) state.states.set(171, 3);
      if (mode === 3 || mode === 4) {
        state.states.set(19, mode === 3 ? 9 : 10);
        state.stages.set(
          1,
          new Map([
            [1, 4],
            [2, 33],
            [3, 1],
          ]),
        );
        state.stages.set(2, new Map([[1, 1]]));
      } else if (mode === 5) {
        state.stages.set(
          1,
          new Map([
            [1, 2],
            [2, 17],
          ]),
        );
        state.stages.set(2, new Map([[1, 1]]));
      }
    }
    if (stencil) {
      state.states.set(52, 1);
      state.states.set(56, 3);
      state.states.set(58, 255);
      state.states.set(57, maskWrite ? stencil - 1 : stencil);
      if (maskWrite) {
        state.states.set(7, 1);
        state.states.set(23, 1);
        state.states.set(24, 64);
        state.states.set(54, 7);
        state.states.set(55, 7);
      }
    }
    this.cache.set(key, state);
    return state;
  }
}
