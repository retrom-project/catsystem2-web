// SPDX-License-Identifier: MPL-2.0
// Authored script/model inputs for the existing M2 wrapper oracle.
import { PSB } from '../../src/formats/psb.mjs';
import { emotePSBFixture, encodeAuthoredPSB } from './emote-psb-fixture.mjs';
import { nativeLPB, nativeLV } from './native-lip.mjs';

export const emoteM2Curves = ['linear', 'sin_fs', 'sin_sf', 'sin_ss', 'fix'];
export const emoteM2Programs = ['aa01,1,1,1,1,1,1:0', 'aa01,1,2,2,2,2,2:0'];
export function emoteM2SequenceFiles() {
  const psb = new PSB(emotePSBFixture()),
    root = psb.root,
    motion = root.object.body.motion.base,
    image = motion.layer[0];
  root.metadata.variableList = emoteM2Curves.map((_, i) => ({
    label: 'v' + i,
    frameList: [
      { frame: 0, label: 'rest' },
      { frame: 10, label: 'target' },
    ],
  }));
  root.metadata.transitionControl = emoteM2Curves.map((_, i) => ({ label: 'v' + i, enabled: 1 }));
  root.metadata.timelineControl = [
    { label: 'base', diff: 0, lastTime: 61, loopBegin: 0, loopEnd: 61, variableList: [] },
  ];
  motion.parameter = emoteM2Curves.map((_, i) => ({
    id: 'v' + i,
    enabled: 1,
    rangeBegin: 0,
    rangeEnd: 10,
    division: 10,
    discretization: 0,
  }));
  motion.layer = emoteM2Curves.map((_, i) => ({
    ...structuredClone(image),
    label: 'image' + i,
    parameterize: i,
    frameList: [
      { time: 0, type: 3, content: { mask: 2, src: 'tex', icon: 'dot', coord: [0, i * 4, 0] } },
      { time: 10, type: 2, content: { mask: 2, src: 'tex', icon: 'dot', coord: [10, i * 4, 0] } },
      { time: 11, type: 0 },
    ],
  }));
  motion.layerIndexMap = Object.fromEntries(motion.layer.map((layer, i) => [layer.label, i]));
  motion.priority[0].content = motion.layer.map((_, i) => i);
  const text = (s) => new TextEncoder().encode(s.replaceAll('\n', '\r\n'));
  return {
    'm2view.cnf': text('#wndsize\n64 64\n#fade\n1\n#chheader\naa\n#profile\naa01 authored.pfl\n'),
    'authored.pfl': text('#charaname\n1 body authored\n#motname\n1 0 base authored.dif\n'),
    'authored.dif': text(
      '#scale\n1 1\n#dif\n' +
        emoteM2Curves.map((_, i) => `${i + 1} part${i}`).join('\n') +
        '\n#pattern\n' +
        emoteM2Curves.map((_, i) => `%${i + 1} 1 1\nv${i} 0\n%${i + 1} 2 2\nv${i} 10`).join('\n') +
        '\n#chain\n' +
        emoteM2Curves.map((curve, i) => `${i + 1} ${curve} 10`).join('\n') +
        '\n#attribute\n0 123 456 7\n',
    ),
    'authored.psb': encodeAuthoredPSB(root, [psb.resource(0)]),
  };
}

function singleVariableFiles() {
  const files = emoteM2SequenceFiles(),
    psb = new PSB(files['authored.psb']),
    root = psb.root,
    motion = root.object.body.motion.base;
  root.metadata.variableList = [
    {
      label: 'v0',
      frameList: [
        { frame: 0, label: 'rest' },
        { frame: 10, label: 'target' },
      ],
    },
  ];
  root.metadata.transitionControl = [{ label: 'v0', enabled: 1 }];
  root.metadata.timelineControl = [];
  motion.parameter = [
    { id: 'v0', enabled: 1, rangeBegin: -100, rangeEnd: 100, division: 200, discretization: 0 },
  ];
  motion.layer = [motion.layer[0]];
  motion.layer[0].frameList = [
    { time: 0, type: 3, content: { mask: 2, src: 'tex', icon: 'dot', coord: [-100, 0, 0] } },
    { time: 200, type: 2, content: { mask: 2, src: 'tex', icon: 'dot', coord: [100, 0, 0] } },
    { time: 201, type: 0 },
  ];
  motion.layerIndexMap = { image0: 0 };
  motion.priority[0].content = [0];
  files['authored.psb'] = encodeAuthoredPSB(root, [psb.resource(0)]);
  return files;
}

