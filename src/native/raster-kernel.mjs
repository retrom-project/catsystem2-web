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
    copyWrapper: 0x6a7210,
    copyGetCaps: 0x5c50b0,
    copyCaps: 0xb8f04c,
    copyMMX: 0x444,
    copyCRTFlags: 0xb925e8,
    copyCRTAlignedSIMD: 0xb2acf0,
    stosByte: 0x79fc44,
    stosWord: 0x79fc95,
    memcpy: 0x79f2a0,
    alpha: 0x68ce08,
    btype: 0x68a3a0,
    affine: 0x874e03,
    affineSampler: 0x874120,
    affineMultiply: 0x7a02e0,
    affineBtype: 0x875523,
  },
  'sdk-4.01-engine-2.6.1.74': {
    sha256: '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f',
    normal: 0x55fb90,
    mask: 0x561bd0,
    copy: 0x55df66,
    copyWrapper: 0x576df0,
    copyGetCaps: 0x4a1cb0,
    copyCaps: 0xc93b6c,
    copyMMX: 0x244,
    copyCRTFlags: 0xc96f78,
    copyCRTAlignedSIMD: 0xc35df0,
    stosByte: 0x637ea4,
    stosWord: 0x637ef5,
    memcpy: 0x637500,
    alpha: 0x563978,
    btype: 0x560480,
    affine: 0x8a05d3,
    affineSampler: 0x89f920,
    affineMultiply: 0x638da0,
    affineBtype: 0x8a0cf3,
  },
};
const overlaps = (a, size, b, length) => a < b + length && b < a + size;
const fixedMultiply = (a, b) => Math.floor((a * b) / 32768) | 0;

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
  range(address, length, write = false, regions) {
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
    for (const { begin, end, perms } of regions ?? this.process.cpu.mem_regions()) {
      const first = Number(begin),
        last = Number(end) + 1;
      if (cursor < first || cursor >= last) continue;
      if (!(perms & 1) || (write && (!(perms & 2) || perms & 4))) return false;
      cursor = Math.min(last, address + length);
      if (cursor === address + length) return true;
    }
    return false;
  }
  raster(pointer, frame, source, destination, descriptor, regions) {
    const p = this.process;
    if (
      !this.range(pointer, 128, false, regions) ||
      !this.range(frame - 0x140, 0x150, true, regions)
    )
      return null;
    const d = descriptor ?? new Int32Array(p.read(pointer, 128).buffer);
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
      !this.range(destinationBase, destinationSize, true, regions) ||
      !this.range(sourceBase, sourceSize, false, regions) ||
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
      descriptor: d,
      input: p.view(sourceBase, sourceSize),
      output: p.view(destinationBase, destinationSize),
      source: source - sourceBase,
      destination: destination - destinationBase,
      sourceStep: d[20] ? -d[18] : d[18],
      destinationStep: d[8],
    };
  }
  normalInstructions(raster, destination, table, available) {
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      width = d[16],
      height = d[17],
      left = d[4] > 0,
      right = d[4] + width < d[2];
    let s = raster.source,
      t = raster.destination,
      total = 0,
      row,
      unchanged = true;
    for (let y = 0; y < height; y++, s += sourceStep, t += destinationStep) {
      row = 0;
      for (let x = 0, a = s + 3, b = t + 3; x < width; x++, a += 4, b += 4) {
        const alpha = table[input[a]];
        if (alpha === 255) row += 20;
        else if (!alpha) row += destination.getUint32(b - 3, true) ? 18 : 20;
        else {
          const destinationAlpha = output[b];
          row += !destinationAlpha ? 26 : destinationAlpha === 255 ? 45 : 77;
        }
      }
      // Eighteen instructions are unique to a pixel left unchanged by
      // zero source alpha. The transparent padding still runs on that row.
      if (y < height - 1 && row !== 18 * width) unchanged = false;
      row += 27;
      if (left) row += destination.getUint32(t - 4, true) ? 6 : 8;
      if (right) row += destination.getUint32(t + width * 4, true) ? 8 : 10;
      total += row;
      if (total > available) return null;
    }
    // The original tail scanline runs in full and restores its register and
    // local state. Its first instruction is the one counted at this hook.
    return { skipped: total - row, unchanged };
  }
  normal() {
    const p = this.process,
      frame = this.reg('EBP'),
      regions = this.repeatRegions();
    if (!this.range(frame - 0x120, 4, false, regions) || p.load(frame - 0x120) !== 0) return false;
    const pointer = this.reg('EDI'),
      sourceRow = this.reg('EBX'),
      destinationRow = this.reg('ESI');
    if (
      this.reg('ESP') !== frame - 0x140 ||
      this.reg('EFLAGS') & 0x50100 ||
      !p.hasFlatDataSegments('DS', 'SS') ||
      !this.range(frame - 0x12c, 0x128, false, regions) ||
      !this.range(pointer, 128, false, regions) ||
      overlaps(pointer, 128, frame - 0x134, 0x134)
    )
      return false;
    const locals = p.read(frame - 0x12c, 0x128),
      view = new DataView(locals.buffer),
      local = (offset) => view.getUint32(0x12c - offset, true),
      table = locals.subarray(0x28),
      descriptor = new Int32Array(p.read(pointer, 128).buffer),
      contiguous = (address, size) =>
        p.regions.some(
          (region) => address >= region.address && address + size <= region.address + region.size,
        );
    if (
      local(0x128) !== pointer ||
      local(0x118) !== sourceRow ||
      local(0x11c) !== destinationRow ||
      local(0x12c) !== descriptor[8] >>> 0 ||
      local(0x124) !== (descriptor[20] ? -descriptor[18] : descriptor[18]) >>> 0 ||
      !contiguous(descriptor[1] >>> 0, descriptor[8] * descriptor[3]) ||
      !contiguous(descriptor[11] >>> 0, descriptor[18] * descriptor[13])
    )
      return false;
    const { active, counter, limit } = p.instructionBudget(),
      available = limit === 0n ? Infinity : Number(limit - counter) + 1;
    if (!active || available < descriptor[17] * (27 + 18 * descriptor[16])) return false;
    const raster = this.raster(pointer, frame, sourceRow, destinationRow, descriptor, regions);
    if (!raster) return false;
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      count = d[16],
      rows = d[17] - 1,
      sourcePixels = new DataView(input.buffer, input.byteOffset, input.byteLength),
      destinationPixels = new DataView(output.buffer, output.byteOffset, output.byteLength),
      instructions = this.normalInstructions(raster, destinationPixels, table, available);
    if (!instructions || !p.consumeInstructions(instructions.skipped)) return false;
    const blendWidth = instructions.unchanged ? 0 : count;
    let s = raster.source,
      t = raster.destination,
      lastOnly,
      lastTotal;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep) {
      // This transparent RGB padding is an observable original-engine quirk.
      if (d[4] > 0 && !destinationPixels.getUint32(t - 4, true))
        destinationPixels.setUint32(t - 4, sourcePixels.getUint32(s, true) & 0xffffff, true);
      for (let x = 0, a = s, b = t; x < blendWidth; x++, a += 4, b += 4) {
        const color = sourcePixels.getUint32(a, true),
          alpha = table[color >>> 24];
        if (alpha === 255) {
          destinationPixels.setUint32(b, color | 0xff000000, true);
          continue;
        }
        const previous = destinationPixels.getUint32(b, true),
          oldAlpha = previous >>> 24;
        if (!alpha && previous) continue;
        if (!oldAlpha) {
          destinationPixels.setUint32(b, (color & 0xffffff) | (alpha << 24), true);
        } else if (oldAlpha === 255) {
          const inverse = 256 - alpha;
          // The red and blue 16-bit products cannot carry into one another.
          const redBlue =
              ((Math.imul(color & 0xff00ff, alpha) + Math.imul(previous & 0xff00ff, inverse)) >>>
                8) &
              0xff00ff,
            green =
              ((Math.imul(color & 0xff00, alpha) + Math.imul(previous & 0xff00, inverse)) >>> 8) &
              0xff00;
          destinationPixels.setUint32(b, 0xff000000 | redBlue | green, true);
        } else {
          const overlap = (alpha * oldAlpha) >> 8,
            only = ((256 - alpha) * oldAlpha) >> 8,
            weight = (((256 - oldAlpha) * alpha) >> 8) + overlap,
            total = (only + weight) | 1,
            reciprocal = Math.floor(65536 / total);
          let result = total << 24;
          for (let shift = 0; shift < 24; shift += 8) {
            const from = (color >>> shift) & 255,
              to = (previous >>> shift) & 255;
            result |= ((Math.imul(from * weight + to * only, reciprocal) >>> 16) & 255) << shift;
          }
          destinationPixels.setUint32(b, result, true);
          lastOnly = only;
          lastTotal = total;
        }
      }
      const end = t + count * 4;
      if (d[4] + count < d[2] && !destinationPixels.getUint32(end, true))
        destinationPixels.setUint32(
          end,
          sourcePixels.getUint32(s + (count - 1) * 4, true) & 0xffffff,
          true,
        );
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
      regions = this.repeatRegions();
    if (!this.range(frame - 16, 28, false, regions)) return false;
    const locals = new DataView(p.read(frame - 16, 28).buffer),
      local = (offset) => locals.getUint32(offset + 16, true);
    if (
      local(-4) !== 0 ||
      this.reg('EFLAGS') & 0x10100 ||
      !this.range(pointer, 128, false, regions) ||
      overlaps(pointer, 128, frame - 16, 28)
    )
      return false;
    const d = new Int32Array(p.read(pointer, 128).buffer),
      count = d[16],
      rows = d[17] - 1,
      channel = d[23] - 1,
      sourceRow = this.reg('EDX'),
      destinationRow = this.reg('EAX');
    if (
      count < 1 ||
      rows < 1 ||
      channel < 0 ||
      channel > 3 ||
      this.reg('ECX') !== count ||
      local(-16) !== d[8] ||
      local(-12) !== sourceRow ||
      local(-8) !== (d[20] ? -d[18] : d[18]) >>> 0 ||
      local(8) !== destinationRow
    )
      return false;
    // Six setup instructions, thirteen per pixel and eleven to advance a
    // row. The XOR counted at this hook still executes for the final row,
    // restoring its original EDI and flags before the next budget stop.
    const additional = rows * (17 + 13 * count),
      { active, counter, limit } = p.instructionBudget();
    if (
      !active ||
      !Number.isSafeInteger(additional) ||
      (limit !== 0n && limit - counter < BigInt(additional))
    )
      return false;
    const contiguous = (address, size) =>
      p.regions.some(
        (region) => address >= region.address && address + size <= region.address + region.size,
      );
    if (!contiguous(d[1] >>> 0, d[8] * d[3]) || !contiguous(d[11] >>> 0, d[18] * d[13]))
      return false;
    const raster = this.raster(pointer, frame, sourceRow - channel, destinationRow - 3, d);
    if (!raster || !p.consumeInstructions(additional)) return false;
    const { input, output, sourceStep, destinationStep } = raster;
    let s = raster.source,
      t = raster.destination;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep)
      for (let x = 0, a = s + channel, b = t + 3; x < count; x++, a += 4, b += 4)
        output[b] = (((output[b] + 1) * (input[a] + 1) - 1) & 65535) >>> 8;
    const source = (d[11] >>> 0) + s + channel,
      destination = (d[1] >>> 0) + t + 3;
    p.store(frame - 4, rows);
    p.store(frame - 12, source);
    p.store(frame + 8, destination);
    this.reg('EBX', rows);
    this.reg('EDX', source);
    this.reg('EAX', destination);
    this.reg('ECX', count);
    return true;
  }
  copyInstructions(d, frame, source, destination, regions) {
    const p = this.process,
      abi = this.abi,
      width = d[16],
      rows = d[17] - 1,
      rowOverhead = 14,
      executable = (address, size) =>
        regions.some(
          ({ begin, end, perms }) =>
            (perms & 5) === 5 && address >= Number(begin) && address + size - 1 <= Number(end),
        ),
      control = (address) =>
        this.range(address, 4, false, regions) &&
        !overlaps(address, 4, frame - 76, 88) &&
        !overlaps(address, 4, d[1] >>> 0, d[8] * d[3])
          ? p.load(address)
          : undefined;
    // The original dispatcher uses its capability object when present.
    // The same branch runs for every row because its control word is stable.
    if (!executable(abi.copy, 0x24) || !executable(abi.copyWrapper, 0xbc)) return null;
    const caps = control(abi.copyCaps);
    if (caps === undefined) return null;
    let rowCost;
    if (caps) {
      if (!executable(abi.copyGetCaps, 0x23)) return null;
      const mmx = control(caps + abi.copyMMX);
      if (mmx === undefined) return null;
      if (mmx) {
        if (this.reg('CR0') & 0xc || this.reg('FPSW') & 0x80) return null;
        // MMX copies two pixels per iteration when the byte count is a
        // multiple of eight. The one-pixel loop has two extra dispatch ops.
        rowCost = rowOverhead + (width % 2 ? 43 + 5 * width : 41 + (5 * width) / 2);
      } else rowCost = rowOverhead + 40 + 5 * width;
      return { skipped: rows * rowCost, tail: rowCost };
    }

    if (!executable(abi.memcpy, 0x34f)) return null;
    const flags = control(abi.copyCRTFlags);
    if (flags === undefined) return null;
    // The CRT call wrapper costs 27 instructions. Its overlap test adds
    // two instructions when the destination follows the source.
    const crtCall = rowOverhead + 27 + (destination > source ? 2 : 0);
    if (flags & 2) {
      // REP MOVSB includes one final visit with ECX=0.
      rowCost = crtCall + 18 + 4 * width;
      return { skipped: rows * rowCost, tail: rowCost };
    }
    // Only the aligned scalar CRT paths have a reviewed cost. Sub-word
    // alignment and the CRT SIMD bodies remain in the original PE.
    if ((destination | d[8]) & 3) return null;
    rowCost = crtCall + (width < 8 ? 29 + 2 * width : 26 + width);
    if (width < 32) return { skipped: rows * rowCost, tail: rowCost };
    if (flags & 1) return null;
    const difference = (destination - source) & 15,
      step = (d[8] - (d[20] ? -d[18] : d[18])) & 15;
    let matches = 0;
    // Low-nibble alignment repeats after at most sixteen rows.
    for (let y = 0; y < Math.min(16, rows); y++)
      if (((difference + y * step) & 15) === 0) matches += 1 + Math.floor((rows - 1 - y) / 16);
    const tailMatches = ((difference + rows * step) & 15) === 0;
    if (matches || tailMatches) {
      const simd = control(abi.copyCRTAlignedSIMD);
      if (simd === undefined || simd & 2) return null;
    }
    rowCost += 6;
    return { skipped: rows * rowCost + 2 * matches, tail: rowCost + 2 * Number(tailMatches) };
  }
  copy() {
    const p = this.process,
      frame = this.reg('EBP'),
      regions = this.repeatRegions();
    if (!this.range(frame + 8, 4, false, regions) || p.load(frame + 8) !== 0) return false;
    const pointer = this.reg('ESI'),
      source = this.reg('EDI'),
      destination = this.reg('EBX');
    if (
      this.reg('ESP') !== frame - 20 ||
      this.reg('EFLAGS') & 0x50500 ||
      !p.hasFlatDataSegments('DS', 'ES', 'SS') ||
      !this.range(frame - 8, 20, false, regions) ||
      !this.range(pointer, 128, false, regions) ||
      overlaps(pointer, 128, frame - 76, 88)
    )
      return false;
    const locals = new DataView(p.read(frame - 8, 8).buffer),
      d = new Int32Array(p.read(pointer, 128).buffer),
      contiguous = (address, size) =>
        p.regions.some(
          (region) => address >= region.address && address + size <= region.address + region.size,
        );
    if (
      d[0] !== 4 ||
      d[10] !== 4 ||
      d[16] < 1 ||
      d[17] < 2 ||
      !source ||
      !destination ||
      locals.getInt32(0, true) !== d[8] ||
      locals.getInt32(4, true) !== (d[20] ? -d[18] : d[18]) ||
      !contiguous(d[1] >>> 0, d[8] * d[3]) ||
      !contiguous(d[11] >>> 0, d[18] * d[13])
    )
      return false;
    const { active, counter, limit } = p.instructionBudget();
    if (!active) return false;
    const cost = this.copyInstructions(d, frame, source, destination, regions);
    if (!cost) return false;
    // The counted instruction at this hook becomes the first instruction
    // of the final row. Leave its entire native body available so the CRT
    // scratch stack and any MMX state are restored before another cutoff.
    const required = cost.skipped + cost.tail - 1;
    if (!Number.isSafeInteger(required) || (limit !== 0n && limit - counter < BigInt(required)))
      return false;
    const raster = this.raster(pointer, frame, source, destination, d, regions);
    if (!raster || !p.consumeInstructions(cost.skipped)) return false;
    const { input, output, sourceStep, destinationStep } = raster,
      length = d[16] * 4,
      rows = d[17] - 1;
    let s = raster.source,
      t = raster.destination;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep)
      output.set(input.subarray(s, s + length), t);
    p.store(frame + 8, rows);
    this.reg('EDI', (d[11] >>> 0) + s);
    this.reg('EBX', (d[1] >>> 0) + t);
    return true;
  }
  repeatRegions() {
    const p = this.process,
      layout = p.executableRanges;
    // PE32 drops this key after mapping or protection changes. Without a
    // current key, read permissions again instead of reusing an old layout.
    if (!layout) return p.cpu.mem_regions();
    if (this.repeatLayout?.layout !== layout)
      this.repeatLayout = { layout, regions: p.cpu.mem_regions() };
    return this.repeatLayout.regions;
  }
  repeatFits(count, flags) {
    // TF and RF can change how the original string instruction stops.
    if (!count || flags & 0x10100) return false;
    const { active, counter, limit } = this.process.instructionBudget();
    // This backend visits REP once per element and once with ECX=0. The
    // first visit is already counted at the hook, so count visits remain.
    return active && (limit === 0n || limit - counter >= BigInt(count));
  }
  stos(kind) {
    const p = this.process,
      count = this.reg('ECX'),
      flags = this.reg('EFLAGS'),
      width = kind === 'stosByte' ? 1 : 4,
      step = flags & 0x400 ? -width : width,
      current = this.reg('EDI'),
      start = step < 0 ? current - (count - 1) * width : current,
      size = count * width;
    // ES is flat in the reviewed process. Unusual segments, wrapped ranges
    // and protected/executable destinations retain original CPU execution.
    if (
      !this.repeatFits(count, flags) ||
      !p.hasFlatDataSegments('ES') ||
      !this.range(start, size, true, this.repeatRegions())
    )
      return false;
    const value = this.reg('EAX'),
      bytes = p.view(start, size);
    if (!p.consumeInstructions(count)) return false;
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
    const p = this.process,
      count = this.reg('ECX'),
      flags = this.reg('EFLAGS'),
      source = this.reg('ESI'),
      destination = this.reg('EDI'),
      step = flags & 0x400 ? -width : width,
      firstSource = step < 0 ? source - (count - 1) * width : source,
      firstDestination = step < 0 ? destination - (count - 1) * width : destination,
      size = count * width;
    if (
      !this.repeatFits(count, flags) ||
      !p.hasFlatDataSegments('ES', 'DS') ||
      (source !== destination && overlaps(firstSource, size, firstDestination, size))
    )
      return false;
    const regions = this.repeatRegions();
    if (
      !this.range(firstSource, size, false, regions) ||
      !this.range(firstDestination, size, true, regions)
    )
      return false;
    p.view(firstSource, size);
    const output = p.view(firstDestination, size),
      input = p.view(firstSource, size);
    if (!p.consumeInstructions(count)) return false;
    output.set(input);
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
    if (
      this.reg('EDI') !== 0 ||
      !width ||
      !height ||
      this.reg('EFLAGS') & 0x10100 ||
      !this.range(owner, 48)
    )
      return false;
    const data = p.load(owner + 12),
      stride = p.load(owner + 20),
      size = stride * height;
    if (
      p.load(owner + 24) !== 4 ||
      p.load(owner + 4) !== width ||
      p.load(owner + 8) !== height ||
      this.reg('ESI') !== data + 3 ||
      stride < width * 4
    )
      return false;
    const { active, limit, counter } = p.instructionBudget(),
      rowSetup = 4,
      pixelInstructions = 6,
      rowInstructions = rowSetup + width * pixelInstructions + 5;
    // The hook's XOR has already been counted. Reserve the target CMP so
    // its original flags are visible before any later budget stop.
    let remaining = limit === 0n ? Infinity : Number(limit - counter) + 1;
    if (
      !active ||
      remaining <= rowSetup ||
      !p.regions.some(
        (region) => data >= region.address && data + size <= region.address + region.size,
      ) ||
      !this.range(data, size)
    )
      return false;
    const bytes = p.view(data, size);
    let y = 0,
      x = 0;
    outer: for (; y < height; y++, remaining -= rowInstructions) {
      const pixels = Math.min(
        width,
        1 + Math.floor((remaining - rowSetup - 1) / pixelInstructions),
      );
      for (x = 0; x < pixels; x++) if (bytes[y * stride + x * 4 + 3] !== 255) break outer;
      if (pixels < width) return false;
    }
    if (y === height) {
      y = height - 1;
      x = width - 1;
    }
    const additional = y * rowInstructions + rowSetup + x * pixelInstructions - 1;
    if (!p.consumeInstructions(additional)) return false;
    this.reg('EDI', y);
    this.reg('ESI', data + y * stride + 3);
    this.reg('EAX', x);
    this.reg('ECX', data + y * stride + x * 4 + 3);
    this.reg('EIP', this.abi.alpha + 8);
    return true;
  }
  btypeInstructions(raster, table, available) {
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      width = d[16],
      height = d[17],
      mode = d[28],
      nonzeroAlphaCost = [0, 101, 98, 104, 125, 94][mode];
    let s = raster.source,
      t = raster.destination,
      total = 0,
      row,
      unchanged = true;
    for (let y = 0; y < height; y++, s += sourceStep, t += destinationStep) {
      row = 20;
      for (let x = 0, a = s, b = t; x < width; x++, a += 4, b += 4) {
        if (!table[input[a + 3]]) {
          row += output[b + 3] ? 15 : 17;
        } else {
          row += nonzeroAlphaCost;
          // The overlay path branches on the high bit of each destination
          // channel. The first two channels have an extra branch at the join.
          if (mode === 4)
            row += 4 * (output[b] >>> 7) + 4 * (output[b + 1] >>> 7) + 3 * (output[b + 2] >>> 7);
          // The dodge path skips the division when a channel is already 255.
          else if (mode === 5)
            row +=
              9 *
              (Number(output[b] !== 255) +
                Number(output[b + 1] !== 255) +
                Number(output[b + 2] !== 255));
        }
      }
      // Only the transparent source over nonzero destination alpha costs
      // fifteen instructions. That path leaves the destination untouched.
      if (y < height - 1 && row !== 20 + 15 * width) unchanged = false;
      total += row;
      if (total > available) return null;
    }
    return { skipped: total - row, tail: row, unchanged };
  }
  btype() {
    const p = this.process,
      frame = this.reg('EBP'),
      regions = this.repeatRegions();
    if (!this.range(frame - 0x128, 4, false, regions) || p.load(frame - 0x128) !== 0) return false;
    const pointer = this.reg('EDX'),
      sourceRow = this.reg('ESI'),
      destinationRow = this.reg('EDI');
    if (
      this.reg('ESP') !== frame - 0x14c ||
      this.reg('EFLAGS') & 0x50100 ||
      !p.hasFlatDataSegments('DS', 'SS') ||
      !this.range(frame - 0x13c, 0x138, false, regions) ||
      !this.range(pointer, 128, false, regions) ||
      overlaps(pointer, 128, frame - 0x140, 0x140)
    )
      return false;
    const locals = p.read(frame - 0x13c, 0x138),
      view = new DataView(locals.buffer),
      local = (offset) => view.getUint32(0x13c - offset, true),
      table = locals.subarray(0x38),
      descriptor = new Int32Array(p.read(pointer, 128).buffer),
      mode = descriptor[28],
      contiguous = (address, size) =>
        p.regions.some(
          (region) => address >= region.address && address + size <= region.address + region.size,
        );
    if (
      mode < 1 ||
      mode > 5 ||
      local(0x138) !== pointer ||
      local(0x120) !== sourceRow ||
      local(0x11c) !== destinationRow ||
      local(0x13c) !== descriptor[8] >>> 0 ||
      local(0x134) !== (descriptor[20] ? -descriptor[18] : descriptor[18]) >>> 0 ||
      !contiguous(descriptor[1] >>> 0, descriptor[8] * descriptor[3]) ||
      !contiguous(descriptor[11] >>> 0, descriptor[18] * descriptor[13])
    )
      return false;
    const row = this.abi.btype,
      entry = row + 0x48c + (mode - 1) * 4,
      target = row + [0, 0x5e, 0xa9, 0xef, 0x14d, 0x274][mode];
    if (!this.range(entry, 4, false, regions) || p.load(entry) !== target) return false;
    const { active, counter, limit } = p.instructionBudget(),
      available = limit === 0n ? Infinity : Number(limit - counter) + 1,
      columns = descriptor[16],
      height = descriptor[17],
      pixels = columns * height,
      minimumRow = 20 + 15 * columns;
    if (!active || available < minimumRow) return false;
    const budget =
      // Overlay reaches 125 + 11 instructions for a single pixel.
      available < height * 20 + pixels * 136 &&
      this.rasterAllowance(
        {
          destination: descriptor[1] >>> 0,
          width: descriptor[2],
          height: descriptor[3],
          pitch: descriptor[8],
          pixels,
        },
        row,
        [[row, 0x48c]],
      );
    if (!budget && available < height * minimumRow) return false;
    const raster = this.raster(pointer, frame, sourceRow, destinationRow, descriptor, regions);
    if (!raster) return false;
    const { descriptor: d, input, output, sourceStep, destinationStep } = raster,
      rows = d[17] - 1,
      sourcePixels = new DataView(input.buffer, input.byteOffset, input.byteLength),
      destinationPixels = new DataView(output.buffer, output.byteOffset, output.byteLength),
      instructions = this.btypeInstructions(raster, table, budget ? Infinity : available);
    if (!this.chargeRasterInstructions(instructions, available, budget, pixels)) return false;
    const blendWidth = instructions.unchanged ? 0 : d[16];
    let s = raster.source,
      t = raster.destination,
      lastColors,
      lastTotal,
      lastOverlap;
    for (let y = 0; y < rows; y++, s += sourceStep, t += destinationStep)
      for (let x = 0, a = s, b = t; x < blendWidth; x++, a += 4, b += 4) {
        const sourceWord = sourcePixels.getUint32(a, true),
          destinationWord = destinationPixels.getUint32(b, true),
          alpha = table[sourceWord >>> 24],
          oldAlpha = destinationWord >>> 24;
        if (!alpha) {
          if (!oldAlpha) destinationPixels.setUint32(b, sourceWord & 0xffffff, true);
          continue;
        }
        const overlap = (alpha * oldAlpha) >> 8,
          sourceOnly = (alpha * (256 - oldAlpha)) >> 8,
          destinationOnly = (oldAlpha * (256 - alpha)) >> 8,
          total = (overlap + sourceOnly + destinationOnly) | 1,
          reciprocal = Math.floor(65536 / total);
        let colors = 0,
          result = total << 24;
        for (let shift = 0; shift < 24; shift += 8) {
          const sourceChannel = (sourceWord >>> shift) & 255,
            destinationChannel = (destinationWord >>> shift) & 255;
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
          colors |= color << shift;
          const mixed =
            Math.imul(
              reciprocal,
              color * overlap + sourceOnly * sourceChannel + destinationOnly * destinationChannel,
            ) >>> 16;
          result |= (mixed & 255) << shift;
        }
        destinationPixels.setUint32(b, result, true);
        lastColors = colors;
        lastTotal = total;
        lastOverlap = overlap;
      }
    if (lastColors !== undefined) {
      [0x10c, 0x114, 0x110].forEach((offset, c) =>
        p.store(frame - offset, (lastColors >>> (c * 8)) & 255),
      );
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
  affineInstructions({ d, table, input, output, px, py, baseX, baseY, mode }, available) {
    const left = d[32],
      top = d[33],
      right = d[34],
      bottom = d[35],
      sw = d[14],
      sh = d[15],
      ss = d[16],
      nextSourceRow = ss & ~3,
      ds = d[10],
      btypeMix = [0, 95, 93, 99, 121, 85][mode];
    let total = 0,
      row;
    for (let y = top; y < bottom; y++) {
      row = 24;
      const cy = ((y << 15) - py + d[46]) | 0,
        rowU = (fixedMultiply(d[39], cy) + d[42]) | 0,
        rowV = (fixedMultiply(d[40], cy) + d[43]) | 0,
        // Four native allmul calls cost eight instructions each on their
        // unsigned fast path. A negative operand costs eight extra.
        rowTransform = 127 + 8 * (Number(cy < 0 || d[39] < 0) + Number(cy < 0 || d[40] < 0));
      for (let x = left; x < right; x++) {
        const cx = ((x << 15) - px + d[45]) | 0,
          u = (fixedMultiply(d[36], cx) + rowU) | 0,
          v = (fixedMultiply(d[37], cx) + rowV) | 0,
          ix = ((u >> 15) + baseX) | 0,
          iy = ((v >> 15) + baseY) | 0;
        row += rowTransform + 8 * (Number(cx < 0 || d[36] < 0) + Number(cx < 0 || d[37] < 0));
        if (ix >>> 0 >= sw) {
          row += mode ? 15 : 14;
          continue;
        }
        if (iy >>> 0 >= sh) {
          row += mode ? 18 : 17;
          continue;
        }
        const at = iy * ss + ix * 4 + 3,
          hasRight = ix < sw - 1,
          hasBottom = iy < sh - 1,
          a0 = input[at],
          a1 = input[hasRight ? at + 4 : at],
          a2 = input[hasBottom ? at + nextSourceRow : at],
          a3 = input[hasRight && hasBottom ? at + nextSourceRow + 4 : at];
        // Both right-edge paths have the same cost. The lower-edge path
        // costs one fewer instruction before the four-alpha test.
        row += (mode ? 60 : 59) + Number(hasBottom);
        if (!(a0 + a1 + a2 + a3)) {
          row += mode ? 2 : 1;
          continue;
        }
        const fx = u & 32767,
          fy = v & 32767,
          sampleAlpha =
            (a0 * (((32768 - fx) * (32768 - fy)) >> 15) +
              a1 * ((fx * (32768 - fy)) >> 15) +
              a2 * (((32768 - fx) * fy) >> 15) +
              a3 * ((fx * fy) >> 15)) >>>
            15,
          alpha = table[sampleAlpha & 255],
          destination = y * ds + x * 4,
          oldAlpha = output[destination + 3];
        if (mode) {
          row += 84;
          if (!alpha) row += oldAlpha ? 4 : 7;
          else {
            row += btypeMix;
            if (mode === 4)
              row +=
                4 * (output[destination] >>> 7) +
                4 * (output[destination + 1] >>> 7) +
                3 * (output[destination + 2] >>> 7);
            // Each dodge channel has its own path through the division.
            else if (mode === 5)
              row +=
                9 * Number(output[destination] !== 255) +
                10 * Number(output[destination + 1] !== 255) +
                11 * Number(output[destination + 2] !== 255);
          }
        } else {
          row += 89;
          if (!alpha) row += oldAlpha ? 2 : 5;
          else if (alpha === 255) row += 5;
          else row += !oldAlpha ? 9 : oldAlpha === 255 ? 31 : 65;
        }
      }
      total += row;
      if (total > available) return null;
    }
    return { skipped: total - row, tail: row };
  }
  rasterAllowance({ destination, width, height, pitch, pixels }, row, spans) {
    const p = this.process,
      budget = p.rasterBudget;
    if (
      budget?.destination !== destination ||
      budget.width !== width ||
      budget.height !== height ||
      budget.pitch !== pitch ||
      !(pixels > 0 && pixels <= budget.pixels)
    )
      return;
    const { base, pe } = this.engine.module;
    for (const [address, size] of spans) {
      for (const boundary of p.executionBoundaries.keys())
        if (boundary !== row && boundary >= address && boundary < address + size) return;
      if (!p.read(address, size).every((byte, i) => byte === pe.image[address - base + i])) return;
    }
    return budget;
  }
  chargeRasterInstructions(cost, available, budget, pixels) {
    // The full final row restores native registers and locals.
    if (!cost || cost.tail > available) return false;
    const credit = cost.skipped + cost.tail > available;
    if ((credit && !budget) || !this.process.consumeInstructions(credit ? 0 : cost.skipped))
      return false;
    if (credit) {
      // Only simulated rows get extra allowance. The CPU still has its
      // ordinary budget for the tail, epilogue and any later guest code.
      budget.pixels -= pixels;
      budget.credited += cost.skipped;
    }
    return true;
  }
  affineBtype() {
    return this.affine(true);
  }
  affine(blendType = false) {
    const layout = blendType
      ? {
          pointer: 'ESI',
          descriptor: 0x114,
          stack: 0x188,
          leftRegister: 'EBX',
          left: 0x16c,
          right: 0x174,
          bottom: 0x154,
          codeSize: 0x7c8,
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
          descriptor: 0x124,
          stack: 0x174,
          leftRegister: 'ESI',
          left: 0x158,
          right: 0x160,
          bottom: 0x150,
          codeSize: 0x4d2,
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
      pointer = this.reg(layout.pointer),
      regions = this.repeatRegions();
    if (
      !this.range(pointer, 200, false, regions) ||
      !this.range(frame - 0x1c0, 0x1d0, true, regions)
    )
      return false;
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
      sourceSize = ss * sh,
      mode = blendType ? d[31] : 0;
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
      !this.range(destination, destinationSize, true, regions) ||
      !this.range(source, sourceSize, false, regions) ||
      overlaps(destination, destinationSize, source, sourceSize) ||
      overlaps(destination, destinationSize, pointer, 200) ||
      overlaps(destination, destinationSize, frame - 0x1c0, 0x1d0) ||
      overlaps(source, sourceSize, frame - 0x1c0, 0x1d0) ||
      (blendType && (mode < 1 || mode > 5)) ||
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
      alphaSpill = blendType ? p.load(frame - 0x138) & 0xffffff : 0,
      nextSourceRow = ss & ~3,
      rowAddress = blendType ? this.abi.affineBtype : this.abi.affine,
      code = (address, size) =>
        regions.some(
          ({ begin, end, perms }) =>
            (perms & 5) === 5 && address >= Number(begin) && address + size - 1 <= Number(end),
        ),
      contiguous = (address, size) =>
        p.regions.some(
          (region) => address >= region.address && address + size <= region.address + region.size,
        );
    if (
      this.reg('ESP') !== frame - layout.stack ||
      this.reg(layout.leftRegister) !== left ||
      this.reg('EDI') !== right ||
      this.reg('EDX') !== (top << 15) >>> 0 ||
      this.reg('EFLAGS') & 0x50100 ||
      !p.hasFlatDataSegments('DS', 'SS') ||
      (this.reg('MXCSR') & 0x1f80) !== 0x1f80 ||
      overlaps(pointer, 200, frame - 0x1c0, 0x1c0) ||
      !destination ||
      !contiguous(source, sourceSize) ||
      !contiguous(destination, destinationSize) ||
      !code(rowAddress, layout.codeSize) ||
      !code(this.abi.affineSampler, 0xc2) ||
      !code(this.abi.affineMultiply, 0x34)
    )
      return false;
    const firstLocal = Math.max(0x168, layout.right),
      localsView = new DataView(
        p.read(frame - firstLocal, firstLocal - layout.descriptor + 4).buffer,
      ),
      local = (offset) => localsView.getUint32(firstLocal - offset, true);
    if (
      local(layout.descriptor) !== pointer ||
      local(layout.row) !== top ||
      local(layout.rowFixed) !== (top << 15) >>> 0 ||
      local(layout.bottom) !== bottom ||
      local(layout.left) !== left ||
      local(layout.right) !== right ||
      local(0x168) !== (left << 2) >>> 0
    )
      return false;
    if (blendType) {
      const entry = rowAddress + 0x7e1 + (mode - 1) * 4,
        target = rowAddress + [0, 0x32b, 0x479, 0x4cb, 0x535, 0x67a][mode];
      if (!this.range(entry, 4, false, regions) || p.load(entry) !== target) return false;
    }
    const { active, counter, limit } = p.instructionBudget(),
      available = limit === 0n ? Infinity : Number(limit - counter) + 1,
      columns = right - left,
      rows = bottom - top,
      pixels = columns * rows,
      minimumRow = 24 + (blendType ? 142 : 141) * columns;
    if (!active || available < minimumRow) return false;
    const budget =
      // Transform, sampler, weighting and the longest BTYPE branch.
      available < rows * 24 + pixels * (159 + 61 + 84 + 132) &&
      this.rasterAllowance({ destination, width: dw, height: dh, pitch: ds, pixels }, rowAddress, [
        [rowAddress, layout.codeSize],
        [this.abi.affineSampler, 0xc2],
        [this.abi.affineMultiply, 0x34],
      ]);
    if (!budget && available < rows * minimumRow) return false;
    p.view(source, sourceSize);
    p.view(destination, destinationSize);
    const input = p.view(source, sourceSize),
      output = p.view(destination, destinationSize),
      words = new DataView(input.buffer, input.byteOffset, input.byteLength),
      locals = new Map(),
      cost =
        available === Infinity
          ? { skipped: 0, tail: 0 }
          : this.affineInstructions(
              { d, table, input, output, px, py, baseX, baseY, mode },
              budget ? Infinity : available,
            );
    if (!this.chargeRasterInstructions(cost, available, budget, pixels)) return false;
    for (let y = top; y < bottom - 1; y++)
      for (let x = left; x < right; x++) {
        const cx = ((x << 15) - px + d[45]) | 0,
          cy = ((y << 15) - py + d[46]) | 0,
          u = (fixedMultiply(d[36], cx) + fixedMultiply(d[39], cy) + d[42]) | 0,
          v = (fixedMultiply(d[37], cx) + fixedMultiply(d[40], cy) + d[43]) | 0,
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
          c = iy < sh - 1 ? a + nextSourceRow : a,
          e = ix < sw - 1 && iy < sh - 1 ? a + nextSourceRow + 4 : a,
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
                t = output[at + channel];
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
