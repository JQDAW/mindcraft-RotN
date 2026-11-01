// Registry snapshot built from FML|HS RegistryData messages (fml-spec.md section 2).
// The server sends one RegistryData per registry in unspecified order; the last
// one has hasMore == false.

export class RegistrySnapshot {
    constructor() {
        this.registries = new Map();
        this.complete = false;
    }

    add(msg) {
        const byName = new Map();
        const byId = new Map();
        for (const [name, id] of msg.ids) {
            byName.set(name, id);
            byId.set(id, name);
        }
        this.registries.set(msg.name, {
            name: msg.name,
            byName,
            byId,
            dummied: new Set(msg.dummied),
            overrides: new Map(msg.overrides),
        });
        if (!msg.hasMore) this.complete = true;
    }

    get(name) { return this.registries.get(name) ?? null; }
    names() { return [...this.registries.keys()]; }

    idOf(registry, name) { return this.get(registry)?.byName.get(name); }
    nameOf(registry, id) { return this.get(registry)?.byId.get(id); }

    // { registryName: entryCount }, sorted by name; handy for logs and assertions.
    sizes() {
        const out = {};
        for (const name of this.names().sort()) out[name] = this.registries.get(name).byName.size;
        return out;
    }

    // Count of entries per mod namespace in one registry.
    namespaces(registry) {
        const out = {};
        for (const name of this.get(registry)?.byName.keys() ?? []) {
            const ns = name.includes(':') ? name.slice(0, name.indexOf(':')) : 'minecraft';
            out[ns] = (out[ns] ?? 0) + 1;
        }
        return out;
    }

    // Plain-JSON form for fixtures or for rotn-data.
    toJSON() {
        const out = {};
        for (const [name, r] of this.registries) {
            out[name] = {
                ids: Object.fromEntries(r.byName),
                dummied: [...r.dummied],
                overrides: Object.fromEntries(r.overrides),
            };
        }
        return out;
    }
}
