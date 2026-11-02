// patches/prismarine-auth+3.1.1.patch (lead-approved addition to net-forge's patch
// list): prismarine-auth's own console output is reduced to status, class and
// code, and XSTS errors carry their XErr as `err.xerr`. Offline: the real patched
// methods, stubbed fetch and caches, fake tokens only.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const authIndex = createRequire(createRequire(import.meta.url).resolve('minecraft-protocol')).resolve('prismarine-auth');
const requireAuth = createRequire(authIndex);
const LiveTokenManager = requireAuth('./src/TokenManagers/LiveTokenManager.js');
const MsaTokenManager = requireAuth('./src/TokenManagers/MsaTokenManager.js');
const XboxTokenManager = requireAuth('./src/TokenManagers/XboxTokenManager.js');
const { errorSummary } = requireAuth('./src/common/Util.js');
const { xboxLiveErrors } = requireAuth('./src/common/Constants.js');

const FAKE = 'eyJhbGciOiJSUzI1NiJ9.eyJmYWtlIjoicGF0Y2gtdGVzdCJ9.ZmFrZS1zaWduYXR1cmU';
const BODY = JSON.stringify({ error: 'invalid_grant', refresh_token: FAKE, access_token: FAKE });
const SECRET_LIKE = /eyJ|invalid_grant|refresh_token|access_token/;

// Capture what prismarine-auth prints, then restore the console.
const realConsole = { warn: console.warn, debug: console.debug, log: console.log, info: console.info, error: console.error };
const realFetch = globalThis.fetch;
let printed = [];
function capture() {
    printed = [];
    for (const k of Object.keys(realConsole)) console[k] = (...a) => printed.push(a.map((x) => (typeof x === 'string' ? x : require_inspect(x))).join(' '));
}
const require_inspect = (x) => createRequire(import.meta.url)('node:util').inspect(x, { depth: 5 });
afterEach(() => { Object.assign(console, realConsole); globalThis.fetch = realFetch; });

test('the patch is for the installed prismarine-auth version, exactly', () => {
    assert.equal(requireAuth('./package.json').version, '3.1.1');
    assert.ok(fs.existsSync(path.join(ROOT, 'patches', 'prismarine-auth+3.1.1.patch')));
    assert.equal(typeof errorSummary, 'function', 'the patch is applied (Util.errorSummary exists)');
});

for (const [name, Manager] of [['Live', LiveTokenManager], ['MSA', MsaTokenManager]]) {
    test(`${name} token refresh failure: "Error refreshing token" with status and class only`, async () => {
        const fake = {
            getAccessToken: () => Promise.resolve({ valid: false, token: FAKE }),
            getRefreshToken: () => Promise.resolve({ valid: true, token: FAKE }),
            refreshTokens: () => Promise.reject(new Error(`400 Bad Request ${BODY}`)),
        };
        capture();
        assert.equal(await Manager.prototype.verifyTokens.call(fake), false);
        assert.deepEqual(printed, ['Error refreshing token (HTTP 400, Error)']);
        assert.doesNotMatch(printed.join('\n'), SECRET_LIKE);
    });
}

test('Live device-code request non-200: the status, never the response body', async () => {
    globalThis.fetch = () => Promise.resolve(new Response(BODY, { status: 400, statusText: 'Bad Request' }));
    const live = new LiveTokenManager('fake-client-id', ['service::user.auth.xboxlive.com::MBI_SSL'], { getCached: () => Promise.resolve({}), setCachedPartial: () => Promise.resolve() });
    capture();
    await assert.rejects(live.authDeviceCode(() => {}), /Failed to request live\.com device code/);
    await new Promise((resolve) => setTimeout(resolve, 20)); // the unpatched code printed the body asynchronously
    assert.deepEqual(printed, ['Failed to request live.com device code (HTTP 400)']);
    assert.doesNotMatch(printed.join('\n'), SECRET_LIKE);
});

test('MSA device-code failure: the fixed hint and a summary, not the serialized MSAL error', async () => {
    const msalError = Object.assign(new Error(`AADSTS70000: ${BODY}`), { errorCode: 'invalid_grant', errorMessage: BODY, correlationId: FAKE });
    const fake = { scopes: ['XboxLive.signin'], msalApp: { acquireTokenByDeviceCode: () => Promise.reject(msalError) } };
    capture();
    await assert.rejects(MsaTokenManager.prototype.authDeviceCode.call(fake, () => {}), (e) => e === msalError);
    assert.equal(printed.length, 2);
    assert.match(printed[0], /^\[msa\] Error getting device code\. Ensure your supplied `authTitle`/);
    assert.equal(printed[1], '[msa] device code error (Error, invalid_grant)');
    assert.ok(!printed.join('\n').includes(FAKE));
    assert.ok(!printed.join('\n').includes('AADSTS70000'));
});

test('XSTS errors carry their XErr as err.xerr; an unknown XErr no longer carries the response JSON', () => {
    const response = { Identity: '0', XErr: 2148916233, Message: '', Redirect: 'https://start.ui.xboxlive.com/CreateAccount', Token: FAKE };
    const known = (() => { try { XboxTokenManager.prototype.checkTokenError.call({}, 2148916233, response); } catch (e) { return e; } })();
    assert.equal(known.message, xboxLiveErrors[2148916233]);
    assert.equal(known.xerr, 2148916233);
    const unknown = (() => { try { XboxTokenManager.prototype.checkTokenError.call({}, 2148916000, { ...response, XErr: 2148916000 }); } catch (e) { return e; } })();
    assert.equal(unknown.message, 'Xbox Live authentication failed to obtain a XSTS token. XErr: 2148916000');
    assert.equal(unknown.xerr, 2148916000);
    assert.ok(!unknown.message.includes(FAKE));
    const noCode = (() => { try { XboxTokenManager.prototype.checkTokenError.call({}, undefined, response); } catch (e) { return e; } })();
    assert.equal(noCode.xerr, undefined);
});

test('errorSummary: status, class, code and XErr only', () => {
    assert.equal(errorSummary(new Error(`401 Unauthorized ${BODY}`)), 'HTTP 401, Error');
    assert.equal(errorSummary(new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${FAKE}`), { code: 'ECONNRESET' }) })), 'TypeError, ECONNRESET');
    assert.equal(errorSummary(Object.assign(new Error('x'), { xerr: 2148916233 })), 'Error, XErr 2148916233');
    assert.equal(errorSummary(Object.assign(new Error('x'), { name: `Bearer ${FAKE}`, code: 'token=abc' })), 'Error');
    assert.equal(errorSummary(undefined), 'Error');
});
