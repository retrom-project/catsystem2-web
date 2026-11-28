// SPDX-License-Identifier: MPL-2.0
// FES transition snapshots copy physical storage rows, preserve bpp and keep
// the requested destination extent even when source clipping copies less.
export async function copyFESBitmapRectangle(images, handle, rectangle, owner = null) {
  const source = images.get(handle),
    [x, y, width, height] = rectangle.map((word) => word | 0),
    outputHandle = images.create(width, height, owner),
    output = images.get(outputHandle);
  try {
    output.state.bpp = source.state.bpp;
    if (source.state.bpp === 3) {
      const pixels = await output.pixels();
      for (let at = 3; at < pixels.length; at += 4) pixels[at] = 255;
    }
    const left = Math.max(0, x),
      bottom = Math.max(0, y),
      columns = Math.min(source.width, (x + width) | 0) - left,
      rows = Math.min(source.height, (y + height) | 0) - bottom;
    if (columns > 0 && rows > 0)
      await output.blit(source, {
        dx: 0,
        dy: height - rows,
        sx: left,
        sy: source.height - bottom - rows,
        width: columns,
        height: rows,
        copy: true,
      });
    return outputHandle;
  } catch (error) {
    await images.release(outputHandle);
    throw error;
  }
}
