// SPDX-License-Identifier: MPL-2.0
// Integer placement of the engine's 88-byte text records.
export const textVisible = (r) => r[1] > 9 && r[1] !== 65535;
export function textControl(code = 0) {
  const r = new Int32Array(22);
  r[1] = code;
  r[10] = -1;
  return r;
}
function vertical(rows, c, shift) {
  let top = c(20) + shift[1],
    start = 0;
  for (let i = 0; i <= rows.length; i++)
    if (i === rows.length || rows[i][1] === 0) {
      let size = 0;
      for (let j = start; j < i; j++) if (textVisible(rows[j])) size = Math.max(size, rows[j][7]);
      if (!size && i < rows.length) size = rows[i][7];
      for (let j = start; j < i; j++) {
        if (c(26) === 1) rows[j][5] = top;
        else if (c(26) === 2) rows[j][5] = top + size - rows[j][7];
      }
      top += size + c(24);
      start = i + 1;
    }
}
function ruby(rows, c) {
  for (let i = 0; i < rows.length; ) {
    const group = rows[i][10];
    if (group === -1) {
      i++;
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end][10] === group) end++;
    const base = rows.slice(i, end).filter((r) => !r[9]),
      reading = rows.slice(i, end).filter((r) => r[9]);
    if (reading.length) {
      const width = base.reduce((n, r) => n + r[6], 0),
        rw = reading.reduce((n, r) => n + r[6], 0);
      let x = base[0]?.[4] ?? -1,
        free = width - rw,
        gaps = reading.filter(textVisible).length + 1;
      if (rw > width) {
        x -= Math.floor((rw - width) / 2);
        if (x < 0) x = 0;
        if (x + rw >= c(4)) x = c(4) - rw;
      }
      for (const r of reading) {
        if (rw > width) {
          r[4] = x;
          if (textVisible(r)) x += r[6];
        } else {
          const gap = Math.trunc(free / gaps);
          r[4] = x + gap;
          if (textVisible(r)) {
            free -= gap;
            x += gap + r[6];
            gaps--;
          }
        }
        let anchor = base.at(-1) ?? rows[i - 1] ?? textControl();
        for (let j = base.length - 1; j >= 0; j--)
          if (r[4] <= base[j][4]) anchor = base[j];
          else break;
        r[5] = anchor[5] + c(25) - r[7];
        r[11] = anchor[11];
        r[12] = 0;
      }
    }
    i = end;
  }
}
function pixelOffsets(rows) {
  let maximum = 0,
    base = 0;
  for (const r of rows) if (textVisible(r)) maximum = Math.max(maximum, r[8] >>> 0);
  for (let line = 0; line <= maximum; line++) {
    let left = 0xffffffff,
      width = 0;
    for (const r of rows) if (textVisible(r) && r[8] === line) left = Math.min(left, r[4] >>> 0);
    for (const r of rows) {
      if (!textVisible(r)) {
        if (r[1] === 9) base = 0;
      } else if (r[8] === line) {
        r[12] = (base + r[4] - left) | 0;
        width = (r[4] + r[6] - left) >>> 0;
      }
    }
    base = (base + width) >>> 0;
  }
}
function kinsoku(rows, start, end, budget, spacing, profiles) {
  const initialBudget = budget,
    forbidden = profiles[0],
    repeated = profiles[2];
  if (rows[end][1] === 0) return { end };
  let next = end + 1,
    previous = 65535,
    runRepeat = true;
  while (next < rows.length) {
    const r = rows[next],
      code = r[1];
    if (code === 0) {
      end++;
      return { end };
    }
    if (!forbidden.has(code) && textVisible(r)) break;
    if (previous === 0x8142 && code !== 0x8142) {
      while (next < rows.length && (rows[next][1] === 0 || rows[next][1] === 65535)) end = next++;
      runRepeat = false;
      break;
    }
    const space = previous !== 0x8142 && code === 0x8140;
    if (r[6] >= budget && !space) {
      const saved = end;
      let count = 0;
      while (end > start) {
        if (count >= 4) {
          end = saved;
          break;
        }
        if (!forbidden.has(rows[end][1]) && textVisible(rows[end])) {
          end--;
          break;
        }
        end--;
        count++;
      }
      break;
    }
    next++;
    end++;
    budget -= spacing + r[6];
    previous = code;
  }
  if (!runRepeat || end <= start) return { end };
  budget = initialBudget;
  let cursor = end,
    group = -1,
    code = 0,
    found = false;
  while (cursor > start) {
    const r = rows[cursor];
    if (textVisible(r)) {
      if (!repeated.has(r[1])) {
        if (r[10] === -1) break;
        if (group === -1) group = r[10];
        else if (group !== r[10]) break;
      }
      found = true;
      code = r[1];
    }
    cursor--;
  }
  if (!found) return { end };
  const rollback = cursor,
    from = end + 1;
  let at = from,
    forward = false;
  while (at < rows.length) {
    const r = rows[at];
    if (textVisible(r)) {
      if (group === -1 ? r[1] !== code : r[10] !== group) break;
      forward = true;
    }
    at++;
  }
  if (!forward) return { end };
  let width = 0;
  for (let i = from; i < at; i++) if (!rows[i][9]) width += rows[i][6];
  if (width >= budget) return { end: rollback };
  end = at - 1;
  let remaining = budget - width;
  for (; at < rows.length; at++) {
    const r = rows[at];
    if (!textVisible(r)) {
      if (r[1] === 0) end = at;
    } else {
      if (!forbidden.has(r[1])) break;
      if (r[6] > remaining) return { end: rollback };
      end = at;
      remaining -= r[6];
    }
  }
  return { end };
}
export function layoutText(rows, c, { shift = [0, 0], profiles = [], cachedEnd = [0, 0] } = {}) {
  let index = 0,
    y = shift[1] + c(20),
    lastSize = 0,
    seen = false,
    firstParagraph = true,
    lineID = 0,
    indentOffset = 0,
    highest = 0;
  const visibleIndex = (at, set) => {
    if (!c(30)) return -1;
    while (at < rows.length && !textVisible(rows[at])) at++;
    return at < rows.length && set?.has(rows[at][1]) ? at : -1;
  };
  const opening = profiles[3] ?? new Set(),
    indentSet = profiles[4] ?? opening;
  const place = (r, x, y) => {
    r[4] = x | 0;
    r[5] = y | 0;
    if (textVisible(r)) {
      cachedEnd[0] = (r[4] + r[6]) | 0;
      cachedEnd[1] = r[5];
      highest = Math.max(highest, r[5] + r[7]);
    }
  };
  let budget = 0;
  while (index < rows.length) {
    if (++budget > rows.length * 4 + 32) throw new Error('Native text placement cannot advance');
    const paragraphStart = index,
      head = visibleIndex(index, opening);
    let indent = false,
      align = 0,
      paragraphEnd = false;
    if (head !== -1) indentOffset = c(23) + rows[head][6];
    if (!lastSize) lastSize = textVisible(rows[index]) ? rows[index][7] : c(11);
    do {
      const begin = index;
      if (begin >= rows.length) break;
      let probeX = shift[0] + c(19),
        height = lastSize,
        overflow = false,
        end = index;
      if (seen) {
        firstParagraph = false;
        if (visibleIndex(index, opening) === -1) {
          if (visibleIndex(index, indentSet) === -1) indent = true;
        } else indent = false;
      } else if (!firstParagraph) {
        if (visibleIndex(index, opening) === -1) {
          if (visibleIndex(index, indentSet) === -1) indent = true;
        } else indent = false;
      }
      if (indent) probeX += indentOffset;
      let onFirstY = y === c(20);
      while (index < rows.length) {
        const r = rows[index];
        if (!seen) seen = textVisible(r);
        if (r[1] === 0) {
          end = index++;
          if (index < rows.length && rows[index][1] === 6) {
            end = index++;
            firstParagraph = true;
            indent = false;
            paragraphEnd = true;
          }
          break;
        }
        if (r[1] === 6) {
          indent = false;
          paragraphEnd = true;
          break;
        }
        if (r[1] === 4) probeX = shift[0] + r[4];
        else if (r[1] === 5) y = shift[1] + r[5];
        else if (!r[9]) {
          if (r[6] + probeX > c(4) - c(21)) {
            overflow = true;
            break;
          }
          if (onFirstY || r[1] !== 0x8140) probeX += r[6] + c(23);
          else r[6] = 0;
          onFirstY = true;
        }
        end = index++;
      }
      if (c(29)) {
        while (end > begin && profiles[1]?.has(rows[end][1])) end--;
        const adjusted = kinsoku(rows, begin, end, c(4) - probeX, c(23), profiles);
        end = adjusted.end;
        index = end + 1;
      }
      if (overflow) {
        for (let j = end; j >= begin; j--)
          if (rows[j][1] === 0) {
            overflow = false;
            break;
          } else if (textVisible(rows[j])) break;
      }
      const soft = overflow && index < rows.length;
      let x = shift[0] + c(19) + (indent ? indentOffset : 0),
        available = c(4) - c(19) - c(21) - (indent ? indentOffset : 0);
      for (let at = begin; at <= end; ) {
        if (align) {
          let used = 0;
          for (let j = at; j <= end; j++)
            if (!rows[j][9]) {
              used += rows[j][6] + c(23);
              if (rows[j][1] === 1 || (align === 1 ? rows[j][1] === 3 : rows[j][1] === 2)) break;
            }
          const free = Math.max(0, available - used),
            delta = align === 1 ? Math.trunc(free / 2) : free;
          x += delta;
          available = align === 1 ? free - delta : 0;
        }
        const mode = align;
        for (; at <= end; at++) {
          const r = rows[at];
          if (!mode && r[1] === 4) {
            x = r[4];
            available = c(4) - x - c(21);
            continue;
          }
          if (!mode && r[1] === 5) {
            y = r[5];
            continue;
          }
          place(r, x, y);
          if (!r[9]) {
            x += r[6] + c(23);
            if (r[1] >= 1 && r[1] <= 3 && r[1] - 1 !== mode) {
              align = r[1] - 1;
              at++;
              break;
            }
            if (!mode) available = Math.max(0, available - r[6] - c(23));
            if (textVisible(r)) lastSize = r[7];
            height = Math.max(height, lastSize);
          }
        }
      }
      if (soft) {
        rows.splice(end + 1, 0, textControl());
        index++;
      }
      for (let j = begin; j <= end; j++) rows[j][8] = lineID;
      lineID++;
      y += height + c(24);
      if (index === begin && !paragraphEnd) break;
    } while (!paragraphEnd && index < rows.length);
    if (index === paragraphStart) break;
  }
  vertical(rows, c, shift);
  ruby(rows, c);
  if (c(3) === 1) pixelOffsets(rows);
  return { cachedEnd, highest };
}
