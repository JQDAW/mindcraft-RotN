# Third-party code in forge-bridge

None. ADR 0003 decision 6 requires a BSD-3 notice here for any ProtoDef type definitions copied from `minecraft-protocol-forge`, but no such code was copied. The codecs were written from the protocol layouts in `docs/research/fml-spec.md`.

Behavioural references that were read, with nothing copied or translated from them:

- The Forge 1.12.x source (LGPL-2.1), as summarized in the spec.
- The RoughlyEnoughIDs 2.2.2 class files (MIT), disassembled with `javap` to confirm the wire layouts.

The runtime dependencies resolve from the root `node_modules`. Only minecraft-data is a direct dependency of the root `package.json`. minecraft-protocol comes in through mineflayer. protodef, prismarine-nbt, lodash.merge and prismarine-auth (used by the login tool only) come in through minecraft-protocol. smart-buffer (tests only) comes in through prismarine-chunk. The lockfile pins all of them; making them direct dependencies is a request to the lead.
