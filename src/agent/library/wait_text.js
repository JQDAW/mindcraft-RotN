/**
 * #587 nit 1, #588 re-review nit 2 (one helper): a wait in words for the journal: "50 ms" under a
 * second, "5 s" or "1.5 s" from one up (toFixed(0) said "0 s" for the short waits the tests use).
 */
export const waitText = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${+(ms / 1000).toFixed(1)} s`);
