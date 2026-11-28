// SPDX-License-Identifier: MPL-2.0
import { rain } from './rain.mjs';
import { filmnoise } from './filmnoise.mjs';
import { em_angry, em_double, em_question, em_question_a } from './emote-symbols.mjs';
import { em_sweat } from './emote-sweat.mjs';
import { steam } from './steam.mjs';
import { blur } from './blur.mjs';
import { dash } from './dash.mjs';
import { em_note } from './emote-note.mjs';
import { cmnptcl } from './cmnptcl.mjs';
const definitions = {
  rain,
  filmnoise,
  em_note,
  cmnptcl,
  blur,
  dash,
  em_sweat,
  steam,
  em_angry,
  em_double,
  em_question,
  em_question_a,
};

// The original constructors leave the private particle array absent until Init.
// Reloading an already-active task can call Exec before an explicit start.
export const PPI_IMPLEMENTATIONS = Object.fromEntries(
  Object.entries(definitions).map(([name, definition]) => [
    name,
    {
      ...definition,
      exec(instance) {
        if (instance.state.particles) definition.exec(instance);
      },
    },
  ]),
);
