// A node-minecraft-protocol `connect` option that pings the server first, then
// attaches the forge bridge with the server's own ModList, then opens the
// socket. nmp calls options.connect(client) after authentication, so the ping
// never delays the Microsoft login and tagHost is set before the handshake.

import net from 'node:net';
import dns from 'node:dns';
import { createRequire } from 'node:module';
import { attachForgeBridge } from './bridge.js';
import { modListFromPing, loadModListFile } from './modlist.js';

const require = createRequire(import.meta.url);

/**
 * @param {object} o
 * @param {string} o.host
 * @param {number} o.port
 * @param {'auto'|'on'|'off'} [o.mode='auto']  auto: attach if the ping says FML; on: require it
 * @param {string} [o.modListFile]  ping JSON used when the live ping has no mod list
 * @param {import('./capture.js').CaptureWriter} [o.capture]
 * @param {(bridge:any, source:string) => void} [o.onAttach]
 * @param {(msg:string) => void} [o.log]
 * @param {(o:object) => Promise<object>} [o.ping]  injectable for tests
 * @param {number} [o.pingTimeoutMs=15000]  per attempt; the ping is tried twice before the file fallback
 * @param {number} [o.retryDelayMs=1000]  pause between the two ping attempts
 * @param {(port:number, host:string) => import('node:net').Socket} [o.socket]  injectable for tests
 */
export function createForgeConnect(o) {
    const {
        host = 'localhost', port = 25565, mode = 'auto', modListFile = null, capture = null, onAttach, pingTimeoutMs = 15000,
        log = (m) => console.log(`[forge-bridge] ${m}`),
        ping = (opts) => require('minecraft-protocol').ping(opts),
        bridgeOptions = {},
        socket = (p, h) => net.connect(p, h),
        resolveSrv = (name) => dns.promises.resolveSrv(name),
        retryDelayMs = 1000,
    } = o;

    return function connect(client) {
        (async () => {
            let modList = null;
            let source = null;
            if (mode !== 'off') {
                // Two attempts: a busy server (or a loaded machine) can miss one ping.
                for (let attempt = 1; attempt <= 2 && !modList; attempt++) {
                    try {
                        const res = await ping({ host, port, version: '1.12.2', closeTimeout: pingTimeoutMs ?? 15000 });
                        modList = modListFromPing(res);
                        if (modList) source = 'ping';
                        capture?.event('status_ping', { attempt, version: res?.version, modinfoType: res?.modinfo?.type ?? null, mods: modList?.length ?? 0 });
                        break; // an answer without a mod list is final: not a Forge server
                    } catch (e) {
                        log(`status ping attempt ${attempt} failed: ${e.message}`);
                        capture?.event('status_ping_failed', { attempt, message: e.message });
                        // A loaded machine can fail a loopback connect at once (ETIMEDOUT): wait before retrying.
                        if (attempt < 2 && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
                    }
                }
                if (!modList && modListFile) {
                    modList = loadModListFile(modListFile);
                    source = 'file';
                    log(`using pinned mod list ${modListFile}`);
                }
            }
            if (modList) {
                const bridge = attachForgeBridge(client, { modList, capture, log, ...bridgeOptions });
                bridge.modListSource = source;
                onAttach?.(bridge, source);
            } else if (mode === 'on') {
                throw new Error('forge-bridge: FORGE_BRIDGE=on but no FML mod list (ping and file both failed)');
            } else {
                if (mode !== 'off') log('server is not Forge (no FML modinfo); connecting as vanilla');
                capture?.close();
            }
            const target = await srvTarget(host, port, resolveSrv);
            client.setSocket(socket(target.port, target.host));
        })().catch((e) => client.emit('error', e));
    };
}

// Same rule as nmp's tcp_dns.js: try an SRV record only for the default port
// and a hostname that is not an IP or localhost.
export async function srvTarget(host, port, resolveSrv) {
    if (port !== 25565 || net.isIP(host) !== 0 || host === 'localhost') return { host, port };
    try {
        const records = await resolveSrv(`_minecraft._tcp.${host}`);
        if (records?.length) return { host: records[0].name, port: records[0].port };
    } catch { /* no SRV record: connect directly */ }
    return { host, port };
}
