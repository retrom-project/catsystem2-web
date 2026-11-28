// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
const points = JSON.parse(readFileSync(new URL('./progress-points.json', import.meta.url), 'utf8'));

export class FrameBudgetReached extends Error {
  constructor(evidence) {
    super('Accepted progress frame budget reached');
    this.evidence = evidence;
  }
}

export class ProgressBudget {
  constructor(name, now = Date.now) {
    this.point = points[name];
    this.limit = this.point && this.point.frame + points.extraFrames;
    this.now = now;
    this.last = null;
    this.changedAt = now();
    this.stalledFrames = 0;
  }
  remainingWallMS() {
    return Math.max(0, points.stallWallMS - (this.now() - this.changedAt));
  }
  observe(evidence, requestedFrames = 0) {
    if (!this.last || evidence.frame !== this.last.frame) {
      this.changedAt = this.now();
      this.stalledFrames = 0;
    } else this.stalledFrames += requestedFrames;
    this.last = evidence;
    if (this.stalledFrames >= points.stallFrames || this.remainingWallMS() === 0)
      throw new Error(`Native acceptance made no progress ${JSON.stringify(evidence)}`);
    if (this.limit && evidence.frame >= this.limit) {
      for (const [key, minimum] of Object.entries(this.point))
        if (!(evidence[key] >= minimum))
          throw new Error(`Progress regressed at ${key} ${JSON.stringify(evidence)}`);
      throw new FrameBudgetReached(evidence);
    }
  }
}
