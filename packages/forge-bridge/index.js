// @mindcraft-rotn/forge-bridge: Forge 1.12.2 (FML protocol 2) client plugin for
// node-minecraft-protocol, aware of RoughlyEnoughIDs. See README.md and ADR 0003.

export { attachForgeBridge, FML_TAG } from './src/bridge.js';
export { createForgeConnect } from './src/connect.js';
export { ClientHandshake, ClientState, CORE_CHANNELS } from './src/handshake.js';
export * as fmlhs from './src/fml-hs.js';
export * as channels from './src/channels.js';
export { RegistrySnapshot } from './src/registries.js';
export { modListFromPing, loadModListFile, hasReid, findMod, diffModLists, REID_MODID } from './src/modlist.js';
export { buildCustomPackets, createTypeReader, reidEffectIdFromTail } from './src/reid.js';
export { classifyKick, classifySocketError, chatToText, EXIT } from './src/kicks.js';
export { CaptureWriter, readCapture, redactBuffer } from './src/capture.js';
export { throttleMovement, mergeMovement } from './src/movement-throttle.js';
export { forgeOptionsFromEnv } from './src/env.js';
