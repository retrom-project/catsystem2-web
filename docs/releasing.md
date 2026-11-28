# Original core releases

This repository maintains the original browser core on `main`. It has no
upstream baseline tag. Releases use immutable annotated `vX.Y.Z` tags or
numbered `vX.Y.Z-rc.N` candidates, with no leading zeroes. RC tags may identify
a reviewed feature commit; stable tags must already belong to `main`. Never
move a tag or overwrite Release assets. The first planned candidate is
`v0.1.0-rc.1`; this plan does not mean the tag or Release exists.

`retrom-fork.json` owns the repository, default branch, standalone adapter ABI
and required two assets. `package.json` remains `0.0.0-dev`; tags identify
releases rather than a separate maintained package version.

## Fixed source and assets

Use a clean, attached source checkout with Node24 and the pinned zlib/FreeType
artifacts described in the README. Do not build from a joint development tree
or include private SDK/game/audio/save inputs. The ordinary dependency closure
excludes executable oracles and their PPI backend. It includes MPL2.0, the
applicable third-party notices, font license and corresponding library source.
See `NOTICE.md` and the licenses in the archive.

After required checks, run the official builder twice against the same fixed
source and vendor input. Each destination must be a new empty absolute directory:

```sh
.github/rpg-runtime/build-candidate.sh /absolute/path/core-first
.github/rpg-runtime/build-candidate.sh /absolute/path/core-second
node scripts/prepare-core-release.mjs \
  --first /absolute/path/core-first --second /absolute/path/core-second \
  --tag v0.1.0-rc.1 --output /absolute/path/core-release
```

The comparison verifies both complete candidate identities, actual archive and
license bytes, and full tar metadata. Equal JavaScript with different tar
metadata fails. The output contains `catsystem2-web.tar.gz`,
`catsystem2-web-LICENSE.txt` and `catsystem2-web-release.json`. The last records
the commit, complete source digest, adapter ABI, asset digests and reproducibility
result. Local preparation does not create a Git tag or publish these files.

## CI and publication order

The existing quality workflow retains its source checks, complete test groups,
public browser/PPI/E-mote checks and ordinary build. The release workflow calls
that same gate, reuses its validated native-library artifacts, then runs both
complete archive builds. It validates the annotated tag against the remote,
enforces the stable `main` ancestry rule, and creates a Release without asset
replacement. The tag job creates only a temporary local build branch at the
validated commit because the candidate provenance interface records a branch.
The source and asset identities remain tied to the tag commit.

Only after the core Release exists can retrom-runtime replace its development
input with the real fixed repository/tag/commit/assets/ABI and run its formal
Provider gates. Retrom then pins the published runtime Release through its
normal pin command and revalidates formal product inputs. A PFB watcher or
local override is a development candidate, not a formal Provider release.
Push, PR, merge, tag and Release actions require the session's explicit scope.

The [handoff](handoff/catsystem2-web-pfb/README.md) describes finite validated
content and remaining SDK/host/performance limits. Releasing this core does not
claim every SDK shape, every game or the unfinished performance target.
