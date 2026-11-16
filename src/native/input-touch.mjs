// SPDX-License-Identifier: MPL-2.0
// Window-owned WM_TOUCH contact slots and the five registered recognizers.
// Coordinates retain the original hundredth-pixel signed DWORD representation.
import { nativeRectangleUnion } from './windows-rectangles.mjs';

const recognizer = () => ({ available: 1, result: 0, armed: false });
export function createNativeTouchState(enabled) {
  return {
    slots: new Map(),
    manager: enabled
      ? {
          points: [],
          three: recognizer(),
          unused: recognizer(),
          two: recognizer(),
          stroke: { ...recognizer(), start: [0, 0], end: [0, 0], bounds: [0, 0, 0, 0] },
          one: recognizer(),
        }
      : null,
  };
}
function ordered(manager) {
  return [manager.three, manager.unused, manager.two, manager.stroke, manager.one];
}
function reset(manager) {
  for (const point of manager.points) point.fill(0);
  for (const item of ordered(manager)) {
    item.available = 1;
    item.result = 0;
    // The stroke reset retains +14/start/end, unlike the three tap resets.
    if (item !== manager.stroke) item.armed = false;
  }
  manager.stroke.bounds.fill(0);
}
function tap(item, points, count) {
  if (points.length < count) return;
  if (item.armed) {
    if (points.slice(0, count).every((point) => !point[0])) item.result = count;
  } else if (points.slice(0, count).every((point) => point[0])) {
    item.armed = true;
    item.available = 0;
  }
}
function direction(item) {
  const [left, top, right, bottom] = item.bounds,
    width = (right - left) | 0,
    height = (bottom - top) | 0,
    band = (value, third) => (value < third ? 0 : value < ((third * 2) | 0) ? 1 : 2);
  let first, last;
  if (width > Math.trunc(height / 3)) {
    const third = Math.trunc(width / 3);
    first = band((item.start[0] - left) | 0, third);
    last = band((item.end[0] - left) | 0, third);
    if (first === 0 && last === 2) return 7;
    if (first === 0 && last === 0) return 8;
    if (first === 2 && last === 0) return 6;
    if (first === 2 && last === 2) return 9;
    if (first === 1 && last === 1) return 12;
  } else if (height > Math.trunc(width / 3)) {
    const third = Math.trunc(height / 3);
    first = band((item.start[1] - top) | 0, third);
    last = band((item.end[1] - top) | 0, third);
    if (first === 0 && last === 2) return 5;
    if (first === 0 && last === 0) return 10;
    if (first === 2 && last === 0) return 4;
    if (first === 2 && last === 2) return 11;
    if (first === 1 && last === 1) return 13;
  }
  return 15;
}
function stroke(item, points) {
  if (!points.length) return;
  const [pressed, x, y] = points[0],
    pointRect = [x, y, (x + 1) | 0, (y + 1) | 0];
  if (item.armed) {
    item.end = [x, y];
    item.bounds = nativeRectangleUnion(pointRect, item.bounds);
    if (!pressed) {
      if (!item.available) item.result = direction(item);
      else item.bounds.fill(0);
      item.armed = false;
    } else if (item.available) {
      const dx = (x - item.start[0]) | 0,
        dy = (y - item.start[1]) | 0,
        distance = (Math.imul(dx, dx) + Math.imul(dy, dy)) >>> 0;
      if (distance >= 0x400) item.available = 0;
    }
  } else if (pressed) {
    item.armed = true;
    item.start = [x, y];
    item.bounds = nativeRectangleUnion(pointRect, item.bounds);
  }
}
function update(manager) {
  tap(manager.three, manager.points, 3);
  tap(manager.two, manager.points, 2);
  stroke(manager.stroke, manager.points);
  tap(manager.one, manager.points, 1);
}
export function pollNativeTouch(state, events, enabled) {
  const manager = state.manager;
  let activation = false;
  while (events.length) {
    const event = events.shift();
    if (!enabled || !manager) continue;
    const id = event.id >>> 0,
      point = [
        Number(event.phase !== 'up'),
        Math.trunc(event.x * 100) | 0,
        Math.trunc(event.y * 100) | 0,
      ];
    let slot = state.slots.get(id);
    if (event.phase === 'down') {
      if (slot === undefined) {
        const occupied = new Set(state.slots.values());
        slot = 0;
        while (slot < 64 && occupied.has(slot)) slot++;
        if (slot >= 64)
          throw new Error('Unsupported touch contact count exceeds the 64 window slots');
        state.slots.set(id, slot);
        while (manager.points.length <= slot) manager.points.push([0, 0, 0]);
        manager.points[slot] = point;
        if (state.slots.size === 1) activation = true;
      }
    } else if (slot !== undefined) {
      manager.points[slot] = point;
      if (event.phase === 'up') state.slots.delete(id);
    }
    update(manager);
  }
  if (!manager) return { activation, code: 0 };
  for (const item of ordered(manager)) {
    if (item.result) {
      const code = item.result;
      if (code >= 1 && code <= 13) reset(manager);
      return { activation, code };
    }
    if (!item.available) break;
  }
  return { activation, code: 0 };
}
