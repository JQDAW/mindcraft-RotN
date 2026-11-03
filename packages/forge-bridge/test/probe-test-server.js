// A fake RotN 3.3.4 test server for probe P1's end-to-end tests: the real g1-driver (with
// tools/probe-commands.mjs) logs in to it through forge-bridge, and a scenario drives it through
// the runner's server interface:
//
//   server.console(cmd, waitS) -> the log lines the command printed, as a 1.12 server prints them
//   server.log(n)              -> the last n lines of the server log ([HH:MM:SS] [thread/LEVEL] [logger]: msg)
//
// It knows the commands on harness-ops' P1 console allowlist (test/runner/lib/probe.mjs): say, seed,
// gamerule, time, tp, clear (all, or count-only with maxCount 0), give, effect hunger, setblock,
// testforblock and tell. A console `tell` reaches the bot as the 1.12 whisper component, from
// "Server". Behind it: the fake Forge server (REID, the real Run A ids and the fastbench override),
// a stone floor at y 64-65 around P1's landing spot (-45 66 -66), and fake-containers.js (crafting,
// FastWorkbench, placing, eating; a model of the server code read with javap, not a server).
// Loopback only.

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { startFakeForgeServer } from './fake-forge-server.js';
import { attachFakeContainers } from './fake-containers.js';
import { pinnedModList, runAId } from './helpers.js';
import { I, B, registries } from './craft-world.js';
import { Writer } from '../src/wire.js';

const require = createRequire(import.meta.url);
const BitArray = require('prismarine-chunk/src/pc/common/BitArray');
const { SmartBuffer } = require('smart-buffer');

export const P1_SEED = '1880465901402976865';
export const P1_SPAWN = [-44.5, 66, -65.5];
const FLOOR_TOP = 65;
const DS = 'net.minecraft.server.dedicated.DedicatedServer';

// Items the console can give and count, by registry name; blocks setblock/testforblock know.
const ITEMS = {
    'pyrotech:rock': I.rock, 'minecraft:stick': I.stick, 'minecraft:planks': I.planks, 'minecraft:bread': I.bread,
    'minecraft:cobblestone': I.cobble, 'pyrotech:crude_axe': I.crudeAxe, 'contenttweaker:crafting_tools': I.craftingTools,
    'minecraft:crafting_table': I.table, 'minecraft:stone_pickaxe': I.stonePickaxe,
};
const BLOCKS = { 'minecraft:air': 0, 'minecraft:stone': B.stone, 'minecraft:crafting_table': B.table, 'minecraft:cobblestone': B.cobble };
const BLOCK_NAME = Object.fromEntries(Object.entries(BLOCKS).map(([n, id]) => [id, n]));
const DISPLAY = { 'pyrotech:rock': 'Rock', 'minecraft:stick': 'Stick', 'minecraft:planks': 'Oak Wood Planks', 'minecraft:bread': 'Bread', 'minecraft:cobblestone': 'Cobblestone' };

/** A chunk section 4 (y 64-79) with stone at y 64 and 65, air above. */
function floorChunk() {
    const data = new BitArray({ bitsPerValue: 16, capacity: 4096 });
    for (let i = 0; i < 512; i++) data.set(i, B.stone << 4);
    const sb = new SmartBuffer();
    data.writeBuffer(sb);
    const longs = sb.toBuffer();
    const w = new Writer().u8(16).varint(0).varint(longs.length / 8).bytes(longs)
        .bytes(Buffer.alloc(2048, 0xff)).bytes(Buffer.alloc(2048, 0xff));
    w.varint(256);
    for (let i = 0; i < 256; i++) w.varint(1); // REID VarInt biomes
    return w.toBuffer();
}

const two = (n) => String(n).padStart(2, '0');
function stamp() { const d = new Date(); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; }
const fmt = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * @param {{ name?: string, placeDelayMs?: number }} [opts]
 * @returns {Promise<{ host: string, port: number, server: { console: (cmd: string, waitS?: number) => string[], log: (n?: number) => string[] },
 *           containers: () => object|null, logLines: string[], close: () => Promise<void> }>}
 */
