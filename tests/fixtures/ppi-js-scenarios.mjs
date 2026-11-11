// SPDX-License-Identifier: MPL-2.0
// Authored parameters, not extracted game resource data.
const parameters = {
  blur: [1, 320, 220, 3, 125, 75, 15, -20, 30, 20, 50, 100, 15, 25, 10, 1],
  cmnptcl: [2, 3, 1],
  dash: [3, 40, 75, 25, 200, 100, 180],
  em_angry: [320, 180, 80, 3, 4, 8, 4, 5, 1, 1, 1],
  em_double: [300, 200, 0, 90, 2, 6, 2, 2, 2],
  em_note: [3, 200, 180, 1, 90, 9, 8, 14],
  em_question: [300, 160, 1, 100, 3, 5, 4, 4, 12],
  em_question_a: [300, 160, 1, 100, 3, 5, 4, 4, 12],
  em_sweat: [400, 120, 70, 5, 22],
  filmnoise: [],
  rain: [90, 35, -8, 12, 60, 2, 1],
  steam: [25, 8, 0, 45, 100, 20, 180, 40, 5, 12, 8, -100, 360, 100, 360, 60, 2, 1],
};
const frames = [0, 1, 2, 3, 5, 7, 9, 15, 22, 35, 40, 70];
const baseOptions = {
  width: 96,
  height: 192,
  screenWidth: 960,
  screenHeight: 540,
  attachPlane: 12,
  attachment: { base: [48, 96, 0], pos: [500, 290, 0], disp: 1 },
};
export const PPI_SCENARIOS = Object.entries(parameters).map(([name, registers]) => ({
  name,
  options: { ...baseOptions, count: ['dash', 'em_note'].includes(name) ? 9 : 6, registers },
  actions: [
    ...frames.map((frame) => ({ frame })),
    { frame: 71, attachment: { base: [48, 96, 0], pos: [520, 310, 0], disp: 1 } },
    { frame: 72, registers: registers.map((v, n) => (n < 2 ? v + 1 : v)) },
    { stop: true },
    { start: true },
    { frame: 0 },
    { frame: 1 },
    { frame: 5 },
  ],
}));
PPI_SCENARIOS.push(
  {
    name: 'rain',
    label: 'rapid-reset',
    options: { ...baseOptions, count: 5, registers: [1, 1, 200, -200, 61, 2, 0] },
    actions: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((frame) => ({ frame })),
  },
  {
    name: 'steam',
    label: 'no-warm-zero-length',
    options: {
      ...baseOptions,
      count: 3,
      registers: [10, 0, 0, 0, 50, 0, 220, 0, 0, 0, 0, 200, 150, 200, 150, 60, 1, 0],
    },
    actions: [0, 1, 2, 3, 4].map((frame) => ({ frame })),
  },
  {
    name: 'cmnptcl',
    label: 'radius',
    options: { ...baseOptions, count: 6, registers: [3, 4, 0] },
    plist: {
      emitterType: 1,
      duration: 0.5,
      particleLifespan: 0.2,
      particleLifespanVariance: 0.05,
      maxRadius: 120,
      maxRadiusVariance: 25,
      minRadius: 10,
      rotatePerSecond: 180,
      rotatePerSecondVariance: 20,
    },
    actions: frames.map((frame) => ({ frame })),
  },
);
const gravity = {
  duration: -1,
  particleLifespan: 0.25,
  particleLifespanVariance: 0.05,
  sourcePositionx: 320,
  sourcePositiony: 220,
  sourcePositionVariancex: 15,
  sourcePositionVariancey: 10,
  speed: 80,
  speedVariance: 15,
  angle: 30,
  angleVariance: 20,
  gravityx: 10,
  gravityy: -60,
  radialAcceleration: 200,
  radialAccelVariance: 50,
  tangentialAcceleration: -80,
  tangentialAccelVariance: 15,
  startColorRed: 0.8,
  startColorGreen: 0.4,
  startColorBlue: 0.2,
  startColorAlpha: 0.9,
  startColorVarianceRed: 0.1,
  startColorVarianceGreen: 0.05,
  startColorVarianceBlue: 0.1,
  startColorVarianceAlpha: 0.1,
  finishColorRed: 0.1,
  finishColorGreen: 0.8,
  finishColorBlue: 0.4,
  finishColorAlpha: 0,
  finishColorVarianceRed: 0.05,
  finishColorVarianceGreen: 0.1,
  finishColorVarianceBlue: 0.1,
  finishColorVarianceAlpha: 0,
  startParticleSize: 45,
  startParticleSizeVariance: 10,
  finishParticleSize: 15,
  finishParticleSizeVariance: 5,
  rotationStart: 15,
  rotationStartVariance: 5,
  rotationEnd: 90,
  rotationEndVariance: 10,
};
for (const scenario of PPI_SCENARIOS)
  if (scenario.name === 'cmnptcl') scenario.plist = { ...gravity, ...scenario.plist };
export function scenarioPlist(base, changes = {}) {
  let text = new TextDecoder().decode(base);
  for (const [key, value] of Object.entries(changes))
    text = text.replace(
      new RegExp('(<key>' + key + '</key><real>)[^<]*(</real>)'),
      (_, a, b) => a + value + b,
    );
  return new TextEncoder().encode(text);
}
