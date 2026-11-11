// SPDX-License-Identifier: MPL-2.0
// External DIF inertia, separate from the PSB's optional built-in physics.
const f = Math.fround;
const clamp = (value, limit) => Math.min(limit, Math.max(-limit, value));

export class M2Inertia {
  constructor(definition) {
    this.definition = definition;
    this.materials = Object.fromEntries(
      [...new Set([...definition.inertiaLR, ...definition.inertiaUD])]
        .filter((name) => definition.materials[name])
        .map((name) => [name, structuredClone(definition.materials[name])]),
    );
    this.springs = new Map(
      Object.keys(this.materials).map((name) => [
        name,
        { position: 0, velocity: 0, output: 0, paused: false },
      ]),
    );
    this.position = [0, 0];
    this.sources = new Map();
    this.lastFrame = null;
    this.enabled = true;
  }
  update(frame, x, y, variable, movementEnabled) {
    const d = this.definition,
      elapsed = this.lastFrame === null ? 1 : (frame - this.lastFrame) >>> 0,
      delta = [f(x - this.position[0]), f(y - this.position[1])];
    this.lastFrame = frame;
    this.position[0] = x;
    this.position[1] = y;
    for (const [names, axis] of [
      [d.inertiaLR, 0],
      [d.inertiaUD, 1],
    ])
      for (const name of names) {
        const spring = this.springs.get(name);
        if (spring && this.enabled && movementEnabled)
          spring.position = f(spring.position - delta[axis]);
      }
    const sources = new Map(
      d.inertiaFromChange.map((rule) => [rule.source, f(variable(rule.source))]),
    );
    for (const rule of d.inertiaFromChange) {
      const value = sources.get(rule.source),
        previous = this.sources.get(rule.source) ?? value,
        spring = this.springs.get(rule.target),
        material = this.materials[rule.target];
      if (spring && this.enabled && movementEnabled) {
        const impulse = f(
          f(f(f(value - previous) * f(1 / f(rule.limit))) * f(material.limit)) * f(rule.power),
        );
        spring.position = f(spring.position - impulse);
      }
    }
    this.sources = sources;
    if (elapsed > 100000) throw new Error('M2 inertia frame delta exceeds its bounded update');
    for (const [name, spring] of this.springs) {
      const material = this.materials[name],
        limit = f(material.limit),
        step = f(material.step);
      if (!this.enabled || !movementEnabled || spring.disabled)
        spring.position = spring.velocity = spring.output = 0;
      else if (!spring.paused)
        for (let i = 0; i < elapsed; i++) {
          spring.position = clamp(spring.position, limit);
          const acceleration = f(
            f(
              -f(f(material.spring) * spring.position) -
                f(f(material.resistance) * spring.velocity),
            ) / f(material.mass),
          );
          spring.velocity = f(spring.velocity + f(acceleration * step));
          spring.position = f(spring.position + f(step * spring.velocity));
          spring.output = f(spring.position / limit);
        }
    }
  }
  contribution(name) {
    const spring = this.springs.get(name),
      material = this.materials[name];
    if (!spring) return 0;
    const result = f(spring.output * f(material.scale));
    return material.inverted ? -result : result;
  }
  configure(levels, enabled) {
    const d = this.definition;
    for (const [name] of this.springs) {
      const material = d.materials[name];
      const level = levels.get(d.inertiaLevels[name]) ?? 100,
        t = f(f(level) * f(0.01)),
        current = this.materials[name],
        spring = this.springs.get(name);
      let changed = false;
      for (const key of ['mass', 'spring', 'resistance', 'step', 'limit']) {
        const value =
          t === 1
            ? material[key]
            : t < 1
              ? f(
                  f(f(material[key] - (d.materialMin[name]?.[key] ?? material[key])) * t) +
                    (d.materialMin[name]?.[key] ?? material[key]),
                )
              : f(
                  f(f((d.materialMax[name]?.[key] ?? material[key]) - material[key]) * f(t - 1)) +
                    material[key],
                );
        changed ||= value !== current[key];
        current[key] = value;
      }
      const disabled = !(enabled.get(d.inertiaEnabled[name]) ?? 1);
      changed ||= disabled !== Boolean(spring.disabled);
      spring.disabled = disabled;
      if (changed) spring.position = spring.velocity = spring.output = 0;
    }
  }
  pause(name, value) {
    const spring = this.springs.get(name);
    if (!spring || spring.paused === Boolean(value)) return;
    spring.paused = Boolean(value);
    spring.position = spring.velocity = spring.output = 0;
  }
  reset() {
    for (const name of this.springs.keys()) this.pause(name, false);
  }
  snapshot() {
    return structuredClone({
      materials: this.materials,
      springs: [...this.springs],
      position: this.position,
      sources: [...this.sources],
      lastFrame: this.lastFrame,
      enabled: this.enabled,
    });
  }
  restore(state) {
    this.materials = structuredClone(state.materials);
    this.springs = new Map(structuredClone(state.springs));
    this.sources = new Map(state.sources);
    this.position = [...state.position];
    this.lastFrame = state.lastFrame;
    this.enabled = state.enabled;
  }
}