const encodedText = (text) => new TextEncoder().encode(text.replaceAll('\n', '\r\n'));
export function emoteM2InertiaFiles() {
  const files = singleVariableFiles();
  files['authored.dif'] = encodedText(
    '#scale\n1 1\n#defval\nv0 0\n#material\nv0 7 1.8 2.2 0.15 50 0 30 0\n#inertia_lr\nv0\n',
  );
  return files;
}
export function emoteM2BlinkFiles() {
  const files = singleVariableFiles();
  files['authored.dif'] = encodedText(
    '#scale\n1 1\n#dif\n1 a\n2 b\n3 eye\n#pattern\n%3 1 1\nv0 0\n#chain\n3 fix 1\n#blink\n3 1 0 10 4 2 2\n',
  );
  return files;
}
export function emoteM2ActionFiles() {
  const files = singleVariableFiles();
  files['authored.dif'] = encodedText(
    '#scale\n1 1\n#dif\n1 pose\n#pattern\n%1 1 1\nv0 0\n#chain\n1 fix 1\n',
  );
  files['m2view.cnf'] = encodedText(
    new TextDecoder().decode(files['m2view.cnf']).replaceAll('\r\n', '\n') +
      '#action\nauthored.def\n',
  );
  files['authored.def'] = encodedText(
    '#action\n$sample\nframe 6\neasing 1.2\nvar v0 10\nwait 2\nframe 3\neasing -1.2\nrestore\n',
  );
  return files;
}
export function emoteM2LipFiles() {
  const files = singleVariableFiles();
  files['authored.dif'] = encodedText(
    '#scale\n1 1\n#dif\n1 mouth\n#pattern\n%1 1 1\nv0 0\n#chain\n1 fix 1\n#clipper_default\n0 1 0.4 0.2 0.8 0.6 0 1\n#lip_table\n1 1 linear 50 700 0 0 5 10\n#lip_variable\n1 1 v0\n#lip_flow\n1 1 1,4,0 3,4,1 2,4,0\n',
  );
  return files;
}

export function emoteM2InertiaChangeFiles() {
  const files = singleVariableFiles(),
    psb = new PSB(files['authored.psb']),
    root = psb.root,
    motion = root.object.body.motion.base;
  root.metadata.variableList.push({ label: 'v1', frameList: [{ frame: 0, label: 'rest' }] });
  root.metadata.transitionControl.push({ label: 'v1', enabled: 1 });
  motion.parameter.push({ ...structuredClone(motion.parameter[0]), id: 'v1' });
  const layer = structuredClone(motion.layer[0]);
  layer.label = 'image1';
  layer.parameterize = 1;
  for (const frame of layer.frameList) if (frame.content) frame.content.coord[1] = 4;
  motion.layer.push(layer);
  motion.layerIndexMap.image1 = 1;
  motion.priority[0].content.push(1);
  files['authored.psb'] = encodeAuthoredPSB(root, [psb.resource(0)]);
  files['authored.dif'] = encodedText(
    '#scale\n1 1\n#dif\n1 head\n#pattern\n%1 1 1\nv0 0\n%1 2 2\nv0 10\n#chain\n1 linear 6\n#defval\nv1 0\n#material\nv1 7 1.8 2.2 0.15 50 0 30 0\n#inertia_lr\nv1\n#inertia_dif\nv0 v1 0.2 12\n',
  );
  return files;
}

