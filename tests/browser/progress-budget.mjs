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
    this.changedFrame = 0;
  }
  remainingWallMS() {
    return Math.max(0, points.stallWallMS - (this.now() - this.changedAt));
  }
  observe(evidence) {
    const signature = JSON.stringify(evidence.position);
    if (!this.last || signature !== this.signature) {
      this.changedAt = this.now();
      this.changedFrame = evidence.frame ?? 0;
      this.signature = signature;
    }
    this.last = evidence;
    if (evidence.frame - this.changedFrame >= points.stallFrames || this.remainingWallMS() === 0)
      throw new Error(`Native acceptance made no progress ${JSON.stringify(evidence)}`);
    if (this.limit && evidence.frame >= this.limit) {
      for (const [key, minimum] of Object.entries(this.point))
        if (!(evidence[key] >= minimum))
          throw new Error(`Progress regressed at ${key} ${JSON.stringify(evidence)}`);
      throw new FrameBudgetReached(evidence);
    }
  }
}
