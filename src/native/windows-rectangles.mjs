// SPDX-License-Identifier: MPL-2.0
// USER32 rectangle operations shared by text, image and native control regions.
export function nativeRectangleDefinitions(process) {
  const p = process,
    definitions = new Map(),
    def = (name, count, fn) => definitions.set(name, { count, fn }),
    rect = (at) => Array.from({ length: 4 }, (_, i) => p.load(at + i * 4) | 0),
    empty = (r) => r[0] >= r[2] || r[1] >= r[3],
    putRect = (at, values) => {
      values.forEach((v, i) => p.store(at + i * 4, v));
      return Number(!empty(values));
    };
  def('PtInRect', 3, ([at, x, y]) => {
    const [left, top, right, bottom] = rect(at);
    x |= 0;
    y |= 0;
    return Number(x >= left && x < right && y >= top && y < bottom);
  });
  def('SetRectEmpty', 1, ([out]) => {
    p.zero(out, 16);
    return 1;
  });
  def('SetRect', 5, ([out, ...values]) => {
    putRect(out, values);
    return 1;
  });
  def('CopyRect', 2, ([out, input]) => {
    p.write(out, p.read(input, 16));
    return 1;
  });
  def('IsRectEmpty', 1, ([at]) => Number(empty(rect(at))));
  def('EqualRect', 2, ([a, b]) => Number(rect(a).every((v, i) => v === rect(b)[i])));
  def('IntersectRect', 3, ([out, a, b]) => {
    a = rect(a);
    b = rect(b);
    const result = [
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.min(a[2], b[2]),
      Math.min(a[3], b[3]),
    ];
    return putRect(out, empty(result) ? [0, 0, 0, 0] : result);
  });
  def('UnionRect', 3, ([out, a, b]) => {
    a = rect(a);
    b = rect(b);
    return putRect(
      out,
      empty(a) && empty(b)
        ? [0, 0, 0, 0]
        : empty(a)
          ? b
          : empty(b)
            ? a
            : [
                Math.min(a[0], b[0]),
                Math.min(a[1], b[1]),
                Math.max(a[2], b[2]),
                Math.max(a[3], b[3]),
              ],
    );
  });
  def('OffsetRect', 3, ([out, x, y]) => {
    putRect(
      out,
      rect(out).map((v, i) => (v + (i & 1 ? y : x)) | 0),
    );
    return 1;
  });
  def('InflateRect', 3, ([out, x, y]) => {
    putRect(
      out,
      rect(out).map((v, i) => (v + (i < 2 ? -1 : 1) * (i & 1 ? y | 0 : x | 0)) | 0),
    );
    return 1;
  });
  return definitions;
}
