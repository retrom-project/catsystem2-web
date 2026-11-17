// SPDX-License-Identifier: MPL-2.0
export function sameNativeBitmap(process, first, second) {
  const data = first && process.load(first);
  return Boolean(data && second && process.load(second) === data);
}
