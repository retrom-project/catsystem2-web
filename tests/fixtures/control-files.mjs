// SPDX-License-Identifier: MPL-2.0
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { kcsProgram } from '../helpers.mjs';

async function imageFile() {
  const ids = [0, 1, 2, 3, 10, 20, 100, 101, 102, 103, 200, 201, 202, 203, 300, 301, 302, 303],
    frames = [];
  for (const id of ids) {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        rgba.set([30 + (id % 100) * 20, 40 + y * 20, 60 + x * 20, 255], (y * 8 + x) * 4);
    frames.push(await encodeHG2({ width: 8, height: 8, rgba }, { id, crop: false }));
  }
  return linkFrames(frames);
}
function linkFrames(frames) {
  const result = new Uint8Array(12 + frames.reduce((size, frame) => size + frame.length - 12, 0));
  result.set(frames[0].subarray(0, 12));
  let offset = 12;
  for (const [i, frame] of frames.entries()) {
    const body = frame.slice(12);
    new DataView(body.buffer).setUint32(64, i + 1 < frames.length ? body.length : 0, true);
    result.set(body, offset);
    offset += body.length;
  }
  return result;
}
async function areaFile() {
  const frames = [];
  for (const [id, left, top, width, height] of [
    [7, 16, 12, 72, 12],
    [8, 104, 12, 12, 64],
  ]) {
    const rgba = new Uint8Array(128 * 96 * 4);
    for (let y = top; y < top + height; y++)
      for (let x = left; x < left + width; x++) rgba[(y * 128 + x) * 4 + 3] = 255;
    frames.push(await encodeHG2({ width: 128, height: 96, rgba }, { id }));
  }
  return linkFrames(frames);
}
async function scrollFile() {
  const frames = [];
  for (const [id, top, height] of [
    [0, 0, 80],
    [10, 0, 8],
    [20, 72, 8],
    [100, 8, 8],
    [200, 8, 1],
    [1000, 8, 8],
    [1001, 16, 48],
    [1002, 64, 8],
  ]) {
    const rgba = new Uint8Array(8 * 80 * 4);
    for (let y = top; y < top + height; y++)
      for (let x = 0; x < 8; x++)
        rgba.set([100 + (id % 100), 30 + y, 50 + x, 255], (y * 8 + x) * 4);
    frames.push(await encodeHG2({ width: 8, height: 80, rgba }, { id }));
  }
  return linkFrames(frames);
}

export const controlFES =
  '#DEFINE\nPLANE pl\nSLIDER slider\nSCROLL2 scroll2\nSCROLL scroll\n#OBJECT SIZE VRAM PRI DISP\npl 128,96 0,0 400 1\n#OBJECT FILE PL POS2 PRI DISP ENABLE\nslider controls pl area:7 1000 1 1\nscroll2 controls pl area:8 1001 1 1\n#OBJECT FILE POS VRAM PRI PRI_P TYPE DISP ENABLE\nscroll scroll 4,4 0,0 1002 1003 0 1 1\n#SUBCOMMAND\noneshot authoredFade authored-alpha p[64] : [0]\ncontinue authoredLoop authored-loop p[0] : [0]\n#START\nslider page 0 100\nslider pos 25 1\nscroll2 page 0 100 20\nscroll2 pos 30\nscroll page 0 100 20\nscroll pos 10\nnext WAIT\n#WAIT\n#slider.SCRL_P\n\\5=\\5+1\nslider getpos 7\n#slider.FOCUS\n\\6=1\n#slider.UNFOCUS\n\\6=0\n#MOTION\nslider authoredFade\nslider ismot 8\n#CHECK\nslider ismot 9\n#LOOP\nslider authoredLoop\nslider ismot 10\n#STOP\nslider stop\nslider ismot 11\n';

export async function controlFiles(exe, source = '') {
  return {
    'engine.exe': exe,
    'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [43, 0x41, 0], [59]]),
    'screen.fes': new TextEncoder().encode(source),
    'controls.hg2': await imageFile(),
    'scroll.hg2': await scrollFile(),
    'authored-alpha.kcs': kcsProgram([[21, [0x13, 0x80000070], 0x40000000], [43, 0x26, 0], [59]]),
    'authored-loop.kcs': kcsProgram([[21, [0x13, 0x80000070], 0x80000000], [59]]),
    'area.hg2': await areaFile(),
  };
}
