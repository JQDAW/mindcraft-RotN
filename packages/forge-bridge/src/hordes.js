// The Hordes 1.1.7 horde-event channel 'hordes_hordeevent' (skills-rotn D1b).
//
// Layout read with `javap -c -p` from mods/The-Hordes-1.12.2-1.1.7.jar and
// mods/Atlas-Lib-1.12.2-1.1.6.jar in the pinned RotN 3.3.4 server pack
// (extracted to a scratch folder outside the repo; nothing was run):
// - HordeEventPacketHandler.<clinit> 0-8: NetworkRegistry.newSimpleChannel("hordes_hordeevent"),
//   so each payload starts with one SimpleNetworkWrapper discriminator byte.
// - HordeEventPacketHandler.initPackets 0-25: disc 0 = HordeSoundMessage,
//   disc 1 = AtlasLib SimpleStringMessage, both Side.CLIENT (server to client only).
// - HordeSoundMessage.fromBytes 0-38: readDouble x, readDouble z (Vec3d(x, 0, z)),
//   then ByteBufUtils.readUTF8String sound (VarInt length + UTF-8).
//   OngoingHordeEvent.spawnWave 43/91 and 222-245: x/z is the random XZ direction
//   (DirectionUtils.getRandomDirectionVecXZ) the wave spawns along, from the player;
//   the sound defaults to Hordes.HORDE_SOUND = "hordes:horde_spawn".
// - SimpleStringMessage.fromBytes 0-5: ByteBufUtils.readUTF8String text.
//   OngoingHordeEvent.sendMessage 0-18 sends it to the event's player only, with
//   HordeStartEvent.getMessage (default "message.hordes.EventStart", tryStartEvent 121-126)
//   or HordeEndEvent.getMessage (default "message.hordes.EventEnd", stopEvent 31-36).
//   The client renders the lang key itself (config/hordes.cfg eventNotifyMode=3: title),
//   so no chat line reaches the bot.
//
// The channel is in the server's REGISTER list (captures/raw/g1-runB2) and the
// bridge registers the server's channels back by default (echoServerChannels).

import { Reader } from './wire.js';

export const HORDES_CHANNEL = 'hordes_hordeevent';
export const HORDES_DISC = Object.freeze({ SOUND: 0, NOTIFICATION: 1 });
export const HORDE_START_KEY = 'message.hordes.EventStart';
export const HORDE_END_KEY = 'message.hordes.EventEnd';

/** Decodes one 'hordes_hordeevent' payload. Throws WireError on a short payload. */
export function decodeHordes(buf) {
    const r = new Reader(buf);
    const disc = r.u8();
    if (disc === HORDES_DISC.SOUND) {
        const x = r.f64(), z = r.f64();
        return { type: 'Sound', disc, direction: { x, z }, sound: r.string() };
    }
    if (disc === HORDES_DISC.NOTIFICATION) return { type: 'Notification', disc, text: r.string() };
    return { type: 'Unknown', disc, raw: r.rest() };
}

/**
 * The structured event for bot.emit('rotn:horde', ev), or null for an unknown message.
 * - { kind: 'start', key }  the horde starts (HordeStartEvent message)
 * - { kind: 'end', key }    the horde stopped (HordeEndEvent message)
 * - { kind: 'message', key } another text (a listener changed the message)
 * - { kind: 'wave', sound, direction: { x, z } }  a wave spawns along direction from the bot
 */
export function hordeEvent(msg) {
    if (msg.type === 'Notification') {
        const kind = msg.text === HORDE_START_KEY ? 'start' : msg.text === HORDE_END_KEY ? 'end' : 'message';
        return { kind, key: msg.text };
    }
    if (msg.type === 'Sound') return { kind: 'wave', sound: msg.sound, direction: { ...msg.direction } };
    return null;
}

/** Wires a bridge's 'horde' events to bot.emit('rotn:horde', ev). Listener errors are logged. */
export function attachHordeEvents(bot, bridge, opts = {}) {
    let count = 0;
    bridge.on('horde', (msg) => {
        const ev = hordeEvent(msg);
        if (!ev) return;
        count++;
        try {
            bot.emit('rotn:horde', ev);
        } catch (e) {
            opts.log?.(`rotn:horde ${ev.kind} listener threw: ${e?.message ?? e}`);
        }
    });
    return { get emitted() { return count; } };
}
