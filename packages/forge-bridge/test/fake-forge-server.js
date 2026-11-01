// An in-process fake Forge 1.12.2 server for offline tests. It follows
// FMLHandshakeServerState (START, HELLO, WAITINGCACK, COMPLETE, DONE): it counts
// client FML|HS messages and never reads ack values, like the real server.
// Binds to 127.0.0.1 on a random port; nothing leaves the machine.

import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import * as hs from '../src/fml-hs.js';
import { encodeRegister } from '../src/channels.js';
import { buildCustomPackets } from '../src/reid.js';

const require = createRequire(import.meta.url);
const mc = require('minecraft-protocol');

export async function startFakeForgeServer({ modList, registries, reid = true, onJoin }) {
    const server = mc.createServer({
        'online-mode': false,
        host: '127.0.0.1',
        port: 0,
        version: '1.12.2',
        // Same overrides as the bot: nmp caches compiled protocols per state, direction and
        // version only, so in one process the server and the bot share them.
        customPackets: buildCustomPackets({ reid, triumph: true }),
        keepAlive: false,
        hideErrors: true,
        motd: 'fake forge',
        beforePing: (res) => { res.modinfo = { type: 'FML', modList }; return res; },
    });
    await once(server, 'listening');
    const port = server.socketServer.address().port;
    const state = { serverHost: null, fromClient: [], hsState: 'START', kicked: null, client: null, chats: [], positions: [] };

    server.on('login', (client) => {
        state.client = client;
        state.serverHost = client.serverHost;
        if (!client.serverHost.includes('\0FML\0')) {
            state.kicked = 'no FML marker';
            client.end('This server has mods that require FML/Forge to be installed on the client.');
            return;
        }
        const send = (channel, data) => client.write('custom_payload', { channel, data });
        send('REGISTER', encodeRegister(['FML|HS', 'FML', 'FML|MP', 'FML', 'FORGE', 'jeid']));
        send('FML|HS', hs.encodeServerHello(2, 0));
        state.hsState = 'HELLO';

        // 'packet' fires before nmp's pluginChannels parses REGISTER data in place.
        client.on('packet', (p, meta) => {
            if (meta.name !== 'custom_payload') return;
            state.fromClient.push({ channel: p.channel, data: Buffer.from(p.data) });
            if (p.channel !== 'FML|HS') return;
            const m = hs.decodeHandshake(p.data);
            switch (state.hsState) {
            case 'HELLO':
                if (m.type === 'ClientHello') return; // ignored, as in Forge
                if (m.type !== 'ModList') { state.kicked = `cast failed: ${m.type}`; client.end('Handshake error'); return; }
                send('FML|HS', hs.encodeModList(modList));
                state.hsState = 'WAITINGCACK';
                return;
            case 'WAITINGCACK':
                registries.forEach((r, i) => send('FML|HS', hs.encodeRegistryData({ ...r, hasMore: i < registries.length - 1 })));
                send('FML|HS', hs.encodeAck(2));
                state.hsState = 'COMPLETE';
                return;
            case 'COMPLETE':
                send('FML|HS', hs.encodeAck(3));
                state.hsState = 'DONE';
                setImmediate(() => onJoin?.(client, state));
                return;
            default:
                return; // DONE: acks 4 and 5 are ignored
            }
        });
        client.on('chat', (p) => state.chats.push(p.message));
        client.on('position', (p) => state.positions.push(p));
        client.on('position_look', (p) => state.positions.push(p));
    });

    return {
        port,
        state,
        // Destroy sockets too: nmp's end() leaves a 30 s close timer otherwise.
        close: () => new Promise((resolve) => {
            for (const c of Object.values(server.clients)) c.socket?.destroy();
            server.close();
            setTimeout(() => {
                for (const c of Object.values(server.clients)) clearTimeout(c.closeTimer);
                resolve();
            }, 50);
        }),
    };
}
