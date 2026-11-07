// RotN (ready-to-try: "insecure coding is off"): the MindServer UI must not switch it on at run time.
// Upstream lets `create-agent` and `set-agent-settings` carry any settings object, unauthenticated
// (the server binds localhost only). This refuses any truthy allow_insecure_coding from those events,
// the same truthiness that src/agent/commands/actions.js uses to allow !newAction.

/** True when a settings object from the UI asks for insecure coding. */
export function requestsInsecureCoding(settings) {
    return Boolean(settings && typeof settings === 'object' && settings.allow_insecure_coding);
}

export const INSECURE_REFUSAL = 'allow_insecure_coding cannot be enabled through the MindServer (RotN rule: insecure coding stays off)';
