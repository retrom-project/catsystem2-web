# Native task commands

`main28B`, `28D`, `28E` and `28F` send messages through the caller's Top namespace, including target zero. They retain the original no-result control code 2. `28B` sends message 24 with `0xffffffff`: BaseTask resets its exit-code word, while Top consumes the message without this mutation. `28D` sends the plane VRAM mode as a raw DWORD. Neither wrapper substitutes a task existence check for the original routing operation.

`28E` formats two byte strings into separate 256-byte buffers and sends their addresses as wParam and lParam. `28F` formats one byte string and sends it as lParam. Empty strings are valid. CP932, UTF-8 and invalid text bytes survive transport without a decode/re-encode step. The original simple-plane handler deliberately does nothing for these two messages; other receiver types retain their own handlers. Formatted output that overflows the original scratch allocation raises an explicit resource error.

`2B6` sends message 29 with a raw DWORD in lParam. BaseTask stores the word in its user value field, while Top leaves the field unchanged. The message resolves a reused native ID in the calling Top, including after a fresh World restore. The original SDK and game wrappers are `529040` and `65A650`.

`241` always addresses the caller's Top with its raw word (SDK wrapper
`51BE00` sends message 38, game `6507C0` sends message 40). The corresponding
Top receiver owns the word at offset 392 or 652. Two Tops keep their own
values through a fresh World restore.

The adjacent `main291` remains owned by the drawing module. Its output word starts at zero before message 307 can write an image handle. A missing route or entry therefore preserves zero. The SDK uses message 302 here, while the game uses 307; the browser's message router uses the game numbering throughout.

`scripts/verify-native-task-commands.mjs` executes all seven complete original wrappers in each fixed PE, with 3,500 comparisons per profile. It compares the actual formatter, VM translator, routing words, raw string bytes, optional query writes, complete VM memory and output canaries. Public World tests exercise reused native IDs in two Top namespaces, zero and missing targets, real plane state, drawing image queries and a fresh World restore.
