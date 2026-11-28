// SPDX-License-Identifier: MPL-2.0
// Independently authored profile and model, consumed by the original EXE
// profile parser and the separately supplied E-mote driver.
import { emotePSBFixture } from './emote-psb-fixture.mjs';
export const nativeM2Program = 'aa01,1,1,1,1,0,1,0:0';
export function nativeM2Files() {
  const text = (value) => new TextEncoder().encode(value);
  return {
    'm2view.cnf': text('#wndsize\n64 64\n#fade\n1\n#chheader\naa\n#profile\naa01 authored.pfl\n'),
    'authored.pfl': text('#charaname\n1 body authored\n#motname\n1 0 base authored.dif\n'),
    'authored.dif': text('#scale\n1 1\n'),
    'authored.psb': emotePSBFixture(),
  };
}
