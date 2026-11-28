# Default Settings font bytes

`NativeWorld.nativeDefaultFontBytes()` synchronously returns an independent
plain Uint8Array containing the original CP932 font-name bytes. `fontcom default` reads this true default Settings boundary. Layout font/fontind
read the distinct current Settings font and must not use this accessor.

An explicit `host.nativeDefaultFontBytes(world)` provider may mount the real
default-font authority. If no provider is installed, the World borrows only an
already existing native engine's `configurationMemory` and
`refs.defaultSettings`. It does not ensure/create that engine, evaluate a native
FES handler, substitute `configuration.font.name`, or retain another default
font/tree/snapshot. Missing view or non-synchronous/non-byte provider output is
an explicit error. A provider's returned C-string prefix is copied even for a
Node Buffer; caller mutation cannot alter an earlier result.

`NativeConfigurationMemory.defaultFontBytes(settings)` is the existing D8 data
view's read-only accessor. It reads the font field at
`settings + layout.font - layout.settingsOffset` using current ABI declarations:

| Frozen profile | Field relative to Settings | Original field                                                              |
| -------------- | -------------------------: | --------------------------------------------------------------------------- |
| SDK74          |        53288 - 528 = 52760 | 64 narrow bytes; copy unchanged to its first NUL                            |
| Game76         |       64528 - 1048 = 63480 | 128 UTF16LE bytes; convert to CP932 at the original wide-to-narrow boundary |

The original Game `fontcom default` reads its default Settings font source;
its helper uses WideCharToMultiByte code page932. The SDK copies the narrow
field directly, including byte values that must not be decoded and re-encoded.
The active font/proportional settings remain a different authority. An
unterminated native field is outside the recovered valid Settings contract and
is rejected rather than reading unrelated adjacent memory.

This interface retains an explicit D8 default-Settings data dependency. It does
not complete the Phase8 startup/default-tree migration. When that work creates
the real pureJS default tree, the same provider must read that one authority;
no compatibility version, shadow state or second snapshot is introduced.

`tests/native-default-font.test.mjs` checks both existing ABI views against
authored memory, distinct active/default values, exact narrow/wide bytes,
Buffer ownership, synchronous provider behavior and missing-view failure in an
ordinary NativeWorld. Its borrowed-memory fixture is a data-view test, not a
claim to implement the original engine or the remaining platform frontends.
