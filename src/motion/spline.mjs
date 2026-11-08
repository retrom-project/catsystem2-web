// SPDX-License-Identifier: MPL-2.0
// Main native 0x140 prepares the five-float records consumed by motSpline*.
// Keep the frozen engine's endpoint formula and float32 temporaries verbatim
// as arithmetic contracts; using a library's cubic spline changes the result.
const bits = new DataView(new ArrayBuffer(4));
const word = (value) => {
  bits.setFloat32(0, value, true);
  return bits.getUint32(0, true);
};
const real = (value) => {
  bits.setUint32(0, value, true);
  return bits.getFloat32(0, true);
};
const nan = (value) => (value & 0x7fffffff) > 0x7f800000;
function binary(a, b, operation) {
  const x = word(a),
    y = word(b);
  if (nan(x)) return real(x | 0x400000);
  if (nan(y)) return real(y | 0x400000);
  const result = Math.fround(operation(a, b));
  return Number.isNaN(result) ? real(0xffc00000) : result;
}
const add = (a, b) => binary(a, b, (x, y) => x + y),
  sub = (a, b) => binary(a, b, (x, y) => x - y);
const mul = (a, b) => binary(a, b, (x, y) => x * y),
  div = (a, b) => binary(a, b, (x, y) => x / y);
const neg = (a) => real(word(a) ^ 0x80000000);

export function prepareMotionSpline(bytes, count) {
  if (
    !(bytes instanceof Uint8Array) ||
    !Number.isInteger(count) ||
    count < 0 ||
    count * 20 > bytes.length
  )
    throw new Error('Invalid MOT spline point buffer/count');
  if (count < 3) return;
  const f = Math.fround,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const get = (i, k) => view.getFloat32(i * 20 + k * 4, true),
    set = (i, k, v) => view.setFloat32(i * 20 + k * 4, v, true);
  const last = count - 1;
  set(0, 4, sub(get(1, 0), get(0, 0)));
  set(1, 3, div(sub(get(1, 1), get(0, 1)), get(0, 4)));
  for (let i = 1; i < last; i++) {
    const h = sub(get(i + 1, 0), get(i, 0));
    set(i, 4, h);
    set(i, 2, mul(add(get(i - 1, 4), h), 2));
    const slope = div(sub(get(i + 1, 1), get(i, 1)), h);
    set(i + 1, 3, slope);
    set(i, 3, sub(slope, get(i, 3)));
  }
  set(0, 2, neg(get(0, 4)));
  set(last, 2, neg(get(last - 1, 4)));
  if (count === 3) {
    set(0, 3, 0);
    set(last, 3, 0);
  } else {
    set(
      0,
      3,
      sub(div(get(2, 3), sub(get(3, 0), get(1, 0))), div(get(1, 3), sub(get(2, 0), get(0, 0)))),
    );
    set(
      last,
      3,
      sub(
        div(get(last - 1, 3), sub(get(last, 0), get(last - 2, 0))),
        div(get(last - 2, 3), sub(get(last - 1, 0), get(last - 3, 0))),
      ),
    );
    set(0, 3, div(mul(f(Math.pow(get(0, 4), 2)), get(0, 3)), sub(get(3, 0), get(1, 0))));
    set(
      last,
      3,
      neg(
        div(
          mul(f(Math.pow(get(last - 1, 4), 2)), get(last, 3)),
          sub(get(last, 0), get(last - 3, 0)),
        ),
      ),
    );
  }
  for (let i = 1; i <= last; i++) {
    const ratio = div(get(i - 1, 4), get(i - 1, 2));
    set(i, 2, sub(get(i, 2), mul(get(i - 1, 4), ratio)));
    set(i, 3, sub(get(i, 3), mul(get(i - 1, 3), ratio)));
  }
  set(last, 3, div(get(last, 3), get(last, 2)));
  for (let i = last - 1; i >= 0; i--)
    set(i, 3, div(sub(get(i, 3), mul(get(i + 1, 3), get(i, 4))), get(i, 2)));
  set(
    last,
    2,
    add(
      div(sub(get(last, 1), get(last - 1, 1)), get(last - 1, 4)),
      mul(add(mul(get(last, 3), 2), get(last - 1, 3)), get(last - 1, 4)),
    ),
  );
  for (let i = 0; i < last; i++) {
    const c = get(i, 3),
      h = get(i, 4),
      next = get(i + 1, 3);
    const b = sub(div(sub(get(i + 1, 1), get(i, 1)), h), mul(add(mul(c, 2), next), h));
    set(i, 3, mul(c, 3));
    set(i, 4, div(sub(next, c), h));
    set(i, 2, b);
  }
  set(last, 4, get(last - 1, 4));
}
