# UTF-8 clipboard and diagnostic output

The fixed game engine implements main `0x40F` and `0x410` as one-argument
formatted UTF-8 consumers. Both return void control code 2 and leave the result
word untouched. Their IDs are outside the reviewed SDK table.

`NativeUnicodeOutput` executes the complete original handlers, KCS formatter,
UTF-8 walker, UTF-16 conversion and CRT logger. It replaces only the individual
OS CALL instructions in these handlers with private browser transport traps.
It does not replace the handlers or globally override the engine logger.

`0x40F` changes each backslash-plus-`n` byte pair to CRLF, opens the clipboard using
the caller window, empties it and submits `CF_UNICODETEXT` (13). The original
allocation uses movable, zeroed global memory sized as twice the UTF-16 length
plus eight bytes. An unavailable clipboard skips the remaining calls. Allocation
failure occurs after the empty operation. Failed data submission retains the
original caller allocation until process teardown. A successful submission
transfers the copied text to the external clipboard service.

The browser supplies `open`, `empty`, `write` and `close` with explicit success
results. `empty` performs a real platform write of an empty string. Browser API
availability and permission failures remain platform outcomes. Checkpoint
restore does not overwrite the external OS clipboard. A temporary caller
projection contains the World's virtual HWND at the original offset +120; this
does not claim that the complete native Script constructor ran.

`0x410` escapes percent bytes with its original rule, converts through the same
UTF-8 walker, then calls the original wide CRT logger. That logger formats up to
500 UTF-16 units and converts its diagnostic-window message to CP932. Its message
is sent before the final CRLF append. The browser Diagnostics provider acts as
the available debug window: the three original console globals are projected
only during this call and restored in `finally`, including host failures. This
is a platform mapping, not full Win32 GUI initialization.

The converter retains only the first UTF-16 code unit of a four-byte UTF-8
sequence. It also has permissive invalid-byte and `FF FF` sentinel behavior;
neither interface uses a standard JavaScript UTF-8 decoder to substitute these
semantics. Browser clipboard APIs may normalize lone surrogates when sending
text to the OS; the host receives the exact original UTF-16 string first.

`scripts/verify-native-unicode-output.mjs` compares **252 complete original
handler calls and 2,772 checks** across 42 authored inputs and normal/refused/
failed clipboard paths. It compares complete VM data/shared memory, formatter
scratch, output bytes, control, unchanged result words, platform call order,
owned global buffers and restored console gates. The raw side retains the
original IAT calls. OS clipboard/global-memory and the diagnostic window are
explicit platform boundaries. Nonterminated CRT output at or beyond the
500-unit limit and native range-check abort inputs are not described as defined
text results.

Public optional tests exercise the original formatter/converter, external
effects, failure cleanup, diagnostic-host exceptions, a fresh process and a fresh
World with current VM RAM. These tests separately verify the Runtime installer,
window identity and checkpoint host-trap reconstruction.
