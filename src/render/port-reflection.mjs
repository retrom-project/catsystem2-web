// SPDX-License-Identifier: MPL-2.0
// A live descriptor snapshot lasts only for this synchronous check. Callers
// supply canonical realm-native prototypes/getter captured before providers.
const object = Object,
  array = Array,
  reflect = Reflect,
  global = globalThis,
  own = object.getOwnPropertyDescriptor,
  all = object.getOwnPropertyDescriptors,
  parent = object.getPrototypeOf,
  has = object.hasOwn,
  keys = reflect.ownKeys,
  apply = reflect.apply,
  objectPrototype = object.prototype,
  arrayPrototype = array.prototype;

const field = (record, key) => (record && has(record, key) ? record[key] : undefined);
function same(a, b) {
  return (
    field(a, 'value') === field(b, 'value') &&
    field(a, 'get') === field(b, 'get') &&
    field(a, 'set') === field(b, 'set')
  );
}
const namespaces = [
    [global, 'Object', object],
    [global, 'Array', array],
    [global, 'Reflect', reflect],
    [object, 'getOwnPropertyDescriptor', own],
    [object, 'getOwnPropertyDescriptors', all],
    [object, 'getPrototypeOf', parent],
    [object, 'hasOwn', has],
    [reflect, 'ownKeys', keys],
    [reflect, 'apply', apply],
  ],
  prototypes = [objectPrototype, arrayPrototype].map((prototype) => ({
    prototype,
    parent: parent(prototype),
    descriptors: all(prototype),
    keys: keys(prototype),
  }));
function originalReflection() {
  for (let i = 0; i < namespaces.length; i++) {
    const entry = namespaces[i],
      target = entry[0],
      key = entry[1],
      value = entry[2],
      descriptor = own(target, key);
    if (!descriptor || !has(descriptor, 'value') || descriptor.value !== value) return false;
  }
  for (let i = 0; i < prototypes.length; i++) {
    const saved = prototypes[i],
      current = all(saved.prototype);
    if (parent(saved.prototype) !== saved.parent || keys(current).length !== saved.keys.length)
      return false;
    for (let k = 0; k < saved.keys.length; k++) {
      const key = saved.keys[k];
      if (!has(current, key) || !same(current[key], saved.descriptors[key])) return false;
    }
  }
  return true;
}

// null selects the caller's original per-member path. false is a complete
// descriptor mismatch. No receiver, current descriptor or qualification leaks.
export function createNativePortMatcher(rows, brandKey) {
  // WebGL's mixins are installed on its ordinary interface prototype. Extra
  // ancestors are not part of this pure-object proof; never bulk-inspect them.
  if (rows.length !== 1) return () => null;
  const saved = [];
  let brand;
  for (let i = 0; i < rows.length; i++) {
    const prototype = rows[i][0],
      descriptors = rows[i][1];
    if (parent(prototype) !== objectPrototype) return () => null;
    saved.push({ prototype, descriptors, keys: keys(descriptors), parent: parent(prototype) });
    const descriptor = has(descriptors, brandKey) ? descriptors[brandKey] : undefined;
    if (!brand && field(descriptor, 'get'))
      brand = { prototype, getter: descriptor.get, descriptor };
  }
  return (receiver) => {
    if (!brand || !saved.length || !originalReflection()) return null;
    if (!same(own(brand.prototype, brandKey), brand.descriptor)) return null;
    // The captured WebIDL getter checks the receiver's actual platform brand;
    // a Proxy around it does not acquire that brand. Never invoke a replacement.
    try {
      if (typeof apply(brand.getter, receiver, []) !== 'number') return null;
    } catch {
      return null;
    }
    // Defensive for test ports; canonical WebIDL getter steps cannot call JS.
    if (!originalReflection() || parent(receiver) !== saved[0].prototype) return null;
    for (let i = 0; i < saved.length; i++)
      if (parent(saved[i].prototype) !== saved[i].parent) return null;

    const receiverFields = all(receiver);
    for (let i = 0; i < saved.length; i++) {
      const row = saved[i],
        current = all(row.prototype);
      for (let k = 0; k < row.keys.length; k++) {
        const key = row.keys[k];
        // Bulk dictionaries have Object.prototype. Missing keys must never
        // resolve an inherited accessor, even after a member was deleted.
        if (
          has(receiverFields, key) ||
          !has(current, key) ||
          !same(current[key], row.descriptors[key])
        )
          return false;
      }
    }
    return true;
  };
}
