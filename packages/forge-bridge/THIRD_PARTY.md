# Third-party code in forge-bridge

None. ADR 0003 decision 6 requires a BSD-3 notice here for any ProtoDef type definitions copied from `minecraft-protocol-forge`, but no such code was copied. The codecs were written from the protocol layouts in `docs/research/fml-spec.md`.

Behavioural references that were read, with nothing copied or translated from them:

- The Forge 1.12.x source (LGPL-2.1), as summarized in the spec.
- The RoughlyEnoughIDs 2.2.2 class files (MIT), disassembled with `javap` to confirm the wire layouts.

The runtime dependencies resolve from the root `node_modules`. minecraft-protocol and minecraft-data are direct dependencies. protodef, prismarine-nbt, lodash.merge and prismarine-auth (used by the login tool only) are transitive dependencies of minecraft-protocol, as is smart-buffer (tests only, via prismarine-chunk).
