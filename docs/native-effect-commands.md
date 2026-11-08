# KCS screen-effect commands

Thirty KCS interfaces execute their complete original wrappers: `208..214`,
`238`, `355..35D`, `389` and `3C7..3CC`. They address the original screen-effect
tasks through the caller's Top namespace. SDK's two distinct message ranges
are normalized independently at the transport boundary.

Matrices and packet fields keep raw DWORD bits, original field order and the
original zero-target guards. `212` and `389` use the same persistent native
bitmap backing as the image interfaces. Their final payload flag remains
different. The three view capture interfaces preserve their original target
allocation and depth-range calling conventions.

`208` initializes its public result to zero but uses a stack-local copy of the
caller result address for the actual query. A target that leaves this word
unwritten returns that address, as the original does. The transport preserves
this distinction instead of manufacturing a successful zero query.

`scripts/verify-native-effect-commands.mjs` checks 36,048 comparisons across 7,200
complete wrapper calls in each frozen PE. It covers all thirty interfaces,
complete packets, matrix input regions, guarded invalid pointers, zero/missing
targets, optional bitmaps, unwritten queries, output canaries and complete VM
state. The probe explicitly supplies task receivers, bitmap identity and view
capture boundaries; it does not claim GPU pixels from that transport check.

The public SDK World test constructs all ten original task types and controls
them through KCS, then restores active native state into a fresh World. The
mask interfaces additionally exercise aliases of a real persistent bitmap,
the receiver's independently allocated screen-sized mask, source mutation,
replacement, each wrapper's flag, fresh restoration and separate destruction
of the receiver's mask and the Script-owned source.
The
actual callback, capture, presentation and FES lifecycle coverage is recorded
in [native screen effects](native-screen-effects.md). Bitmap ownership and the
ordinary frame capture path have their own independent tests.
