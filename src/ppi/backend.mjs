// SPDX-License-Identifier: MPL-2.0
// The dynamically loaded CPU dependency is GPL-2.0; see NOTICE.md.
import { PPI_BACKEND_SHA256 } from './backend-artifact.mjs';
let pending;
export function loadUnicorn() {
  if (!pending)
    pending = (async () => {
      if (typeof document === 'undefined') {
        let module;
        try {
          module = await import(new URL('../../vendor/unicorn_x86.js', import.meta.url));
        } catch (error) {
          if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
          module = await import(new URL('../../.local/vendor/ppi/unicorn_x86.js', import.meta.url));
        }
        const factory = module.default;
        return factory();
      }
      if (typeof globalThis.MUnicorn !== 'function') {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = new URL('../../vendor/unicorn_x86.js', import.meta.url).href;
          script.integrity = `sha256-${btoa(String.fromCharCode(...PPI_BACKEND_SHA256.match(/../g).map((n) => parseInt(n, 16))))}`;
          script.onload = resolve;
          script.onerror = () => {
            script.remove();
            reject(new Error('Failed to load the fixed x86 execution backend'));
          };
          document.head.append(script);
        });
      }
      if (typeof globalThis.MUnicorn !== 'function')
        throw new Error('x86 backend factory is absent');
      return globalThis.MUnicorn();
    })().catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
