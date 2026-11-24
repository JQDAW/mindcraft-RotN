// Soak 13 (C3b, the lead): an unknown block or item name in a command says the closest real names, so the
// model does not guess again. Day 3: `!searchForBlock("rustic:wildberries")`, then "wildberry_bush", then
// "contenttweaker:wildberry_bush": 3 calls for rustic:wildberry_bush.

export const SUGGEST = { max: 3, stem: 4 };

const splitName = (name) => {
    const s = String(name).trim().toLowerCase().replace(/:\d+$/, ''); // a meta suffix (stone:2) is no word
    const i = s.indexOf(':');
    const ns = i < 0 ? '' : s.slice(0, i);
    const path = i < 0 ? s : s.slice(i + 1);
    return { ns: ns === 'minecraft' ? '' : ns, words: path.split(/[_\s]+/).filter(Boolean) };
};
const prefixLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
/** One word for another: the same, or the same stem (wildberries / wildberry: all but the last 2 letters shared, at least SUGGEST.stem). */
const sameWord = (a, b) => a === b
    || (Math.min(a.length, b.length) >= SUGGEST.stem && prefixLen(a, b) >= Math.max(SUGGEST.stem, Math.min(a.length, b.length) - 2));

/**
 * The real names closest to `input`, at most SUGGEST.max: those sharing at least one word of the name's path
 * (after the namespace), by the words shared (a path word 2, the namespace 1), then the fewest other words.
 */
export function suggestNames(input, names) {
    const want = splitName(input);
    if (!want.words.length) return [];
    const scored = [];
    for (const name of names ?? []) {
        if (typeof name !== 'string' || !name) continue;
        const have = splitName(name);
        const shared = want.words.filter(w => have.words.some(h => sameWord(w, h))).length;
        if (!shared) continue;
        const score = 2 * shared + (want.ns && want.ns === have.ns ? 1 : 0);
        const extra = have.words.filter(h => !want.words.some(w => sameWord(w, h))).length;
        scored.push({ name, score, extra });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.extra - b.extra) || (a.name.length - b.name.length) || a.name.localeCompare(b.name));
    return [...new Set(scored.map(s => s.name))].slice(0, SUGGEST.max);
}

/** " Did you mean a, b or c?" for the names closest to input, or '' with none. */
export function suggestText(input, names) {
    const s = suggestNames(input, names);
    if (!s.length) return '';
    return ` Did you mean ${s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} or ${s.at(-1)}`}?`;
}
