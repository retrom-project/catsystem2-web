// SPDX-License-Identifier: MPL-2.0
// JS-owned view geometry; the renderer receives a one-way projection.
const f = Math.fround;
const integer = (value) =>
  Number.isFinite(value) && value >= -2147483648 && value < 2147483648
    ? Math.trunc(value) | 0
    : -2147483648;

export class NativeView {
  constructor({
    virtualWidth,
    virtualHeight,
    clientWidth,
    clientHeight,
    deviceOffset = [0, 0],
    deviceScale = 1,
    windowShift = [0, 0],
    active = true,
    drawingRectangle = [0, 0, clientWidth ?? virtualWidth, clientHeight ?? virtualHeight],
    ratios = null,
  } = {}) {
    this.configure({
      virtualWidth,
      virtualHeight,
      clientWidth,
      clientHeight,
      deviceOffset,
      deviceScale,
      windowShift,
      active,
      drawingRectangle,
      ratios,
    });
  }
  configure(values) {
    if (values.active !== undefined) this.active = Boolean(values.active);
    if (values.drawingRectangle !== undefined) {
      if (!Array.isArray(values.drawingRectangle) || values.drawingRectangle.length !== 4)
        throw new TypeError('Invalid native drawing rectangle');
      this.drawingRectangle = values.drawingRectangle.map((n) => n | 0);
    }
    if (values.ratios !== undefined) this.ratios = values.ratios?.map(f) ?? null;
    for (const field of ['virtualWidth', 'virtualHeight', 'clientWidth', 'clientHeight'])
      if (values[field] !== undefined) {
        if (!Number.isInteger(values[field]) || values[field] < 0 || values[field] > 65535)
          throw new RangeError(`Invalid native view ${field}`);
        this[field] = values[field];
      }
    for (const field of ['deviceOffset', 'windowShift'])
      if (values[field] !== undefined) {
        if (
          !Array.isArray(values[field]) ||
          values[field].length !== 2 ||
          values[field].some((v) => !Number.isFinite(v))
        )
          throw new TypeError(`Invalid native view ${field}`);
        this[field] = values[field].map(field === 'windowShift' ? (v) => v | 0 : f);
      }
    if (values.deviceScale !== undefined) {
      if (!Number.isFinite(values.deviceScale))
        throw new TypeError('Invalid native view deviceScale');
      this.deviceScale = f(values.deviceScale);
    }
    this.changed?.();
  }
  virtualSize() {
    return [this.virtualWidth, this.virtualHeight];
  }
  screenToVirtual(x, y) {
    const inverse = f(1 / this.deviceScale),
      ratios = [f(this.virtualWidth / this.clientWidth), f(this.virtualHeight / this.clientHeight)],
      result = [x, y].map((value, i) => {
        const device = integer(f(f(f(value | 0) - this.deviceOffset[i]) * inverse));
        return integer(f(f((device - this.windowShift[i]) | 0) * ratios[i]));
      });
    return {
      x: result[0],
      y: result[1],
      inside:
        result[0] >= 0 &&
        result[0] < this.virtualWidth &&
        result[1] >= 0 &&
        result[1] < this.virtualHeight,
    };
  }
  border() {
    const [x, y] = this.deviceOffset.map((value) => Math.imul(integer(value), 2));
    const result = this.screenToVirtual(x, y);
    return [result.x, result.y];
  }
  snapshot() {
    return structuredClone(
      Object.fromEntries(
        [
          'virtualWidth',
          'virtualHeight',
          'clientWidth',
          'clientHeight',
          'deviceOffset',
          'deviceScale',
          'windowShift',
          'active',
          'drawingRectangle',
          'ratios',
        ].map((key) => [key, this[key]]),
      ),
    );
  }
  restore(state) {
    this.configure(state);
  }
}
