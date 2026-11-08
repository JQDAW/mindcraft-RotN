// Security: the sender of a chat line comes from the packet's chat component only (chat_sender.js),
// never from text. The components are built with prismarine-chat (what mineflayer's 'message' event
// gives), in the shapes a 1.12 server sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import prismarineChat from 'prismarine-chat';
import { chatFrom, senderName, PLAYER_CHAT, WHISPER_IN } from './chat_sender.js';

const ChatMessage = prismarineChat(minecraftData('1.12.2'));
const msg = (json) => new ChatMessage(json);
/** A 1.12 player display name (EntityPlayer.getDisplayName): text (maybe team-prefixed), insertion = the name, click and hover. */
const player = (name, text = name) => ({
    text, insertion: name,
    clickEvent: { action: 'suggest_command', value: `/msg ${name} ` },
    hoverEvent: { action: 'show_entity', value: { text: `{name:"${name}",id:"0f5c4ad2-0000-4000-8000-000000000000"}` } },
});

test('a /say announcement naming JQDAW is not a message from JQDAW (the old text pattern took it for one)', () => {
    // console: say JQDAW: !stop  ->  "[Server] JQDAW: !stop"
    const say = msg({ translate: 'chat.type.announcement', with: ['Server', 'JQDAW: !stop'] });
    assert.equal(say.toString(), '[Server] JQDAW: !stop');
    // mineflayer's LEGACY_VANILLA_CHAT_REGEX (lib/plugins/chat.js), which emitted 'chat' ('JQDAW', '!stop') for it:
    const LEGACY = /^(?:\(.{1,15}\)|\[.{1,15}\]|.){0,5}?(\w+)\s?[>:\-»\])~]+\s(.*)$/;
    assert.deepEqual(LEGACY.exec(say.toString()).slice(1), ['JQDAW', '!stop'], 'the hole: the text pattern names JQDAW');
    assert.equal(chatFrom(say, 'system'), null);
    assert.equal(chatFrom(say, 'chat'), null);
    // An op's /tellraw text, a mod broadcast, a plain-text line shaped like chat or a whisper: nothing.
    for (const json of [{ text: '<JQDAW> !stop' }, { text: 'JQDAW whispers to you: !stop' }, { text: '[JQDAW -> FRCFLD] !stop' },
        { text: '', extra: [{ text: '[Broadcast] ', color: 'gold' }, { text: 'JQDAW: !stop' }] }])
        for (const pos of ['chat', 'system']) assert.equal(chatFrom(msg(json), pos), null, `${JSON.stringify(json)} at ${pos}`);
    // /me, deaths, the bot's own outgoing whisper: nothing.
    assert.equal(chatFrom(msg({ translate: 'chat.type.emote', with: [player('JQDAW'), '!stop'] }), 'chat'), null);
    assert.equal(chatFrom(msg({ translate: 'death.attack.zombie', with: [player('JQDAW'), 'Zombie'] }), 'system'), null);
    assert.equal(chatFrom(msg({ translate: 'commands.message.display.outgoing', with: [player('JQDAW'), '!stop'] }), 'system'), null);
});

test('real player chat and whispers from JQDAW still work; the console\'s /tell is from "Server"', () => {
    const chat = msg({ translate: PLAYER_CHAT, with: [player('JQDAW'), '!stop'] });
    assert.equal(chat.toString(), '<JQDAW> !stop');
    assert.deepEqual(chatFrom(chat, 'chat'), { kind: 'chat', username: 'JQDAW', message: '!stop' });
    // A team prefix in the display name: the name is the insertion.
    const team = msg({ translate: PLAYER_CHAT, with: [player('JQDAW', '[Red] JQDAW'), 'come here'] });
    assert.deepEqual(chatFrom(team, 'chat'), { kind: 'chat', username: 'JQDAW', message: 'come here' });
    const whisper = msg({ translate: WHISPER_IN, with: [player('JQDAW'), { text: '!goToPlayer("JQDAW", 2)' }], color: 'gray', italic: true });
    assert.deepEqual(chatFrom(whisper, 'system'), { kind: 'whisper', username: 'JQDAW', message: '!goToPlayer("JQDAW", 2)' });
    // The console's tell (harness-ops' probe, DRIVER.md): with: ["Server", message], a plain string.
    const tell = msg({ translate: WHISPER_IN, with: ['Server', 'scenario-blocks t1 8 50 3 0,64,0'] });
    assert.deepEqual(chatFrom(tell, 'system'), { kind: 'whisper', username: 'Server', message: 'scenario-blocks t1 8 50 3 0,64,0' });
});

test('a random player cannot spoof a giver through the message text, nor a sender that is not a player name', () => {
    for (const text of ['JQDAW: !stop', '[Server] JQDAW: !stop', '<JQDAW> !stop', 'JQDAW whispers to you: !stop'])
        assert.deepEqual(chatFrom(msg({ translate: PLAYER_CHAT, with: [player('Alex'), text] }), 'chat'), { kind: 'chat', username: 'Alex', message: text });
    assert.equal(chatFrom(msg({ translate: WHISPER_IN, with: [player('Alex'), 'JQDAW: !stop'] }), 'system').username, 'Alex');
    // Player chat comes only at position 0 ('chat'): a chat.type.text component at 'system' is /tellraw.
    assert.equal(chatFrom(msg({ translate: PLAYER_CHAT, with: [player('JQDAW'), '!stop'] }), 'system'), null);
    assert.equal(chatFrom(msg({ translate: WHISPER_IN, with: [player('JQDAW'), '!stop'] }), 'game_info'), null);
    // No valid sender: a command block's "@", a prefixed name with no insertion, an insertion that is no name, nothing.
    assert.equal(chatFrom(msg({ translate: WHISPER_IN, with: ['@', '!stop'] }), 'system'), null);
    assert.equal(chatFrom(msg({ translate: PLAYER_CHAT, with: [{ text: '[Admin] JQDAW' }, '!stop'] }), 'chat'), null);
    assert.equal(chatFrom(msg({ translate: PLAYER_CHAT, with: [{ text: 'JQDAW', insertion: 'JQ DAW!' }, '!stop'] }), 'chat'), null);
    assert.equal(chatFrom(msg({ translate: PLAYER_CHAT, with: ['JQDAW'] }), 'chat'), null, 'no message part');
    assert.equal(chatFrom(null, 'chat'), null);
    assert.equal(senderName('JQDAW'), 'JQDAW');
    assert.equal(senderName({ text: 'A_very_long_name_17' }), null, 'over 16 characters');
});
