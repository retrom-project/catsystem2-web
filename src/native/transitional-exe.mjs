// SPDX-License-Identifier: MPL-2.0
export function requireTransitionalHost(host, profile, operation) {
  if (!host || typeof host.open !== 'function')
    throw new Error(
      `Unmigrated ${profile} operation ${operation} requires an explicitly injected transitional EXE host`,
    );
  return host;
}
