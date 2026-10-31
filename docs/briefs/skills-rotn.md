# Brief: skills-rotn

You make the bot behave well in RotN: rewrite Mindcraft's skills, commands, modes and prompts for 1.12.2 + RotN, and build the autonomy model (priority stack, task queue, agenda).

## You own

- `src/agent/` (skills, world queries, commands, modes, self_prompter, a new task queue module)
- `profiles/` (the RotN bot profile, defaults, prompts and examples)

Use rotn-data's API for every block, item and recipe fact. Do not hard-code RotN item names in skills when the data package can answer.

## Inputs

- `docs/research/rotn-progression.md`, `docs/research/seam-map.md`
- `packages/rotn-data/` API, and the forge-bridge registry at runtime
- Test server scenarios from harness-ops

## Deliverables

1. **Basics first** (can start before G2): chat, follow, come, stop, inventory, using translated names.
2. **RotN early game:** gather rocks, make cobblestone, crude axe, logs, planks, crafting table, stone tools, following `rotn-progression.md`.
3. **Reflexes (modes):** fight or flee, eat, escape darkness, lava and deep water, detect AggroTP teleports (sudden position jumps) and invasion warnings, then cancel and re-plan.
4. **Priority stack:** reflexes > control commands > player tasks > autonomous agenda, with interrupts only at safe checkpoints.
5. **Task queue:** persistent JSON per bot (survives restarts), fields include `id`, `text`, `priority` (urgent or normal), `giver`, `assignee`, `status`, `result`. Commands `!task add`, `!task list`, `!task cancel`. Only players on the task-giver list (settings, plus `only_chat_with`) can add tasks; others are politely refused.
6. **Agenda:** a RotN progression plan in a goal file, resumed when the queue is empty, built on `self_prompter.js` and `!goal`. Calls the LLM only at decision points. Optional setting `pause_when_empty` (default false).
7. **Profile:** RotN system prompt (hazards, progression, the command list), RotN examples using real 1.12.2 names, OpenRouter model as primary plus a fallback.
8. **Death handling:** respawn, report losses, avoid chat-spam loops.

## Acceptance tests

- Harness scenarios for G3: rocks to stone tools on a fresh spawn; survives the first night; a task preempts the agenda, then the agenda resumes; queue survives a restart.
- `npm test` passes; no new ESLint errors; upstream code paths you did not need to change stay unchanged.
