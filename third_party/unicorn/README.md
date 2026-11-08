# x86 PPI execution backend

The CPU backend is built from Unicorn.js commit
[`560284c59c11c8d6c94d537f4354339f069ddcdf`](https://github.com/AlexAltea/unicorn.js/tree/560284c59c11c8d6c94d537f4354339f069ddcdf)
and its Unicorn submodule commit
[`8028ec436f2d9376525352dd38ed9ed6b9f6be10`](https://github.com/unicorn-engine/unicorn/tree/8028ec436f2d9376525352dd38ed9ed6b9f6be10).
The wrapper commit also includes the QEMU5.0.1 baseline, the upstream TCI and
helper-adapter patches, JavaScript bindings and build scripts.

Nine local patches address CPU execution and performance problems observed while running original
PPI DLLs. `tci-loads.patch` implements signed8-bit and signed/unsigned16-bit TCG
loads, including the load used by SSE2 `pextrw`. `tci-helper-temporaries.patch`
releases the wide temporaries allocated for the WASM helper-call ABI. Without
that release, long native math blocks overflow the TCG temporary pool. `page-protection-cache.patch` invalidates translated code and the software TLB
when page permissions change; otherwise previously translated code can still
execute after its EXEC permission is revoked. `host-code-cache.patch` invalidates
translated instructions when the host writes executable memory, so an existing
translation cannot retain old immediate values or trap cleanup instructions.
`sse-status.patch` preserves masked SSE sticky exception flags in CPU register
reads, STMXCSR and FXSAVE; restores them on LDMXCSR; applies FTZ to SSE state;
and records arithmetic denormal operands with the reviewed exception priority.
Its scalar arithmetic/conversion cases are compared with an independently
authored Windows hardware oracle under every rounding/DAZ/FTZ combination.
`count-only-hooks.patch` uses a dedicated instruction-budget helper that retains
lazy flags until the exact stop. User code hooks still receive and may change
materialized flags; their final flags are read back before execution resumes.
The TCI spill array is bounded by the translator's actual temporary limit so
long instrumented x87 blocks fit. Authored budget, flag-mutating hook and long
x87 cases accompany the hardware SSE and original-plugin comparisons.
`ram-views.patch` exposes a checked, contiguous RAM span for a VM shared-memory
binding. MMIO and internal COW snapshots are rejected. The host reacquires
borrowed views after WASM memory growth and invalidates exposed executable
ranges before CPU execution. Guest pointers and ownership remain unchanged.
`count-budget-side-exits.patch` emits an interpreter budget operation instead of
calling C and spilling architectural globals before every instruction. Its rare
budget-exhaustion path captures every pending global from its register or
constant location before stopping at the exact instruction PC. Full user code
hooks retain their materialized-state path. Counted runs are compared with full
instruction callbacks, randomized flag-changing hooks and the hardware SSE
oracle; real-model DrawUP records and final pixels remain unchanged.
`host-instruction-budget.patch` exposes the current execution segment's budget
and an atomic charge for extra instructions simulated by a host code hook.
The hook instruction is already counted. Insufficient, idle and stopping
segments decline without changing CPU or guest memory. Uncounted segments
accept without changing their unused counter. Enabling counting invalidates
blocks translated in uncounted mode. Each native resume or nested host call
starts its own segment, so no counter is carried across a suspended callback.
These patches are modifications to upstream GPL code and follow its license.

Build with the pinned Emscripten3.1.74 toolchain:

```sh
python3 scripts/prepare-ppi-backend.py --emsdk /path/to/emsdk-3.1.74
```

The script creates `.local/vendor/ppi/unicorn_x86.js`, its SHA-256/source manifest,
the upstream license, and `corresponding-source.tar.gz`. Generated native/WASM
artifacts and downloaded source checkouts remain ignored. The archive contains
the complete patched wrapper, C/core source, QEMU baseline, original build
scripts, local patches and this project's prepare script. It is the source for
the generated backend, not a floating repository pointer.

The backend is GPL-2.0 software. Existing MPL-2.0 source notices remain intact;
the combined distribution must satisfy the applicable GPL and MPL terms. A
distributed build must retain the component licenses and offer the generated
corresponding-source archive with the same access as the JavaScript/WASM
backend. Copy the manifest, `COPYING`, and archive to that distribution alongside
the backend. A development-only local source checkout does not fulfill the
distribution obligation. The Emscripten toolchain itself is obtained separately
from its official version3.1.74 release.

The npm2.1.4 x86 bundle was used to establish feasibility; release builds use
the pinned source plus the maintained patches above. Its API remains the
upstream `MUnicorn` factory. No Windows binary, game asset, or CatSystem2 SDK
source is included in the backend or corresponding-source archive.
