# JavaScript UTF-8 clipboard and diagnostic output

Main `0x40F` and `0x410` dispatch by ABI operation (`clipboard.copyUTF8` and
`log.writeUTF8`) in [`unicode-output.mjs`](../src/native/unicode-output.mjs).
Both consume one formatted VM string, return void control 2 and leave the native
result word untouched. They require no EXE, patches or transitional calls. Neither
operation is present in the reviewed SDK ABI.

The shared byte formatter runs in JS. The permissive walker retains unchecked last
continuations and stops on negative steps during output conversion. Each converted
chunk contributes only its first UTF-16 unit, so a supplementary character contributes
a lone high surrogate. `FF FF` contributes `FFFF`. BOM units remain visible. These
behaviors are compared with original code; a whole-string standard decoder would
change the observable service input.

Clipboard output changes backslash+n to CRLF, then calls the existing clipboard
service in open/empty/write/close order with the World's virtual window handle.
Open refusal ends the operation; empty/write refusal still closes it. Host errors
propagate with close in finally. Boolean outcomes remain explicit. The product's
[`BrowserNativeClipboard`](../src/native/clipboard-browser.mjs) reports real API
availability and permission outcomes. The exact UTF-16 string reaches the service;
the OS API may normalize lone surrogates. Checkpoint restoration does not overwrite
the external clipboard. Original GlobalAlloc ownership has no JS equivalent.

Log output retains the handler's percent escape and wide CRT percent-pair behavior,
including a trailing unpaired percent. The CRT stops after a `FFFF` unit; clipboard
output retains following text. The resulting text is encoded through the fixed
CP932 table and existing measured Windows best-fit exceptions, then passed as bytes
to the existing host diagnostic interface. No temporary PE console gates are needed.
Defined terminated log results below 500 UTF-16 units are supported. The original
nonterminated/overflow paths are rejected with explicit bounds errors; their stack
contents are not treated as defined output.

Independent tests drive authored normal GCALLs through JS and original full
handlers, comparing controls, output-write contract, all VM regions, handles,
task state and exact service call order/text. Oracle transports replace only
verified individual OS calls; formatter, converter and wide CRT remain original.
The oracle verifies all three console gates restore and records every PE delta;
only the reviewed formatter scratch buffer may persist, outside JS-owned state.
Public golden fixtures retain VM hashes and exact external effects, including
unavailable/refused clipboard cases. The old original-only facades and exhaustive
verifier remain under `oracle/` for CPU and allocation evidence.
