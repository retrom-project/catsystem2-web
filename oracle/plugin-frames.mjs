// SPDX-License-Identifier: MPL-2.0
// Records public DLL calls through the existing oracle hosts. No EXE is loaded.
import { floatBits } from '../src/kcs.mjs';

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const words = (values) => Array.from(values, floatBits);
const states = (map) => [...map].sort(([a], [b]) => a - b);

export function recordEmoteFrames(player, steps) {
  const d3d = player.device.d3d,
    previous = d3d.onDrawRaw,
    variables = player.variables(),
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
      for (const change of step.variables ?? [])
        player.setVariable(change.name, change.value, change.frames ?? 0, change.easing ?? 0);
      player.update(step.elapsed);
      player.collectDraw();
      frames.push({
        elapsedBits: floatBits(step.elapsed),
        variables: variables.map((name) => [name, floatBits(player.variable(name))]),
        hidden: player.hidden,
        draws,
      });
    }
  } finally {
    d3d.onDrawRaw = previous;
  }
  return { variables, frames };
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
