// SPDX-License-Identifier: MPL-2.0
import { PSB } from '../../src/formats/psb.mjs';
import { emotePSBFixture, encodeAuthoredPSB } from './emote-psb-fixture.mjs';

export function emoteControllerModel(category, settings = {}) {
  const psb = new PSB(emotePSBFixture()),
    root = psb.root,
    motion = root.object.body.motion.base,
    layer = motion.layer[0];
  motion.lastTime = 61;
  motion.parameterize = 0;
  motion.parameter = [
    { id: 'pose', enabled: 1, rangeBegin: -30, rangeEnd: 30, division: 60, discretization: 0 },
  ];
  layer.parameterize = 0;
  layer.frameList = [
    { time: 0, type: 3, content: { mask: 2, src: 'tex', icon: 'dot', coord: [-30, 0, 0] } },
    { time: 60, type: 2, content: { mask: 2, src: 'tex', icon: 'dot', coord: [30, 0, 0] } },
    { time: 61, type: 0 },
  ];
  const common = {
    enabled: 1,
    label: 'pose',
    beginFrame: 0,
    endFrame: 10,
    blinkEnabled: 0,
    blinkFrameCount: 8,
    blinkIntervalMin: 2,
    blinkIntervalMax: 2,
    edge: [[-30, 30]],
    node: [],
    ...settings,
  };
  if (category === 'timeline') {
    root.metadata.transitionControl = [{ enabled: 1, label: 'pose' }];
    root.metadata.timelineControl = [
      {
        label: 'timeline',
        diff: 0,
        lastTime: 11,
        loopBegin: settings.loop ? 2 : -1,
        loopEnd: settings.loop ? 6 : -1,
        variableList: [
          {
            label: 'pose',
            frameList: [
              { time: 0, type: 2, content: { value: 10, easing: 0 } },
              { time: 6, type: 2, content: { value: -5, easing: 1 } },
              { time: 11, type: 0 },
            ],
          },
        ],
      },
    ];
    return encodeAuthoredPSB(root, [psb.resource(0)]);
  }
  if (['bust', 'hair', 'parts'].includes(category)) {
    Object.assign(common, {
      baseLayer: 'image',
      var_lr: 'pose',
      var_ud: 'up',
      var_lrm: 'alternate',
      gravity: 0.3,
      friction: 0.125,
      spring: 0.03125,
      friction_x: 0.03125,
      friction_y: 0.03125,
      b_rate: 0.0037109375,
      v_bound: 0.5,
      length: [2, 2],
      ud_eft: 0,
      bend_spd: 0.392699,
      bend_vol: 3,
      scale_x: category === 'bust' ? 1 : [0.75, 0.25],
      scale_y: category === 'bust' ? 2 : [2, 3],
      param:
        category === 'bust'
          ? {
              op: { x: 0, y: 0, z: 0 },
              p: { x: 0, y: 10, z: 0 },
              pv: { x: 0, y: 0, z: 0 },
              ofs: 10,
            }
          : {
              op: { x: 0, y: 0, z: 0 },
              ofs: 0,
              bendR: 0,
              bendS: 0,
              bp: [
                { x: 0, y: 2, z: 0 },
                { x: 0, y: 4, z: 0 },
              ],
              p: [
                { x: 0, y: 2, z: 0 },
                { x: 0, y: 4, z: 0 },
              ],
              pv: [
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 0, z: 0 },
              ],
            },
    });
    root.metadata.variableList.push(
      { label: 'up', frameList: [] },
      { label: 'alternate', frameList: [] },
    );
  }
  if (category === 'mouth') {
    common.talkLabel = 'talk';
    root.metadata.variableList.push({ label: 'talk', frameList: [] });
  }
  if (category === 'selector') {
    common.label = 'switcher';
    common.optionList = [
      { label: 'pose', onValue: 10, offValue: 0 },
      { label: 'other', onValue: 20, offValue: 0 },
    ];
    root.metadata.variableList.push(
      { label: 'other', frameList: [] },
      { label: 'switcher', frameList: [] },
    );
    root.metadata.transitionControl = [
      { enabled: 1, label: 'pose' },
      { enabled: 1, label: 'other' },
    ];
  }
  if (category === 'loop')
    Object.assign(common, {
      var_loop: 'pose',
      transitionList: [
        [0, 10, 4],
        [10, 0, 4],
      ],
    });
  if (category !== 'root') root.metadata[`${category}Control`] = [common];
  return encodeAuthoredPSB(root, [psb.resource(0)]);
}

