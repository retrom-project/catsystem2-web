// SPDX-License-Identifier: MPL-2.0
// Recovered record ordering also preserves observable ties in native selections.
export function sortNativeRecords(values, less) {
  const swap = (left, right) => {
    const value = values[left];
    values[left] = values[right];
    values[right] = value;
  };
  const median = (first, middle, last) => {
    if (less(values[middle], values[first])) swap(first, middle);
    if (less(values[last], values[middle])) {
      swap(middle, last);
      if (less(values[middle], values[first])) swap(first, middle);
    }
  };
  function partition(first, last) {
    let middle = first + Math.floor((last - first) / 2);
    if (last - first > 41) {
      const step = Math.floor((last - first) / 8);
      median(first, first + step, first + 2 * step);
      median(middle - step, middle, middle + step);
      median(last - 1 - 2 * step, last - 1 - step, last - 1);
      median(first + step, middle, last - 1 - step);
    } else median(first, middle, last - 1);
    let equalEnd = middle + 1;
    while (
      first < middle &&
      !less(values[middle - 1], values[middle]) &&
      !less(values[middle], values[middle - 1])
    )
      middle--;
    while (
      equalEnd < last &&
      !less(values[equalEnd], values[middle]) &&
      !less(values[middle], values[equalEnd])
    )
      equalEnd++;
    let left = middle,
      right = equalEnd;
    for (;;) {
      while (right < last) {
        if (!less(values[middle], values[right])) {
          if (less(values[right], values[middle])) break;
          swap(equalEnd++, right);
        }
        right++;
      }
      while (first < left) {
        if (!less(values[left - 1], values[middle])) {
          if (less(values[middle], values[left - 1])) break;
          swap(--middle, left - 1);
        }
        left--;
      }
      if (left === first && right === last) return [middle, equalEnd];
      if (left === first) {
        if (equalEnd !== right) swap(middle, equalEnd);
        equalEnd++;
        swap(middle++, right++);
      } else if (right === last) {
        if (--left !== --middle) swap(left, middle);
        swap(middle, --equalEnd);
      } else swap(right++, --left);
    }
  }
  function adjustHeap(first, hole, length, value) {
    const top = hole;
    let child = 2 * hole + 2;
    while (child < length) {
      if (less(values[first + child], values[first + child - 1])) child--;
      values[first + hole] = values[first + child];
      hole = child;
      child = 2 * hole + 2;
    }
    if (child === length) {
      values[first + hole] = values[first + child - 1];
      hole = child - 1;
    }
    let parent = Math.floor((hole - 1) / 2);
    while (hole > top && less(values[first + parent], value)) {
      values[first + hole] = values[first + parent];
      hole = parent;
      parent = Math.floor((hole - 1) / 2);
    }
    values[first + hole] = value;
  }
  function sort(first, last, budget) {
    while (last - first > 32 && budget > 0) {
      const [middle, equalEnd] = partition(first, last);
      budget = Math.floor(budget / 2) + Math.floor(Math.floor(budget / 2) / 2);
      if (middle - first < last - equalEnd) {
        sort(first, middle, budget);
        first = equalEnd;
      } else {
        sort(equalEnd, last, budget);
        last = middle;
      }
    }
    if (last - first > 32) {
      for (let parent = Math.floor((last - first) / 2) - 1; parent >= 0; parent--)
        adjustHeap(first, parent, last - first, values[first + parent]);
      for (let end = last - first - 1; end > 0; end--) {
        const value = values[first + end];
        values[first + end] = values[first];
        adjustHeap(first, 0, end, value);
      }
    } else {
      for (let index = first + 1; index < last; index++) {
        const value = values[index];
        let at = index;
        while (at > first && less(value, values[at - 1])) {
          values[at] = values[at - 1];
          at--;
        }
        values[at] = value;
      }
    }
  }
  sort(0, values.length, values.length);
  return values;
}
