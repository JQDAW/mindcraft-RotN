// Test-only preload for g1-driver (`node --import <this file> tools/g1-driver.mjs`):
// prismarine-auth's getMinecraftJavaToken fails the way it really does, offline,
// with fake values only (no network, no real token, nothing read from a cache).
// FAKE_AUTH_FAILURE picks the failure:
//   xbox401 / xbox403 / xbox503  checkStatus's Error("<status> <statusText> <body>")
//   xsts<XErr>                   the real XboxTokenManager.checkTokenError (patched: err.xerr)
//   network                      Node fetch's TypeError('fetch failed') with a coded cause
//   profile404 / profile503      the real (instrumented) fetchProfile fails; prismarine-auth
//                                swallows that, so nmp throws "Failed to obtain profile data"
// The body and the cause message carry FAKE_JWT, which must never reach the driver's output.

import process from 'node:process';
import { createRequire } from 'node:module';

export const FAKE_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJmYWtlIjoidGVzdC1vbmx5In0.ZmFrZS1zaWduYXR1cmUtZm9yLWEtdGVzdA';
const BODY = JSON.stringify({ Authorization: `Bearer ${FAKE_JWT}`, XErr: 2148916233, Message: '', Token: FAKE_JWT, DisplayClaims: { xui: [{ uhs: 'fake-user-hash' }] } });

const authIndex = createRequire(createRequire(import.meta.url).resolve('minecraft-protocol')).resolve('prismarine-auth');
const requireAuth = createRequire(authIndex);
const { Authflow } = requireAuth('./index.js');
const JavaTokenManager = requireAuth('./src/TokenManagers/MinecraftJavaTokenManager.js');
const XboxTokenManager = requireAuth('./src/TokenManagers/XboxTokenManager.js');

const STATUS_TEXT = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' };
const mode = process.env.FAKE_AUTH_FAILURE ?? '';

Authflow.prototype.getMinecraftJavaToken = async function getMinecraftJavaToken() {
    const xbox = /^xbox(\d{3})$/.exec(mode);
    if (xbox) throw new Error(`${xbox[1]} ${STATUS_TEXT[xbox[1]]} ${BODY}`);
    // The real (patched) XSTS error path: checkTokenError(XErr, response JSON).
    const xsts = /^xsts(\d+)$/.exec(mode);
    if (xsts) XboxTokenManager.prototype.checkTokenError.call({}, Number(xsts[1]), JSON.parse(BODY));
    if (mode === 'network') {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error(`read ECONNRESET 203.0.113.9:443 ${FAKE_JWT}`), { code: 'ECONNRESET' }) });
    }
    const profile = /^profile(\d{3})$/.exec(mode);
    if (profile) {
        const status = Number(profile[1]);
        globalThis.fetch = () => Promise.resolve(new Response(BODY, { status, statusText: STATUS_TEXT[status] }));
        // As prismarine-auth does: .catch(e => debug('Failed to obtain profile data', e)).
        const result = await new JavaTokenManager({}).fetchProfile(FAKE_JWT).catch(() => undefined);
        return { token: FAKE_JWT, entitlements: {}, profile: result, certificates: {} };
    }
    throw new Error(`fake-auth-failure: unknown FAKE_AUTH_FAILURE ${mode}`);
};
