// Mod GUIs that Forge opens with an FML OpenGui message instead of vanilla
// open_window, but whose container is a vanilla one. For those the bridge emits
// the open_window that a vanilla server would have sent, so mineflayer creates
// the window as usual (bot.currentWindow, 'windowOpen', clickWindow, craft).
//
// Order on the wire (javap on Forge 14.23.5.2860 FMLNetworkHandler.openGui):
// getNextWindowId, closeContainer, write OpenGui(windowId, modId, modGuiId, x, y, z),
// set openContainer.windowId, then addListener, which sends window_items. The
// synthetic open_window is emitted while OpenGui is decoded, so it comes before
// that window_items, as a vanilla open_window would.
//
// Only containers with a proven vanilla slot layout are listed. Any other mod GUI
// is logged and left alone (fml-spec: OpenGui is logged until a ready-to-try item
// needs that GUI).

/**
 * FastWorkbench 1.7.4 (mod id 'fastbench') replaces minecraft:crafting_table in
 * RotN 3.3.4: Run A's RegistryData overrides the block and the item with
 * 'fastbench'. javap on FastWorkbench-1.12.2-1.7.4.jar from the pinned pack:
 * BlockFastBench.onBlockActivated calls player.openGui(FastBench.INSTANCE, 0, world, x, y, z),
 * and Handler.getServerGuiElement returns, for id 0, a ContainerFastBench, which
 * extends ContainerWorkbench (result 0, grid 1-9, player inventory 10-45).
 * The vanilla server sends this window as 'minecraft:crafting_table' with the
 * title container.crafting and 0 slots.
 */
export const MOD_GUI_WINDOWS = Object.freeze({
    'fastbench:0': Object.freeze({
        inventoryType: 'minecraft:crafting_table',
        windowTitle: JSON.stringify({ translate: 'container.crafting' }),
        slotCount: 0,
    }),
});

/**
 * The open_window packet for a decoded OpenGui, or null when the GUI is not known
 * to be a vanilla container (or the window id does not fit vanilla's u8).
 * @param {{modId: string, modGuiId: number, windowId: number}} msg
 */
export function modGuiWindow(msg) {
    const w = MOD_GUI_WINDOWS[`${msg.modId}:${msg.modGuiId}`];
    if (!w) return null;
    if (!Number.isInteger(msg.windowId) || msg.windowId < 1 || msg.windowId > 255) return null;
    return { windowId: msg.windowId, ...w };
}