export function emoteControllerCases() {
  const result = [];
  for (const category of ['transition', 'eye', 'eyebrow', 'mouth'])
    for (const easing of [0, 1, -1]) {
      result.push({
        name: `${category}/${easing}`,
        category,
        settings: {},
        steps: [0, 1, 1, 2.25, 0.5, 4, 1].map((elapsed, i) => ({
          elapsed,
          ...(i === 0
            ? {
                variables: [
                  { name: category === 'mouth' ? 'talk' : 'pose', value: 10, frames: 8, easing },
                ],
              }
            : {}),
        })),
      });
    }
  result.push({
    name: 'eye/automatic',
    category: 'eye',
    settings: { blinkEnabled: 1 },
    steps: Array.from({ length: 16 }, () => ({ elapsed: 1 })),
  });
  result.push({
    name: 'eyebrow/graph',
    category: 'eyebrow',
    settings: {
      edge: [
        [-10, 0],
        [10, 30],
      ],
      node: [[0, 10]],
    },
    steps: Array.from({ length: 14 }, (_, i) => ({
      elapsed: 1,
      ...(i === 0 ? { variables: [{ name: 'pose', value: 20, frames: 8 }] } : {}),
    })),
  });
  result.push({
    name: 'eye/random',
    category: 'eye',
    settings: { blinkEnabled: 1, blinkIntervalMin: 1, blinkIntervalMax: 5 },
    steps: Array.from({ length: 64 }, () => ({ elapsed: 0.5 })),
  });
  for (const category of ['bust', 'hair', 'parts'])
    result.push({
      name: `${category}/physics`,
      category,
      settings: {},
      steps: [0, 1, 1, 0.5, 2.25, 1, 1].map((elapsed) => ({ elapsed })),
    });
  for (const loop of [false, true])
    for (const flags of [0, 2])
      result.push({
        name: `timeline/${loop}/${flags}`,
        category: 'timeline',
        settings: { loop },
        steps: [0, 1, 1, 2.25, 0.5, 4, 1].map((elapsed, i) => ({
          elapsed,
          ...(i === 0 ? { timeline: { action: 'play', label: 'timeline', flags } } : {}),
        })),
      });
  result.push({
    name: 'loop/basic',
    category: 'loop',
    settings: {},
    steps: [0, 1, 1, 2, 1, 2.25, 0.75, 1].map((elapsed) => ({ elapsed })),
  });
  result.push({
    name: 'selector/fade',
    observeVariables: ['pose', 'other'],
    category: 'selector',
    settings: {},
    steps: [0, 1, 1, 2, 1, 2].map((elapsed, i) => ({
      elapsed,
      ...(i === 0 || i === 4
        ? { variables: [{ name: 'switcher', value: i === 0 ? 1 : 0, frames: 4 }] }
        : {}),
    })),
  });
  for (const easing of [0, 1, -1])
    result.push({
      name: `root/${easing}`,
      category: 'root',
      settings: {},
      steps: [0, 1, 1, 2.25, 0.5, 1].map((elapsed, i) => ({
        elapsed,
        observeRoot: true,
        ...(i === 0
          ? {
              root: {
                position: [10, -5],
                scale: 2,
                angle: -Math.PI / 2,
                color: 0x80402010,
                frames: 4,
                easing,
              },
            }
          : {}),
      })),
    });
  result.push({
    name: 'hair/wind',
    category: 'hair',
    settings: {},
    steps: Array.from({ length: 32 }, (_, i) => ({
      elapsed: 1,
      ...(i === 0 ? { wind: [-10, 10, 1.5, 1, 5] } : {}),
    })),
  });
  for (const category of ['transition', 'eye'])
    result.push({
      name: `${category}/fractional`,
      category,
      settings: {},
      steps: [0, 0.1, 0.2, 1 / 3, 1.1, 2.7].map((elapsed, i) => ({
        elapsed,
        ...(i === 0
          ? { variables: [{ name: 'pose', value: 7.25, frames: 3.7, easing: 0.5 }] }
          : {}),
      })),
    });
  return result;
}
