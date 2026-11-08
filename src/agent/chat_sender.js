// Who really sent a chat line (security, lead task after G4 #10): mineflayer's 'chat' and 'whisper'
// events on 1.12 take the sender from the TEXT (lib/plugins/chat.js LEGACY_VANILLA_CHAT_REGEX and
// the whisper patterns), so a server announcement shaped "[X] Name: text" (an op's or a command
// block's /say, a mod broadcast, a chat-format plugin) read as a line FROM Name: "[Server] JQDAW:
// !stop" was the trusted giver JQDAW. Here the sender comes only from the structured chat component
// of the packet (mineflayer's 'message' event: a prismarine-chat ChatMessage and its position):
//
//   player chat: position 'chat' (1.12 packet position 0, which only a player's own chat uses),
//                {translate: "chat.type.text",                   with: [<sender>, <message>]}
//   a whisper:   position 'system' (1.12 packet position 1, which /tell uses; #400 nit 2: never
//                'chat', 'game_info' or none),
//                {translate: "commands.message.display.incoming", with: [<sender>, <message>]}
//                (the console's /tell has the sender "Server", a plain string)
//
// Anything else is not a message to the bot: /say ("chat.type.announcement"), /me ("chat.type.emote"),
// /tellraw, broadcasts, death and advancement messages, plain text.
//
// <sender> is a player's display name: 1.12 sets its `insertion` to the player's name (its text may
// carry a team prefix), so the name is the insertion. Without an insertion only the console counts,
// whose sender is exactly "Server" (#400 nit 1: a command block renamed "JQDAW" running /tell has
// no insertion, and is not JQDAW). Anything else (a command block's "@", any name without an
// insertion, a prefixed name) is no sender: the line is ignored.

export const PLAYER_CHAT = 'chat.type.text';
export const WHISPER_IN = 'commands.message.display.incoming';
const NAME = /^\w{1,16}$/;

const plain = (c) => {
    if (c === null || c === undefined) return '';
    if (typeof c === 'string') return c;
    if (typeof c.toString === 'function' && c.toString !== Object.prototype.toString) return String(c.toString());
    return typeof c.text === 'string' ? c.text : '';
};

/** The console's sender in a /tell (MinecraftServer's name), the only sender accepted without an insertion. */
export const CONSOLE_SENDER = 'Server';

/** The sender's name from a `with` entry (a ChatMessage, a component object or a string), or null. */
export function senderName(c) {
    const insertion = c?.json?.insertion ?? c?.insertion;
    if (typeof insertion === 'string') return NAME.test(insertion) ? insertion : null;
    return plain(c) === CONSOLE_SENDER ? CONSOLE_SENDER : null; // #400 nit 1: exactly "Server", else no sender
}

/**
 * The line as a message to the bot: {kind: 'chat'|'whisper', username, message}, or null when it is
 * not player chat or a whisper, or has no valid sender.
 */
export function chatFrom(jsonMsg, position) {
    const translate = jsonMsg?.translate ?? jsonMsg?.json?.translate;
    const withs = jsonMsg?.with ?? jsonMsg?.json?.with;
    if (!Array.isArray(withs) || withs.length < 2) return null;
    let kind = null;
    if (translate === PLAYER_CHAT && position === 'chat') kind = 'chat';
    else if (translate === WHISPER_IN && position === 'system') kind = 'whisper'; // #400 nit 2
    if (!kind) return null;
    const username = senderName(withs[0]);
    if (!username) return null;
    return { kind, username, message: plain(withs[1]) };
}
