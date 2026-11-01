// The bot side of test/runner/DRIVER.md, for any mineflayer bot. A driver calls
// attachScenario(bot) after createBot; net-forge's spike can import this and keep its own bot factory.
//
//   on spawn:                  say $ROTN_SCENARIO_HELLO (once)
//   chat "scenario-echo TOKEN": say "echo TOKEN" (once per token)
//   chat "scenario-walk N":     walk at least N blocks horizontally, then say "walked X Y Z"
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

/** One JSON line per driver event on stdout, prefixed "DRIVER ". Never pass secrets in here. */
export const event = (type, data = {}) => process.stdout.write(`DRIVER ${JSON.stringify({ t: new Date().toISOString(), type, ...data })}\n`);

export function attachScenario(bot, { hello = process.env.ROTN_SCENARIO_HELLO, helloDelayMs = 2000, walkTimeoutMs = 30000, emit = event } = {}) {
    const echoed = new Set();
    let walking = false;
    // Every async handler catches its own errors: an event handler's rejection would otherwise be
    // unhandled (PR #9 review finding 8).
    const say = (text) => {
        try {
            bot.chat(text);
            return true;
        } catch (err) {
            emit('chat_error', { message: String(err?.message ?? err) });
            return false;
        }
    };
    bot.once('spawn', async () => {
        emit('spawn', { pos: pos(bot) });
        if (hello) {
            await sleep(helloDelayMs);
            if (say(hello)) emit('said', { text: hello });
        }
    });
    bot.on('messagestr', async (msg) => {
        const e = /scenario-echo (\S+)/.exec(msg);
        if (e && !echoed.has(e[1])) {
            echoed.add(e[1]);
            emit('heard', { text: msg });
            say(`echo ${e[1]}`);
        }
        const w = /scenario-walk (\d+)/.exec(msg);
        if (w && !walking) {
            walking = true;
            try {
                if (pos(bot) === null) throw new Error('no position yet (not spawned)');
                const r = await walk(bot, Number(w[1]), walkTimeoutMs);
                emit('walked', r);
                say(`walked ${r.to.map((v) => v.toFixed(1)).join(' ')}`);
            } catch (err) {
                emit('walk_error', { message: String(err?.message ?? err) });
            } finally {
                walking = false;
            }
        }
    });
}

const pos = (bot) => (bot.entity ? [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z] : null);

/**
 * Walk forward at least n blocks (horizontal), turning 90 degrees and jumping when stuck.
 * No pathfinder: G1 proves movement packets are accepted, not navigation.
 */
export async function walk(bot, n, timeoutMs, stepMs = 250) {
    const from = pos(bot);
    const dist = () => Math.hypot(bot.entity.position.x - from[0], bot.entity.position.z - from[2]);
    const end = Date.now() + timeoutMs;
    let last = dist();
    let still = 0;
    try {
        bot.setControlState('sprint', false);
        bot.setControlState('forward', true);
        while (dist() < n && Date.now() < end) {
            await sleep(stepMs);
            const d = dist();
            if (d - last < 0.05) {
                still += stepMs;
                bot.setControlState('jump', true);
                if (still >= 1500) {
                    await bot.look(bot.entity.yaw + Math.PI / 2, 0, true);
                    still = 0;
                }
            } else {
                bot.setControlState('jump', false);
                still = 0;
            }
            last = d;
        }
    } finally {
        bot.clearControlStates();
    }
    return { from, to: pos(bot), distance: dist() };
}