export function emoteM2SplineFiles(loop = false) {
  const files = emoteM2InertiaFiles();
  files['m2view.cnf'] = encodedText(
    new TextDecoder().decode(files['m2view.cnf']).replaceAll('\r\n', '\n') +
      '#spline\nauthored.inf\n',
  );
  files['authored.inf'] = encodedText(
    '#sample' + (loop ? ' loop' : '') + '\nv0 0,1 0.25,3 0.8,4 -0.5,3\n',
  );
  return files;
}

export function emoteM2Cases() {
  const same = 'aa01,1,1,1,1,1,1,1:0',
    pinned = emoteM2SequenceFiles();
  pinned['authored.dif'] = encodedText(
    new TextDecoder().decode(pinned['authored.dif']).replaceAll('\r\n', '\n') + '#defval\nv0 5\n',
  );
  const fadeFour = emoteM2BlinkFiles();
  fadeFour['m2view.cnf'] = encodedText(
    new TextDecoder().decode(fadeFour['m2view.cnf']).replace('#fade\r\n1', '#fade\r\n4'),
  );
  const crossfade = emoteM2BlinkFiles(),
    second = new PSB(crossfade['authored.psb']);
  for (const frame of second.root.object.body.motion.base.layer[0].frameList)
    if (frame.content) frame.content.coord[0] += 12;
  crossfade['second.psb'] = encodeAuthoredPSB(second.root, [second.resource(0)]);
  crossfade['authored.pfl'] = encodedText(
    '#charaname\n1 body authored\n2 body second\n#motname\n1 0 base authored.dif\n2 0 base authored.dif\n',
  );
  crossfade['m2view.cnf'] = fadeFour['m2view.cnf'];
  const shifted = emoteM2InertiaFiles();
  shifted['authored.dif'] = encodedText(
    new TextDecoder().decode(shifted['authored.dif']).replace('30 0', '30 5'),
  );
  return [
    ...[1, 2, 3].map((mode) => ({
      name: 'color-mode-' + mode,
      files: emoteM2SequenceFiles(),
      programs: [same, same],
      initialFrames: 4,
      transitionFrames: 3,
      operations: [{ index: 4, message: 535, l: mode }],
    })),
    {
      name: 'fade-override',
      files: emoteM2BlinkFiles(),
      programs: [same, same],
      initialFrames: 12,
      transitionFrames: 16,
      operations: [{ index: 0, message: 545, l: 4 }],
    },
    {
      name: 'fade-request',
      files: emoteM2BlinkFiles(),
      programs: [same, same],
      initialFrames: 12,
      transitionFrames: 16,
      operations: [{ index: 8, message: 545, l: 4 }],
    },
    {
      name: 'crossfade-midblink',
      files: crossfade,
      programs: [same, same.replace('aa01,1', 'aa01,2')],
      initialFrames: 10,
      transitionFrames: 16,
      replacement: true,
      operations: [],
    },
    {
      name: 'crossfade-interrupted',
      files: crossfade,
      programs: [same, same.replace('aa01,1', 'aa01,2')],
      initialFrames: 12,
      transitionFrames: 16,
      replacement: true,
      operations: [{ index: 15, message: 524, text: same }],
    },
    {
      name: 'effects-fade',
      files: { ...emoteM2SequenceFiles(), 'm2view.cnf': fadeFour['m2view.cnf'] },
      programs: emoteM2Programs,
      initialFrames: 5,
      transitionFrames: 16,
      effectsFade: true,
      operations: [{ index: 4, message: 546, l: 1 }],
    },
    {
      name: 'crossfade',
      files: crossfade,
      programs: [same, same.replace('aa01,1', 'aa01,2')],
      initialFrames: 12,
      transitionFrames: 16,
      replacement: true,
      operations: [],
    },
    {
      name: 'fade-four',
      files: fadeFour,
      programs: [same, same],
      initialFrames: 16,
      transitionFrames: 16,
      operations: [],
    },
    {
      name: 'inertia-change-unpositioned',
      files: emoteM2InertiaChangeFiles(),
      programs: emoteM2Programs,
      initialFrames: 5,
      transitionFrames: 20,
      operations: [],
    },
    {
      name: 'inertia-change',
      files: emoteM2InertiaChangeFiles(),
      programs: emoteM2Programs,
      initialFrames: 5,
      transitionFrames: 20,
      operations: [{ index: 0, message: 51, floats: [0, 0] }],
    },
    {
      name: 'inertia-shift',
      files: shifted,
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 13,
      operations: [],
    },
    {
      name: 'curves',
      files: emoteM2SequenceFiles(),
      programs: emoteM2Programs,
      initialFrames: 5,
      transitionFrames: 13,
      operations: [],
    },
    {
      name: 'initial-and-reverse',
      files: emoteM2SequenceFiles(),
      programs: emoteM2Programs.toReversed(),
      initialFrames: 5,
      transitionFrames: 13,
      operations: [],
    },
    {
      name: 'pins',
      files: pinned,
      programs: emoteM2Programs,
      initialFrames: 5,
      transitionFrames: 13,
      operations: [],
    },
    {
      name: 'inertia',
      files: emoteM2InertiaFiles(),
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 13,
      operations: [{ index: 5, message: 51, floats: [10, 0] }],
    },
    {
      name: 'blink',
      files: emoteM2BlinkFiles(),
      programs: [same, same],
      initialFrames: 12,
      transitionFrames: 13,
      operations: [],
    },
    {
      name: 'action-finish-transitions',
      files: emoteM2ActionFiles(),
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 22,
      operations: [
        { index: 5, message: 551, text: 'sample' },
        { index: 8, message: 527 },
      ],
    },
    {
      name: 'action-skip',
      files: emoteM2ActionFiles(),
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 22,
      operations: [
        { index: 5, message: 551, text: 'sample' },
        { index: 8, message: 552 },
      ],
    },
    {
      name: 'pause',
      files: emoteM2SequenceFiles(),
      programs: emoteM2Programs,
      initialFrames: 5,
      transitionFrames: 17,
      operations: [
        { index: 7, message: 526, l: 0 },
        { index: 11, message: 526, l: 1 },
      ],
    },
    {
      name: 'action',
      files: emoteM2ActionFiles(),
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 22,
      operations: [{ index: 5, message: 551, text: 'sample' }],
    },
    ...[
      ['lpb', nativeLPB()],
      ['lv', nativeLV()],
      ['lv-initial', new Uint8Array(Float32Array.of(2, 1, 0.25, 0.5, 0.75, 0, 1, 0).buffer)],
    ].map(([label, bytes]) => ({
      name: 'lip-' + label,
      files: emoteM2LipFiles(),
      programs: [same, same],
      initialFrames: 12,
      transitionFrames: 13,
      audio: { kind: label === 'lv-initial' ? 'lv' : label, bytes: [...bytes] },
      operations: [],
    })),
    ...[false, true].map((loop) => ({
      name: 'spline-' + (loop ? 'loop' : 'once'),
      files: emoteM2SplineFiles(loop),
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 28,
      operations: [{ index: 5, message: 543, text: 'sample' }],
    })),
    {
      name: 'lip-flow-initial',
      files: emoteM2LipFiles(),
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 26,
      audio: {
        end: 20,
        levels: Array.from({ length: 31 }, (_, i) =>
          Array(80).fill(i < 12 ? 100 : i < 15 ? 300 + i : 0),
        ),
      },
      operations: [],
    },
    {
      name: 'lip-flow',
      files: emoteM2LipFiles(),
      programs: [same, same],
      initialFrames: 5,
      transitionFrames: 26,
      audio: {
        end: 20,
        levels: Array.from({ length: 31 }, (_, i) =>
          Array(80).fill(i < 5 || i >= 15 ? 0 : 100 + i),
        ),
      },
      operations: [],
    },
  ];
}
