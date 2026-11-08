// SPDX-License-Identifier: MPL-2.0
// Integer CPU raster loops for the reviewed engine images. The mounted PE
// still dispatches, clips and prepares each descriptor. Its last scanline
// executes unchanged, including the original register/flags epilogue.
const profiles = {
  'nekopara-vol3-engine-2.6.1.76': {
    sha256: 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0',
    normal: 0x689ab0,
    mask: 0x689280,
    copy: 0x687356,
    stosByte: 0x79fc44,
    stosWord: 0x79fc95,
    memcpy: 0x79f2a0,
    alpha: 0x68ce08,
    btype: 0x68a3a0,
    affine: 0x874e03,
    affineBtype: 0x875523,
  },
  'sdk-4.01-engine-2.6.1.74': {
    sha256: '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f',
    normal: 0x55fb90,
    mask: 0x561bd0,
    copy: 0x55df66,
    stosByte: 0x637ea4,
    stosWord: 0x637ef5,
    memcpy: 0x637500,
    alpha: 0x563978,
    btype: 0x560480,
    affine: 0x8a05d3,
    affineBtype: 0x8a0cf3,
  },
};
const overlaps = (a, size, b, length) => a < b + length && b < a + size;

export class NativeRasterKernels {
  constructor(engine) {
    this.engine = engine;
    this.process = engine.process;
    this.abi = profiles[engine.profile];
    if (!this.abi || engine.identity !== this.abi.sha256)
      throw new Error('CPU raster acceleration requires a reviewed mounted engine image');
    this.enabled = true;
    this.hits = {
      normal: 0,
      mask: 0,
      copy: 0,
      stosByte: 0,
      stosWord: 0,
      movs: 0,
      alpha: 0,
      btype: 0,
      affine: 0,
      affineBtype: 0,
    };
    this.detachers = [];
    for (const [kind, bytes] of [
      ['normal', [0x83, 0x7f, 0x10, 0x00, 0x8b, 0xc3]],
      ['mask', [0x33, 0xff, 0x85, 0xc9]],
      ['copy', [0x8b, 0x46, 0x28, 0x0f, 0xaf, 0x46, 0x40]],
      ['stosByte', [0xf3, 0xaa]],
      ['stosWord', [0xf3, 0xab]],
      ['alpha', [0x33, 0xc0, 0x8b, 0xce, 0x85, 0xd2]],
      ['btype', [0x33, 0xdb, 0x89, 0x9d, 0xd0, 0xfe, 0xff, 0xff]],
      ['affine', [0x8b, 0x43, 0x28, 0x0f, 0xaf, 0xc1]],
      ['affineBtype', [0x8b, 0x46, 0x28, 0x0f, 0xaf, 0xc1]],
    ]) {
      const address = this.abi[kind];
      if (!this.process.read(address, bytes.length).every((value, i) => value === bytes[i]))
        throw new Error(`Reviewed ${kind} CPU raster loop differs`);
      this.detachers.push(
        this.process.beforeInstruction(address, `exact CPU ${kind} raster scanlines`, () => {
          if (this.enabled && (kind.startsWith('stos') ? this.stos(kind) : this[kind]()))
            this.hits[kind]++;
        }),
      );
    }
    for (const [offset, width] of [
      [0x2a, 1],
      [0x21e, 4],
      [0x27c, 4],
      [0x2a2, 4],
      [0x2c0, 4],
      [0x3a4, 4],
      [0x3ff, 4],
      [0x429, 4],
      [0x45b, 4],
    ]) {
      const address = this.abi.memcpy + offset,
        bytes = [0xf3, width === 1 ? 0xa4 : 0xa5];
      if (!this.process.read(address, 2).every((value, i) => value === bytes[i]))
        throw new Error('Reviewed CPU memory transfer instruction differs');
      this.detachers.push(
        this.process.beforeInstruction(
          address,
          `exact CPU memory transfer 0x${offset.toString(16)}`,
          () => {
            if (this.enabled && this.movs(address, width)) this.hits.movs++;
          },
        ),
      );
    }
    engine.registerFeature('raster-kernels', this);
  }
  reg(name, value) {
    const p = this.process,
      index = p.uc['X86_REG_' + name];
    if (value === undefined) return p.cpu.reg_read_i32(index) >>> 0;
    p.cpu.reg_write_i32(index, value >>> 0);
  }
  range(address, length, write = false) {
    if (
      !Number.isSafeInteger(address) ||
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      address < 0 ||
      address + length > 0x100000000
    )
      return false;
    if (
      write &&
      [...this.process.writeObservers].some(
        (observer) => address < observer.end && address + length > observer.address,
      )
    )
      return false;
    let cursor = address;
    for (const { begin, end, perms } of this.process.cpu.mem_regions()) {
      const first = Number(begin),
        last = Number(end) + 1;
      if (cursor < first || cursor >= last) continue;
      if (!(perms & 1) || (write && (!(perms & 2) || perms & 4))) return false;
      cursor = Math.min(last, address + length);
      if (cursor === address + length) return true;
    }
    return false;
  }
  raster(pointer, frame, source, destination) {
    const p = this.process;
    if (!this.range(pointer, 128) || !this.range(frame - 0x140, 0x150, true)) return null;
    const descriptor = new Int32Array(p.read(pointer, 128).buffer),
      d = descriptor;
    if (
      d[0] !== 4 ||
      d[10] !== 4 ||
      d[2] <= 0 ||
      d[3] <= 0 ||
      d[12] <= 0 ||
      d[13] <= 0 ||
      d[8] < d[2] * 4 ||
      d[18] < d[12] * 4 ||
      d[16] <= 0 ||
      d[17] < 2 ||
      d[4] < 0 ||
      d[5] < 0 ||
      d[14] < 0 ||
      d[15] < 0 ||
      d[4] + d[16] > d[2] ||
      d[5] + d[17] > d[3] ||
      d[14] + d[16] > d[12] ||
      d[15] + d[17] > d[13]
    )
      return null;
    const destinationBase = d[1] >>> 0,
      sourceBase = d[11] >>> 0,
      destinationSize = d[8] * d[3],
      sourceSize = d[18] * d[13];
    if (
      !this.range(destinationBase, destinationSize, true) ||
      !this.range(sourceBase, sourceSize) ||
      overlaps(destinationBase, destinationSize, sourceBase, sourceSize) ||
      overlaps(destinationBase, destinationSize, pointer, 128) ||
      overlaps(destinationBase, destinationSize, frame - 0x140, 0x150) ||
      overlaps(sourceBase, sourceSize, frame - 0x140, 0x150) ||
      destination !== destinationBase + d[5] * d[8] + d[4] * 4 ||
      source !== sourceBase + (d[20] ? d[13] - d[15] - 1 : d[15]) * d[18] + d[14] * 4
    )
      return null;
    // Acquire after all validation allocations. A WASM grow invalidates an
    // older typed view; these two views are only used synchronously.
    p.view(sourceBase, sourceSize);
    p.view(destinationBase, destinationSize);
    return {
      descriptor,
      input: p.view(sourceBase, sourceSize),
      output: p.view(destinationBase, destinationSize),
      source: source - sourceBase,
      destination: destination - destinationBase,
      sourceStep: d[20] ? -d[18] : d[18],
      destinationStep: d[8],
    };
  }
  normal() {
    const p = this.process,
      frame = this.reg('EBP'),
      pointer = this.reg('EDI');
    if (p.load(frame - 0x120) !== 0) return false;
    const table = p.read(frame - 0x104, 256);
    const raster = this.raster(pointer, frame, this.reg('EBX'), this.reg('ESI'));
    if (!raster) return false;
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      count = d[16],
      rows = d[17] - 1;
    let s = raster.source,
      t = raster.destination,
      lastOnly,
      lastTotal;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep) {
      // This transparent RGB padding is an observable original-engine quirk.
      if (d[4] > 0 && !(output[t - 4] | output[t - 3] | output[t - 2] | output[t - 1])) {
        output[t - 4] = input[s];
        output[t - 3] = input[s + 1];
        output[t - 2] = input[s + 2];
      }
      for (let x = 0, a = s, b = t; x < count; x++, a += 4, b += 4) {
        const alpha = table[input[a + 3]],
          oldAlpha = output[b + 3];
        if (
          alpha === 255 ||
          (alpha && !oldAlpha) ||
          (!alpha && !(output[b] | output[b + 1] | output[b + 2] | oldAlpha))
        ) {
          output[b] = input[a];
          output[b + 1] = input[a + 1];
          output[b + 2] = input[a + 2];
          output[b + 3] = alpha;
        } else if (alpha && oldAlpha === 255) {
          for (let c = 0; c < 3; c++)
            output[b + c] += ((input[a + c] - output[b + c]) * alpha) >> 8;
        } else if (alpha) {
          const overlap = (alpha * oldAlpha) >> 8,
            only = ((256 - alpha) * oldAlpha) >> 8,
            weight = (((256 - oldAlpha) * alpha) >> 8) + overlap,
            total = (only + weight) | 1,
            reciprocal = Math.floor(65536 / total);
          for (let c = 0; c < 3; c++)
            output[b + c] =
              (Math.imul(input[a + c] * weight + output[b + c] * only, reciprocal) >>> 16) & 255;
          output[b + 3] = total;
          lastOnly = only;
          lastTotal = total;
        }
      }
      const end = t + count * 4,
        last = s + (count - 1) * 4;
      if (
        d[4] + count < d[2] &&
        !(output[end] | output[end + 1] | output[end + 2] | output[end + 3])
      ) {
        output[end] = input[last];
        output[end + 1] = input[last + 1];
        output[end + 2] = input[last + 2];
      }
    }
    if (lastOnly !== undefined) {
      p.store(frame - 0x130, lastOnly);
      p.store(frame - 0x134, lastTotal);
    }
    const source = (d[11] >>> 0) + s,
      destination = (d[1] >>> 0) + t;
    p.store(frame - 0x120, rows);
    p.store(frame - 0x118, source);
    p.store(frame - 0x11c, destination);
    this.reg('EDX', rows);
    this.reg('EBX', source);
    this.reg('ESI', destination);
    return true;
  }
  mask() {
    const p = this.process,
      frame = this.reg('EBP'),
      pointer = this.reg('ESI'),
      channel = p.load(pointer + 92) - 1;
    if (p.load(frame - 4) !== 0 || channel < 0 || channel > 3) return false;
    const raster = this.raster(pointer, frame, this.reg('EDX') - channel, this.reg('EAX') - 3);
    if (!raster) return false;
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      rows = d[17] - 1;
    let s = raster.source,
      t = raster.destination;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep)
      for (let x = 0, a = s + channel, b = t + 3; x < d[16]; x++, a += 4, b += 4)
        output[b] = (((output[b] + 1) * (input[a] + 1) - 1) & 65535) >>> 8;
    const source = (d[11] >>> 0) + s + channel,
      destination = (d[1] >>> 0) + t + 3;
    p.store(frame - 4, rows);
    p.store(frame - 12, source);
    p.store(frame + 8, destination);
    this.reg('EBX', rows);
    this.reg('EDX', source);
    this.reg('EAX', destination);
    this.reg('ECX', d[16]);
    return true;
  }
  copy() {
    const p = this.process,
      frame = this.reg('EBP'),
      pointer = this.reg('ESI');
    if (p.load(frame + 8) !== 0) return false;
    const raster = this.raster(pointer, frame, this.reg('EDI'), this.reg('EBX'));
    if (!raster) return false;
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      rows = d[17] - 1;
    let s = raster.source,
      t = raster.destination;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep)
      output.set(input.subarray(s, s + d[16] * 4), t);
    p.store(frame + 8, rows);
    this.reg('EDI', (d[11] >>> 0) + s);
    this.reg('EBX', (d[1] >>> 0) + t);
    return true;
  }
  stos(kind) {
    const count = this.reg('ECX'),
      width = kind === 'stosByte' ? 1 : 4,
      step = this.reg('EFLAGS') & 0x400 ? -width : width,
      current = this.reg('EDI'),
      start = step < 0 ? current - (count - 1) * width : current,
      size = count * width;
    // ES is flat in the reviewed process. Unusual segments, wrapped ranges
    // and protected/executable destinations retain original CPU execution.
    if (!count || this.reg('ES') !== 0 || !this.range(start, size, true)) return false;
    const bytes = this.process.view(start, size),
      value = this.reg('EAX');
    if (width === 1) bytes.fill(value & 255);
    else if (bytes.byteOffset % 4 === 0)
      new Uint32Array(bytes.buffer, bytes.byteOffset, count).fill(value);
    else {
      const view = new DataView(bytes.buffer, bytes.byteOffset, size);
      for (let i = 0; i < count; i++) view.setUint32(i * 4, value, true);
    }
    this.reg('ECX', 0);
    this.reg('EDI', current + step * count);
    this.reg('EIP', this.abi[kind] + 2);
    return true;
  }
  movs(address, width) {
    const count = this.reg('ECX'),
      source = this.reg('ESI'),
      destination = this.reg('EDI'),
      step = this.reg('EFLAGS') & 0x400 ? -width : width,
      firstSource = step < 0 ? source - (count - 1) * width : source,
      firstDestination = step < 0 ? destination - (count - 1) * width : destination,
      size = count * width;
    if (
      !count ||
      this.reg('ES') !== 0 ||
      this.reg('DS') !== 0 ||
      !this.range(firstSource, size) ||
      !this.range(firstDestination, size, true) ||
      (source !== destination && overlaps(firstSource, size, firstDestination, size))
    )
      return false;
    const p = this.process;
    p.view(firstSource, size);
    p.view(firstDestination, size);
    p.view(firstDestination, size).set(p.view(firstSource, size));
    this.reg('ECX', 0);
    this.reg('ESI', source + step * count);
    this.reg('EDI', destination + step * count);
    this.reg('EIP', address + 2);
    return true;
  }
  alpha() {
    const p = this.process,
      owner = this.reg('EBX'),
      width = this.reg('EDX'),
      height = this.reg('EBP');
    if (this.reg('EDI') !== 0 || !width || !height || !this.range(owner, 48)) return false;
    const data = p.load(owner + 12),
      stride = p.load(owner + 20),
      size = stride * height;
    if (
      p.load(owner + 24) !== 4 ||
      p.load(owner + 4) !== width ||
      p.load(owner + 8) !== height ||
      this.reg('ESI') !== data + 3 ||
      stride < width * 4 ||
      !this.range(data, size)
    )
      return false;
    const bytes = p.view(data, size);
    let y = 0,
      x = 0;
    outer: for (; y < height; y++)
      for (x = 0; x < width; x++) if (bytes[y * stride + x * 4 + 3] !== 255) break outer;
    if (y === height) {
      y = height - 1;
      x = width - 1;
    }
    this.reg('EDI', y);
    this.reg('ESI', data + y * stride + 3);
    this.reg('EAX', x);
    this.reg('ECX', data + y * stride + x * 4 + 3);
    this.reg('EIP', this.abi.alpha + 8);
    return true;
  }
  btype() {
    const p = this.process,
      frame = this.reg('EBP'),
      pointer = this.reg('EDX');
    if (p.load(frame - 0x128) !== 0) return false;
    const table = p.read(frame - 0x104, 256),
      raster = this.raster(pointer, frame, this.reg('ESI'), this.reg('EDI'));
    if (!raster) return false;
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      mode = d[28],
      rows = d[17] - 1;
    if (mode < 1 || mode > 5) return false;
    let s = raster.source,
      t = raster.destination,
      lastColors,
      lastTotal,
      lastOverlap;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep)
      for (let x = 0, a = s, b = t; x < d[16]; x++, a += 4, b += 4) {
        const alpha = table[input[a + 3]],
          oldAlpha = output[b + 3];
        if (!alpha) {
          if (!oldAlpha) {
            output[b] = input[a];
            output[b + 1] = input[a + 1];
            output[b + 2] = input[a + 2];
            output[b + 3] = 0;
          }
          continue;
        }
        const overlap = (alpha * oldAlpha) >> 8,
          sourceOnly = (alpha * (256 - oldAlpha)) >> 8,
          destinationOnly = (oldAlpha * (256 - alpha)) >> 8,
          total = (overlap + sourceOnly + destinationOnly) | 1,
          reciprocal = Math.floor(65536 / total),
          colors = [];
        for (let c = 0; c < 3; c++) {
          const sourceChannel = input[a + c],
            destinationChannel = output[b + c];
          let color;
          if (mode === 1) color = Math.min(255, sourceChannel + destinationChannel);
          else if (mode === 2) color = (destinationChannel * (sourceChannel + 1)) >> 8;
          else if (mode === 3)
            color =
              destinationChannel +
              sourceChannel -
              ((destinationChannel * (sourceChannel + 1)) >> 8);
          else if (mode === 4)
            color =
              destinationChannel < 128
                ? Math.trunc((2 * sourceChannel * destinationChannel) / 255)
                : 2 *
                    (destinationChannel +
                      sourceChannel -
                      Math.trunc((destinationChannel * sourceChannel) / 255)) -
                  255;
          else
            color =
              destinationChannel === 255
                ? 255
                : Math.min(255, Math.trunc((255 * sourceChannel) / (255 - destinationChannel)));
          colors[c] = color;
          output[b + c] =
            (Math.imul(
              reciprocal,
              color * overlap + sourceOnly * sourceChannel + destinationOnly * destinationChannel,
            ) >>>
              16) &
            255;
        }
        output[b + 3] = total;
        lastColors = colors;
        lastTotal = total;
        lastOverlap = overlap;
      }
    if (lastColors) {
      [0x10c, 0x114, 0x110].forEach((offset, c) => p.store(frame - offset, lastColors[c]));
      p.store(frame - 0x12c, lastTotal);
      p.store(frame - 0x124, lastOverlap);
    }
    const source = (d[11] >>> 0) + s,
      destination = (d[1] >>> 0) + t;
    p.store(frame - 0x128, rows);
    p.store(frame - 0x120, source);
    p.store(frame - 0x11c, destination);
    this.reg('EAX', rows);
    this.reg('ESI', source);
    this.reg('EDI', destination);
    return true;
  }
  affineBtype() {
    return this.affine(true);
  }
  affine(blendType = false) {
    const layout = blendType
      ? {
          pointer: 'ESI',
          position: [0x164, 0x17c],
          row: 0x140,
          rowFixed: 0x150,
          temporary: 0x144,
          transformed: 0x118,
          spill: 0x1b8,
          corners: [0x120, 0x11c, 0x128, 0x12c],
          alphas: [
            [0x160, 0],
            [0x178, 1],
            [0x148, 2],
            [0x170, 3],
          ],
          word: 0x124,
          channels: [0x144, 0x110, 0x10c],
          weight: 0x118,
        }
      : {
          pointer: 'EBX',
          position: [0x15c, 0x154],
          row: 0x130,
          rowFixed: 0x138,
          temporary: 0x108,
          transformed: 0x128,
          spill: 0x1a4,
          corners: [0x11c, 0x120, 0x114, 0x118],
          alphas: [
            [0x164, 1],
            [0x13c, 3],
            [0x140, 2],
          ],
          word: 0x10c,
          channels: [0x12c, 0x134, 0x108],
          weight: 0x128,
        };
    const p = this.process,
      frame = this.reg('EBP'),
      pointer = this.reg(layout.pointer);
    if (!this.range(pointer, 200) || !this.range(frame - 0x1c0, 0x1d0, true)) return false;
    const d = new Int32Array(p.read(pointer, 200).buffer),
      table = p.read(frame - 0x104, 256),
      left = d[32],
      top = d[33],
      right = d[34],
      bottom = d[35],
      dw = d[2],
      dh = d[3],
      sw = d[14],
      sh = d[15],
      ds = d[10],
      ss = d[16],
      destination = d[1] >>> 0,
      source = d[13] >>> 0,
      destinationSize = ds * dh,
      sourceSize = ss * sh;
    if (
      this.reg('ECX') !== top ||
      bottom - top < 2 ||
      left < 0 ||
      top < 0 ||
      right > dw ||
      bottom > dh ||
      left >= right ||
      d[0] !== 4 ||
      d[12] !== 4 ||
      sw <= 0 ||
      sh <= 0 ||
      ds < dw * 4 ||
      ss < sw * 4 ||
      !this.range(destination, destinationSize, true) ||
      !this.range(source, sourceSize) ||
      overlaps(destination, destinationSize, source, sourceSize) ||
      overlaps(destination, destinationSize, pointer, 200) ||
      overlaps(destination, destinationSize, frame - 0x1c0, 0x1d0) ||
      overlaps(source, sourceSize, frame - 0x1c0, 0x1d0) ||
      (blendType && (d[31] < 1 || d[31] > 5)) ||
      [36, 37, 39, 40].some((i) => Math.abs(d[i]) > 0x3fffff)
    )
      return false;
    const dv = new DataView(d.buffer),
      baseX = Math.trunc(dv.getFloat32(104, true)),
      baseY = Math.trunc(dv.getFloat32(108, true));
    if (
      !Number.isFinite(baseX) ||
      !Number.isFinite(baseY) ||
      Math.abs(baseX) > 0x7fffffff ||
      Math.abs(baseY) > 0x7fffffff
    )
      return false;
    const px = p.load(frame - layout.position[0]) | 0,
      py = p.load(frame - layout.position[1]) | 0,
      alphaSpill = blendType ? p.load(frame - 0x138) & 0xffffff : 0;
    p.view(source, sourceSize);
    p.view(destination, destinationSize);
    const input = p.view(source, sourceSize),
      output = p.view(destination, destinationSize),
      words = new DataView(input.buffer, input.byteOffset, input.byteLength),
      locals = new Map(),
      multiply = (a, b) => Math.floor((a * b) / 32768) | 0;
    for (let y = top; y < bottom - 1; y++)
      for (let x = left; x < right; x++) {
        const cx = ((x << 15) - px + d[45]) | 0,
          cy = ((y << 15) - py + d[46]) | 0,
          u = (multiply(d[36], cx) + multiply(d[39], cy) + d[42]) | 0,
          v = (multiply(d[37], cx) + multiply(d[40], cy) + d[43]) | 0,
          ix = ((u >> 15) + baseX) | 0,
          iy = ((v >> 15) + baseY) | 0;
        locals.set(layout.temporary, blendType ? cx : cy);
        locals.set(layout.transformed, v);
        if (ix >>> 0 >= sw || iy >>> 0 >= sh) continue;
        // The sampler saves EDI only for an in-range source. Its otherwise
        // untouched spill remains observable in a complete raw stack capture.
        locals.set(layout.spill, v);
        const a = iy * ss + ix * 4,
          b = ix < sw - 1 ? a + 4 : a,
          c = iy < sh - 1 ? a + ss : a,
          e = ix < sw - 1 && iy < sh - 1 ? a + ss + 4 : a,
          samples = [a, b, c, e],
          corners = samples.map((at) => words.getUint32(at, true)),
          alpha0 = input[a + 3],
          alpha1 = input[b + 3],
          alpha2 = input[c + 3],
          alpha3 = input[e + 3];
        layout.corners.forEach((offset, i) => locals.set(offset, corners[i]));
        const alphas = [alpha0, alpha1, alpha2, alpha3];
        for (const [offset, i] of layout.alphas) locals.set(offset, alphas[i]);
        locals.set(layout.word, 0);
        if (!(alpha0 + alpha1 + alpha2 + alpha3)) continue;
        const fx = u & 32767,
          fy = v & 32767,
          weights = [
            ((32768 - fx) * (32768 - fy)) >> 15,
            (fx * (32768 - fy)) >> 15,
            ((32768 - fx) * fy) >> 15,
            (fx * fy) >> 15,
          ],
          sample = [0, 0, 0, 0];
        for (let channel = 0; channel < 4; channel++)
          sample[channel] =
            (input[a + channel] * weights[0] +
              input[b + channel] * weights[1] +
              input[c + channel] * weights[2] +
              input[e + channel] * weights[3]) >>>
            15;
        const alpha = table[sample[3] & 255],
          at = y * ds + x * 4,
          oldAlpha = output[at + 3];
        locals.set(layout.weight, weights[3]);
        layout.channels.forEach((offset, i) => locals.set(offset, sample[i]));
        locals.set(
          layout.word,
          (sample[0] | (sample[1] << 8) | (sample[2] << 16) | (alpha << 24)) >>> 0,
        );
        if (blendType) {
          locals.set(0x138, alphaSpill | (alpha << 24));
          if (alpha) {
            const overlap = alpha * oldAlpha,
              sourceOnly = alpha * (256 - oldAlpha),
              destinationOnly = oldAlpha * (256 - alpha),
              total = (overlap + sourceOnly + destinationOnly) >>> 8,
              reciprocal = Math.floor(65536 / total);
            for (let channel = 0; channel < 3; channel++) {
              const s = sample[channel],
                t = output[at + channel],
                mode = d[31];
              let color;
              if (mode === 1) color = Math.min(255, s + t);
              else if (mode === 2) color = (s * (t + 1)) >> 8;
              else if (mode === 3) color = s + t - ((s * (t + 1)) >> 8);
              else if (mode === 4)
                color =
                  t < 128
                    ? Math.trunc((2 * s * t) / 255)
                    : 2 * (s + t - Math.trunc((s * t) / 255)) - 255;
              else color = t === 255 ? 255 : Math.min(255, Math.trunc((255 * s) / (255 - t)));
              locals.set([0x134, 0x130, 0x13c][channel], color);
              output[at + channel] =
                (Math.imul(reciprocal, color * overlap + s * sourceOnly + t * destinationOnly) >>>
                  24) &
                255;
            }
            locals.set(0x118, overlap);
            locals.set(0x148, total);
            output[at + 3] = total;
          } else if (!oldAlpha) {
            output[at] = sample[0];
            output[at + 1] = sample[1];
            output[at + 2] = sample[2];
            output[at + 3] = 0;
          }
        } else if (alpha === 255 || !oldAlpha) {
          output[at] = sample[0];
          output[at + 1] = sample[1];
          output[at + 2] = sample[2];
          output[at + 3] = alpha;
        } else if (alpha && oldAlpha === 255) {
          for (let channel = 0; channel < 3; channel++)
            output[at + channel] += Math.imul(sample[channel] - output[at + channel], alpha) >> 8;
        } else if (alpha) {
          const overlap = (alpha * oldAlpha) >> 8,
            only = ((256 - alpha) * oldAlpha) >> 8,
            weight = (((256 - oldAlpha) * alpha) >> 8) + overlap,
            total = (only + weight) | 1,
            reciprocal = Math.floor(65536 / total);
          for (let channel = 0; channel < 3; channel++)
            output[at + channel] =
              (Math.imul(sample[channel] * weight + output[at + channel] * only, reciprocal) >>>
                16) &
              255;
          output[at + 3] = total;
          locals.set(0x140, only);
          locals.set(0x13c, total);
        }
      }
    for (const [offset, value] of locals) p.store(frame - offset, value);
    const row = bottom - 1;
    p.store(frame - layout.row, row);
    p.store(frame - layout.rowFixed, row << 15);
    this.reg('ECX', row);
    this.reg('EDX', row << 15);
    return true;
  }
  snapshot() {
    return {};
  }
  restore() {}
  close() {
    for (const detach of this.detachers.splice(0)) detach();
  }
}

export function installNativeRasterKernels(engine) {
  return engine.features.get('raster-kernels') ?? new NativeRasterKernels(engine);
}
