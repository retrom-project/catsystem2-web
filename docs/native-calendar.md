# Weekday helper

Main `312` accepts three signed DWORDs for year, month and day and returns the original engine's weekday calculation. It does not validate dates. The calculation retains month/year DWORD wrap, signed division/remainder and SSE2 double-to-int conversion's `80000000` result outside the signed range. JavaScript Date normalization is not used.

`scripts/verify-native-calendar.mjs` runs the complete wrapper and original helper with standard-library substitutions disabled. Both fixed PEs pass 9,960 comparisons across 4,980 valid, invalid, extreme and deterministic random argument triples, including output canaries. A public golden fixture contains selected authored inputs and original results, dispatched through the standard native service.
