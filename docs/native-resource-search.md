# Native resource search

The mounted file server preserves the search modes of game `5D57A0` and SDK
`4B22C0`. `GameFiles.nativeCandidates` exposes their ordered candidates;
`readNative` reads the first mounted hit. Inventory lookup and media provenance
continue to use the existing input metadata and source identity.

| Mode | Search after a cached or update entry misses                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 1    | The exact physical loose path.                                                                             |
| 2    | The named archive, or each archive row of the named LST.                                                   |
| 3    | Each matching slot or LST row, loose directory then archive. A bare name visits registered slots in order. |
| 4    | Each matching slot or LST row, archive then loose directory. A bare name does not search named slots.      |

The logical namespace ends at the first literal `/`. A backslash remains part
of the physical path or entry name. Ordinary misses do not search another
namespace. Root `update??.INT` archives are a separate global override list:
their matching entry wins before every search mode, including an otherwise
missing namespace. Their priority comes from the one or two leading ASCII
digits after `update`; higher priorities are visited first.

Each LST row retains its own loose directory, archive slot and directory
availability. Re-registering a loaded archive replaces that slot; an older LST
row still retains its original loose directory. The server has 256 slots.
Prepared patch inputs keep their logical loose/archive identities without
altering the mounted bytes or fingerprint.

`NativeEngineFiles` first checks explicit temporary-file providers and the
shared preload cache, then follows these candidates. A writable loose candidate
uses the same Windows storage service as saves. It returns an original native
MemoryFile descriptor whose read, seek, close and destructor continue executing
in the mounted engine. The data allocation belongs to the original heap and
hidden reference count; there is no separate JavaScript cursor or lifetime.
Snapshots retain the descriptor, bytes and heap ownership in the shared process.
The original high-level byte readers also execute unchanged. They clear flag
`0x10` before opening, retain the remaining mode and treat a null output pointer
as a size query. `0x10000` suppresses their missing-file diagnostic. Tests cover
`0x13`, null filenames, output canaries and archive-only reads with `0x12`.

PPI libraries use the physical directory and extension from the `ptclpi`
entry before loading the DLL. Both original resolvers (Game `5D3810`, SDK
`4B0710`) use this Windows path instead of the archive-qualified file opener.
The browser reads the loose DLL directly, including when restoring an
instance. A same-name update entry does not replace the DLL; the test
mounts both sources and verifies the loaded image hash.

`verify-native-resource-search.mjs` executes both complete search dispatchers
with authored native slot/list records. Only physical/archive I/O and archive
membership cross the test boundary; cache is disabled and the alias map empty.
Both engines agree on all 108 search results and attempted opens. The same
probe executes each engine's actual WinMain priority-extraction block for 105
filenames without entering WinMain. Public fixtures preserve these results.
The file tests also execute original reads, last-byte seek clamping, EOF,
destruction, all search modes, preload precedence and fresh-process restoration.

Original optional filename-remapping tables and dynamic mount mutation still
need their own API and lifecycle coverage. This search evidence does not claim
those separate file-server commands are implemented.
