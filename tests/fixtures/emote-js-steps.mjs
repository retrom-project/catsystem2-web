// SPDX-License-Identifier: MPL-2.0
export function apply(animation, step) {
  if (step.root) {
    const r = step.root;
    if (r.position) animation.setRoot('position', r.position, r.frames, r.easing);
    if (r.scale != null) animation.setRoot('scale', [r.scale], r.frames, r.easing);
    if (r.angle != null) animation.setRoot('angle', r.angle, r.frames, r.easing);
    if (r.color != null) animation.setColor(r.color, r.frames, r.easing);
  }
  if (step.wind) animation.setWind(step.wind);
  if (step.timeline) {
    const t = step.timeline;
    if (t.action === 'play') animation.timelines.play(t.label, t.flags);
    else animation.timelines.stop(t.label);
  }
  for (const v of step.variables ?? []) animation.setVariable(v.name, v.value, v.frames, v.easing);
  animation.update(step.elapsed);
}
