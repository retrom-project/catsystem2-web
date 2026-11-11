// SPDX-License-Identifier: MPL-2.0
// Records public DLL calls through the existing oracle hosts. No EXE is loaded.
import { floatBits } from '../src/kcs.mjs';

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const words = (values) => Array.from(values, floatBits);
const states = (map) => [...map].sort(([a], [b]) => a - b);

function emoteRoot(player) {
  const p = player.device.process,
    memory = p.allocate(8, true);
  try {
    player.call(22, [memory, memory + 4]);
    return {
      position: [p.load(memory), p.load(memory + 4)],
      scale: floatBits(player.call(24, [], { real: true })),
      angle: floatBits(player.call(26, [], { real: true })),
      color: player.call(28) >>> 0,
    };
  } finally {
    p.free(memory);
  }
}

export function recordEmoteFrames(player, steps, { observeVariables = [] } = {}) {
  const d3d = player.device.d3d,
    previous = d3d.onDrawRaw,
    variables = player.variables(),
    observedVariables = [...new Set([...variables, ...observeVariables])],
    frames = [];
  let draws;
  d3d.onDrawRaw = (draw) => {
    const { bytes, indices, ...header } = draw;
    draws.push({ ...header, bytes: hex(bytes), ...(indices ? { indices: hex(indices) } : {}) });
    previous?.(draw);
  };
  try {
    for (const step of steps) {
      draws = [];
      if (step.wind) player.call(42, step.wind.map(floatBits));
      if (step.root) {
        const root = step.root,
          frames = floatBits(root.frames ?? 0),
          easing = floatBits(root.easing ?? 0);
        if (root.position) player.call(21, [...root.position.map(floatBits), frames, easing]);
        if (root.scale != null) player.call(23, [floatBits(root.scale), frames, easing]);
        if (root.angle != null) player.call(25, [floatBits(root.angle), frames, easing]);
        if (root.color != null) player.call(27, [root.color >>> 0, frames, easing]);
      }
      if (step.timeline)
        player.string(step.timeline.label, (pointer) => {
          if (step.timeline.action === 'play') player.call(53, [pointer, step.timeline.flags ?? 0]);
          else if (step.timeline.action === 'stop') player.call(55, [pointer]);
          else throw new Error(`Unknown E-mote timeline action ${step.timeline.action}`);
        });
      for (const change of step.variables ?? [])
        player.setVariable(change.name, change.value, change.frames ?? 0, change.easing ?? 0);
      player.update(step.elapsed);
      player.collectDraw();
      frames.push({
        elapsedBits: floatBits(step.elapsed),
        variables: observedVariables.map((name) => [name, floatBits(player.variable(name))]),
        hidden: player.hidden,
        ...(step.observeRoot ? { root: emoteRoot(player) } : {}),
        draws,
      });
    }
  } finally {
    d3d.onDrawRaw = previous;
  }
  return { variables, observedVariables, frames };
}

export function recordPPIFrames(particle, frames, { stop = true } = {}) {
  const capture = (entry) => ({
    entry,
    before: particle.before,
    frame: particle.frame,
    active: particle.active,
    stopped: particle.stopped,
    records: hex(particle.records()),
    registers: words(particle.registers),
    zShifts: words(particle.zShifts),
    blendMode: particle.blendMode,
    renderStates: states(particle.renderStates),
    samplerStates: states(particle.samplerStates),
    random: structuredClone(particle.random.snapshot()),
  });
  const records = [capture('Init')];
  for (const frame of frames) {
    particle.update(frame);
    records.push(capture('Exec'));
  }
  if (stop) {
    particle.stop();
    records.push(capture('Stop'));
  }
  return records;
}
