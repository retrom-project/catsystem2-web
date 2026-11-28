// SPDX-License-Identifier: MPL-2.0
// IMGWND tiles use physical bitmap coordinates. The bitmap registry exposes
// logical RGBA rows, so convert after the independent native rectangle clips.
async function paint(output, source, x, y, width, height) {
  const left = Math.max(0, x),
    bottom = Math.max(0, y),
    columns = Math.min(source.width, width, Math.min(output.width, x + width) - left),
    rows = Math.min(source.height, height, Math.min(output.height, y + height) - bottom);
  if (columns <= 0 || rows <= 0) return;
  await output.blit(source, {
    dx: left,
    dy: output.height - bottom - rows,
    sx: 0,
    sy: source.height - rows,
    width: columns,
    height: rows,
    copy: source.state.bpp === 3,
    flipY: Boolean(source.state.blendType),
  });
}

// loadFrame returns an owned bitmap handle or 0. Every temporary frame is
// released, and the successful result is independently owned by the caller.
export async function composeFESWindow(images, width, height, loadFrame, owner = null) {
  if (typeof loadFrame !== 'function') throw new TypeError('IMGWND requires its frame loader');
  const handle = images.create(width, height, owner),
    output = images.get(handle);
  try {
    for (let id = 0; id < 9; id++) {
      const sourceHandle = await loadFrame(id);
      if (!sourceHandle) continue;
      try {
        const source = images.get(sourceHandle),
          tileWidth = source.width,
          tileHeight = source.height;
        if (!tileWidth || !tileHeight) throw new RangeError('IMGWND tile has zero extent');
        if (id < 4) {
          await paint(
            output,
            source,
            id & 1 ? width - tileWidth : 0,
            id & 2 ? height - tileHeight : 0,
            tileWidth,
            tileHeight,
          );
        } else if (id < 6) {
          if (height < tileHeight) throw new RangeError('IMGWND vertical tile exceeds its target');
          for (let y = tileHeight; y < height - tileHeight; y += tileHeight)
            await paint(
              output,
              source,
              id === 4 ? 0 : width - tileWidth,
              y,
              tileWidth,
              Math.min(tileHeight, height - y - tileHeight),
            );
        } else if (id < 8) {
          if (width < tileWidth) throw new RangeError('IMGWND horizontal tile exceeds its target');
          for (let x = tileWidth; x < width - tileWidth; x += tileWidth)
            await paint(
              output,
              source,
              x,
              id === 6 ? 0 : height - tileHeight,
              Math.min(tileWidth, width - x - tileWidth),
              tileHeight,
            );
        } else {
          if (width < tileWidth || height < tileHeight)
            throw new RangeError('IMGWND center tile exceeds its target');
          for (let y = tileHeight; y < height - tileHeight; y += tileHeight)
            for (let x = tileWidth; x < width - tileWidth; x += tileWidth)
              await paint(
                output,
                source,
                x,
                y,
                Math.min(tileWidth, width - x - tileWidth),
                Math.min(tileHeight, height - y - tileHeight),
              );
        }
      } finally {
        await images.release(sourceHandle);
      }
    }
    return handle;
  } catch (error) {
    await images.release(handle);
    throw error;
  }
}