export async function startProbeTestServer({ name = 'FRCFLD', placeDelayMs = 30 } = {}) {
    const logLines = [];
    const add = (msg, logger = DS, thread = 'Server thread') => { logLines.push(`[${stamp()}] [${thread}/INFO] [${logger}]: ${msg}`); };
    let client = null;
    let containers = null;
    let teleportId = 1;
    let position = [...P1_SPAWN];
    const world = new Map(); // "x,y,z" -> block registry name, for blocks that differ from the floor
    let placedSeen = 0;

    const fake = await startFakeForgeServer({
        modList: pinnedModList(), registries: registries(), reid: true,
        onJoin: (c) => {
            client = c;
            add(`UUID of player ${name} is ${c.uuid}`, 'net.minecraft.server.network.NetHandlerLoginServer', `User Authenticator #${teleportId}`);
            c.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 2, maxPlayers: 10, levelType: 'default', reducedDebugInfo: false });
            for (let cx = -4; cx <= -2; cx++) for (let cz = -6; cz <= -3; cz++) {
                c.write('map_chunk', { x: cx, z: cz, groundUp: true, bitMap: 1 << 4, chunkData: floorChunk(), blockEntities: [] });
            }
            containers = attachFakeContainers(c, {
                table: null,
                recipes: [
                    { shaped: [[I.rock, I.stick], [I.stick, null]], result: { id: I.crudeAxe } },
                    { shapeless: [I.crudeAxe, I.rock, I.stick], result: { id: I.craftingTools } },
                    { shapeless: [I.planks, I.craftingTools], result: { id: I.table } },
                    { shaped: [[I.rock, I.rock, I.rock], [null, I.stick, null], [null, I.stick, null]], result: { id: I.stonePickaxe } },
                ],
                blocks: { [I.cobble]: B.cobble },
                foods: { [I.bread]: 5 },
                maxStack: { [I.crudeAxe]: 1, [I.craftingTools]: 1, [I.stonePickaxe]: 1 },
                placeDelayMs,
                inventory: {},
            });
            containers.sendInventory();
            c.write('position', { x: position[0], y: position[1], z: position[2], yaw: 0, pitch: 0, flags: 0, teleportId: teleportId++ });
            add(`${name}[/127.0.0.1:${c.socket?.remotePort ?? 0}] logged in with entity id 1 at (${position.join(', ')})`, 'net.minecraft.server.management.PlayerList');
            add(`${name} joined the game`);
            c.on('chat', (p) => add(`<${name}> ${p.message}`));
            c.on('position', (p) => { position = [p.x, p.y, p.z]; });
            c.on('position_look', (p) => { position = [p.x, p.y, p.z]; });
            // The real server logs 'lost connection' under NetHandlerPlayServer; the harness parsers read only the message.
            c.on('end', () => { add(`${name} lost connection: Disconnected`, 'net.minecraft.network.NetHandlerPlayServer'); add(`${name} left the game`); });
        },
    });

    const key = (x, y, z) => `${x},${y},${z}`;
    // The bot's placements (fake-containers' state.placed) go into the world map in order.
    const sync = () => {
        const placed = containers?.state.placed ?? [];
        for (; placedSeen < placed.length; placedSeen++) {
            const p = placed[placedSeen];
            world.set(key(p.target.x, p.target.y, p.target.z), BLOCK_NAME[p.blockId] ?? `#${p.blockId}`);
        }
    };
    const blockAt = (x, y, z) => world.get(key(x, y, z)) ?? (y === 64 || y === FLOOR_TOP ? 'minecraft:stone' : 'minecraft:air');
    const online = () => client && !client.ended && containers;

    function run(cmd) {
        let m;
        if ((m = /^say (.*)$/.exec(cmd))) return add(`[Server] ${m[1]}`);
        if (cmd === 'seed') return add(`Seed: ${P1_SEED}`);
        if ((m = /^gamerule (\S+) (\S+)$/.exec(cmd))) return add(`Game rule ${m[1]} has been updated to ${m[2]}`);
        if (cmd === 'time set day') return add('Set the time to 1000');
        if (!online()) return add(`That player cannot be found`);
        if ((m = new RegExp(`^tp ${name} ~ ~ ~$`).exec(cmd))) return add(`Teleported ${name} to ${position.map(fmt).join(', ')}`);
        if ((m = new RegExp(`^tp ${name} (-?\\d+) (-?\\d+) (-?\\d+)$`).exec(cmd))) {
            position = [Number(m[1]) + 0.5, Number(m[2]), Number(m[3]) + 0.5];
            client.write('position', { x: position[0], y: position[1], z: position[2], yaw: 0, pitch: 0, flags: 0, teleportId: teleportId++ });
            return add(`Teleported ${name} to ${position.map(fmt).join(', ')}`);
        }
        if (cmd === `clear ${name}`) return add(`Cleared the inventory of ${name}, removing ${containers.clearAll()} items`);
        if ((m = new RegExp(`^clear ${name} (\\S+) (-?\\d+) 0$`).exec(cmd))) {
            const id = ITEMS[m[1]];
            const n = id === undefined ? 0 : containers.count(id, Number(m[2]));
            return add(n ? `${name} has ${n} items that match the criteria` : `Could not clear the inventory of ${name}, no items to remove`);
        }
        if ((m = new RegExp(`^give ${name} (\\S+) (\\d+) (\\d+)$`).exec(cmd))) {
            const id = ITEMS[m[1]];
            if (id === undefined) return add(`There is no such item with name ${m[1]}`);
            containers.give(id, Number(m[2]), Number(m[3]));
            return add(`Given [${DISPLAY[m[1]] ?? m[1]}] * ${m[2]} to ${name}`);
        }
        if ((m = new RegExp(`^effect ${name} minecraft:hunger (\\d+) (\\d+)$`).exec(cmd))) {
            containers.setFood(14); // a strong, short hunger effect: food under 20 for the eat step
            return add(`Given Hunger (ID 17) * ${m[2]} to ${name} for ${m[1]} seconds`);
        }
        if ((m = /^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
            const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
            const id = BLOCKS[m[4]];
            if (id === undefined) return add(`There is no such block with name ${m[4]}`);
            world.set(key(x, y, z), m[4]);
            client.write('block_change', { location: { x, y, z }, type: id << 4 });
            if (m[4] === 'minecraft:crafting_table') containers.setTable({ x, y, z });
            else if (containers.state.table && containers.state.table.x === x && containers.state.table.y === y && containers.state.table.z === z) containers.setTable(null);
            return add('Block placed');
        }
        // A failed testforblock prints registry names here; the real server prints display names. The
        // harness parsers read only the success line and the 'The block at x, y, z ' prefix.
        if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+)(?: \d+)?$/.exec(cmd))) {
            const at = blockAt(Number(m[1]), Number(m[2]), Number(m[3]));
            return add(at === m[4] ? `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}` : `The block at ${m[1]}, ${m[2]}, ${m[3]} is ${at} (expected: ${m[4]})`);
        }
        if ((m = new RegExp(`^tell ${name} (.+)$`).exec(cmd))) {
            client.write('chat', { message: JSON.stringify({ translate: 'commands.message.display.incoming', with: ['Server', { text: m[1] }], color: 'gray', italic: true }), position: 0 });
            return add(`You whisper to ${name}: ${m[1]}`);
        }
        return add('Unknown command. Try /help for a list of commands');
    }

    const server = {
        console(cmd) {
            sync();
            const from = logLines.length;
            run(cmd);
            return logLines.slice(from);
        },
        log: (n = 200) => { sync(); return logLines.slice(-n); },
    };
    return {
        host: '127.0.0.1', port: fake.port, server, logLines,
        containers: () => containers,
        close: () => fake.close(),
    };
}

/** The item id behind a registry name in this world (for tests). */
export const probeItemId = (registryName) => ITEMS[registryName] ?? runAId(registryName);
