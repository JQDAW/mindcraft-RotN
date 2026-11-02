// Mindcraft task files are benchmark setups: tasks.js, cooking_tasks.js and
// construction_tasks.js send /give, /tp, /clear, /fill, /setblock, /summon,
// /kill and /data. The bot has no operator rights on RotN, so a task file is
// refused unless a test-only opt-in is set (skills-rotn A2b, before the first
// G3 batch). Default off; never set in production or in G3 gate runs.
import process from 'node:process';

export const ALLOW_TASK_FILES_ENV = 'MINDCRAFT_ROTN_ALLOW_TASK_FILES';

/** True only when the opt-in env var is exactly "1". */
export function taskFilesAllowed(env = process.env) {
    return env?.[ALLOW_TASK_FILES_ENV] === '1';
}

export function taskRefusalMessage(taskId) {
    return `[tasks] Refused to load task ${taskId ?? '(no id)'}: Mindcraft task files send op commands ` +
        '(/give, /tp, /clear, /fill, /setblock, /summon, /kill, /data), and the bot has no operator rights on RotN. ' +
        `Set ${ALLOW_TASK_FILES_ENV}=1 only on a disposable test server, never in production or a G3 gate run.`;
}
