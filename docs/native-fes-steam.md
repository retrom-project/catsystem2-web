# FES Steam commands

The frozen game engine declares six FES Steam commands. The frozen SDK does not
declare this extension; its absence is not filled by aliasing game handlers.

| Command                         | Game handler | FES behavior                                                                          |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| `steam_init`                    | `785DB0`     | Initialize the application singleton; the FES handler returns zero.                   |
| `steam_achievement name`        | `785DC0`     | If the first token and manager exist, call its achievement operation.                 |
| `steam_achievement_reset`       | `785E20`     | Call the existing manager's reset operation.                                          |
| `steam_isbroadcast output`      | `785E40`     | Write the application's broadcast flag according to the manager/author-mode branches. |
| `steam_isenable output`         | `785EC0`     | Write the existing manager's enabled state, or zero when the manager is null.         |
| `steam_enablescreenshot [word]` | `785F40`     | Evaluate the first token, defaulting to one, and pass it to an existing manager.      |

The common FES token getter performs native tokenization, an optional single
string-bank expansion and then SCRIPT/replace. `$str0` is an index reference;
`$str(0)` is not that native syntax. An achievement token is not re-tokenized or
expanded recursively after replacement. SCRIPT/replace uses the configuration's
single recovered rule set, separately from the GlobalStrings UI lookup table.

Broadcasting is not the Boolean returned by a browser Steam provider. With a
manager, the original code may call the SDK observation method, ignores that
result and writes zero unless author mode is active. Its enabled branch and
the null-manager branch ultimately read the application's own word at owner
offset 163524 through `713F70`. A failed SDK initialization still leaves the
original manager allocated. The World therefore keeps manager existence,
enabled state and application flag separate. Initialization refreshes the FES
facade's manager reference before subsequent commands execute.

All calls use the World's single Steam session. A browser without a provider
does not fabricate achievements or SDK availability. The facade owns any
provider initialization, SDK calls and shutdown; FES does not construct a
second session or use game-specific achievement names.
FES names retain the original token bytes through single string-bank expansion
and SCRIPT replacement. CP932 names, raw UTF-8 string-bank values and invalid
bytes are not decoded and re-encoded before the Steam cache lookup. They remain
distinct byte keys. The lower cache and provider lifecycle are documented in
[native Steam](native-steam.md).

`verify-native-fes-steam.mjs` executes the six original game handlers and the
original common lexer for 90 combinations of null/failed/ready managers and
missing, grouped and quoted arguments. It compares manager calls, variable
writes and return values with the production FES interpreter. Expression
evaluation, variable storage, string-bank expansion, SCRIPT replacement and
the manager operations themselves are explicit supplied boundaries. These
checks do not establish the lower Steam manager's cache, stats lifecycle or
external provider behavior; those require their own native and host evidence.

Public FES fixtures cover initialization followed by immediate queries,
unavailable/ready sessions, both author-mode branches, ignored observation
results, single string substitution, SCRIPT replacement and screenshot defaults.
Raw executable regions, traces and proprietary resources remain ignored.
