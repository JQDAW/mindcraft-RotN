// @mindcraft-rotn/forge-bridge: Forge 1.12.2 (FML protocol 2) client plugin for
// node-minecraft-protocol, aware of RoughlyEnoughIDs. See README.md and ADR 0003.

export { attachForgeBridge, FML_TAG, DROPPABLE_ON_PARSE_ERROR } from './src/bridge.js';
export { createForgeConnect } from './src/connect.js';
export { ClientHandshake, ClientState, CORE_CHANNELS } from './src/handshake.js';
export * as fmlhs from './src/fml-hs.js';
export * as channels from './src/channels.js';
export { RegistrySnapshot } from './src/registries.js';
export { modListFromPing, loadModListFile, hasReid, findMod, diffModLists, REID_MODID } from './src/modlist.js';
export { buildCustomPackets, createTypeReader, reidEffectIdFromTail, triumphTypes, OPAQUE_PACKET_TYPE } from './src/reid.js';
export { classifyKick, classifySocketError, chatToText, createRestartPolicy, EXIT } from './src/kicks.js';
export { CaptureWriter, readCapture, redactBuffer } from './src/capture.js';
export { throttleMovement, mergeMovement } from './src/movement-throttle.js';
export { forgeOptionsFromEnv } from './src/env.js';
export { assertMicrosoftAuthSafe, quietMsaCodeHandler, debugValueEnables, patternMayEnablePrefix, PRISMARINE_AUTH_DEBUG_NAMESPACE } from './src/auth-guard.js';
export { assertOutsideGitWorkTrees, prepareSecretFolder, findGitWorkTree, realLocation } from './src/secret-folder.js';
export { decideAgentExit, readExitReason, writeExitReason, recordAgentExit, createRequestedRestartGuard, REQUESTED_RESTART } from './src/exit-contract.js';
export { extendRegistry, applyProperties } from './src/registry-extension.js';
export { spawnFmlEntity, attachFmlEntities, fmlEntityName } from './src/fml-entities.js';
export { METADATA_SERIALIZER_TYPES, rotnMetadataSerializers } from './src/reid.js';
