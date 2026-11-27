# Native argument decoders

Main `21B` reads raw VM text as an expression, comma-separated bracketed list, or bracketed range, writing DWORD values to a VM destination. It uses the caller's existing variable bank and selected private context; evaluation can change variables. Capacity is signed. Range endpoints and increment retain signed DWORD behavior, including wrap at `7FFFFFFF`. List output may overlap and change the source before the next token is read. Empty and malformed brackets follow the original parser's observed behavior rather than a generic CSV or JavaScript array grammar.

Main `21C` returns a byte offset after a requested number of runs of ASCII spaces, or `FFFFFFFF` when it runs out of separators. Index zero returns zero even when VM pointer translation fails. Leading/trailing spaces matter; tabs and grouped expressions are not separators. It does not perform KCS formatting or return a token length.

`scripts/verify-native-arguments.mjs` executes the complete original wrappers, VM translation and bank expression evaluator in each fixed PE. Each passes 8,596 comparisons across 2,149 calls, covering all VM memory domains, complete source/output canaries, overlapping outputs, eager assignments, signed capacities, wrap, unusual bracket forms, leading/trailing spaces, CP932/UTF-8/invalid bytes and failed mappings. No tokenizer or expression helper is replaced. Runtime tests additionally restore selected private contexts into a fresh runtime and continue name lookup and writes independently.

The fixed SDK23 `9f3a5ad0…` bridge in `sdk23-string-data.test.mjs` uses two
Main66-created, Main143-loaded child Scripts of an actual bank-owning caller.
Their ordinary Script updates select separate inherited private contexts. Actual
Main539 list/range results and assignments feed Main213 and Main658 consumers;
Main212 supplies the expression `@` value, Main540 returns a CP932 byte offset,
and an aliased argument destination observes the preceding write. The original
Main609/610 backup and restore are followed by a supplier read after both private
owners retire. Five independent cold points retain the current owner/context
identity and resume the same later VM instructions. No context is registered or
selected by the test itself.

The normal original bridge executes 35 target calls inside 60 total GCALLs and
seven parent Script updates. The original Base child phase precedes its parent's
VM, so newly loaded children execute on the next update. An initial observer
incorrectly asserted their authored marker before this first execution; its raw
failure is retained separately. Correcting the observation required no scheduler,
bank, expression or checkpoint change. The current tests also retain the existing
capacity-byte backup contract; this small bridge does not extend the previously
bounded expression grammar or qualify arbitrary token counts.
