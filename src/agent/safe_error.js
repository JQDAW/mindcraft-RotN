// Log-safe summaries of errors (skills-rotn A1, "Before the first CX23 run").
//
// Printing a whole error object (console.error('...', err)) also prints its
// own properties: an HTTP client error carries its request config (headers
// such as Authorization), its response (body, headers) and sometimes the
// token it was sent with. These helpers print only a few known-safe fields,
// redact anything that looks like a credential, and cap the length, so a
// log line never holds a token or a request/response body.

const MAX_LENGTH = 300;
const MAX_FRAMES = 8;

// Order matters: the specific patterns run before the generic long-blob one.
const REDACTIONS = [
    // Authorization header values: "Bearer abc...", "Basic abc...".
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
    // API keys in the sk- style (OpenAI, OpenRouter "sk-or-v1-...", Anthropic "sk-ant-...").
    [/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
    // JWTs and similar dotted tokens (Microsoft/Xbox auth tokens start with eyJ).
    [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g, '[redacted-token]'],
    // key=value or "key": "value" pairs whose key names a credential.
    [/\b(access_token|refresh_token|id_token|api[_-]?key|apikey|token|secret|password|authorization|x-api-key)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1$2[redacted]'],
    // Any other long opaque blob (base64, url-safe tokens) of 40+ characters.
    [/[A-Za-z0-9+/_-]{40,}={0,2}/g, (match) => (looksLikeBlob(match) ? '[redacted-blob]' : match)],
];

// A file path such as /home/deploy/mindcraft-rotn/src/agent also matches the
// blob pattern. Tokens mix upper case, lower case and digits, and any '/'
// inside base64 still leaves long runs; path segments are short.
function looksLikeBlob(text) {
    if (!/[0-9]/.test(text) || !/[A-Z]/.test(text) || !/[a-z]/.test(text)) return false;
    const longestRun = Math.max(...text.split('/').map(s => s.length));
    return longestRun >= 20;
}

/** Redact credential-looking substrings and collapse the text to one line. */
export function redact(text) {
    let out = String(text);
    for (const [pattern, replacement] of REDACTIONS) {
        out = out.replace(pattern, replacement);
    }
    return out.replace(/\s+/g, ' ').trim();
}

function cap(text, maxLength) {
    return text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text;
}

// Read a property without letting a throwing getter escape.
function read(obj, key) {
    try {
        return obj[key];
    } catch {
        return undefined;
    }
}

function isShortScalar(value) {
    return (typeof value === 'string' && value.length <= 40) || Number.isInteger(value);
}

function summary(err, depth) {
    if (err === null || err === undefined) return 'unknown error';
    if (typeof err !== 'object') return redact(err);

    let name = read(err, 'name');
    if (typeof name !== 'string' || !name) {
        const ctor = read(err, 'constructor');
        name = (ctor && typeof ctor.name === 'string' && ctor.name) || 'Error';
    }
    const message = read(err, 'message');
    const code = read(err, 'code');
    const response = read(err, 'response');
    const status = read(err, 'status') ?? read(err, 'statusCode') ??
        (response && typeof response === 'object' ? read(response, 'status') : undefined);

    let line = name;
    if (isShortScalar(code)) line += ` [${redact(code)}]`;
    if (Number.isInteger(status)) line += ` (status ${status})`;
    if (typeof message === 'string' && message) line += `: ${redact(message)}`;

    const cause = read(err, 'cause');
    if (cause !== undefined && depth < 1) line += ` (cause: ${summary(cause, depth + 1)})`;
    return line;
}

/**
 * One log-safe line for an error: name, code, HTTP status and the redacted
 * message (plus one level of `cause`), capped at `maxLength` characters.
 * Never the object's other properties, so no request config, headers or body.
 */
export function safeError(err, { maxLength = MAX_LENGTH } = {}) {
    try {
        return cap(summary(err, 0), maxLength);
    } catch {
        return 'unprintable error';
    }
}

/**
 * safeError plus up to `maxFrames` stack frames ("at fn (file:line:col)").
 * The stack's own first line repeats the raw message, so it is replaced by
 * the safe summary.
 */
export function safeStack(err, { maxLength = MAX_LENGTH, maxFrames = MAX_FRAMES } = {}) {
    const head = safeError(err, { maxLength });
    let stack;
    try {
        stack = err && typeof err === 'object' ? read(err, 'stack') : undefined;
    } catch {
        stack = undefined;
    }
    if (typeof stack !== 'string') return head;
    const frames = stack.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('at '))
        .slice(0, maxFrames)
        .map(l => '    ' + cap(redact(l), maxLength));
    return frames.length ? [head, ...frames].join('\n') : head;
}
