// Forge 1.12.x client handshake, a copy of FMLHandshakeClientState's transitions
// (fml-spec.md section 1.3). Pure: it never touches a socket. The bridge feeds it
// decoded FML|HS messages and gives it a send(channel, buffer) callback.
//
// Each client state acks with its own ordinal:
//   HELLO                 on ServerHello: REGISTER, ClientHello, ModList
//   WAITINGSERVERDATA     on server ModList: ack 2
//   WAITINGSERVERCOMPLETE on RegistryData: collect; after the last (hasMore=false): ack 3
//   PENDINGCOMPLETE       on server ack (2): ack 4
//   COMPLETE              on server ack (3): ack 5, handshake done
//   DONE                  on HandshakeReset: back to HELLO

import { EventEmitter } from 'node:events';
import {
    HS_CHANNEL, FML_PROTOCOL_VERSION,
    encodeClientHello, encodeModList, encodeAck,
} from './fml-hs.js';
import { RegistrySnapshot } from './registries.js';
import { diffModLists } from './modlist.js';
import { encodeRegister } from './channels.js';

export const ClientState = Object.freeze({
    START: 0,
    HELLO: 1,
    WAITINGSERVERDATA: 2,
    WAITINGSERVERCOMPLETE: 3,
    PENDINGCOMPLETE: 4,
    COMPLETE: 5,
    DONE: 6,
    ERROR: 7,
});

const STATE_NAMES = Object.fromEntries(Object.entries(ClientState).map(([k, v]) => [v, k]));

// The channels a Forge client always registers (fml-spec.md section 4).
export const CORE_CHANNELS = ['FML|HS', 'FML', 'FML|MP', 'FORGE'];

export class ClientHandshake extends EventEmitter {
    /**
     * @param {object} opts
     * @param {{modid:string,version:string}[]} opts.modList  sent as our ModList
     * @param {(channel:string, data:Buffer) => void} opts.send
     * @param {() => string[]} [opts.channels]  channels for our REGISTER (default: core set)
     */
    constructor({ modList, send, channels }) {
        super();
        if (!Array.isArray(modList)) throw new TypeError('modList is required');
        this.modList = modList;
        this.send = send;
        this.channels = channels ?? (() => CORE_CHANNELS);
        this.state = ClientState.START;
        this.serverHello = null;
        this.serverMods = null;
        this.modDiff = null;
        this.registries = new RegistrySnapshot();
        this.overrideDimension = 0;
        this.sent = []; // [{channel, kind}] for logs and tests
    }

    get stateName() { return STATE_NAMES[this.state]; }

    // Real Forge moves START -> HELLO when the connection becomes active.
    start() {
        if (this.state === ClientState.START) this.setState(ClientState.HELLO);
    }

    setState(s) {
        const from = this.state;
        this.state = s;
        this.emit('state', { from: STATE_NAMES[from], to: STATE_NAMES[s] });
    }

    write(channel, data, kind) {
        this.sent.push({ channel, kind });
        this.send(channel, data);
    }

    unexpected(msg) {
        this.emit('unexpected', { state: this.stateName, message: msg.type });
    }

    /** Handle one decoded FML|HS message from the server. */
    handle(msg) {
        if (this.state === ClientState.START) this.start();

        switch (this.state) {
        case ClientState.HELLO:
            if (msg.type === 'HandshakeReset') return; // already at HELLO
            if (msg.type !== 'ServerHello') return this.unexpected(msg);
            this.serverHello = msg;
            if (msg.fmlProtocol > 1) this.overrideDimension = msg.overrideDimension;
            this.write('REGISTER', encodeRegister(this.channels()), 'REGISTER');
            this.write(HS_CHANNEL, encodeClientHello(FML_PROTOCOL_VERSION), 'ClientHello');
            this.write(HS_CHANNEL, encodeModList(this.modList), 'ModList');
            this.setState(ClientState.WAITINGSERVERDATA);
            return;

        case ClientState.WAITINGSERVERDATA:
            if (msg.type !== 'ModList') return this.unexpected(msg);
            this.serverMods = msg.mods;
            this.modDiff = diffModLists(this.modList, msg.mods);
            this.emit('serverModList', { mods: msg.mods, diff: this.modDiff });
            this.write(HS_CHANNEL, encodeAck(ClientState.WAITINGSERVERDATA), 'Ack2');
            this.setState(ClientState.WAITINGSERVERCOMPLETE);
            return;

        case ClientState.WAITINGSERVERCOMPLETE:
            if (msg.type !== 'RegistryData') return this.unexpected(msg);
            this.registries.add(msg);
            this.emit('registryData', { name: msg.name, size: msg.ids.length, hasMore: msg.hasMore });
            if (msg.hasMore) return;
            this.write(HS_CHANNEL, encodeAck(ClientState.WAITINGSERVERCOMPLETE), 'Ack3');
            this.setState(ClientState.PENDINGCOMPLETE);
            this.emit('registries', this.registries);
            return;

        case ClientState.PENDINGCOMPLETE:
            if (msg.type !== 'HandshakeAck') return this.unexpected(msg);
            this.write(HS_CHANNEL, encodeAck(ClientState.PENDINGCOMPLETE), 'Ack4');
            this.setState(ClientState.COMPLETE);
            return;

        case ClientState.COMPLETE:
            if (msg.type !== 'HandshakeAck') return this.unexpected(msg);
            this.write(HS_CHANNEL, encodeAck(ClientState.COMPLETE), 'Ack5');
            this.setState(ClientState.DONE);
            this.emit('complete', {
                overrideDimension: this.overrideDimension,
                registries: this.registries,
                serverMods: this.serverMods,
            });
            return;

        case ClientState.DONE:
            if (msg.type === 'HandshakeReset') {
                this.registries = new RegistrySnapshot();
                this.serverMods = null;
                this.setState(ClientState.HELLO);
                this.emit('reset');
                return;
            }
            return this.unexpected(msg);

        default:
            return this.unexpected(msg);
        }
    }
}
