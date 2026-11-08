// SPDX-License-Identifier: MPL-2.0
// kc2DDivModel clips in source texture coordinates before its own transform.
const f = Math.fround;
const sign = (n) => (n > 0 ? 1 : n >= 0 ? 0 : -1);
const cross = (a, b, c) => f(f(f(c.y - a.y) * f(b.x - a.x)) - f(f(c.x - a.x) * f(b.y - a.y)));
function sameSide(a, b, c, d) {
  const y = f(a.y - b.y),
    x = f(a.x - b.x);
  const side = (p) => f(f(f(p.y - a.y) * x) + f(f(a.x - p.x) * y));
  return sign(f(side(c) * side(d)));
}
function inside(triangle, point) {
  const [a, b, c] = triangle;
  if (f(f(a.y - b.y) * f(a.x - c.x)) === f(f(a.y - c.y) * f(a.x - b.x))) return false;
  return (
    sameSide(a, b, point, c) >= 0 && sameSide(a, c, point, b) >= 0 && sameSide(b, c, point, a) >= 0
  );
}
function intersection(a, b, c, d) {
  const y1 = f(a.y - b.y),
    x1 = f(b.x - a.x),
    y2 = f(c.y - d.y),
    x2 = f(d.x - c.x),
    denominator = f(f(x2 * y1) - f(x1 * y2));
  if (denominator === 0) return null;
  const k2 = f(f(c.x * d.y) - f(d.x * c.y)),
    k1 = f(f(a.x * b.y) - f(b.x * a.y));
  const point = {
    x: f(f(f(k2 * x1) - f(k1 * x2)) / denominator),
    y: f(f(f(k2 * y1) - f(k1 * y2)) / f(f(x1 * y2) - f(x2 * y1))),
  };
  return sign(cross(a, b, c)) !== sign(cross(a, b, d)) &&
    sign(cross(c, d, a)) !== sign(cross(c, d, b))
    ? point
    : null;
}
function sortAngles(rows, left = 0, right = rows.length - 1) {
  while (left < right) {
    const pivotIndex = Math.trunc((left + right) / 2),
      pivot = rows[pivotIndex];
    rows[pivotIndex] = rows[left];
    let end = left;
    for (let at = left + 1; at <= right; at++)
      if (rows[at].angle > pivot.angle) {
        end++;
        [rows[end], rows[at]] = [rows[at], rows[end]];
      }
    rows[left] = rows[end];
    rows[end] = pivot;
    sortAngles(rows, left, end - 1);
    left = end + 1;
  }
}
export function clipNativeTriangle(triangle, rectangle) {
  const [left, top, right, bottom] = rectangle,
    corners = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    halves = [
      [corners[0], corners[1], corners[2]],
      [corners[0], corners[2], corners[3]],
    ],
    points = [];
  const append = (point) => {
    if (!points.some((p) => p.x === point.x && p.y === point.y)) points.push(point);
  };
  for (const point of triangle)
    if (halves.some((half) => inside(half, point))) points.push({ x: point.x, y: point.y });
  for (const point of corners) if (inside(triangle, point)) append(point);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++) {
      const point = intersection(
        triangle[i],
        triangle[(i + 1) % 3],
        corners[j],
        corners[(j + 1) % 4],
      );
      if (point) append(point);
    }
  if (!points.length) return points;
  let first = 0;
  for (let i = 1; i < points.length; i++)
    if (
      points[i].x < points[first].x ||
      (points[i].x === points[first].x && points[i].y < points[first].y)
    )
      first = i;
  [points[0], points[first]] = [points[first], points[0]];
  const origin = points[0],
    rows = points.slice(1).map((point) => {
      let angle = f(f(Math.atan2(f(point.x - origin.x), f(point.y - origin.y))) + f(Math.PI));
      if (angle < 0) angle = f(angle + f(2 * Math.PI));
      return { point, angle };
    });
  sortAngles(rows);
  return [origin, ...rows.map(({ point }) => point)];
}
export function nativeDivisionLayout(pageSize, grid, guardBand = [-1, -1, 1, 1]) {
  const half = guardBand[0] >= -1 || guardBand[1] >= -1 || guardBand[2] <= 1 || guardBand[3] <= 1,
    cellSize = pageSize.map((n) => (half ? n >>> 1 : n));
  if (cellSize.some((n) => !n)) throw new RangeError('Native graph division has a zero-sized cell');
  return {
    pageSize: [...pageSize],
    cellSize,
    cells: grid.map((n, i) => n * Math.trunc(pageSize[i] / cellSize[i])),
  };
}
export function divideNativeTriangles(triangles, layout, position = [0, 0, 0]) {
  const {
      pageSize: [pw, ph],
      cellSize: [cw, ch],
      cells: [columns, rows],
    } = layout,
    ratio = Math.trunc(pw / cw),
    pageColumns = Math.trunc(columns / ratio),
    result = [];
  for (const [id, triangle] of triangles.entries()) {
    const minX = Math.trunc(Math.min(...triangle.map((v) => v.x))),
      minY = Math.trunc(Math.min(...triangle.map((v) => v.y))),
      maxX = Math.trunc(Math.max(...triangle.map((v) => v.x))),
      maxY = Math.trunc(Math.max(...triangle.map((v) => v.y)));
    for (let row = 0; row < rows; row++) {
      if (
        Math.max(0, minX) >= Math.min(columns * cw, maxX) ||
        Math.max(row * ch, minY) >= Math.min((row + 1) * ch, maxY)
      )
        continue;
      for (let column = 0; column < columns; column++) {
        if (
          Math.max(column * cw, minX) >= Math.min((column + 1) * cw, maxX) ||
          Math.max(0, minY) >= Math.min(rows * ch, maxY)
        )
          continue;
        const textureID = Math.trunc(column / ratio) + pageColumns * Math.trunc(row / ratio),
          points = clipNativeTriangle(triangle, [
            f(column * cw),
            f(row * ch),
            f((column + 1) * cw),
            f((row + 1) * ch),
          ]),
          xPage = textureID % pageColumns,
          yPage = Math.trunc(textureID / pageColumns);
        for (let i = 1; i < points.length - 1; i++)
          result.push({
            id,
            textureID,
            vertices: [points[0], points[i], points[i + 1]].map((point) => ({
              x: f(point.x - position[0]),
              y: f(point.y - position[1]),
              z: 0,
              color: triangle[0].color,
              u: f(f(point.x - f(xPage * pw)) / f(pw)),
              v: f(f(point.y - f(yPage * ph)) / f(ph)),
            })),
          });
      }
    }
  }
  return result;
}
