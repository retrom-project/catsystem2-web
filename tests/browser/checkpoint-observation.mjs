// SPDX-License-Identifier: MPL-2.0
// Observe original DTOs without encoding-order, graph-ID or compression
// requirements. Binary views use byte loops, never per-byte property lists.
export async function checkpointDifference(current, saved) {
  const currentAliases = new Map(),
    savedAliases = new Map(),
    trail = [];
  const difference = (kind, path, details = {}) => ({ kind, path, ...details });
  const field = (key, index) =>
    /^[A-Za-z_$][A-Za-z0-9_$]{0,47}$/.test(key) ? key : `field[${index}]`;
  const rollback = (length) => {
    while (trail.length > length) {
      const [a, b] = trail.pop();
      currentAliases.delete(a);
      savedAliases.delete(b);
    }
  };
  const ownFields = (a, b, path, work, array = false) => {
    const keys = Object.getOwnPropertyNames(a),
      otherKeys = Object.getOwnPropertyNames(b);
    if (keys.length !== otherKeys.length)
      return difference('field-count', path, { current: keys.length, saved: otherKeys.length });
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (array && key === 'length') continue;
      const at = [...path, field(key, index)],
        first = Object.getOwnPropertyDescriptor(a, key),
        second = Object.getOwnPropertyDescriptor(b, key);
      if (!second) return difference('missing-field', at);
      if (!Object.hasOwn(first, 'value') || !Object.hasOwn(second, 'value'))
        return difference('unsupported-accessor', at);
      if (first.enumerable !== second.enumerable) return difference('field-enumerability', at);
      work.push({ a: first.value, b: second.value, path: at });
    }
    return null;
  };
  const bytes = (a, b, path) => {
    if (a.byteLength !== b.byteLength)
      return difference('byte-length', path, { current: a.byteLength, saved: b.byteLength });
    for (let offset = 0; offset < a.byteLength; offset++)
      if (a[offset] !== b[offset])
        return difference('byte', path, { offset, current: a[offset], saved: b[offset] });
    return null;
  };
  const search = async (work) => {
    while (work.length) {
      const item = work.pop(),
        { a, b, path } = item;
      if (item.unordered) {
        if (!item.entries.length) continue;
        const [first, ...remaining] = item.entries;
        let firstFailure;
        for (let index = 0; index < item.candidates.length; index++) {
          const candidate = item.candidates[index],
            checkpoint = trail.length,
            branch = [...work];
          branch.push({
            ...item,
            entries: remaining,
            candidates: item.candidates.filter((_, at) => at !== index),
          });
          if (item.unordered === 'map') {
            branch.push({ a: first[1], b: candidate[1], path: [...path, 'value'] });
            branch.push({ a: first[0], b: candidate[0], path: [...path, 'key'] });
          } else branch.push({ a: first, b: candidate, path: [...path, 'member'] });
          const failed = await search(branch);
          if (!failed) return null;
          firstFailure ??= failed;
          rollback(checkpoint);
        }
        return firstFailure ?? difference('unordered-member', path);
      }
      if (['function', 'symbol'].includes(typeof a) || ['function', 'symbol'].includes(typeof b))
        return difference('unsupported-value', path);
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        if (Object.is(a, b)) continue;
        return difference(typeof a === typeof b ? 'value' : 'value-type', path);
      }
      if (currentAliases.has(a)) {
        if (currentAliases.get(a) !== b) return difference('alias', path);
        continue;
      }
      if (savedAliases.has(b)) return difference('alias', path);
      currentAliases.set(a, b);
      savedAliases.set(b, a);
      trail.push([a, b]);
      const prototype = Object.getPrototypeOf(a);
      if (prototype !== Object.getPrototypeOf(b)) return difference('object-type', path);
      if (
        !(a instanceof Blob) &&
        (Object.getOwnPropertySymbols(a).length || Object.getOwnPropertySymbols(b).length)
      )
        return difference('unsupported-symbol-field', path);
      if (ArrayBuffer.isView(a)) {
        if (a.byteOffset !== b.byteOffset || a.byteLength !== b.byteLength)
          return difference('view-range', path);
        work.push({ a: a.buffer, b: b.buffer, path: [...path, 'buffer'] });
      } else if (a instanceof ArrayBuffer) {
        const failed = bytes(new Uint8Array(a), new Uint8Array(b), path);
        if (failed) return failed;
      } else if (a instanceof Blob) {
        if (a.type !== b.type || a.size !== b.size) return difference('blob-type-size', path);
        const failed = bytes(
          new Uint8Array(await a.arrayBuffer()),
          new Uint8Array(await b.arrayBuffer()),
          path,
        );
        if (failed) return failed;
      } else {
        if (a instanceof Date && !Object.is(a.getTime(), b.getTime()))
          return difference('date', path);
        if (Array.isArray(a) && a.length !== b.length)
          return difference('array-length', path, { current: a.length, saved: b.length });
        if (a instanceof Map || a instanceof Set) {
          if (a.size !== b.size)
            return difference('container-size', path, { current: a.size, saved: b.size });
          if (a instanceof Map) {
            const entries = [];
            for (const [key, value] of a) {
              if (['function', 'symbol'].includes(typeof key))
                return difference('unsupported-map-key', path);
              if (key === null || typeof key !== 'object') {
                if (!b.has(key)) return difference('map-key', path);
                work.push({ a: value, b: b.get(key), path: [...path, 'value'] });
              } else entries.push([key, value]);
            }
            const candidates = [...b].filter(([key]) => key !== null && typeof key === 'object');
            if (entries.length !== candidates.length) return difference('map-key-type', path);
            work.push({ unordered: 'map', entries, candidates, path });
          } else {
            const entries = [];
            for (const value of a) {
              if (['function', 'symbol'].includes(typeof value))
                return difference('unsupported-set-member', path);
              if (value === null || typeof value !== 'object') {
                if (!b.has(value)) return difference('set-member', path);
              } else entries.push(value);
            }
            const candidates = [...b].filter(
              (value) => value !== null && typeof value === 'object',
            );
            if (entries.length !== candidates.length) return difference('set-member-type', path);
            work.push({ unordered: 'set', entries, candidates, path });
          }
        } else if (
          !Array.isArray(a) &&
          !(a instanceof Date) &&
          prototype !== Object.prototype &&
          prototype !== null
        )
          return difference('unsupported-object', path);
        const failed = ownFields(a, b, path, work, Array.isArray(a));
        if (failed) return failed;
      }
    }
    return null;
  };
  return search([{ a: current, b: saved, path: [] }]);
}
